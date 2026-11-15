/** Output placement + colour adjustment math — PURE (shared by the Displays UI, the output page and the main process). */
import type { OutputTransform, Rect, Size } from './model'
import { fitRect } from './outputs'

/** ProPresenter's default: a picture that fits sits pixel-for-pixel at the top-left (LED processors expect that); a bigger one is scaled down. */
export function defaultPlacement(src: Size, dest: Size): Rect {
  if (src.width <= dest.width && src.height <= dest.height) return { x: 0, y: 0, w: src.width, h: src.height }
  return fitRect(src, dest, 'contain')
}

/** Whole pixels, at least 1×1. Position is not clamped (a picture may be pushed partly off-frame on purpose). */
export function normalizePlacement(r: Rect): Rect {
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) }
}

/** The part of `r` that is visible inside a dest-sized frame (undefined when entirely outside). */
export function visiblePart(r: Rect, dest: Size): Rect | undefined {
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y)
  const x1 = Math.min(dest.width, r.x + r.w), y1 = Math.min(dest.height, r.y + r.h)
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined
}

/** Placement as CSS percentages of the destination frame (for the preview and for output pages). */
export function placementCss(r: Rect, dest: Size): { left: string; top: string; width: string; height: string } {
  const pc = (n: number, d: number): string => `${(n / d) * 100}%`
  return { left: pc(r.x, dest.width), top: pc(r.y, dest.height), width: pc(r.w, dest.width), height: pc(r.h, dest.height) }
}

export const hasColorAdjust = (t?: OutputTransform): boolean =>
  !!t && ((t.brightness ?? 1) !== 1 || (t.contrast ?? 1) !== 1 || (t.saturation ?? 1) !== 1 || (t.gamma ?? 1) !== 1 || (t.temperature ?? 0) !== 0)

/** SVG filter needed for gamma + colour temperature (CSS has no filter for them). */
export function needsSvgGrade(t?: OutputTransform): boolean {
  return !!t && ((t.gamma ?? 1) !== 1 || (t.temperature ?? 0) !== 0)
}

export const GRADE_FILTER_ID = 'reach-grade'

/** CSS `filter` value for the output page (brightness, contrast, saturation + the SVG grade when needed). */
export function colorFilterCss(t?: OutputTransform): string | undefined {
  if (!hasColorAdjust(t)) return undefined
  const f: string[] = []
  if (needsSvgGrade(t)) f.push(`url(#${GRADE_FILTER_ID})`)
  if ((t!.brightness ?? 1) !== 1) f.push(`brightness(${t!.brightness})`)
  if ((t!.contrast ?? 1) !== 1) f.push(`contrast(${t!.contrast})`)
  if ((t!.saturation ?? 1) !== 1) f.push(`saturate(${t!.saturation})`)
  return f.join(' ')
}

/** Channel multipliers + gamma exponent for the SVG grade. Warm (+) lifts red and lowers blue. */
export function gradeParams(t?: OutputTransform): { r: number; g: number; b: number; exponent: number } {
  const k = Math.max(-1, Math.min(1, t?.temperature ?? 0)) * 0.2
  const gamma = Math.max(0.3, Math.min(3, t?.gamma ?? 1))
  return { r: 1 + k, g: 1, b: 1 - k, exponent: 1 / gamma }
}
