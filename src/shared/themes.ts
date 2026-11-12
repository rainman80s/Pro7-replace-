/**
 * Themes — see docs/themes.md.
 *
 * A Theme is a named set of template slides. Applying a template to a slide keeps the slide's WORDS and
 * replaces its LOOK: every content text box is matched to a template text box by `role`
 * ('lyrics' | 'title' | 'subtitle' | 'reference' | 'body' | 'caption' | …), template decoration
 * (shapes, images, fixed text) comes along flagged `fromTheme`, and per-canvas variants in the template
 * become per-canvas variants of the slide.
 *
 * Unlike ProPresenter, applying a theme is NOT a one-way paste:
 *  - the pre-theme design of each slide is kept in `presentation.meta.theme.slides[id].original`
 *    so `removeTheme` restores it (with the current words);
 *  - `presentation.themeId` + the chosen template per slide are remembered, so after editing a theme
 *    `applyTheme` can simply be run again ("Update presentations using this theme").
 */
import type { Canvas, Fill, ID, Presentation, Size, Slide, SlideElement, SlideVariant, TextElement, TextRun, Theme } from './model'
import { linkVariantElements } from './model'
import { clone, isContentText, paragraphsText, setParagraphsText, uid } from './editor-util'
import { BUILTIN_THEMES } from './themes-builtin'

export const THEMES_DOC = 'themes'
export const THEME_ROLES = ['lyrics', 'title', 'subtitle', 'reference', 'body', 'caption'] as const
export const ROLE_LABELS: Record<string, string> = {
  lyrics: 'Lyrics', title: 'Title', subtitle: 'Subtitle', reference: 'Reference', body: 'Body text', caption: 'Caption', translation: 'Translation'
}

export interface ThemeRecord {
  id: ID
  /** slideId → which template was used and what the slide looked like before any theme. */
  slides: Record<ID, { templateId?: ID; original?: Pick<Slide, 'elements' | 'background' | 'variants'> }>
}

/** Built-in Reach themes + the workspace's own (a workspace theme with a built-in's id replaces it). */
export function allThemes(docThemes: Theme[] | null | undefined): Theme[] {
  const mine = Array.isArray(docThemes) ? docThemes : []
  const ids = new Set(mine.map((t) => t.id))
  return [...BUILTIN_THEMES.filter((t) => !ids.has(t.id)), ...mine]
}
export const isBuiltinTheme = (id: ID): boolean => BUILTIN_THEMES.some((t) => t.id === id)

const slotRoles = (els: SlideElement[]): string[] => els.filter(isContentText).map((e) => e.role).filter((r): r is string => !!r)

/** The template whose roles best match the slide's text (ties → the earlier template). */
export function pickTemplate(theme: Theme, slide: Slide): Theme['templates'][number] | undefined {
  const want = slide.elements.filter((e) => isContentText(e) && !e.fromTheme).map((e) => (e as TextElement).role ?? '')
  let best: Theme['templates'][number] | undefined
  let bestScore = -Infinity
  for (const t of theme.templates) {
    const have = slotRoles(t.slide.elements)
    const hit = want.filter((r) => r && have.includes(r)).length
    // Prefer templates that cover the slide's roles without lots of unused slots.
    const score = hit * 10 - Math.max(0, have.length - Math.max(want.length, 1)) - (want.length > have.length ? 3 : 0)
    if (score > bestScore) { best = t; bestScore = score }
  }
  return best
}

const KEEP_RUN_STYLE = ['fontWeight', 'italic', 'underline', 'color'] as const
function keepEmphasis(runs: TextRun[]): TextRun[] {
  return runs.map((r) => {
    if (!r.style) return r
    const s: Record<string, unknown> = {}
    for (const k of KEEP_RUN_STYLE) if (r.style[k] !== undefined) s[k] = r.style[k]
    return Object.keys(s).length ? { text: r.text, style: s } : { text: r.text }
  })
}

/**
 * Lay the content of `content` out using the boxes of `template`.
 * `keepIds`: reuse the content element ids for the matched text boxes (base design) or make new ones (variants).
 */
