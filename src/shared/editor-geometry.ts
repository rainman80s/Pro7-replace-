/**
 * Pure geometry for the slide editor: snapping, resizing (incl. rotated boxes), bounds.
 * No DOM, no React — unit tested in tests/editor-geometry.test.ts.
 */
import type { Rect, Region, Size, SlideElement } from './model'

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export interface Guide {
  axis: 'x' | 'y'
  /** Position on the axis (design pixels). */
  pos: number
  /** What it snapped to — shown as a small label for regions. */
  label?: string
}

export interface SnapLine {
  pos: number
  label?: string
}
export interface SnapTargets {
  x: SnapLine[]
  y: SnapLine[]
}

const rad = (deg: number): number => (deg * Math.PI) / 180

export function rotatePoint(x: number, y: number, cx: number, cy: number, deg: number): [number, number] {
  if (!deg) return [x, y]
  const c = Math.cos(rad(deg))
  const s = Math.sin(rad(deg))
  const dx = x - cx
  const dy = y - cy
  return [cx + dx * c - dy * s, cy + dx * s + dy * c]
}

/** Axis-aligned bounding box of a (possibly rotated) rect. */
export function aabb(r: Rect, rotation = 0): Rect {
  if (!rotation) return r
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(([x, y]) => rotatePoint(x, y, cx, cy, rotation))
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

export function boundsOf(rects: Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 }
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y }
}

export function pointInElement(px: number, py: number, frame: Rect, rotation = 0): boolean {
  const [x, y] = rotatePoint(px, py, frame.x + frame.w / 2, frame.y + frame.h / 2, -rotation)
  return x >= frame.x && x <= frame.x + frame.w && y >= frame.y && y <= frame.y + frame.h
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/** Lines things can snap to: slide edges + centre, other elements, region edges + centres. */
export function snapTargets(size: Size, others: Pick<SlideElement, 'frame' | 'rotation' | 'hidden'>[], regions: Region[] = []): SnapTargets {
  const x: SnapLine[] = [{ pos: 0 }, { pos: size.width / 2 }, { pos: size.width }]
  const y: SnapLine[] = [{ pos: 0 }, { pos: size.height / 2 }, { pos: size.height }]
  for (const r of regions) {
    x.push({ pos: r.rect.x, label: r.name }, { pos: r.rect.x + r.rect.w / 2, label: r.name }, { pos: r.rect.x + r.rect.w, label: r.name })
    y.push({ pos: r.rect.y, label: r.name }, { pos: r.rect.y + r.rect.h / 2, label: r.name }, { pos: r.rect.y + r.rect.h, label: r.name })
  }
  for (const o of others) {
    if (o.hidden) continue
    const b = aabb(o.frame, o.rotation)
    x.push({ pos: b.x }, { pos: b.x + b.w / 2 }, { pos: b.x + b.w })
    y.push({ pos: b.y }, { pos: b.y + b.h / 2 }, { pos: b.y + b.h })
  }
  return { x, y }
}

function nearest(points: number[], lines: SnapLine[], threshold: number): { delta: number; line: SnapLine } | null {
  let best: { delta: number; line: SnapLine } | null = null
  for (const p of points) {
    for (const l of lines) {
      const d = l.pos - p
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta) || (Math.abs(d) === Math.abs(best.delta) && l.label && !best.line.label))) best = { delta: d, line: l }
    }
  }
  return best
}

/** Snap a moving box (its left/centre/right and top/middle/bottom) to the targets. */
export function snapMove(box: Rect, targets: SnapTargets, threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const guides: Guide[] = []
  const sx = nearest([box.x, box.x + box.w / 2, box.x + box.w], targets.x, threshold)
  const sy = nearest([box.y, box.y + box.h / 2, box.y + box.h], targets.y, threshold)
  if (sx) guides.push({ axis: 'x', pos: sx.line.pos, label: sx.line.label })
  if (sy) guides.push({ axis: 'y', pos: sy.line.pos, label: sy.line.label })
  return { dx: sx?.delta ?? 0, dy: sy?.delta ?? 0, guides }
}

export interface ResizeOpts {
  rotation?: number
  keepAspect?: boolean
  fromCenter?: boolean
  minSize?: number
}

