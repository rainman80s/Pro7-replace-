/**
 * Editor state. One working document at a time, always shaped like a Presentation:
 *  - a library presentation,
 *  - a theme (each template = one slide; slide.label = template name),
 *  - a stage layout (one slide of dynamic text).
 * That lets the same stage/inspector/filmstrip/history edit all three.
 */
import { create } from 'zustand'
import type { Canvas, Fill, ID, Paragraph, Presentation, Rect, Region, Size, Slide, SlideElement, StageLayout, TextElement, Theme } from '@shared/model'
import { orderedSlides } from '@shared/model'
import { canRedo, canUndo, createHistory, pushHistory, redo as redoH, undo as undoH, type History } from '@shared/editor-history'
import { linkedSource, normalizeSlide, setVariant } from '@shared/editor-variants'
import { mergePresentation } from '@shared/editor-merge'
import { clone, cloneSlide, reId, sameJson, uid } from '@shared/editor-util'
import { THEMES_DOC, allThemes } from '@shared/themes'
import { BUILTIN_STAGE_LAYOUTS, STAGE_LAYOUTS_DOC, allStageLayouts } from '@shared/editor-stagelayouts'
import type { TextRange } from '@shared/editor-richtext'
import type { TextStyle } from '@shared/model'
import { toast } from '@ui/index'
import { api, readDoc, useApp, writeDoc } from '../../app/store'

export type DocKind = 'presentation' | 'theme' | 'stage'
export type EditorMode = 'design' | 'text' | 'arrange'

/** Imperative handle of the in-place text editor (set while a text box is being edited). */
export interface ActiveTextEditor {
  applyStyle(patch: Partial<TextStyle>): boolean
  setAlign(align: Paragraph['align'] | undefined): void
  insertText(text: string): void
  hasRange(): boolean
  range(): TextRange | null
}
export const activeText: { current: ActiveTextEditor | null } = { current: null }

export interface EditorState {
  kind: DocKind
  docId: ID | null
  history: History<Presentation> | null
  /** Last version known to be on disk (merge base, echo detection). */
  synced: Presentation | null
  dirty: boolean
  saving: boolean
  savedAt: number
  conflict: { theirs: Presentation; count: number } | null
  slideId: ID | null
  /** Slides selected in the filmstrip (always includes slideId). */
  slideIds: ID[]
  /** null = the main design; otherwise a canvas tab. */
  canvasId: ID | null
  selection: ID[]
  editingId: ID | null
  /** Style at the text caret/selection while editing (for the inspector). */
  textSel: { style: TextStyle; range: boolean } | null
  mode: EditorMode
  tab: 'design' | 'slide' | 'layers' | 'media'
  clipboard: { elements?: SlideElement[]; slides?: Slide[]; style?: Partial<TextElement> } | null
  themes: Theme[]
  stageLayouts: StageLayout[]
}

export const useEditor = create<EditorState>(() => ({
  kind: 'presentation', docId: null, history: null, synced: null, dirty: false, saving: false, savedAt: 0, conflict: null,
  slideId: null, slideIds: [], canvasId: null, selection: [], editingId: null, textSel: null, mode: 'design', tab: 'design',
  clipboard: null, themes: [], stageLayouts: []
}))

const get = useEditor.getState
const set = useEditor.setState
export const getDoc = (): Presentation | null => get().history?.present ?? null
export const useDoc = (): Presentation | null => useEditor((s) => s.history?.present ?? null)

/* ───────────────────────── surface: what the stage is showing ───────────────────────── */

export interface Surface {
  slide: Slide
  elements: SlideElement[]
  background?: Fill
  size: Size
  regions: Region[]
  canvas: Canvas | null
  /** A canvas tab is selected. */
  onCanvas: boolean
  /** …and this slide has its own design for it. */
  isVariant: boolean
  /** Read-only: canvas tab showing the scaled main design. */
  inherited: boolean
}

export function audienceCanvases(): Canvas[] {
  return (useApp.getState().workspace?.canvases ?? []).filter((c) => c.kind !== 'stage')
}

