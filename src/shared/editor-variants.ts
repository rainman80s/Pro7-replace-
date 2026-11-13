/**
 * Per-canvas slide designs ("variants").
 *
 *   slide.elements             the main design, in presentation.size pixels
 *   slide.variants[canvasId]   optional design for one canvas, in that canvas's pixels
 *
 * Text is single-source: a variant text element with a `role` shows the base element's text
 * (see linkVariantElements in model.ts), so lyrics are typed once and laid out per canvas.
 */
import type { Canvas, Rect, Region, Size, Slide, SlideElement, SlideVariant, TextElement, TextStyle } from './model'
import { linkVariantElements } from './model'
import { fitRect } from './editor-geometry'
import { clone, isContentText, primaryText, uid } from './editor-util'

export type VariantStrategy =
  /** Scale the main design to fit the whole canvas. */
  | { type: 'fit'; mode?: 'contain' | 'cover' | 'stretch' }
  /** Fit the main design into one region; the rest of the canvas stays empty. */
  | { type: 'region'; regionId: string; mode?: 'contain' | 'cover' | 'stretch' }
  /** One copy of the main design in every region. */
  | { type: 'perRegion'; mode?: 'contain' | 'cover' | 'stretch' }

function scaleStyle(s: TextStyle | undefined, k: number): TextStyle | undefined {
  if (!s) return s
  const o: TextStyle = { ...s }
  if (o.fontSize) o.fontSize = Math.max(1, Math.round(o.fontSize * k * 10) / 10)
  if (o.letterSpacing) o.letterSpacing = Math.round(o.letterSpacing * k * 100) / 100
  if (o.strokeWidth) o.strokeWidth = Math.round(o.strokeWidth * k * 100) / 100
  if (o.shadow) o.shadow = { ...o.shadow, blur: o.shadow.blur * k, x: o.shadow.x * k, y: o.shadow.y * k }
  return o
}

/** Scale elements designed in `from` into the rect `to` (new ids, fonts/strokes/shadows scale too). */
export function adaptElements(elements: SlideElement[], from: Size, to: Rect, mode: 'contain' | 'cover' | 'stretch' = 'contain', regionId?: string): SlideElement[] {
  const f = fitRect(from, to, mode)
  const k = Math.min(f.kx, f.ky)
  return elements.map((src) => {
    const e = clone(src)
    e.id = uid()
    e.frame = {
      x: Math.round(f.x + src.frame.x * f.kx), y: Math.round(f.y + src.frame.y * f.ky),
      w: Math.round(src.frame.w * f.kx), h: Math.round(src.frame.h * f.ky)
    }
    if (regionId) e.regionId = regionId
    else delete e.regionId
    if (e.cornerRadius) e.cornerRadius = Math.round(e.cornerRadius * k)
    if (e.stroke) e.stroke = { ...e.stroke, width: Math.max(1, Math.round(e.stroke.width * k)) }
    if (e.shadow) e.shadow = { ...e.shadow, blur: e.shadow.blur * k, x: e.shadow.x * k, y: e.shadow.y * k }
    if (e.type === 'text') {
      e.style = scaleStyle(e.style, k) ?? {}
      if (e.padding) e.padding = Math.round(e.padding * k)
      e.paragraphs = e.paragraphs.map((p) => ({ ...p, runs: p.runs.map((r) => (r.style ? { ...r, style: scaleStyle(r.style, k) } : r)) }))
    }
    if (e.type === 'shape' && e.points) e.points = e.points.map(([x, y]) => [x, y])
    return e
  })
}

/** Build a variant of `slide` for `canvas` from its main design. */
export function createVariant(slide: Slide, baseSize: Size, canvas: Pick<Canvas, 'width' | 'height' | 'regions'>, strategy: VariantStrategy = { type: 'fit' }): SlideVariant {
  const whole: Rect = { x: 0, y: 0, w: canvas.width, h: canvas.height }
  let elements: SlideElement[]
  if (strategy.type === 'region') {
    const r = canvas.regions.find((x) => x.id === strategy.regionId)
    elements = adaptElements(slide.elements, baseSize, r?.rect ?? whole, strategy.mode, r?.id)
  } else if (strategy.type === 'perRegion' && canvas.regions.length) {
    elements = canvas.regions.flatMap((r) => adaptElements(slide.elements, baseSize, r.rect, strategy.mode, r.id))
  } else {
    elements = adaptElements(slide.elements, baseSize, whole, strategy.mode)
  }
  return { elements }
}

