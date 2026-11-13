import { afterEach, describe, expect, it } from 'vitest'
import type { Canvas, Output } from '@shared/model'
import { defaultDeckLinkMode, deckLinkDevices, deckLinkPort, deckLinkRate, sortDeckLinkModes, type DeckLinkDevice } from '@shared/decklink'
import { destinationLabel } from '@shared/outputs'
import {
  DeckLinkRegistry, DeckLinkSink, FramePacer, deckLinkCandidates, loadDeckLink, setDeckLinkModuleForTests, type PacerClock
} from '../src/main/services/outputs/decklink'
import { createFakeDeckLink, fakeChurchDevices, type FakeDeckLink } from '../src/main/services/outputs/decklink-fake'
import { FramePump } from '../src/main/services/outputs/frames'
import { planOutputs, windowSignature, type PlannedDeckLink } from '../src/main/services/outputs/plan'

/** Manual clock: timers fire in due order as time advances; `jitter` makes each fire late by up to N ms. */
function manualClock(jitter = 0): PacerClock & { advance(ms: number): void; t: number } {
  let seq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  let rnd = 1
  const c = {
    t: 0,
    now: () => c.t,
    setTimeout: (fn: () => void, ms: number) => { const id = ++seq; rnd = (rnd * 16807) % 2147483647; timers.set(id, { at: c.t + ms + (jitter ? (rnd % 1000) / 1000 * jitter : 0), fn }); return id },
    clearTimeout: (id: unknown) => { timers.delete(id as number) },
    advance(ms: number) {
      const end = c.t + ms
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]
        if (!next || next[1].at > end) break
        timers.delete(next[0])
        c.t = next[1].at
        next[1].fn()
      }
      c.t = end
    }
  }
  return c
}

