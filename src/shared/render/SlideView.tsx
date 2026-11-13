import { createContext, memo, useContext, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Fill, MediaRef, Size, SlideElement, TextElement, TextStyle, Shadow, Paragraph } from '../model'
import { mediaUrl } from '../media'

/** Values for dynamic text tokens, e.g. { clock: '10:42', 'current.text': '...', 'timer:abc': '4:59' }. */
export type Tokens = Record<string, string>

/** Rendering hints passed down the tree. `still`: thumbnails/editor — videos don't autoplay. */
const RenderContext = createContext<{ still?: boolean }>({})

export function fillStyle(fill?: Fill): CSSProperties {
  if (!fill) return {}
  if (fill.type === 'color') return { background: fill.color }
  if (fill.type === 'gradient') {
    const stops = [...fill.stops].sort((a, b) => a.at - b.at)
    return { background: `linear-gradient(${fill.angle}deg, ${stops.map((s) => `${s.color} ${Math.round(s.at * 100)}%`).join(', ')})` }
  }
  return {}
}

const shadowCss = (s?: Shadow): string | undefined => (s ? `${s.x}px ${s.y}px ${s.blur}px ${s.color}` : undefined)

/** Brand fonts are licensed and may be missing on a given computer: each gets a look-alike fallback chain. */
export const FONT_FALLBACKS: Record<string, string> = {
  'Perfectly Nineties': '"Cormorant Garamond", "Playfair Display", Georgia, "Times New Roman", serif',
  'TAY Birdie': '"Reach Sans", "Inter", "Helvetica Neue", Arial, sans-serif',
  'Courier Prime': '"Courier New", Courier, ui-monospace, monospace',
  'Marina Script': '"Snell Roundhand", "Brush Script MT", cursive',
  'Reach Sans': '"Inter", "SF Pro Display", "Helvetica Neue", "Segoe UI", Arial, sans-serif'
}
const GENERIC_FALLBACK = 'var(--slide-font-fallback, "Reach Sans", "Inter", "Helvetica Neue", Arial, sans-serif)'
export function fontStack(family: string): string {
  if (family.includes(',')) return family
  return `"${family}", ${FONT_FALLBACKS[family] ?? GENERIC_FALLBACK}`
}

export function textStyleCss(s: TextStyle | undefined): CSSProperties {
  if (!s) return {}
  const css: CSSProperties = {}
  if (s.fontFamily) css.fontFamily = fontStack(s.fontFamily)
  if (s.fontSize) css.fontSize = s.fontSize
  if (s.fontWeight) css.fontWeight = s.fontWeight as CSSProperties['fontWeight']
  if (s.italic) css.fontStyle = 'italic'
  if (s.underline) css.textDecoration = 'underline'
  if (s.color) css.color = s.color
  if (s.letterSpacing) css.letterSpacing = s.letterSpacing
  if (s.lineHeight) css.lineHeight = s.lineHeight
  if (s.textTransform) css.textTransform = s.textTransform
  if (s.strokeWidth) {
    ;(css as Record<string, unknown>).WebkitTextStroke = `${s.strokeWidth}px ${s.strokeColor ?? '#000'}`
    ;(css as Record<string, unknown>).paintOrder = 'stroke fill'
  }
  if (s.shadow) css.textShadow = shadowCss(s.shadow)
  return css
}

export function applyTokens(text: string, tokens?: Tokens): string {
  if (!tokens) return text
  return text.replace(/\{([^{}]+)\}/g, (m, k: string) => (k.trim() in tokens ? tokens[k.trim()] : m))
}

function MediaFill({ media, fit, video }: { media: MediaRef; fit?: string; video?: Partial<{ loop: boolean; muted: boolean }> }): ReactNode {
  const { still } = useContext(RenderContext)
  const style: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: fit === 'stretch' ? 'fill' : ((fit ?? 'cover') as 'cover' | 'contain') }
  if (media.kind === 'video') {
    if (still) return <video src={`${mediaUrl(media)}#t=0.1`} style={style} preload="metadata" muted playsInline />
    return <video src={mediaUrl(media)} style={style} autoPlay playsInline loop={video?.loop ?? true} muted={video?.muted ?? true} />
  }
  return <img src={mediaUrl(media)} style={style} draggable={false} alt="" />
}

