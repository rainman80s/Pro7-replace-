/**
 * Typed RPC contract between the main process and every client
 * (operator window over IPC, output windows over IPC, browsers/TVs/phones over WebSocket).
 *
 * Features ADD their own methods/events by declaration merging from their own file:
 *
 *   declare module '@shared/api' {
 *     interface ApiMethods { 'bible.search': { req: { q: string }; res: Verse[] } }
 *     interface ApiEvents  { 'bible.downloaded': { id: string } }
 *   }
 *
 * so nobody needs to edit this file to add a feature.
 */
import type {
  ID, LiveState, LayerId, MediaItem, MediaRef, Output, Playlist, Presentation, WorkspaceConfig,
  LiveMessage, TimerState, Macro, Theme, StageLayout, Slide, Size, Transition
} from './model'

export interface PresentationSummary {
  id: ID
  title: string
  kind?: Presentation['kind']
  slideCount: number
  updatedAt: string
  category?: string
  artist?: string
  ccliNumber?: string
  /** First lines, for search. */
  excerpt?: string
}

export interface DisplayInfo {
  /** Stable identity used in Output.target.displayKey. */
  key: string
  /** Electron's volatile display id for this session. */
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  internal: boolean
  primary: boolean
  /** Outputs currently assigned to this display. */
  outputIds: ID[]
}

export interface ReceiverInfo {
  id: string
  name: string
  address: string
  userAgent?: string
  connected: boolean
  width?: number
  height?: number
  outputId?: ID
  lastSeen: number
}

export interface SystemInfo {
  version: string
  platform: string
  hostname: string
  workspacePath: string
  /** URLs other devices on the network can open. */
  serverUrls: string[]
  serverPort: number
}

export interface ApiMethods {
  /* system */
  'system.info': { req: void; res: SystemInfo }
  'system.openPath': { req: { path: string }; res: void }
  'system.pickFiles': { req: { title?: string; filters?: { name: string; extensions: string[] }[]; multi?: boolean; directory?: boolean }; res: string[] }
  'system.pickSave': { req: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }; res: string | null }

  /* machine-local settings (not synced) */
  'local.get': { req: { key: string }; res: unknown }
  'local.set': { req: { key: string; value: unknown }; res: void }

  /* workspace (synced) */
  'workspace.get': { req: void; res: WorkspaceConfig }
  'workspace.update': { req: Partial<WorkspaceConfig>; res: WorkspaceConfig }
  /** Generic synced JSON documents: themes, macros, stageLayouts, timers, messages, props... */
  'workspace.readDoc': { req: { name: string }; res: unknown }
  'workspace.writeDoc': { req: { name: string; value: unknown }; res: void }

  /* library */
  'library.list': { req: void; res: PresentationSummary[] }
  'library.get': { req: { id: ID }; res: Presentation | null }
  'library.save': { req: { presentation: Presentation }; res: Presentation }
  'library.create': { req: { title: string; kind?: Presentation['kind']; text?: string }; res: Presentation }
  'library.delete': { req: { id: ID }; res: void }
  'library.duplicate': { req: { id: ID }; res: Presentation }
  'library.search': { req: { q: string }; res: PresentationSummary[] }

  /* playlists */
  'playlists.list': { req: void; res: Playlist[] }
  'playlists.get': { req: { id: ID }; res: Playlist | null }
  'playlists.save': { req: { playlist: Playlist }; res: Playlist }
  'playlists.delete': { req: { id: ID }; res: void }

  /* media */
  'media.list': { req: void; res: MediaItem[] }
  'media.import': { req: { paths: string[]; folder?: string; copy?: boolean }; res: MediaItem[] }
  'media.update': { req: { item: MediaItem }; res: MediaItem }
  'media.remove': { req: { id: ID }; res: void }

  /* live */
  'live.get': { req: void; res: LiveState }
  'live.goToSlide': { req: { presentationId: ID; slideId?: ID; index?: number; playlistId?: ID; playlistItemId?: ID; arrangementId?: ID }; res: LiveState }
  /** Show an ad-hoc slide that isn't in the library (Bible verse, quick text, imported image). */
  'live.showSlide': { req: { slide: Slide; size?: Size; title?: string; layer?: 'slide' | 'announcement'; transition?: Transition }; res: LiveState }
  'live.next': { req: void; res: LiveState }
  'live.prev': { req: void; res: LiveState }
  'live.setMedia': { req: { layer: 'background' | 'video' | 'audio'; media: MediaRef | null; loop?: boolean; muted?: boolean; volume?: number; fit?: 'contain' | 'cover' | 'stretch' }; res: LiveState }
  'live.transport': { req: { layer: 'background' | 'video' | 'audio'; action: 'play' | 'pause' | 'restart' | 'seek'; time?: number }; res: LiveState }
  'live.clear': { req: { layer: LayerId | 'all' | 'audio' }; res: LiveState }
  'live.setFlag': { req: { flag: 'blackout' | 'logo' | 'frozen'; value: boolean }; res: LiveState }
  'live.setProp': { req: { id: ID; slide: Slide | null; size?: Size }; res: LiveState }
  'live.setMessage': { req: { message: LiveMessage | null; id?: ID }; res: LiveState }
  'live.setMask': { req: { media: MediaRef | null }; res: LiveState }
  'live.setStageMessage': { req: { text: string }; res: LiveState }
  'live.timer': { req: { action: 'upsert' | 'start' | 'stop' | 'reset' | 'remove'; timer?: Partial<TimerState> & { id: ID } }; res: LiveState }
  'live.runAction': { req: { type: string; params?: Record<string, unknown> }; res: void }
  'live.runMacro': { req: { id: ID }; res: void }

  /* outputs & displays (machine-local) */
  'outputs.list': { req: void; res: Output[] }
  'outputs.save': { req: { output: Output }; res: Output[] }
  'outputs.remove': { req: { id: ID }; res: Output[] }
  'outputs.displays': { req: void; res: DisplayInfo[] }
  'outputs.identify': { req: void; res: void }
  'outputs.receivers': { req: void; res: ReceiverInfo[] }
  /** Called by an output page to learn what it should render. */
  'outputs.describe': { req: { outputId?: ID; receiverId?: string; canvasId?: ID; regionId?: ID }; res: OutputDescription | null }
}

export interface OutputDescription {
  output: Output | null
  canvas: WorkspaceConfig['canvases'][number]
  workspace: WorkspaceConfig
  stageLayout?: StageLayout | null
}

export interface ApiEvents {
  'live.changed': LiveState
  'library.changed': { ids?: ID[] }
  'playlists.changed': { ids?: ID[] }
  'media.changed': void
  'workspace.changed': WorkspaceConfig
  'workspace.docChanged': { name: string }
  'outputs.changed': Output[]
  'outputs.displaysChanged': DisplayInfo[]
  'outputs.receiversChanged': ReceiverInfo[]
  'outputs.identify': { on: boolean }
  /** Toast-style notification for the operator UI. */
  'ui.notify': { level: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string }
}

export type MethodName = keyof ApiMethods
export type EventName = keyof ApiEvents
export type Req<K extends MethodName> = ApiMethods[K]['req']
export type Res<K extends MethodName> = ApiMethods[K]['res']

export interface ApiClient {
  invoke<K extends MethodName>(method: K, ...args: Req<K> extends void ? [] : [Req<K>]): Promise<Res<K>>
  on<K extends EventName>(event: K, cb: (payload: ApiEvents[K]) => void): () => void
  /** 'ipc' inside the desktop app, 'ws' in a browser/TV/phone. */
  transport: 'ipc' | 'ws'
}

export type { Macro, Theme }
