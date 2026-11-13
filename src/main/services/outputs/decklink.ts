/**
 * Blackmagic DeckLink SDI output — OPTIONAL. The native addon (native/decklink) is built on the Mac against the
 * Desktop Video SDK the tech lead downloads (docs/decklink.md). It is looked up lazily; without it the app runs
 * normally and DeckLink outputs say "DeckLink output not built — run npm run build:decklink".
 *
 *   offscreen output window ──paint──▶ FramePump ──(FramePacer @ mode rate)──▶ DeckLinkSink ──▶ native pushFrame
 *
 * The native side runs scheduled playback and repeats the last frame by itself, so SDI never stalls even if JS does.
 * UNVERIFIED on hardware. Verified here: everything in this file against a fake native module (tests/decklink.test.ts)
 * and the capture path via REACH_FAKE_DECKLINK=1.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import {
  DECKLINK_MESSAGES, deckLinkDevices, deckLinkRate, mergeDeckLinkDevices,
  type DeckLinkAlign, type DeckLinkDevice, type DeckLinkKeying, type DeckLinkMode, type DeckLinkNativeDevice, type DeckLinkState
} from '@shared/decklink'
import type { Frame, FrameSink, FrameSinkOptions } from './frames'
import { createFakeDeckLink } from './decklink-fake'

/* ───────────────────────── native module contract ───────────────────────── */

export interface DeckLinkHandleStats { fresh: number; repeated: number; late: number; dropped: number; errors: number; buffered: number }
export interface DeckLinkHandle {
  width: number
  height: number
  fps: number
  pushFrame(bgra: Buffer, width: number, height: number): void
  stats(): DeckLinkHandleStats
  close(): Promise<void>
}
export interface DeckLinkOpenOptions { device: number; displayName?: string; mode: string; keying: DeckLinkKeying; keyLevel: number; align?: DeckLinkAlign }
export interface NativeDeckLink {
  listDevices(): Promise<DeckLinkNativeDevice[]>
  open(opts: DeckLinkOpenOptions): Promise<DeckLinkHandle>
  /** null = Desktop Video isn't installed. */
  driverVersion?(): string | null
  apiVersion?: string
}

/* ───────────────────────── lazy loading ───────────────────────── */

export interface DeckLinkLoad { lib: NativeDeckLink | null; state: DeckLinkState; reason?: string; driverVersion?: string; apiVersion?: string; path?: string }

let cached: DeckLinkLoad | null = null
let override: NativeDeckLink | null | undefined

/** Tests: inject a fake native module (null = "not built"); undefined = back to normal lookup. */
export function setDeckLinkModuleForTests(lib: NativeDeckLink | null | undefined): void {
  override = lib
  cached = null
}

/** Where the built addon may be: env override, packaged app (extraResources), dev tree. */
export function deckLinkCandidates(env = process.env, resourcesPath = (process as { resourcesPath?: string }).resourcesPath, dir = __dirname): string[] {
  const file = 'reach_decklink.node'
  return [
    env.REACH_DECKLINK_MODULE,
    resourcesPath ? join(resourcesPath, 'decklink', file) : undefined,
    join(dir, '../../native/decklink/build/Release', file), // out/main → repo root
    join(dir, '../../../../native/decklink/build/Release', file), // src/main/services/outputs (tests / tsx)
    join(process.cwd(), 'native/decklink/build/Release', file)
  ].filter((x): x is string => !!x)
}

function classify(lib: NativeDeckLink, path?: string): DeckLinkLoad {
  let driverVersion: string | null | undefined
  try { driverVersion = lib.driverVersion ? lib.driverVersion() : 'unknown' } catch { driverVersion = null }
  if (driverVersion === null) return { lib: null, state: 'no-driver', reason: DECKLINK_MESSAGES.noDriver, apiVersion: lib.apiVersion, path }
  return { lib, state: 'ready', driverVersion: driverVersion ?? undefined, apiVersion: lib.apiVersion, path }
}

/** Load the DeckLink addon once. Never throws. */
export function loadDeckLink(): DeckLinkLoad {
  if (cached) return cached
  if (override !== undefined) return (cached = override ? classify(override) : { lib: null, state: 'not-built', reason: DECKLINK_MESSAGES.notBuilt })
  if (process.env.REACH_FAKE_DECKLINK) return (cached = classify(createFakeDeckLink()))
  const req = createRequire(__filename)
  let lastError = ''
  for (const p of deckLinkCandidates()) {
    try {
      const lib = req(p) as NativeDeckLink
      if (typeof lib?.open !== 'function' || typeof lib?.listDevices !== 'function') { lastError = `${p} is not the Reach DeckLink addon`; continue }
      return (cached = classify(lib, p))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!/Cannot find module|no such file|ENOENT/i.test(msg)) lastError = msg // found but failed to load: worth showing
    }
  }
  return (cached = lastError
    ? { lib: null, state: 'error', reason: `DeckLink output could not start: ${lastError}. Rebuild it with npm run build:decklink.` }
    : { lib: null, state: 'not-built', reason: DECKLINK_MESSAGES.notBuilt })
}