/**
 * Resize `start` by dragging `handle` by (dx, dy) in design space. Works for rotated boxes:
 * the opposite edge/corner stays where it is on screen.
 */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, opts: ResizeOpts = {}): Rect {
  const rot = opts.rotation ?? 0
  const min = opts.minSize ?? 4
  // Drag delta in the box's own (unrotated) axes.
  const [lx, ly] = rotatePoint(dx, dy, 0, 0, -rot)
  const hx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0
  const hy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0
  const k = opts.fromCenter ? 2 : 1
  let w = start.w + hx * lx * k
  let h = start.h + hy * ly * k
  if (opts.keepAspect && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h
    if (hx && hy) {
      if (Math.abs(w - start.w) / start.w > Math.abs(h - start.h) / start.h) h = w / ratio
      else w = h * ratio
    } else if (hx) h = w / ratio
    else w = h * ratio
  }
  w = Math.max(min, w)
  h = Math.max(min, h)
  const cx = start.x + start.w / 2
  const cy = start.y + start.h / 2
  if (opts.fromCenter) return { x: cx - w / 2, y: cy - h / 2, w, h }
  // Keep the anchor (opposite side) fixed: move the centre by half the size change along local axes.
  const ax = hx === 0 ? 0 : -hx
  const ay = hy === 0 ? 0 : -hy
  const localShiftX = (-ax * (w - start.w)) / 2
  const localShiftY = (-ay * (h - start.h)) / 2
  const [wx, wy] = rotatePoint(localShiftX, localShiftY, 0, 0, rot)
  const ncx = cx + wx
  const ncy = cy + wy
  return { x: ncx - w / 2, y: ncy - h / 2, w, h }
}

/** Snap the edges being dragged by `handle` (unrotated boxes only). */
export function snapResize(rect: Rect, handle: Handle, targets: SnapTargets, threshold: number): { rect: Rect; guides: Guide[] } {
  const guides: Guide[] = []
  let { x, y, w, h } = rect
  if (handle.includes('e')) {
    const s = nearest([x + w], targets.x, threshold)
    if (s) { w += s.delta; guides.push({ axis: 'x', pos: s.line.pos, label: s.line.label }) }
  } else if (handle.includes('w')) {
    const s = nearest([x], targets.x, threshold)
    if (s) { x += s.delta; w -= s.delta; guides.push({ axis: 'x', pos: s.line.pos, label: s.line.label }) }
  }
  if (handle.includes('s')) {
    const s = nearest([y + h], targets.y, threshold)
    if (s) { h += s.delta; guides.push({ axis: 'y', pos: s.line.pos, label: s.line.label }) }
  } else if (handle.includes('n')) {
    const s = nearest([y], targets.y, threshold)
    if (s) { y += s.delta; h -= s.delta; guides.push({ axis: 'y', pos: s.line.pos, label: s.line.label }) }
  }
  return { rect: { x, y, w, h }, guides }
}

/** Scale a set of frames from one bounding box to another (multi-select resize). */
export function scaleRectInto(r: Rect, from: Rect, to: Rect): Rect {
  const kx = from.w ? to.w / from.w : 1
  const ky = from.h ? to.h / from.h : 1
  return { x: to.x + (r.x - from.x) * kx, y: to.y + (r.y - from.y) * ky, w: r.w * kx, h: r.h * ky }
}

export function snapAngle(deg: number, step = 15, threshold = 4): number {
  const n = Math.round(deg / step) * step
  return Math.abs(n - deg) <= threshold ? n : deg
}

export const roundRect = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) })

/** Fit a box of `size` inside `into` (contain / cover / stretch), centred. */
export function fitRect(size: Size, into: Rect, mode: 'contain' | 'cover' | 'stretch' = 'contain'): Rect & { kx: number; ky: number } {
  let kx = into.w / size.width
  let ky = into.h / size.height
  if (mode === 'contain') kx = ky = Math.min(kx, ky)
  if (mode === 'cover') kx = ky = Math.max(kx, ky)
  const w = size.width * kx
  const h = size.height * ky
  return { x: into.x + (into.w - w) / 2, y: into.y + (into.h - h) / 2, w, h, kx, ky }
}

export type AlignOp = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'
/** Align a frame within a container rect (the slide, a region, or the selection bounds). */
export function alignRect(r: Rect, within: Rect, op: AlignOp): Rect {
  switch (op) {
    case 'left': return { ...r, x: within.x }
    case 'hcenter': return { ...r, x: within.x + (within.w - r.w) / 2 }
    case 'right': return { ...r, x: within.x + within.w - r.w }
    case 'top': return { ...r, y: within.y }
    case 'vcenter': return { ...r, y: within.y + (within.h - r.h) / 2 }
    case 'bottom': return { ...r, y: within.y + within.h - r.h }
  }
}

/** The region whose rect contains the centre of `r` (for "this element lives in LED Top"). */
export function regionAt(r: Rect, regions: Region[]): Region | undefined {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  return regions.find((g) => cx >= g.rect.x && cx <= g.rect.x + g.rect.w && cy >= g.rect.y && cy <= g.rect.y + g.rect.h)
}
