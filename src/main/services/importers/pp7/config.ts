/**
 * ProPresenter Configuration/* documents and Themes → Reach workspace docs.
 * Each converter is pure: decoded protobuf in, Reach docs out, plus warnings/unmapped in the ConvertContext.
 */
import type { Macro, Size, Slide, SlideAction, StageLayout, TextElement, Theme } from '@shared/model'
import type { SuggestedCanvas } from '@shared/import'
import { cssColor, idFromUuid, uuidOf, type PB } from './proto'
import { ConvertContext, jsonSafe } from './context'
import { convertAction, splitDisabled, timerConfig } from './actions'
import { convertBaseSlide, type ImportedElement } from './elements'
import { hotKeyOf } from './presentation'

/** Mirrors of the workspace doc shapes owned by the control/editor agents (kept structurally compatible). */
export interface TimerDefLike { id: string; name: string; kind: 'countdown' | 'countdownTo' | 'elapsed'; duration?: number; target?: string; overrun?: boolean; source?: unknown }
export interface MessageTemplateLike { id: string; name: string; text: string; position?: 'top' | 'bottom' | 'center' | 'ticker'; autoHide?: number; source?: unknown }
export interface PropDefLike { id: string; name: string; slide: Slide; size: Size; autoClear?: number; color?: string; source?: unknown }

const SIZE_1080: Size = { width: 1920, height: 1080 }
const srcTag = (uuid: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ type: 'propresenter7', uuid, ...extra })

/* ── Macros (rv.data.MacrosDocument) ── */
export function convertMacros(doc: PB, ctx: ConvertContext): (Macro & { source?: unknown; collection?: string })[] {
  const collections = new Map<string, string>()
  for (const c of (doc.macro_collections ?? []) as PB[]) for (const it of (c.items ?? []) as PB[]) {
    const id = uuidOf(it.macro_id).toLowerCase()
    if (id && !collections.has(id)) collections.set(id, c.name ?? '')
  }
  return ((doc.macros ?? []) as PB[]).map((m, i) => {
    const actions: SlideAction[] = []
    for (const a of (m.actions ?? []) as PB[]) {
      const act = convertAction(a, ctx, `macro "${m.name ?? i + 1}"`)
      if (act) actions.push(act)
    }
    const { active, disabled } = splitDisabled(actions)
    const macro: Macro & { source?: unknown; collection?: string } = {
      id: idFromUuid(m.uuid, ctx.newId), name: m.name || `Macro ${i + 1}`, actions: active,
      source: srcTag(uuidOf(m.uuid), { disabledActions: disabled.length ? disabled : undefined, triggerOnStartup: m.trigger_on_startup || undefined, imageType: m.image_type || undefined })
    }
    const color = cssColor(m.color)
    if (color) macro.color = color
    const col = collections.get(uuidOf(m.uuid).toLowerCase())
    if (col) macro.collection = col
    if (m.image_type) macro.icon = String(m.image_type)
    return macro
  })
}

/* ── Timers (rv.data.TimersDocument) ── */
export function convertTimers(doc: PB, ctx: ConvertContext): { timers: TimerDefLike[]; clockFormat?: string } {
  const timers: TimerDefLike[] = ((doc.timers ?? []) as PB[]).map((t, i) => {
    const cfg = timerConfig(t.configuration)
    const out: TimerDefLike = { id: idFromUuid(t.uuid, ctx.newId), name: t.name || `Timer ${i + 1}`, kind: (cfg.kind as TimerDefLike['kind']) ?? 'countdown', source: srcTag(uuidOf(t.uuid)) }
    if (cfg.duration !== undefined) out.duration = Number(cfg.duration)
    if (cfg.target) out.target = String(cfg.target)
    if (cfg.overrun) out.overrun = true
    if (cfg.kind === 'elapsed' && (cfg.startAt || cfg.endAt)) ctx.note('timer.elapsedRange')
    return out
  })
  return { timers, clockFormat: doc.clock?.format || undefined }
}

