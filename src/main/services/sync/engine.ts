/**
 * Two-way sync between this computer's workspace (a full local replica) and a remote store.
 * Three-way merge per file against the manifest of the last successful sync ("base"):
 *   only remote changed → download · only local changed → upload · both changed → last writer wins,
 *   the other version is kept in .history/conflicts and reported. Deletions never beat edits.
 * Offline-first: the replica keeps working; the next successful pass reconciles.
 */
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SyncConflict } from '@shared/integrations'
import { hashFile, scan, toAbs, type FileEntry, type HashCache, type Manifest } from './manifest'
import { keepConflict, snapshot } from './history'

export interface Remote {
  manifest(etag?: string): Promise<{ files: Manifest; etag: string } | null>
  download(path: string, entry: FileEntry, dest: string, onBytes?: (n: number) => void): Promise<void>
  upload(path: string, abs: string, entry: FileEntry, base: string | null, force?: boolean): Promise<{ ok: true } | { conflict: string }>
  remove(path: string, base: string): Promise<{ ok: true } | { conflict: string }>
}

export interface SyncReport { downloaded: string[]; uploaded: string[]; deletedLocal: string[]; deletedRemote: string[]; conflicts: SyncConflict[]; pending: number }

export interface EngineOptions {
  root: string
  statePath: string
  deviceName: string
  onFileChanged?: (rel: string) => void
  onProgress?: (p: { file: string; done: number; total: number }) => void
}

export class SyncEngine {
  base: Manifest = {}
  private cache: HashCache = new Map()
  private remoteEtag = ''
  private remoteFiles: Manifest = {}
  running = false
  constructor(public remote: Remote, public o: EngineOptions) {}

  async load(): Promise<void> {
    try { this.base = JSON.parse(await fs.readFile(this.o.statePath, 'utf8')).base ?? {} } catch { this.base = {} }
  }
  private async saveState(): Promise<void> {
    await fs.mkdir(dirname(this.o.statePath), { recursive: true })
    const tmp = this.o.statePath + '.tmp'
    await fs.writeFile(tmp, JSON.stringify({ base: this.base }))
    await fs.rename(tmp, this.o.statePath)
  }

  /** Local changes not yet on the remote. */
  async pending(): Promise<number> {
    const local = await scan(this.o.root, this.cache)
    let n = 0
    for (const p of new Set([...Object.keys(local), ...Object.keys(this.base)])) if (local[p]?.hash !== this.base[p]?.hash) n++
    return n
  }

  async syncOnce(): Promise<SyncReport> {
    if (this.running) throw new Error('Sync already running')
    this.running = true
    const rep: SyncReport = { downloaded: [], uploaded: [], deletedLocal: [], deletedRemote: [], conflicts: [], pending: 0 }
    try {
      const m = await this.remote.manifest(this.remoteEtag)
      if (m) { this.remoteFiles = m.files; this.remoteEtag = m.etag }
      const R = this.remoteFiles
      const L = await scan(this.o.root, this.cache)
      const B = this.base
      const paths = [...new Set([...Object.keys(L), ...Object.keys(R), ...Object.keys(B)])].sort()
      let i = 0
      for (const p of paths) {
        i++
        const l = L[p], r = R[p], b = B[p]
        try {
          if (l?.hash === r?.hash) { if (l) B[p] = l; else delete B[p]; continue }
          const localChanged = l?.hash !== b?.hash
          const remoteChanged = r?.hash !== b?.hash
          if (!localChanged && remoteChanged) {
            if (r) { await this.pull(p, r, i, paths.length); B[p] = r; rep.downloaded.push(p) }
            else { await this.trashLocal(p, 'deleted-remotely'); delete B[p]; rep.deletedLocal.push(p) }
          } else if (localChanged && !remoteChanged) {
            if (l) {
              const res = await this.remote.upload(p, toAbs(this.o.root, p), l, b?.hash ?? null)
              if ('conflict' in res) { rep.conflicts.push(await this.conflict(p, l, { ...l, hash: res.conflict, mtime: Date.now() }, B)); continue }
              B[p] = l; rep.uploaded.push(p)
            } else {
              const res = await this.remote.remove(p, b!.hash)
              if ('conflict' in res) { this.remoteEtag = ''; continue } // remote edited meanwhile → next pass downloads it
              delete B[p]; rep.deletedRemote.push(p)
            }
          } else {
            rep.conflicts.push(await this.conflict(p, l, r, B))
          }
        } catch (e) {
          // One bad file shouldn't stop the rest; it stays pending and is retried next pass.
          console.warn('[sync]', p, e instanceof Error ? e.message : e)
        }
      }
      await this.saveState()
      rep.pending = paths.filter((p) => (L[p]?.hash ?? null) !== (B[p]?.hash ?? null) && !rep.uploaded.includes(p) && !rep.deletedRemote.includes(p) && !rep.downloaded.includes(p) && !rep.deletedLocal.includes(p)).length
      if (rep.uploaded.length || rep.deletedRemote.length) this.remoteEtag = ''
      return rep
    } finally {
      this.running = false
    }
  }

