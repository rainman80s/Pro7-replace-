/**
 * Version history: snapshots of presentations / playlists / docs in <workspace>/.history/<path>/<stamp>.<ext>.
 * Also where sync keeps every version it replaces or deletes, so nothing is ever silently lost.
 */
import { promises as fs } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import type { HistoryEntry } from '@shared/integrations'

export const HISTORY_DIR = '.history'
const stamp = (d = new Date()): string => d.toISOString().replace(/[:.]/g, '-')

export async function snapshot(root: string, rel: string, reason = 'edit', opts: { keep?: number; minGapMs?: number; data?: Buffer } = {}): Promise<string | null> {
  const src = join(root, ...rel.split('/'))
  let data: Buffer
  try { data = opts.data ?? (await fs.readFile(src)) } catch { return null }
  const dir = join(root, HISTORY_DIR, ...rel.split('/'))
  await fs.mkdir(dir, { recursive: true })
  const existing = (await fs.readdir(dir).catch(() => [])).filter((f) => !f.endsWith('.json.meta')).sort()
  const last = existing[existing.length - 1]
  if (last) {
    const prev = await fs.readFile(join(dir, last)).catch(() => null)
    if (prev && prev.equals(data)) return null
    const lastAt = Date.parse(last.slice(0, 24).replace(/^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z.*/, '$1T$2:$3:$4.$5Z'))
    if (opts.minGapMs && reason === 'edit' && Date.now() - lastAt < opts.minGapMs) {
      // Too soon after the last snapshot: refresh it instead of piling up versions while someone types.
      await fs.writeFile(join(dir, last), data)
      return join(dir, last)
    }
  }
  const name = `${stamp()}~${reason.replace(/[^a-z0-9-]/gi, '')}${extname(rel) || '.bin'}`
  await fs.writeFile(join(dir, name), data)
  const keep = opts.keep ?? 60
  for (const old of existing.slice(0, Math.max(0, existing.length + 1 - keep))) await fs.rm(join(dir, old), { force: true })
  return join(dir, name)
}

export async function listHistory(root: string, rel: string): Promise<HistoryEntry[]> {
  const dir = join(root, HISTORY_DIR, ...rel.split('/'))
  const files = (await fs.readdir(dir).catch(() => [])).sort().reverse()
  const out: HistoryEntry[] = []
  for (const f of files) {
    const st = await fs.stat(join(dir, f)).catch(() => null)
    if (!st) continue
    const m = /^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z~?([a-z0-9-]*)/i.exec(f)
    const at = m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : st.mtime.toISOString()
    const e: HistoryEntry = { id: f, at, size: st.size, reason: m?.[6] || undefined }
    if (f.endsWith('.reach') || f.endsWith('.json')) {
      try { const j = JSON.parse(await fs.readFile(join(dir, f), 'utf8')); e.title = j.title ?? j.name; e.slideCount = Array.isArray(j.slides) ? j.slides.length : Array.isArray(j.items) ? j.items.length : undefined } catch { /* not json */ }
    }
    out.push(e)
  }
  return out
}

/** Restore a version (the current file is snapshotted first, so restore is itself undoable). */
export async function restoreHistory(root: string, rel: string, id: string): Promise<Buffer> {
  if (id.includes('/') || id.includes('\\') || id.includes('..')) throw new Error('Bad version id')
  const data = await fs.readFile(join(root, HISTORY_DIR, ...rel.split('/'), id))
  await snapshot(root, rel, 'before-restore')
  const dest = join(root, ...rel.split('/'))
  await fs.mkdir(dirname(dest), { recursive: true })
  const tmp = `${dest}.${Date.now()}.tmp`
  await fs.writeFile(tmp, data)
  await fs.rename(tmp, dest)
  return data
}

/** Keep a copy of a losing version somewhere visible. */
export async function keepConflict(root: string, rel: string, data: Buffer, who: string): Promise<string> {
  const dir = join(root, HISTORY_DIR, 'conflicts', ...dirname(rel).split('/').filter((x) => x && x !== '.'))
  await fs.mkdir(dir, { recursive: true })
  const base = rel.split('/').pop()!
  const ext = extname(base)
  const name = `${base.slice(0, base.length - ext.length)} (${who.replace(/[^\w .-]/g, '')} ${stamp()})${ext}`
  await fs.writeFile(join(dir, name), data)
  return `${HISTORY_DIR}/conflicts/${[...dirname(rel).split('/').filter((x) => x && x !== '.'), name].join('/')}`
}