export function surfaceOf(doc: Presentation | null, slideId: ID | null, canvasId: ID | null, canvases: Canvas[]): Surface | null {
  const slide = doc?.slides.find((s) => s.id === slideId)
  if (!doc || !slide) return null
  const canvas = canvasId ? canvases.find((c) => c.id === canvasId) ?? null : null
  if (canvas) {
    const v = slide.variants?.[canvas.id]
    if (v) return { slide, elements: v.elements, background: v.background ?? slide.background, size: { width: canvas.width, height: canvas.height }, regions: canvas.regions, canvas, onCanvas: true, isVariant: true, inherited: false }
    return { slide, elements: slide.elements, background: slide.background, size: doc.size, regions: [], canvas, onCanvas: true, isVariant: false, inherited: true }
  }
  return { slide, elements: slide.elements, background: slide.background, size: doc.size, regions: [], canvas: null, onCanvas: false, isVariant: false, inherited: false }
}
export const currentSurface = (): Surface | null => surfaceOf(getDoc(), get().slideId, get().canvasId, audienceCanvases())

/* ───────────────────────── opening / converting documents ───────────────────────── */

const strip = (p: Presentation): Presentation => ({ ...p, updatedAt: '', createdAt: '' })
const now = (): string => new Date().toISOString()

export function themeToDoc(t: Theme): Presentation {
  const templateIds: Record<ID, ID> = {}
  const slides = t.templates.map((tpl) => {
    const s: Slide = { ...clone(tpl.slide), label: tpl.name }
    templateIds[s.id] = tpl.id
    return s
  })
  return { id: t.id, title: t.name, kind: 'generic', size: { ...t.size }, slides, groups: [], arrangements: [], meta: { templateIds }, createdAt: '', updatedAt: '' }
}
export function docToTheme(p: Presentation): Theme {
  const ids = (p.meta.templateIds ?? {}) as Record<ID, ID>
  return {
    id: p.id, name: p.title, size: { ...p.size },
    templates: p.slides.map((s) => {
      const slide = { ...s }
      delete slide.label
      return { id: ids[s.id] ?? s.id, name: s.label || 'Template', slide }
    })
  }
}
export function layoutToDoc(l: StageLayout): Presentation {
  return { id: l.id, title: l.name, kind: 'generic', size: { ...l.size }, slides: [clone(l.slide)], groups: [], arrangements: [], meta: {}, createdAt: '', updatedAt: '' }
}
export function docToLayout(p: Presentation): StageLayout {
  return { id: p.id, name: p.title, size: { ...p.size }, slide: p.slides[0] ?? { id: uid(), elements: [] } }
}

export async function refreshDocs(): Promise<void> {
  const [themes, layouts] = await Promise.all([readDoc<Theme[]>(THEMES_DOC, []), readDoc<StageLayout[]>(STAGE_LAYOUTS_DOC, [])])
  set({ themes: Array.isArray(themes) ? themes : [], stageLayouts: Array.isArray(layouts) ? layouts : [] })
}
export const themeList = (): Theme[] => allThemes(get().themes)
export const layoutList = (): StageLayout[] => allStageLayouts(get().stageLayouts)

function load(kind: DocKind, doc: Presentation): void {
  const keepCanvas = kind !== 'stage' ? get().canvasId : null
  set({
    kind, docId: doc.id, history: createHistory(doc), synced: doc, dirty: false, conflict: null,
    slideId: doc.slides[0]?.id ?? null, slideIds: doc.slides[0] ? [doc.slides[0].id] : [], selection: [], editingId: null, textSel: null,
    canvasId: keepCanvas, mode: kind === 'presentation' ? get().mode : 'design'
  })
}

export async function openDoc(kind: DocKind, id: ID): Promise<boolean> {
  await flushSave()
  if (kind === 'presentation') {
    const p = await api.invoke('library.get', { id })
    if (!p) return false
    load(kind, p)
    useApp.getState().select({ selectedPresentationId: id })
  } else if (kind === 'theme') {
    await refreshDocs()
    const t = themeList().find((x) => x.id === id)
    if (!t) return false
    load(kind, themeToDoc(t))
  } else {
    await refreshDocs()
    const l = layoutList().find((x) => x.id === id)
    if (!l) return false
    load(kind, layoutToDoc(l))
  }
  return true
}