/** Largest scale ≤ 1 at which `node` (the text) fits inside `box` (the frame). Used by auto-fit and the editor. */
export function measureAutoFit(box: HTMLElement, node: HTMLElement, padding = 0): number {
  const pad = padding * 2
  const prevT = node.style.transform
  const prevW = node.style.width
  const fits = (scale: number): boolean => {
    node.style.transform = `scale(${scale})`
    node.style.width = `${100 / scale}%`
    return node.scrollHeight * scale <= box.clientHeight - pad + 1 && node.scrollWidth * scale <= box.clientWidth - pad + 1
  }
  let lo = 0.1
  let hi = 1
  if (!fits(1)) {
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) lo = mid
      else hi = mid
    }
    hi = lo
  }
  node.style.transform = prevT
  node.style.width = prevW
  return hi
}

/** The exact CSS of a text box — shared with the editor so in-place editing is pixel-identical. */
export function textBoxStyles(el: TextElement, k = 1): { outer: CSSProperties; inner: CSSProperties } {
  const align = el.align ?? 'center'
  const v = el.verticalAlign ?? 'middle'
  return {
    outer: {
      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: el.padding ?? 0, overflow: 'hidden',
      justifyContent: v === 'top' ? 'flex-start' : v === 'bottom' ? 'flex-end' : 'center', borderRadius: el.cornerRadius,
      ...fillStyle(el.fill)
    },
    inner: {
      position: 'relative', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', lineHeight: 1.2, textAlign: align, ...textStyleCss(el.style),
      transform: k !== 1 ? `scale(${k})` : undefined, width: k !== 1 ? `${100 / k}%` : '100%',
      transformOrigin: `${align === 'left' || align === 'justify' ? 'left' : align === 'right' ? 'right' : 'center'} ${v === 'top' ? 'top' : v === 'bottom' ? 'bottom' : 'center'}`,
      alignSelf: align === 'left' || align === 'justify' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'
    }
  }
}

/**
 * ProPresenter "text transform" (kept by the importer in `ext.transform`): e.g. the LED lyric strip shows
 * a whole lyric slide on ONE line. Applied at render time so the underlying lyrics stay multi-line.
 */
export function transformParagraphs(paragraphs: Paragraph[], transform?: unknown, delimiter?: unknown): Paragraph[] {
  if (transform === 'single_line' || transform === 'replace_line_returns') {
    const sep = typeof delimiter === 'string' && delimiter ? delimiter : ' '
    const runs = paragraphs.flatMap((p, i) => (i && p.runs.length ? [{ text: sep, style: p.runs[0].style }, ...p.runs] : p.runs))
    return [{ runs, align: paragraphs[0]?.align }]
  }
  if (transform === 'one_word_per_line') {
    return paragraphs.flatMap((p) => p.runs.flatMap((r) => r.text.split(/\s+/).filter(Boolean).map((w) => ({ runs: [{ text: w, style: r.style }], align: p.align }))))
  }
  return paragraphs
}

function TextBox({ el, tokens }: { el: TextElement; tokens?: Tokens }): ReactNode {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [k, setK] = useState(1)
  const tokenKey = el.dynamic && tokens ? el.paragraphs.map((p) => p.runs.map((r) => applyTokens(r.text, tokens)).join('')).join('\n') : ''

  // Auto-fit: shrink the text until it fits its frame.
  useLayoutEffect(() => {
    if (!el.autoFit || !outer.current || !inner.current) return void setK(1)
    setK(measureAutoFit(outer.current, inner.current, el.padding ?? 0))
  }, [el.paragraphs, tokenKey, el.autoFit, el.frame.w, el.frame.h, el.style, el.padding, el.align])

  const st = textBoxStyles(el, k)
  return (
    <div ref={outer} style={st.outer}>
      {el.fill?.type === 'media' && <MediaFill media={el.fill.media} fit={el.fill.fit} />}
      <div ref={inner} style={st.inner}>
        {transformParagraphs(el.paragraphs, (el as { ext?: Record<string, unknown> }).ext?.transform, (el as { ext?: Record<string, unknown> }).ext?.transformDelimiter).map((p, i) => (
          <div key={i} style={{ textAlign: p.align, minHeight: '1em' }}>
            {p.runs.map((r, j) => (
              <span key={j} style={textStyleCss(r.style)}>{el.dynamic ? applyTokens(r.text, tokens) : r.text}</span>
            ))}
            {p.runs.every((r) => !r.text) && '​'}
          </div>
        ))}
      </div>
    </div>
  )
}

