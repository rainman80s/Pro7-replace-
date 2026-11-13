/** .reachbundle → workspace (presentations, playlists, media, themes). Paths inside the zip are untrusted. */
import type { Playlist, Presentation, Theme } from '@shared/model'
import type { FileReport } from '@shared/import'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { readZip, safeEntryPath } from '../importers/util/zip'
import { mediaItemFor, type ImportTarget } from '../importers/pipeline/target'
import type { BundleManifest } from './formats'

const exists = (p: string): Promise<boolean> => fs.stat(p).then(() => true, () => false)
const sha = (b: Uint8Array): string => createHash('sha1').update(b).digest('hex')

export async function importReachBundle(bytes: Uint8Array, target: ImportTarget, path: string): Promise<{ reports: FileReport[]; presentationIds: string[]; playlistIds: string[] }> {
  const zip = readZip(bytes)
  const entries = new Map<string, Uint8Array>()
  for (const e of zip.entries) { const s = safeEntryPath(e.name); if (s) try { entries.set(s, e.read()) } catch { /* skip */ } }
  const mf = entries.get('manifest.json')
  if (!mf) throw new Error('not a Reach bundle (no manifest.json)')
  const manifest = JSON.parse(Buffer.from(mf).toString('utf8')) as BundleManifest
  if (manifest.format !== 'reachbundle') throw new Error('not a Reach bundle')
  const warnings: string[] = []
  if (manifest.version > 1) warnings.push(`bundle version ${manifest.version} is newer than this app understands (1); importing what it can`)
  // media first: same relative path; if a DIFFERENT file already sits there, store beside it and rewrite refs
  const rewrite = new Map<string, string>()
  const items = []
  for (const m of manifest.media ?? []) {
    const data = entries.get(safeEntryPath(m.file) ?? '')
    const rel = safeEntryPath(m.src.replace(/^workspace:/, ''))
    if (!data || !rel || !target.mediaDir) continue
    let dest = join(target.mediaDir, ...rel.split('/'))
    let finalRel = rel
    if (await exists(dest)) {
      if (sha(await fs.readFile(dest)) !== sha(data)) {
        finalRel = rel.replace(/(\.[^./]+)?$/, (ext) => `-${sha(data).slice(0, 6)}${ext}`)
        dest = join(target.mediaDir, ...finalRel.split('/'))
      }
    }
    if (!(await exists(dest))) { await fs.mkdir(dirname(dest), { recursive: true }); target.markOwnWrite?.(dest); await fs.writeFile(dest, data) }
    if (finalRel !== rel) rewrite.set(m.src, `workspace:${finalRel}`)
    const it = mediaItemFor(finalRel, finalRel.split('/').pop()!.replace(/\.[^.]+$/, ''))
    if (it) items.push(it)
  }
  if (items.length) await target.addMedia(items)
  const fix = <T>(v: T): T => (rewrite.size ? JSON.parse(JSON.stringify(v), (_k, x) => (typeof x === 'string' && rewrite.has(x) ? rewrite.get(x) : x)) : v)
  const reports: FileReport[] = []
  const presentationIds: string[] = []
  const toSave: Presentation[] = []
  for (const p of manifest.presentations ?? []) {
    const data = entries.get(safeEntryPath(p.file) ?? '')
    if (!data) continue
    const pres = fix(JSON.parse(Buffer.from(data).toString('utf8')) as Presentation)
    const existing = await target.getPresentation(pres.id)
    let status: FileReport['status'] = existing ? 'updated' : 'imported'
    if (existing && existing.updatedAt >= pres.updatedAt) status = 'unchanged'
    if (status !== 'unchanged') toSave.push(pres)
    presentationIds.push(pres.id)
    reports.push({ path: `${path}#${p.file}`, format: 'reach-bundle', status, title: pres.title, presentationId: pres.id, warnings: status === 'unchanged' ? ['this computer already has the same or a newer version'] : [] })
  }
  await target.savePresentations(toSave)
  const playlistIds: string[] = []
  for (const p of manifest.playlists ?? []) {
    const data = entries.get(safeEntryPath(p.file) ?? '')
    if (!data) continue
    const pl = fix(JSON.parse(Buffer.from(data).toString('utf8')) as Playlist)
    await target.savePlaylist(pl)
    playlistIds.push(pl.id)
  }
  if (manifest.themes && entries.has(manifest.themes)) {
    const themes = JSON.parse(Buffer.from(entries.get(manifest.themes)!).toString('utf8')) as Theme[]
    const cur = await target.readDoc<Theme[]>('themes', [])
    for (const t of themes) if (!cur.some((c) => c.id === t.id)) cur.push(fix(t))
    await target.writeDoc('themes', cur)
  }
  if (warnings.length && reports[0]) reports[0].warnings.push(...warnings)
  if (manifest.missingMedia?.length && reports[0]) reports[0].warnings.push(`the sending computer was missing ${manifest.missingMedia.length} media files`)
  return { reports, presentationIds, playlistIds }
}
