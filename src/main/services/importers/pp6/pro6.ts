/**
 * ProPresenter 4 / 5 / 6 documents (.pro4/.pro5/.pro6: XML, text as base64 RTF) → Presentation.
 * Reuses the RTF parser and the PP7 element/media conventions so both importers produce the same shapes.
 */
import { DOMParser } from '@xmldom/xmldom'
import type { Arrangement, Fill, ImageElement, Presentation, ShapeElement, Shadow, Slide, SlideAction, SlideGroup, TextElement, VideoElement } from '@shared/model'
import { newImportId, parseSectionHeading, sectionColor } from '@shared/import-lyrics'
import { mediaKindFromPath } from '@shared/media'
import { ConvertContext } from '../pp7/context'
import { idFromUuid } from '../pp7/proto'
import { convertText, round3 } from '../pp7/text'
import { assignRoles, type ImportedSlide } from '../pp7/presentation'
import { roleFromName, round2, type ImportedElement } from '../pp7/elements'
import { baseName, fileUrlToPath } from '../pp7/url'
import { parseRtf } from '../rtf/rtf'

export interface Pro6Result { presentation: Presentation; ctx: ConvertContext; info: { version: string; slides: number; groups: number } }

type El = Element

const attr = (e: El | null | undefined, n: string): string => (e?.getAttribute(n) ?? '').trim()
const elementChildren = (e: El): El[] => {
  const out: El[] = []
  for (let i = 0; i < e.childNodes.length; i++) if (e.childNodes[i].nodeType === 1) out.push(e.childNodes[i] as El)
  return out
}
const tag = (e: El): string => e.localName ?? e.nodeName
/** Child container by rvXMLIvarName (Pro6) or by tag name (Pro4/5). */
function container(e: El, name: string): El | null {
  for (const c of elementChildren(e)) if (attr(c, 'rvXMLIvarName') === name || tag(c) === name) return c
  return null
}
function descendants(e: El | Document, name: string): El[] {
  return Array.from((e as El).getElementsByTagName(name)) as El[]
}

/** "r g b a" floats → CSS (undefined when fully transparent). */
export function pp6Color(s: string, keepTransparent = false): string | undefined {
  const v = s.split(/[\s,]+/).map(Number).filter((n) => !Number.isNaN(n))
  if (v.length < 3) return undefined
  const a = v[3] ?? 1
  if (a <= 0 && !keepTransparent) return undefined
  const ch = (x: number): number => Math.max(0, Math.min(255, Math.round(x * 255)))
  if (a >= 0.999) return '#' + [v[0], v[1], v[2]].map((x) => ch(x).toString(16).padStart(2, '0')).join('').toUpperCase()
  return `rgba(${ch(v[0])}, ${ch(v[1])}, ${ch(v[2])}, ${round3(a)})`
}

const b64 = (s: string): Uint8Array => Buffer.from(s.replace(/\s+/g, ''), 'base64')

function frameOf(e: El): { x: number; y: number; w: number; h: number } {
  const r = container(e, 'position') ?? elementChildren(e).find((c) => /RVRect3D/.test(tag(c))) ?? null
  if (r) {
    if (r.hasAttribute('x')) return { x: round2(+attr(r, 'x')), y: round2(+attr(r, 'y')), w: round2(+attr(r, 'width')), h: round2(+attr(r, 'height')) }
    const n = (r.textContent ?? '').replace(/[{}]/g, '').trim().split(/\s+/).map(Number)
    if (n.length >= 5) return { x: round2(n[0]), y: round2(n[1]), w: round2(n[3]), h: round2(n[4]) }
    if (n.length === 4) return { x: n[0], y: n[1], w: n[2], h: n[3] }
  }
  return { x: 0, y: 0, w: 0, h: 0 }
}

function shadowOf(e: El): Shadow | undefined {
  if (!/^(1|true)$/i.test(attr(e, 'drawingShadow'))) return undefined
  const s = container(e, 'shadow')
  const txt = s?.textContent?.trim()
  if (txt && txt.includes('|')) {
    const [blur, color, off] = txt.split('|')
    const o = (off ?? '').replace(/[{}]/g, '').split(',').map(Number)
    return { blur: round3(+blur || 0), color: pp6Color(color, true) ?? 'rgba(0, 0, 0, 0.75)', x: round3(o[0] || 0), y: round3(-(o[1] || 0)) }
  }
  return undefined
}