export function closeDoc(): void {
  set({ docId: null, history: null, synced: null, dirty: false, slideId: null, slideIds: [], selection: [], editingId: null })
}

/* ───────────────────────── committing changes ───────────────────────── */

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingSave: Presentation | null = null
const AUTOSAVE_MS = 700

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void save(), AUTOSAVE_MS)
}

/** Apply a change to the document (one undo step; same `key` within ~1s merges into the previous step). */
export function commit(fn: (doc: Presentation) => Presentation, label: string, key?: string): void {
  const h = get().history
  if (!h) return
  const next = fn(h.present)
  if (next === h.present) return
  set({ history: pushHistory(h, next, label, key), dirty: true })
  fixSelection()
  scheduleSave()
}

function fixSelection(): void {
  const s = get()
  const doc = getDoc()
  if (!doc) return
  const patch: Partial<EditorState> = {}
  if (!doc.slides.some((x) => x.id === s.slideId)) {
    patch.slideId = doc.slides[0]?.id ?? null
    patch.slideIds = patch.slideId ? [patch.slideId] : []
  } else if (s.slideIds.some((id) => !doc.slides.some((x) => x.id === id))) {
    patch.slideIds = s.slideIds.filter((id) => doc.slides.some((x) => x.id === id))
  }
  const surf = surfaceOf(doc, patch.slideId ?? s.slideId, s.canvasId, audienceCanvases())
  const ids = new Set(surf?.elements.map((e) => e.id))
  if (s.selection.some((id) => !ids.has(id))) patch.selection = s.selection.filter((id) => ids.has(id))
  if (s.editingId && !ids.has(s.editingId)) { patch.editingId = null; patch.textSel = null }
  if (Object.keys(patch).length) set(patch)
}

export function undo(): void {
  const h = get().history
  if (!h || !canUndo(h)) return
  set({ history: undoH(h), dirty: true })
  fixSelection()
  scheduleSave()
}
export function redo(): void {
  const h = get().history
  if (!h || !canRedo(h)) return
  set({ history: redoH(h), dirty: true })
  fixSelection()
  scheduleSave()
}

export function updateSlide(slideId: ID, fn: (s: Slide) => Slide, label: string, key?: string): void {
  commit((doc) => {
    let changed = false
    const slides = doc.slides.map((s) => {
      if (s.id !== slideId) return s
      const n = fn(s)
      if (n !== s) changed = true
      return n === s ? s : normalizeSlide(n)
    })
    return changed ? { ...doc, slides } : doc
  }, label, key)
}

/** Change the elements of the surface being edited (main design or the current canvas variant). */
export function updateElements(fn: (els: SlideElement[]) => SlideElement[], label: string, key?: string): void {
  const s = get()
  const surf = currentSurface()
  if (!surf || surf.inherited || !s.slideId) return
  updateSlide(s.slideId, (slide) => {
    if (surf.isVariant && surf.canvas) {
      const v = slide.variants![surf.canvas.id]
      const els = fn(v.elements)
      return els === v.elements ? slide : setVariant(slide, surf.canvas.id, { ...v, elements: els })
    }
    const els = fn(slide.elements)
    return els === slide.elements ? slide : { ...slide, elements: els }
  }, label, key)
}

export function patchElements(ids: ID[], patch: Partial<SlideElement> | ((e: SlideElement) => SlideElement), label: string, key?: string): void {
  const idset = new Set(ids)
  updateElements((els) => els.map((e) => {
    if (!idset.has(e.id)) return e
    const n = typeof patch === 'function' ? patch(e) : ({ ...e, ...patch } as SlideElement)
    for (const k of Object.keys(n) as (keyof SlideElement)[]) if (n[k] === undefined) delete n[k]
    return n
  }), label, key ? `${key}:${ids.join()}` : undefined)
}

