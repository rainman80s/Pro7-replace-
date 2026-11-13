import type { Fill, ImageElement, LiveElement, MediaRef, Rect, ShapeElement, Slide, SlideElement, Stroke, TextElement, VideoElement } from '@shared/model'
import { mediaKindFromPath } from '@shared/media'
import { cssColor, idFromUuid, uuidOf, type PB } from './proto'
import type { ConvertContext } from './context'
import { jsonSafe } from './context'
import { parsePP7Url } from './url'
import { convertShadow, convertText, round3, styleFromAttributes } from './text'

type Ext = Record<string, unknown>
/** Element + the extension bag we attach (kept optional/additive: `ext` holds ProPresenter data Reach has no field for). */
export type ImportedElement = SlideElement & { ext?: Ext }

export const round2 = (n: number): number => Math.round((n ?? 0) * 100) / 100

export function rectOf(bounds: PB | undefined): Rect {
  return {
    x: round2(bounds?.origin?.x ?? 0), y: round2(bounds?.origin?.y ?? 0),
    w: round2(bounds?.size?.width ?? 0), h: round2(bounds?.size?.height ?? 0)
  }
}

/** rv.data.Media → MediaRef (src is a placeholder until the caller resolves the request it registers). */
export function convertMedia(media: PB | undefined, ctx: ConvertContext, where: string): { ref: MediaRef; fit?: 'contain' | 'cover' | 'stretch'; props: PB; kind: 'image' | 'video' | 'audio' | 'web' | 'live' } | null {
  if (!media) return null
  if (media.web_content) {
    const url = parsePP7Url(media.web_content.url)
    return { ref: { kind: 'image', src: url?.web ?? url?.absolute ?? '' }, kind: 'web', props: media.web_content }
  }
  if (media.live_video) {
    return { ref: { kind: 'video', src: '' }, kind: 'live', props: media.live_video }
  }
  const props: PB = media.video ?? media.image ?? media.audio ?? {}
  const url = parsePP7Url(media.url) ?? parsePP7Url(props.file?.local_url)
  if (!url) { ctx.warn(`${where}: media reference with no URL`); return null }
  let kind: MediaRef['kind'] = media.video ? 'video' : media.audio ? 'audio' : media.image ? 'image' : (mediaKindFromPath(url.basename) ?? 'image')
  // Trust the file extension over the oneof when they disagree in an obvious way (still images used as "video" backgrounds).
  const byExt = mediaKindFromPath(url.basename)
  if (byExt && byExt !== kind && !(kind === 'video' && byExt === 'image' && /\.gif$/i.test(url.basename))) kind = byExt
  const ref: MediaRef = { kind, src: url.web ?? `pp7-unresolved:${url.basename}`, name: url.basename.replace(/\.[^.]+$/, '') || undefined }
  const nat = props.drawing?.natural_size ?? media.metadata
  if (nat?.width > 0 && nat?.height > 0) { ref.width = Math.round(nat.width); ref.height = Math.round(nat.height) }
  const dur = media.metadata?.duration ?? props.transport?.end_point
  if (dur > 0 && kind !== 'image') ref.duration = round3(dur)
  if (!url.web) ctx.media.push({ ref, url, where })
  const sb = props.drawing?.scale_behavior
  const fit = sb === 'SCALE_BEHAVIOR_FILL' ? 'cover' : sb === 'SCALE_BEHAVIOR_STRETCH' ? 'stretch' : 'contain'
  if (sb === 'SCALE_BEHAVIOR_CUSTOM') ctx.note('media.customScale')
  if (props.drawing?.flipped_horizontally || props.drawing?.flipped_vertically) ctx.note('media.flip')
  if (props.drawing?.crop_enable) ctx.note('media.crop')
  return { ref, fit, props, kind }
}

