import type { CSSProperties, ReactNode } from 'react'
import { LOGO_COMBO, LOGO_ICON, LOGO_WORDMARK } from './logo-paths'

const ART = { icon: LOGO_ICON, wordmark: LOGO_WORDMARK, combo: LOGO_COMBO }

/**
 * The Reach logo.
 *   icon      — the "Window R"
 *   wordmark  — "Reach" (Perfectly Nineties Semibold, outlined)
 *   combo     — the vertical lockup (the only lockup the brand guide allows)
 *
 * Brand rules this component helps you keep:
 *  - Colour: it draws in `currentColor`. On Charcoal use Paper/White (the default text colour);
 *    on Paper/White use Charcoal, Lakeside or Mustard. Never Lakeside/Mustard on Charcoal.
 *  - Clear space: pass `clear` to pad it by 1× the height of the R on every side.
 *  - Don't stretch, outline, rotate or put it side-by-side with the icon.
 */
export function Logo({ variant = 'wordmark', height = 24, clear, className = '', style, title = 'Reach' }: {
  variant?: 'icon' | 'wordmark' | 'combo'
  /** Rendered height in px (width follows the artwork). */
  height?: number
  /** Add the brand's minimum clear space around the mark. */
  clear?: boolean
  className?: string
  style?: CSSProperties
  title?: string
}): ReactNode {
  const art = ART[variant]
  const [, , w, h] = art.viewBox.split(' ').map(Number)
  // 1× the R height: the icon is one R tall, the wordmark's R is ~92% of its height, the combo's icon ~44%.
  const unit = height * (variant === 'combo' ? 0.44 : variant === 'wordmark' ? 0.92 : 1)
  return (
    <svg className={`logo logo-${variant} ${className}`} viewBox={art.viewBox} height={height} width={(height * w) / h} fill="currentColor" role="img" aria-label={title}
      style={{ display: 'block', flex: 'none', margin: clear ? unit : undefined, ...style }}>
      <path d={art.d} />
    </svg>
  )
}

/**
 * The default "logo" screen for outputs: the vertical combo mark in Paper on Charcoal, 1920×1080.
 * Small enough to store inline as `workspace.logo.src` (data: URIs pass straight through mediaUrl()).
 */
export function logoScreenSvg(width = 1920, height = 1080): string {
  const [, , w, h] = LOGO_COMBO.viewBox.split(' ').map(Number)
  const scale = (height * 0.34) / h
  const x = (width - w * scale) / 2
  const y = (height - h * scale) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#292929"/><path fill="#F4F2EB" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(4)})" d="${LOGO_COMBO.d}"/></svg>`
}
export const LOGO_SCREEN_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(logoScreenSvg())}`
