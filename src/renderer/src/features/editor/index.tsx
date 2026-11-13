/**
 * Edit view: filmstrip | toolbar + screen tabs + stage (or Text / Sections modes) | inspector + layers.
 * The same editor also edits themes (each template = a slide) and stage layouts.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ID, ShapeElement, StageLayout } from '@shared/model'
import { canRedo, canUndo, redoLabel, undoLabel } from '@shared/editor-history'
import { BUILTIN_STAGE_LAYOUTS, STAGE_LAYOUTS_DOC, STAGE_TOKENS } from '@shared/editor-stagelayouts'
import { applyTheme } from '@shared/themes'
import { clone, uid } from '@shared/editor-util'
import { SlideThumb } from '@shared/render/SlideView'
import { Button, Empty, Input, Modal, Select } from '@ui/index'
import { defineFeature } from '../../app/feature'
import { api, readDoc, useApp, writeDoc } from '../../app/store'
import { ArrangeMode } from './ArrangeMode'
import { CanvasTabs } from './CanvasTabs'
import { Filmstrip } from './Filmstrip'
import { Inspector } from './Inspector'
import { Layers } from './Layers'
import { MediaPicker, pickMedia } from './media-pick'
import { Stage } from './Stage'
import { TextMode } from './TextMode'
import { ThemesPanel } from './ThemesPanel'
import { liveElement, mediaElement, shapeElement, textElement, tokenElement } from './elements'
import { nudge } from './actions'
import {
  activeText, addElement, commit, copySelection, copySlides, currentSurface, deleteSelection, deleteSlides, duplicateSelection, duplicateSlides, flushSave,
  getDoc, layoutList, liveStatus, openDoc, paste, redo, refreshDocs, reorder, resolveConflict, themeList, undo, updateLive, useDoc, useEditor, wireEditor
} from './store'
import './editor.css'

function EditorView(): ReactNode {
  const selectedPresentationId = useApp((s) => s.selectedPresentationId)
  const library = useApp((s) => s.library)
  const docId = useEditor((s) => s.docId)
  const kind = useEditor((s) => s.kind)
  const mode = useEditor((s) => s.mode)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [showAll, setShowAll] = useState(false)
  const [picker, setPicker] = useState(false)
  const [themes, setThemes] = useState(false)

  useEffect(() => { wireEditor() }, [])
  // Follow the presentation selected elsewhere (Show screen, library).
  useEffect(() => {
    const id = selectedPresentationId ?? (docId ? null : library[0]?.id)
    if (id && (id !== useEditor.getState().docId || useEditor.getState().kind !== 'presentation')) void openDoc('presentation', id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPresentationId])
  useEffect(() => () => void flushSave(), [])
  useKeyboard()

  if (!docId) {
    return (
      <div className="ed-root empty-root">
        <Empty title="Nothing open">
          <Button variant="primary" onClick={() => setPicker(true)}>Open a presentation…</Button>
        </Empty>
        {picker && <OpenDialog onClose={() => setPicker(false)} />}
      </div>
    )
  }
  return (
    <div className="ed-root" data-testid="editor">
      <aside className="ed-left">
        <DocHeader onOpen={() => setPicker(true)} />
        <Filmstrip />
      </aside>
      <section className="ed-center">
        <Toolbar zoom={zoom} setZoom={setZoom} onThemes={() => setThemes(true)} />
        <Conflict />
        {mode === 'text' && kind === 'presentation' ? <TextMode />
          : mode === 'arrange' && kind === 'presentation' ? <ArrangeMode />
            : (
              <>
                {kind !== 'stage' && <CanvasTabs showAll={showAll} setShowAll={setShowAll} />}
                <Stage zoom={zoom} setZoom={setZoom} />
              </>
            )}
      </section>
      <aside className="ed-right">
        <Inspector />
        <details className="ed-layers-wrap" open>
          <summary>Layers</summary>
          <Layers />
        </details>
      </aside>
      {picker && <OpenDialog onClose={() => setPicker(false)} />}
      {themes && <ThemesPanel onClose={() => setThemes(false)} />}
      <MediaPicker />
    </div>
  )
}

function DocHeader({ onOpen }: { onOpen: () => void }): ReactNode {
  const doc = useDoc()
  const kind = useEditor((s) => s.kind)
  const workspace = useApp((s) => s.workspace)
  if (!doc) return null
  const label = kind === 'theme' ? 'Theme' : kind === 'stage' ? 'Stage layout' : 'Presentation'
  const stageCanvases = (workspace?.canvases ?? []).filter((c) => c.kind === 'stage')
  return (
    <div className="ed-doc-head">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="ed-kicker">{label}</span>
        <Button size="sm" variant="ghost" onClick={onOpen} data-testid="open-doc">Open…</Button>
      </div>
      <input className="ed-title" value={doc.title} data-testid="doc-title" onChange={(e) => commit((d) => ({ ...d, title: e.target.value }), 'Rename', 'title')} />
      {kind !== 'presentation' && (
        <Button size="sm" variant="ghost" onClick={() => { const id = useApp.getState().selectedPresentationId; if (id) void openDoc('presentation', id) }}>← Back to presentation</Button>
      )}
      {kind === 'stage' && stageCanvases.map((c) => (
        <label key={c.id} className="row dim" style={{ gap: 6 }}>
          <input type="checkbox" checked={c.stageLayoutId === doc.id} onChange={(e) => void api.invoke('workspace.update', { canvases: workspace!.canvases.map((x) => (x.id === c.id ? { ...x, stageLayoutId: e.target.checked ? doc.id : undefined } : x)) })} />
          Show on {c.name}
        </label>
      ))}
    </div>
  )
}

function Toolbar({ zoom, setZoom, onThemes }: { zoom: number | 'fit'; setZoom: (z: number | 'fit') => void; onThemes: () => void }): ReactNode {
  const h = useEditor((s) => s.history)
  const kind = useEditor((s) => s.kind)
  const mode = useEditor((s) => s.mode)
  const dirty = useEditor((s) => s.dirty)
  const saving = useEditor((s) => s.saving)
  const conflict = useEditor((s) => s.conflict)
  useApp((s) => s.live.slide)
  const doc = useDoc()
  const surf = currentSurface()
  const live = liveStatus(doc)
  const [shape, setShape] = useState('')
  const timers = useApp((s) => s.live.timers)
  const size = surf?.size ?? doc?.size ?? { width: 1920, height: 1080 }
  const canAdd = !!surf && !surf.inherited && mode === 'design'
  const addMedia = (kinds: ('image' | 'video')[]): void => void pickMedia(kinds).then((m) => { if (m) addElement(mediaElement(m, size), 'Add media') })
  const z = zoom === 'fit' ? null : zoom
  return (
    <div className="ed-toolbar" data-testid="toolbar">
      {kind === 'presentation' && (
        <div className="ed-seg ed-modes">
          <button className={mode === 'design' ? 'on' : ''} onClick={() => useEditor.setState({ mode: 'design' })} data-testid="mode-design">Design</button>
          <button className={mode === 'text' ? 'on' : ''} onClick={() => useEditor.setState({ mode: 'text', editingId: null })} data-testid="mode-text">Text</button>
          <button className={mode === 'arrange' ? 'on' : ''} onClick={() => useEditor.setState({ mode: 'arrange', editingId: null })} data-testid="mode-arrange">Sections</button>
        </div>
      )}
      {mode === 'design' || kind !== 'presentation' ? (
        <div className="ed-insert">
          {kind === 'stage' ? (
            <Select value="" disabled={!canAdd} onChange={(e) => { const t = STAGE_TOKENS.find((x) => x.token === e.target.value) ?? { token: e.target.value, label: e.target.value }; if (e.target.value) addElement(tokenElement(size, t.token, t.label), 'Add live text') }} data-testid="add-token">
              <option value="">+ Live text…</option>
              {STAGE_TOKENS.map((t) => <option key={t.token} value={t.token}>{t.label}</option>)}
              {timers.map((t) => <option key={t.id} value={`timer:${t.name}`}>Timer: {t.name}</option>)}
            </Select>
          ) : null}
          <Button size="sm" disabled={!canAdd} onClick={() => addElement(textElement(size), 'Add text')} data-testid="add-text" title="Add a text box">T&nbsp;Text</Button>
          <Select value={shape} disabled={!canAdd} onChange={(e) => { if (e.target.value) addElement(shapeElement(size, e.target.value as ShapeElement['shape']), 'Add shape'); setShape('') }} data-testid="add-shape" style={{ height: 24, padding: '0 6px' }}>
            <option value="">▭ Shape</option>
            <option value="rect">Rectangle</option><option value="ellipse">Ellipse</option><option value="line">Line</option><option value="polygon">Triangle</option>
          </Select>
          <Button size="sm" disabled={!canAdd} onClick={() => addMedia(['image'])}>Image</Button>
          <Button size="sm" disabled={!canAdd} onClick={() => addMedia(['video'])}>Video</Button>
          <Button size="sm" disabled={!canAdd} onClick={() => addElement(liveElement(size), 'Add live input')} title="Camera, NDI or web page placeholder">Live</Button>
        </div>
      ) : <div />}
      <div className="grow" />
      <div className="row" style={{ gap: 2 }}>
        <Button size="sm" variant="ghost" disabled={!h || !canUndo(h)} onClick={undo} title={h && canUndo(h) ? `Undo ${undoLabel(h)} (⌘Z)` : 'Undo'} data-testid="undo">↶</Button>
        <Button size="sm" variant="ghost" disabled={!h || !canRedo(h)} onClick={redo} title={h && canRedo(h) ? `Redo ${redoLabel(h)} (⇧⌘Z)` : 'Redo'} data-testid="redo">↷</Button>
      </div>
      {mode === 'design' || kind !== 'presentation' ? (
        <div className="row ed-zoom" style={{ gap: 2 }}>
          <Button size="sm" variant="ghost" onClick={() => setZoom(Math.max(0.05, (z ?? 0.4) / 1.25))}>−</Button>
          <Button size="sm" variant={zoom === 'fit' ? 'default' : 'ghost'} onClick={() => setZoom('fit')} title="Fit (⌘0)">{z ? `${Math.round(z * 100)}%` : 'Fit'}</Button>
          <Button size="sm" variant="ghost" onClick={() => setZoom(Math.min(4, (z ?? 0.4) * 1.25))}>+</Button>
        </div>
      ) : null}
      {kind !== 'stage' && <Button size="sm" onClick={onThemes} data-testid="themes">Themes</Button>}
      <span className={`ed-status ${conflict ? 'warn' : ''}`} data-testid="save-status">{conflict ? 'Needs a decision' : saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'}</span>
      {live.live && <Button size="sm" variant={live.stale ? 'live' : 'ghost'} disabled={!live.stale} onClick={() => void updateLive()} data-testid="update-live" title="Outputs keep showing the old version until you update them">{live.stale ? 'Update live' : 'Live ✓'}</Button>}
    </div>
  )
}

function Conflict(): ReactNode {
  const c = useEditor((s) => s.conflict)
  if (!c) return null
  return (
    <div className="ed-conflict">
      <span>Someone changed this presentation on another computer while you were editing, and {c.count} slide{c.count > 1 ? 's were' : ' was'} edited in both places.</span>
      <div className="grow" />
      <Button size="sm" variant="primary" onClick={() => resolveConflict('mine')}>Keep my edits (merge the rest)</Button>
      <Button size="sm" onClick={() => resolveConflict('theirs')}>Use their version</Button>
    </div>
  )
}

/* ───────────── open / new dialog: presentations, themes, stage layouts ───────────── */