export function convertFill(fill: PB | undefined, ctx: ConvertContext, where: string): { fill?: Fill; media?: ReturnType<typeof convertMedia> } {
  if (!fill || !fill.enable) return {}
  if (fill.media) {
    const media = convertMedia(fill.media, ctx, where)
    return media ? { media } : {}
  }
  if (fill.gradient) {
    const g = fill.gradient
    const stops = (g.stops ?? []).map((s: PB) => ({ color: cssColor(s.color, { keepTransparent: true }) ?? '#000000', at: round3(s.position ?? 0) }))
    if (stops.length >= 2) {
      if (g.type && g.type !== 'TYPE_LINEAR') ctx.note(`fill.gradient.${String(g.type).replace('TYPE_', '').toLowerCase()}`)
      // ProPresenter angle: 0° = left→right, counter-clockwise. CSS: 0deg = bottom→top, clockwise.
      return { fill: { type: 'gradient', angle: round3(((90 - (g.angle ?? 0)) % 360 + 360) % 360), stops } }
    }
    return {}
  }
  if (fill.backgroundEffect) { ctx.note(fill.backgroundEffect.backgroundBlur ? 'fill.backgroundBlur' : 'fill.backgroundEffect'); return {} }
  const color = cssColor(fill.color)
  return color ? { fill: { type: 'color', color } } : {}
}

function convertStroke(s: PB | undefined, ctx: ConvertContext): Stroke | undefined {
  if (!s || !s.enable || !(s.width > 0)) return undefined
  if (s.style && s.style !== 'STYLE_SOLID_LINE') ctx.note('stroke.dashed')
  return { color: cssColor(s.color ?? { alpha: 1 }, { keepTransparent: true }) ?? '#000000', width: round2(s.width) }
}

/** Element.DataLink[] → a dynamic-text template (tokens the stage/output renderer replaces live) or structural info. */
export function convertDataLinks(links: PB[] | undefined, ctx: ConvertContext): { token?: string; ext?: Ext; kind?: 'text' | 'image' | 'screen' } {
  if (!links?.length) return {}
  const ext: Ext = {}
  let token: string | undefined
  let kind: 'text' | 'image' | 'screen' | undefined
  const setToken = (t: string): void => { token = token ? `${token} ${t}` : t; kind = kind ?? 'text' }
  for (const link of links) {
    const key = Object.keys(link)[0]
    const v = link[key] ?? {}
    const next = v.source_slide === 'SLIDE_SOURCE_TYPE_NEXT_SLIDE' || v.groupSource === 'GROUP_SOURCE_TYPE_NEXT_SLIDE' || v.slide_label_source === 'SLIDE_LABEL_SOURCE_NEXT_SLIDE'
    const which = next ? 'next' : 'current'
    switch (key) {
      case 'timer_text': {
        const name = v.timer_name || uuidOf(v.timer_uuid) || 'Timer'
        setToken(String(v.timer_format_string || '${timer}').replace('${timer}', `{timer:${name}}`))
        ext.timer = { id: idFromUuid(v.timer_uuid, () => ''), name, format: jsonSafe(v.timer_format), colorTriggers: (v.color_triggers ?? []).map((t: PB) => ({ time: t.time, color: cssColor(t.color) })) }
        break
      }
      case 'clock_text': setToken(String(v.clock_format_string || '${clock}').replace('${clock}', '{clock}')); ext.clock = jsonSafe(v.format); break
      case 'slide_text':
        if (v.source_option === 'TEXT_SOURCE_OPTION_NOTES') setToken(`{${which}.notes}`)
        else if (v.source_option === 'TEXT_SOURCE_OPTION_ELEMENT_MATCHING_NAME') { setToken(`{${which}.text:${v.name_to_match ?? ''}}`) }
        else setToken(`{${which}.text}`)
        break
      case 'stage_message': setToken('{stageMessage}'); if (v.should_flash) ext.flash = cssColor(v.flash_color) ?? true; break
      case 'ccli_text': setToken('{song.copyright}'); break
      case 'group_name': setToken(`{${which}.group}`); break
      case 'group_color': ext.groupColor = which; break
      case 'slide_Label_Text': setToken(`{${which}.label}`); break
      case 'slide_Label_Color': ext.labelColor = which; break
      case 'presentation_notes': setToken('{song.notes}'); break
      case 'presentation': setToken(v.presentation_source === 'PRESENTATION_SOURCE_ANNOUNCEMENT' ? '{announcement.title}' : '{song.title}'); break
      case 'playlist_item': {
        const m: Record<string, string> = {
          PLAYLIST_ITEM_SOURCE_TYPE_NEXT: '{playlist.next}', PLAYLIST_ITEM_SOURCE_TYPE_CURRENT_HEADER: '{playlist.header}',
          PLAYLIST_ITEM_SOURCE_TYPE_NEXT_HEADER: '{playlist.nextHeader}', PLAYLIST_ITEM_SOURCE_TYPE_PARENT_PLAYLIST: '{playlist.name}'
        }
        setToken(m[v.playlistItemSource] ?? '{playlist.item}')
        break
      }
      case 'video_countdown': setToken(String(v.timer_format_string || '${timer}').replace('${timer}', '{video.remaining}')); break
      case 'audio_countdown': setToken(String(v.timer_format_string || '${timer}').replace('${timer}', '{audio.remaining}')); break
      case 'slide_count': setToken('{slide.count}'); break
      case 'auto_advance_time_remaining': setToken('{slide.autoAdvanceRemaining}'); break
      case 'message_text': setToken('{message}'); break
      case 'alternate_text': setToken(`{element:${v.other_element_name ?? uuidOf(v.other_element_uuid)}}`); ext.alternateText = jsonSafe(v); break
      case 'ticker': setToken(v.text_type?.text ?? '{ticker}'); ext.ticker = jsonSafe(v); ctx.note('datalink.ticker'); break
      case 'rss_feed': case 'file_feed': setToken(`{feed}`); ext[key] = jsonSafe(v); ctx.note(`datalink.${key}`); break
      case 'slide_image': kind = 'image'; ext.slideImage = which; break
      case 'output_screen': kind = 'screen'; ext.outputScreen = { id: idFromUuid(v.screen_id, () => ''), name: v.screen_name || undefined }; break
      case 'chord_chart': case 'chord_pro_chart': kind = kind ?? 'image'; ext.chordChart = true; ctx.note('datalink.chordChart'); break
      case 'visibility_link': {
        const conds = (v.conditions ?? []).filter((c: PB) => Object.keys(c).length)
        if (conds.length) { ext.visibility = jsonSafe(v); ctx.note('datalink.visibility') }
        break
      }
      case 'alternate_fill': ext.alternateFill = jsonSafe(v); ctx.note('datalink.alternateFill'); break
      default: ext[key] = jsonSafe(v); ctx.note(`datalink.${key}`)
    }
  }
  return { token, ext: Object.keys(ext).length ? ext : undefined, kind }
}