const store = (): { load: () => DeckLinkDevice[]; save: (l: DeckLinkDevice[]) => void; data: DeckLinkDevice[] } => {
  const s = { data: [] as DeckLinkDevice[], load: () => s.data, save: (l: DeckLinkDevice[]) => { s.data = l } }
  return s
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

const led: Canvas = {
  id: 'led', name: 'LED Wall (stacked)', kind: 'audience', width: 1920, height: 1200,
  regions: [{ id: 'top', name: 'Top', rect: { x: 0, y: 0, w: 1920, h: 880 } }, { id: 'bot', name: 'Bottom', rect: { x: 0, y: 880, w: 1920, h: 320 } }]
}
const key: Canvas = { id: 'key', name: 'Key', kind: 'audience', width: 1920, height: 1080, regions: [] }
const stage: Canvas = { id: 'stage', name: 'Stage', kind: 'stage', width: 1920, height: 1080, regions: [] }
const out = (id: string, canvasId: string, target: Output['target'], p: Partial<Output> = {}): Output => ({ id, name: id, canvasId, target, enabled: true, ...p })

let fake: FakeDeckLink
afterEach(() => setDeckLinkModuleForTests(undefined))
const useFake = (): FakeDeckLink => { fake = createFakeDeckLink(); setDeckLinkModuleForTests(fake); return fake }

describe('DeckLink devices → destinations', () => {
  it('gives each Duo 2 port a stable "model · port n" identity', () => {
    const list = deckLinkDevices(fakeChurchDevices(), 5)
    expect(list.map((d) => d.key)).toEqual([
      'DeckLink Duo 2 · port 1', 'DeckLink Duo 2 · port 2', 'DeckLink Duo 2 · port 3', 'DeckLink Duo 2 · port 4', 'DeckLink Mini Monitor 4K · port 1'
    ])
    expect(list[0]).toMatchObject({ connected: true, lastSeen: 5, port: 1 })
    // Two identical cards don't collide.
    const two = deckLinkDevices([...fakeChurchDevices().slice(0, 1), { ...fakeChurchDevices()[0], index: 9, persistentId: '99' }])
    expect(two.map((d) => d.key)).toEqual(['DeckLink Duo 2 · port 1', 'DeckLink Duo 2 (2) · port 1'])
    expect(deckLinkPort({ displayName: 'DeckLink Duo (3)', index: 0 })).toBe(3)
    expect(deckLinkPort({ displayName: 'UltraStudio Monitor 3G', index: 1 })).toBe(1)
  })
  it('picks 1080p29.97 by default, lists progressive modes first, and paces 29.97 as 30000/1001', () => {
    const modes = fakeChurchDevices()[0].modes
    expect(defaultDeckLinkMode(modes)?.id).toBe('Hp29')
    expect(sortDeckLinkModes(modes).at(-1)?.interlaced).toBe(true)
    expect(deckLinkRate(modes[0])).toEqual({ num: 30000, den: 1001 })
    expect(deckLinkRate({ fps: 59.94 })).toEqual({ num: 60000, den: 1001 })
    expect(deckLinkRate({ fps: 60 })).toEqual({ num: 60000, den: 1000 })
  })
  it('registry remembers ports per machine and marks unplugged ones as not connected', async () => {
    const f = useFake()
    const s = store()
    const reg = new DeckLinkRegistry(s, () => 1000)
    const changes: number[] = []
    reg.onChange((l) => changes.push(l.length))
    expect((await reg.refresh()).filter((d) => d.connected)).toHaveLength(5)
    f.devices = f.devices.filter((d) => d.name !== 'DeckLink Mini Monitor 4K') // stage device unplugged
    const after = await reg.refresh()
    expect(after.find((d) => d.key === 'DeckLink Mini Monitor 4K · port 1')).toMatchObject({ connected: false })
    expect(changes).toEqual([5, 5])
    expect(reg.forget('DeckLink Mini Monitor 4K · port 1')).toHaveLength(4)
  })
  it('plans the church setup: four SDI outputs as capture windows at each mode’s rate', async () => {
    useFake()
    const devices = await new DeckLinkRegistry(store()).refresh()
    const outputs = [
      out('wall', 'led', { type: 'decklink', device: 'DeckLink Duo 2 · port 1', mode: 'Hp29' }, { regionId: 'top' }),
      out('key', 'key', { type: 'decklink', device: 'DeckLink Duo 2 · port 2', mode: 'Hp29', keying: 'external', keyLevel: 200 }),
      out('lyrics', 'led', { type: 'decklink', device: 'DeckLink Duo 2 · port 3', mode: 'Hp29' }, { regionId: 'bot' }),
      out('stage', 'stage', { type: 'decklink', device: 'DeckLink Mini Monitor 4K · port 1', mode: 'Hp60' })
    ]
    const p = planOutputs({ outputs, canvases: [led, key, stage], displays: [], receivers: [], safeMode: false, ndiAvailable: false, decklink: { available: true, devices } })
    expect(p.health.map((h) => h.status)).toEqual(['live', 'live', 'live', 'live'])
    const w = Object.fromEntries(p.windows.map((x) => [x.outputId, x])) as Record<string, Extract<(typeof p.windows)[number], { kind: 'capture' }>>
    expect(w.wall).toMatchObject({ kind: 'capture', size: { width: 1920, height: 880 }, transparent: false })
    expect(w.wall.fps).toBeCloseTo(29.97, 2)
    expect(w.lyrics.size).toEqual({ width: 1920, height: 320 })
    expect(w.stage.decklink?.rate).toEqual({ num: 60000, den: 1000 })
    // keying flag passes through, and a keyed output renders transparent (alpha = key).
    expect(w.key.transparent).toBe(true)
    expect(w.key.decklink).toMatchObject({ keying: 'external', keyLevel: 200, device: 'DeckLink Duo 2 · port 2', displayName: 'DeckLink Duo (2)', index: 1 })
    expect(windowSignature(w.key)).not.toBe(windowSignature({ ...w.key, decklink: { ...w.key.decklink!, keying: 'none' } }))
    expect(destinationLabel(outputs[0], [], [])).toBe('SDI: DeckLink Duo 2 · port 1')
  })
  it('explains problems in plain words: one output per port, missing ports, bad modes, keying, sink problems', async () => {
    useFake()
    const devices = (await new DeckLinkRegistry(store()).refresh()).map((d) => (d.key === 'DeckLink Duo 2 · port 4' ? { ...d, connected: false } : d))
    const t = (device: string, mode = 'Hp29', keying?: 'external'): Output['target'] => ({ type: 'decklink', device, mode, keying })
    const outputs = [
      out('a', 'key', t('DeckLink Duo 2 · port 1')), out('b', 'key', t('DeckLink Duo 2 · port 1')),
      out('c', 'key', t('DeckLink Duo 2 · port 4')), out('d', 'key', t('DeckLink Duo 2 · port 2', 'XXXX')),
      out('e', 'key', t('DeckLink Mini Monitor 4K · port 1', 'Hp29', 'external')), out('f', 'key', t('DeckLink Duo 2 · port 3'))
    ]
    const p = planOutputs({
      outputs, canvases: [key], displays: [], receivers: [], safeMode: false, ndiAvailable: false, decklink: { available: true, devices },
      runtime: { f: { loaded: true, sinkProblem: '“DeckLink Duo 2 · port 3” is busy (is ProPresenter running?).' } }
    })
    expect(p.health.map((h) => h.status)).toEqual(['live', 'blocked', 'missing', 'blocked', 'blocked', 'blocked'])
    expect(p.health[1].message).toContain('already showing')
    expect(p.health[4].message).toContain('keying')
    expect(p.health[5].message).toContain('ProPresenter')
  })
})

describe('graceful states when the native module is missing', () => {
  it('not built → "run npm run build:decklink", and outputs are unavailable (never thrown)', () => {
    setDeckLinkModuleForTests(null)
    const l = loadDeckLink()
    expect(l).toMatchObject({ lib: null, state: 'not-built' })
    expect(l.reason).toContain('npm run build:decklink')
    const p = planOutputs({
      outputs: [out('a', 'key', { type: 'decklink', device: 'DeckLink Duo 2 · port 2', mode: 'Hp29' })], canvases: [key], displays: [], receivers: [],
      safeMode: false, ndiAvailable: false, decklink: { available: false, reason: l.reason, devices: [] }
    })
    expect(p.windows).toEqual([])
    expect(p.health[0]).toMatchObject({ status: 'unavailable' })
    expect(p.health[0].message).toContain('build:decklink')
  })
  it('built but Desktop Video missing → "DeckLink driver not installed"', async () => {
    const f = createFakeDeckLink()
    f.driverInstalled = false
    setDeckLinkModuleForTests(f)
    expect(loadDeckLink()).toMatchObject({ lib: null, state: 'no-driver' })
    expect(loadDeckLink().reason).toContain('DeckLink driver not installed')
    const reg = new DeckLinkRegistry(store())
    expect(await reg.refresh()).toEqual([])
    expect(reg.reason()).toContain('driver not installed')
  })
  it('the real lookup without a build finds nothing and says so', () => {
    setDeckLinkModuleForTests(undefined)
    const l = loadDeckLink()
    expect(['not-built', 'error']).toContain(l.state)
    expect(deckLinkCandidates({}, '/App/Contents/Resources', '/x/out/main')).toEqual(expect.arrayContaining([
      '/App/Contents/Resources/decklink/reach_decklink.node', '/x/native/decklink/build/Release/reach_decklink.node'
    ]))
  })
  it('device busy (ProPresenter has it) → plain message, then starts by itself once freed', async () => {
    const f = useFake()
    f.busy.add('DeckLink Duo (2)')
    let now = 0
    const sink = new DeckLinkSink({ device: 'DeckLink Duo 2 · port 2', index: 1, displayName: 'DeckLink Duo (2)', mode: 'Hp29', keying: 'none', keyLevel: 255 }, () => now)
    await sink.open({ name: 'Key', width: 1920, height: 1080, fps: 29.97, alpha: false })
    expect(sink.isOpen()).toBe(false)
    expect(sink.problem()).toContain('is ProPresenter running?')
    const frame = { width: 4, height: 2, data: Buffer.alloc(32), timestamp: 0, alpha: false, fps: 29.97 }
    f.busy.clear()
    now = 1000
    await sink.send(frame) // too soon to retry
    expect(sink.isOpen()).toBe(false)
    now = 3500
    await sink.send(frame)
    expect(sink.isOpen()).toBe(true)
    expect(sink.problem()).toBeUndefined()
    expect(f.handles[0].pushes).toBe(1)
    await sink.close()
    expect(f.handles[0].closed).toBe(true)
  })
  it('a port that disappears mid-show drops its handle and reopens', async () => {
    const f = useFake()
    let now = 0
    const sink = new DeckLinkSink({ device: 'DeckLink Duo 2 · port 1', index: 0, displayName: 'DeckLink Duo (1)', mode: 'Hp29', keying: 'none', keyLevel: 255 }, () => now)
    await sink.open({ name: 'x', width: 4, height: 2, fps: 30, alpha: false })
    f.handles[0].closed = true // pushFrame now throws, like an unplugged Thunderbolt box
    await sink.send({ width: 4, height: 2, data: Buffer.alloc(32), timestamp: 0, alpha: false, fps: 30 })
    expect(sink.problem()).toContain('Reach keeps trying')
    now = 5000
    await sink.send({ width: 4, height: 2, data: Buffer.alloc(32), timestamp: 0, alpha: false, fps: 30 })
    expect(f.handles).toHaveLength(2)
    expect(sink.isOpen()).toBe(true)
  })
})

describe('frame pacing and keying', () => {
  it.each([[{ num: 30000, den: 1001 }, 299], [{ num: 60000, den: 1001 }, 599], [{ num: 60000, den: 1000 }, 600]])('paces %o without drift (10 s, jittery timers)', (rate, expected) => {
    const clock = manualClock(6)
    let n = 0
    const pacer = new FramePacer(rate, () => n++, clock)
    pacer.start()
    clock.advance(10_000)
    pacer.stop()
    expect(n).toBeGreaterThanOrEqual(expected - 1)
    expect(n).toBeLessThanOrEqual(expected)
    clock.advance(1000)
    expect(pacer.ticks).toBe(n) // stopped means stopped
  })
  it('resyncs after a stall instead of bursting', () => {
    const clock = manualClock()
    let n = 0
    const pacer = new FramePacer({ num: 30000, den: 1001 }, () => { n++; if (n === 3) clock.t += 1000 }, clock)
    pacer.start()
    clock.advance(500)
    expect(pacer.resyncs).toBe(1)
    expect(n).toBeLessThan(20)
  })
  it('keeps SDI fed when the page is idle: one push, the card repeats the last frame', async () => {
    const f = useFake()
    const clock = manualClock()
    const sink = new DeckLinkSink({ device: 'DeckLink Duo 2 · port 1', index: 0, displayName: 'DeckLink Duo (1)', mode: 'Hp29', keying: 'none', keyLevel: 255 }, () => clock.t)
    const pump = new FramePump(sink, { name: 'LED', width: 1920, height: 880, fps: 29.97, alpha: false, keepAliveMs: 1000 }, () => clock.t)
    await pump.start(false)
    const pacer = new FramePacer({ num: 30000, den: 1001 }, () => void pump.tick(), clock)
    pacer.start()
    pump.push(1920, 880, () => Buffer.alloc(1920 * 880 * 4, 7)) // one painted frame, then nothing
    const shown: string[] = []
    for (let i = 0; i < 90; i++) { clock.advance(1001 / 30); await flush(); shown.push(f.handles[0].tick()) }
    expect(f.handles[0].pushes).toBe(1)
    expect(f.handles[0].lastSize).toEqual({ width: 1920, height: 880 })
    expect(shown[0]).toBe('fresh')
    expect(shown.slice(1).every((s) => s === 'repeat')).toBe(true)
    expect(pump.stats.repeated).toBeGreaterThanOrEqual(2) // JS keep-alive ticks reach the sink…
    expect(sink.skippedRepeats).toBe(pump.stats.repeated) // …but cost no copy: the card repeats by itself
    // A new paint goes out on the next frame.
    pump.push(1920, 880, () => Buffer.alloc(1920 * 880 * 4, 9))
    clock.advance(40); await flush()
    expect(f.handles[0].pushes).toBe(2)
    expect(f.handles[0].tick()).toBe('fresh')
    pacer.stop()
    await pump.stop()
  })
  it('passes keying (external fill + key, level) and alignment through to the card', async () => {
    const f = useFake()
    const cfg: PlannedDeckLink = { device: 'DeckLink Duo 2 · port 1', index: 0, displayName: 'DeckLink Duo (1)', mode: 'Hp29', rate: { num: 30000, den: 1001 }, keying: 'external', keyLevel: 180, align: 'center' }
    const sink = new DeckLinkSink(cfg)
    await sink.open({ name: 'Key', width: 1920, height: 1080, fps: 29.97, alpha: true })
    expect(f.handles[0].opts).toMatchObject({ keying: 'external', keyLevel: 180, align: 'center', mode: 'Hp29', displayName: 'DeckLink Duo (1)' })
    // A port without keying says so instead of silently sending fill only.
    const s2 = new DeckLinkSink({ ...cfg, device: 'DeckLink Mini Monitor 4K · port 1', index: 4, displayName: 'DeckLink Mini Monitor 4K' })
    await s2.open({ name: 'x', width: 1920, height: 1080, fps: 29.97, alpha: true })
    expect(s2.problem()).toContain('keying')
  })
})