/* ── Messages (rv.data.MessageDocument) ── */
export function convertMessages(doc: PB, ctx: ConvertContext): MessageTemplateLike[] {
  return ((doc.messages ?? []) as PB[]).map((m, i) => {
    // message_text holds ${<token uuid>} placeholders; tokens name them (timer / clock / text field).
    const names = new Map<string, string>()
    for (const t of (m.tokens ?? []) as PB[]) {
      const id = uuidOf(t.uuid)
      if (t.timer) names.set(id, `{timer:${t.timer.name || uuidOf(t.timer.timer_uuid)}}`)
      else if (t.clock) names.set(id, '{clock}')
      else if (t.text) names.set(id, `{${t.text.name || 'text'}}`)
      else names.set(id, `{${t.name || 'field'}}`)
    }
    for (const v of (m.token_values ?? []) as PB[]) {
      const id = uuidOf(v.token_id)
      if (!names.has(id) && v.token_name) names.set(id, `{${v.token_name}}`)
    }
    const text = String(m.message_text ?? '').replace(/\$\{([^}]+)\}/g, (_x, id: string) => names.get(id) ?? `{${id}}`)
    if (m.template?.name) ctx.note('message.themeTemplate')
    const out: MessageTemplateLike = { id: idFromUuid(m.uuid, ctx.newId), name: m.title || `Message ${i + 1}`, text, position: 'bottom', source: srcTag(uuidOf(m.uuid), { template: m.template ? jsonSafe(m.template) : undefined, clearType: m.clear_type || undefined }) }
    if (m.clear_type === 'CLEAR_TYPE_AFTER_TIME' && m.clear_time > 0) out.autoHide = m.clear_time
    return out
  })
}

/* ── Props (rv.data.PropDocument: cues with PROP_SLIDE actions) ── */
export function convertProps(doc: PB, ctx: ConvertContext): PropDefLike[] {
  const out: PropDefLike[] = []
  for (const [i, cue] of ((doc.cues ?? []) as PB[]).entries()) {
    const act = ((cue.actions ?? []) as PB[]).find((a) => a.slide?.prop)
    if (!act) { ctx.warn(`prop "${cue.name ?? i + 1}" has no slide`); continue }
    const conv = convertBaseSlide(act.slide.prop.base_slide, ctx, `prop "${cue.name ?? i + 1}"`)
    const slide: Slide = { id: idFromUuid(act.slide.prop.base_slide?.uuid, ctx.newId), elements: conv.elements }
    if (conv.background) slide.background = conv.background
    const p: PropDefLike = { id: idFromUuid(cue.uuid, ctx.newId), name: cue.name || `Prop ${i + 1}`, slide, size: conv.size ?? SIZE_1080, source: srcTag(uuidOf(cue.uuid)) }
    out.push(p)
  }
  return out
}

/* ── Stage layouts (rv.data.Stage.Document) ── */
export function convertStageLayouts(doc: PB, ctx: ConvertContext): StageLayout[] {
  return ((doc.layouts ?? []) as PB[]).map((l, i) => {
    const conv = convertBaseSlide(l.slide, ctx, `stage layout "${l.name ?? i + 1}"`)
    const elements = conv.elements.map((e) => stageElement(e))
    const slide: Slide = { id: idFromUuid(l.slide?.uuid, ctx.newId), elements, background: conv.background ?? { type: 'color', color: '#000000' } }
    const layout: StageLayout & { source?: unknown } = { id: idFromUuid(l.uuid, ctx.newId), name: l.name || `Stage ${i + 1}`, size: conv.size ?? SIZE_1080, slide, source: srcTag(uuidOf(l.uuid)) }
    return layout
  })
}

/** Stage placeholders arrive as transparent boxes; give them a readable default look and a label. */
function stageElement(e: ImportedElement): ImportedElement {
  if (e.type !== 'text') {
    const ext = e.ext ?? {}
    if (ext.slideImage || ext.outputScreen || ext.chordChart) {
      const label = ext.slideImage === 'next' ? '{next.image}' : ext.slideImage ? '{current.image}' : ext.outputScreen ? `{screen:${(ext.outputScreen as { name?: string }).name ?? 'Output'}}` : '{chordChart}'
      return { ...e, type: 'text', paragraphs: [{ runs: [{ text: label }] }], style: { fontSize: 36, color: '#7A7A7A' }, align: 'center', verticalAlign: 'middle', dynamic: true, fill: { type: 'color', color: '#1A1A1A' } } as ImportedElement
    }
    return e
  }
  const t = e as TextElement & ImportedElement
  if (t.dynamic) {
    t.style = { color: '#FFFFFF', fontSize: Math.max(24, Math.round(Math.min(t.frame.h * 0.6, 120))), ...t.style }
    t.autoFit = true
  }
  return t
}

