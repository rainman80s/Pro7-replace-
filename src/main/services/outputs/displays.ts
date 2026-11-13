/**
 * Display identity + memory on this computer. Wraps Electron's `screen` and the pure matcher in @shared/outputs.
 *
 *  - Fingerprints (label, native size, position, internal, id) are stored per machine in `local` ('displays.known').
 *  - display-added / removed / metrics-changed bursts are debounced (a projector waking up fires a dozen events).
 *  - The screen holding the operator window is flagged so it is never matched by guesswork or covered.
 *  - REACH_FAKE_DISPLAYS='[{"id":2,"label":"TV","bounds":{...},"scaleFactor":1,"internal":false}]' (or the
 *    local-only RPC outputs.simulateDisplays) replaces the real display list — used by the xvfb e2e test.
 */
import { screen, type BrowserWindow } from 'electron'
import type { DisplayInfo } from '@shared/api'
import type { Output } from '@shared/model'
import { nativeSize, reconcileDisplays, type DisplayFingerprint, type DisplaySnapshot } from '@shared/outputs'
import type { PlanDisplay } from './plan'

interface Store { get<T>(k: string, f: T): T; set(k: string, v: unknown): void }

/** The baseline version's key format (label|WxH|ext), reused on first run so existing outputs keep their display. */
const legacyOf = (d: DisplaySnapshot): string => `${d.label || 'Display'}|${d.bounds.width}x${d.bounds.height}|${d.internal ? 'int' : 'ext'}`

export class DisplayManager {
  known: DisplayFingerprint[] = []
  private keys = new Map<number, string>()
  private snaps: DisplaySnapshot[] = []
  private fake: DisplaySnapshot[] | null = null
  private timer: NodeJS.Timeout | null = null
  private listeners = new Set<() => void>()
  private lastOperatorId: number | null = null

