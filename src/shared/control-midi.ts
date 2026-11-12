/**
 * MIDI — message codec, input-mapping engine and the ProPresenter-compatible preset.
 * Pure TypeScript (no native code) so it is unit-testable and shared by main + UI.
 */
import type { ID } from './model'

export type MidiKind = 'noteon' | 'noteoff' | 'cc' | 'pc' | 'pitchbend' | 'aftertouch' | 'polyaftertouch' | 'sysex' | 'clock' | 'start' | 'continue' | 'stop' | 'other'

export interface MidiMessage {
  kind: MidiKind
  /** 1–16 (channel voice messages only). */
  channel?: number
  /** Note / controller / program number, 0–127. */
  number?: number
  /** Velocity / controller value 0–127; pitch bend 0–16383. */
  value?: number
  /** Raw bytes for sysex / other. */
  bytes?: number[]
}

const clamp7 = (n: unknown, d = 0): number => Math.max(0, Math.min(127, Math.round(Number.isFinite(Number(n)) ? Number(n) : d)))
const ch = (n: unknown): number => Math.max(1, Math.min(16, Math.round(Number(n) || 1))) - 1

/** MidiMessage → raw bytes. */
export function encodeMidi(m: MidiMessage): number[] {
  switch (m.kind) {
    case 'noteon': return [0x90 | ch(m.channel), clamp7(m.number), clamp7(m.value, 127)]
    case 'noteoff': return [0x80 | ch(m.channel), clamp7(m.number), clamp7(m.value, 0)]
    case 'polyaftertouch': return [0xa0 | ch(m.channel), clamp7(m.number), clamp7(m.value)]
    case 'cc': return [0xb0 | ch(m.channel), clamp7(m.number), clamp7(m.value)]
    case 'pc': return [0xc0 | ch(m.channel), clamp7(m.number)]
    case 'aftertouch': return [0xd0 | ch(m.channel), clamp7(m.value)]
    case 'pitchbend': {
      const v = Math.max(0, Math.min(16383, Math.round(m.value ?? 8192)))
      return [0xe0 | ch(m.channel), v & 0x7f, (v >> 7) & 0x7f]
    }
    case 'clock': return [0xf8]
    case 'start': return [0xfa]
    case 'continue': return [0xfb]
    case 'stop': return [0xfc]
    case 'sysex': {
      const body = (m.bytes ?? []).filter((b) => b !== 0xf0 && b !== 0xf7).map((b) => b & 0x7f)
      return [0xf0, ...body, 0xf7]
    }
    default: return (m.bytes ?? []).map((b) => b & 0xff)
  }
}

/** Raw bytes → MidiMessage. A Note On with velocity 0 is reported as Note Off (as the MIDI spec says). */
export function decodeMidi(bytes: ArrayLike<number>): MidiMessage {
  const b = Array.from(bytes)
  const status = b[0] ?? 0
  if (status >= 0xf0) {
    if (status === 0xf0) return { kind: 'sysex', bytes: b }
    if (status === 0xf8) return { kind: 'clock' }
    if (status === 0xfa) return { kind: 'start' }
    if (status === 0xfb) return { kind: 'continue' }
    if (status === 0xfc) return { kind: 'stop' }
    return { kind: 'other', bytes: b }
  }
  const channel = (status & 0x0f) + 1
  const d1 = (b[1] ?? 0) & 0x7f
  const d2 = (b[2] ?? 0) & 0x7f
  switch (status & 0xf0) {
    case 0x90: return d2 === 0 ? { kind: 'noteoff', channel, number: d1, value: 0 } : { kind: 'noteon', channel, number: d1, value: d2 }
    case 0x80: return { kind: 'noteoff', channel, number: d1, value: d2 }
    case 0xa0: return { kind: 'polyaftertouch', channel, number: d1, value: d2 }
    case 0xb0: return { kind: 'cc', channel, number: d1, value: d2 }
    case 0xc0: return { kind: 'pc', channel, number: d1 }
    case 0xd0: return { kind: 'aftertouch', channel, value: d1 }
    case 0xe0: return { kind: 'pitchbend', channel, value: d1 | (d2 << 7) }
    default: return { kind: 'other', bytes: b }
  }
}

/** "F0 7E 7F 06 01 F7" / "0x90,60,127" → bytes. Hex unless every token is plain decimal with commas. */
export function parseBytes(text: string): number[] {
  const tokens = text.trim().split(/[\s,]+/).filter(Boolean)
  const decimal = text.includes(',') && tokens.every((t) => /^\d+$/.test(t))
  return tokens.map((t) => (decimal ? parseInt(t, 10) : parseInt(t.replace(/^0x/i, ''), 16))).filter((n) => Number.isFinite(n)).map((n) => n & 0xff)
}

