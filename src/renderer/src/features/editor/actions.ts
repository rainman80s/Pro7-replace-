/** Higher-level editor commands shared by the toolbar, inspector, menus and keyboard. */
import type { ID, Presentation, Rect, Region, Slide, SlideElement, Theme } from '@shared/model'
import { alignRect, boundsOf, aabb, type AlignOp } from '@shared/editor-geometry'
import { applyVariantLayout, createVariant, fillRegion, setVariant, type VariantStrategy } from '@shared/editor-variants'
import { applyTheme, removeTheme, themeFromSlide, THEMES_DOC } from '@shared/themes'
import { toast } from '@ui/index'
import { api, readDoc, useApp, writeDoc } from '../../app/store'
import { commit, currentSurface, getDoc, patchElements, refreshDocs, setFrames, updateSlide, useEditor, audienceCanvases } from './store'

const get = useEditor.getState

export function customizeVariant(strategy: VariantStrategy): void {
  const { slideId, canvasId } = get()
  const doc = getDoc()
  const canvas = audienceCanvases().find((c) => c.id === canvasId)
  if (!doc || !slideId || !canvas) return
  updateSlide(slideId, (s) => setVariant(s, canvas.id, createVariant(s, doc.size, canvas, strategy)), `Customize for ${canvas.name}`)
  useEditor.setState({ selection: [] })
}

export function resetVariant(slideIds?: ID[]): void {
  const { slideId, canvasId } = get()
  const canvas = audienceCanvases().find((c) => c.id === canvasId)
  const ids = new Set(slideIds ?? (slideId ? [slideId] : []))
  if (!canvas || !ids.size) return
  commit((d) => ({ ...d, slides: d.slides.map((s) => (ids.has(s.id) && s.variants?.[canvas.id] ? setVariant(s, canvas.id, null) : s)) }), `Reset ${canvas.name} to main design`)
  useEditor.setState({ selection: [] })
}

/** Copy this slide's layout for the current canvas onto other slides (all / same group / selected). */
export function applyLayoutTo(scope: 'all' | 'group' | 'selected'): number {
  const { slideId, canvasId, slideIds } = get()
  const doc = getDoc()
  const canvas = audienceCanvases().find((c) => c.id === canvasId)
  const src = doc?.slides.find((s) => s.id === slideId)
  if (!doc || !src || !canvas) return 0
  let targets: Set<ID>
  if (scope === 'all') targets = new Set(doc.slides.map((s) => s.id))
  else if (scope === 'group') targets = new Set(doc.groups.find((g) => g.slideIds.includes(src.id))?.slideIds ?? [])
  else targets = new Set(slideIds)
  targets.delete(src.id)
  if (!targets.size) { toast('No other slides to apply to', 'warning'); return 0 }
  commit((d) => ({ ...d, slides: d.slides.map((s) => (targets.has(s.id) ? applyVariantLayout(src, canvas.id, s) : s)) }), `Apply ${canvas.name} layout to ${targets.size} slides`)
  toast(`${canvas.name} layout applied to ${targets.size} slide${targets.size === 1 ? '' : 's'}`, 'success')
  return targets.size
}

export function fillRegionSel(region: Region): void {
  const ids = get().selection
  patchElements(ids, (e) => fillRegion(e, region), `Fill ${region.name}`)
}

export function alignSelection(op: AlignOp, to: 'slide' | 'selection' | 'region'): void {
  const surf = currentSurface()
  const ids = get().selection
  if (!surf || !ids.length) return
  const els = surf.elements.filter((e) => ids.includes(e.id) && !e.locked)
  const selB = boundsOf(els.map((e) => aabb(e.frame, e.rotation)))
  const frames: Record<ID, { frame: Rect }> = {}
  for (const e of els) {
    let within: Rect = { x: 0, y: 0, w: surf.size.width, h: surf.size.height }
    if (to === 'selection' && els.length > 1) within = selB
    if (to === 'region') {
      const r = surf.regions.find((g) => g.id === e.regionId)
      if (r) within = r.rect
    }
    const bb = aabb(e.frame, e.rotation)
    const moved = alignRect(bb, within, op)
    frames[e.id] = { frame: { ...e.frame, x: Math.round(e.frame.x + moved.x - bb.x), y: Math.round(e.frame.y + moved.y - bb.y) } }
  }
  setFrames(frames, 'Align')
}