/**
 * Set the words of a text box. On a canvas variant, a linked box writes through to the main design's
 * box with the same role — so lyrics stay single-source whichever tab they are typed in.
 */
export function setElementText(id: ID, paragraphs: Paragraph[]): void {
  const s = get()
  const surf = currentSurface()
  if (!surf || !s.slideId) return
  const src = surf.isVariant ? linkedSource(surf.slide.elements, surf.elements, id) : undefined
  if (src) {
    updateSlide(s.slideId, (slide) => ({ ...slide, elements: slide.elements.map((e) => (e.id === src.id ? { ...(e as TextElement), paragraphs } : e)) }), 'Edit text', `text:${id}`)
  } else {
    patchElements([id], (e) => ({ ...(e as TextElement), paragraphs }), 'Edit text', 'text')
  }
}

export function setFrames(frames: Record<ID, { frame?: Rect; rotation?: number }>, label: string, key?: string): void {
  const surf = currentSurface()
  updateElements((els) => els.map((e) => {
    const f = frames[e.id]
    if (!f) return e
    const n = { ...e, ...(f.frame ? { frame: f.frame } : {}), ...(f.rotation !== undefined ? { rotation: f.rotation } : {}) }
    if (!n.rotation) delete n.rotation
    if (surf?.regions.length && f.frame) {
      const cx = f.frame.x + f.frame.w / 2
      const cy = f.frame.y + f.frame.h / 2
      const r = surf.regions.find((g) => cx >= g.rect.x && cx <= g.rect.x + g.rect.w && cy >= g.rect.y && cy <= g.rect.y + g.rect.h)
      if (r) n.regionId = r.id
      else delete n.regionId
    }
    return n
  }), label, key)
}

export function addElement(el: SlideElement, label = 'Add'): void {
  updateElements((els) => [...els, el], label)
  set({ selection: [el.id], editingId: null, tab: 'design' })
}

export function deleteSelection(): void {
  const ids = new Set(get().selection)
  if (!ids.size) return
  updateElements((els) => els.filter((e) => !ids.has(e.id)), 'Delete')
  set({ selection: [], editingId: null })
}

export function reorder(ids: ID[], dir: 'front' | 'back' | 'forward' | 'backward'): void {
  const idset = new Set(ids)
  updateElements((els) => {
    const picked = els.filter((e) => idset.has(e.id))
    const rest = els.filter((e) => !idset.has(e.id))
    if (dir === 'front') return [...rest, ...picked]
    if (dir === 'back') return [...picked, ...rest]
    const out = [...els]
    const order = dir === 'forward' ? [...out.keys()].reverse() : [...out.keys()]
    for (const i of order) {
      const j = dir === 'forward' ? i + 1 : i - 1
      if (idset.has(out[i].id) && out[j] && !idset.has(out[j].id)) [out[i], out[j]] = [out[j], out[i]]
    }
    return out.every((e, i) => e === els[i]) ? els : out
  }, 'Reorder')
}

/* ───────────────────────── clipboard ───────────────────────── */

export function copySelection(cut = false): void {
  const surf = currentSurface()
  const ids = new Set(get().selection)
  if (!surf || !ids.size) return
  set({ clipboard: { elements: clone(surf.elements.filter((e) => ids.has(e.id))) } })
  if (cut) deleteSelection()
}
export function copySlides(): void {
  const doc = getDoc()
  const ids = new Set(get().slideIds)
  if (!doc || !ids.size) return
  set({ clipboard: { slides: clone(doc.slides.filter((s) => ids.has(s.id))) } })
}
export function paste(): void {
  const { clipboard, slideId } = get()
  const surf = currentSurface()
  if (!clipboard) return
  if (clipboard.elements?.length && surf && !surf.inherited) {
    const existing = new Set(surf.elements.map((e) => `${e.frame.x},${e.frame.y}`))
    const els = clipboard.elements.map((e) => {
      const n = reId(clone(e))
      while (existing.has(`${n.frame.x},${n.frame.y}`)) n.frame = { ...n.frame, x: n.frame.x + 24, y: n.frame.y + 24 }
      return n
    })
    updateElements((cur) => [...cur, ...els], 'Paste')
    set({ selection: els.map((e) => e.id), editingId: null })
  } else if (clipboard.slides?.length) {
    insertSlides(clipboard.slides.map(cloneSlide), slideId, 'Paste slide')
  }
}
export function duplicateSelection(): void {
  const surf = currentSurface()
  const ids = new Set(get().selection)
  if (!surf || !ids.size) return
  const els = surf.elements.filter((e) => ids.has(e.id)).map((e) => ({ ...reId(clone(e)), frame: { ...e.frame, x: e.frame.x + 24, y: e.frame.y + 24 } }))
  updateElements((cur) => [...cur, ...els], 'Duplicate')
  set({ selection: els.map((e) => e.id) })
}