export const toHex = (bytes: ArrayLike<number>): string => Array.from(bytes).map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
/** Note name with middle C (60) = C3, the convention ProPresenter, Ableton and Logic use. */
export const noteName = (n: number): string => `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 2}`

const KIND_LABEL: Record<MidiKind, string> = {
  noteon: 'Note On', noteoff: 'Note Off', cc: 'Control Change', pc: 'Program Change', pitchbend: 'Pitch Bend', aftertouch: 'Aftertouch',
  polyaftertouch: 'Poly Aftertouch', sysex: 'SysEx', clock: 'Clock', start: 'Start', continue: 'Continue', stop: 'Stop', other: 'Other'
}

export function describeMidi(m: MidiMessage): string {
  const c = m.channel ? ` ch ${m.channel}` : ''
  if (m.kind === 'noteon' || m.kind === 'noteoff') return `${KIND_LABEL[m.kind]} ${m.number} (${noteName(m.number ?? 0)}) vel ${m.value}${c}`
  if (m.kind === 'cc') return `CC ${m.number} = ${m.value}${c}`
  if (m.kind === 'pc') return `Program ${m.number}${c}`
  if (m.kind === 'sysex' || m.kind === 'other') return `${KIND_LABEL[m.kind]} ${toHex(m.bytes ?? [])}`
  return `${KIND_LABEL[m.kind]}${m.value !== undefined ? ` ${m.value}` : ''}${c}`
}

/* ───────────────────────────── Input mapping ───────────────────────────── */

export interface MidiMatch {
  kind: 'noteon' | 'noteoff' | 'cc' | 'pc'
  /** 1–16; undefined = any channel (ProPresenter listens on all channels). */
  channel?: number
  /** Note / CC / program number; undefined = any. */
  number?: number
  /** Exact velocity/value required; undefined = any (Note On always needs velocity ≥ 1). */
  value?: number
  /** Only match values in this range. */
  min?: number
  max?: number
  /** Only messages from this input port (name); undefined = any input. */
  port?: string
}

export interface MidiMapping {
  id: ID
  name: string
  enabled: boolean
  match: MidiMatch
  action: { type: string; params?: Record<string, unknown> }
  /**
   * Copy the incoming velocity/value (or the note/program number) into an action parameter —
   * "note 19, velocity 6" → go to slide 6. `offset` is added (use -1 to turn 1-based into 0-based).
   */
  valueParam?: { key: string; from: 'value' | 'number'; offset?: number }
  /** Marks rows created by a preset so re-applying it replaces them. */
  preset?: string
}

export interface MidiDoc {
  mappings: MidiMapping[]
  /** Ignore the mapping table without unplugging anything. */
  enabled?: boolean
}

export function midiMatches(match: MidiMatch, m: MidiMessage, port?: string): boolean {
  if (match.kind !== m.kind) return false
  if (match.port && port && match.port !== port) return false
  if (match.channel !== undefined && match.channel !== m.channel) return false
  if (match.number !== undefined && match.number !== m.number) return false
  if (m.kind === 'pc') return true
  const v = m.value ?? 0
  if (match.value !== undefined && match.value !== v) return false
  if (match.min !== undefined && v < match.min) return false
  if (match.max !== undefined && v > match.max) return false
  return true
}

export interface ResolvedAction { mapping: MidiMapping; type: string; params: Record<string, unknown> }

/** The actions an incoming message should fire, with velocity/value injected where a mapping asks for it. */
export function resolveMidi(mappings: MidiMapping[], m: MidiMessage, port?: string): ResolvedAction[] {
  const out: ResolvedAction[] = []
  for (const mp of mappings) {
    if (!mp.enabled || !midiMatches(mp.match, m, port)) continue
    const params: Record<string, unknown> = { ...(mp.action.params ?? {}) }
    if (mp.valueParam) {
      const raw = mp.valueParam.from === 'number' ? (m.number ?? 0) : (m.kind === 'pc' ? (m.number ?? 0) : (m.value ?? 0))
      params[mp.valueParam.key] = raw + (mp.valueParam.offset ?? 0)
    }
    out.push({ mapping: mp, type: mp.action.type, params })
  }
  return out
}

/** A mapping row pre-filled from a learned message. */
export function matchFromMessage(m: MidiMessage): MidiMatch | null {
  if (m.kind !== 'noteon' && m.kind !== 'noteoff' && m.kind !== 'cc' && m.kind !== 'pc') return null
  return { kind: m.kind, channel: m.channel, number: m.number }
}

