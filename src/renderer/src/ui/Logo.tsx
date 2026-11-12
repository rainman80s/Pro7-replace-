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
