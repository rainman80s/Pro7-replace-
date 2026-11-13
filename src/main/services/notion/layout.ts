/** SlideSpec → Slide in Reach's default look (themes restyle by role afterwards). */
import type { MediaRef, Size, Slide, TextElement, TextRun, TextStyle } from '@shared/model'
import { DEFAULT_SIZE } from '@shared/model'
import type { Passage, Verse } from '@shared/bible'
import { defaultPaging, formatReference, pageVerses, scriptureSlides } from '@shared/bible'
import { textEl } from '@shared/bible'
import type { Para, SlideSpec } from './blocks'
import { runsText } from './blocks'
import { hashOf } from '../integrations/http'

export interface LayoutOptions {
  size?: Size
  emphasis?: 'underline' | 'bold'
  newId: () => string
  /** Resolved media for image specs, by block id. */
  media?: Record<string, MediaRef>
  autoAdvance?: number
}

const MUSTARD = '#E6A20F'

function toRuns(p: Para, scripture: boolean, emphasis: 'underline' | 'bold'): TextRun[] {
  return p.map((r) => {
    const style: TextStyle = {}
    if (r.bold) { if (scripture && emphasis === 'underline') style.underline = true; else style.fontWeight = 700 }
    if (r.italic) style.italic = true
    if (r.underline) style.underline = true
    if (r.ref) { style.color = MUSTARD; style.fontWeight = 600 }
    return Object.keys(style).length ? { text: r.text, style } : { text: r.text }
  })
}

export function specToSlides(spec: SlideSpec, o: LayoutOptions): Slide[] {
  const size = o.size ?? DEFAULT_SIZE
  const W = size.width, H = size.height
  const id = o.newId
  const em = o.emphasis ?? 'underline'
  const font = 'Reach Sans'
  const els: TextElement[] = []
  const base: Slide = { id: id(), label: undefined, elements: [] }
  const notes = spec.notes.length ? spec.notes.join('\n') : undefined
  const scripture = spec.kind === 'scripture'
  const body = (paras: Para[], frame: { x: number; y: number; w: number; h: number }, style: TextStyle, extra: Partial<TextElement> = {}): TextElement =>
    textEl('body', paras.map((p) => toRuns(p, scripture, em)), frame, { fontFamily: font, color: '#FFFFFF', lineHeight: 1.3, ...style }, extra, id)

  switch (spec.kind) {
    case 'image': {
      const media = o.media?.[spec.image!.blockId]
      if (!media) return [{ ...base, label: spec.image?.caption ?? 'Image', notes, elements: [textEl('caption', [[{ text: `Image “${spec.image?.name}” couldn’t be downloaded` }]], { x: W * 0.1, y: H * 0.4, w: W * 0.8, h: H * 0.2 }, { fontFamily: font, fontSize: 40, color: '#A9A7A1' }, {}, id)] }]
      return [{ ...base, label: spec.image?.caption ?? media.name ?? 'Image', notes, background: { type: 'color', color: '#000000' }, elements: [{ id: id(), type: 'image', name: 'Image', media, fit: 'contain', frame: { x: 0, y: 0, w: W, h: H } }] }]
    }
    case 'title':
      els.push(textEl('title', [toRuns(spec.title!, false, em)], { x: W * 0.08, y: H * 0.2, w: W * 0.84, h: H * 0.6 }, { fontFamily: font, fontSize: Math.round(H * 0.11), fontWeight: 700, color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: 2 }, {}, id))
      break
    case 'point': case 'points': {
      els.push(textEl('title', [toRuns(spec.title!, false, em)], { x: W * 0.08, y: H * 0.1, w: W * 0.84, h: H * 0.2 }, { fontFamily: font, fontSize: Math.round(H * 0.075), fontWeight: 700, color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: 1 }, {}, id))
      if (spec.reveal) {
        const h = (H * 0.58) / Math.max(1, spec.body.length)
        spec.body.forEach((p, i) => els.push(body([p], { x: W * 0.12, y: H * 0.32 + i * h, w: W * 0.76, h }, { fontSize: Math.round(H * 0.05), fontWeight: 500 }, { align: 'left', buildIn: i + 1, name: `Point ${i + 1}` })))
      } else els.push(body(spec.body, { x: W * 0.1, y: H * 0.32, w: W * 0.8, h: H * 0.58 }, { fontSize: Math.round(H * 0.05), fontWeight: 500 }, spec.bullets ? { align: 'left' } : {}))
      break
    }
    case 'quote':
      els.push(body(spec.body, { x: W * 0.1, y: H * 0.12, w: W * 0.8, h: H * 0.62 }, { fontSize: Math.round(H * 0.06), italic: true }))
      if (spec.attribution) els.push(textEl('caption', [[{ text: `— ${spec.attribution}` }]], { x: W * 0.1, y: H * 0.78, w: W * 0.8, h: H * 0.08 }, { fontFamily: font, fontSize: Math.round(H * 0.035), color: MUSTARD, fontWeight: 600 }, { autoFit: false }, id))
      break
    case 'scripture':
      els.push(body(spec.body, { x: W * 0.08, y: H * 0.08, w: W * 0.84, h: spec.reference ? H * 0.7 : H * 0.84 }, { fontSize: Math.round(H * 0.055), fontWeight: 500 }))
      if (spec.reference) els.push(textEl('reference', [[{ text: spec.reference }]], { x: W * 0.08, y: H * 0.8, w: W * 0.84, h: H * 0.08 }, { fontFamily: font, fontSize: Math.round(H * 0.038), fontWeight: 600, color: MUSTARD, letterSpacing: 1 }, { autoFit: false }, id))
      break
    case 'announcement': {
      const media = spec.image ? o.media?.[spec.image.blockId] : undefined
      if (media) base.background = { type: 'media', media, fit: 'cover' }
      const shade = { id: id(), type: 'shape' as const, shape: 'rect' as const, name: 'Shade', frame: { x: 0, y: H * 0.56, w: W, h: H * 0.44 }, fill: { type: 'gradient' as const, angle: 180, stops: [{ color: 'rgba(0,0,0,0)', at: 0 }, { color: 'rgba(0,0,0,0.82)', at: 0.45 }] } }
      if (spec.title) els.push(textEl('title', [toRuns(spec.title, false, em)], { x: W * 0.06, y: H * 0.62, w: W * 0.88, h: H * 0.12 }, { fontFamily: font, fontSize: Math.round(H * 0.065), fontWeight: 700, color: '#FFFFFF' }, { align: 'left', verticalAlign: 'bottom' }, id))
      if (spec.body.length) els.push(body(spec.body, { x: W * 0.06, y: H * 0.75, w: W * 0.88, h: H * 0.2 }, { fontSize: Math.round(H * 0.032) }, { align: 'left', verticalAlign: 'top' }))
      return [{ ...base, label: runsText(spec.title ?? []) || 'Announcement', notes, autoAdvance: o.autoAdvance, elements: media || els.length ? [shade, ...els] : els }]
    }
    default:
      els.push(body(spec.body, { x: W * 0.08, y: H * 0.1, w: W * 0.84, h: H * 0.8 }, { fontSize: Math.round(H * 0.058), fontWeight: 500 }, spec.bullets ? { align: 'left' } : {}))
  }
  const label = runsText(spec.title ?? []).trim() || spec.reference || runsText(spec.body.find((p) => !p[0]?.ref) ?? []).trim()
  return [{ ...base, label: label.length > 40 ? label.slice(0, 38) + '…' : label, notes, elements: els }]
}

