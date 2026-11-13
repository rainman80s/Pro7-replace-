import type { Playlist, PlaylistItem } from '@shared/model'
import { cssColor, idFromUuid, uuidOf, type PB } from './proto'
import type { ConvertContext } from './context'
import { convertAction } from './actions'
import { parsePP7Url } from './url'
import type { PP7Url } from './context'

export interface PlaylistConvertOptions {
  /** Map a playlist item's document path (and display name) to an imported presentation id. */
  resolvePresentation(url: PP7Url | null, name: string): string | undefined
  source?: string
}

export interface ConvertedPlaylists {
  playlists: (Playlist & { ext?: Record<string, unknown> })[]
  unresolved: { playlist: string; item: string; path?: string }[]
}

/**
 * rv.data.PlaylistDocument (Playlists/Library, .proplaylist `data`) → Reach playlists.
 * Folders (TYPE_GROUP) are flattened: each playlist keeps its folder path in `folder` ("2024 / Easter").
 */
export function convertPlaylistDocument(doc: PB, ctx: ConvertContext, opts: PlaylistConvertOptions): ConvertedPlaylists {
  const out: ConvertedPlaylists = { playlists: [], unresolved: [] }
  const root: PB = doc.root_node ?? doc
  const visit = (node: PB, path: string[], depth: number): void => {
    if (depth > 32) return
    const children: PB[] = node.playlists?.playlists ?? node.children ?? []
    if (node.items) {
      out.playlists.push(convertOne(node, path, ctx, opts, out))
      return
    }
    const isRoot = depth === 0 || node.type === 'TYPE_ROOT'
    const here = isRoot || !node.name ? path : [...path, node.name]
    if (node.type === 'TYPE_SMART') ctx.note('playlist.smartFolder')
    if (!children.length && node.type === 'TYPE_PLAYLIST' && !isRoot) out.playlists.push(convertOne(node, path, ctx, opts, out))
    for (const c of children) visit(c, here, depth + 1)
  }
  visit(root, [], 0)
  return out
}

function convertOne(node: PB, folderPath: string[], ctx: ConvertContext, opts: PlaylistConvertOptions, out: ConvertedPlaylists): Playlist & { ext?: Record<string, unknown> } {
  const name: string = node.name || 'Playlist'
  const items: PlaylistItem[] = []
  for (const it of (node.items?.items ?? []) as PB[]) {
    const id = idFromUuid(it.uuid, ctx.newId)
    const title: string = it.name ?? ''
    if (it.header) {
      items.push({ id, type: 'header', title: title || 'Section', color: cssColor(it.header.color) })
    } else if (it.presentation) {
      const url = parsePP7Url(it.presentation.document_path)
      const pid = opts.resolvePresentation(url, title)
      if (pid) {
        const item: PlaylistItem = { id, type: 'presentation', presentationId: pid }
        if (title) item.title = title
        const arr = idFromUuid(it.presentation.arrangement, () => '')
        if (arr) item.arrangementId = arr
        items.push(item)
      } else {
        out.unresolved.push({ playlist: name, item: title, path: url?.absolute ?? url?.relative })
        items.push({ id, type: 'placeholder', title: title || 'Missing presentation', hint: `Not found: ${url?.basename ?? title}` })
      }
    } else if (it.cue) {
      const media = ((it.cue.actions ?? []) as PB[]).map((a) => convertAction(a, ctx, `playlist "${name}" item "${title}"`)).find((a) => a?.type === 'media.play')
      const ref = media?.params?.media as import("@shared/model").MediaRef | undefined
      if (ref) items.push({ id, type: 'media', media: ref, title: title || undefined })
      else { items.push({ id, type: 'placeholder', title: title || 'Cue', hint: 'ProPresenter cue (not imported)' }); ctx.note('playlist.cueItem') }
    } else if (it.planning_center) {
      const linked = it.planning_center.linked_data
      const pid = linked?.presentation ? opts.resolvePresentation(parsePP7Url(linked.presentation.document_path), linked.name ?? title) : undefined
      if (pid) items.push({ id, type: 'presentation', presentationId: pid, title: title || undefined })
      else items.push({ id, type: 'placeholder', title: title || 'Planning Center item', hint: 'Planning Center item' })
      ctx.note('playlist.planningCenterItem')
    } else if (it.placeholder) {
      const linked = it.placeholder.linked_data
      const pid = linked?.presentation ? opts.resolvePresentation(parsePP7Url(linked.presentation.document_path), linked.name ?? title) : undefined
      if (pid) items.push({ id, type: 'presentation', presentationId: pid, title: title || undefined })
      else items.push({ id, type: 'placeholder', title: title || 'Placeholder' })
    } else {
      ctx.note('playlist.unknownItem')
    }
  }
  const pl: Playlist & { ext?: Record<string, unknown> } = {
    id: idFromUuid(node.uuid, ctx.newId), name, items, updatedAt: new Date().toISOString(),
    source: { type: 'propresenter7', ref: opts.source, uuid: uuidOf(node.uuid) || undefined, syncedAt: new Date().toISOString() }
  }
  if (folderPath.length) pl.folder = folderPath.join(' / ')
  const m = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(name)
  if (m) pl.date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  if (node.pco_plan) { pl.source = { ...pl.source!, pcoPlan: { id: node.pco_plan.plan_id ?? undefined, service: node.pco_plan.service_type_id ?? undefined } }; ctx.note('playlist.pcoLinked') }
  return pl
}