/* ───────────────────────── device registry (per machine) ───────────────────────── */

export interface DeckLinkStore { load(): DeckLinkDevice[]; save(list: DeckLinkDevice[]): void }

/**
 * Lists ports and remembers them on this machine, so an output pointed at "DeckLink Duo 2 · port 2" keeps its
 * role across restarts and shows "not connected" (rather than vanishing) if the card or Thunderbolt box is missing.
 */
export class DeckLinkRegistry {
  private live: DeckLinkDevice[] = []
  private scanned = false
  private problem: string | undefined
  private listeners: ((list: DeckLinkDevice[]) => void)[] = []
  private sig = ''
  private scanning: Promise<DeckLinkDevice[]> | null = null

  constructor(private store: DeckLinkStore, private now: () => number = Date.now) {}

  onChange(fn: (list: DeckLinkDevice[]) => void): void { this.listeners.push(fn) }

  /** Re-scan the hardware (coalesced). Never throws. */
  refresh(): Promise<DeckLinkDevice[]> {
    if (this.scanning) return this.scanning
    this.scanning = (async () => {
      const { lib, reason } = loadDeckLink()
      if (!lib) { this.live = []; this.problem = reason }
      else {
        try {
          this.live = deckLinkDevices((await lib.listDevices()).filter((d) => d.outputs > 0), this.now())
          this.problem = this.live.length ? undefined : DECKLINK_MESSAGES.noDevices
        } catch (e) {
          this.live = []
          this.problem = (e as { code?: string }).code === 'NO_DRIVER' ? DECKLINK_MESSAGES.noDriver : `Could not list DeckLink devices: ${(e as Error).message}`
        }
      }
      this.scanned = true
      if (this.live.length) {
        const keep = this.store.load().filter((d) => !this.live.some((l) => l.key === d.key))
        this.store.save([...this.live.map((d) => ({ ...d, connected: true })), ...keep])
      }
      const list = this.list()
      const sig = JSON.stringify(list.map((d) => [d.key, d.connected, d.index, d.displayName, d.modes.length]))
      if (sig !== this.sig) { this.sig = sig; for (const fn of this.listeners) fn(list) }
      return list
    })().finally(() => { this.scanning = null })
    return this.scanning
  }

  /** Connected ports first, then remembered ones that are missing right now. */
  list(): DeckLinkDevice[] { return mergeDeckLinkDevices(this.live, this.store.load()) }
  find(key: string): DeckLinkDevice | undefined { return this.list().find((d) => d.key === key) }
  hasScanned(): boolean { return this.scanned }
  /** Why there are no usable ports (not built / no driver / no card). */
  reason(): string | undefined { return this.problem }

  forget(key: string): DeckLinkDevice[] {
    this.store.save(this.store.load().filter((d) => d.key !== key))
    return this.list()
  }
}

/* ───────────────────────── pacing ───────────────────────── */

export interface PacerClock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(t: unknown): void }
const realClock: PacerClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t as NodeJS.Timeout)
}

/**
 * Calls `onTick` at an exact rational rate (30000/1001 for 29.97) without drift: tick n is due at t0 + n·den/num s,
 * so timer jitter never accumulates. If the process stalls for more than a few frames it resyncs instead of bursting.
 */
export class FramePacer {
  private t0 = 0
  private n = 0
  private timer: unknown = null
  private running = false
  ticks = 0
  resyncs = 0

  constructor(private rate: { num: number; den: number }, private onTick: () => void, private clock: PacerClock = realClock) {}

  get intervalMs(): number { return (1000 * this.rate.den) / this.rate.num }

  start(): void {
    if (this.running) return
    this.running = true
    this.t0 = this.clock.now()
    this.n = 0
    this.schedule()
  }

  private schedule(): void {
    if (!this.running) return
    this.n++
    const due = this.t0 + this.n * this.intervalMs
    this.timer = this.clock.setTimeout(() => this.fire(), Math.max(0, due - this.clock.now()))
  }