function OpenDialog({ onClose }: { onClose: () => void }): ReactNode {
  const library = useApp((s) => s.library)
  const workspace = useApp((s) => s.workspace)
  const [tab, setTab] = useState<'presentation' | 'theme' | 'stage'>(useEditor.getState().kind)
  const [q, setQ] = useState('')
  useEditor((s) => s.themes)
  useEditor((s) => s.stageLayouts)
  const open = async (k: 'presentation' | 'theme' | 'stage', id: ID): Promise<void> => {
    if (k === 'presentation') useApp.getState().select({ selectedPresentationId: id })
    else await openDoc(k, id)
    onClose()
  }
  const newPresentation = async (): Promise<void> => {
    let p = await api.invoke('library.create', { title: q.trim() || 'Untitled', kind: 'generic' })
    const t = themeList().find((x) => x.id === workspace?.defaultThemeId)
    if (t) p = await api.invoke('library.save', { presentation: applyTheme(p, t) })
    await open('presentation', p.id)
  }
  const newLayout = async (from: StageLayout): Promise<void> => {
    const list = await readDoc<StageLayout[]>(STAGE_LAYOUTS_DOC, [])
    const l: StageLayout = { ...clone(from), id: uid(), name: `${from.name} copy` }
    await writeDoc(STAGE_LAYOUTS_DOC, [...(Array.isArray(list) ? list : []), l])
    await refreshDocs()
    await open('stage', l.id)
  }
  const needle = q.trim().toLowerCase()
  const pres = useMemo(() => library.filter((p) => !needle || p.title.toLowerCase().includes(needle) || p.excerpt?.toLowerCase().includes(needle)), [library, needle])
  return (
    <Modal title="Open" onClose={onClose} width={720}>
      <div className="ed-seg" style={{ marginBottom: 10 }}>
        <button className={tab === 'presentation' ? 'on' : ''} onClick={() => setTab('presentation')}>Presentations</button>
        <button className={tab === 'theme' ? 'on' : ''} onClick={() => setTab('theme')}>Themes</button>
        <button className={tab === 'stage' ? 'on' : ''} onClick={() => setTab('stage')}>Stage layouts</button>
      </div>
      {tab === 'presentation' && (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            <Input autoFocus className="grow" placeholder="Search or type a title for a new one" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button variant="primary" onClick={() => void newPresentation()}>New presentation</Button>
          </div>
          <div className="ed-open-list scroll">
            {pres.map((p) => (
              <button key={p.id} className="ed-open-item" onClick={() => void open('presentation', p.id)}>
                <b>{p.title}</b><span className="dim">{p.slideCount} slides{p.artist ? ` · ${p.artist}` : ''}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {tab === 'theme' && (
        <div className="ed-pick-grid">
          {themeList().map((t) => (
            <button key={t.id} className="ed-pick-item" onClick={() => void open('theme', t.id)}>
              <SlideThumb elements={t.templates[0]?.slide.elements ?? []} background={t.templates[0]?.slide.background} size={t.size} />
              <span>{t.name}</span>
            </button>
          ))}
        </div>
      )}
      {tab === 'stage' && (
        <>
          <div className="ed-pick-grid">
            {layoutList().map((l) => {
              const builtin = BUILTIN_STAGE_LAYOUTS.some((b) => b.id === l.id)
              return (
                <div key={l.id} className="ed-pick-item">
                  <button onClick={() => void (builtin ? newLayout(l) : open('stage', l.id))} style={{ all: 'unset', cursor: 'pointer' }}>
                    <SlideThumb elements={l.slide.elements} background={l.slide.background} size={l.size} tokens={Object.fromEntries(STAGE_TOKENS.map((t) => [t.token, t.sample]))} />
                    <span>{l.name}{builtin ? ' (built-in — opens a copy)' : ''}</span>
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </Modal>
  )
}

/* ───────────── keyboard ───────────── */

function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (useApp.getState().view !== 'edit') return
      const s = useEditor.getState()
      const t = e.target as HTMLElement
      const mod = e.metaKey || e.ctrlKey
      const inField = !!t.closest('input, textarea, select, [contenteditable]')
      if (s.editingId) {
        if (e.key === 'Escape') { e.preventDefault(); useEditor.setState({ editingId: null }); return }
        if (mod && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
          e.preventDefault()
          const surf = currentSurface()
          const el = surf?.elements.find((x) => x.id === s.editingId)
          if (el?.type !== 'text') return
          const st = { ...el.style, ...(s.textSel?.style ?? {}) }
          const k = e.key.toLowerCase()
          const patch = k === 'b' ? { fontWeight: Number(st.fontWeight ?? 400) >= 700 ? 400 : 700 } : k === 'i' ? { italic: st.italic ? undefined : true } : { underline: st.underline ? undefined : true }
          activeText.current?.applyStyle(patch)
          return
        }
        if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); useEditor.setState({ editingId: null }); if (e.shiftKey) redo(); else undo(); return }
        return
      }
      if (mod && e.key.toLowerCase() === 'z' && !inField) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (mod && e.key.toLowerCase() === 'y' && !inField) { e.preventDefault(); redo(); return }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void flushSave(); return }
      if (inField || s.mode !== 'design' && s.kind === 'presentation') return
      const hasSel = s.selection.length > 0
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); useEditor.setState({ selection: currentSurface()?.elements.filter((x) => !x.locked && !x.hidden).map((x) => x.id) ?? [] }); return }
      if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); if (hasSel) copySelection(); else copySlides(); return }
      if (mod && e.key.toLowerCase() === 'x') { e.preventDefault(); if (hasSel) copySelection(true); else { copySlides(); deleteSlides() } return }
      if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); paste(); return }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); if (hasSel) duplicateSelection(); else duplicateSlides(); return }
      if (mod && e.key === '0') { e.preventDefault(); return }
      if (mod && e.key === ']') { e.preventDefault(); reorder(s.selection, e.altKey ? 'front' : 'forward'); return }
      if (mod && e.key === '[') { e.preventDefault(); reorder(s.selection, e.altKey ? 'back' : 'backward'); return }
      if (e.key === 'Escape') { useEditor.setState({ selection: [] }); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && hasSel) { e.preventDefault(); deleteSelection(); return }
      if (e.key === 'Enter' && s.selection.length === 1) {
        const el = currentSurface()?.elements.find((x) => x.id === s.selection[0])
        if (el?.type === 'text' && !currentSurface()?.inherited) { e.preventDefault(); useEditor.setState({ editingId: el.id }) }
        return
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
      if (arrows[e.key]) {
        e.preventDefault()
        const k = e.shiftKey ? 10 : 1
        if (hasSel) nudge(arrows[e.key][0] * k, arrows[e.key][1] * k)
        else {
          const doc = getDoc()
          const i = doc?.slides.findIndex((x) => x.id === s.slideId) ?? -1
          const next = doc?.slides[i + (arrows[e.key][0] + arrows[e.key][1] > 0 ? 1 : -1)]
          if (next) useEditor.setState({ slideId: next.id, slideIds: [next.id], selection: [] })
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export default defineFeature({
  id: 'editor',
  views: [{ id: 'edit', title: 'Edit', order: 20, component: EditorView, shortcut: '⌘2' }]
})

