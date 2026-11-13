/** Workspace file manifests: what files exist, their content hash, size and mtime. Pure Node (testable). */
import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { join, relative, sep } from 'node:path'

export interface FileEntry { hash: string; size: number; mtime: number }
export type Manifest = Record<string, FileEntry>

/** Paths that never sync: dot-folders (.history, .sync-*, .DS_Store), temp/partial files, cloud placeholders. */
export function isSyncable(rel: string): boolean {
  if (!rel || rel.split('/').some((s) => s.startsWith('.') || s === '' || s === 'node_modules')) return false
  if (/\.(tmp|part|crdownload|download|icloud)$/i.test(rel)) return false
  if (/~\$|\.~lock\.|Thumbs\.db$|desktop\.ini$/i.test(rel)) return false
  return true
}

export const toRel = (root: string, abs: string): string => relative(root, abs).split(sep).join('/')
export const toAbs = (root: string, rel: string): string => {
  const parts = rel.split('/')
  if (parts.some((p) => p === '..' || p === '' || p.includes('\\') || p.includes('\0')) || !isSyncable(rel)) throw new Error(`Refusing unsafe path: ${rel}`)
  return join(root, ...parts)
}

export async function hashFile(abs: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(abs).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex').slice(0, 32))).on('error', reject)
  })
}

export type HashCache = Map<string, FileEntry>

/** Walk the workspace. Unchanged files (same size + mtime) reuse the cached hash, so rescans are cheap. */
export async function scan(root: string, cache: HashCache = new Map(), opts: { onPlaceholder?: (rel: string) => void } = {}): Promise<Manifest> {
  const out: Manifest = {}
  const walk = async (dir: string): Promise<void> => {
    let entries: import('node:fs').Dirent[]
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const abs = join(dir, e.name)
      const rel = toRel(root, abs)
      if (e.name.endsWith('.icloud') && e.name.startsWith('.')) { opts.onPlaceholder?.(toRel(root, join(dir, e.name.slice(1, -7)))); continue }
      if (e.isDirectory()) { if (isSyncable(rel)) await walk(abs); continue }
      if (!e.isFile() || !isSyncable(rel)) continue
      let st: import('node:fs').Stats
      try { st = await fs.stat(abs) } catch { continue }
      // "Dataless" cloud placeholder (online-only file): has a size but no blocks on disk.
      if (st.size > 0 && st.blocks === 0 && process.platform !== 'win32') { opts.onPlaceholder?.(rel); continue }
      const mtime = Math.round(st.mtimeMs)
      const c = cache.get(rel)
      if (c && c.size === st.size && c.mtime === mtime) { out[rel] = c; continue }
      try {
        const entry = { hash: await hashFile(abs), size: st.size, mtime }
        cache.set(rel, entry)
        out[rel] = entry
      } catch { /* vanished mid-scan */ }
    }
  }
  await walk(root)
  for (const k of cache.keys()) if (!out[k]) cache.delete(k)
  return out
}

export const manifestEtag = (m: Manifest): string => createHash('sha1').update(JSON.stringify(Object.keys(m).sort().map((k) => [k, m[k].hash]))).digest('hex')
