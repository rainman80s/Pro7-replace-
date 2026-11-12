/**
 * Reach Presenter — core document model.
 *
 * This file is the contract between every part of the app. Changes here must be
 * ADDITIVE (new optional fields / new union members) so parallel work never breaks.
 *
 * Coordinates: every element frame is in PIXELS of the space it was designed in.
 *  - `slide.elements` are designed in `presentation.size` (default 1920x1080).
 *  - `slide.variants[canvasId]` are designed in that canvas's own pixel size.
 * The renderer scales the design space to the target (contain + center).
 */

export type ID = string

export interface Size {
  width: number
  height: number
}
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/* ───────────────────────────── Canvases & outputs ───────────────────────────── */

/**
 * A Canvas is a LOGICAL screen: "Main Screen", "LED Wall", "Lobby TVs", "Stage Display".
 * It is part of the shared workspace (synced between computers).
 *
 * A canvas may be split into Regions — e.g. a stacked LED wall is one canvas
 * (1920x2160) with two regions "LED Top" and "LED Bottom". The editor draws region
 * guides so one slide can be designed across the whole wall, and each region is
 * routed to its own physical output.
 */
export interface Canvas {
  id: ID
  name: string
  kind: 'audience' | 'stage'
  width: number
  height: number
  regions: Region[]
  /** Which live layers this canvas shows. Omitted = all. (Replaces ProPresenter "Looks".) */
  layers?: Partial<Record<LayerId, boolean>>
  /** Stage canvases: which stage layout to show. */
  stageLayoutId?: ID
  /** Optional theme applied to slides that have no variant for this canvas. */
  themeId?: ID
  color?: string
}

export interface Region {
  id: ID
  name: string
  rect: Rect
}

export type OutputTarget =
  /** A physical display attached to this computer. displayKey is a stable identity (see displays service). */
  | { type: 'display'; displayKey: string }
  /** A floating window (preview / testing / capture by OBS). */
  | { type: 'window' }
  /** An NDI sender on the network. */
  | { type: 'ndi'; name: string }
  /** A network receiver: any browser/TV/Pi that opened the receiver URL. */
  | { type: 'network'; receiverId: string }
  /** A named group of other outputs — everything in the group shows the same thing. */
  | { type: 'group'; outputIds: ID[] }

/**
 * An Output routes a canvas (or one region of it) to a destination.
 * Outputs are MACHINE-LOCAL (each computer has its own displays) and are remembered
 * so that plugging the same display back in restores its role automatically.
 * "Duplicate this output to that display" = a second Output with the same source.
 */
export interface Output {
  id: ID
  name: string
  canvasId: ID
  /** Undefined = the whole canvas. */
  regionId?: ID
  target: OutputTarget
  enabled: boolean
  transform?: OutputTransform
}

export interface OutputTransform {
  flipH?: boolean
  flipV?: boolean
  rotate?: 0 | 90 | 180 | 270
  /** Corner pin: 4 points (TL, TR, BR, BL) normalized 0..1. */
  cornerPin?: [number, number][]
  /** How the source fits the destination. */
  fit?: 'contain' | 'cover' | 'stretch'
  brightness?: number
}

/* ───────────────────────────── Presentations ───────────────────────────── */

export interface Presentation {
  id: ID
  title: string
  kind?: 'song' | 'sermon' | 'announcement' | 'scripture' | 'generic'
  size: Size
  slides: Slide[]
  /** Song sections (Verse 1, Chorus...). Slides not in a group are ungrouped. */
  groups: SlideGroup[]
  arrangements: Arrangement[]
  activeArrangementId?: ID
  themeId?: ID
  meta: PresentationMeta
  createdAt: string
  updatedAt: string
}

export interface PresentationMeta {
  author?: string
  artist?: string
  copyright?: string
  publisher?: string
  ccliNumber?: string
  ccliLicense?: string
  category?: string
  notes?: string
  /** Where this came from: propresenter7, pco, notion, figma, manual... */
  source?: { type: string; ref?: string; importedAt?: string; [k: string]: unknown }
  [k: string]: unknown
}

export interface SlideGroup {
  id: ID
  name: string
  color?: string
  slideIds: ID[]
}

export interface Arrangement {
  id: ID
  name: string
  groupIds: ID[]
}