/* ───────────────────────── slides ───────────────────────── */

export function selectSlide(id: ID, mode: 'single' | 'toggle' | 'range' = 'single'): void {
  const doc = getDoc()
  const s = get()
  if (!doc) return
  let slideIds = [id]
  if (mode === 'toggle') {
    slideIds = s.slideIds.includes(id) ? s.slideIds.filter((x) => x !== id) : [...s.slideIds, id]
    if (!slideIds.length) slideIds = [id]
  } else if (mode === 'range' && s.slideId) {
    const a = doc.slides.findIndex((x) => x.id === s.slideId)
    const b = doc.slides.findIndex((x) => x.id === id)
    slideIds = doc.slides.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.id)
  }
  const focus = mode === 'toggle' && !slideIds.includes(id) ? slideIds[0] : id
  set({ slideId: focus, slideIds, ...(focus !== s.slideId ? { selection: [], editingId: null, textSel: null } : {}) })
}

/** Insert slides after `afterId` (same group as that slide). */
export function insertSlides(slides: Slide[], afterId: ID | null, label = 'Add slide'): void {
  if (!slides.length) return
  commit((doc) => {
    const at = afterId ? doc.slides.findIndex((s) => s.id === afterId) + 1 : doc.slides.length
    const list = [...doc.slides.slice(0, at), ...slides, ...doc.slides.slice(at)]
    const groups = doc.groups.map((g) => {
      const i = afterId ? g.slideIds.indexOf(afterId) : -1
      return i < 0 ? g : { ...g, slideIds: [...g.slideIds.slice(0, i + 1), ...slides.map((s) => s.id), ...g.slideIds.slice(i + 1)] }
    })
    return { ...doc, slides: list, groups }
  }, label)
  set({ slideId: slides[0].id, slideIds: slides.map((s) => s.id), selection: [], editingId: null })
}

export function newSlide(): void {
  const doc = getDoc()
  const s = get()
  if (!doc) return
  const cur = doc.slides.find((x) => x.id === s.slideId) ?? doc.slides[doc.slides.length - 1]
  let slide: Slide
  if (cur) {
    // Same look as the current slide, empty words.
    slide = cloneSlide(cur)
    delete slide.label
    delete slide.notes
    delete slide.actions
    const blank = (els: SlideElement[]): SlideElement[] => els.map((e) => (e.type === 'text' && !e.dynamic && !e.fromTheme ? { ...e, paragraphs: [{ runs: [{ text: '' }] }] } : e))
    slide.elements = blank(slide.elements)
    slide = normalizeSlide(slide)
  } else slide = { id: uid(), elements: [] }
  insertSlides([slide], cur?.id ?? null)
}

export function duplicateSlides(): void {
  const doc = getDoc()
  const s = get()
  if (!doc || !s.slideIds.length) return
  const picked = doc.slides.filter((x) => s.slideIds.includes(x.id))
  insertSlides(picked.map(cloneSlide), picked[picked.length - 1].id, 'Duplicate slide')
}

