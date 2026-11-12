/**
 * Shared renderer state. Everything here mirrors main-process state and stays in
 * sync through events, so any feature can just `useLive()` / `useWorkspace()`.
 */
import { create } from 'zustand'
import { getApi } from '@shared/client'
import type { DisplayInfo, PresentationSummary } from '@shared/api'
import type { ID, LiveState, MediaItem, Output, Playlist, Presentation, WorkspaceConfig } from '@shared/model'
import { emptyLiveState } from '@shared/model'

export const api = getApi()

interface AppState {
  ready: boolean
  live: LiveState
  workspace: WorkspaceConfig | null
  library: PresentationSummary[]
  playlists: Playlist[]
  media: MediaItem[]
  outputs: Output[]
  displays: DisplayInfo[]
  /** Navigation + selection (UI only). */
  view: string
  selectedPlaylistId: ID | null
  selectedPlaylistItemId: ID | null
  selectedPresentationId: ID | null
  /** Cache of opened presentations. */
  presentations: Record<ID, Presentation>
  setView(view: string): void
  select(sel: Partial<Pick<AppState, 'selectedPlaylistId' | 'selectedPlaylistItemId' | 'selectedPresentationId'>>): void
  loadPresentation(id: ID, force?: boolean): Promise<Presentation | null>
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  live: emptyLiveState(),
  workspace: null,
  library: [],
  playlists: [],
  media: [],
  outputs: [],
  displays: [],
  view: localStorage.getItem('reach.view') ?? 'show',
  selectedPlaylistId: null,
  selectedPlaylistItemId: null,
  selectedPresentationId: null,
  presentations: {},
  setView(view) {
    localStorage.setItem('reach.view', view)
    set({ view })
  },
  select(sel) {
    set(sel)
  },
  async loadPresentation(id, force) {
    const cached = get().presentations[id]
    if (cached && !force) return cached
    const p = await api.invoke('library.get', { id })
    if (p) set((s) => ({ presentations: { ...s.presentations, [id]: p } }))
    return p
  }
}))

export const useLive = (): LiveState => useApp((s) => s.live)
export const useWorkspace = (): WorkspaceConfig | null => useApp((s) => s.workspace)

/** Open a presentation in the editor / show grid from anywhere. */
export function openPresentation(id: ID, view?: string): void {
  useApp.getState().select({ selectedPresentationId: id })
  if (view) useApp.getState().setView(view)
}

let started = false
export async function startSync(): Promise<void> {
  if (started) return
  started = true
  const set = useApp.setState
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback)
  const refreshLibrary = async (): Promise<void> => set({ library: await safe(api.invoke('library.list'), []) })
  const refreshPlaylists = async (): Promise<void> => set({ playlists: await safe(api.invoke('playlists.list'), []) })
  const refreshMedia = async (): Promise<void> => set({ media: await safe(api.invoke('media.list'), []) })

  api.on('live.changed', (live) => set({ live }))
  api.on('workspace.changed', (workspace) => set({ workspace }))
  api.on('outputs.changed', (outputs) => { set({ outputs }); void safe(api.invoke('outputs.displays'), []).then((displays) => set({ displays })) })
  api.on('outputs.displaysChanged', (displays) => set({ displays }))
  api.on('media.changed', () => void refreshMedia())
  api.on('playlists.changed', () => void refreshPlaylists())
  api.on('library.changed', ({ ids }) => {
    void refreshLibrary()
    // Refresh any open presentations that changed (another computer / cloud sync / import).
    const open = useApp.getState().presentations
    for (const id of ids ?? Object.keys(open)) if (open[id]) void useApp.getState().loadPresentation(id, true)
  })

  const [live, workspace, outputs, displays] = await Promise.all([
    safe(api.invoke('live.get'), emptyLiveState()),
    safe(api.invoke('workspace.get'), null),
    safe(api.invoke('outputs.list'), []),
    safe(api.invoke('outputs.displays'), [])
  ])
  set({ live, workspace, outputs, displays })
  await Promise.all([refreshLibrary(), refreshPlaylists(), refreshMedia()])
  const pl = useApp.getState().playlists[0]
  if (pl && !useApp.getState().selectedPlaylistId) set({ selectedPlaylistId: pl.id })
  set({ ready: true })
}

/** Synced JSON doc (themes, macros, stageLayouts...) as a hook-friendly loader. */
export async function readDoc<T>(name: string, fallback: T): Promise<T> {
  const v = await api.invoke('workspace.readDoc', { name }).catch(() => null)
  return (v as T) ?? fallback
}
export const writeDoc = (name: string, value: unknown): Promise<void> => api.invoke('workspace.writeDoc', { name, value })
