import { afterEach, describe, expect, it } from 'vitest'
import { colorFilterCss, defaultPlacement, gradeParams, normalizePlacement, placementCss, visiblePart } from '@shared/placement'
import { composeFrame, DelayLine, pictureOrigin } from '../src/main/services/outputs/compose'
import { DeckLinkSink, setDeckLinkModuleForTests } from '../src/main/services/outputs/decklink'
import { createFakeDeckLink } from '../src/main/services/outputs/decklink-fake'
import { planOutputs, windowSignature } from '../src/main/services/outputs/plan'
import { deckLinkDevices } from '@shared/decklink'
import { fakeChurchDevices } from '../src/main/services/outputs/decklink-fake'
import type { Canvas, Output } from '@shared/model'

const solid = (w: number, h: number, v: number): Buffer => Buffer.alloc(w * h * 4, v)

describe('placement math', () => {
  it('a screen that fits sits 1:1 at the top-left (LED WALL 1920x880 in 1080p)', () => {
    expect(defaultPlacement({ width: 1920, height: 880 }, { width: 1920, height: 1080 })).toEqual({ x: 0, y: 0, w: 1920, h: 880 })
  })
  it('a bigger screen is scaled to fit', () => {
    expect(defaultPlacement({ width: 3840, height: 2160 }, { width: 1920, height: 1080 })).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
  })
  it('normalizes and clips', () => {
    expect(normalizePlacement({ x: 1.4, y: -2.6, w: 0, h: 99.5 })).toEqual({ x: 1, y: -3, w: 1, h: 100 })
    expect(visiblePart({ x: -10, y: 1000, w: 100, h: 200 }, { width: 1920, height: 1080 })).toEqual({ x: 0, y: 1000, w: 90, h: 80 })
    expect(visiblePart({ x: 2000, y: 0, w: 10, h: 10 }, { width: 1920, height: 1080 })).toBeUndefined()
    expect(placementCss({ x: 960, y: 540, w: 960, h: 540 }, { width: 1920, height: 1080 })).toEqual({ left: '50%', top: '50%', width: '50%', height: '50%' })
  })
  it('composes a smaller picture into the SDI frame: content on top, black below', () => {
    const out = composeFrame(solid(4, 2, 200), 4, 2, 4, 4, { x: 0, y: 0 })
    expect(out.length).toBe(4 * 4 * 4)
    expect(out[0]).toBe(200)
    expect(out[(1 * 4 + 3) * 4]).toBe(200)
    expect(out[(2 * 4) * 4]).toBe(0)
    expect(out[(3 * 4 + 3) * 4 + 3]).toBe(0)
  })
  it('offsets and clips', () => {
    const out = composeFrame(solid(4, 4, 9), 4, 4, 6, 6, { x: 4, y: 4 })
    expect(out[(4 * 6 + 4) * 4]).toBe(9)
    expect(out[(5 * 6 + 5) * 4]).toBe(9)
    expect(out[(3 * 6 + 3) * 4]).toBe(0)
    expect(composeFrame(solid(2, 2, 9), 2, 2, 4, 4, { x: 10, y: 10 }).every((b) => b === 0)).toBe(true)
  })
  it('picture origin: placement wins, else align', () => {
    expect(pictureOrigin({ width: 100, height: 50 }, { width: 200, height: 100 }, { x: 5, y: 6, w: 1, h: 1 })).toEqual({ x: 5, y: 6 })
    expect(pictureOrigin({ width: 100, height: 50 }, { width: 200, height: 100 }, undefined, 'center')).toEqual({ x: 50, y: 25 })
  })
})

describe('colour filters', () => {
  it('is empty when nothing is adjusted', () => { expect(colorFilterCss({ brightness: 1 })).toBeUndefined() })
  it('builds a CSS filter, with the SVG grade for gamma/temperature', () => {
    expect(colorFilterCss({ contrast: 1.2, saturation: 0.5 })).toBe('contrast(1.2) saturate(0.5)')
    expect(colorFilterCss({ gamma: 1.2 })).toContain('url(#reach-grade)')
    const w = gradeParams({ temperature: 1 })
    expect(w.r).toBeGreaterThan(1); expect(w.b).toBeLessThan(1)
  })
})

describe('video delay', () => {
  it('releases items after the delay, newest due wins', () => {
    const d = new DelayLine<string>()
    d.push('a', 0, 100); d.push('b', 40, 100); d.push('c', 80, 100)
    expect(d.due(99)).toBeUndefined()
    expect(d.due(100)).toBe('a')
    expect(d.due(140)).toBe('b')
    expect(d.pending).toBe(1)
    expect(d.due(180)).toBe('c')
  })
})

