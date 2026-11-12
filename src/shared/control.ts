/**
 * Show control — shared types and pure logic (timers, messages, props, macros, triggers, audio bin).
 * Everything here is free of Node/React so it runs in the main process, the operator UI,
 * the phone remote and unit tests alike.
 */
import type { ID, LiveState, MediaRef, Size, Slide, SlideAction, TextElement, TextStyle, TimerState } from './model'

/* ───────────────────────────── Timers ───────────────────────────── */

/** A saved timer (workspace doc `timers`). The running state lives in `LiveState.timers`. */
export interface TimerDef {
  id: ID
  name: string
  kind: 'countdown' | 'countdownTo' | 'elapsed'
  /** Seconds (countdown). */
  duration?: number
  /** "HH:MM" 24h wall-clock target (countdownTo). */
  target?: string
  /** Keep counting below zero (shown as -0:15) instead of stopping at 0:00. */
  overrun?: boolean
  /** Turn amber when this many seconds remain (default 60). */
  warnAt?: number
  /** Turn red when this many seconds remain (default 0 = when time is up). */
  dangerAt?: number
}

export interface TimersDoc {
  timers: TimerDef[]
  /** Start an "Item" countdown automatically from a service item's planned length. */
  serviceItemTimer?: boolean
}

export const SERVICE_ITEM_TIMER_ID = 'service-item'

export const defaultTimers = (): TimersDoc => ({
  serviceItemTimer: true,
  timers: [
    { id: 'service-start', name: 'Service starts', kind: 'countdown', duration: 300, overrun: false, warnAt: 60 },
    { id: 'sermon', name: 'Sermon', kind: 'countdown', duration: 35 * 60, overrun: true, warnAt: 300 }
  ]
})

/** Seconds shown by a timer right now: remaining for countdowns (negative = over), elapsed for count-ups. */
export function timerValue(t: Pick<TimerState, 'kind' | 'duration' | 'target' | 'running' | 'startedAt' | 'accumulated'>, now = Date.now()): number {
  if (t.kind === 'countdownTo' && t.target) return secondsUntil(t.target, now)
  const run = (t.accumulated ?? 0) + (t.running && t.startedAt ? (now - t.startedAt) / 1000 : 0)
  return t.kind === 'elapsed' ? run : (t.duration ?? 0) - run
}

/** Seconds from `now` until today's HH:MM (negative once it has passed). */
export function secondsUntil(target: string, now = Date.now()): number {
  const [h, m] = target.split(':').map(Number)
  const d = new Date(now)
  d.setHours(h || 0, m || 0, 0, 0)
  return (d.getTime() - now) / 1000
}