export function deleteSlides(ids = get().slideIds): void {
  const doc = getDoc()
  if (!doc || !ids.length) return
  if (doc.slides.length - ids.length < 1 && get().kind !== 'presentation') return void toast('Keep at least one', 'warning')
  const idset = new Set(ids)
  const idx = doc.slides.findIndex((s) => idset.has(s.id))
  commit((d) => ({ ...d, slides: d.slides.filter((s) => !idset.has(s.id)), groups: d.groups.map((g) => (g.slideIds.some((i) => idset.has(i)) ? { ...g, slideIds: g.slideIds.filter((i) => !idset.has(i)) } : g)) }), ids.length > 1 ? 'Delete slides' : 'Delete slide')
  const after = getDoc()
  const next = after?.slides[Math.min(idx, (after?.slides.length ?? 1) - 1)]
  set({ slideId: next?.id ?? null, slideIds: next ? [next.id] : [], selection: [], editingId: null })
}

/** Move slides to sit before `beforeId` (or the end), adopting the group of the drop position. */
export function moveSlides(ids: ID[], beforeId: ID | null, groupId?: ID | null): void {
  commit((doc) => {
    const idset = new Set(ids)
    const moving = doc.slides.filter((s) => idset.has(s.id))
    const rest = doc.slides.filter((s) => !idset.has(s.id))
    const at = beforeId && !idset.has(beforeId) ? rest.findIndex((s) => s.id === beforeId) : rest.length
    const slides = [...rest.slice(0, at < 0 ? rest.length : at), ...moving, ...rest.slice(at < 0 ? rest.length : at)]
    const target = groupId !== undefined ? groupId : beforeId ? doc.groups.find((g) => g.slideIds.includes(beforeId))?.id ?? null : null
    const pos = new Map(slides.map((s, i) => [s.id, i]))
    const groups = doc.groups.map((g) => {
      let sids = g.slideIds.filter((i) => !idset.has(i))
      if (g.id === target) sids = [...sids, ...moving.map((m) => m.id)]
      sids.sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0))
      return sids.join() === g.slideIds.join() ? g : { ...g, slideIds: sids }
    })
    if (slides.every((s, i) => s === doc.slides[i]) && groups.every((g, i) => g === doc.groups[i])) return doc
    return { ...doc, slides, groups }
  }, 'Move slide')
}

/* ───────────────────────── saving & external changes ───────────────────────── */

export async function save(): Promise<void> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  const s = get()
  const doc = getDoc()
  if (!doc || !s.dirty || s.saving || s.conflict) return
  set({ saving: true })
  try {
    if (s.kind === 'presentation') {
      pendingSave = doc
      const saved = await api.invoke('library.save', { presentation: doc })
      pendingSave = null
      // Edits made while the save was in flight stay dirty.
      const still = getDoc()
      set({ synced: { ...doc, updatedAt: saved.updatedAt }, dirty: still !== doc, savedAt: Date.now() })
    } else if (s.kind === 'theme') {
      const list = await readDoc<Theme[]>(THEMES_DOC, [])
      const theme = docToTheme(doc)
      const arr = Array.isArray(list) ? list : []
      const next = arr.some((t) => t.id === theme.id) ? arr.map((t) => (t.id === theme.id ? theme : t)) : [...arr, theme]
      await writeDoc(THEMES_DOC, next)
      set({ themes: next, synced: doc, dirty: getDoc() !== doc, savedAt: Date.now() })
    } else {
      const list = await readDoc<StageLayout[]>(STAGE_LAYOUTS_DOC, [])
      const layout = docToLayout(doc)
      const arr = Array.isArray(list) ? list : []
      const next = arr.some((t) => t.id === layout.id) ? arr.map((t) => (t.id === layout.id ? layout : t)) : [...arr, layout]
      await writeDoc(STAGE_LAYOUTS_DOC, next)
      set({ stageLayouts: next, synced: doc, dirty: getDoc() !== doc, savedAt: Date.now() })
    }
  } catch (e) {
    pendingSave = null
    toast('Could not save', 'error', String(e))
  } finally {
    set({ saving: false })
    if (get().dirty) scheduleSave()
  }
}
export async function flushSave(): Promise<void> {
  if (get().dirty) await save()
}

