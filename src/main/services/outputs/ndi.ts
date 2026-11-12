/**
 * NDI® output — OPTIONAL. The native module (@stagetimerio/grandiose, Apache-2.0) is NOT a hard dependency:
 * it is looked up lazily at runtime and the app runs fine without it ("NDI is not installed" state in the UI).
 *
 * UNVERIFIED in the dev container (no NDI runtime, headless Linux). Verified here: the frame plumbing
 * (FramePump, tests/frames.test.ts) and the offscreen capture path via REACH_FAKE_NDI=1.
 *
 * To enable on a real machine:  npm i @stagetimerio/grandiose && npx electron-rebuild   (see docs/network-displays.md)
 */
import { createRequire } from 'node:module'
import type { Frame, FrameSink, FrameSinkOptions } from './frames'
import { MemorySink } from './frames'

interface GrandioseSender {
  video(frame: Record<string, unknown>): Promise<void>
  destroy(): Promise<void> | void
  connections?(): number
}
interface Grandiose {
  send(params: { name: string; clockVideo?: boolean; clockAudio?: boolean }): Promise<GrandioseSender> | GrandioseSender
  version?(): string
  isSupportedCPU?(): boolean
}

const FOURCC_BGRA = 1095911234
const FOURCC_BGRX = 1481787202
const FRAME_PROGRESSIVE = 1

let cached: { lib: Grandiose | null; reason?: string; version?: string } | null = null

/** Try to load the NDI binding once. Never throws. */
export function loadNdi(): { lib: Grandiose | null; reason?: string; version?: string } {
  if (cached) return cached
  if (process.env.REACH_FAKE_NDI) return (cached = { lib: null, version: 'fake (test sink)' })
  const req = createRequire(__filename)
  // Names are built at runtime so the bundler doesn't try to resolve an optional native module.
  const candidates = [process.env.REACH_NDI_MODULE, ['@stagetimerio', 'grandiose'].join('/'), 'grandiose'].filter(Boolean) as string[]
  let lastError = ''
  for (const name of candidates) {
    try {
      const lib = req(name) as Grandiose
      if (typeof lib?.send !== 'function') { lastError = `${name} has no NDI sender`; continue }
      if (lib.isSupportedCPU && !lib.isSupportedCPU()) return (cached = { lib: null, reason: 'This computer’s processor is not supported by NDI.' })
      let version: string | undefined
      try { version = lib.version?.() } catch { /* optional */ }
      return (cached = { lib, version })
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
  }
  const missing = /Cannot find module/i.test(lastError)
  return (cached = {
    lib: null,
    reason: missing
      ? 'NDI isn’t installed on this computer yet. Ask your tech lead to add the NDI add-on (see “NDI” in docs/network-displays.md).'
      : `NDI could not start: ${lastError}`
  })
}

export function ndiAvailable(): boolean {
  return !!process.env.REACH_FAKE_NDI || !!loadNdi().lib
}

export class NdiSink implements FrameSink {
  readonly kind = 'ndi'
  private sender: GrandioseSender | null = null
  private opts!: FrameSinkOptions
  async open(opts: FrameSinkOptions): Promise<void> {
    const { lib, reason } = loadNdi()
    if (!lib) throw new Error(reason ?? 'NDI unavailable')
    this.opts = opts
    // clockVideo lets the NDI library pace frames evenly at the declared frame rate.
    this.sender = await lib.send({ name: opts.name, clockVideo: true, clockAudio: false })
  }
  async send(frame: Frame): Promise<void> {
    if (!this.sender) return
    await this.sender.video({
      xres: frame.width,
      yres: frame.height,
      frameRateN: Math.round(frame.fps * 1000),
      frameRateD: 1000,
      // Chromium paints premultiplied BGRA. Opaque outputs are flagged BGRX so switchers ignore the alpha byte.
      fourCC: this.opts.alpha ? FOURCC_BGRA : FOURCC_BGRX,
      pictureAspectRatio: frame.width / frame.height,
      frameFormatType: FRAME_PROGRESSIVE,
      lineStrideBytes: frame.width * 4,
      data: frame.data
    })
  }
  async close(): Promise<void> {
    const s = this.sender
    this.sender = null
    await s?.destroy()
  }
  connections(): number {
    try { return this.sender?.connections?.() ?? 0 } catch { return 0 }
  }
}

/** The sink to use for an NDI output on this machine. */
export function createNdiSink(): FrameSink {
  return process.env.REACH_FAKE_NDI ? new MemorySink(1) : new NdiSink()
}