  private async pull(p: string, r: FileEntry, i: number, total: number): Promise<void> {
    const dest = toAbs(this.o.root, p)
    const part = join(this.o.root, '.sync-partial', r.hash + '.part')
    await fs.mkdir(dirname(part), { recursive: true })
    this.o.onProgress?.({ file: p, done: i, total })
    await this.remote.download(p, r, part)
    if ((await hashFile(part)) !== r.hash) { await fs.rm(part, { force: true }); throw new Error(`Download of ${p} was corrupted`) }
    if (await fs.stat(dest).catch(() => null)) await snapshot(this.o.root, p, 'sync', { keep: 30 })
    await fs.mkdir(dirname(dest), { recursive: true })
    await fs.rename(part, dest)
    await fs.utimes(dest, new Date(), new Date(r.mtime)).catch(() => {})
    this.o.onFileChanged?.(p)
  }

  private async trashLocal(p: string, reason: string): Promise<void> {
    await snapshot(this.o.root, p, reason, { keep: 30 })
    await fs.rm(toAbs(this.o.root, p), { force: true })
    this.o.onFileChanged?.(p)
  }

  /** Both sides changed. Newest wins; the other version is kept in .history/conflicts. An edit always beats a delete. */
  private async conflict(p: string, l: FileEntry | undefined, r: FileEntry | undefined, B: Manifest): Promise<SyncConflict> {
    const at = new Date().toISOString()
    const id = `${p}@${at}`
    if (!l && r) { await this.pull(p, r, 0, 0); B[p] = r; return { id, path: p, at, backup: '', winner: 'remote', reason: 'Deleted here but changed on another computer — kept the changed version.' } }
    if (l && !r) {
      await this.remote.upload(p, toAbs(this.o.root, p), l, null, true)
      B[p] = l
      return { id, path: p, at, backup: '', winner: 'local', reason: 'Deleted on another computer but changed here — kept the changed version.' }
    }
    const localWins = l!.mtime >= r!.mtime
    if (localWins) {
      const tmp = join(this.o.root, '.sync-partial', r!.hash + '.part')
      await fs.mkdir(dirname(tmp), { recursive: true })
      await this.remote.download(p, r!, tmp)
      const backup = await keepConflict(this.o.root, p, await fs.readFile(tmp), 'other computer')
      await fs.rm(tmp, { force: true })
      await this.remote.upload(p, toAbs(this.o.root, p), l!, r!.hash, true)
      B[p] = l!
      return { id, path: p, at, backup, winner: 'local', reason: 'Changed on two computers — kept the newest (this computer’s).' }
    }
    const backup = await keepConflict(this.o.root, p, await fs.readFile(toAbs(this.o.root, p)), this.o.deviceName)
    await this.pull(p, r!, 0, 0)
    B[p] = r!
    return { id, path: p, at, backup, winner: 'remote', reason: 'Changed on two computers — kept the newest (the other computer’s).' }
  }
}

/* ───────────── HTTP remote (another Reach computer / headless Reach Hub) ───────────── */

