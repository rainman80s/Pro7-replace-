/**
 * Everything the Show screen DOES: going live, stepping, clearing, and saving services.
 * Components call these; they read the latest state from the store so hotkeys, buttons and
 * quick search all behave identically.
 */
import { create } from 'zustand'
import type { ID, MediaRef, Playlist, PlaylistItem } from '@shared/model'
import { orderedSlides } from '@shared/model'
import { LOGO_SCREEN_DATA_URI, toast } from '@ui/index'
import { api, useApp } from '../../app/store'
import { adjacentPlayable, insertItem, itemTitle, presentationItem, removeItem } from './logic'

/* ───────────── Show-screen UI state (not persisted) ───────────── */

export type SearchMode = { kind: 'open' } | { kind: 'add'; index?: number } | { kind: 'replace'; itemId: ID }
interface ShowUi {
  searchMode: SearchMode
  detailsItemId: ID | null
  newSong: { addToService: boolean } | null
  openSearch(mode?: SearchMode): void
  set(patch: Partial<Pick<ShowUi, 'detailsItemId' | 'newSong'>>): void
}
export const useShowUi = create<ShowUi>((set) => ({
  searchMode: { kind: 'open' },
  detailsItemId: null,
  newSong: null,
  openSearch(mode = { kind: 'open' }) {
    set({ searchMode: mode })
    useApp.getState().setOverlay('search')
  },
  set
}))

const report = (what: string) => (e: unknown): void => toast(what, 'error', e instanceof Error ? e.message : String(e))

/* ───────────── current context ───────────── */

export function currentPlaylist(): Playlist | undefined {
  const s = useApp.getState()
  return s.playlists.find((p) => p.id === s.selectedPlaylistId)
}

/** The arrangement to use for a presentation when it's shown from a given service item. */
function arrangementFor(playlistId: ID | null | undefined, itemId: ID | null | undefined): ID | undefined {
  const it = useApp.getState().playlists.find((p) => p.id === playlistId)?.items.find((x) => x.id === itemId)
  return it?.type === 'presentation' ? it.arrangementId : undefined
}

/* ───────────── going live ───────────── */

/** Put slide `index` of a presentation on screen. Pass the service item it came from, if any. */
export function goToSlide(presentationId: ID, index: number, from?: { playlistId?: ID | null; itemId?: ID | null }): Promise<void> {
  const playlistId = from?.itemId ? from.playlistId ?? undefined : undefined
  return api.invoke('live.goToSlide', {
    presentationId, index,
    playlistId: playlistId ?? undefined,
    playlistItemId: from?.itemId ?? undefined,
    arrangementId: arrangementFor(playlistId, from?.itemId)
  }).then(() => undefined, report("Couldn't show that slide"))
}

/** Select a service item (shows its slides in the middle; does NOT put anything on screen). */
export function selectItem(item: PlaylistItem): void {
  useApp.getState().select({ selectedPlaylistItemId: item.id, selectedPresentationId: item.type === 'presentation' ? item.presentationId : null })
}

/** Select a library item that isn't part of the service. */
export function selectLibraryItem(presentationId: ID): void {
  useApp.getState().select({ selectedPresentationId: presentationId, selectedPlaylistItemId: null })
}

export function showMedia(media: MediaRef): Promise<void> {
  const layer = media.kind === 'audio' ? 'audio' : media.kind === 'video' ? 'video' : 'background'
  return api.invoke('live.setMedia', { layer, media, loop: media.kind === 'image' ? undefined : false, muted: false }).then(() => undefined, report("Couldn't play that"))
}

/** Start a service item from its first slide (or play it, for media) and select it. */
export async function startItem(item: PlaylistItem, playlistId: ID | null | undefined): Promise<void> {
  selectItem(item)
  if (item.type === 'presentation') await goToSlide(item.presentationId, 0, { playlistId, itemId: item.id })
  else if (item.type === 'media') await showMedia(item.media)
}

/**
 * The one "advance" action (Space / → / the Next button).
 *  - nothing on screen yet → start the selected item at its first slide
 *  - middle of an item → next slide (or next build)
 *  - last slide of a service item → first slide of the next item in the service
 */
export async function advance(): Promise<void> {
  const s = useApp.getState()
  const cur = s.live.slide
  if (!cur) {
    if (s.selectedPresentationId) await goToSlide(s.selectedPresentationId, 0, { playlistId: s.selectedPlaylistId, itemId: s.selectedPlaylistItemId })
    return
  }
  const maxBuild = Math.max(0, ...cur.slide.elements.map((e) => e.buildIn ?? 0))
  const atEnd = !cur.next && (cur.build ?? 0) >= maxBuild
  if (atEnd && cur.playlistItemId && s.prefs.autoContinue) {
    const playlist = s.playlists.find((p) => p.id === cur.playlistId)
    const next = adjacentPlayable(playlist, cur.playlistItemId, 1)
    if (next) return startItem(next, playlist?.id)
    toast("That's the last slide in the service", 'info')
    return
  }
  await api.invoke('live.next').then(() => undefined, report("Couldn't go to the next slide"))
}

