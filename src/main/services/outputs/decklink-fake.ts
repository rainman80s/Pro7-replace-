/**
 * A fake DeckLink native module with the same contract as native/decklink. Used by the unit tests and by
 * REACH_FAKE_DECKLINK=1 (exercise the whole capture path and the UI on a machine without the card).
 * It emulates the card's scheduled playback: each `tick()` is one SDI frame interval — the newest pushed picture
 * goes out, or the last one is repeated when nothing new arrived.
 */
import type { DeckLinkMode, DeckLinkNativeDevice } from '@shared/decklink'
import type { DeckLinkHandle, DeckLinkOpenOptions, NativeDeckLink } from './decklink'

const mode = (id: string, name: string, width: number, height: number, timeScale: number, frameDuration: number, interlaced = false): DeckLinkMode =>
  ({ id, name, width, height, fps: timeScale / frameDuration, timeScale, frameDuration, interlaced })

export const FAKE_MODES: DeckLinkMode[] = [
  mode('Hp29', '1080p29.97', 1920, 1080, 30000, 1001),
  mode('Hp30', '1080p30', 1920, 1080, 30000, 1000),
  mode('Hp59', '1080p59.94', 1920, 1080, 60000, 1001),
  mode('Hp60', '1080p60', 1920, 1080, 60000, 1000),
  mode('Hi59', '1080i59.94', 1920, 1080, 30000, 1001, true),
  mode('hp59', '720p59.94', 1280, 720, 60000, 1001)
]

/** The church's machine: a DeckLink Duo 2 (4 ports) + one more SDI device for the stage display. */
export function fakeChurchDevices(): DeckLinkNativeDevice[] {
  const duo = [1, 2, 3, 4].map((n, i): DeckLinkNativeDevice => ({
    index: i, name: 'DeckLink Duo 2', displayName: `DeckLink Duo (${n})`, persistentId: String(1000 + n), subDevice: i, subDevices: 4,
    outputs: 1, supportsKeying: true, externalKeying: true, internalKeying: true, modes: FAKE_MODES
  }))
  return [...duo, { index: 4, name: 'DeckLink Mini Monitor 4K', displayName: 'DeckLink Mini Monitor 4K', persistentId: '2001', outputs: 1, supportsKeying: false, modes: FAKE_MODES }]
}

export interface FakeHandle extends DeckLinkHandle {
  opts: DeckLinkOpenOptions
  /** One SDI frame interval elapsed on the card. Returns what went out. */
  tick(): 'fresh' | 'repeat' | 'black'
  pushes: number
  closed: boolean
  lastSize?: { width: number; height: number }
}

export interface FakeDeckLink extends NativeDeckLink {
  devices: DeckLinkNativeDevice[]
  /** Display names that answer "busy" (another app owns them). */
  busy: Set<string>
  handles: FakeHandle[]
  driverInstalled: boolean
}

/** autoTick: run each handle's SDI clock on a real timer (REACH_FAKE_DECKLINK=1); tests tick by hand. */
export function createFakeDeckLink(devices: DeckLinkNativeDevice[] = fakeChurchDevices(), autoTick = false): FakeDeckLink {
  const fake: FakeDeckLink = {
    devices, busy: new Set(), handles: [], driverInstalled: true, apiVersion: 'fake',
    driverVersion: () => (fake.driverInstalled ? 'fake 0.0' : null),
    async listDevices() {
      if (!fake.driverInstalled) throw Object.assign(new Error('Blackmagic Desktop Video is not installed'), { code: 'NO_DRIVER' })
      return fake.devices.map((d) => ({ ...d }))
    },
    async open(opts) {
      const dev = fake.devices.find((d) => d.displayName === opts.displayName) ?? fake.devices.find((d) => d.index === opts.device)
      if (!dev) throw Object.assign(new Error('DeckLink device not found'), { code: 'NO_DEVICE' })
      if (fake.busy.has(dev.displayName)) throw Object.assign(new Error('in use'), { code: 'BUSY' })
      const m = dev.modes.find((x) => x.id === opts.mode)
      if (!m) throw Object.assign(new Error('no such mode'), { code: 'NO_MODE' })
      if (opts.keying === 'external' && !dev.externalKeying) throw Object.assign(new Error('no keying'), { code: 'NO_KEYING' })
      if (opts.keying === 'internal' && !dev.internalKeying) throw Object.assign(new Error('no keying'), { code: 'NO_KEYING' })
      let pending = false
      let shown = false
      const stats = { fresh: 0, repeated: 0, late: 0, dropped: 0, errors: 0, buffered: 3 }
      const h: FakeHandle = {
        opts: { ...opts }, width: m.width, height: m.height, fps: m.fps, pushes: 0, closed: false,
        pushFrame(buf, width, height) {
          if (h.closed) throw new Error('closed')
          if (buf.length < width * height * 4) throw new RangeError('pushFrame: buffer is smaller than width*height*4')
          h.pushes++
          h.lastSize = { width, height }
          pending = true
        },
        tick() {
          if (pending) { pending = false; shown = true; stats.fresh++; return 'fresh' }
          stats.repeated++
          return shown ? 'repeat' : 'black'
        },
        stats: () => ({ ...stats }),
        async close() { h.closed = true; if (timer) clearInterval(timer) }
      }
      const timer = autoTick ? setInterval(() => h.tick(), 1000 / m.fps) : null
      timer?.unref?.()
      fake.handles.push(h)
      return h
    }
  }
  return fake
}