export interface Slide {
  id: ID
  label?: string
  notes?: string
  enabled?: boolean
  background?: Fill
  elements: SlideElement[]
  /** Per-canvas overrides, keyed by Canvas.id, in that canvas's pixel space. */
  variants?: Record<ID, SlideVariant>
  /** Things that fire when this slide goes live (media, timers, MIDI, macros...). */
  actions?: SlideAction[]
  transition?: Transition
  hotKey?: string
  /** Seconds until auto-advance (0/undefined = manual). */
  autoAdvance?: number
}

export interface SlideVariant {
  elements: SlideElement[]
  background?: Fill
}

export type Fill =
  | { type: 'color'; color: string }
  | { type: 'gradient'; angle: number; stops: { color: string; at: number }[] }
  | { type: 'media'; media: MediaRef; fit?: 'contain' | 'cover' | 'stretch' }

export interface Transition {
  type: 'cut' | 'fade' | 'dissolve' | 'slide' | 'push' | 'zoom'
  duration: number
  direction?: 'left' | 'right' | 'up' | 'down'
}

/* ───────────────────────────── Elements ───────────────────────────── */

export interface ElementBase {
  id: ID
  name?: string
  frame: Rect
  rotation?: number
  opacity?: number
  hidden?: boolean
  locked?: boolean
  /** Editor hint: the region this element was placed in (it stays anchored to it). */
  regionId?: ID
  shadow?: Shadow
  stroke?: Stroke
  cornerRadius?: number
  /** Build order: element appears on the Nth "next" press (0/undefined = with the slide). */
  buildIn?: number
  /** Set on decoration (shapes, images, fixed text) that came from a theme template, so re-theming replaces it. */
  fromTheme?: boolean
}

export interface Shadow {
  color: string
  blur: number
  x: number
  y: number
}
export interface Stroke {
  color: string
  width: number
}

export interface TextStyle {
  fontFamily?: string
  fontSize?: number
  fontWeight?: number | string
  italic?: boolean
  underline?: boolean
  color?: string
  letterSpacing?: number
  lineHeight?: number
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
  strokeColor?: string
  strokeWidth?: number
  shadow?: Shadow
}

export interface TextRun {
  text: string
  style?: TextStyle
}
export interface Paragraph {
  runs: TextRun[]
  align?: 'left' | 'center' | 'right' | 'justify'
}

export interface TextElement extends ElementBase {
  type: 'text'
  paragraphs: Paragraph[]
  /** Default style for runs that don't override. */
  style: TextStyle
  align?: 'left' | 'center' | 'right' | 'justify'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  fill?: Fill
  padding?: number
  /** Shrink text to fit the frame. */
  autoFit?: boolean
  /** Semantic role: lets themes, stage displays and integrations find "the lyrics" etc. */
  role?: 'lyrics' | 'title' | 'subtitle' | 'reference' | 'body' | 'caption' | 'translation' | string
  /**
   * Linked/dynamic text. When set, `paragraphs` is a template and tokens like
   * {clock}, {timer:ID}, {song.title}, {next.text}, {message} are replaced live.
   */
  dynamic?: boolean
  /**
   * Per-canvas variants only: a text element with a `role` shows the text of the base design's element
   * with the same role (lyrics are typed once). Set `linked: false` to give this copy its own text.
   */
  linked?: boolean
}

export interface ShapeElement extends ElementBase {
  type: 'shape'
  shape: 'rect' | 'ellipse' | 'line' | 'polygon'
  fill?: Fill
  points?: [number, number][]
}

export interface ImageElement extends ElementBase {
  type: 'image'
  media: MediaRef
  fit?: 'contain' | 'cover' | 'stretch'
}

export interface VideoElement extends ElementBase {
  type: 'video'
  media: MediaRef
  fit?: 'contain' | 'cover' | 'stretch'
  loop?: boolean
  muted?: boolean
  volume?: number
  inPoint?: number
  outPoint?: number
}

/** Live input: camera / capture card / NDI source / web page. */
export interface LiveElement extends ElementBase {
  type: 'live'
  source: { kind: 'camera' | 'ndi' | 'web' | 'screen'; ref: string }
  fit?: 'contain' | 'cover' | 'stretch'
}

export type SlideElement = TextElement | ShapeElement | ImageElement | VideoElement | LiveElement

/* ───────────────────────────── Media ───────────────────────────── */

export interface MediaRef {
  id?: ID
  kind: 'image' | 'video' | 'audio'
  /**
   * `workspace:` paths are relative to the workspace's media folder (portable + synced),
   * `file:` are absolute local paths, `http(s):` are remote.
   */
  src: string
  name?: string
  width?: number
  height?: number
  duration?: number
}

