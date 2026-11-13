/**
 * Output windows on this computer: fullscreen-on-a-display, floating, and offscreen capture (NDI).
 *
 * Fullscreen strategy (per docs/research/landscape-and-formats.md §3.8):
 *  - frameless, non-focusable window placed at the display's bounds, then placed AGAIN after show (mixed-DPI Windows);
 *  - macOS: 'panel' type + 'pop-up-menu' level + visible on all Spaces, NOT native fullscreen (no new Space, no animation);
 *  - Windows/Linux: 'screen-saver' level, skipTaskbar; cursor hidden by output.html CSS;
 *  - shown with showInactive() so it never steals focus from the operator.
 * Recovery: render-process-gone → rebuild with backoff; unresponsive for 4 s → kill + rebuild; failed load → retry.
 * Sleep/wake: on resume / unlock / display change, every window is re-placed and re-raised.
 */
import { BrowserWindow, powerMonitor, powerSaveBlocker, type NativeImage } from 'electron'
import { join } from 'node:path'
import type { ID } from '@shared/model'
import type { ServiceContext } from '../../core/service'
import { FramePump, type FrameSink } from './frames'
import { windowSignature, type PlannedWindow } from './plan'

interface Entry {
  win: BrowserWindow
  plan: PlannedWindow
  sig: string
  loaded: boolean
  crashes: number
  recovering: boolean
  lastCrash: number
  hangTimer?: NodeJS.Timeout
  pump?: FramePump
  lastPaint?: NativeImage
}

export interface WindowRuntime { loaded: boolean; crashes: number; recovering: boolean; fps?: number }

export class OutputWindows {
  private entries = new Map<ID, Entry>()
  private desired: PlannedWindow[] = []
  private blocker: number | null = null
  private rebuildTimers = new Map<ID, NodeJS.Timeout>()
  private crashCounts = new Map<ID, { n: number; at: number }>()
  /** Fired when a runtime fact changes (loaded / crashed) so health can be recomputed. */
  onRuntime: () => void = () => {}
  /** Floating window closed by the user. */
  onUserClosed: (id: ID) => void = () => {}

  constructor(private ctx: ServiceContext, private makeSink: () => FrameSink) {
    const reraise = (): void => { setTimeout(() => this.reraiseAll(), 1500) }
    powerMonitor.on('resume', reraise)
    powerMonitor.on('unlock-screen', reraise)
  }

  runtime(): Record<ID, WindowRuntime> {
    const out: Record<ID, WindowRuntime> = {}
    for (const [id, e] of this.entries) out[id] = { loaded: e.loaded, crashes: e.crashes, recovering: e.recovering, fps: e.pump?.stats.fps }
    for (const [id] of this.rebuildTimers) out[id] = { loaded: false, crashes: this.crashCounts.get(id)?.n ?? 1, recovering: true }
    return out
  }

  pumpStats(id: ID): FramePump['stats'] | undefined {
    return this.entries.get(id)?.pump?.stats
  }

  /** Make the open windows match the plan. Cheap to call often. */
  apply(plan: PlannedWindow[]): void {
    this.desired = plan
    const want = new Map(plan.map((p) => [p.outputId, p]))
    for (const [id, e] of this.entries) {
      const p = want.get(id)
      if (!p || windowSignature(p) !== e.sig) this.close(id)
    }
    for (const [id, t] of this.rebuildTimers) if (!want.has(id)) { clearTimeout(t); this.rebuildTimers.delete(id) }
    for (const p of plan) {
      const e = this.entries.get(p.outputId)
      if (!e) { if (!this.rebuildTimers.has(p.outputId)) this.open(p) }
      else if (p.kind === 'display') { e.plan = p; this.place(e) }
    }
    this.updateBlocker()
  }

  private updateBlocker(): void {
    const need = [...this.entries.values()].some((e) => e.plan.kind !== 'window')
    if (need && this.blocker == null) this.blocker = powerSaveBlocker.start('prevent-display-sleep')
    if (!need && this.blocker != null) { powerSaveBlocker.stop(this.blocker); this.blocker = null }
  }