/** Back one slide; from the first slide of a service item, back to the last slide of the item before it. */
export async function retreat(): Promise<void> {
  const s = useApp.getState()
  const cur = s.live.slide
  if (cur && cur.index === 0 && cur.playlistItemId && s.prefs.autoContinue) {
    const playlist = s.playlists.find((p) => p.id === cur.playlistId)
    const prev = adjacentPlayable(playlist, cur.playlistItemId, -1)
    if (prev?.type === 'presentation') {
      const p = await s.loadPresentation(prev.presentationId)
      if (p) {
        selectItem(prev)
        return goToSlide(p.id, Math.max(0, orderedSlides(p, prev.arrangementId).length - 1), { playlistId: playlist?.id, itemId: prev.id })
      }
    }
  }
  await api.invoke('live.prev').then(() => undefined, report("Couldn't go back"))
}

/** What pressing Next will do right now — used for the "Up next" card. */
export function peekNext(): { kind: 'slide' } | { kind: 'item'; item: PlaylistItem; title: string } | { kind: 'start' } | { kind: 'end' } | { kind: 'none' } {
  const s = useApp.getState()
  const cur = s.live.slide
  if (!cur) return s.selectedPresentationId ? { kind: 'start' } : { kind: 'none' }
  if (cur.next) return { kind: 'slide' }
  if (cur.playlistItemId && s.prefs.autoContinue) {
    const next = adjacentPlayable(s.playlists.find((p) => p.id === cur.playlistId), cur.playlistItemId, 1)
    if (next) return { kind: 'item', item: next, title: itemTitle(next, s.library) }
  }
  return { kind: 'end' }
}

/* ───────────── clearing ───────────── */

export const clearSlide = (): Promise<unknown> => api.invoke('live.clear', { layer: 'slide' }).catch(report("Couldn't clear the slide"))
export const clearAll = (): Promise<unknown> => api.invoke('live.clear', { layer: 'all' }).catch(report("Couldn't clear the screens"))
export async function clearMedia(): Promise<void> {
  try {
    await api.invoke('live.clear', { layer: 'video' })
    await api.invoke('live.clear', { layer: 'background' })
    await api.invoke('live.clear', { layer: 'audio' })
  } catch (e) { report("Couldn't clear the media")(e) }
}

export async function toggleLogo(): Promise<void> {
  const s = useApp.getState()
  try {
    // First use: fall back to the Reach logo so the button always does something sensible.
    if (!s.live.logo && !s.workspace?.logo) await api.invoke('workspace.update', { logo: { kind: 'image', src: LOGO_SCREEN_DATA_URI, name: 'Reach logo' } })
    await api.invoke('live.setFlag', { flag: 'logo', value: !s.live.logo })
  } catch (e) { report("Couldn't show the logo")(e) }
}
export const toggleBlackout = (): Promise<unknown> => api.invoke('live.setFlag', { flag: 'blackout', value: !useApp.getState().live.blackout }).catch(report("Couldn't black out the screens"))

/* ───────────── services ───────────── */

export async function savePlaylist(playlist: Playlist): Promise<Playlist | null> {
  // Optimistic: the list updates immediately, the file write follows.
  useApp.setState((s) => ({ playlists: s.playlists.some((p) => p.id === playlist.id) ? s.playlists.map((p) => (p.id === playlist.id ? playlist : p)) : [...s.playlists, playlist] }))
  try {
    return await api.invoke('playlists.save', { playlist })
  } catch (e) {
    report("Couldn't save the service")(e)
    return null
  }
}

/** Remove an item, with an Undo toast instead of an "are you sure?". */
export async function removeFromService(playlist: Playlist, itemId: ID): Promise<void> {
  const item = playlist.items.find((x) => x.id === itemId)
  if (!item) return
  const s = useApp.getState()
  if (s.selectedPlaylistItemId === itemId) s.select({ selectedPlaylistItemId: null })
  await savePlaylist(removeItem(playlist, itemId))
  toast(`Removed "${itemTitle(item, s.library)}" from the service`, 'info', undefined, {
    label: 'Undo',
    onClick: () => {
      const latest = useApp.getState().playlists.find((p) => p.id === playlist.id)
      if (latest && !latest.items.some((x) => x.id === itemId)) void savePlaylist(insertItem(latest, item, playlist.items.indexOf(item)))
    }
  })
}

export async function addPresentationToService(presentationId: ID, index?: number): Promise<void> {
  const playlist = currentPlaylist()
  if (!playlist) return void toast('Create a service first', 'warning')
  const item = presentationItem(presentationId)
  await savePlaylist(insertItem(playlist, item, index))
  toast(`Added "${itemTitle(item, useApp.getState().library)}" to ${playlist.name}`, 'success')
}
