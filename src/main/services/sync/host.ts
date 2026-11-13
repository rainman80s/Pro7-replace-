/**
 * Sync host: serves a workspace folder to other Reach computers over the existing HTTP server
 * (routes under /sync/). Auth = the remote-control PIN in the `x-reach-pin` header. Pure Node.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createReadStream, promises as fs } from 'node:fs'
import { createHash, timingSafeEqual } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { SyncPeer } from '@shared/integrations'
import { hashFile, manifestEtag, scan, toAbs, type HashCache } from './manifest'
import { snapshot } from './history'

export interface HostOptions {
  root: () => string
  pin: () => string
  name: () => string
  enabled: () => boolean
  /** Called after a replica changed a file here (path, 'put' | 'delete'). */
  onChange?: (path: string, op: 'put' | 'delete') => void
  peers?: Map<string, SyncPeer>
  self?: () => SyncPeer
}

const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}
const eq = (a: string, b: string): boolean => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }
async function readBody(req: IncomingMessage, limit = 64 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = []
  let n = 0
  for await (const c of req) { n += (c as Buffer).length; if (n > limit) throw new Error('Body too large'); chunks.push(c as Buffer) }
  return Buffer.concat(chunks)
}

export function createSyncHost(o: HostOptions): (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean> {
  const cache: HashCache = new Map()
  const locks = new Map<string, Promise<void>>()
  const peers = o.peers ?? new Map<string, SyncPeer>()
  const withLock = async <T>(path: string, fn: () => Promise<T>): Promise<T> => {
    const prev = locks.get(path) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>((r) => (release = r))
    locks.set(path, prev.then(() => next))
    await prev
    try { return await fn() } finally { release(); if (locks.get(path) === next) locks.delete(path) }
  }
  const current = async (abs: string): Promise<string | null> => (await fs.stat(abs).catch(() => null)) ? hashFile(abs) : null

  return async (req, res, url) => {
    if (!url.pathname.startsWith('/sync/')) return false
    if (!o.enabled()) { send(res, 404, { error: 'This computer is not sharing its workspace.' }); return true }
    if (!eq(String(req.headers['x-reach-pin'] ?? ''), o.pin())) { send(res, 401, { error: 'Wrong PIN' }); return true }
    const root = o.root()
    const op = url.pathname.slice('/sync/'.length)
    try {
      if (op === 'hello') { send(res, 200, { ok: true, name: o.name(), protocol: 1 }); return true }
      if (op === 'manifest') {
        const files = await scan(root, cache)
        const etag = manifestEtag(files)
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag }); res.end(); return true }
        send(res, 200, { files, etag }, { etag })
        return true
      }
      if (op === 'presence' && req.method === 'POST') {
        const p = JSON.parse((await readBody(req, 65536)).toString()) as SyncPeer
        peers.set(p.id, { ...p, lastSeen: Date.now() })
        const live = [...peers.values()].filter((x) => Date.now() - x.lastSeen < 45_000)
        send(res, 200, { peers: [...(o.self ? [{ ...o.self(), host: true }] : []), ...live] })
        return true
      }
      const path = url.searchParams.get('path') ?? ''
      const abs = toAbs(root, path)
      if (op === 'file' && req.method === 'GET') {
        const st = await fs.stat(abs).catch(() => null)
        if (!st?.isFile()) { send(res, 404, { error: 'missing' }); return true }
        const m = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''))
        const start = m ? Number(m[1]) : 0
        const end = m && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1
        if (start > end && st.size > 0) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); res.end(); return true }
        res.writeHead(m ? 206 : 200, { 'content-type': 'application/octet-stream', 'content-length': String(Math.max(0, end - start + 1)), ...(m ? { 'content-range': `bytes ${start}-${end}/${st.size}` } : {}) })
        if (st.size === 0) { res.end(); return true }
        createReadStream(abs, { start, end }).pipe(res)
        return true
      }
      const upId = (hash: string): string => join(root, '.sync-uploads', createHash('sha1').update(path + hash).digest('hex') + '.part')
      if (op === 'upload' && req.method === 'GET') {
        const st = await fs.stat(upId(url.searchParams.get('hash') ?? '')).catch(() => null)
        send(res, 200, { received: st?.size ?? 0 })
        return true
      }
      if (op === 'file' && req.method === 'PUT') {
        const hash = url.searchParams.get('hash') ?? ''
        const base = url.searchParams.get('base') ?? ''
        const size = Number(url.searchParams.get('size') ?? 0)
        const offset = Number(url.searchParams.get('offset') ?? 0)
        const force = url.searchParams.get('force') === '1'
        const part = upId(hash)
        await fs.mkdir(dirname(part), { recursive: true })
        const have = (await fs.stat(part).catch(() => null))?.size ?? 0
        if (offset !== have && !(offset === 0)) { send(res, 409, { status: 'offset', received: have }); return true }
        const body = await readBody(req)
        if (offset === 0) await fs.writeFile(part, body)
        else await fs.appendFile(part, body)
        const got = offset + body.length
        if (got < size) { send(res, 200, { status: 'partial', received: got }); return true }
        return await withLock(path, async () => {
          if ((await hashFile(part)) !== hash) { await fs.rm(part, { force: true }); send(res, 422, { status: 'corrupt' }); return true }
          const cur = await current(abs)
          if (cur === hash) { await fs.rm(part, { force: true }); send(res, 200, { status: 'ok' }); return true }
          if (cur && cur !== base && !force) { await fs.rm(part, { force: true }); send(res, 409, { status: 'conflict', current: cur }); return true }
          if (cur) await snapshot(root, path, 'sync', { keep: 30 })
          await fs.mkdir(dirname(abs), { recursive: true })
          await fs.rename(part, abs)
          o.onChange?.(path, 'put')
          send(res, 200, { status: 'ok' })
          return true
        })
      }
      if (op === 'file' && req.method === 'DELETE') {
        const base = url.searchParams.get('base') ?? ''
        return await withLock(path, async () => {
          const cur = await current(abs)
          if (!cur) { send(res, 200, { status: 'ok' }); return true }
          if (cur !== base) { send(res, 409, { status: 'conflict', current: cur }); return true }
          await snapshot(root, path, 'deleted', { keep: 30 })
          await fs.rm(abs, { force: true })
          o.onChange?.(path, 'delete')
          send(res, 200, { status: 'ok' })
          return true
        })
      }
      send(res, 404, { error: 'unknown' })
    } catch (e) {
      send(res, 400, { error: e instanceof Error ? e.message : String(e) })
    }
    return true
  }
}