  private open(p: PlannedWindow): void {
    const webPreferences: Electron.WebPreferences = { preload: join(__dirname, '../preload/index.js'), sandbox: false, backgroundThrottling: false }
    let win: BrowserWindow
    if (p.kind === 'display') {
      const mac = process.platform === 'darwin'
      win = new BrowserWindow({
        ...p.bounds, show: false, frame: false, backgroundColor: '#000000', resizable: false, movable: false, minimizable: false, maximizable: false,
        fullscreenable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true, hasShadow: false, enableLargerThanScreen: true,
        roundedCorners: false, title: 'Reach Output', ...(mac ? { type: 'panel' } : {}), webPreferences
      })
    } else if (p.kind === 'capture') {
      win = new BrowserWindow({
        width: p.size.width, height: p.size.height, show: false, frame: false, transparent: p.transparent, backgroundColor: p.transparent ? '#00000000' : '#000000',
        useContentSize: true, webPreferences: { ...webPreferences, offscreen: true }
      })
    } else {
      win = new BrowserWindow({ width: 960, height: 540, show: false, backgroundColor: '#000000', title: 'Reach Output', autoHideMenuBar: true, webPreferences })
    }
    win.setMenuBarVisibility(false)
    const prior = this.crashCounts.get(p.outputId)
    const e: Entry = { win, plan: p, sig: windowSignature(p), loaded: false, crashes: prior?.n ?? 0, recovering: false, lastCrash: prior?.at ?? 0 }
    this.entries.set(p.outputId, e)
    const wc = win.webContents
    wc.setBackgroundThrottling(false)
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      if (p.kind === 'display') { this.place(e); win.showInactive(); this.place(e) }
      else if (p.kind === 'window') win.showInactive()
    })
    wc.on('did-finish-load', () => { e.loaded = true; e.recovering = false; this.onRuntime() })
    wc.on('did-fail-load', (_ev, code, _desc, _url, isMain) => {
      if (!isMain || code === -3) return // -3 = aborted by a newer navigation
      setTimeout(() => { if (!win.isDestroyed()) void this.load(e) }, 1000)
    })
    wc.on('render-process-gone', (_ev, details) => {
      if (details.reason === 'clean-exit') return
      console.warn('[outputs] output renderer gone', p.outputId, details.reason)
      this.crashed(p.outputId)
    })
    win.on('unresponsive', () => {
      e.recovering = true
      this.onRuntime()
      e.hangTimer = setTimeout(() => {
        console.warn('[outputs] output window hung, rebuilding', p.outputId)
        try { wc.forcefullyCrashRenderer() } catch { /* already gone */ }
        this.crashed(p.outputId)
      }, 4000)
    })
    win.on('responsive', () => { if (e.hangTimer) clearTimeout(e.hangTimer); e.recovering = false; this.onRuntime() })
    win.on('closed', () => {
      if (e.hangTimer) clearTimeout(e.hangTimer)
      void e.pump?.stop()
      if (this.entries.get(p.outputId) === e) {
        this.entries.delete(p.outputId)
        // The user closed a floating window: switch that output off instead of reopening it.
        if (p.kind === 'window' && !(e as Entry & { closing?: boolean }).closing) this.onUserClosed(p.outputId)
        this.updateBlocker()
      }
    })
    if (p.kind === 'capture') this.startCapture(e)
    void this.load(e)
    this.onRuntime()
  }

  private async load(e: Entry): Promise<void> {
    try {
      await this.ctx.loadPage(e.win, 'output', { outputId: e.plan.outputId, ...(e.plan.kind === 'capture' && e.plan.transparent ? { transparent: '1' } : {}) })
    } catch { /* did-fail-load retries */ }
  }

  private startCapture(e: Entry): void {
    if (e.plan.kind !== 'capture') return
    const p = e.plan
    const wc = e.win.webContents
    wc.setFrameRate(p.fps)
    const pump = new FramePump(this.makeSink(), { name: p.name, width: p.size.width, height: p.size.height, fps: p.fps, alpha: p.transparent })
    e.pump = pump
    pump.start().catch((err) => { console.warn('[outputs] frame sink failed', err); pump.stats.lastError = String(err) })
    wc.on('paint', (_ev, _dirty, image) => {
      e.lastPaint = image
      const s = image.getSize()
      pump.push(s.width, s.height, () => image.toBitmap())
    })
    wc.startPainting()
  }

  private crashed(id: ID): void {
    if (this.rebuildTimers.has(id)) return // already rebuilding (hang + renderer-gone both fire)
    const e = this.entries.get(id)
    const now = Date.now()
    const prev = this.crashCounts.get(id)
    const n = prev && now - prev.at < 60_000 ? prev.n + 1 : 1
    this.crashCounts.set(id, { n, at: now })
    if (e) this.close(id)
    const delay = Math.min(10_000, 500 * 2 ** (n - 1))
    this.rebuildTimers.set(id, setTimeout(() => {
      this.rebuildTimers.delete(id)
      const p = this.desired.find((x) => x.outputId === id)
      if (p && !this.entries.has(id)) { this.open(p); const ne = this.entries.get(id); if (ne) { ne.crashes = n; ne.recovering = true } }
      this.onRuntime()
    }, delay))
    this.onRuntime()
  }

  /** Put a display window exactly over its display and on top of everything. */
  private place(e: Entry): void {
    if (e.plan.kind !== 'display' || e.win.isDestroyed()) return
    const b = e.plan.bounds
    const cur = e.win.getBounds()
    if (cur.x !== b.x || cur.y !== b.y || cur.width !== b.width || cur.height !== b.height) e.win.setBounds(b)
    if (process.platform === 'darwin') {
      e.win.setAlwaysOnTop(true, 'pop-up-menu')
      e.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    } else e.win.setAlwaysOnTop(true, 'screen-saver')
  }

  reraiseAll(): void {
    for (const e of this.entries.values()) {
      if (e.win.isDestroyed()) continue
      if (e.plan.kind === 'display') { this.place(e); if (!e.win.isVisible()) e.win.showInactive() }
      if (e.plan.kind === 'capture') e.win.webContents.invalidate()
    }
  }

  close(id: ID): void {
    const e = this.entries.get(id)
    if (!e) return
    this.entries.delete(id)
    ;(e as Entry & { closing?: boolean }).closing = true
    if (e.hangTimer) clearTimeout(e.hangTimer)
    void e.pump?.stop()
    if (!e.win.isDestroyed()) e.win.destroy()
    this.updateBlocker()
  }

  closeAll(): void {
    for (const id of [...this.entries.keys()]) this.close(id)
    for (const t of this.rebuildTimers.values()) clearTimeout(t)
    this.rebuildTimers.clear()
  }

  has(id: ID): boolean { return this.entries.has(id) }
  isOutputWindow(win: BrowserWindow): boolean { return [...this.entries.values()].some((e) => e.win === win) }
  webContentsOf(id: ID): Electron.WebContents | undefined { const e = this.entries.get(id); return e && !e.win.isDestroyed() ? e.win.webContents : undefined }

  /** PNG data URL of what an output shows right now. */
  async thumbnail(id: ID, width = 320): Promise<string | null> {
    const e = this.entries.get(id)
    if (!e || e.win.isDestroyed() || !e.loaded) return null
    try {
      const img = e.plan.kind === 'capture' && e.lastPaint ? e.lastPaint : await e.win.webContents.capturePage()
      if (img.isEmpty()) return null
      return img.resize({ width, quality: 'good' }).toDataURL()
    } catch { return null }
  }

  /** Test hook: crash a window's renderer to exercise recovery. */
  crashForTest(id: ID): boolean {
    const wc = this.webContentsOf(id)
    if (!wc) return false
    wc.forcefullyCrashRenderer()
    return true
  }
}