export function restyleElements(content: SlideElement[], template: SlideElement[], keepIds = true): SlideElement[] {
  const texts = content.filter((e): e is TextElement => isContentText(e) && !e.fromTheme)
  const userOther = content.filter((e) => !e.fromTheme && !isContentText(e))
  const slots = template.filter((e): e is TextElement => isContentText(e) && !!e.role)
  const assigned = new Map<string, TextElement>() // slot id → content text
  const taken = new Set<string>()
  // 1. role ↔ role, in order.
  for (const slot of slots) {
    const t = texts.find((x) => !taken.has(x.id) && x.role === slot.role)
    if (t) { assigned.set(slot.id, t); taken.add(t.id) }
  }
  // 2. leftovers (other/missing roles) take the remaining slots in order, so a one-box slide is always themed.
  for (const t of texts) {
    if (taken.has(t.id)) continue
    const slot = slots.find((s) => !assigned.has(s.id))
    if (!slot) break
    assigned.set(slot.id, t)
    taken.add(t.id)
  }
  const out: SlideElement[] = []
  let placedUser = false
  for (const el of template) {
    const isSlot = slots.includes(el as TextElement)
    if (isSlot && !placedUser) { out.push(...userOther); placedUser = true }
    if (!isSlot) { out.push({ ...clone(el), id: uid(), fromTheme: true }); continue }
    const t = assigned.get(el.id)
    if (!t) continue
    const slot = clone(el) as TextElement
    out.push({
      ...slot, id: keepIds ? t.id : uid(), role: slot.role,
      paragraphs: t.paragraphs.map((p) => ({ runs: keepEmphasis(p.runs) })),
      ...(t.buildIn ? { buildIn: t.buildIn } : {})
    })
  }
  if (!placedUser) out.push(...userOther)
  // Text that found no slot stays as it was, on top.
  out.push(...texts.filter((t) => !taken.has(t.id)))
  return out
}

/** Restyle one slide with a template slide (including the template's per-canvas variants). */
export function applyTemplate(slide: Slide, template: Slide): Slide {
  const next: Slide = { ...slide, elements: restyleElements(slide.elements, template.elements) }
  if (template.background) next.background = clone(template.background)
  else delete next.background
  if (template.transition && !slide.transition) next.transition = template.transition
  const variants: Record<ID, SlideVariant> = { ...(slide.variants ?? {}) }
  for (const [cid, tv] of Object.entries(template.variants ?? {})) {
    const v: SlideVariant = { elements: linkVariantElements(next.elements, restyleElements(slide.elements, tv.elements, false)) }
    if (tv.background) v.background = clone(tv.background)
    variants[cid] = v
  }
  if (Object.keys(variants).length) next.variants = variants
  return next
}

const record = (p: Presentation): ThemeRecord | undefined => p.meta.theme as ThemeRecord | undefined

/**
 * Apply a theme to a whole presentation (or just `slideIds`). `templateId` forces one template;
 * otherwise each slide keeps the template it had last time, or the best match by role.
 */
export function applyTheme(p: Presentation, theme: Theme, opts: { slideIds?: ID[]; templateId?: ID } = {}): Presentation {
  const prev = record(p)
  const rec: ThemeRecord = { id: theme.id, slides: { ...(prev?.slides ?? {}) } }
  const only = opts.slideIds ? new Set(opts.slideIds) : null
  const slides = p.slides.map((s) => {
    if (only && !only.has(s.id)) return s
    const remembered = prev?.id === theme.id ? prev.slides[s.id]?.templateId : undefined
    const tpl = theme.templates.find((t) => t.id === (opts.templateId ?? remembered)) ?? pickTemplate(theme, s)
    if (!tpl) return s
    const before = rec.slides[s.id]?.original ?? clone({ elements: s.elements, background: s.background, variants: s.variants })
    rec.slides[s.id] = { templateId: tpl.id, original: before }
    return applyTemplate(s, tpl.slide)
  })
  // Forget slides that no longer exist.
  const ids = new Set(slides.map((s) => s.id))
  for (const k of Object.keys(rec.slides)) if (!ids.has(k)) delete rec.slides[k]
  return { ...p, slides, themeId: theme.id, meta: { ...p.meta, theme: rec } }
}