  constructor(private store: Store, private operatorWindow: () => BrowserWindow | null, private debounceMs = 700) {
    this.known = store.get<DisplayFingerprint[]>('displays.known', [])
    const env = process.env.REACH_FAKE_DISPLAYS
    if (env) try { this.fake = JSON.parse(env) } catch { /* ignore */ }
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  start(): void {
    const kick = (): void => this.schedule()
    screen.on('display-added', kick)
    screen.on('display-removed', kick)
    screen.on('display-metrics-changed', kick)
    this.refresh()
  }

  /** Debounced refresh. */
  schedule(ms = this.debounceMs): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; this.refresh() }, ms)
  }

  simulate(list: DisplaySnapshot[] | null): void {
    this.fake = list
    this.schedule(50)
  }

  get simulated(): boolean { return !!this.fake }

  private operatorDisplayId(all: DisplaySnapshot[]): number | null {
    const w = this.operatorWindow()
    if (!w || w.isDestroyed()) return all.find((d) => d.primary)?.id ?? null
    const b = w.getBounds()
    const cx = b.x + b.width / 2
    const cy = b.y + b.height / 2
    const inside = all.find((d) => cx >= d.bounds.x && cx < d.bounds.x + d.bounds.width && cy >= d.bounds.y && cy < d.bounds.y + d.bounds.height)
    if (inside) return inside.id
    if (!this.fake) try { return screen.getDisplayMatching(b).id } catch { /* fall through */ }
    return all.find((d) => d.primary)?.id ?? null
  }

  private read(): DisplaySnapshot[] {
    if (this.fake) return this.fake.map((d, i) => ({ ...d, primary: d.primary ?? i === 0 }))
    let primaryId = -1
    try { primaryId = screen.getPrimaryDisplay().id } catch { /* no display */ }
    return screen.getAllDisplays().map((d) => ({ id: d.id, label: d.label ?? '', bounds: { ...d.bounds }, scaleFactor: d.scaleFactor, rotation: d.rotation, internal: !!d.internal, primary: d.id === primaryId }))
  }

  /** Re-read displays and re-match identities. Never throws. */
  refresh(): void {
    try {
      const all = this.read()
      const op = this.operatorDisplayId(all)
      this.lastOperatorId = op
      for (const d of all) d.operator = d.id === op
      const usedLegacy = new Set(this.known.map((k) => k.key))
      const queue = [...all]
      const mint = (): string => {
        // First run after the baseline version: reuse its "label|WxH|ext" keys so old outputs keep working.
        const d = queue.find((x) => !usedLegacy.has(legacyOf(x)))
        const k = d ? legacyOf(d) : `disp-${Math.random().toString(36).slice(2, 10)}`
        usedLegacy.add(k)
        return k
      }
      const r = reconcileDisplays(this.known, all, Date.now(), this.known.length ? () => `disp-${Math.random().toString(36).slice(2, 10)}` : mint)
      this.known = r.known
      this.keys = r.keys
      this.snaps = all
      this.store.set('displays.known', this.known)
    } catch (e) {
      console.error('[displays] refresh failed', e)
    }
    this.listeners.forEach((l) => { try { l() } catch (e) { console.error(e) } })
  }

  /** The operator window moved: re-flag the operator screen if it changed. */
  operatorMoved(): void {
    const op = this.operatorDisplayId(this.snaps)
    if (op !== this.lastOperatorId) this.schedule(300)
  }

  operatorKey(): string | undefined {
    const d = this.snaps.find((x) => x.operator)
    return d ? this.keys.get(d.id) : undefined
  }

  planDisplays(): PlanDisplay[] {
    const live = this.snaps.map((d) => {
      const key = this.keys.get(d.id)!
      const fp = this.known.find((k) => k.key === key)
      return { key, label: fp?.customName || d.label || (d.internal ? 'Built-in display' : 'Display'), bounds: { ...d.bounds }, size: nativeSize(d), connected: true, operator: !!d.operator, lastSeen: Date.now() }
    })
    const liveKeys = new Set(live.map((d) => d.key))
    const gone = this.known.filter((k) => !liveKeys.has(k.key)).map((k) => ({
      key: k.key, label: k.customName || k.label || 'Display', bounds: { x: k.position.x, y: k.position.y, width: Math.round(k.native.width / k.scaleFactor), height: Math.round(k.native.height / k.scaleFactor) },
      size: k.native, connected: false, operator: false, lastSeen: k.lastSeen
    }))
    return [...live, ...gone]
  }

  /** DisplayInfo for the UI: everything plugged in, plus remembered displays that have outputs or a custom name. */
  list(outputs: Output[]): DisplayInfo[] {
    const idsFor = (key: string): string[] => outputs.filter((o) => o.target.type === 'display' && o.target.displayKey === key).map((o) => o.id)
    const out: DisplayInfo[] = []
    for (const d of this.snaps) {
      const key = this.keys.get(d.id)!
      const fp = this.known.find((k) => k.key === key)
      out.push({
        key, id: d.id, label: d.label || (d.internal ? 'Built-in display' : `Display ${out.length + 1}`), bounds: { ...d.bounds }, scaleFactor: d.scaleFactor,
        internal: d.internal, primary: d.primary, outputIds: idsFor(key), connected: true, operator: !!d.operator, nativeSize: nativeSize(d),
        rotation: d.rotation ?? 0, customName: fp?.customName, lastSeen: Date.now()
      })
    }
    const live = new Set(out.map((d) => d.key))
    for (const k of this.known) {
      if (live.has(k.key)) continue
      const ids = idsFor(k.key)
      if (!ids.length && !k.customName) continue
      out.push({
        key: k.key, id: k.electronId, label: k.label || 'Display', bounds: { x: k.position.x, y: k.position.y, width: Math.round(k.native.width / k.scaleFactor), height: Math.round(k.native.height / k.scaleFactor) },
        scaleFactor: k.scaleFactor, internal: k.internal, primary: false, outputIds: ids, connected: false, operator: false, nativeSize: k.native,
        rotation: k.rotation, customName: k.customName, lastSeen: k.lastSeen
      })
    }
    return out
  }

  rename(key: string, name: string): void {
    this.known = this.known.map((k) => (k.key === key ? { ...k, customName: name.trim() || undefined } : k))
    this.store.set('displays.known', this.known)
    this.listeners.forEach((l) => l())
  }

  forget(key: string): void {
    if (this.snaps.some((d) => this.keys.get(d.id) === key)) return // plugged in: nothing to forget
    this.known = this.known.filter((k) => k.key !== key)
    this.store.set('displays.known', this.known)
    this.listeners.forEach((l) => l())
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
  }
}
