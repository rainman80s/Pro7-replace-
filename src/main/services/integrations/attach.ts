/** Shared helpers: download remote media into the workspace, apply themes, attach a presentation to a service plan placeholder. */
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import type { ID, MediaRef, Playlist, PlaylistItem, Presentation, Slide, Theme } from '@shared/model'
import { pcoSource } from '@shared/integrations'
import { applyTheme } from '@shared/integrationsTheme'
import type { ServiceContext } from '../../core/service'

const EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/heic': '.heic', 'image/svg+xml': '.svg', 'video/mp4': '.mp4', 'video/quicktime': '.mov' }

/**
 * Save remote bytes as workspace media (so every synced computer has them and expiring URLs don't matter).
 * `stableName` makes re-imports reuse the same file. HEIC is converted to JPEG on macOS (Chromium can't show HEIC).
 */
export async function saveRemoteMedia(ctx: ServiceContext, folder: string, stableName: string, fetchBytes: () => Promise<{ data: Buffer; contentType: string }>, opts: { name?: string; ext?: string; refresh?: boolean } = {}): Promise<MediaRef> {
  const dir = join(ctx.workspace.mediaDir, folder)
  await fs.mkdir(dir, { recursive: true })
  const existing = (await fs.readdir(dir).catch(() => [])).find((f) => f.startsWith(stableName + '.'))
  let path = existing ? join(dir, existing) : ''
  if (!existing || opts.refresh) {
    const { data, contentType } = await fetchBytes()
    let ext = EXT[contentType.split(';')[0].trim()] ?? opts.ext ?? '.png'
    if (!ext.startsWith('.')) ext = '.' + ext
    path = join(dir, stableName + ext)
    ctx.workspace.markOwnWrite(path)
    const tmp = path + '.part'
    await fs.writeFile(tmp, data)
    await fs.rename(tmp, path)
    if (ext === '.heic' && process.platform === 'darwin') {
      const jpg = join(dir, stableName + '.jpg')
      ctx.workspace.markOwnWrite(jpg)
      const ok = await new Promise<boolean>((r) => execFile('sips', ['-s', 'format', 'jpeg', path, '--out', jpg], (e) => r(!e)))
      if (ok) { await fs.rm(path, { force: true }); path = jpg }
    }
  }
  const [item] = await ctx.library.importMedia([path], folder)
  const kind = /\.(mp4|mov|webm|m4v)$/i.test(path) ? 'video' : 'image'
  return { id: item?.id, kind: item?.kind ?? kind, src: item?.src ?? 'workspace:' + [folder, path.split(/[\\/]/).pop()].join('/'), name: opts.name ?? item?.name }
}

export async function themeById(ctx: ServiceContext, id?: ID): Promise<Theme | null> {
  if (!id) return null
  const themes = await ctx.workspace.readDoc<Theme[] | { themes?: Theme[] }>('themes', [])
  const list = Array.isArray(themes) ? themes : themes?.themes ?? []
  return list.find((t) => t.id === id) ?? null
}

export const themed = (slides: Slide[], theme: Theme | null, hint?: string): Slide[] => (theme ? slides.map((s) => applyTheme(s, theme, hint)) : slides)

/**
 * Put a presentation into the service plan for `date`: replaces the matching placeholder
 * (keeping its id so Planning Center re-sync still recognises it, plus its length/people/notes),
 * or updates an item already pointing at the presentation. Returns where it went.
 */
export async function attachToPlaylist(ctx: ServiceContext, p: Presentation, kind: 'sermon' | 'announcements' | 'figma', opts: { date?: string; playlistId?: ID; itemId?: ID; append?: boolean }): Promise<{ playlistId: ID; itemId: ID; playlistName: string } | null> {
  const lib = ctx.library
  let pl: Playlist | null = opts.playlistId ? lib.getPlaylist(opts.playlistId) : null
  if (!pl && opts.date) {
    const sameDay = lib.listPlaylists().filter((x) => x.date?.slice(0, 10) === opts.date)
    pl = sameDay.find((x) => pcoSource(x)) ?? sameDay[0] ?? null
  }
  if (!pl) return null
  const items = [...pl.items]
  let idx = opts.itemId ? items.findIndex((i) => i.id === opts.itemId) : -1
  if (idx < 0) idx = items.findIndex((i) => i.type === 'presentation' && i.presentationId === p.id)
  if (idx < 0) {
    const src = pcoSource(pl)
    const want = kind === 'sermon' ? /sermon|message|teaching/i : /announce|highlight/i
    idx = items.findIndex((i) => i.type === 'placeholder' && (src?.origins[i.id]?.kind === kind || want.test(i.title) || want.test(i.hint ?? '')))
  }
  let item: PlaylistItem
  if (idx >= 0) {
    const old = items[idx]
    const keep = old.type === 'placeholder' || old.type === 'presentation' ? old : null
    item = { id: old.id, type: 'presentation', presentationId: p.id, title: keep?.title ?? p.title, ...(keep?.length ? { length: keep.length } : {}), ...(keep?.notes ? { notes: keep.notes } : {}), ...(keep?.people ? { people: keep.people } : {}) }
    items[idx] = item
  } else if (opts.append !== false) {
    item = { id: Math.random().toString(16).slice(2, 18), type: 'presentation', presentationId: p.id, title: p.title }
    items.push(item)
  } else return null
  await lib.savePlaylist({ ...pl, items })
  return { playlistId: pl.id, itemId: item.id, playlistName: pl.name }
}
