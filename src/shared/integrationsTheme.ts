/** Apply a theme template to generated slides by text role (integrations generate plain slides, themes make them pretty). */
import type { Slide, SlideElement, TextElement, Theme } from './model'

const roleOf = (e: SlideElement): string | undefined => (e.type === 'text' && !e.dynamic ? e.role : undefined)

/** Pick the template that covers the most roles of `slide`; `hint` (e.g. 'scripture', 'point') breaks ties by template name. */
export function pickTemplate(theme: Theme | null | undefined, slide: Slide, hint?: string): Theme['templates'][number] | null {
  if (!theme?.templates?.length) return null
  const roles = new Set(slide.elements.map(roleOf).filter(Boolean))
  if (!roles.size) return null
  let best: Theme['templates'][number] | null = null
  let bestScore = 0
  for (const t of theme.templates) {
    const tRoles = new Set(t.slide.elements.map(roleOf).filter(Boolean))
    let score = 0
    for (const r of roles) if (tRoles.has(r)) score += 10
    for (const r of tRoles) if (!roles.has(r)) score -= 2
    if (hint && t.name.toLowerCase().includes(hint.toLowerCase())) score += 5
    if (score > bestScore) { best = t; bestScore = score }
  }
  return best
}

export function applyTheme(slide: Slide, theme: Theme | null | undefined, hint?: string): Slide {
  const tpl = pickTemplate(theme, slide, hint)
  if (!tpl) return slide
  const byRole = new Map<string, TextElement>()
  for (const e of tpl.slide.elements) { const r = roleOf(e); if (r && !byRole.has(r)) byRole.set(r, e as TextElement) }
  const decor = tpl.slide.elements.filter((e) => !roleOf(e)).map((e) => ({ ...e, id: `${slide.id}-${e.id}`, locked: true }))
  const elements = slide.elements.map((e) => {
    const r = roleOf(e)
    const t = r ? byRole.get(r) : undefined
    if (!t || e.type !== 'text') return e
    return { ...e, frame: { ...t.frame }, style: { ...t.style }, align: t.align, verticalAlign: t.verticalAlign, fill: t.fill, padding: t.padding, shadow: t.shadow, stroke: t.stroke, autoFit: t.autoFit ?? e.autoFit }
  })
  return { ...slide, background: tpl.slide.background ?? slide.background, elements: [...decor, ...elements], transition: slide.transition ?? tpl.slide.transition }
}