function strokeOf(e: El): { color: string; width: number } | undefined {
  if (!/^(1|true)$/i.test(attr(e, 'drawingStroke'))) return undefined
  const d = container(e, 'stroke')
  if (!d) return undefined
  let color = '#000000'
  let width = 0
  for (const c of elementChildren(d)) {
    const k = attr(c, 'rvXMLDictionaryKey') || attr(c, 'serialization-dictionary-key')
    const v = attr(c, 'serialization-native-value') || (c.textContent ?? '').trim()
    if (/Color/i.test(k)) color = pp6Color(v, true) ?? color
    if (/Width/i.test(k)) width = +v || 0
  }
  return width > 0 ? { color, width: round2(width) } : undefined
}

function textData(e: El): { rtf?: Uint8Array; plain?: string } {
  const out: { rtf?: Uint8Array; plain?: string } = {}
  const rtfAttr = attr(e, 'RTFData')
  if (rtfAttr) out.rtf = b64(rtfAttr)
  for (const c of elementChildren(e)) {
    const k = attr(c, 'rvXMLIvarName')
    if (k === 'RTFData' && c.textContent?.trim()) out.rtf = b64(c.textContent)
    if (k === 'PlainText' && c.textContent?.trim()) out.plain = Buffer.from(c.textContent.replace(/\s+/g, ''), 'base64').toString('utf8')
  }
  return out
}

function mediaRequest(ctx: ConvertContext, source: string, where: string, kindHint?: 'image' | 'video'): { kind: 'image' | 'video' | 'audio'; src: string; name?: string } {
  let p = source
  try { p = decodeURIComponent(source) } catch { /* keep */ }
  p = fileUrlToPath(p)
  const basename = baseName(p)
  const kind = mediaKindFromPath(basename) ?? kindHint ?? 'image'
  const ref = { kind, src: `pp7-unresolved:${basename}`, name: basename.replace(/\.[^.]+$/, '') || undefined }
  if (/^https?:/i.test(p)) { ref.src = p; return ref }
  ctx.media.push({ ref, url: { absolute: p, basename }, where })
  return ref
}

