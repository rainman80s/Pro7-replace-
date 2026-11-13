/**
 * Frame plumbing for capture-style outputs (NDI today; Syphon/Spout/DeckLink can slot in later).
 *
 *   offscreen output window ──paint──▶ FramePump ──▶ FrameSink (NDI sender, fake sink in tests…)
 *
 * PURE (no Electron): the pump is fed raw BGRA buffers and a clock, so it is unit-tested with a fake sink.
 */
export interface Frame {
  width: number
  height: number
  /** BGRA, top-down, stride = width * 4. */
  data: Buffer
  /** ms since the pump started. */
  timestamp: number
  alpha: boolean
  fps: number
}

export interface FrameSinkOptions {
  name: string
  width: number
  height: number
  fps: number
  alpha: boolean
}

export interface FrameSink {
  readonly kind: string
  open(opts: FrameSinkOptions): Promise<void>
  /** Resolve when the sink is ready for the next frame (the pump never overlaps sends). */
  send(frame: Frame): Promise<void> | void
  close(): Promise<void> | void
  /** Optional: number of receivers connected, etc. */
  connections?(): number
}

export interface PumpStats {
  frames: number
  dropped: number
  repeated: number
  errors: number
  fps: number
  width: number
  height: number
  lastError?: string
}

/** Crop a BGRA buffer to even width/height (NDI rejects odd sizes). Returns the same buffer when already even. */
export function cropEven(data: Buffer, width: number, height: number): { data: Buffer; width: number; height: number } {
  const w = width - (width % 2)
  const h = height - (height % 2)
  if (w === width && h === height) return { data, width, height }
  if (w === width) return { data: data.subarray(0, w * h * 4), width: w, height: h }
  const out = Buffer.allocUnsafe(w * h * 4)
  for (let y = 0; y < h; y++) data.copy(out, y * w * 4, y * width * 4, y * width * 4 + w * 4)
  return { data: out, width: w, height: h }
}

/**
 * Paces frames into a sink:
 *  - keeps only the newest painted frame (older unsent ones are dropped, never queued → bounded memory and latency)
 *  - never overlaps sink.send() calls (back-pressure)
 *  - re-sends the last frame at a slow keep-alive rate when the page is static, so receivers don't flag "no signal"
 */
export class FramePump {
  readonly stats: PumpStats = { frames: 0, dropped: 0, repeated: 0, errors: 0, fps: 0, width: 0, height: 0 }
  private latest: { data: Buffer; width: number; height: number } | null = null
  private fresh = false
  private busy = false
  private timer: ReturnType<typeof setInterval> | null = null
  private started = 0
  private lastSent = 0
  private window: number[] = []
  private closed = false

  constructor(
    private sink: FrameSink,
    private opts: FrameSinkOptions & { keepAliveMs?: number },
    private now: () => number = Date.now
  ) {}

  async start(autoTick = true): Promise<void> {
    await this.sink.open(this.opts)
    this.started = this.now()
    if (autoTick) this.timer = setInterval(() => void this.tick(), Math.max(4, Math.round(1000 / this.opts.fps)))
  }

  /** A new frame was painted. `getData` is only called if the frame can be accepted (it may copy megabytes). */
  push(width: number, height: number, getData: () => Buffer): void {
    if (this.closed) return
    if (this.fresh) this.stats.dropped++
    const c = cropEven(getData(), width, height)
    this.latest = c
    this.fresh = true
  }

  /** Send the newest frame if the sink is free. Called on a timer at the target frame rate. */
  async tick(): Promise<boolean> {
    if (this.closed || this.busy || !this.latest) return false
    const t = this.now()
    const keepAlive = this.opts.keepAliveMs ?? 500
    if (!this.fresh && t - this.lastSent < keepAlive) return false
    const repeat = !this.fresh
    const f = this.latest
    this.fresh = false
    this.busy = true
    try {
      await this.sink.send({ width: f.width, height: f.height, data: f.data, timestamp: t - this.started, alpha: this.opts.alpha, fps: this.opts.fps })
      this.stats.frames++
      if (repeat) this.stats.repeated++
      this.stats.width = f.width
      this.stats.height = f.height
      this.lastSent = t
      this.window.push(t)
      while (this.window.length && t - this.window[0] > 2000) this.window.shift()
      this.stats.fps = Math.round((this.window.length / 2) * 10) / 10
    } catch (e) {
      this.stats.errors++
      this.stats.lastError = e instanceof Error ? e.message : String(e)
    } finally {
      this.busy = false
    }
    return true
  }

  async stop(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.latest = null
    try { await this.sink.close() } catch { /* already gone */ }
  }
}

/** Counts frames and remembers the last one. Used by tests and by REACH_FAKE_NDI=1 (exercise the capture path without NDI). */
export class MemorySink implements FrameSink {
  readonly kind = 'memory'
  opened: FrameSinkOptions | null = null
  frames: Frame[] = []
  count = 0
  closed = false
  constructor(private keep = 1, private delayMs = 0) {}
  async open(opts: FrameSinkOptions): Promise<void> { this.opened = opts }
  async send(frame: Frame): Promise<void> {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs))
    this.count++
    this.frames.push(frame)
    while (this.frames.length > this.keep) this.frames.shift()
  }
  close(): void { this.closed = true }
  connections(): number { return 0 }
}
