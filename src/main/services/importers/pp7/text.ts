import type { Paragraph, Shadow, TextRun, TextStyle } from '@shared/model'
import { parseRtf, rtfColorToCss, strokeWidthPx, type RtfDocument, type RtfRunStyle } from '../rtf/rtf'
import { cssColor, type PB } from './proto'
import type { ConvertContext } from './context'

/** CSS line-height that corresponds to ProPresenter's "line height multiple = 1" (the font's natural leading). */
export const NATURAL_LINE_HEIGHT = 1.2

const WEIGHTS: [RegExp, number][] = [
  [/(ultra|extra)[ -]?light|hairline/i, 200], [/thin/i, 100], [/semi[ -]?light|demi[ -]?light/i, 350], [/light/i, 300],
  [/(semi|demi)[ -]?bold|semibd/i, 600], [/(extra|ultra)[ -]?bold|heavy/i, 800], [/black/i, 900], [/medium/i, 500], [/bold|\bbd\b/i, 700],
  [/regular|roman|book|normal/i, 400]
]

/**
 * PostScript font name → CSS family + weight/italic. "HelveticaNeue-BoldItalic" → { family: "Helvetica Neue", weight: 700, italic }.
 * `family` from ProPresenter's own attributes wins when supplied.
 */
export function fontFromName(psName: string, family?: string): { family: string; weight?: number; italic?: boolean } {
  const name = (psName ?? '').trim()
  let base = name
  let stylePart = ''
  const dash = name.lastIndexOf('-')
  if (dash > 0) { base = name.slice(0, dash); stylePart = name.slice(dash + 1) }
  else {
    // "Arial Bold Italic", "Arial-BoldMT" handled above; here: trailing style words separated by spaces
    const m = /^(.*?)[ ]+((?:(?:Ultra|Extra|Semi|Demi)?\s?(?:Light|Bold|Black|Thin|Medium|Heavy|Regular|Italic|Oblique|Condensed)\s?)+)$/i.exec(name)
    if (m && family && m[1].trim().toLowerCase() === family.trim().toLowerCase()) { base = m[1]; stylePart = m[2] }
  }
  let weight: number | undefined
  for (const [re, w] of WEIGHTS) if (re.test(stylePart)) { weight = w; break }
  const italic = /italic|oblique|\bit\b/i.test(stylePart) || undefined
  let fam = family?.trim()
  if (!fam || fam === name) {
    fam = base.replace(/(PSMT|MT|PS)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim()
    if (!fam) fam = name
  }
  return { family: fam, weight: weight && weight !== 400 ? weight : undefined, italic }
}

export interface ConvertedText {
  paragraphs: Paragraph[]
  style: TextStyle
  align?: Paragraph['align']
  plain: string
  dialect?: RtfDocument['dialect']
}

function runStyle(rs: RtfRunStyle, dialect: RtfDocument['dialect'], family?: string): TextStyle {
  const s: TextStyle = {}
  if (rs.font) {
    const f = fontFromName(rs.font, family)
    s.fontFamily = f.family
    if (f.weight) s.fontWeight = f.weight
    if (f.italic) s.italic = true
  }
  if (rs.fontSize) s.fontSize = rs.fontSize
  if (rs.bold) s.fontWeight = Math.max(700, Number(s.fontWeight ?? 0))
  if (rs.italic) s.italic = true
  if (rs.underline) s.underline = true
  const color = rtfColorToCss(rs.color)
  if (color) s.color = color
  const sw = strokeWidthPx(dialect, rs.strokeWidth, rs.fontSize)
  if (sw > 0) {
    s.strokeWidth = Math.round(sw * 100) / 100
    s.strokeColor = rtfColorToCss(rs.strokeColor) ?? '#000000'
  }
  if (rs.caps) s.textTransform = 'uppercase'
  if (rs.kerning) s.letterSpacing = rs.kerning
  return s
}

const STYLE_KEYS: (keyof TextStyle)[] = ['fontFamily', 'fontSize', 'fontWeight', 'italic', 'underline', 'color', 'letterSpacing', 'textTransform', 'strokeColor', 'strokeWidth']

/** Style from rv.data.Graphics.Text.Attributes (the "dominant" attributes ProPresenter stores beside the RTF). */
export function styleFromAttributes(a: PB | undefined, ctx?: ConvertContext): { style: TextStyle; align?: Paragraph['align']; lineHeight?: number } {
  const style: TextStyle = {}
  if (!a) return { style }
  const font = a.font
  if (font?.name || font?.family) {
    const f = fontFromName(font.name || font.family, font.family || undefined)
    style.fontFamily = f.family
    if (f.weight) style.fontWeight = f.weight
    if (f.italic) style.italic = true
    if (font.bold) style.fontWeight = Math.max(700, Number(style.fontWeight ?? 0))
    if (font.italic) style.italic = true
    if (font.size) style.fontSize = font.size
  }
  const color = cssColor(a.text_solid_fill, { keepTransparent: true })
  if (color && a.text_solid_fill) style.color = color
  if (a.text_gradient_fill?.gradient?.stops?.length) {
    style.color = cssColor(a.text_gradient_fill.gradient.stops[0].color) ?? style.color
    ctx?.note('text.gradientFill')
  }
  if (a.cut_out_fill) ctx?.note('text.cutOutFill')
  if (a.media_fill) ctx?.note('text.mediaFill')
  if (a.background_effect) ctx?.note('text.backgroundEffectFill')
  if (a.stroke_width > 0) {
    style.strokeWidth = a.stroke_width
    style.strokeColor = cssColor(a.stroke_color) ?? '#000000'
  }
  if (a.kerning) style.letterSpacing = a.kerning
  if (a.underline_style?.style && a.underline_style.style !== 'STYLE_NONE') style.underline = true
  switch (a.capitalization) {
    case 'CAPITALIZATION_ALL_CAPS': style.textTransform = 'uppercase'; break
    case 'CAPITALIZATION_TITLE_CASE': case 'CAPITALIZATION_START_CASE': style.textTransform = 'capitalize'; break
    case 'CAPITALIZATION_SMALL_CAPS': ctx?.note('text.smallCaps'); break
  }
  const ps = a.paragraph_style
  let align: Paragraph['align']
  let lineHeight: number | undefined
  if (ps) {
    align = alignOf(ps.alignment)
    if (ps.line_height_multiple > 0) lineHeight = round3(ps.line_height_multiple * NATURAL_LINE_HEIGHT)
    if (ps.text_list?.is_enabled) ctx?.note('text.list')
  }
  return { style, align, lineHeight }
}

export function alignOf(a: string | undefined): Paragraph['align'] {
  switch (a) {
    case 'ALIGNMENT_RIGHT': return 'right'
    case 'ALIGNMENT_CENTER': return 'center'
    case 'ALIGNMENT_JUSTIFIED': return 'justify'
    case 'ALIGNMENT_LEFT': case 'ALIGNMENT_NATURAL': return 'left'
    default: return a === undefined ? 'left' : undefined
  }
}

/**
 * rv.data.Graphics.Text (rtf_data + attributes) → paragraphs + a default style.
 * The element style is the style covering the most characters; runs only carry what differs from it.
 * Falls back to `attributes` when the RTF is empty or unreadable.
 */
export function convertText(text: PB | undefined, ctx: ConvertContext): ConvertedText {
  const attrs = styleFromAttributes(text?.attributes, ctx)
  const family: string | undefined = text?.attributes?.font?.family || undefined
  const psName: string | undefined = text?.attributes?.font?.name || undefined
  const rtfBytes: Uint8Array | undefined = text?.rtf_data
  if (!rtfBytes || !rtfBytes.length) {
    const style = { ...attrs.style }
    if (attrs.lineHeight) style.lineHeight = attrs.lineHeight
    return { paragraphs: [], style, align: attrs.align, plain: '' }
  }
  let doc: RtfDocument
  try {
    doc = parseRtf(rtfBytes)
  } catch (e) {
    ctx.warn(`RTF could not be parsed (${(e as Error).message}); used the stored text attributes instead`)
    return { paragraphs: [], style: attrs.style, align: attrs.align, plain: '' }
  }
  for (const w of doc.warnings) ctx.warn(`RTF: ${w}`)

  // Dominant style by character count
  const tally = new Map<string, { n: number; style: TextStyle }>()
  const converted = doc.paragraphs.map((p) => ({
    align: p.align,
    lineHeight: p.lineHeight,
    runs: p.runs.map((r) => {
      // Only trust ProPresenter's "family" for runs that use the dominant font face
      const st = runStyle(r.style, doc.dialect, r.style.font && r.style.font === psName ? family : undefined)
      const key = JSON.stringify(st)
      const t = tally.get(key) ?? { n: 0, style: st }
      t.n += Math.max(1, r.text.trim().length)
      tally.set(key, t)
      return { text: r.text, style: st }
    })
  }))
  let dominant: TextStyle = {}
  let best = -1
  for (const t of tally.values()) if (t.n > best) { best = t.n; dominant = t.style }
  // attributes fill the gaps the RTF didn't specify; RTF wins where both exist (it is what ProPresenter renders)
  const style: TextStyle = { ...attrs.style, ...dominant }
  if (!doc.paragraphs.length) Object.assign(style, attrs.style)
  if (attrs.style.textTransform && !style.textTransform) style.textTransform = attrs.style.textTransform
  const lh = doc.paragraphs.find((p) => p.lineHeight)?.lineHeight
  const lineHeight = lh ? round3(lh * NATURAL_LINE_HEIGHT) : attrs.lineHeight
  if (lineHeight) style.lineHeight = lineHeight

  const firstAlign = converted.find((p) => p.align)?.align ?? attrs.align
  const paragraphs: Paragraph[] = converted.map((p) => {
    const runs: TextRun[] = p.runs.map((r) => {
      const diff: TextStyle = {}
      let any = false
      for (const k of STYLE_KEYS) {
        if (r.style[k] !== style[k]) {
          if (r.style[k] === undefined) {
            // explicit "not bold / not italic / no stroke" relative to the dominant style
            if (k === 'fontWeight') { diff.fontWeight = 400; any = true }
            else if (k === 'italic') { diff.italic = false; any = true }
            else if (k === 'underline') { diff.underline = false; any = true }
            else if (k === 'strokeWidth') { diff.strokeWidth = 0; any = true }
            else if (k === 'textTransform' && !attrs.style.textTransform) { diff.textTransform = 'none'; any = true }
          } else { (diff as Record<string, unknown>)[k] = r.style[k]; any = true }
        }
      }
      return any ? { text: r.text, style: diff } : { text: r.text }
    })
    const para: Paragraph = { runs: runs.length ? runs : [{ text: '' }] }
    if (p.align && p.align !== firstAlign) para.align = p.align
    return para
  })
  return { paragraphs, style, align: firstAlign, plain: doc.plain, dialect: doc.dialect }
}

/** rv.data.Graphics.Shadow → Shadow (angle is counter-clockwise from +x, as in Cocoa: 315° = down-right). */
export function convertShadow(s: PB | undefined, requireEnable = true): Shadow | undefined {
  if (!s) return undefined
  if (requireEnable && !s.enable) return undefined
  const rad = ((s.angle ?? 0) * Math.PI) / 180
  const off = s.offset ?? 0
  const color = cssColor(s.color ?? { alpha: 1 }, { opacity: s.opacity ?? 1, keepTransparent: true }) ?? 'rgba(0, 0, 0, 0.75)'
  return { color, blur: round3(s.radius ?? 0), x: round3(off * Math.cos(rad)), y: round3(-off * Math.sin(rad)) }
}

export const round3 = (n: number): number => Math.round(n * 1000) / 1000
