import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, promises as fs, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSyncHost } from '@main/services/sync/host'
import { HttpRemote, SyncEngine } from '@main/services/sync/engine'
import { scan, isSyncable } from '@main/services/sync/manifest'
import { listHistory, restoreHistory, snapshot } from '@main/services/sync/history'
import { detectProvider, findConflictCopies, originalOf, resolveConflictCopy } from '@main/services/sync/folder'

const tmp = (n: string): string => mkdtempSync(join(tmpdir(), `reach-sync-${n}-`))
const write = async (root: string, rel: string, data: string | Buffer): Promise<void> => { await fs.mkdir(join(root, rel, '..'), { recursive: true }); await fs.writeFile(join(root, rel), data) }
const read = (root: string, rel: string): Promise<string> => fs.readFile(join(root, rel), 'utf8')
const exists = (root: string, rel: string): Promise<boolean> => fs.stat(join(root, rel)).then(() => true, () => false)
const age = (root: string, rel: string, secondsAgo: number): void => { const t = new Date(Date.now() - secondsAgo * 1000); utimesSync(join(root, rel), t, t) }

let hostRoot: string, server: Server, url: string
let enabled = true
const PIN = '123456'
beforeAll(async () => {
  hostRoot = tmp('host')
  const handler = createSyncHost({ root: () => hostRoot, pin: () => PIN, name: () => 'Hub', enabled: () => enabled })
  server = createServer((req, res) => void handler(req, res, new URL(req.url ?? '/', 'http://x')).then((h) => { if (!h) { res.writeHead(404); res.end() } }))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(() => server.close())

const replica = (name: string, opts: { chunk?: number } = {}): { root: string; engine: SyncEngine; remote: HttpRemote } => {
  const root = tmp(name)
  const remote = new HttpRemote(url, () => PIN, { chunk: opts.chunk })
  const engine = new SyncEngine(remote, { root, statePath: join(tmp(name + '-state'), 'state.json'), deviceName: name })
  return { root, engine, remote }
}

describe('sync engine (two replicas + in-process host)', () => {
  let A: ReturnType<typeof replica>, B: ReturnType<typeof replica>
  beforeAll(() => { A = replica('a'); B = replica('b') })
  it('rejects a wrong PIN', async () => {
    await expect(new HttpRemote(url, () => '000000').hello()).rejects.toThrow(/PIN/)
    expect((await A.remote.hello()).name).toBe('Hub')
  })
  it('propagates new files both ways', async () => {
    await write(A.root, 'library/p1.reach', '{"id":"p1","v":1}')
    await write(B.root, 'docs/themes.json', '[]')
    await A.engine.syncOnce()
    const rb = await B.engine.syncOnce()
    expect(rb.downloaded).toEqual(['library/p1.reach'])
    expect(rb.uploaded).toEqual(['docs/themes.json'])
    await A.engine.syncOnce()
    expect(await read(A.root, 'docs/themes.json')).toBe('[]')
    expect(await read(B.root, 'library/p1.reach')).toBe('{"id":"p1","v":1}')
    expect(await read(hostRoot, 'library/p1.reach')).toBe('{"id":"p1","v":1}')
  })
  it('propagates edits and deletes (deleted files are kept in history)', async () => {
    await write(A.root, 'library/p1.reach', '{"id":"p1","v":2}')
    await A.engine.syncOnce()
    await B.engine.syncOnce()
    expect(await read(B.root, 'library/p1.reach')).toBe('{"id":"p1","v":2}')
    await fs.rm(join(B.root, 'docs/themes.json'))
    expect((await B.engine.syncOnce()).deletedRemote).toEqual(['docs/themes.json'])
    expect((await A.engine.syncOnce()).deletedLocal).toEqual(['docs/themes.json'])
    expect(await exists(A.root, 'docs/themes.json')).toBe(false)
    expect((await listHistory(A.root, 'docs/themes.json')).length).toBe(1)
  })
  it('conflict: both edited → newest wins, the other is kept and reported', async () => {
    await write(A.root, 'library/p1.reach', '{"id":"p1","v":"A"}'); age(A.root, 'library/p1.reach', 60)
    await write(B.root, 'library/p1.reach', '{"id":"p1","v":"B"}')
    await B.engine.syncOnce() // B uploads first
    const r = await A.engine.syncOnce()
    expect(r.conflicts).toHaveLength(1)
    expect(r.conflicts[0].winner).toBe('remote')
    expect(await read(A.root, 'library/p1.reach')).toBe('{"id":"p1","v":"B"}')
    expect(await read(A.root, r.conflicts[0].backup)).toBe('{"id":"p1","v":"A"}')
  })
  it('an edit beats a delete', async () => {
    await A.engine.syncOnce(); await B.engine.syncOnce()
    await fs.rm(join(A.root, 'library/p1.reach'))
    await write(B.root, 'library/p1.reach', '{"id":"p1","v":"B2"}')
    await B.engine.syncOnce()
    const r = await A.engine.syncOnce()
    expect(r.conflicts[0].reason).toMatch(/kept the changed version/)
    expect(await read(A.root, 'library/p1.reach')).toBe('{"id":"p1","v":"B2"}')
  })
  it('offline: keeps working and catches up later', async () => {
    enabled = false
    await write(A.root, 'playlists/sun.json', '{"id":"sun"}')
    await expect(A.engine.syncOnce()).rejects.toThrow(/not sharing/) // host unavailable → file stays pending
    expect(await A.engine.pending()).toBeGreaterThan(0)
    enabled = true
    expect((await A.engine.syncOnce()).uploaded).toEqual(['playlists/sun.json'])
    expect((await B.engine.syncOnce()).downloaded).toEqual(['playlists/sun.json'])
  })
  it('never syncs dot-folders, temp files or partial downloads', async () => {
    expect(['.history/x', 'library/a.reach.1a2b.tmp', 'media/x.part', '.sync-partial/a', 'media/.DS_Store'].map(isSyncable)).toEqual([false, false, false, false, false])
    await write(A.root, '.history/secret.txt', 'x')
    await A.engine.syncOnce()
    expect(await exists(hostRoot, '.history/secret.txt')).toBe(false)
  })
  it('large files move in chunks and resume after an interruption', async () => {
    const C = replica('c', { chunk: 64 * 1024 }), D = replica('d', { chunk: 64 * 1024 })
    const big = Buffer.alloc(300 * 1024)
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) % 251
    await write(C.root, 'media/video.mp4', big)
    await C.engine.syncOnce()
    expect((await fs.readFile(join(hostRoot, 'media/video.mp4'))).equals(big)).toBe(true)
    // Interrupt D's download after the first chunk.
    const real = D.remote.download.bind(D.remote)
    let calls = 0
    const orig = globalThis.fetch
    globalThis.fetch = (async (...a: Parameters<typeof fetch>) => { if (String(a[0]).includes('video.mp4') && ++calls > 1) throw new Error('network dropped'); return orig(...a) }) as typeof fetch
    await D.engine.syncOnce()
    globalThis.fetch = orig
    expect(await exists(D.root, 'media/video.mp4')).toBe(false)
    const parts = await fs.readdir(join(D.root, '.sync-partial'))
    expect((await fs.stat(join(D.root, '.sync-partial', parts[0]))).size).toBe(64 * 1024)
    let ranges: string[] = []
    globalThis.fetch = (async (...a: Parameters<typeof fetch>) => { const h = (a[1]?.headers ?? {}) as Record<string, string>; if (h.range) ranges.push(h.range); return orig(...a) }) as typeof fetch
    await D.engine.syncOnce()
    globalThis.fetch = orig
    expect(ranges[0]).toBe(`bytes=${64 * 1024}-${128 * 1024 - 1}`)
    expect((await fs.readFile(join(D.root, 'media/video.mp4'))).equals(big)).toBe(true)
    void real; ranges = []
  })
})

describe('version history', () => {
  it('snapshots, dedupes and restores', async () => {
    const root = tmp('hist')
    await write(root, 'library/p.reach', '{"id":"p","title":"One","slides":[1]}')
    await snapshot(root, 'library/p.reach')
    await snapshot(root, 'library/p.reach') // identical → skipped
    await new Promise((r) => setTimeout(r, 5))
    await write(root, 'library/p.reach', '{"id":"p","title":"Two","slides":[1,2]}')
    await snapshot(root, 'library/p.reach', 'manual')
    const list = await listHistory(root, 'library/p.reach')
    expect(list.map((e) => [e.title, e.slideCount])).toEqual([['Two', 2], ['One', 1]])
    await write(root, 'library/p.reach', '{"id":"p","title":"Broken"}')
    await restoreHistory(root, 'library/p.reach', list[1].id)
    expect(JSON.parse(await read(root, 'library/p.reach')).title).toBe('One')
    expect((await listHistory(root, 'library/p.reach')).some((e) => e.title === 'Broken')).toBe(true) // restore is undoable
  })
})

describe('cloud folders (Dropbox / iCloud / Google Drive / OneDrive / Syncthing)', () => {
  it('detects providers from the path', () => {
    expect(detectProvider('/Users/x/Library/Mobile Documents/com~apple~CloudDocs/Reach')).toBe('icloud')
    expect(detectProvider('/Users/x/Dropbox (Reach Church)/Reach')).toBe('dropbox')
    expect(detectProvider('/Users/x/Library/CloudStorage/GoogleDrive-a@b.c/My Drive/Reach')).toBe('gdrive')
    expect(detectProvider('C:\\Users\\x\\OneDrive\\Reach')).toBe('onedrive')
    expect(detectProvider('/Volumes/NAS/Reach')).toBe('network')
    expect(detectProvider('/Users/x/Documents/Reach Presenter')).toBeNull()
  })
  it('recognises conflict-copy names', () => {
    expect(originalOf("abc123 (Ranen's conflicted copy 2026-11-13).reach")).toBe('abc123.reach')
    expect(originalOf('abc123.sync-conflict-20261113-101010-ABCDEFG.reach')).toBe('abc123.reach')
    expect(originalOf('abc123 2.reach')).toBe('abc123.reach')
    expect(originalOf('abc123 (1).json')).toBe('abc123.json')
    expect(originalOf('abc123-DESKTOP-7Q2.reach')).toBe('abc123.reach')
    expect(originalOf('abc123.reach')).toBeNull()
    expect(originalOf('Sunday 2.mp4')).toBeNull()
  })
  it('resolves copies by updatedAt and keeps the loser', async () => {
    const root = tmp('folder')
    await write(root, 'library/abc.reach', JSON.stringify({ id: 'abc', title: 'old', updatedAt: '2026-11-01T00:00:00Z' }))
    await write(root, "library/abc (Ranen's conflicted copy 2026-11-13).reach", JSON.stringify({ id: 'abc', title: 'new', updatedAt: '2026-11-13T00:00:00Z' }))
    await write(root, 'library/zzz 2.reach', JSON.stringify({ id: 'other' }))
    await write(root, 'library/zzz.reach', JSON.stringify({ id: 'zzz' })) // different id → not a copy
    const copies = await findConflictCopies(root)
    expect(copies).toEqual([{ copy: "library/abc (Ranen's conflicted copy 2026-11-13).reach", original: 'library/abc.reach' }])
    const r = await resolveConflictCopy(root, copies[0])
    expect(r.winner).toBe('copy')
    expect(JSON.parse(await read(root, 'library/abc.reach')).title).toBe('new')
    expect(JSON.parse(await read(root, r.backup)).title).toBe('old')
    expect(await findConflictCopies(root)).toEqual([])
    expect(Object.keys(await scan(root)).sort()).toEqual(['library/abc.reach', 'library/zzz 2.reach', 'library/zzz.reach'])
  })
})
