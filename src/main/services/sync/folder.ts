/**
 * "Put the workspace in iCloud Drive / Dropbox / Google Drive / OneDrive / Syncthing / a NAS":
 * provider detection, conflict-copy detection & resolution, placeholder detection. Pure Node.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { CloudStatus, SyncConflict } from '@shared/integrations'
import { isSyncable, toRel } from './manifest'
import { keepConflict } from './history'

export function detectProvider(path: string): CloudStatus['provider'] {
  const p = path.replace(/\\/g, '/')
  if (/Mobile Documents\/com~apple~CloudDocs|\/iCloud Drive\b|iCloudDrive/i.test(p)) return 'icloud'
  if (/\/Dropbox( \([^)]*\))?(\/|$)|CloudStorage\/Dropbox/i.test(p)) return 'dropbox'
  if (/Google ?Drive|CloudStorage\/GoogleDrive|\/My Drive(\/|$)/i.test(p)) return 'gdrive'
  if (/OneDrive/i.test(p)) return 'onedrive'
  if (/^\/Volumes\/(?!Macintosh HD)|^\/\/|^[A-Z]:\/\/|^\/mnt\/|^\/media\//i.test(p) || path.startsWith('\\\\')) return 'network'
  return null
}

export async function isSyncthing(root: string): Promise<boolean> {
  return !!(await fs.stat(join(root, '.stfolder')).catch(() => null))
}

/** Conflict-copy names, per provider. Returns the original name if `name` is a conflict copy. */
export function originalOf(name: string): string | null {
  const m =
    /^(.*?) \([^()]*conflicted copy[^()]*\)(\.[^.]+)$/i.exec(name) ?? // Dropbox
    /^(.*?)\.sync-conflict-\d{8}-\d{6}(?:-[A-Z0-9]+)?(\.[^.]+)$/.exec(name) ?? // Syncthing
    /^(.*?)-(?:[A-Z0-9][A-Z0-9-]{1,14})(\.(?:reach|json))$/.exec(name) ?? // OneDrive "name-MACHINE.ext"
    /^(.*?) (?:\d)(\.(?:reach|json))$/.exec(name) ?? // iCloud "name 2.ext"
    /^(.*?) \(\d\)(\.(?:reach|json))$/.exec(name) ?? // Google Drive "name (1).ext"
    /^(.*?) \((?:Conflict|conflict)[^()]*\)(\.[^.]+)$/.exec(name) // generic
  return m ? m[1] + m[2] : null
}

export interface ConflictCopy { copy: string; original: string }

/** Find conflict copies whose original exists. For JSON files the copy must also have the same `id` (strong signal). */
export async function findConflictCopies(root: string): Promise<ConflictCopy[]> {
  const out: ConflictCopy[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const abs = join(dir, e.name)
      const rel = toRel(root, abs)
      if (e.isDirectory()) { if (isSyncable(rel)) await walk(abs); continue }
      if (!isSyncable(rel)) continue
      const orig = originalOf(e.name)
      if (!orig) continue
      const origAbs = join(dir, orig)
      if (!(await fs.stat(origAbs).catch(() => null))) continue
      if (/\.(reach|json)$/.test(e.name)) {
        try {
          const a = JSON.parse(await fs.readFile(abs, 'utf8')), b = JSON.parse(await fs.readFile(origAbs, 'utf8'))
          if (a?.id !== undefined && b?.id !== undefined && a.id !== b.id) continue
        } catch { /* half-synced or not JSON: still a copy by name */ }
      }
      out.push({ copy: rel, original: toRel(root, origAbs) })
    }
  }
  await walk(root)
  return out
}

/**
 * Resolve one conflict copy: last writer wins (by `updatedAt` inside JSON, else file mtime).
 * The loser is moved to .history/conflicts — nothing is deleted.
 */
export async function resolveConflictCopy(root: string, c: ConflictCopy): Promise<SyncConflict> {
  const absCopy = join(root, ...c.copy.split('/')), absOrig = join(root, ...c.original.split('/'))
  const [dc, dor] = await Promise.all([fs.readFile(absCopy), fs.readFile(absOrig)])
  const when = async (abs: string, data: Buffer): Promise<number> => {
    try { const t = Date.parse(JSON.parse(data.toString()).updatedAt); if (!isNaN(t)) return t } catch { /* not json */ }
    return (await fs.stat(abs)).mtimeMs
  }
  const at = new Date().toISOString()
  if (dc.equals(dor)) {
    await fs.rm(absCopy, { force: true })
    return { id: `${c.copy}@${at}`, path: c.original, at, backup: '', winner: 'original', reason: 'Identical duplicate removed.', resolved: true }
  }
  const copyNewer = (await when(absCopy, dc)) > (await when(absOrig, dor))
  let backup: string
  if (copyNewer) {
    backup = await keepConflict(root, c.original, dor, 'older')
    const tmp = absOrig + '.resolve.tmp'
    await fs.writeFile(tmp, dc)
    await fs.rename(tmp, absOrig)
    await fs.rm(absCopy, { force: true })
  } else {
    backup = await keepConflict(root, c.original, dc, 'older')
    await fs.rm(absCopy, { force: true })
  }
  return { id: `${c.copy}@${at}`, path: c.original, at, backup, winner: copyNewer ? 'copy' : 'original', reason: `Two computers saved this at once — kept the newest; the other is in ${backup}.` }
}