/** 4:59, 1:02:03, -0:15 — countdowns round up so "5:00" shows for the whole first second. */
export function formatTimer(sec: number): string {
  const neg = sec < 0
  const s = Math.abs(Math.ceil(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return `${neg && s > 0 ? '-' : ''}${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${ss}`
}

/** ProPresenter-style HH:MM:SS (used by the compatibility API). */
export function formatHms(sec: number): string {
  const neg = sec < 0
  const s = Math.abs(Math.ceil(sec))
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${neg && s > 0 ? '-' : ''}${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`
}

/** "5", "5:00", "1:05:00", "90s", "5m" → seconds. Returns null when it can't be read. */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase()
  if (!t) return null
  const unit = /^(\d+(?:\.\d+)?)\s*(s|sec|secs|m|min|mins|h|hr|hrs)$/.exec(t)
  if (unit) {
    const n = parseFloat(unit[1])
    return Math.round(unit[2][0] === 's' ? n : unit[2][0] === 'm' ? n * 60 : n * 3600)
  }
  if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) return null
  const parts = t.split(':').map(Number)
  // A bare number means minutes — that is what a volunteer means by "5".
  if (parts.length === 1) return parts[0] * 60
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}

export type TimerLevel = 'idle' | 'ok' | 'warn' | 'danger'

/** Which colour a timer should be drawn in. */
export function timerLevel(def: Pick<TimerDef, 'kind' | 'warnAt' | 'dangerAt'> | undefined, t: TimerState, now = Date.now()): TimerLevel {
  if (t.kind === 'elapsed') return t.running ? 'ok' : 'idle'
  const v = timerValue(t, now)
  if (v <= (def?.dangerAt ?? 0)) return t.running || t.kind === 'countdownTo' || v < (t.duration ?? 0) ? 'danger' : 'idle'
  if (v <= (def?.warnAt ?? 60)) return 'warn'
  return t.running || t.kind === 'countdownTo' ? 'ok' : 'idle'
}

/** Has a countdown that must not overrun reached zero? */
export function timerExpired(t: TimerState, now = Date.now()): boolean {
  if (t.kind === 'elapsed') return false
  if (t.kind === 'countdown' && !t.running) return false
  return timerValue(t, now) <= 0
}

/** The live TimerState for a definition (keeps running state from `prev`). */
export function timerStateFromDef(def: TimerDef, prev?: TimerState): TimerState {
  return {
    id: def.id, name: def.name, kind: def.kind, duration: def.duration, target: def.target, overrun: def.overrun ?? false,
    running: prev?.running ?? def.kind === 'countdownTo', startedAt: prev?.startedAt, accumulated: prev?.accumulated ?? 0
  }
}

/** Find a timer by id, or by name (case-insensitive) — MIDI/HTTP callers usually know the name. */
export function findByIdOrName<T extends { id: ID; name: string }>(list: T[], key: unknown): T | undefined {
  if (key === undefined || key === null || key === '') return undefined
  const k = String(key)
  return list.find((x) => x.id === k) ?? list.find((x) => x.name.toLowerCase() === k.toLowerCase()) ??
    (/^\d+$/.test(k) ? list[Number(k)] : undefined)
}

/* ───────────────────────────── Messages ───────────────────────────── */

/** A reusable on-screen message (workspace doc `messages`). */
export interface MessageTemplate {
  id: ID
  name: string
  /** e.g. "Parent of child {number}, please come to the nursery". */
  text: string
  position?: 'top' | 'bottom' | 'center' | 'ticker'
  /** Hide automatically after this many seconds (0/undefined = stays until hidden). */
  autoHide?: number
  style?: TextStyle
}

export interface MessagesDoc {
  messages: MessageTemplate[]
  /** One-tap stage messages ("Wrap it up", "Mic 2 is muted"). */
  stagePresets: string[]
}

export const defaultMessages = (): MessagesDoc => ({
  messages: [
    { id: 'nursery', name: 'Nursery call', text: 'Parent of child {number}, please come to the nursery', position: 'bottom', autoHide: 30 },
    { id: 'car', name: 'Car in the car park', text: 'Would the owner of {car} please go to the welcome desk', position: 'bottom', autoHide: 30 },
    { id: 'starting', name: 'Starting soon', text: 'Service starts in {timer:Service starts}', position: 'bottom' }
  ],
  stagePresets: ['Wrap it up', '5 minutes left', 'Slow down', 'Speak up', 'Check your mic']
})

/** Tokens the output fills in live — everything else in {braces} is a fill-in field. */
export function isLiveToken(name: string): boolean {
  const n = name.trim()
  return /^(clock|clock\.seconds|date|timer|message|stageMessage)$/.test(n) || /^(timer:|current\.|next\.|song\.)/.test(n)
}

/** The fill-in fields of a message, in order, without duplicates. */
export function messageFields(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\{([^{}]+)\}/g)) {
    const n = m[1].trim()
    if (!isLiveToken(n) && !out.includes(n)) out.push(n)
  }
  return out
}

/** Replace fill-in fields with values; live tokens ({clock}, {timer:Name}) are left for the output to resolve. */
export function fillMessage(text: string, values: Record<string, unknown> = {}): string {
  const lower = new Map(Object.entries(values).map(([k, v]) => [k.trim().toLowerCase(), v]))
  return text.replace(/\{([^{}]+)\}/g, (m, k: string) => {
    const n = k.trim()
    if (isLiveToken(n)) return m
    const v = lower.get(n.toLowerCase())
    return v === undefined || v === null ? '' : String(v)
  }).replace(/ {2,}/g, ' ').trim()
}

/* ───────────────────────────── Props & masks ───────────────────────────── */

/** A persistent overlay (logo bug, lower third) — workspace doc `props`. */
export interface PropDef {
  id: ID
  name: string
  slide: Slide
  size: Size
  /** Remove itself after this many seconds. */
  autoClear?: number
  color?: string
}

export interface PropsDoc {
  props: PropDef[]
  /** Images offered as masks. */
  masks: MediaRef[]
}

let seq = 0
export const uid = (prefix = 'c'): string => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function textElement(text: string, frame: { x: number; y: number; w: number; h: number }, style: TextStyle, extra: Partial<TextElement> = {}): TextElement {
  return {
    id: uid('el'), type: 'text', frame, style, align: 'center', verticalAlign: 'middle', autoFit: true,
    paragraphs: text.split('\n').map((line) => ({ runs: [{ text: line }] })), ...extra
  }
}

/** A lower-third style text prop. */
export function textProp(name: string, text: string, size: Size): PropDef {
  const h = Math.round(size.height * 0.13)
  return {
    id: uid('prop'), name, size,
    slide: {
      id: uid('s'), elements: [
        textElement(text, { x: Math.round(size.width * 0.05), y: Math.round(size.height * 0.8), w: Math.round(size.width * 0.5), h },
          { fontSize: Math.round(h * 0.42), fontWeight: 600, color: '#ffffff' },
          { fill: { type: 'color', color: 'rgba(20,20,20,.82)' }, align: 'left', padding: Math.round(h * 0.2), cornerRadius: Math.round(h * 0.12), dynamic: /\{[^{}]+\}/.test(text) })
      ]
    }
  }
}

/** A corner logo "bug" prop from an image. */
export function imageProp(name: string, media: MediaRef, size: Size, corner: 'tl' | 'tr' | 'bl' | 'br' | 'full' = 'br'): PropDef {
  const w = Math.round(size.width * 0.12)
  const pad = Math.round(size.width * 0.03)
  const frame = corner === 'full' ? { x: 0, y: 0, w: size.width, h: size.height } : {
    x: corner.endsWith('l') ? pad : size.width - w - pad, y: corner.startsWith('t') ? pad : size.height - w - pad, w, h: w
  }
  return { id: uid('prop'), name, size, slide: { id: uid('s'), elements: [{ id: uid('el'), type: 'image', media, frame, fit: 'contain' }] } }
}

/** A full-screen countdown slide ("Service starts in 5:00") for `live.showSlide`. */
export function countdownSlide(timerName: string, heading: string, size: Size): Slide {
  const { width: w, height: h } = size
  return {
    id: uid('countdown'), label: 'Countdown', background: { type: 'color', color: '#111111' },
    elements: [
      textElement(heading, { x: w * 0.1, y: h * 0.22, w: w * 0.8, h: h * 0.16 }, { fontSize: Math.round(h * 0.075), fontWeight: 500, color: '#F4F2EB' }, { role: 'title' }),
      textElement(`{timer:${timerName}}`, { x: w * 0.1, y: h * 0.38, w: w * 0.8, h: h * 0.36 }, { fontSize: Math.round(h * 0.3), fontWeight: 700, color: '#ffffff' }, { dynamic: true, role: 'body', autoFit: false })
    ]
  }
}

/* ───────────────────────────── Actions & macros ───────────────────────────── */

export type ParamKind = 'text' | 'longtext' | 'number' | 'boolean' | 'select' | 'timer' | 'macro' | 'message' | 'prop' | 'audioPlaylist' | 'duration' | 'json'

export interface ParamSpec {
  key: string
  label: string
  kind: ParamKind
  options?: { value: string | number; label: string }[]
  default?: unknown
  min?: number
  max?: number
  hint?: string
  optional?: boolean
  /** Only shown when another param has one of these values. */
  when?: { key: string; in: unknown[] }
}

/** Describes an action type so any UI (macro editor, slide inspector, MIDI map) can render a form for it. */
export interface ActionTypeInfo {
  type: string
  label: string
  category: 'Slides' | 'Clear' | 'Timers' | 'Messages' | 'Props' | 'Stage' | 'Media' | 'Macros' | 'MIDI' | 'Network' | 'Other'
  description?: string
  params: ParamSpec[]
  /** False when the handler isn't registered in this build (e.g. a missing optional module). */
  available?: boolean
}

export const CLEAR_LAYERS = [
  { value: 'all', label: 'Everything' }, { value: 'slide', label: 'Slide' }, { value: 'background', label: 'Background' }, { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' }, { value: 'props', label: 'Props' }, { value: 'message', label: 'Messages' }, { value: 'announcement', label: 'Announcements' }, { value: 'mask', label: 'Mask' }
]

/** One-line human summary of an action, e.g. "Start timer · Sermon". */
export function describeAction(a: Pick<SlideAction, 'type' | 'params' | 'label'>, types: ActionTypeInfo[] = []): string {
  if (a.label) return a.label
  const info = types.find((t) => t.type === a.type)
  const p = a.params ?? {}
  const bits = (info?.params ?? []).map((s) => p[s.key]).filter((v) => v !== undefined && v !== '' && typeof v !== 'object').slice(0, 3)
  return [info?.label ?? a.type, ...bits.map(String)].join(' · ')
}

export const MACRO_COLORS = ['#3886CE', '#E6A20F', '#4FA88B', '#D8523F', '#8E6BC9', '#C95B93', '#6F6E6A']

/* ───────────────────────────── Triggers ───────────────────────────── */

export type TriggerWhen =
  /** A key pressed in the operator window, e.g. "F9", "Shift+M". */
  | { type: 'hotkey'; key: string }
  /** Weekly schedule: days 0 (Sunday) – 6, at "HH:MM". */
  | { type: 'schedule'; days: number[]; time: string }
  /** Any slide whose label (or song section name) matches goes live. `*` is a wildcard. */
  | { type: 'label'; match: string; scope?: 'slide' | 'group' | 'both' }
  /** When Reach Presenter starts. */
  | { type: 'startup' }
  /** A named web hook: POST /api/v1/trigger/<name>. */
  | { type: 'http'; name: string }
  /** When a timer reaches zero. */
  | { type: 'timerEnd'; timer: string }

export interface Trigger {
  id: ID
  name: string
  enabled: boolean
  when: TriggerWhen
  action: { type: string; params?: Record<string, unknown> }
}

export interface TriggersDoc {
  triggers: Trigger[]
  /** Master switch for the schedule (turn off for rehearsals/weddings). */
  scheduleEnabled?: boolean
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The minute key a schedule fires on, e.g. "2026-11-15T08:55" — used to fire exactly once. */
export function minuteKey(now: number): string {
  const d = new Date(now)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Scheduled triggers that are due this minute and haven't fired for it yet. */
export function dueSchedules(triggers: Trigger[], now: number, fired: Map<ID, string>): Trigger[] {
  const d = new Date(now)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const key = minuteKey(now)
  return triggers.filter((t) => {
    if (!t.enabled || t.when.type !== 'schedule') return false
    const [h, m] = t.when.time.split(':').map(Number)
    const want = `${String(h || 0).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`
    return want === hm && t.when.days.includes(d.getDay()) && fired.get(t.id) !== key
  })
}

/** Case-insensitive match with `*` wildcards; no wildcard = whole label must match. */
export function labelMatches(pattern: string, label: string | undefined): boolean {
  if (!label || !pattern.trim()) return false
  const rx = new RegExp('^' + pattern.trim().split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i')
  return rx.test(label.trim())
}

export function labelTriggers(triggers: Trigger[], slideLabel?: string, groupName?: string): Trigger[] {
  return triggers.filter((t) => {
    if (!t.enabled || t.when.type !== 'label') return false
    const scope = t.when.scope ?? 'both'
    return (scope !== 'group' && labelMatches(t.when.match, slideLabel)) || (scope !== 'slide' && labelMatches(t.when.match, groupName))
  })
}

/** Normalised name for a key press: "Shift+F9", "Ctrl+Alt+M", "PageDown", "Space". Cmd and Ctrl are both "Ctrl". */
export function keyName(e: { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }): string {
  let k = e.key
  if (k === ' ' || k === 'Spacebar') k = 'Space'
  // Alt/Option changes the typed character on a Mac — fall back to the physical key.
  if (e.altKey && e.code && /^Key[A-Z]$/.test(e.code)) k = e.code.slice(3)
  if (e.altKey && e.code && /^Digit\d$/.test(e.code)) k = e.code.slice(5)
  if (k.length === 1) k = k.toUpperCase()
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(k)) return ''
  const mods = [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && k.length > 1 && 'Shift', e.shiftKey && /^[A-Z0-9]$/.test(k) && 'Shift'].filter(Boolean)
  return [...new Set(mods), k].join('+')
}

/* ───────────────────────────── App shortcuts ───────────────────────────── */

export interface ShortcutBinding {
  /** Key name as produced by `keyName`. */
  key: string
  action: { type: string; params?: Record<string, unknown> }
  label: string
}

export interface HotkeysDoc {
  bindings: ShortcutBinding[]
  /** Presenter clickers send PageUp/PageDown (next/prev) and "B" or "." (blank). */
  clicker?: boolean
  /** Let slides with a hot key be triggered by pressing it. */
  slideHotKeys?: boolean
}

/** ProPresenter's clear keys (F1–F7) so muscle memory carries over. */
export const defaultHotkeys = (): HotkeysDoc => ({
  clicker: true,
  slideHotKeys: true,
  bindings: [
    { key: 'F1', label: 'Clear everything', action: { type: 'live.clear', params: { layer: 'all' } } },
    { key: 'F2', label: 'Clear slide', action: { type: 'live.clear', params: { layer: 'slide' } } },
    { key: 'F3', label: 'Clear background & video', action: { type: 'live.clear', params: { layer: 'media' } } },
    { key: 'F4', label: 'Clear props', action: { type: 'live.clear', params: { layer: 'props' } } },
    { key: 'F5', label: 'Clear audio', action: { type: 'live.clear', params: { layer: 'audio' } } },
    { key: 'F6', label: 'Clear messages', action: { type: 'live.clear', params: { layer: 'message' } } },
    { key: 'F7', label: 'Clear announcements', action: { type: 'live.clear', params: { layer: 'announcement' } } }
  ]
})

/* ───────────────────────────── Audio bin ───────────────────────────── */

export interface AudioPlaylist {
  id: ID
  name: string
  tracks: MediaRef[]
  /** What happens when a track ends. */
  mode: 'next' | 'loop' | 'stop'
  shuffle?: boolean
  /** 0..1 */
  volume?: number
  /** Seconds. */
  fadeIn?: number
  fadeOut?: number
}

export interface AudioDoc {
  playlists: AudioPlaylist[]
}

export interface AudioStatus {
  playlistId: ID | null
  index: number
  trackName: string
  playing: boolean
  volume: number
}

/** Which track plays after `index` (null = stop). */
export function nextTrackIndex(pl: Pick<AudioPlaylist, 'tracks' | 'mode' | 'shuffle'>, index: number, delta = 1, random = Math.random): number | null {
  const n = pl.tracks.length
  if (!n) return null
  if (pl.mode === 'stop' && delta > 0 && index >= 0) return null
  if (pl.shuffle && n > 1) {
    let i = index
    while (i === index) i = Math.floor(random() * n)
    return i
  }
  const i = index + delta
  if (i < 0) return pl.mode === 'loop' ? n - 1 : 0
  if (i >= n) return pl.mode === 'loop' ? 0 : null
  return i
}

/** Volume at `t` seconds into a fade from `from` to `to` lasting `duration` seconds. */
export function fadeVolume(from: number, to: number, t: number, duration: number): number {
  if (duration <= 0 || t >= duration) return to
  return Math.round((from + (to - from) * Math.max(0, t / duration)) * 1000) / 1000
}

/* ───────────────────────────── Remote ───────────────────────────── */

export interface RemoteSettings {
  pin: string
  urls: string[]
  port: number
  /**
   * ProPresenter-compatible API (/v1/...): 'pin' needs the PIN (as ?token= or Bearer) unless the caller is this computer;
   * 'open' lets any device on the network use it (what Companion's ProPresenter module expects); 'off' disables it.
   */
  compat: 'off' | 'pin' | 'open'
  /** OSC (UDP) listening port; 0 = off. */
  oscPort: number
}

/** Compact "what's live" summary used by the phone remote and the REST API. */
export function liveSummary(live: LiveState): { title: string; index: number; current: string; next: string; label: string } {
  const text = (s?: Slide | null): string => (s ? s.elements.filter((e): e is TextElement => e.type === 'text' && !e.dynamic).map((e) => e.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n')).join('\n') : '')
  return {
    title: live.slide?.presentationTitle ?? '', index: live.slide?.index ?? -1, label: live.slide?.slide.label ?? '',
    current: text(live.slide?.slide), next: text(live.slide?.next?.slide)
  }
}

/* ───────────────────────────── RPC contract ───────────────────────────── */

declare module './api' {
  interface ApiMethods {
    /* timers */
    'timers.list': { req: void; res: TimersDoc }
    'timers.save': { req: { timer: Partial<TimerDef> & { name: string } }; res: TimerDef }
    'timers.remove': { req: { id: ID }; res: void }
    'timers.settings': { req: { serviceItemTimer?: boolean }; res: TimersDoc }
    /** start / stop / reset / restart (reset + start) / adjust by ±seconds / set a new duration or target and start. */
    'timers.control': { req: { id: ID; action: 'start' | 'stop' | 'reset' | 'restart' | 'adjust' | 'set'; seconds?: number; duration?: number; target?: string }; res: LiveState }
    /** Put a full-screen countdown slide on the audience screens. */
    'timers.showCountdown': { req: { id: ID; heading?: string; start?: boolean }; res: LiveState }

    /* messages */
    'messages.list': { req: void; res: MessagesDoc }
    'messages.save': { req: { message: Partial<MessageTemplate> & { name: string; text: string } }; res: MessageTemplate }
    'messages.remove': { req: { id: ID }; res: void }
    'messages.show': { req: { id?: ID; text?: string; values?: Record<string, unknown>; seconds?: number; position?: MessageTemplate['position'] }; res: LiveState }
    'messages.hide': { req: { id?: ID }; res: LiveState }
    'messages.stage': { req: { text: string; flash?: boolean }; res: LiveState }
    'messages.stagePresets': { req: { presets: string[] }; res: MessagesDoc }

    /* props & mask */
    'props.list': { req: void; res: PropsDoc }
    'props.save': { req: { prop: PropDef }; res: PropDef }
    'props.remove': { req: { id: ID }; res: void }
    'props.toggle': { req: { id: ID; on?: boolean; solo?: boolean }; res: LiveState }
    'props.masks': { req: { masks: MediaRef[] }; res: PropsDoc }

    /* actions, macros, triggers */
    'actions.types': { req: void; res: ActionTypeInfo[] }
    'macros.list': { req: void; res: import('./model').Macro[] }
    'macros.save': { req: { macro: Partial<import('./model').Macro> & { name: string } }; res: import('./model').Macro }
    'macros.remove': { req: { id: ID }; res: void }
    'macros.reorder': { req: { ids: ID[] }; res: void }
    'triggers.list': { req: void; res: TriggersDoc }
    'triggers.save': { req: { trigger: Partial<Trigger> & Pick<Trigger, 'when' | 'action'> }; res: Trigger }
    'triggers.remove': { req: { id: ID }; res: void }
    'triggers.settings': { req: { scheduleEnabled?: boolean }; res: TriggersDoc }
    /** Fire a trigger now (the "Test" button), or every hot-key trigger bound to `key`. */
    'triggers.fire': { req: { id?: ID; key?: string; http?: string }; res: number }

    /* app shortcuts */
    'hotkeys.get': { req: void; res: HotkeysDoc }
    'hotkeys.set': { req: Partial<HotkeysDoc>; res: HotkeysDoc }

    /* audio bin */
    'audio.list': { req: void; res: AudioDoc }
    'audio.save': { req: { playlist: Partial<AudioPlaylist> & { name: string } }; res: AudioPlaylist }
    'audio.remove': { req: { id: ID }; res: void }
    'audio.play': { req: { playlistId: ID; index?: number }; res: AudioStatus }
    'audio.stop': { req: { fade?: boolean } | void; res: AudioStatus }
    'audio.skip': { req: { delta?: number } | void; res: AudioStatus }
    'audio.volume': { req: { volume: number }; res: AudioStatus }
    'audio.status': { req: void; res: AudioStatus }
    /** Reported by the page that actually plays the audio when a track finishes. */
    'audio.ended': { req: { src?: string } | void; res: void }

    /* remote */
    'remote.settings': { req: void; res: RemoteSettings }
    'remote.configure': { req: { compat?: RemoteSettings['compat']; oscPort?: number; newPin?: boolean | string }; res: RemoteSettings }
    /** Cheap "am I allowed to control?" check for remotes. */
    'remote.hello': { req: void; res: { ok: true; name: string } }
  }
  interface ApiEvents {
    'timers.ended': { id: ID; name: string }
    'audio.status': AudioStatus
    'control.ran': { source: string; label: string; at: number }
  }
}
