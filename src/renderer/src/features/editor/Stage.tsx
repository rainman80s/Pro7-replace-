/**
 * The WYSIWYG stage: select / multi-select / marquee / move / resize (8 handles, rotation-aware) / rotate,
 * snapping guides (slide, other elements, region edges + centres), zoom & scroll, in-place text editing,
 * drop media from the bin. Edits are previewed locally while dragging and committed as one undo step.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent } from 'react'
import type { ID, MediaRef, Rect, SlideElement, TextElement } from '@shared/model'
import { SlideView, StillMedia, type Tokens } from '@shared/render/SlideView'
import { RegionGuide } from '@shared/render/LiveCanvas'
import {
  HANDLES, aabb, boundsOf, pointInElement, rectsIntersect, resizeRect, roundRect, scaleRectInto, snapAngle, snapMove, snapResize, snapTargets,
  fitRect, type Guide, type Handle
} from '@shared/editor-geometry'
import { sampleTokens } from '@shared/editor-stagelayouts'
import { resolveSlideWithCanvasTheme } from '@shared/themes'
import { Button, Select } from '@ui/index'
import { useApp } from '../../app/store'
import { TextEditor } from './RichText'
import { addElement, audienceCanvases, setElementText, setFrames, surfaceOf, themeList, useEditor } from './store'
import { customizeVariant } from './actions'
import { mediaElement } from './elements'

type Frames = Record<ID, { frame: Rect; rotation?: number }>
type Drag =
  | { type: 'move'; ids: ID[]; start: [number, number]; frames: Frames; bounds: Rect; moved: boolean; additive: ID | null }
  | { type: 'resize'; ids: ID[]; handle: Handle; start: [number, number]; frames: Frames; bounds: Rect }
  | { type: 'rotate'; id: ID; center: [number, number]; startAngle: number; startRotation: number }
  | { type: 'marquee'; start: [number, number]; base: ID[] }

const MEDIA_MIME = 'application/x-reach-media'

export function Stage({ zoom, setZoom }: { zoom: number | 'fit'; setZoom: (z: number | 'fit') => void }): ReactNode {
  const doc = useEditor((s) => s.history?.present ?? null)
  const slideId = useEditor((s) => s.slideId)
  const canvasId = useEditor((s) => s.canvasId)
  const selection = useEditor((s) => s.selection)
  const editingId = useEditor((s) => s.editingId)
  const kind = useEditor((s) => s.kind)
  const workspace = useApp((s) => s.workspace)
  const canvases = useMemo(() => (workspace?.canvases ?? []).filter((c) => c.kind !== 'stage'), [workspace])
  const surf = useMemo(() => surfaceOf(doc, slideId, canvasId, canvases), [doc, slideId, canvasId, canvases])

  const scroller = useRef<HTMLDivElement>(null)
  const design = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 800, h: 500 })
  const [preview, setPreview] = useState<Frames | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [hint, setHint] = useState<string>('')
  const drag = useRef<Drag | null>(null)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const size = surf?.canvas ? { width: surf.canvas.width, height: surf.canvas.height } : surf?.size ?? { width: 1920, height: 1080 }
  const PAD = 40
  const fitZoom = Math.max(0.02, Math.min((box.w - PAD * 2) / size.width, (box.h - PAD * 2) / size.height))
  const z = zoom === 'fit' ? fitZoom : zoom
  const contentW = Math.max(box.w, size.width * z + PAD * 2)
  const contentH = Math.max(box.h, size.height * z + PAD * 2)
  const left = (contentW - size.width * z) / 2
  const top = (contentH - size.height * z) / 2

  // ⌘/Ctrl + wheel zooms around the cursor.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const cur = zoom === 'fit' ? fitZoom : zoom
      const next = Math.min(4, Math.max(0.05, cur * Math.exp(-e.deltaY * 0.0025)))
      const r = el.getBoundingClientRect()
      const mx = e.clientX - r.left + el.scrollLeft
      const my = e.clientY - r.top + el.scrollTop
      setZoom(next)
      requestAnimationFrame(() => {
        el.scrollLeft = mx * (next / cur) - (e.clientX - r.left)
        el.scrollTop = my * (next / cur) - (e.clientY - r.top)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom, fitZoom, setZoom])

  const tokens: Tokens | undefined = kind === 'stage' ? sampleTokens() : undefined

  if (!doc || !surf) return <div ref={scroller} className="ed-stage-scroller"><div className="empty">Pick a slide on the left.</div></div>

  const elements = surf.elements
  const els = preview ? elements.map((e) => (preview[e.id] ? { ...e, frame: preview[e.id].frame, rotation: preview[e.id].rotation ?? e.rotation } : e)) : elements
  const selected = els.filter((e) => selection.includes(e.id))
  const editable = !surf.inherited

  const toDesign = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = design.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / z, (e.clientY - r.top) / z]
  }
  const framesOf = (ids: ID[]): Frames => Object.fromEntries(elements.filter((e) => ids.includes(e.id)).map((e) => [e.id, { frame: e.frame, rotation: e.rotation }]))
  const targetsFor = (moving: ID[]) => snapTargets(size, elements.filter((e) => !moving.includes(e.id)), surf.regions)
  const thr = 7 / z

  const hitTest = (pt: [number, number]): SlideElement | undefined => {
    for (let i = elements.length - 1; i >= 0; i--) {
      const e = elements[i]
      if (e.hidden || e.locked) continue
      if (pointInElement(pt[0], pt[1], e.frame, e.rotation)) return e
    }
    return undefined
  }

  const onPointerDown = (e: RPointerEvent): void => {
    if (e.button !== 0 || !editable) return
    const target = e.target as HTMLElement
    if (target.closest('.ed-textedit') || target.closest('.ed-overlay-ui')) return
    const pt = toDesign(e)
    const handle = target.dataset.handle as Handle | 'rotate' | undefined
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (editingId) useEditor.setState({ editingId: null })
    if (handle === 'rotate' && selected.length === 1) {
      const el = selected[0]
      const c: [number, number] = [el.frame.x + el.frame.w / 2, el.frame.y + el.frame.h / 2]
      drag.current = { type: 'rotate', id: el.id, center: c, startAngle: Math.atan2(pt[1] - c[1], pt[0] - c[0]), startRotation: el.rotation ?? 0 }
      return
    }
    if (handle) {
      const ids = selection
      drag.current = { type: 'resize', ids, handle: handle as Handle, start: pt, frames: framesOf(ids), bounds: boundsOf(selected.map((s) => aabb(s.frame, s.rotation))) }
      return
    }
    const hit = hitTest(pt)
    if (!hit) {
      const base = e.shiftKey || e.metaKey || e.ctrlKey ? selection : []
      if (!base.length) useEditor.setState({ selection: [] })
      drag.current = { type: 'marquee', start: pt, base }
      return
    }
    let ids = selection
    let additive: ID | null = null
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      ids = selection.includes(hit.id) ? selection.filter((x) => x !== hit.id) : [...selection, hit.id]
    } else if (!selection.includes(hit.id)) ids = [hit.id]
    else additive = hit.id
    useEditor.setState({ selection: ids })
    if (!ids.includes(hit.id)) return
    const sel = elements.filter((x) => ids.includes(x.id) && !x.locked)
    drag.current = { type: 'move', ids: sel.map((x) => x.id), start: pt, frames: framesOf(sel.map((x) => x.id)), bounds: boundsOf(sel.map((s) => aabb(s.frame, s.rotation))), moved: false, additive }
  }

  const onPointerMove = (e: RPointerEvent): void => {
    const d = drag.current
    if (!d) return
    const pt = toDesign(e)
    const snap = !(e.metaKey || e.ctrlKey)
    if (d.type === 'move') {
      let dx = pt[0] - d.start[0]
      let dy = pt[1] - d.start[1]
      if (!d.moved && Math.hypot(dx * z, dy * z) < 3) return
      d.moved = true
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
      let g: Guide[] = []
      if (snap) {
        const s = snapMove({ ...d.bounds, x: d.bounds.x + dx, y: d.bounds.y + dy }, targetsFor(d.ids), thr)
        if (!e.shiftKey || dx) dx += s.dx
        if (!e.shiftKey || dy) dy += s.dy
        g = s.guides
      }
      const out: Frames = {}
      for (const [id, f] of Object.entries(d.frames)) out[id] = { frame: roundRect({ ...f.frame, x: f.frame.x + dx, y: f.frame.y + dy }), rotation: f.rotation }
      setPreview(out)
      setGuides(g)
      setHint(`${Math.round(d.bounds.x + dx)}, ${Math.round(d.bounds.y + dy)}`)
    } else if (d.type === 'resize') {
      const dx = pt[0] - d.start[0]
      const dy = pt[1] - d.start[1]
      const out: Frames = {}
      let g: Guide[] = []
      if (d.ids.length === 1) {
        const id = d.ids[0]
        const f = d.frames[id]
        const el = elements.find((x) => x.id === id)
        const keepAspect = e.shiftKey !== (el?.type === 'image' || el?.type === 'video')
        let r = resizeRect(f.frame, d.handle, dx, dy, { rotation: f.rotation, keepAspect, fromCenter: e.altKey })
        if (snap && !f.rotation && !keepAspect && !e.altKey) {
          const s = snapResize(r, d.handle, targetsFor(d.ids), thr)
          r = s.rect
          g = s.guides
        }
        out[id] = { frame: roundRect(r), rotation: f.rotation }
        setHint(`${Math.round(r.w)} × ${Math.round(r.h)}`)
      } else {
        let nb = resizeRect(d.bounds, d.handle, dx, dy, { keepAspect: e.shiftKey, fromCenter: e.altKey })
        if (snap && !e.shiftKey && !e.altKey) {
          const s = snapResize(nb, d.handle, targetsFor(d.ids), thr)
          nb = s.rect
          g = s.guides
        }
        for (const [id, f] of Object.entries(d.frames)) out[id] = { frame: roundRect(scaleRectInto(f.frame, d.bounds, nb)), rotation: f.rotation }
        setHint(`${Math.round(nb.w)} × ${Math.round(nb.h)}`)
      }
      setPreview(out)
      setGuides(g)
    } else if (d.type === 'rotate') {
      const a = Math.atan2(pt[1] - d.center[1], pt[0] - d.center[0])
      let deg = d.startRotation + ((a - d.startAngle) * 180) / Math.PI
      deg = ((deg % 360) + 540) % 360 - 180
      deg = e.shiftKey ? Math.round(deg / 15) * 15 : snapAngle(deg)
      deg = Math.round(deg * 10) / 10
      const el = elements.find((x) => x.id === d.id)!
      setPreview({ [d.id]: { frame: el.frame, rotation: deg } })
      setHint(`${deg}°`)
    } else if (d.type === 'marquee') {
      const r = { x: Math.min(d.start[0], pt[0]), y: Math.min(d.start[1], pt[1]), w: Math.abs(pt[0] - d.start[0]), h: Math.abs(pt[1] - d.start[1]) }
      setMarquee(r)
      const hits = elements.filter((x) => !x.hidden && !x.locked && rectsIntersect(r, aabb(x.frame, x.rotation))).map((x) => x.id)
      useEditor.setState({ selection: [...new Set([...d.base, ...hits])] })
    }
  }

  const onPointerUp = (): void => {
    const d = drag.current
    drag.current = null
    if (d && preview && (d.type !== 'move' || d.moved)) {
      const label = d.type === 'move' ? 'Move' : d.type === 'resize' ? 'Resize' : 'Rotate'
      setFrames(preview, label)
    } else if (d?.type === 'move' && !d.moved && d.additive) {
      useEditor.setState({ selection: [d.additive] })
    }
    setPreview(null)
    setGuides([])
    setMarquee(null)
    setHint('')
  }

  const onDoubleClick = (e: React.MouseEvent): void => {
    if (!editable) return
    const hit = hitTest(toDesign(e))
    if (hit?.type === 'text') useEditor.setState({ selection: [hit.id], editingId: hit.id })
  }

  const onDrop = (e: React.DragEvent): void => {
    const raw = e.dataTransfer.getData(MEDIA_MIME)
    if (!raw || !editable) return
    e.preventDefault()
    const media = JSON.parse(raw) as MediaRef
    const [x, y] = toDesign(e)
    addElement(mediaElement(media, size, [x, y]), 'Add media')
  }

  const editing = editingId ? (els.find((x) => x.id === editingId && x.type === 'text') as TextElement | undefined) : undefined
  const visible = editing ? els.filter((x) => x.id !== editing.id) : els
  const hs = 10 / z

  // Inherited (canvas tab with no own design): show the main design scaled into the canvas.
  let inheritedView: ReactNode = null
  if (surf.inherited && surf.canvas) {
    const themed = resolveSlideWithCanvasTheme(surf.slide, doc.size, surf.canvas, themeList())
    const src = themed ?? { elements: surf.slide.elements, background: surf.slide.background, size: doc.size }
    const f = fitRect(src.size, { x: 0, y: 0, w: size.width, h: size.height })
    inheritedView = (
      <div style={{ position: 'absolute', left: f.x, top: f.y, width: src.size.width, height: src.size.height, transform: `scale(${f.kx})`, transformOrigin: '0 0' }}>
        <SlideView elements={src.elements} background={src.background} size={src.size} tokens={tokens} />
      </div>
    )
  }

  return (
    <div ref={scroller} className="ed-stage-scroller" onDragOver={(e) => { if (e.dataTransfer.types.includes(MEDIA_MIME)) e.preventDefault() }} onDrop={onDrop}>
      <div style={{ position: 'relative', width: contentW, height: contentH }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDoubleClick={onDoubleClick}>
        <div ref={design} className="ed-design" data-testid="stage" style={{ left, top, width: size.width, height: size.height, transform: `scale(${z})` }}>
          <StillMedia>
            {inheritedView ?? <SlideView elements={visible} background={surf.background} size={size} tokens={tokens} opaque />}
            {editing && <TextEditor key={editing.id} el={editing} onChange={(p) => setElementText(editing.id, p)} />}
          </StillMedia>
          {surf.canvas?.regions.map((r) => <RegionGuide key={r.id} region={r} />)}
          {editable && (
            <svg className="ed-overlay" width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`}>
              {elements.filter((x) => !x.hidden && !selection.includes(x.id) && x.type === 'text' && !(x as TextElement).paragraphs.some((p) => p.runs.some((r) => r.text))).map((x) => (
                <rect key={x.id} x={x.frame.x} y={x.frame.y} width={x.frame.w} height={x.frame.h} transform={x.rotation ? `rotate(${x.rotation} ${x.frame.x + x.frame.w / 2} ${x.frame.y + x.frame.h / 2})` : undefined} className="ed-empty-box" style={{ strokeWidth: 1.5 / z, strokeDasharray: `${6 / z} ${4 / z}` }} />
              ))}
              {selected.map((x) => (
                <rect key={x.id} x={x.frame.x} y={x.frame.y} width={x.frame.w} height={x.frame.h} transform={x.rotation ? `rotate(${x.rotation} ${x.frame.x + x.frame.w / 2} ${x.frame.y + x.frame.h / 2})` : undefined} className={`ed-sel-box ${x.locked ? 'locked' : ''}`} style={{ strokeWidth: 2 / z }} />
              ))}
              {guides.map((g, i) => g.axis === 'x'
                ? <line key={i} x1={g.pos} x2={g.pos} y1={0} y2={size.height} className={`ed-guide ${g.label ? 'region' : ''}`} style={{ strokeWidth: 1.5 / z }} />
                : <line key={i} y1={g.pos} y2={g.pos} x1={0} x2={size.width} className={`ed-guide ${g.label ? 'region' : ''}`} style={{ strokeWidth: 1.5 / z }} />)}
              {marquee && <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} className="ed-marquee" style={{ strokeWidth: 1 / z }} />}
            </svg>
          )}
          {editable && !editing && selected.length > 0 && !selected.some((x) => x.locked) && <Handles els={selected} hs={hs} z={z} />}
          {hint && selected[0] && (() => {
            const b = boundsOf(selected.map((s) => aabb(s.frame, s.rotation)))
            return <div className="ed-hint" style={{ left: b.x + b.w / 2, top: b.y + b.h + 14 / z, transform: `translateX(-50%) scale(${1 / z})` }}>{hint}</div>
          })()}
        </div>
        {surf.inherited && surf.canvas && <InheritedBanner />}
      </div>
    </div>
  )
}

function Handles({ els, hs, z }: { els: SlideElement[]; hs: number; z: number }): ReactNode {
  const single = els.length === 1 ? els[0] : null
  const r = single ? single.frame : boundsOf(els.map((s) => aabb(s.frame, s.rotation)))
  const rot = single?.rotation ?? 0
  const pos: Record<Handle, [number, number]> = {
    nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5]
  }
  const cursorFor = (h: Handle): string => {
    const dirs: Handle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
    const i = (dirs.indexOf(h) + Math.round(rot / 45) + 8) % 8
    return ['ns', 'nesw', 'ew', 'nwse'][i % 4] + '-resize'
  }
  return (
    <div className="ed-handles" style={{ left: r.x, top: r.y, width: r.w, height: r.h, transform: rot ? `rotate(${rot}deg)` : undefined }}>
      {HANDLES.map((h) => (
        <div key={h} data-handle={h} className="ed-handle" style={{ left: `${pos[h][0] * 100}%`, top: `${pos[h][1] * 100}%`, width: hs, height: hs, margin: -hs / 2, borderWidth: 1.5 / z, cursor: cursorFor(h) }} />
      ))}
      {single && <div data-handle="rotate" className="ed-rotate" title="Rotate (Shift = 15° steps)" style={{ left: '50%', top: -28 / z, width: hs * 1.2, height: hs * 1.2, margin: (-hs * 1.2) / 2, borderWidth: 1.5 / z }} />}
    </div>
  )
}

function InheritedBanner(): ReactNode {
  const canvasId = useEditor((s) => s.canvasId)
  const workspace = useApp((s) => s.workspace)
  const canvas = workspace?.canvases.find((c) => c.id === canvasId)
  const [region, setRegion] = useState('')
  if (!canvas) return null
  return (
    <div className="ed-inherit ed-overlay-ui" data-testid="inherited-banner" onPointerDown={(e) => e.stopPropagation()}>
      <div className="ed-inherit-title">Using the main design (scaled)</div>
      <div className="dim">{canvas.name} shows the main slide fitted to {canvas.width}×{canvas.height}. Give this slide its own layout for this screen:</div>
      <div className="row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
        <Button variant="primary" data-testid="customize" onClick={() => customizeVariant({ type: 'fit' })}>Customize for {canvas.name}</Button>
        {canvas.regions.length > 0 && (
          <>
            <Select value={region} onChange={(e) => { setRegion(e.target.value); if (e.target.value) customizeVariant({ type: 'region', regionId: e.target.value }) }} data-testid="place-region">
              <option value="">Place in region…</option>
              {canvas.regions.map((r) => <option key={r.id} value={r.id}>Fit into {r.name}</option>)}
            </Select>
            {canvas.regions.length > 1 && <Button onClick={() => customizeVariant({ type: 'perRegion' })}>One copy per region</Button>}
          </>
        )}
      </div>
    </div>
  )
}

export { MEDIA_MIME, audienceCanvases }