export type VerseLookup = (passages: Passage[]) => Promise<{ verses: Verse[]; translation: string; copyright?: string; warning?: string }[]>

/** Expand "fill from the Bible" specs into scripture slides. Offline/unknown → a placeholder slide with the reference. */
export async function fillScripture(spec: SlideSpec, lookup: VerseLookup, o: LayoutOptions & { maxChars: number }): Promise<{ slides: Slide[]; warnings: string[] }> {
  const warnings: string[] = []
  const slides: Slide[] = []
  let res: Awaited<ReturnType<VerseLookup>> = []
  try { res = await lookup(spec.fill ?? []) } catch (e) { warnings.push(`Couldn’t look up ${spec.reference}: ${e instanceof Error ? e.message : String(e)}`) }
  for (const [i, r] of res.entries()) {
    if (r.warning) warnings.push(r.warning)
    if (!r.verses.length) continue
    const p = spec.fill![i]
    const pages = pageVerses(r.verses, { ...defaultPaging(), maxChars: o.maxChars })
    slides.push(...scriptureSlides(pages, { ...p, translation: r.translation }, { size: o.size, newId: o.newId, translationLabel: r.translation, copyright: r.copyright, showVerseNumbers: true, reference: 'each' }))
  }
  if (!slides.length) {
    slides.push(...specToSlides({ ...spec, kind: 'scripture', body: [[{ text: '(Scripture text will appear here — add it in Notion or install this translation)', italic: true }]] }, o))
    warnings.push(`${spec.reference ?? 'A reference'}: no text found — left a placeholder slide.`)
  }
  if (slides[0] && spec.notes.length) slides[0].notes = spec.notes.join('\n')
  return { slides, warnings }
}

/** Hash that changes when the generated content would change (includes resolved scripture text). */
export const slidesHash = (spec: SlideSpec, slides: Slide[]): string => hashOf([spec.srcHash, slides.map((s) => s.elements.map((e) => (e.type === 'text' ? e.paragraphs : e.type)))])

export { formatReference }