function convertElement(e: El, ctx: ConvertContext, where: string): ImportedElement | null {
  const t = tag(e)
  const id = idFromUuid(attr(e, 'UUID') || attr(e, 'uuid'), ctx.newId)
  const base = { id, frame: frameOf(e), name: attr(e, 'displayName') || undefined } as ImportedElement
  const rot = +attr(e, 'rotation') || 0
  if (rot % 360) base.rotation = round2((360 - (rot % 360)) % 360) // Cocoa rotation is counter-clockwise
  const op = attr(e, 'opacity')
  if (op && +op < 0.999) base.opacity = round3(+op)
  if (/^(1|true)$/i.test(attr(e, 'locked'))) base.locked = true
  const stroke = strokeOf(e)
  if (stroke) base.stroke = stroke
  const shadow = shadowOf(e)
  const fill: Fill | undefined = /^(1|true)$/i.test(attr(e, 'drawingFill')) ? (() => { const c = pp6Color(attr(e, 'fillColor')); return c ? { type: 'color' as const, color: c } : undefined })() : undefined
  const radius = +attr(e, 'bezelRadius') || 0
  if (radius > 0) base.cornerRadius = round2(radius)

  if (t === 'RVTextElement') {
    const { rtf, plain } = textData(e)
    const conv = convertText(rtf ? { rtf_data: rtf } : undefined, ctx)
    let paragraphs = conv.paragraphs
    const norm = (s: string): string => s.replace(/\r\n?/g, '\n').replace(/\s+$/g, '').trim()
    if (plain !== undefined && norm(plain) !== norm(conv.plain)) {
      // Windows-saved files can leave RTFData stale; PlainText is authoritative for the words.
      if (rtf) ctx.note('pp6.staleRtf')
      paragraphs = norm(plain).split('\n').map((line) => ({ runs: [{ text: line }] }))
    }
    const el: TextElement = { ...(base as TextElement), type: 'text', paragraphs: paragraphs.length ? paragraphs : [{ runs: [{ text: '' }] }], style: { ...conv.style } }
    if (conv.align) el.align = conv.align
    const va = attr(e, 'verticalAlignment')
    el.verticalAlign = va === '1' ? 'middle' : va === '2' ? 'bottom' : 'top'
    if (fill) el.fill = fill
    if (shadow) el.style.shadow = shadow
    if (/^(1|true)$/i.test(attr(e, 'adjustsHeightToFit'))) ctx.note('pp6.adjustsHeightToFit')
    const role = roleFromName(el.name)
    if (role) el.role = role
    return el
  }
  if (t === 'RVImageElement' || t === 'RVVideoElement') {
    const src = attr(e, 'source')
    if (!src) return null
    const ref = mediaRequest(ctx, src, where, t === 'RVVideoElement' ? 'video' : 'image')
    const sb = attr(e, 'scaleBehavior')
    const fit = sb === '3' ? 'stretch' : sb === '1' ? 'cover' : 'contain'
    if (ref.kind === 'video') return { ...(base as VideoElement), type: 'video', media: ref, fit, loop: attr(e, 'playbackBehavior') === '1' || undefined, muted: true }
    return { ...(base as ImageElement), type: 'image', media: ref, fit }
  }
  if (t === 'RVShapeElement' || t === 'RVBezierPathElement' || t === 'RVRectangleElement' || t === 'RVEllipseElement') {
    const s: ShapeElement = { ...(base as ShapeElement), type: 'shape', shape: /Ellipse|Circle/i.test(t + attr(e, 'shapeType')) ? 'ellipse' : 'rect' }
    if (fill) s.fill = fill
    if (shadow) s.shadow = shadow
    if (t === 'RVBezierPathElement') ctx.note('shape.bezierPath')
    return s
  }
  if (t === 'RVHTMLShapeElement' || t === 'RVWebViewElement') {
    const url = attr(e, 'url') || attr(e, 'URL') || attr(e, 'source')
    ctx.note('pp6.webElement')
    if (url) return { ...(base as ImportedElement & { type: 'live' }), type: 'live', source: { kind: 'web', ref: url } } as ImportedElement
    return null
  }
  ctx.note(`pp6.element.${t}`)
  return null
}

function cueToAction(c: El, ctx: ConvertContext, where: string): SlideAction | null {
  const t = tag(c)
  if (t === 'RVMediaCue') {
    const el = elementChildren(c).find((x) => /RV(Image|Video|Audio)Element/.test(tag(x)))
    const src = el ? attr(el, 'source') : ''
    if (!src) return null
    const ref = mediaRequest(ctx, src, where, /Video/.test(el ? tag(el) : '') ? 'video' : 'image')
    const behavior = attr(c, 'behavior')
    return { id: idFromUuid(attr(c, 'UUID'), ctx.newId), type: 'media.play', label: attr(c, 'displayName') || undefined, params: { layer: ref.kind === 'audio' ? 'audio' : behavior === '2' ? 'video' : 'background', media: ref, fit: attr(el!, 'scaleBehavior') === '3' ? 'stretch' : 'contain' } }
  }
  if (t === 'RVClearCue') return { id: idFromUuid(attr(c, 'UUID'), ctx.newId), type: 'live.clear', params: { layer: 'all' } }
  if (t === 'RVTimerCue') return { id: idFromUuid(attr(c, 'UUID'), ctx.newId), type: 'timer.start', params: { name: attr(c, 'displayName') || attr(c, 'timerName') } }
  if (t === 'RVMessageCue') return { id: idFromUuid(attr(c, 'UUID'), ctx.newId), type: 'message.show', params: { name: attr(c, 'displayName') } }
  if (t === 'RVStageDisplayLayoutCue' || t === 'RVStageDisplayCue') return { id: idFromUuid(attr(c, 'UUID'), ctx.newId), type: 'stage.setLayout', params: { name: attr(c, 'displayName') || attr(c, 'stageDisplayLayoutName') } }
  if (t === 'RVPropCue') return { id: idFromUuid(attr(c, 'UUID'), ctx.newId), type: 'props.show', params: { name: attr(c, 'displayName') } }
  ctx.note(`pp6.cue.${t}`)
  ctx.unmappedActions.push({ type: t, name: attr(c, 'displayName') || undefined, data: Object.fromEntries(Array.from(c.attributes ?? []).map((a) => [a.name, a.value])) })
  return null
}