const ROLE_HINTS: [RegExp, string][] = [
  [/translat|übersetz|uebersetz|traducci|tradu[cç]|deutsch|german|english|englisch|español|spanish|français|french|\btrans\b|second language|sprache 2/i, 'translation'],
  [/reference|bibelstelle|\bref\b/i, 'reference'],
  [/sub-?title/i, 'subtitle'],
  [/\btitle\b|titel|headline|überschrift/i, 'title'],
  [/caption|copyright|ccli|credit/i, 'caption'],
  [/lyric|liedtext|song ?text/i, 'lyrics'],
  [/\bbody\b|\bmain\b|content|bible text|scripture/i, 'body']
]
export function roleFromName(name: string | undefined): string | undefined {
  if (!name) return undefined
  for (const [re, role] of ROLE_HINTS) if (re.test(name)) return role
  return undefined
}

/**
 * One rv.data.Slide.Element → 0..2 Reach elements (a text box that also has an image fill becomes image + text).
 */
export function convertElement(se: PB, ctx: ConvertContext, where: string): ImportedElement[] {
  const el: PB = se.element ?? {}
  const id = idFromUuid(el.uuid, ctx.newId)
  const frame = rectOf(el.bounds)
  const ext: Ext = {}
  const base: Partial<ImportedElement> = { id, frame }
  if (el.name) base.name = String(el.name).replace(/\s+/g, ' ').slice(0, 120)
  const rot = ((el.rotation ?? 0) % 360 + 360) % 360
  if (rot > 0.001 && rot < 359.999) base.rotation = round2(rot)
  if (el.opacity !== undefined && el.opacity < 0.999) base.opacity = round3(el.opacity)
  else if (el.opacity === undefined) { base.opacity = 0; ctx.note('element.opacityZero') } // proto3: an absent double IS 0 — ProPresenter always writes 1 for visible elements
  if (el.hidden) base.hidden = true
  if (el.locked) base.locked = true
  const stroke = convertStroke(el.stroke, ctx)
  if (stroke) base.stroke = stroke
  const shadow = convertShadow(el.shadow)
  if (shadow) base.shadow = shadow
  if (el.feather?.enable && el.feather.radius > 0) { ext.feather = round3(el.feather.radius); ctx.note('element.feather') }
  if (el.flipMode && el.flipMode !== 'FLIP_MODE_NONE') { ext.flip = String(el.flipMode).replace('FLIP_MODE_', '').toLowerCase(); ctx.note('element.flip') }
  if (el.text_line_mask?.enabled) { ext.textLineMask = jsonSafe(el.text_line_mask); ctx.note('text.lineFillMask') }

  // shape geometry
  const shapeType: string = el.path?.shape?.type ?? 'TYPE_RECTANGLE'
  let shape: ShapeElement['shape'] = 'rect'
  let points: [number, number][] | undefined
  if (shapeType === 'TYPE_ELLIPSE') shape = 'ellipse'
  else if (shapeType === 'TYPE_ROUNDED_RECTANGLE') {
    const r = el.path?.shape?.rounded_rectangle?.roundness ?? 0
    if (r > 0) base.cornerRadius = round2((Math.min(frame.w, frame.h) / 2) * Math.min(1, r))
  } else if (shapeType !== 'TYPE_RECTANGLE' && shapeType !== 'TYPE_UNKNOWN') {
    const pts = (el.path?.points ?? []).map((p: PB) => [round3(p.point?.x ?? 0), round3(p.point?.y ?? 0)] as [number, number])
    if (pts.length >= 2) {
      shape = pts.length === 2 ? 'line' : 'polygon'
      points = pts
      ext.shape = shapeType.replace('TYPE_', '').toLowerCase()
      const curved = (el.path?.points ?? []).some((p: PB) => (p.q0 && (p.q0.x !== p.point?.x || p.q0.y !== p.point?.y)) || (p.q1 && (p.q1.x !== p.point?.x || p.q1.y !== p.point?.y)))
      if (curved) { ext.path = jsonSafe(el.path); ctx.note('shape.bezierPath') }
    }
  }

  // builds / reveal / scrolling
  if (se.build_in) {
    ext.buildIn = { start: se.build_in.start, delay: se.build_in.delayTime || undefined, transition: transitionInfo(se.build_in.transition) }
  }
  if (se.build_out) { ext.buildOut = { start: se.build_out.start, delay: se.build_out.delayTime || undefined, transition: transitionInfo(se.build_out.transition) }; ctx.note('element.buildOut') }
  if (se.reveal_type && se.reveal_type !== 'TEXT_REVEAL_TYPE_NONE') { ext.reveal = String(se.reveal_type).replace('TEXT_REVEAL_TYPE_', '').toLowerCase(); ctx.note('text.reveal') }
  if (se.text_scroller?.should_scroll) { ext.scroller = jsonSafe(se.text_scroller); ctx.note('text.scroller') }
  if (se.info) ext.info = se.info

  const links = convertDataLinks(se.data_links, ctx)
  if (links.ext) Object.assign(ext, links.ext)

  const text: PB | undefined = el.text
  const converted = convertText(text, ctx)
  const { fill, media } = convertFill(el.fill, ctx, where)
  const hasText = converted.plain.trim().length > 0
  const out: ImportedElement[] = []
  const withExt = <T extends ImportedElement>(e: T): T => { if (Object.keys(ext).length) e.ext = { ...ext }; return e }

  // Media-filled element → image / video / live element
  if (media) {
    const mBase = { ...base, id: hasText || links.token ? `${id}m` : id } as Partial<ImportedElement>
    if (media.kind === 'web') {
      out.push(withExt({ ...mBase, type: 'live', source: { kind: 'web', ref: media.ref.src }, fit: media.fit } as LiveElement))
    } else if (media.kind === 'live') {
      ext.liveVideo = jsonSafe(media.props.live_video ?? media.props)
      out.push(withExt({ ...mBase, type: 'live', source: { kind: 'camera', ref: String(media.props.live_video?.live_video_index ?? media.props.live_video?.video_device?.name ?? '') }, fit: media.fit } as LiveElement))
    } else if (media.ref.kind === 'video') {
      const t = media.props.transport ?? {}
      const v: VideoElement = { ...(mBase as VideoElement), type: 'video', media: media.ref, fit: media.fit, loop: t.playback_behavior === 'PLAYBACK_BEHAVIOR_LOOP' || undefined, muted: true }
      if (t.in_point > 0) v.inPoint = round3(t.in_point)
      if (t.out_point > 0) v.outPoint = round3(t.out_point)
      out.push(withExt(v))
    } else {
      out.push(withExt({ ...mBase, type: 'image', media: media.ref, fit: media.fit } as ImageElement))
    }
    if (!hasText && !links.token) return out
  }

  const isStructural = links.kind === 'image' || links.kind === 'screen'
  const visibleBox = !!fill || !!stroke
  if (!media && !hasText && !links.token && (visibleBox || isStructural || shape !== 'rect')) {
    // Pure shape (or a stage-layout placeholder such as "current slide image" / "output screen")
    const s: ShapeElement = { ...(base as ShapeElement), type: 'shape', shape }
    if (fill) s.fill = fill
    if (points) s.points = points
    out.push(withExt(s))
    return out
  }

  // Text box
  const t: TextElement = {
    ...(base as TextElement), type: 'text',
    paragraphs: converted.paragraphs.length ? converted.paragraphs : [{ runs: [{ text: '' }] }],
    style: converted.style
  }
  if (media) { delete t.stroke; delete t.shadow } // those belong to the image element underneath
  if (converted.align) t.align = converted.align
  const va = text?.vertical_alignment
  t.verticalAlign = va === 'VERTICAL_ALIGNMENT_MIDDLE' ? 'middle' : va === 'VERTICAL_ALIGNMENT_BOTTOM' ? 'bottom' : 'top'
  if (fill && !media) t.fill = fill
  const m = text?.margins
  if (m && (m.left || m.right || m.top || m.bottom)) {
    const vals = [m.left ?? 0, m.right ?? 0, m.top ?? 0, m.bottom ?? 0]
    t.padding = round2(Math.max(...vals))
    if (new Set(vals).size > 1) ext.margins = { left: m.left ?? 0, right: m.right ?? 0, top: m.top ?? 0, bottom: m.bottom ?? 0 }
  }
  const sb = text?.scale_behavior
  if (sb === 'SCALE_BEHAVIOR_SCALE_FONT_DOWN' || sb === 'SCALE_BEHAVIOR_SCALE_FONT_UP_DOWN') t.autoFit = true
  if (sb && sb !== 'SCALE_BEHAVIOR_NONE') ext.scaleBehavior = String(sb).replace('SCALE_BEHAVIOR_', '').toLowerCase()
  if (sb === 'SCALE_BEHAVIOR_SCALE_FONT_UP' || sb === 'SCALE_BEHAVIOR_ADJUST_CONTAINER_HEIGHT') ctx.note(`text.scale.${ext.scaleBehavior}`)
  const tshadow = convertShadow(text?.shadow)
  if (tshadow) t.style = { ...t.style, shadow: tshadow }
  if (text?.transform && text.transform !== 'TRANSFORM_NONE') { ext.transform = String(text.transform).replace('TRANSFORM_', '').toLowerCase(); ext.transformDelimiter = text.transformDelimiter; ctx.note('text.transform') }
  if (text?.chord_pro?.enabled) { ext.chordPro = { notation: text.chord_pro.notation, color: cssColor(text.chord_pro.color) } }
  const chords = (text?.attributes?.custom_attributes ?? []).filter((c: PB) => typeof c.chord === 'string' && c.chord)
  if (chords.length) ext.chords = chords.map((c: PB) => ({ at: c.range?.start ?? 0, chord: c.chord }))
  if (text?.alternate_texts?.length) ext.alternateTexts = jsonSafe(text.alternate_texts)
  if (links.token !== undefined) {
    t.dynamic = true
    // Template text: keep ProPresenter's styling (from attributes when the RTF was empty) around the token.
    const fallback = styleFromAttributes(text?.attributes)
    if (!converted.paragraphs.length) { t.style = { ...fallback.style, ...t.style }; if (fallback.align && !t.align) t.align = fallback.align }
    t.paragraphs = [{ runs: [{ text: links.token }] }]
    if (hasText) ext.placeholderText = converted.plain.slice(0, 500)
  }
  const role = roleFromName(el.name)
  if (role) t.role = role
  out.push(withExt(t))
  return out
}