function ElementViewImpl({ el, tokens, interactive }: { el: SlideElement; tokens?: Tokens; interactive?: boolean }): ReactNode {
  if (el.hidden) return null
  const boxed = el.type !== 'text' || !!el.fill
  const base: CSSProperties = {
    position: 'absolute', left: el.frame.x, top: el.frame.y, width: el.frame.w, height: el.frame.h,
    opacity: el.opacity ?? 1, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    boxShadow: boxed ? shadowCss(el.shadow) : undefined,
    outline: el.stroke ? `${el.stroke.width}px solid ${el.stroke.color}` : undefined,
    outlineOffset: el.stroke ? -el.stroke.width : undefined,
    borderRadius: el.cornerRadius, overflow: el.type === 'text' ? undefined : 'hidden', pointerEvents: interactive ? undefined : 'none'
  }
  let body: ReactNode = null
  if (el.type === 'text') body = <TextBox el={el} tokens={tokens} />
  else if (el.type === 'shape') {
    if (el.shape === 'ellipse') base.borderRadius = '50%'
    if (el.shape === 'line') {
      const w = el.stroke?.width ?? 4
      body = <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: w, marginTop: -w / 2, background: el.stroke?.color ?? (el.fill?.type === 'color' ? el.fill.color : '#fff'), borderRadius: el.cornerRadius }} />
      base.outline = undefined
      base.overflow = undefined
      base.boxShadow = undefined
    } else if (el.shape === 'polygon' && el.points && el.points.length >= 3) {
      // Points are normalised 0..1 within the frame.
      const pts = el.points
      base.outline = undefined
      base.boxShadow = undefined
      base.overflow = undefined
      if (el.shadow) base.filter = `drop-shadow(${shadowCss(el.shadow)})`
      body = (
        <>
          <div style={{ position: 'absolute', inset: 0, clipPath: `polygon(${pts.map(([x, y]) => `${x * 100}% ${y * 100}%`).join(', ')})`, ...fillStyle(el.fill) }}>
            {el.fill?.type === 'media' && <MediaFill media={el.fill.media} fit={el.fill.fit} />}
          </div>
          {el.stroke && (
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
              <polygon points={pts.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={el.stroke.color} strokeWidth={el.stroke.width} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </svg>
          )}
        </>
      )
    } else {
      Object.assign(base, fillStyle(el.fill))
      if (el.fill?.type === 'media') body = <MediaFill media={el.fill.media} fit={el.fill.fit} />
    }
  } else if (el.type === 'image') body = <MediaFill media={el.media} fit={el.fit ?? 'contain'} />
  else if (el.type === 'video') body = <MediaFill media={el.media} fit={el.fit ?? 'contain'} video={{ loop: el.loop ?? false, muted: el.muted ?? true }} />
  else if (el.type === 'live') {
    body = el.source.kind === 'web' && el.source.ref
      ? <iframe src={el.source.ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
      : <LiveSourcePlaceholder el={el} />
  }
  return <div data-el={el.id} style={base}>{body}</div>
}

/** Memoised: a static element is not re-rendered when only the live tokens (clock, timers) tick. */
export const ElementView = memo(ElementViewImpl, (a, b) => {
  if (a.el !== b.el || a.interactive !== b.interactive) return false
  if (a.tokens === b.tokens) return true
  return !(a.el.type === 'text' && a.el.dynamic)
})