export function convertPro6(xml: string, opts: { sourcePath?: string; library?: string; newId?: () => string } = {}): Pro6Result {
  const ctx = new ConvertContext(opts.newId ?? newImportId)
  const doc = new DOMParser({ errorHandler: { warning: () => {}, error: (m: string) => ctx.warn(`XML: ${m}`), fatalError: (m: string) => ctx.warn(`XML: ${m}`) } }).parseFromString(xml.replace(/^﻿/, ''), 'text/xml') as unknown as Document
  const root = descendants(doc, 'RVPresentationDocument')[0]
  if (!root) throw new Error('not a ProPresenter 4/5/6 document (no RVPresentationDocument)')
  const version = attr(root, 'versionNumber') || '?'
  const width = +attr(root, 'width') || 1024
  const height = +attr(root, 'height') || 768
  const fileTitle = opts.sourcePath ? opts.sourcePath.split(/[\\/]/).pop()!.replace(/\.pro\d?$/i, '') : ''
  const title = fileTitle || attr(root, 'CCLISongTitle') || 'Untitled'
  const presBg = /^(1|true)$/i.test(attr(root, 'drawingBackgroundColor')) ? pp6Color(attr(root, 'backgroundColor')) : undefined

  const slides: ImportedSlide[] = []
  const groups: SlideGroup[] = []
  const groupByUuid = new Map<string, SlideGroup>()
  const convertSlide = (s: El, idx: number): ImportedSlide => {
    const where = `slide ${idx + 1}`
    const slide: ImportedSlide = { id: idFromUuid(attr(s, 'UUID') || attr(s, 'uuid'), ctx.newId), elements: [] }
    if (slides.some((x) => x.id === slide.id)) slide.id = ctx.newId()
    const label = attr(s, 'label')
    if (label) slide.label = label
    const notes = attr(s, 'notes')
    if (notes) slide.notes = /^\{\\rtf/.test(notes) ? parseRtf(notes).plain : notes
    if (/^(0|false)$/i.test(attr(s, 'enabled'))) slide.enabled = false
    const hk = attr(s, 'hotKey')
    if (hk) slide.hotKey = hk.toUpperCase()
    const bg = /^(1|true)$/i.test(attr(s, 'drawingBackgroundColor')) ? pp6Color(attr(s, 'backgroundColor')) : presBg
    if (bg) slide.background = { type: 'color', color: bg }
    const els = container(s, 'displayElements')
    const front: ImportedElement[] = []
    for (const c of els ? elementChildren(els) : []) {
      try { const el = convertElement(c, ctx, where); if (el) front.push(el) } catch (err) { ctx.warn(`${where}: element skipped (${(err as Error).message})`) }
    }
    // Same order convention as Pro7 (first listed = front): draw back → front.
    slide.elements = front.reverse()
    const actions: SlideAction[] = []
    for (const c of elementChildren(s)) if (attr(c, 'rvXMLIvarName') === 'backgroundMediaCue' || tag(c) === 'backgroundMediaCue') { const a = cueToAction(tag(c) === 'RVMediaCue' ? c : elementChildren(c)[0] ?? c, ctx, where); if (a) actions.push(a) }
    const cues = container(s, 'cues')
    for (const c of cues ? elementChildren(cues) : []) { const a = cueToAction(c, ctx, where); if (a) actions.push(a) }
    if (actions.length) slide.actions = actions
    return slide
  }
  const groupEls = descendants(root, 'RVSlideGrouping')
  if (groupEls.length) {
    for (const g of groupEls) {
      const slideEls = (() => { const c = container(g, 'slides'); return c ? elementChildren(c).filter((x) => tag(x) === 'RVDisplaySlide') : descendants(g, 'RVDisplaySlide') })()
      const made = slideEls.map((s) => convertSlide(s, slides.length)).map((s) => { slides.push(s); return s })
      const grp: SlideGroup = { id: idFromUuid(attr(g, 'uuid') || attr(g, 'UUID'), ctx.newId), name: attr(g, 'name'), slideIds: made.map((s) => s.id) }
      const col = pp6Color(attr(g, 'color'))
      if (col) grp.color = col
      if (groups.some((x) => x.id === grp.id)) grp.id = ctx.newId()
      groups.push(grp)
      groupByUuid.set((attr(g, 'uuid') || attr(g, 'UUID')).toLowerCase(), grp)
    }
  } else {
    // ProPresenter 4: no groups — the slide label carries the section name ("Verse 1", "Chorus 1").
    let cur: SlideGroup | null = null
    for (const s of descendants(root, 'RVDisplaySlide')) {
      const slide = convertSlide(s, slides.length)
      slides.push(slide)
      const heading = slide.label ? parseSectionHeading(slide.label) : null
      if (heading) { cur = { id: ctx.newId(), name: heading, color: sectionColor(heading), slideIds: [] }; groups.push(cur) }
      if (cur) cur.slideIds.push(slide.id)
    }
  }
  const arrangements: Arrangement[] = []
  for (const a of descendants(root, 'RVSongArrangement')) {
    const ids: string[] = []
    const holder = container(a, 'groupIDs')
    for (const n of holder ? elementChildren(holder) : []) {
      const u = (attr(n, 'serialization-native-value') || n.textContent || '').trim().toLowerCase()
      const g = groupByUuid.get(u)
      if (g) ids.push(g.id)
    }
    arrangements.push({ id: idFromUuid(attr(a, 'uuid'), ctx.newId), name: attr(a, 'name') || 'Arrangement', groupIds: ids })
  }
  const sel = attr(root, 'selectedArrangementID').toLowerCase()
  const kept = groups.filter((g) => g.name || arrangements.some((a) => a.groupIds.includes(g.id)))
  const isSong = /song/i.test(attr(root, 'category')) || kept.some((g) => /verse|chorus|bridge/i.test(g.name)) || !!attr(root, 'CCLISongTitle')
  for (const s of slides) assignRoles(s.elements as ImportedElement[], isSong ? 'lyrics' : 'body')

  const meta: Presentation['meta'] = {}
  const author = attr(root, 'CCLIAuthor') || attr(root, 'author')
  if (author) meta.author = author
  const artist = attr(root, 'CCLIArtistCredits') || attr(root, 'artist')
  if (artist) meta.artist = artist
  const pub = attr(root, 'CCLIPublisher')
  if (pub) meta.publisher = pub
  const year = attr(root, 'CCLICopyrightYear') || attr(root, 'CCLICopyrightInfo')
  if (year || pub) meta.copyright = [year ? `© ${year}` : '', pub].filter(Boolean).join(' ')
  const num = attr(root, 'CCLISongNumber')
  if (num) meta.ccliNumber = num
  const song = attr(root, 'CCLISongTitle')
  if (song && song !== title) meta.songTitle = song
  const cat = attr(root, 'category')
  if (cat) meta.category = opts.library && cat === 'Presentation' ? opts.library : cat
  else if (opts.library) meta.category = opts.library
  const notes = attr(root, 'notes')
  if (notes) meta.notes = notes
  meta.source = { type: 'propresenter6', ref: opts.sourcePath, importedAt: new Date().toISOString(), version, os: attr(root, 'os') || undefined, build: attr(root, 'buildNumber') || undefined, unmapped: ctx.unmappedActions.length ? ctx.unmappedActions : undefined }
  const now = new Date().toISOString()
  const presentation: Presentation = {
    id: newImportId(), title, kind: isSong ? 'song' : 'generic', size: { width, height }, slides, groups: kept, arrangements,
    activeArrangementId: arrangements.find((a) => a.id === idFromUuid(sel, () => ''))?.id, meta, createdAt: now, updatedAt: now
  }
  return { presentation, ctx, info: { version, slides: slides.length, groups: kept.length } }
}

/** Plain text of a Pro6 document, for quick previews. */
export function pro6Title(xml: string): string | undefined {
  return /CCLISongTitle="([^"]*)"/.exec(xml)?.[1]
}
