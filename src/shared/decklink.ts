/**
 * Blackmagic DeckLink SDI outputs — shared types, RPC contract and PURE helpers (no Electron, no Node).
 * The native side lives in native/decklink (built on the Mac, see docs/decklink.md); the main-process
 * wrapper is src/main/services/outputs/decklink.ts.
 */
import type { ID } from './model'

export type DeckLinkKeying = 'none' | 'external' | 'internal'
export type DeckLinkAlign = 'top-left' | 'center'

export interface DeckLinkMode {
  /** DeckLink BMDDisplayMode as its four characters, e.g. "Hp29" = 1080p29.97, "Hp60" = 1080p60. */
  id: string
  name: string
  width: number
  height: number
  fps: number
  /** Exact rate = timeScale / frameDuration (e.g. 30000/1001). */
  frameDuration?: number
  timeScale?: number
  interlaced?: boolean
}

/** One DeckLink port ("sub-device") as the native module lists it. */
export interface DeckLinkNativeDevice {
  index: number
  /** Model, e.g. "DeckLink Duo 2". */
  name: string
  /** e.g. "DeckLink Duo (2)". */
  displayName: string
  persistentId?: string
  subDevice?: number
  subDevices?: number
  /** Number of video outputs (0 = capture-only port). */
  outputs: number
  supportsKeying: boolean
  externalKeying?: boolean
  internalKeying?: boolean
  modes: DeckLinkMode[]
}

/** A port as Reach remembers it on this machine (identity = model + port number). */
export interface DeckLinkDevice extends DeckLinkNativeDevice {
  /** Stable identity used in Output.target.device: "DeckLink Duo 2 · port 2". */
  key: string
  port: number
  connected: boolean
  lastSeen?: number
}

export type DeckLinkState = 'ready' | 'not-built' | 'no-driver' | 'error'

export interface DeckLinkStatus {
  state: DeckLinkState
  available: boolean
  /** Plain-language status line. */
  message: string
  driverVersion?: string
  apiVersion?: string
  outputs: { outputId: ID; name: string; device: string; mode: string; fps: number; fresh: number; repeated: number; late: number; dropped: number; buffered: number; problem?: string }[]
}

declare module './model' {
  interface Output {
    /** DeckLink outputs: where a picture smaller than the SDI frame sits. Default top-left (what LED processors expect). */
    decklinkAlign?: DeckLinkAlign
  }
}

declare module './api' {
  interface ApiMethods {
    'decklink.status': { req: void; res: DeckLinkStatus }
    /** DeckLink ports on this computer (connected + remembered). `refresh` re-scans the hardware. */
    'decklink.devices': { req: { refresh?: boolean } | void; res: DeckLinkDevice[] }
    'decklink.forget': { req: { key: string }; res: DeckLinkDevice[] }
  }
  interface ApiEvents {
    'decklink.devicesChanged': DeckLinkDevice[]
  }
}

export const DECKLINK_MESSAGES = {
  notBuilt: 'DeckLink output not built — run npm run build:decklink on this computer (see docs/decklink.md).',
  noDriver: 'DeckLink driver not installed — install Blackmagic Desktop Video, then restart Reach.',
  busy: (port: string): string => `“${port}” is busy (is ProPresenter running?). Quit the other app — Reach keeps trying and starts by itself.`,
  noDevices: 'Desktop Video is installed but no DeckLink card was found. Check the card (or Thunderbolt cable) and Blackmagic Desktop Video Setup.'
} as const

/** Port number (1-based) of a device: the sub-device index, else "(n)" in its display name, else 1 (single-port device). */
export function deckLinkPort(d: Pick<DeckLinkNativeDevice, 'displayName' | 'index' | 'subDevice'>): number {
  if (typeof d.subDevice === 'number' && d.subDevice >= 0) return d.subDevice + 1
  const m = /\((\d+)\)\s*$/.exec(d.displayName)
  return m ? Number(m[1]) : 1 // a single-port device
}

/**
 * Give every native device its stable key "<model> · port <n>". Two identical cards in one computer would collide,
 * so the second gets "<model> (2) · port <n>" (in the order the driver lists them, which follows the PCIe slot).
 */
export function deckLinkDevices(list: DeckLinkNativeDevice[], now = Date.now()): DeckLinkDevice[] {
  const seen = new Map<string, number>()
  return list.map((d) => {
    const port = deckLinkPort(d)
    const model = d.name || d.displayName.replace(/\s*\(\d+\)\s*$/, '') || 'DeckLink'
    const base = `${model} · port ${port}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    const key = n === 1 ? base : `${model} (${n}) · port ${port}`
    return { ...d, key, port, connected: true, lastSeen: now }
  })
}

/** Merge live devices with remembered ones (remembered-but-missing stay listed as not connected). */
export function mergeDeckLinkDevices(live: DeckLinkDevice[], remembered: DeckLinkDevice[]): DeckLinkDevice[] {
  const keys = new Set(live.map((d) => d.key))
  return [...live, ...remembered.filter((d) => !keys.has(d.key)).map((d) => ({ ...d, connected: false }))]
}

/** The mode a new output should start with: the church standard 1080p29.97, else any progressive 1080 mode, else the first. */
export function defaultDeckLinkMode(modes: DeckLinkMode[], preferred = 'Hp29'): DeckLinkMode | undefined {
  return modes.find((m) => m.id === preferred)
    ?? modes.find((m) => m.width === 1920 && m.height === 1080 && !m.interlaced && Math.abs(m.fps - 29.97) < 0.01)
    ?? modes.find((m) => m.width === 1920 && m.height === 1080 && !m.interlaced)
    ?? modes[0]
}

/** Modes sorted for a picker: progressive first, then by size (largest first), then by rate. */
export function sortDeckLinkModes(modes: DeckLinkMode[]): DeckLinkMode[] {
  return [...modes].sort((a, b) => Number(!!a.interlaced) - Number(!!b.interlaced) || b.height - a.height || b.width - a.width || a.fps - b.fps)
}

/** "1080p 29.97" style label when the driver's own name is missing. */
export function deckLinkModeLabel(m: DeckLinkMode): string {
  if (m.name) return m.name
  const rate = Number.isInteger(m.fps) ? String(m.fps) : m.fps.toFixed(2)
  return `${m.height}${m.interlaced ? 'i' : 'p'} ${rate}`
}

/** Exact rational frame rate for pacing (falls back to the float). */
export function deckLinkRate(m: Pick<DeckLinkMode, 'fps' | 'frameDuration' | 'timeScale'>): { num: number; den: number } {
  if (m.frameDuration && m.timeScale) return { num: m.timeScale, den: m.frameDuration }
  // 29.97 → 30000/1001 etc.
  const ntsc = [24, 30, 60, 120].find((f) => Math.abs(m.fps - (f * 1000) / 1001) < 0.005)
  return ntsc ? { num: ntsc * 1000, den: 1001 } : { num: Math.round(m.fps * 1000), den: 1000 }
}

export const KEYING_LABELS: Record<DeckLinkKeying, string> = {
  none: 'Picture only',
  external: 'Fill + key to the switcher (uses the paired SDI port for the key)',
  internal: 'Key over the card’s own SDI input'
}
