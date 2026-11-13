import { describe, expect, it } from 'vitest'
import type { Canvas, Output } from '@shared/model'
import {
  ClockSync, CANVAS_PRESETS, applyHomography, aspectLabel, canvasFromPreset, cornerPinMatrix3d, driftCorrection, fitRect,
  homography, matchDisplays, mediaPosition, reconcileDisplays, resolveOutputs, routeWarnings, snapRect, stackedCanvas,
  wallCells, wallGrid, type DisplayFingerprint, type DisplaySnapshot
} from '@shared/outputs'

/* ───────── simulated display sets ───────── */
const laptop = (o: Partial<DisplaySnapshot> = {}): DisplaySnapshot => ({ id: 1, label: 'Built-in Retina Display', bounds: { x: 0, y: 0, width: 1512, height: 982 }, scaleFactor: 2, internal: true, primary: true, operator: true, ...o })
const tv = (id: number, x: number, o: Partial<DisplaySnapshot> = {}): DisplaySnapshot => ({ id, label: 'SAMSUNG', bounds: { x, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, internal: false, primary: false, ...o })
const projector = (id: number, x: number, o: Partial<DisplaySnapshot> = {}): DisplaySnapshot => ({ id, label: 'EPSON PJ', bounds: { x, y: 0, width: 1920, height: 1200 }, scaleFactor: 1, internal: false, primary: false, ...o })

let n = 0
const mint = (): string => `d${++n}`

function remember(live: DisplaySnapshot[]): DisplayFingerprint[] {
  n = 0
  return reconcileDisplays([], live, 1000, mint).known
}

describe('display identity', () => {
  it('mints a key per new display and keeps it when nothing changed', () => {
    const live = [laptop(), tv(2, 1512), projector(3, 3432)]
    const known = remember(live)
    expect(known).toHaveLength(3)
    const again = reconcileDisplays(known, live, 2000, mint)
    expect(again.known).toHaveLength(3)
    expect([...again.keys.values()].sort()).toEqual(['d1', 'd2', 'd3'])
    expect(again.missing).toEqual([])
  })

  it('a replugged display gets its key back even with a new electron id', () => {
    const known = remember([laptop(), tv(2, 1512)])
    const tvKey = known.find((k) => k.label === 'SAMSUNG')!.key
    // unplugged
    const gone = reconcileDisplays(known, [laptop()], 2000, mint)
    expect(gone.missing).toEqual([tvKey])
    // replugged on another port: new id, same label/size/position
    const back = reconcileDisplays(gone.known, [laptop(), tv(77, 1512)], 3000, mint)
    expect(back.keys.get(77)).toBe(tvKey)
  })

  it('two identical TVs keep their roles using position', () => {
    const known = remember([laptop(), tv(2, 1512), tv(3, 3432)])
    const left = known.find((k) => k.electronId === 2)!.key
    const right = known.find((k) => k.electronId === 3)!.key
    // after a reboot both ids change and the OS lists them in a different order
    const m = matchDisplays(known, [tv(41, 3432), laptop({ id: 9 }), tv(40, 1512)])
    expect(m.byDisplay.get(40)).toBe(left)
    expect(m.byDisplay.get(41)).toBe(right)
  })

  it('a different monitor on the same port is NOT treated as the remembered one', () => {
    const known = remember([laptop(), projector(2, 1512)])
    const m = matchDisplays(known, [laptop(), tv(2, 1512)])
    expect(m.unknown.map((d) => d.id)).toEqual([2])
  })

  it('never matches internal to external', () => {
    const known = remember([laptop()])
    const m = matchDisplays(known, [laptop({ id: 1, internal: false, label: 'Built-in Retina Display' })])
    expect(m.byDisplay.size).toBe(0)
  })

  it('an external display that now holds the operator window needs near-certain evidence', () => {
    const known = remember([laptop(), tv(2, 1512)])
    // Laptop lid closed: the TV is now primary + the operator screen, moved to 0,0 with a new id.
    const m = matchDisplays(known, [tv(5, 0, { primary: true, operator: true, label: '' })])
    expect(m.byDisplay.size).toBe(0)
    // Same TV, same id, same label → still recognised
    const m2 = matchDisplays(known, [tv(2, 0, { primary: true, operator: true })])
    expect(m2.byDisplay.get(2)).toBeDefined()
  })

  it('unlabeled (Windows) displays still match by size + id/position', () => {
    const known = remember([laptop({ label: '' }), tv(2, 1512, { label: '' })])
    const m = matchDisplays(known, [laptop({ label: '' }), tv(2, 1512, { label: '' })])
    expect(m.byDisplay.size).toBe(2)
  })

  it('keeps custom names across reconcile', () => {
    const known = remember([laptop(), tv(2, 1512)])
    known[1].customName = 'Left TV'
    const again = reconcileDisplays(known, [laptop(), tv(2, 1512)], 5000, mint)
    expect(again.known.find((k) => k.key === known[1].key)!.customName).toBe('Left TV')
  })
})

/* ───────── routing / groups / walls ───────── */
const stacked: Canvas = { id: 'wall', name: 'LED Wall', kind: 'audience', width: 1920, height: 2160, regions: [{ id: 'top', name: 'LED Top', rect: { x: 0, y: 0, w: 1920, h: 1080 } }, { id: 'bot', name: 'LED Bottom', rect: { x: 0, y: 1080, w: 1920, h: 1080 } }] }
const main: Canvas = { id: 'main', name: 'Main', kind: 'audience', width: 5760, height: 1080, regions: [] }
const out = (id: string, o: Partial<Output> = {}): Output => ({ id, name: id, canvasId: 'main', target: { type: 'window' }, enabled: true, ...o })

describe('routing', () => {
  it('region outputs crop to the region rect', () => {
    const r = resolveOutputs([out('a', { canvasId: 'wall', regionId: 'bot' })], [stacked, main])
    expect(r.get('a')!.crop).toEqual({ x: 0, y: 1080, w: 1920, h: 1080 })
  })

  it('mirror groups give members the group source and enable state', () => {
    const outputs = [out('a', { canvasId: 'wall' }), out('b'), out('g', { canvasId: 'wall', regionId: 'top', target: { type: 'group', outputIds: ['a', 'b'] }, enabled: false })]
    const r = resolveOutputs(outputs, [stacked, main])
    expect(r.has('g')).toBe(false)
    expect(r.get('b')!.regionId).toBe('top')
    expect(r.get('b')!.crop).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
    expect(r.get('b')!.enabled).toBe(false)
  })

  it('video-wall groups split the source into cells', () => {
    const outputs = [out('a'), out('b'), out('c'), out('g', { target: { type: 'group', outputIds: ['a', 'b', 'c'] }, groupLayout: { mode: 'wall' } })]
    const r = resolveOutputs(outputs, [main])
    expect(r.get('a')!.crop).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
    expect(r.get('b')!.crop).toEqual({ x: 1920, y: 0, w: 1920, h: 1080 })
    expect(r.get('c')!.crop).toEqual({ x: 3840, y: 0, w: 1920, h: 1080 })
  })

  it('wall cells tile exactly with odd sizes', () => {
    const cells = wallCells({ x: 0, y: 0, w: 1001, h: 333 }, 3, 2)
    expect(cells).toHaveLength(6)
    expect(cells.reduce((a, c) => a + c.w * c.h, 0)).toBe(1001 * 333)
    expect(wallGrid(4, { mode: 'wall', columns: 2 })).toEqual({ columns: 2, rows: 2 })
    expect(wallGrid(3)).toEqual({ columns: 3, rows: 1 })
  })
})

/* ───────── geometry ───────── */
describe('geometry', () => {
  it('fitRect contain/cover/stretch', () => {
    expect(fitRect({ width: 3840, height: 1080 }, { width: 1920, height: 1080 })).toEqual({ x: 0, y: 270, w: 1920, h: 540 })
    expect(fitRect({ width: 1920, height: 1080 }, { width: 1920, height: 1200 }, 'cover').h).toBe(1200)
    expect(fitRect({ width: 1, height: 1 }, { width: 10, height: 5 }, 'stretch')).toEqual({ x: 0, y: 0, w: 10, h: 5 })
  })

  it('aspect labels', () => {
    expect(aspectLabel(1920, 1080)).toBe('16:9')
    expect(aspectLabel(3840, 1080)).toBe('32:9')
    expect(aspectLabel(1920, 1200)).toBe('16:10')
    expect(aspectLabel(1080, 1920)).toBe('9:16')
  })

  it('plain-language mismatch warnings', () => {
    const w = routeWarnings({ sourceName: 'LED Top', source: { width: 3840, height: 1080 }, destName: 'This TV', dest: { width: 1920, height: 1080 } })
    expect(w[0].text).toContain('This TV is 16:9 but “LED Top” is 32:9')
    expect(w[0].text).toContain('black bars above and below')
    expect(routeWarnings({ sourceName: 'Main', source: { width: 1920, height: 1080 }, destName: 'TV', dest: { width: 1920, height: 1080 } })).toEqual([])
    const rotated = routeWarnings({ sourceName: 'Portrait', source: { width: 1080, height: 1920 }, destName: 'TV', dest: { width: 1920, height: 1080 }, rotate: 90 })
    expect(rotated).toEqual([])
  })

  it('snaps regions to canvas edges and other regions', () => {
    const r = snapRect({ x: 7, y: 1074, w: 1920, h: 1080 }, { width: 1920, height: 2160 }, [{ x: 0, y: 0, w: 1920, h: 1080 }], 12)
    expect(r).toEqual({ x: 0, y: 1080, w: 1920, h: 1080 })
    const big = snapRect({ x: -50, y: -50, w: 5000, h: 5000 }, { width: 1920, height: 1080 }, [], 0)
    expect(big).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
  })

  it('corner pin homography maps the corners exactly', () => {
    const pts: [number, number][] = [[0.1, 0.05], [0.95, 0], [1, 1], [0, 0.9]]
    const w = 1920, h = 1080
    const m = homography(w, h, pts.map(([x, y]) => [x * w, y * h]))!
    const corners: [number, number][] = [[0, 0], [w, 0], [w, h], [0, h]]
    corners.forEach(([x, y], i) => {
      const [u, v] = applyHomography(m, x, y)
      expect(u).toBeCloseTo(pts[i][0] * w, 6)
      expect(v).toBeCloseTo(pts[i][1] * h, 6)
    })
  })

  it('corner pin CSS matrix3d is null for identity and valid otherwise', () => {
    expect(cornerPinMatrix3d(100, 100, [[0, 0], [1, 0], [1, 1], [0, 1]])).toBeNull()
    const css = cornerPinMatrix3d(100, 50, [[0.1, 0], [1, 0], [1, 1], [0, 1]])!
    expect(css.startsWith('matrix3d(')).toBe(true)
    const v = css.slice(9, -1).split(',').map(Number)
    expect(v).toHaveLength(16)
    // Column-major: transform (x,y) = (0,0) → translation column = (10, 0)
    expect(v[12]).toBeCloseTo(10, 6)
    expect(v[13]).toBeCloseTo(0, 6)
    // A point (100,50) maps to (100,50)
    const X = 100, Y = 50
    const wq = v[3] * X + v[7] * Y + v[15]
    expect((v[0] * X + v[4] * Y + v[12]) / wq).toBeCloseTo(100, 6)
    expect((v[1] * X + v[5] * Y + v[13]) / wq).toBeCloseTo(50, 6)
    expect(cornerPinMatrix3d(100, 100, [[0, 0], [0, 0], [0, 0], [0, 0]])).toBeNull()
  })
})

/* ───────── clock sync ───────── */
describe('clock sync', () => {
  it('estimates the offset from the lowest-latency sample', () => {
    const c = new ClockSync(8)
    const trueOffset = 5000 // server is 5 s ahead
    // symmetric 10 ms each way
    c.add(1000, 1000 + 10 + trueOffset, 1020)
    // asymmetric slow sample (200ms up, 10ms down) would be biased
    c.add(2000, 2000 + 200 + trueOffset, 2210)
    expect(c.offset).toBe(trueOffset)
    expect(c.rtt).toBe(20)
    for (let i = 0; i < 20; i++) c.add(3000 + i, 3000 + i + 50 + trueOffset, 3000 + i + 100)
    expect(c.count).toBe(8)
  })

  it('media position + drift correction', () => {
    expect(mediaPosition({ playing: true, startedAt: 1000, offset: 2 }, 4000)).toBe(5)
    expect(mediaPosition({ playing: true, startedAt: 0, offset: 0, loop: true }, 25000, 10)).toBe(5)
    expect(mediaPosition({ playing: true, startedAt: 0, offset: 0 }, 25000, 10)).toBe(10)
    expect(mediaPosition({ playing: false, startedAt: 0, offset: 3 }, 25000, 10)).toBe(3)
    expect(driftCorrection(5, 5.01)).toEqual({ rate: 1 })
    expect(driftCorrection(5, 5.2).rate).toBeGreaterThan(1)
    expect(driftCorrection(5, 9)).toEqual({ seek: 9, rate: 1 })
  })
})

/* ───────── presets ───────── */
describe('canvas presets', () => {
  it('stacked wizard sizes regions per panel', () => {
    const s = stackedCanvas([{ name: 'LED Top', width: 3840, height: 1080 }, { name: 'LED Bottom', width: 1920, height: 1080 }])
    expect(s.width).toBe(3840)
    expect(s.height).toBe(2160)
    expect(s.regions[1].rect).toEqual({ x: 960, y: 1080, w: 1920, h: 1080 })
    const h = stackedCanvas([{ name: 'A', width: 100, height: 50 }, { name: 'B', width: 200, height: 100 }], 'horizontal')
    expect(h).toMatchObject({ width: 300, height: 100 })
    expect(h.regions[0].rect).toEqual({ x: 0, y: 25, w: 100, h: 50 })
  })

  it('every preset produces a valid canvas', () => {
    let i = 0
    for (const p of CANVAS_PRESETS) {
      const c = canvasFromPreset(p, p.id, () => `r${i++}`)
      for (const r of c.regions) {
        expect(r.rect.x + r.rect.w).toBeLessThanOrEqual(c.width)
        expect(r.rect.y + r.rect.h).toBeLessThanOrEqual(c.height)
      }
    }
    expect(CANVAS_PRESETS.find((p) => p.id === 'stacked')!.regions.map((r) => r.name)).toEqual(['LED Top', 'LED Bottom'])
  })
})

/* ───────── transitions (LiveCanvas) ───────── */
import { transitionAnimation } from '@shared/render/LiveCanvas'
describe('transitions', () => {
  it('maps every Transition type to in/out animations', () => {
    expect(transitionAnimation({ type: 'cut', duration: 1 }, 'in')).toBeUndefined()
    expect(transitionAnimation(undefined, 'in')).toBeUndefined()
    expect(transitionAnimation({ type: 'dissolve', duration: 0.5 }, 'in')).toContain('rp-in-fade 0.5s')
    // fade goes through black: the new picture waits for the old one to fade out
    expect(transitionAnimation({ type: 'fade', duration: 1 }, 'in')).toContain('0.5s ease-out 0.5s')
    expect(transitionAnimation({ type: 'push', duration: 1, direction: 'up' }, 'out')).toContain('rp-out-up')
    expect(transitionAnimation({ type: 'slide', duration: 1, direction: 'right' }, 'in')).toContain('rp-in-right')
    expect(transitionAnimation({ type: 'slide', duration: 1 }, 'out')).toContain('rp-hold')
    expect(transitionAnimation({ type: 'zoom', duration: 0.4 }, 'in')).toContain('rp-in-zoom')
  })
})