/** Put a slide's pre-theme design back, keeping the words it has now. */
function restoreSlide(slide: Slide, original: NonNullable<ThemeRecord['slides'][string]['original']>): Slide {
  const now = slide.elements.filter((e): e is TextElement => isContentText(e) && !e.fromTheme)
  const byId = new Map(now.map((t) => [t.id, t]))
  const used = new Set<string>()
  const elements = clone(original.elements).map((e) => {
    if (!isContentText(e)) return e
    const cur = byId.get(e.id) ?? now.find((t) => !used.has(t.id) && t.role === e.role)
    if (!cur) return e
    used.add(cur.id)
    return { ...e, paragraphs: setParagraphsText(e.paragraphs, paragraphsText(cur.paragraphs)) }
  })
  // Things added after theming (new text boxes, images) survive.
  const origIds = new Set(elements.map((e) => e.id))
  const added = slide.elements.filter((e) => !e.fromTheme && !origIds.has(e.id) && !used.has(e.id))
  const next: Slide = { ...slide, elements: [...elements, ...added] }
  if (original.background) next.background = clone(original.background)
  else delete next.background
  if (original.variants) next.variants = Object.fromEntries(Object.entries(clone(original.variants)).map(([k, v]) => [k, { ...v, elements: linkVariantElements(next.elements, v.elements) }]))
  else delete next.variants
  return next
}

/** Undo theming: every slide (or `slideIds`) goes back to how it looked before a theme was first applied. */
export function removeTheme(p: Presentation, slideIds?: ID[]): Presentation {
  const rec = record(p)
  if (!rec) return p.themeId ? { ...p, themeId: undefined } : p
  const only = slideIds ? new Set(slideIds) : null
  const left: ThemeRecord['slides'] = {}
  const slides = p.slides.map((s) => {
    const r = rec.slides[s.id]
    if (!r) return s
    if (only && !only.has(s.id)) { left[s.id] = r; return s }
    return r.original ? restoreSlide(s, r.original) : s
  })
  const meta = { ...p.meta }
  if (Object.keys(left).length) meta.theme = { id: rec.id, slides: left }
  else delete meta.theme
  const next: Presentation = { ...p, slides, meta }
  if (!Object.keys(left).length) delete next.themeId
  return next
}

export const themedSlideCount = (p: Presentation): number => Object.keys(record(p)?.slides ?? {}).length
export const slideTemplateId = (p: Presentation, slideId: ID): ID | undefined => record(p)?.slides[slideId]?.templateId

/** Make a one-template theme out of an existing slide (its variants become the template's variants). */
export function themeFromSlide(name: string, slide: Slide, size: Size): Theme {
  const s = clone(slide)
  const tpl: Slide = { id: uid(), elements: s.elements.map((e) => ({ ...e, fromTheme: undefined })), background: s.background, variants: s.variants, transition: s.transition }
  tpl.elements = clone(tpl.elements)
  return { id: uid(), name, size: { ...size }, templates: [{ id: uid(), name: slide.label || 'Slide', slide: tpl }] }
}

/**
 * Canvas default theme (`canvas.themeId`): how a slide WITHOUT its own variant should look on that canvas.
 * Returns null when the canvas theme doesn't apply. Pure — renderers can call it per frame.
 */
export function resolveSlideWithCanvasTheme(
  slide: Slide, size: Size, canvas: Pick<Canvas, 'id' | 'width' | 'height' | 'themeId'>, themes: Theme[]
): { elements: SlideElement[]; background?: Fill; size: Size } | null {
  if (!canvas.themeId || slide.variants?.[canvas.id]) return null
  const theme = themes.find((t) => t.id === canvas.themeId)
  const tpl = theme && pickTemplate(theme, slide)
  if (!theme || !tpl) return null
  const tv = tpl.slide.variants?.[canvas.id]
  if (tv) return { elements: restyleElements(slide.elements, tv.elements, false), background: tv.background ?? tpl.slide.background, size: { width: canvas.width, height: canvas.height } }
  return { elements: restyleElements(slide.elements, tpl.slide.elements), background: tpl.slide.background, size: theme.size ?? size }
}