/** Replaced at runtime by features that provide live inputs (camera/NDI). */
export const liveSourceRenderers: Record<string, (ref: string) => ReactNode> = {}
function LiveSourcePlaceholder({ el }: { el: Extract<SlideElement, { type: 'live' }> }): ReactNode {
  const r = liveSourceRenderers[el.source.kind]
  if (r) return r(el.source.ref)
  const names: Record<string, string> = { camera: 'Camera', ndi: 'NDI source', web: 'Web page', screen: 'Screen capture' }
  const u = Math.max(14, Math.min(el.frame.w, el.frame.h) * 0.08)
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#8d8d8d', background: 'repeating-linear-gradient(45deg, #141414 0 24px, #1b1b1b 24px 48px)', fontSize: u, fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
      <div><div style={{ fontWeight: 700, letterSpacing: '.12em' }}>LIVE</div><div style={{ fontSize: u * 0.6 }}>{names[el.source.kind] ?? el.source.kind}{el.source.ref ? ` · ${el.source.ref}` : ''}</div></div>
    </div>
  )
}

export interface SlideViewProps {
  elements: SlideElement[]
  background?: Fill
  size: Size
  tokens?: Tokens
  /** Reveal only elements whose buildIn <= build. Undefined = show all. */
  build?: number
  /** Draw the background (false for live outputs where the slide floats over a media layer). */
  opaque?: boolean
  /** Operator previews only: draw a grey checkerboard where there is no background. */
  checker?: boolean
  style?: CSSProperties
  children?: ReactNode
}

/** Draws a slide at its design size (unscaled). Wrap in <Fit> to scale it into a container. */
export function checkerStyle(size: Size): CSSProperties {
  const c = Math.max(8, Math.round(size.width / 48))
  return { backgroundColor: '#8a8a8a', backgroundImage: 'conic-gradient(#b4b4b4 25%, transparent 0 50%, #b4b4b4 0 75%, transparent 0)', backgroundSize: `${c * 2}px ${c * 2}px` }
}

export function SlideView({ elements, background, size, tokens, build, opaque, checker, style, children }: SlideViewProps): ReactNode {
  return (
    <div data-slide-view style={{ position: 'relative', width: size.width, height: size.height, overflow: 'hidden', background: opaque ? '#000' : undefined, ...(checker && !background ? checkerStyle(size) : null), ...style }}>
      {background && (
        <div style={{ position: 'absolute', inset: 0, ...fillStyle(background) }}>
          {background.type === 'media' && <MediaFill media={background.media} fit={background.fit} />}
        </div>
      )}
      {elements.map((el) => (build === undefined || (el.buildIn ?? 0) <= build ? <ElementView key={el.id} el={el} tokens={tokens} /> : null))}
      {children}
    </div>
  )
}

/** Scales fixed-size content to fit its container (contain / cover / stretch), centered. */
export function Fit({ size, fit = 'contain', children, style, className }: { size: Size; fit?: 'contain' | 'cover' | 'stretch'; children: ReactNode; style?: CSSProperties; className?: string }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  let sx = 1
  let sy = 1
  if (box) {
    const kx = box.w / size.width
    const ky = box.h / size.height
    if (fit === 'stretch') { sx = kx; sy = ky }
    else sx = sy = fit === 'cover' ? Math.max(kx, ky) : Math.min(kx, ky)
  }
  return (
    <div ref={ref} className={className} style={{ position: 'relative', overflow: 'hidden', width: '100%', height: '100%', ...style }}>
      {box && (
        <div style={{ position: 'absolute', left: (box.w - size.width * sx) / 2, top: (box.h - size.height * sy) / 2, width: size.width, height: size.height, transform: `scale(${sx}, ${sy})`, transformOrigin: '0 0' }}>
          {children}
        </div>
      )}
    </div>
  )
}

const STILL = { still: true }
/** Wrap editor/thumbnail trees so slide videos show a still frame instead of playing. */
export function StillMedia({ children }: { children: ReactNode }): ReactNode {
  return <RenderContext.Provider value={STILL}>{children}</RenderContext.Provider>
}

/** A self-scaling slide thumbnail that keeps the slide's aspect ratio. */
export function SlideThumb({ elements, background, size, tokens, checker, style, className, children }: SlideViewProps & { className?: string }): ReactNode {
  return (
    <div className={className} style={{ aspectRatio: `${size.width} / ${size.height}`, width: '100%', background: '#000', ...style }}>
      <Fit size={size}>
        <RenderContext.Provider value={STILL}>
          <SlideView elements={elements} background={background} size={size} tokens={tokens} opaque checker={checker}>{children}</SlideView>
        </RenderContext.Provider>
      </Fit>
    </div>
  )
}