export function transitionInfo(t: PB | undefined): Ext | undefined {
  if (!t) return undefined
  const e = t.effect ?? {}
  if (!e.name && !t.duration) return undefined
  const info: Ext = { name: e.name || undefined, category: e.category || undefined, renderId: e.render_id || undefined, duration: t.duration ? round3(t.duration) : undefined }
  const dir = (e.variables ?? []).find((v: PB) => v.direction)?.direction?.direction
  if (dir) info.direction = String(dir).replace('EFFECT_DIRECTION_', '').toLowerCase()
  return info
}

/** rv.data.Transition → Reach Transition (named effects we don't have fall back to a fade of the same duration). */
export function convertTransition(t: PB | undefined, ctx: ConvertContext): Slide['transition'] | undefined {
  const info = transitionInfo(t)
  if (!info) return undefined
  const name = `${info.name ?? ''} ${info.category ?? ''}`.toLowerCase()
  const duration = (info.duration as number | undefined) ?? 0.5
  let type: NonNullable<Slide['transition']>['type'] = 'fade'
  if (/\bcut\b/.test(name) || duration === 0) type = 'cut'
  else if (/dissolve|auflösen|fondu|disolver|fade/.test(name)) type = /fade/.test(name) && !/dissolve/.test(name) ? 'fade' : 'dissolve'
  else if (/push/.test(name)) type = 'push'
  else if (/slide|move|fly|reveal|cover/.test(name)) type = 'slide'
  else if (/zoom|scale/.test(name)) type = 'zoom'
  else if (info.name) ctx.note(`transition.${String(info.name).toLowerCase().replace(/\s+/g, '-')}`)
  const out: NonNullable<Slide['transition']> = { type, duration }
  const d = String(info.direction ?? '')
  if (type === 'push' || type === 'slide') out.direction = /left/.test(d) ? 'left' : /right/.test(d) ? 'right' : /top|up/.test(d) ? 'up' : /bottom|down/.test(d) ? 'down' : undefined
  return out
}