  private fire(): void {
    if (!this.running) return
    this.ticks++
    try { this.onTick() } catch { /* a sink error must not stop the clock */ }
    const late = this.clock.now() - (this.t0 + this.n * this.intervalMs)
    if (late > this.intervalMs * 4) { this.t0 = this.clock.now(); this.n = 0; this.resyncs++ }
    this.schedule()
  }

  stop(): void {
    this.running = false
    if (this.timer != null) this.clock.clearTimeout(this.timer)
    this.timer = null
  }
}

/* ───────────────────────── the sink ───────────────────────── */

export interface DeckLinkSinkConfig {
  device: string
  index: number
  displayName: string
  mode: string
  keying: DeckLinkKeying
  keyLevel: number
  align?: DeckLinkAlign
}

/**
 * FrameSink for one DeckLink port. open() never throws for "busy"/"missing": it records a plain-language problem
 * (shown as the output's health) and send() retries every few seconds, so quitting ProPresenter is enough.
 */
export class DeckLinkSink implements FrameSink {
  readonly kind = 'decklink'
  private handle: DeckLinkHandle | null = null
  private lastData: Buffer | null = null
  private lastTry = 0
  private opening: Promise<void> | null = null
  private err: string | undefined
  private closed = false
  /** Frames JS didn't re-send because the card repeats the last one itself. */
  skippedRepeats = 0
  pushed = 0

  constructor(readonly cfg: DeckLinkSinkConfig, private now: () => number = Date.now, private retryMs = 3000) {}

  async open(_opts: FrameSinkOptions): Promise<void> { await this.tryOpen() }

  private tryOpen(): Promise<void> {
    if (this.opening) return this.opening
    this.lastTry = this.now()
    this.opening = (async () => {
      const { lib, reason } = loadDeckLink()
      if (!lib) { this.err = reason ?? DECKLINK_MESSAGES.notBuilt; return }
      try {
        const h = await lib.open({ device: this.cfg.index, displayName: this.cfg.displayName, mode: this.cfg.mode, keying: this.cfg.keying, keyLevel: this.cfg.keyLevel, align: this.cfg.align })
        if (this.closed) { await h.close(); return }
        this.handle = h
        this.err = undefined
        this.lastData = null
      } catch (e) {
        this.err = describeOpenError(e, this.cfg.device)
      }
    })().finally(() => { this.opening = null })
    return this.opening
  }

  async send(frame: Frame): Promise<void> {
    if (this.closed) return
    if (!this.handle) {
      if (this.now() - this.lastTry >= this.retryMs) await this.tryOpen()
      if (!this.handle) return
    }
    // Same buffer as last time = the page hasn't changed: the card is already repeating it, so skip the copy.
    if (frame.data === this.lastData) { this.skippedRepeats++; return }
    try {
      this.handle.pushFrame(frame.data, frame.width, frame.height)
      this.lastData = frame.data
      this.pushed++
    } catch (e) {
      // The port went away (unplugged Thunderbolt box, driver restart): drop the handle and retry.
      this.err = `“${this.cfg.device}” stopped: ${(e as Error).message}. Reach keeps trying.`
      const h = this.handle
      this.handle = null
      this.lastTry = this.now()
      void h.close().catch(() => {})
    }
  }

  async close(): Promise<void> {
    this.closed = true
    const h = this.handle
    this.handle = null
    if (this.opening) await this.opening.catch(() => {})
    await h?.close().catch(() => {})
  }

  isOpen(): boolean { return !!this.handle }
  problem(): string | undefined { return this.handle ? undefined : this.err }
  stats(): DeckLinkHandleStats | null {
    try { return this.handle?.stats() ?? null } catch { return null }
  }
}

export function describeOpenError(e: unknown, port: string): string {
  const code = (e as { code?: string })?.code
  const msg = e instanceof Error ? e.message : String(e)
  switch (code) {
    case 'BUSY': return DECKLINK_MESSAGES.busy(port)
    case 'NO_DRIVER': return DECKLINK_MESSAGES.noDriver
    case 'NO_DEVICE': return `“${port}” isn’t connected right now. It comes back by itself when the card is found again.`
    case 'NO_MODE': return `“${port}” can’t send that video mode. Pick another mode in the output’s settings.`
    case 'NO_KEYING': return `“${port}” can’t do that kind of keying. Choose “Picture only”, or use the card’s first port for fill + key.`
    default: return `“${port}” could not start: ${msg}`
  }
}

/** Pacing rate for a planned DeckLink output. */
export function rateForMode(m: Pick<DeckLinkMode, 'fps' | 'frameDuration' | 'timeScale'>): { num: number; den: number } {
  return deckLinkRate(m)
}