export function describeMatch(m: MidiMatch): string {
  const what = m.kind === 'noteon' ? 'Note' : m.kind === 'noteoff' ? 'Note Off' : m.kind === 'cc' ? 'CC' : 'Program'
  const num = m.number === undefined ? 'any' : m.kind.startsWith('note') ? `${m.number} (${noteName(m.number)})` : String(m.number)
  const val = m.value !== undefined ? ` = ${m.value}` : m.min !== undefined || m.max !== undefined ? ` ${m.min ?? 0}–${m.max ?? 127}` : ''
  return `${what} ${num}${val}${m.channel ? ` · ch ${m.channel}` : ' · any ch'}`
}

/* ───────────────────────────── ProPresenter-compatible preset ─────────────────────────────
 *
 * Source: Renewed Vision knowledge base, "Devices: MIDI: ProPresenter Setup" (article 1500000020301,
 * updated 2026-10-14), MIDI Map screenshot. ProPresenter's map is user-editable with an "Auto Fill"
 * from a starting note; the numbers below are the map shown in that article. The article text gives
 * examples one note higher (playlist 18 / item 19 / prop 25), i.e. a map auto-filled from 1 — pass
 * `offset: 1` for that. Top-section commands fire on the note with any velocity 1–127; "select by
 * index" commands use the velocity as a 1-based index.
 */
export const PRO_PRESET_ID = 'propresenter'

interface PresetRow { note: number; name: string; type: string; params?: Record<string, unknown>; index?: string; supported?: boolean }

export const PROPRESENTER_NOTE_MAP: PresetRow[] = [
  { note: 0, name: 'Clear All', type: 'live.clear', params: { layer: 'all' } },
  { note: 1, name: 'Clear Slide', type: 'live.clear', params: { layer: 'slide' } },
  { note: 2, name: 'Clear Background', type: 'live.clear', params: { layer: 'media' } },
  { note: 3, name: 'Clear Props', type: 'live.clear', params: { layer: 'props' } },
  { note: 4, name: 'Clear Audio', type: 'live.clear', params: { layer: 'audio' } },
  { note: 6, name: 'Video: Go to Beginning', type: 'media.transport', params: { layer: 'video', action: 'restart' } },
  { note: 7, name: 'Video: Play/Pause', type: 'media.transport', params: { layer: 'video', action: 'toggle' } },
  { note: 8, name: 'Video: Play', type: 'media.transport', params: { layer: 'video', action: 'play' } },
  { note: 9, name: 'Video: Pause', type: 'media.transport', params: { layer: 'video', action: 'pause' } },
  { note: 10, name: 'Next Playlist Item', type: 'playlist.item', params: { step: 1 } },
  { note: 11, name: 'Previous Playlist Item', type: 'playlist.item', params: { step: -1 } },
  { note: 12, name: 'Next Slide', type: 'live.next' },
  { note: 13, name: 'Previous Slide', type: 'live.prev' },
  { note: 14, name: 'Start Timeline', type: 'none', supported: false },
  { note: 15, name: 'Stop Timeline', type: 'none', supported: false },
  { note: 16, name: 'Rewind Timeline', type: 'none', supported: false },
  { note: 17, name: 'Select Playlist (velocity = number)', type: 'playlist.select', index: 'index' },
  { note: 18, name: 'Select Playlist Item (velocity = number)', type: 'playlist.item', index: 'index' },
  { note: 19, name: 'Trigger Slide (velocity = number)', type: 'live.slideIndex', index: 'index' },
  { note: 20, name: 'Select Media Playlist', type: 'none', supported: false },
  { note: 21, name: 'Trigger Media', type: 'none', supported: false },
  { note: 22, name: 'Select Audio Playlist (velocity = number)', type: 'audio.playlist', index: 'index', params: { play: false } },
  { note: 23, name: 'Trigger Audio (velocity = track)', type: 'audio.playlist', index: 'track' },
  { note: 24, name: 'Toggle Prop On/Off (velocity = number)', type: 'prop.toggle', index: 'index' },
  { note: 25, name: 'Start Timer (velocity = number)', type: 'timer.start', index: 'index' },
  { note: 26, name: 'Stop Timer (velocity = number)', type: 'timer.stop', index: 'index' },
  { note: 27, name: 'Reset Timer (velocity = number)', type: 'timer.reset', index: 'index' },
  { note: 28, name: 'Clear Messages', type: 'live.clear', params: { layer: 'message' } },
  { note: 29, name: 'Trigger Macro (velocity = number)', type: 'macro.run', index: 'index' },
  { note: 30, name: 'Clear Announcements', type: 'live.clear', params: { layer: 'announcement' } },
  { note: 31, name: 'Select Macro Collection', type: 'none', supported: false },
  { note: 32, name: 'Select Prop Collection', type: 'none', supported: false }
]