export interface ConvertedSlide {
  elements: ImportedElement[]
  background?: Fill
  size?: { width: number; height: number }
  uuid?: string
}

/**
 * rv.data.Slide (the "base slide" shared by presentations, props, themes, stage layouts, masks) → elements.
 * ProPresenter lists elements FRONT-first; Reach draws in array order (last on top), so the order is reversed.
 */
export function convertBaseSlide(bs: PB | undefined, ctx: ConvertContext, where: string): ConvertedSlide {
  const out: ConvertedSlide = { elements: [] }
  if (!bs) return out
  const raw: PB[] = bs.elements ?? []
  const order: string[] = (bs.element_build_order ?? []).map((u: PB) => uuidOf(u).toLowerCase())
  const front: ImportedElement[][] = []
  raw.forEach((se, i) => {
    try {
      const els = convertElement(se, ctx, `${where} element ${i + 1}`)
      const buildUuid = uuidOf(se.build_in?.uuid).toLowerCase()
      if (se.build_in && els.length) {
        const idx = order.indexOf(buildUuid)
        const n = idx >= 0 ? idx + 1 : 1
        for (const e of els) e.buildIn = n
      }
      front.push(els)
    } catch (e) {
      ctx.warn(`${where}: element ${i + 1} could not be converted (${(e as Error).message})`)
    }
  })
  out.elements = front.reverse().flat()
  if (bs.draws_background_color) {
    const c = cssColor(bs.background_color)
    if (c) out.background = { type: 'color', color: c }
  }
  if (bs.size?.width > 0 && bs.size?.height > 0) out.size = { width: Math.round(bs.size.width), height: Math.round(bs.size.height) }
  out.uuid = uuidOf(bs.uuid) || undefined
  if (bs.guidelines?.length) ctx.note('slide.guidelines', 0)
  return out
}