describe('DeckLinkSink placement + delay', () => {
  afterEach(() => setDeckLinkModuleForTests(undefined))
  const cfgBase = { device: 'DeckLink Duo 2 · port 1', index: 0, displayName: 'DeckLink Duo (1)', mode: 'Hp29', keying: 'none' as const, keyLevel: 255 }
  const setup = (): { pushed: { w: number; h: number; first: number; last: number }[] } => {
    const fake = createFakeDeckLink()
    const open = fake.open.bind(fake)
    const rec = { pushed: [] as { w: number; h: number; first: number; last: number }[] }
    fake.open = async (o) => {
      const h = await open(o)
      const push = h.pushFrame.bind(h)
      h.pushFrame = (b, w, hh) => { rec.pushed.push({ w, h: hh, first: b[0], last: b[b.length - 1] }); push(b, w, hh) }
      return h
    }
    setDeckLinkModuleForTests(fake)
    return rec
  }
  const frame = (w: number, h: number, v: number): { width: number; height: number; data: Buffer; timestamp: number; alpha: boolean; fps: number } => ({ width: w, height: h, data: solid(w, h, v), timestamp: 0, alpha: false, fps: 30 })

  it('composes the 1920x880 picture at 0,0 inside the 1080p frame: top has content, bottom is black', async () => {
    const rec = setup()
    const sink = new DeckLinkSink({ ...cfgBase, modeSize: { width: 1920, height: 1080 }, placement: { x: 0, y: 0, w: 1920, h: 880 } })
    await sink.open({ name: 'x', width: 1920, height: 880, fps: 30, alpha: false })
    await sink.send(frame(1920, 880, 255))
    expect(rec.pushed).toHaveLength(1)
    expect(rec.pushed[0]).toMatchObject({ w: 1920, h: 1080, first: 255, last: 0 })
    await sink.close()
  })

  it('delays pushed frames by N frames', async () => {
    const rec = setup()
    let now = 0
    const sink = new DeckLinkSink({ ...cfgBase, delayFrames: 3, frameMs: 33 }, () => now)
    await sink.open({ name: 'x', width: 8, height: 8, fps: 30, alpha: false })
    await sink.send(frame(8, 8, 7))
    expect(rec.pushed).toHaveLength(0)
    now = 98
    await sink.send(frame(8, 8, 8))
    expect(rec.pushed).toHaveLength(0)
    now = 99
    await sink.send(frame(8, 8, 9))
    expect(rec.pushed.map((p) => p.first)).toEqual([7])
    await sink.close()
  })
})

describe('plan: placement', () => {
  const canvases: Canvas[] = [{ id: 'led', name: 'LED', kind: 'audience', width: 1920, height: 880, regions: [] }]
  const devices = deckLinkDevices(fakeChurchDevices())
  const out = (extra: Partial<Output> = {}): Output => ({ id: 'o', name: 'LED WALL', canvasId: 'led', target: { type: 'decklink', device: devices[0].key, mode: 'Hp29' }, enabled: true, ...extra })
  const plan = (o: Output) => planOutputs({ outputs: [o], canvases, displays: [], receivers: [], safeMode: false, ndiAvailable: false, decklink: { available: true, devices } })
  it('carries mode size, placement and delay to the sink', () => {
    const w = plan(out({ placement: { x: 0, y: 0, w: 1920, h: 880 }, videoDelay: 2 })).windows[0]
    expect(w.kind === 'capture' && w.decklink).toMatchObject({ modeSize: { width: 1920, height: 1080 }, placement: { x: 0, y: 0, w: 1920, h: 880 }, delayFrames: 2 })
    expect(w.kind === 'capture' && w.size).toEqual({ width: 1920, height: 880 })
  })
  it('a placement change rebuilds the window', () => {
    const a = plan(out()).windows[0], b = plan(out({ placement: { x: 0, y: 20, w: 1920, h: 880 } })).windows[0]
    expect(windowSignature(a)).not.toBe(windowSignature(b))
  })
  it('placeholder is waiting, not an error; a switched-off screen turns its outputs off', () => {
    expect(plan(out({ target: { type: 'placeholder' } })).health[0]).toMatchObject({ status: 'waiting' })
    const p = planOutputs({ outputs: [out()], canvases: [{ ...canvases[0], enabled: false }], displays: [], receivers: [], safeMode: false, ndiAvailable: false, decklink: { available: true, devices } })
    expect(p.health[0].status).toBe('off')
  })
})

import { initialPlacement, modeOf, outputsFor } from '../src/renderer/src/features/displays/screens-logic'
describe('screens logic', () => {
  it('LED WALL 1920x880 on 1080p defaults to Custom 0,0,1920,880; same size or bigger = Fit', () => {
    expect(initialPlacement({ width: 1920, height: 880 }, { width: 1920, height: 1080 })).toEqual({ x: 0, y: 0, w: 1920, h: 880 })
    expect(initialPlacement({ width: 1920, height: 1080 }, { width: 1920, height: 1080 })).toBeUndefined()
    expect(initialPlacement({ width: 3840, height: 2160 }, { width: 1920, height: 1080 })).toBeUndefined()
  })
  it('derives the mode from outputs and groups', () => {
    const o = (id: string, extra: Partial<Output> = {}): Output => ({ id, name: id, canvasId: 'c', target: { type: 'window' }, enabled: true, ...extra })
    expect(modeOf([o('a')], { canvasId: 'c' })).toBe('single')
    expect(modeOf([o('a'), o('b')], { canvasId: 'c' })).toBe('grouped')
    expect(modeOf([o('a'), o('g', { target: { type: 'group', outputIds: ['a'] }, groupLayout: { mode: 'wall', columns: 2, rows: 1 } })], { canvasId: 'c' })).toBe('wall')
    expect(outputsFor([o('a', { regionId: 'r' })], { canvasId: 'c' })).toHaveLength(0)
  })
})