/* ── Themes (rv.data.Template.Document) ── */
export function convertTheme(doc: PB, name: string, ctx: ConvertContext, themeId?: string): Theme & { source?: unknown } {
  const templates = ((doc.slides ?? []) as PB[]).map((s, i) => {
    const conv = convertBaseSlide(s.base_slide, ctx, `theme "${name}" slide ${i + 1}`)
    const slide: Slide = { id: idFromUuid(s.base_slide?.uuid, ctx.newId), elements: conv.elements }
    if (conv.background) slide.background = conv.background
    // Theme text boxes are placeholders: number them by ProPresenter's convention (first = main text).
    const texts = conv.elements.filter((e): e is TextElement & ImportedElement => e.type === 'text').reverse()
    const roles = ['lyrics', 'translation']
    let k = 0
    for (const t of texts) if (!t.role && !t.dynamic && k < roles.length) t.role = roles[k++]
    return { id: slide.id, name: s.name || `Slide ${i + 1}`, slide, size: conv.size }
  })
  const size = templates.find((t) => t.size)?.size ?? SIZE_1080
  return { id: themeId ?? ctx.newId(), name, size, templates: templates.map(({ size: _s, ...t }) => t), source: srcTag('', { app: doc.application_info?.application_version?.major_version }) }
}

/* ── Groups / labels (library-wide defaults) ── */
export function convertGroups(doc: PB): { id: string; name: string; color?: string; hotKey?: string }[] {
  return ((doc.groups ?? []) as PB[]).map((g) => ({ id: idFromUuid(g.uuid, () => uuidOf(g.uuid)), name: g.name ?? '', color: cssColor(g.color), hotKey: hotKeyOf(g.hotKey) }))
}
export function convertLabels(doc: PB): { text: string; color?: string }[] {
  return ((doc.labels ?? []) as PB[]).map((l) => ({ text: l.text ?? '', color: cssColor(l.color) })).filter((l) => l.text)
}

/* ── Workspace (screens, looks) → SUGGESTED canvases ── */
export function suggestCanvases(doc: PB, ctx: ConvertContext): { canvases: SuggestedCanvas[]; looks: { name: string; screens: { screen: string; layers: Record<string, boolean>; theme?: string }[] }[]; masks: string[]; videoInputs: string[] } {
  const screens: PB[] = doc.pro_screens ?? []
  const nameById = new Map<string, string>()
  const canvases: SuggestedCanvas[] = []
  for (const s of screens) {
    nameById.set(uuidOf(s.uuid), s.name ?? '')
    const arr: PB = s.arrangement_single ?? s.arrangement_edge_blend ?? s.arrangement_grid ?? s.arrangement_custom ?? {}
    if (s.arrangement_edge_blend) ctx.note('screen.edgeBlend')
    if (s.arrangement_grid) ctx.note('screen.grid')
    const outs: PB[] = arr.screens ?? []
    // Canvas size = union of output bounds; each output becomes a region when there is more than one.
    let w = 0
    let h = 0
    for (const o of outs) {
      const b = o.bounds ?? {}
      w = Math.max(w, (b.origin?.x ?? 0) + (b.size?.width ?? 0))
      h = Math.max(h, (b.origin?.y ?? 0) + (b.size?.height ?? 0))
    }
    if (!w || !h) { w = 1920; h = 1080 }
    const regions = outs.length > 1 ? outs.map((o, i) => ({ name: o.name || `Output ${i + 1}`, rect: { x: o.bounds?.origin?.x ?? 0, y: o.bounds?.origin?.y ?? 0, w: o.bounds?.size?.width ?? 0, h: o.bounds?.size?.height ?? 0 } })) : []
    const devices = outs.map((o) => {
      const d = o.output_display
      if (!d) return 'not configured'
      return [d.name || d.deviceName, d.model, d.mode?.name].filter(Boolean).join(' · ')
    })
    canvases.push({ name: s.name || 'Screen', kind: s.screen_type === 'SCREEN_TYPE_STAGE' ? 'stage' : 'audience', width: Math.round(w), height: Math.round(h), regions, from: uuidOf(s.uuid), devices })
  }
  canvases.push(...suggestStackedCanvases(canvases))
  const LAYER_FLAGS: [string, string][] = [
    ['live_video_enabled', 'video'], ['presentation_background_enabled', 'background'], ['presentation_foreground_enabled', 'slide'],
    ['announcements_enabled', 'announcement'], ['props_layer_enabled', 'props'], ['messages_layer_enabled', 'message'], ['mask_enabled', 'mask']
  ]
  const looks = ((doc.audience_looks ?? []) as PB[]).map((l) => ({
    name: l.name ?? '',
    screens: ((l.screen_looks ?? []) as PB[]).map((sl) => {
      const layers: Record<string, boolean> = {}
      for (const [k, layer] of LAYER_FLAGS) layers[layer] = !!sl[k]
      const theme = sl.template_document_file_path?.absolute_string ? String(sl.template_document_file_path.absolute_string).split(/[\\/]/).slice(-2, -1)[0] : undefined
      return { screen: nameById.get(uuidOf(sl.pro_screen_uuid)) ?? uuidOf(sl.pro_screen_uuid), layers, theme }
    })
  }))
  if (looks.length) ctx.note('workspace.looks', looks.length)
  return {
    canvases, looks,
    masks: ((doc.masks ?? []) as PB[]).map((m) => m.name ?? '').filter(Boolean),
    videoInputs: ((doc.videoInputs ?? []) as PB[]).map((v) => `${v.user_description ?? ''} (${v.video_input_device?.type ?? ''} ${v.video_input_device?.name ?? ''})`.trim())
  }
}