export interface MediaItem extends MediaRef {
  id: ID
  name: string
  tags?: string[]
  folder?: string
  thumbnail?: string
  /** Playback defaults. */
  loop?: boolean
  behavior?: 'background' | 'foreground'
  fit?: 'contain' | 'cover' | 'stretch'
  addedAt?: string
}

/* ───────────────────────────── Playlists / service plans ───────────────────────────── */

export interface Playlist {
  id: ID
  name: string
  /** e.g. the Sunday date, ISO. */
  date?: string
  items: PlaylistItem[]
  folder?: string
  source?: { type: string; ref?: string; syncedAt?: string; [k: string]: unknown }
  updatedAt: string
}

export type PlaylistItem =
  | { id: ID; type: 'header'; title: string; color?: string; time?: string; length?: number; notes?: string }
  | {
      id: ID
      type: 'presentation'
      presentationId: ID
      title?: string
      arrangementId?: ID
      length?: number
      notes?: string
      /** e.g. who is speaking / leading (from Planning Center). */
      people?: string[]
    }
  | { id: ID; type: 'media'; media: MediaRef; title?: string; length?: number }
  | { id: ID; type: 'placeholder'; title: string; hint?: string; length?: number; notes?: string }

/* ───────────────────────────── Actions ───────────────────────────── */

/**
 * Something that happens when a slide goes live or a macro runs.
 * `type` is namespaced by the feature that handles it (e.g. "media.play",
 * "timer.start", "midi.send", "live.clear", "macro.run"). Handlers are registered
 * in the main process with `actions.register(type, handler)`.
 */
export interface SlideAction {
  id: ID
  type: string
  label?: string
  params?: Record<string, unknown>
  delay?: number
}

export interface Macro {
  id: ID
  name: string
  color?: string
  icon?: string
  actions: SlideAction[]
}

/* ───────────────────────────── Live state ───────────────────────────── */

export type LayerId = 'background' | 'video' | 'slide' | 'announcement' | 'props' | 'message' | 'mask'

export const LAYER_ORDER: LayerId[] = ['background', 'video', 'slide', 'announcement', 'props', 'message', 'mask']

export interface LiveSlide {
  presentationId: ID
  presentationTitle?: string
  slideId: ID
  /** Index within the active arrangement's flattened slide list. */
  index: number
  slide: Slide
  size: Size
  /** How many builds have been revealed. */
  build?: number
  next?: { slide: Slide; index: number } | null
  playlistId?: ID
  playlistItemId?: ID
  transition?: Transition
}

export interface LiveMedia {
  media: MediaRef
  loop?: boolean
  muted?: boolean
  volume?: number
  playing: boolean
  /** Epoch ms when playback (re)started, and the media time at that moment — lets every output stay in sync. */
  startedAt?: number
  offset?: number
  fit?: 'contain' | 'cover' | 'stretch'
  transition?: Transition
}

export interface LiveMessage {
  id: ID
  text: string
  style?: TextStyle
  position?: 'top' | 'bottom' | 'center' | 'ticker'
}

export interface TimerState {
  id: ID
  name: string
  kind: 'countdown' | 'countdownTo' | 'elapsed'
  /** Seconds for countdown. */
  duration?: number
  /** "HH:MM" wall-clock target for countdownTo. */
  target?: string
  running: boolean
  /** Epoch ms when started; remaining/elapsed is derived so all screens agree. */
  startedAt?: number
  /** Seconds accumulated before the last start (for pause/resume). */
  accumulated?: number
  overrun?: boolean
}

/**
 * The single source of truth for what is on screen. Owned by the main process
 * (`live` service); every output/receiver/stage screen renders from this.
 */
export interface LiveState {
  rev: number
  slide: LiveSlide | null
  announcement: LiveSlide | null
  background: LiveMedia | null
  video: LiveMedia | null
  audio: LiveMedia | null
  props: { id: ID; slide: Slide; size: Size }[]
  messages: LiveMessage[]
  mask: MediaRef | null
  stageMessage: string
  timers: TimerState[]
  /** Layers currently blanked by a "clear". */
  cleared: Partial<Record<LayerId, boolean>>
  /** Whole-output states. */
  blackout: boolean
  logo: boolean
  frozen: boolean
}

export const emptyLiveState = (): LiveState => ({
  rev: 0,
  slide: null,
  announcement: null,
  background: null,
  video: null,
  audio: null,
  props: [],
  messages: [],
  mask: null,
  stageMessage: '',
  timers: [],
  cleared: {},
  blackout: false,
  logo: false,
  frozen: false
})