/** Something changed the open presentation on disk (another computer, sync, an importer). */
async function onLibraryChanged(ids?: ID[]): Promise<void> {
  const s = get()
  const doc = getDoc()
  if (s.kind !== 'presentation' || !s.docId || !doc || (ids && !ids.includes(s.docId))) return
  const remote = await api.invoke('library.get', { id: s.docId })
  if (get().docId !== s.docId) return
  if (!remote) {
    toast('This presentation was deleted on another computer', 'warning', 'Your copy is still open — any edit saves it back.')
    return
  }
  const r = strip(remote)
  if ((s.synced && sameJson(r, strip(s.synced))) || (pendingSave && sameJson(r, strip(pendingSave))) || sameJson(r, strip(doc))) return
  const h = get().history!
  if (!get().dirty || !s.synced) {
    // No local edits: just follow (kept undoable).
    set({ history: pushHistory(h, remote, 'Update from another computer'), synced: remote, dirty: false })
    fixSelection()
    toast('Updated with changes from another computer', 'info')
    return
  }
  const m = mergePresentation(s.synced, doc, remote)
  if (m.conflicts.length) {
    set({ conflict: { theirs: remote, count: m.conflicts.length } })
    return
  }
  set({ history: pushHistory(h, m.merged, 'Merge changes from another computer'), synced: remote, dirty: true })
  fixSelection()
  scheduleSave()
  toast('Merged changes from another computer', 'info')
}

/** Resolve a both-sides-edited conflict. */
export function resolveConflict(choice: 'mine' | 'theirs'): void {
  const s = get()
  const h = s.history
  if (!s.conflict || !h || !s.synced) return
  if (choice === 'theirs') {
    set({ history: pushHistory(h, s.conflict.theirs, 'Use the other computer\'s version'), synced: s.conflict.theirs, dirty: false, conflict: null })
  } else {
    const m = mergePresentation(s.synced, h.present, s.conflict.theirs)
    set({ history: pushHistory(h, m.merged, 'Merge (kept my edits)'), synced: s.conflict.theirs, dirty: true, conflict: null })
    scheduleSave()
  }
  fixSelection()
}

let wired = false
export function wireEditor(): void {
  if (wired) return
  wired = true
  api.on('library.changed', ({ ids }) => void onLibraryChanged(ids))
  api.on('workspace.docChanged', ({ name }) => { if (name === THEMES_DOC || name === STAGE_LAYOUTS_DOC) void refreshDocs() })
  window.addEventListener('beforeunload', () => void flushSave())
  void refreshDocs()
}

/* ───────────────────────── live ───────────────────────── */

/** Is the slide currently on the outputs out of date compared with what's in the editor? */
export function liveStatus(doc: Presentation | null): { live: boolean; stale: boolean } {
  const ls = useApp.getState().live.slide
  if (!doc || !ls || ls.presentationId !== doc.id) return { live: false, stale: false }
  const cur = doc.slides.find((s) => s.id === ls.slideId)
  return { live: true, stale: !cur || !sameJson(cur, ls.slide) }
}

/** Save, then re-send the live slide so outputs show the edited version. */
export async function updateLive(): Promise<void> {
  await flushSave()
  const doc = getDoc()
  const ls = useApp.getState().live.slide
  if (!doc || !ls || ls.presentationId !== doc.id) return
  const ordered = orderedSlides(doc)
  const sameIndex = ls.index >= 0 && ordered[ls.index]?.id === ls.slideId
  const exists = doc.slides.some((s) => s.id === ls.slideId)
  if (!exists) return void toast('The live slide no longer exists', 'warning', 'Outputs keep showing it until you go to another slide.')
  await api.invoke('live.goToSlide', { presentationId: doc.id, slideId: ls.slideId, ...(sameIndex ? { index: ls.index } : {}), playlistId: ls.playlistId, playlistItemId: ls.playlistItemId })
  toast('Outputs updated', 'success')
}

export { BUILTIN_STAGE_LAYOUTS }