export class HttpRemote implements Remote {
  constructor(public base: string, private pin: () => string, private opts: { chunk?: number; timeout?: number } = {}) {}
  private async req(path: string, init: RequestInit & { timeout?: number } = {}): Promise<Response> {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), init.timeout ?? this.opts.timeout ?? 30000)
    try {
      return await fetch(this.base.replace(/\/$/, '') + path, { ...init, signal: ctl.signal, headers: { 'x-reach-pin': this.pin(), ...(init.headers as Record<string, string>) } })
    } catch (e) {
      throw new Error(`Can’t reach the sync host (${this.base}) — ${(e as Error).name === 'AbortError' ? 'timed out' : 'offline?'}`)
    } finally { clearTimeout(t) }
  }
  private async check(r: Response): Promise<Response> {
    if (r.status === 401) throw new Error('The sync host rejected the PIN.')
    if (!r.ok && r.status !== 304 && r.status !== 409) throw new Error(`Sync host error ${r.status}: ${await r.text().catch(() => '')}`)
    return r
  }
  async hello(): Promise<{ name: string }> { return (await this.check(await this.req('/sync/hello'))).json() as Promise<{ name: string }> }
  async manifest(etag?: string): Promise<{ files: Manifest; etag: string } | null> {
    const r = await this.check(await this.req('/sync/manifest', { headers: etag ? { 'if-none-match': etag } : {} }))
    return r.status === 304 ? null : ((await r.json()) as { files: Manifest; etag: string })
  }
  async download(path: string, entry: FileEntry, dest: string): Promise<void> {
    const chunk = this.opts.chunk ?? 8 * 1024 * 1024
    let have = (await fs.stat(dest).catch(() => null))?.size ?? 0
    if (have > entry.size) { await fs.rm(dest, { force: true }); have = 0 }
    while (have < entry.size) {
      const end = Math.min(entry.size - 1, have + chunk - 1)
      const r = await this.check(await this.req(`/sync/file?path=${encodeURIComponent(path)}`, { headers: { range: `bytes=${have}-${end}` }, timeout: 120000 }))
      const buf = Buffer.from(await r.arrayBuffer())
      if (!buf.length) throw new Error('Empty chunk')
      await fs.appendFile(dest, buf)
      have += buf.length
    }
    if (entry.size === 0) await fs.writeFile(dest, '')
  }
  async upload(path: string, abs: string, entry: FileEntry, base: string | null, force = false): Promise<{ ok: true } | { conflict: string }> {
    const chunk = this.opts.chunk ?? 8 * 1024 * 1024
    const q = `path=${encodeURIComponent(path)}&hash=${entry.hash}&size=${entry.size}&base=${base ?? ''}${force ? '&force=1' : ''}`
    let offset = Number(((await (await this.check(await this.req(`/sync/upload?${q}`))).json()) as { received: number }).received) || 0
    if (offset >= entry.size) offset = 0
    const fh = await fs.open(abs, 'r')
    try {
      do {
        const len = Math.min(chunk, entry.size - offset)
        const buf = Buffer.alloc(len)
        await fh.read(buf, 0, len, offset)
        const r = await this.check(await this.req(`/sync/file?${q}&offset=${offset}`, { method: 'PUT', body: buf, timeout: 120000 }))
        const j = (await r.json()) as { status: string; received?: number; current?: string }
        if (j.status === 'conflict') return { conflict: j.current ?? '' }
        if (j.status === 'offset') { offset = j.received ?? 0; continue }
        if (j.status === 'ok') return { ok: true }
        offset = j.received ?? offset + len
      } while (offset < entry.size || entry.size === 0)
      return { ok: true }
    } finally { await fh.close() }
  }
  async remove(path: string, base: string): Promise<{ ok: true } | { conflict: string }> {
    const r = await this.check(await this.req(`/sync/file?path=${encodeURIComponent(path)}&base=${base}`, { method: 'DELETE' }))
    const j = (await r.json()) as { status: string; current?: string }
    return j.status === 'conflict' ? { conflict: j.current ?? '' } : { ok: true }
  }
}