/** "DeckLink Duo (3) · DeckLink Duo 2 · 1080p 29.97" → which card, which port. Undefined when it isn't a DeckLink/UltraStudio output. */
export function deckLinkCardOf(device: string): { card: string; port?: number } | undefined {
  const parts = device.split(' · ').map((p) => p.trim()).filter(Boolean)
  const bm = parts.filter((p) => /decklink|ultrastudio|blackmagic/i.test(p))
  if (!bm.length) return undefined
  let port: number | undefined
  for (const p of bm) {
    const m = /\((\d+)\)\s*$/.exec(p) ?? /\b(?:port|sdi|output)\s*(\d+)\b/i.exec(p)
    if (m) { port = Number(m[1]); break }
  }
  const card = bm.map((p) => p.replace(/\s*\(\d+\)\s*$/, '').replace(/\s*\b(?:port|sdi|output)\s*\d+\b/i, '').trim().toLowerCase()).sort().join('|')
  return { card, port }
}

/** "LED WALL" → "LED Wall": keep short acronyms, title-case the rest of an all-caps name. */
function tidyName(name: string): string {
  if (name !== name.toUpperCase()) return name
  return name.split(/\s+/).map((w) => (w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase())).join(' ')
}

/**
 * Two single-output audience screens of the same width on the SAME DeckLink card, each shorter than a full 16:9 frame (e.g. LED WALL 1920×880 on port 1 and
 * LED LYRICS 1920×320 on port 3 of a Duo 2) are almost always one physical LED wall split across two feeds.
 * Suggest one stacked canvas with Top/Bottom regions, so slides can be designed across the whole wall.
 */
export function suggestStackedCanvases(list: SuggestedCanvas[]): SuggestedCanvas[] {
  const singles = list
    // Only strips: a screen using a full 16:9 frame (Key, a projector feed) is its own picture, not part of a split wall.
    .map((c, order) => ({ c, order, dl: c.kind === 'audience' && c.regions.length === 0 && c.devices.length === 1 && c.height < Math.round((c.width * 9) / 16) ? deckLinkCardOf(c.devices[0]) : undefined }))
    .filter((x): x is { c: SuggestedCanvas; order: number; dl: { card: string; port?: number } } => !!x.dl)
  const used = new Set<number>()
  const out: SuggestedCanvas[] = []
  for (const a of singles) {
    if (used.has(a.order)) continue
    const b = singles.find((x) => x.order !== a.order && !used.has(x.order) && x.c.width === a.c.width && x.dl.card === a.dl.card && x.dl.port !== a.dl.port)
    if (!b) continue
    used.add(a.order)
    used.add(b.order)
    // Top = the lower port number (the main wall), else the taller one, else import order.
    const [top, bottom] = [a, b].sort((x, y) => (x.dl.port ?? 99) - (y.dl.port ?? 99) || y.c.height - x.c.height || x.order - y.order)
    const name = `${tidyName(top.c.name)} (stacked)`
    out.push({
      name, kind: 'audience', width: top.c.width, height: top.c.height + bottom.c.height,
      regions: [
        { name: 'Top', rect: { x: 0, y: 0, w: top.c.width, h: top.c.height } },
        { name: 'Bottom', rect: { x: 0, y: top.c.height, w: bottom.c.width, h: bottom.c.height } }
      ],
      from: `${top.c.from}+${bottom.c.from}`, devices: [...top.c.devices, ...bottom.c.devices], recommended: true,
      note: `“${top.c.name}” and “${bottom.c.name}” go out of the same SDI card — design across both as one wall`
    })
  }
  return out
}

/* ── Communication devices / MIDI → summary doc for the control agent ── */
export function summarizeDevices(comm: PB | null, workspace: PB | null): Record<string, unknown> {
  const devices = ((comm?.devices ?? []) as PB[]).map((d) => jsonSafe(d))
  const out: Record<string, unknown> = { importedAt: new Date().toISOString(), devices }
  if (workspace) {
    const net = workspace.network ?? workspace.network_link
    if (net) out.network = jsonSafe(net)
    if (workspace.midi_settings || workspace.midiSettings) out.midi = jsonSafe(workspace.midi_settings ?? workspace.midiSettings)
  }
  return out
}