export function setVariant(slide: Slide, canvasId: string, variant: SlideVariant | null): Slide {
  const variants = { ...(slide.variants ?? {}) }
  if (variant) variants[canvasId] = variant
  else delete variants[canvasId]
  const next: Slide = { ...slide, variants }
  if (!Object.keys(variants).length) delete next.variants
  return next
}

/** Make an element exactly cover a region ("Fill LED Top"). */
export function fillRegion<T extends SlideElement>(el: T, region: Region): T {
  return { ...el, frame: { ...region.rect }, regionId: region.id, rotation: 0 }
}

/** Move an element into another region keeping its relative position/size inside the region. */
export function moveToRegion<T extends SlideElement>(el: T, from: Rect, to: Region): T {
  const kx = from.w ? to.rect.w / from.w : 1
  const ky = from.h ? to.rect.h / from.h : 1
  return {
    ...el, regionId: to.id,
    frame: { x: Math.round(to.rect.x + (el.frame.x - from.x) * kx), y: Math.round(to.rect.y + (el.frame.y - from.y) * ky), w: Math.round(el.frame.w * kx), h: Math.round(el.frame.h * ky) }
  }
}

/**
 * Copy the variant LAYOUT of `source` for one canvas onto `target` (another slide):
 * same boxes and styling, but the target keeps its own words. Linked text boxes pick up the
 * target's text by role; if the target has no box with that role they follow its main text box instead.
 */
export function applyVariantLayout(source: Slide, canvasId: string, target: Slide): Slide {
  const v = source.variants?.[canvasId]
  if (!v) return setVariant(target, canvasId, null)
  if (source.id === target.id) return target
  const targetRoles = new Set(target.elements.filter(isContentText).map((e) => e.role).filter(Boolean))
  const main = primaryText(target.elements)
  const elements: SlideElement[] = []
  for (const src of v.elements) {
    const e = clone(src)
    e.id = uid()
    if (e.type === 'text' && e.role && !e.dynamic && e.linked !== false && !targetRoles.has(e.role)) {
      if (!main) continue // nothing to show on a slide without text
      const t = e as TextElement
      if (main.role) t.role = main.role
      else { t.linked = false; t.paragraphs = clone(main.paragraphs) }
    }
    elements.push(e)
  }
  const variant: SlideVariant = { elements: linkVariantElements(target.elements, elements) }
  if (v.background) variant.background = clone(v.background)
  return setVariant(target, canvasId, variant)
}

/** Keep stored variant text equal to the base text (render does this too; this keeps files tidy). */
export function normalizeSlide(slide: Slide): Slide {
  if (!slide.variants) return slide
  let changed = false
  const variants: Record<string, SlideVariant> = {}
  for (const [k, v] of Object.entries(slide.variants)) {
    const els = linkVariantElements(slide.elements, v.elements)
    const same = els === v.elements || els.every((e, i) => e === v.elements[i] || JSON.stringify((e as TextElement).paragraphs) === JSON.stringify((v.elements[i] as TextElement).paragraphs))
    variants[k] = same ? v : { ...v, elements: els }
    if (!same) changed = true
  }
  return changed ? { ...slide, variants } : slide
}

/**
 * Which base element a variant text element takes its words from (undefined = it has its own text).
 * Mirrors linkVariantElements.
 */
export function linkedSource(base: SlideElement[], variant: SlideElement[], elementId: string): TextElement | undefined {
  const seen = new Map<string, number>()
  for (const e of variant) {
    if (e.type !== 'text' || !e.role || e.dynamic || e.linked === false) continue
    const src = base.filter((b): b is TextElement => b.type === 'text' && b.role === e.role && !b.dynamic)
    if (!src.length) continue
    const k = seen.get(e.role) ?? 0
    seen.set(e.role, k + 1)
    if (e.id === elementId) return src[k % src.length]
  }
  return undefined
}

export const hasVariant = (slide: Slide, canvasId: string): boolean => !!slide.variants?.[canvasId]