/** Build the editable mapping rows for the ProPresenter-compatible preset. `offset` shifts every note. */
export function proPresenterPreset(offset = 0): MidiMapping[] {
  return PROPRESENTER_NOTE_MAP.filter((r) => r.supported !== false && r.note + offset <= 127).map((r) => ({
    id: `pp-${r.note}`,
    name: r.name,
    enabled: true,
    preset: PRO_PRESET_ID,
    match: { kind: 'noteon' as const, number: r.note + offset },
    action: { type: r.type, params: r.params },
    // Velocity is a 1-based index in ProPresenter; our index params are 1-based too ("slide 6" is the 6th slide).
    valueParam: r.index ? { key: r.index, from: 'value' as const } : undefined
  }))
}

/** Replace any existing rows from the same preset, keep the user's own rows. */
export function applyPreset(doc: MidiDoc, rows: MidiMapping[], presetId = PRO_PRESET_ID): MidiDoc {
  return { ...doc, mappings: [...doc.mappings.filter((m) => m.preset !== presetId), ...rows] }
}

/* ───────────────────────────── Devices & monitor ───────────────────────────── */

export interface MidiPorts {
  /** False when no MIDI backend could be loaded on this computer. */
  available: boolean
  /** Why MIDI is unavailable, in plain words. */
  reason?: string
  inputs: { name: string; open: boolean }[]
  outputs: { name: string; open: boolean }[]
  /** A virtual "Reach Presenter" port other apps can connect to (macOS / Linux). */
  virtual: { supported: boolean; open: boolean; name: string }
}

/** Per-computer MIDI settings (not synced — every machine has its own gear). */
export interface MidiDeviceSettings {
  /** Listen to every input that shows up (default) or only the ones listed. */
  allInputs: boolean
  inputs: string[]
  /** Outputs to send to; empty = every output. */
  outputs: string[]
  virtualPort: boolean
}

export const defaultMidiDevices = (): MidiDeviceSettings => ({ allInputs: true, inputs: [], outputs: [], virtualPort: true })

export interface MidiLogEntry {
  id: number
  at: number
  dir: 'in' | 'out'
  port: string
  bytes: number[]
  text: string
  /** Names of the mappings this message fired. */
  fired?: string[]
}

export interface MidiSendParams {
  kind?: MidiKind | 'raw'
  channel?: number
  number?: number
  value?: number
  /** Hex bytes for raw / sysex. */
  bytes?: string
  /** Output port name; empty = every enabled output. */
  output?: string
  /** For Note On: send the matching Note Off after this many milliseconds. */
  duration?: number
}

export function messageFromParams(p: MidiSendParams): MidiMessage {
  const kind = p.kind ?? 'noteon'
  if (kind === 'raw') return { kind: 'other', bytes: parseBytes(p.bytes ?? '') }
  if (kind === 'sysex') return { kind: 'sysex', bytes: parseBytes(p.bytes ?? '') }
  return { kind, channel: p.channel ?? 1, number: p.number ?? 60, value: p.value ?? (kind === 'noteon' ? 127 : 0) }
}

declare module './api' {
  interface ApiMethods {
    'midi.ports': { req: void; res: MidiPorts }
    'midi.devices': { req: Partial<MidiDeviceSettings> | void; res: MidiDeviceSettings }
    'midi.mappings': { req: void; res: MidiDoc }
    'midi.saveMapping': { req: { mapping: Partial<MidiMapping> & Pick<MidiMapping, 'match' | 'action'> }; res: MidiMapping }
    'midi.removeMapping': { req: { id: ID }; res: void }
    'midi.setEnabled': { req: { enabled: boolean }; res: MidiDoc }
    /** Add (or refresh) the ProPresenter-compatible note map. */
    'midi.applyPreset': { req: { preset: 'propresenter'; offset?: number; remove?: boolean }; res: MidiDoc }
    /** Wait for the next incoming note/CC/program change and return it (null on timeout). */
    'midi.learn': { req: { timeoutMs?: number } | void; res: { message: MidiMessage; port: string } | null }
    'midi.cancelLearn': { req: void; res: void }
    'midi.send': { req: MidiSendParams; res: void }
    'midi.log': { req: void; res: MidiLogEntry[] }
    /** Pretend a message arrived — for testing a mapping without hardware. */
    'midi.simulate': { req: { message?: MidiMessage; bytes?: number[]; port?: string }; res: string[] }
  }
  interface ApiEvents {
    'midi.message': MidiLogEntry
    'midi.portsChanged': MidiPorts
  }
}