export function distribute(axis: 'x' | 'y'): void {
  const surf = currentSurface()
  const ids = get().selection
  if (!surf || ids.length < 3) return
  const els = surf.elements.filter((e) => ids.includes(e.id)).sort((a, b) => a.frame[axis] - b.frame[axis])
  const dim = axis === 'x' ? 'w' : 'h'
  const first = els[0].frame
  const last = els[els.length - 1].frame
  const total = els.reduce((n, e) => n + e.frame[dim], 0)
  const gap = (last[axis] + last[dim] - first[axis] - total) / (els.length - 1)
  let pos = first[axis]
  const frames: Record<ID, { frame: Rect }> = {}
  for (const e of els) { frames[e.id] = { frame: { ...e.frame, [axis]: Math.round(pos) } }; pos += e.frame[dim] + gap }
  setFrames(frames, 'Distribute')
}

export function nudge(dx: number, dy: number): void {
  const surf = currentSurface()
  const ids = get().selection
  if (!surf || surf.inherited || !ids.length) return
  const frames: Record<ID, { frame: Rect }> = {}
  for (const e of surf.elements) if (ids.includes(e.id) && !e.locked) frames[e.id] = { frame: { ...e.frame, x: e.frame.x + dx, y: e.frame.y + dy } }
  setFrames(frames, 'Nudge', 'nudge:' + ids.join())
}

/* ── themes ── */

export function applyThemeTo(theme: Theme, scope: 'all' | 'selected', templateId?: ID): void {
  const ids = get().slideIds
  commit((d) => applyTheme(d, theme, { slideIds: scope === 'selected' ? ids : undefined, templateId }), `Apply theme “${theme.name}”`)
  toast(`Theme “${theme.name}” applied`, 'success', 'You can remove it any time — the original look is kept.')
}
export function removeThemeFrom(scope: 'all' | 'selected'): void {
  const ids = get().slideIds
  commit((d) => removeTheme(d, scope === 'selected' ? ids : undefined), 'Remove theme')
}

export async function saveSlideAsTheme(name: string): Promise<Theme | null> {
  const doc = getDoc()
  const slide = doc?.slides.find((s) => s.id === get().slideId)
  if (!doc || !slide) return null
  const theme = themeFromSlide(name, slide, doc.size)
  const list = await readDoc<Theme[]>(THEMES_DOC, [])
  await writeDoc(THEMES_DOC, [...(Array.isArray(list) ? list : []), theme])
  await refreshDocs()
  toast(`Saved theme “${name}”`, 'success')
  return theme
}

/** Copy a built-in into the workspace so it can be edited. */
export async function ensureEditableTheme(theme: Theme): Promise<void> {
  const list = await readDoc<Theme[]>(THEMES_DOC, [])
  const arr = Array.isArray(list) ? list : []
  if (!arr.some((t) => t.id === theme.id)) await writeDoc(THEMES_DOC, [...arr, theme])
  await refreshDocs()
}

export async function deleteTheme(id: ID): Promise<void> {
  const list = await readDoc<Theme[]>(THEMES_DOC, [])
  await writeDoc(THEMES_DOC, (Array.isArray(list) ? list : []).filter((t) => t.id !== id))
  await refreshDocs()
}

/** Apply a template slide to the current slide only (from the theme editor or a quick menu). */
export function applyTemplateToSlide(theme: Theme, templateId: ID): void {
  applyThemeTo(theme, 'selected', templateId)
}

export function setWorkspaceDefaultTheme(id: ID | undefined): void {
  void api.invoke('workspace.update', { defaultThemeId: id })
}
export function setCanvasTheme(canvasId: ID, themeId: ID | undefined): void {
  const ws = useApp.getState().workspace
  if (!ws) return
  void api.invoke('workspace.update', { canvases: ws.canvases.map((c) => (c.id === canvasId ? { ...c, themeId } : c)) })
}

export type { Presentation, Slide, SlideElement }