/* ───────────────────────────── Themes & stage layouts ───────────────────────────── */

/** A theme is a set of template slides; applying one restyles text by role. */
export interface Theme {
  id: ID
  name: string
  size: Size
  templates: { id: ID; name: string; slide: Slide }[]
}

export interface StageLayout {
  id: ID
  name: string
  size: Size
  /** Uses dynamic text elements with tokens ({current.text}, {next.text}, {clock}, {timer:ID}, {stageMessage}...). */
  slide: Slide
}

/* ───────────────────────────── Workspace ───────────────────────────── */

/** Shared (synced) workspace settings — lives in <workspace>/workspace.json. */
export interface WorkspaceConfig {
  version: 1
  name: string
  canvases: Canvas[]
  defaultSize: Size
  logo?: MediaRef
  copyright?: { ccliLicense?: string; template?: string; show?: boolean }
  /** Theme applied to new presentations (see src/shared/themes.ts). */
  defaultThemeId?: ID
}

/* ───────────────────────────── Helpers ───────────────────────────── */

export const DEFAULT_SIZE: Size = { width: 1920, height: 1080 }

export function plainText(el: TextElement): string {
  return el.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n')
}

export function slideText(slide: Slide, role?: string): string {
  const texts = slide.elements.filter((e): e is TextElement => e.type === 'text' && !e.dynamic)
  const pick = role ? texts.filter((t) => t.role === role) : texts
  return (pick.length ? pick : texts).map(plainText).join('\n')
}

export function textToParagraphs(text: string): Paragraph[] {
  return text.split('\n').map((line) => ({ runs: [{ text: line }] }))
}

/** Slides in playback order for an arrangement (or document order if none). */
export function orderedSlides(p: Presentation, arrangementId?: ID): Slide[] {
  const arr = p.arrangements.find((a) => a.id === (arrangementId ?? p.activeArrangementId))
  const byId = new Map(p.slides.map((s) => [s.id, s]))
  if (!arr) return p.slides.filter((s) => s.enabled !== false)
  const out: Slide[] = []
  for (const gid of arr.groupIds) {
    const g = p.groups.find((x) => x.id === gid)
    if (!g) continue
    for (const sid of g.slideIds) {
      const s = byId.get(sid)
      if (s && s.enabled !== false) out.push(s)
    }
  }
  return out
}

export function groupOfSlide(p: Presentation, slideId: ID): SlideGroup | undefined {
  return p.groups.find((g) => g.slideIds.includes(slideId))
}

/** Elements + background to draw for a slide on a given canvas. */
export function resolveSlideForCanvas(
  slide: Slide,
  size: Size,
  canvas?: Pick<Canvas, 'id' | 'width' | 'height'>
): { elements: SlideElement[]; background?: Fill; size: Size } {
  const v = canvas && slide.variants?.[canvas.id]
  if (v && canvas) {
    return { elements: linkVariantElements(slide.elements, v.elements), background: v.background ?? slide.background, size: { width: canvas.width, height: canvas.height } }
  }
  return { elements: slide.elements, background: slide.background, size }
}

/**
 * Single-source text for per-canvas variants: every variant text element that has a `role`
 * (and isn't `linked: false` or dynamic) takes its paragraphs from the base design's element with
 * the same role (k-th of a role ↔ k-th of that role, wrapping). Styling stays the variant's own.
 * Returns the same array when nothing changes.
 */
export function linkVariantElements(base: SlideElement[], variant: SlideElement[]): SlideElement[] {
  const byRole = new Map<string, TextElement[]>()
  for (const e of base) {
    if (e.type === 'text' && e.role && !e.dynamic) byRole.set(e.role, [...(byRole.get(e.role) ?? []), e])
  }
  if (!byRole.size) return variant
  const seen = new Map<string, number>()
  let changed = false
  const out = variant.map((e) => {
    if (e.type !== 'text' || !e.role || e.dynamic || e.linked === false) return e
    const src = byRole.get(e.role)
    if (!src) return e
    const k = seen.get(e.role) ?? 0
    seen.set(e.role, k + 1)
    const from = src[k % src.length]
    if (from.paragraphs === e.paragraphs || JSON.stringify(from.paragraphs) === JSON.stringify(e.paragraphs)) return e
    changed = true
    return { ...e, paragraphs: from.paragraphs }
  })
  return changed ? out : variant
}
