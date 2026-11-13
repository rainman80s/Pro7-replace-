import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import type { Canvas, LayerId, Rect, Region, StageLayout } from '@shared/model'
import { LAYER_ORDER } from '@shared/model'
import { CANVAS_PRESETS, aspectLabel, canvasFromPreset, snapRect, stackedCanvas, type CanvasPreset } from '@shared/outputs'
import { Button, Field, Input, Modal, Panel, Select, toast } from '@ui/index'
import { readDoc } from '../../app/store'
import { newLocalId, saveCanvases, useCanvases, useDisplays } from './state'

export const LAYER_LABELS: Record<LayerId, { name: string; hint: string }> = {
  background: { name: 'Backgrounds', hint: 'Background images and motion loops' },
  video: { name: 'Videos', hint: 'Videos played from the media bin' },
  slide: { name: 'Slides', hint: 'Lyrics, sermon notes, scripture' },
  announcement: { name: 'Announcements', hint: 'The announcement loop' },
  props: { name: 'Props', hint: 'Logos and graphics you turn on and off' },
  message: { name: 'Messages', hint: 'Messages like “Parents of #12…”' },
  mask: { name: 'Mask', hint: 'An overlay that shapes the picture' }
}

const LAYER_PRESETS: { name: string; layers: Canvas['layers'] }[] = [
  { name: 'Everything', layers: undefined },
  { name: 'Lyrics only (stream / lower thirds)', layers: { background: false, video: false, announcement: false } },
  { name: 'Announcements only (lobby)', layers: { slide: false, video: false, message: false, props: false, background: false } },
  { name: 'No videos', layers: { video: false } }
]

const COLORS = ['#3886CE', '#E6A20F', '#4fa88b', '#d8523f', '#9b6bd1', '#e0739c', '#6f6e6a']

export function CanvasEditor(): ReactNode {
  const canvases = useCanvases()
  const { selectedCanvasId, select } = useDisplays()
  const [adding, setAdding] = useState(false)
  const canvas = canvases.find((c) => c.id === selectedCanvasId) ?? canvases[0]
  const update = (next: Canvas): void => void saveCanvases(canvases.map((c) => (c.id === next.id ? next : c)))
  const remove = (c: Canvas): void => {
    if (canvases.length <= 1) return toast('You need at least one screen', 'warning')
    if (!confirm(`Delete “${c.name}”? Outputs showing it will go dark until you pick something else.`)) return
    void saveCanvases(canvases.filter((x) => x.id !== c.id))
    select({ selectedCanvasId: null })
  }
  const addLivestream = (): void => {
    const preset = CANVAS_PRESETS.find((p) => p.id === 'livestream')!
    const c = canvasFromPreset(preset, newLocalId(), newLocalId, preset.name, COLORS[canvases.length % COLORS.length])
    void saveCanvases([...canvases, c])
    select({ selectedCanvasId: c.id })
    toast('Livestream screen added', 'success', 'Now send it out: Where things show → NDI, a DeckLink port (fill + key) or the OBS browser source.')
  }
  const duplicate = (c: Canvas): void => {
    const copy: Canvas = { ...structuredClone(c), id: newLocalId(), name: `${c.name} copy`, regions: c.regions.map((r) => ({ ...r, id: newLocalId() })) }
    void saveCanvases([...canvases, copy])
    select({ selectedCanvasId: copy.id })
  }
  return (
    <div className="dsp-canvas-editor">
      <Panel title="Screens" className="dsp-canvas-list" actions={<><Button size="sm" onClick={addLivestream} data-add-livestream title="1920×1080 lyrics lower third over transparent, for the stream">+ Livestream</Button><Button size="sm" variant="primary" onClick={() => setAdding(true)}>+ New screen</Button></>}>
        <div className="col" style={{ padding: 8, gap: 4 }}>
          {canvases.map((c) => (
            <button key={c.id} className={`dsp-canvas-item ${c.id === canvas?.id ? 'on' : ''}`} onClick={() => select({ selectedCanvasId: c.id })} data-canvas={c.id}>
              <span className="dsp-swatch" style={{ background: c.color ?? '#3886CE' }} />
              <span className="grow">
                <strong>{c.name}</strong>
                <span className="dim"> · {c.kind === 'stage' ? 'Stage' : 'Audience'} · {c.width}×{c.height}{c.regions.length ? ` · ${c.regions.length} regions` : ''}</span>
              </span>
            </button>
          ))}
          <p className="dim dsp-help">A <b>screen</b> is one picture you design for. Split it into <b>regions</b> when several physical displays show parts of it (e.g. a stacked LED wall).</p>
        </div>
      </Panel>
      {canvas && <CanvasDetail key={canvas.id} canvas={canvas} onChange={update} onDelete={() => remove(canvas)} onDuplicate={() => duplicate(canvas)} />}
      {adding && <AddCanvasModal onClose={() => setAdding(false)} onAdd={(c) => { void saveCanvases([...canvases, c]); select({ selectedCanvasId: c.id }); setAdding(false) }} existing={canvases} />}
    </div>
  )
}

function NumberInput({ value, onCommit, min = 0, max = 16384, ...p }: { value: number; onCommit: (n: number) => void; min?: number; max?: number; 'aria-label'?: string; style?: React.CSSProperties }): ReactNode {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  const commit = (): void => {
    const n = Math.round(Number(v))
    if (Number.isFinite(n) && n >= min && n <= max) { if (n !== value) onCommit(n) } else setV(String(value))
  }
  return <Input {...p} type="number" value={v} min={min} max={max} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit() }} />
}

function CanvasDetail({ canvas, onChange, onDelete, onDuplicate }: { canvas: Canvas; onChange: (c: Canvas) => void; onDelete: () => void; onDuplicate: () => void }): ReactNode {
  const [name, setName] = useState(canvas.name)
  const [layouts, setLayouts] = useState<StageLayout[]>([])
  useEffect(() => setName(canvas.name), [canvas.name])
  useEffect(() => { if (canvas.kind === 'stage') void readDoc<StageLayout[]>('stageLayouts', []).then(setLayouts) }, [canvas.kind])
  const resize = (width: number, height: number): void => {
    // Keep regions inside the new size.
    const regions = canvas.regions.map((r) => ({ ...r, rect: snapRect(r.rect, { width, height }, [], 0) }))
    onChange({ ...canvas, width, height, regions })
  }
  const layerOn = (l: LayerId): boolean => canvas.layers?.[l] !== false
  const setLayer = (l: LayerId, on: boolean): void => {
    const layers = { ...(canvas.layers ?? {}) }
    if (on) delete layers[l]
    else layers[l] = false
    onChange({ ...canvas, layers: Object.keys(layers).length ? layers : undefined })
  }
  return (
    <div className="dsp-canvas-detail col">
      <Panel title="Screen" actions={<><Button size="sm" variant="ghost" onClick={onDuplicate}>Duplicate</Button><Button size="sm" variant="ghost" onClick={onDelete}>Delete…</Button></>}>
        <div className="dsp-form">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== canvas.name && onChange({ ...canvas, name: name.trim() })} aria-label="Screen name" /></Field>
          <Field label="Used for">
            <Select value={canvas.kind} onChange={(e) => onChange({ ...canvas, kind: e.target.value as Canvas['kind'] })}>
              <option value="audience">Audience (what people in the room see)</option>
              <option value="stage">Stage (confidence monitor)</option>
            </Select>
          </Field>
          <Field label="Width (px)"><NumberInput value={canvas.width} min={16} onCommit={(w) => resize(w, canvas.height)} aria-label="Canvas width" /></Field>
          <Field label="Height (px)"><NumberInput value={canvas.height} min={16} onCommit={(h) => resize(canvas.width, h)} aria-label="Canvas height" /></Field>
          <Field label="Shape"><div className="dsp-readout">{aspectLabel(canvas.width, canvas.height)}</div></Field>
          <Field label="Colour">
            <div className="row" style={{ gap: 4 }}>
              {COLORS.map((c) => <button key={c} className={`dsp-swatch big ${canvas.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange({ ...canvas, color: c })} aria-label={`Colour ${c}`} />)}
            </div>
          </Field>
          {canvas.kind === 'stage' && (
            <Field label="Stage layout" hint={layouts.length ? undefined : 'No custom layouts yet — the built-in confidence monitor is used.'}>
              <Select value={canvas.stageLayoutId ?? ''} onChange={(e) => onChange({ ...canvas, stageLayoutId: e.target.value || undefined })}>
                <option value="">Built-in (current, next, clock, timers)</option>
                {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
          )}
        </div>
        {canvas.kind === 'audience' && (
          <div className="dsp-layers">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="dsp-sub">What this screen shows</span>
              <Select style={{ width: 'auto' }} value="" onChange={(e) => { const p = LAYER_PRESETS[Number(e.target.value)]; if (p) onChange({ ...canvas, layers: p.layers ? { ...p.layers } : undefined }) }} aria-label="Layer preset">
                <option value="">Quick choice…</option>
                {LAYER_PRESETS.map((p, i) => <option key={p.name} value={i}>{p.name}</option>)}
              </Select>
            </div>
            <div className="dsp-layer-grid">
              {LAYER_ORDER.map((l) => (
                <label key={l} className={`dsp-layer ${layerOn(l) ? 'on' : ''}`} title={LAYER_LABELS[l].hint}>
                  <input type="checkbox" checked={layerOn(l)} onChange={(e) => setLayer(l, e.target.checked)} data-layer={l} />
                  <span>{LAYER_LABELS[l].name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </Panel>
      <RegionEditor canvas={canvas} onChange={onChange} />
    </div>
  )
}

/* ───────────────────────── regions: draw / drag / resize with snapping ───────────────────────── */

type Drag = { kind: 'move' | 'resize' | 'draw'; id: string; handle?: string; start: { x: number; y: number }; orig: Rect }

export function RegionEditor({ canvas, onChange }: { canvas: Canvas; onChange: (c: Canvas) => void }): ReactNode {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(600)
  const [sel, setSel] = useState<string | null>(canvas.regions[0]?.id ?? null)
  const [draft, setDraft] = useState<Region[] | null>(null)
  const drag = useRef<Drag | null>(null)
  const regions = draft ?? canvas.regions
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const maxH = 360
  const k = Math.min(w / canvas.width, maxH / canvas.height)
  const toCanvas = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = box.current!.querySelector('.dsp-stage')!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k }
  }
  const tol = 12 / k
  const onDown = (e: RPointerEvent, kind: Drag['kind'], region?: Region, handle?: string): void => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const p = toCanvas(e)
    if (kind === 'draw') {
      const id = newLocalId()
      const rect = { x: Math.round(p.x), y: Math.round(p.y), w: 16, h: 16 }
      setDraft([...canvas.regions, { id, name: nextRegionName(canvas.regions), rect }])
      drag.current = { kind, id, start: p, orig: rect }
      setSel(id)
    } else if (region) {
      drag.current = { kind, id: region.id, handle, start: p, orig: { ...region.rect } }
      setSel(region.id)
      setDraft(canvas.regions)
    }
  }
  const onMove = (e: RPointerEvent): void => {
    const d = drag.current
    if (!d) return
    const p = toCanvas(e)
    const dx = p.x - d.start.x
    const dy = p.y - d.start.y
    const others = (draft ?? canvas.regions).filter((r) => r.id !== d.id).map((r) => r.rect)
    let rect: Rect
    if (d.kind === 'move') rect = snapRect({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy }, canvas, others, e.altKey ? 0 : tol, 'move')
    else if (d.kind === 'draw') {
      const x = Math.min(d.start.x, p.x), y = Math.min(d.start.y, p.y)
      rect = snapRect({ x, y, w: Math.abs(dx), h: Math.abs(dy) }, canvas, others, e.altKey ? 0 : tol, 'resize')
    } else {
      let { x, y, w: rw, h: rh } = d.orig
      const hd = d.handle ?? 'se'
      if (hd.includes('e')) rw = d.orig.w + dx
      if (hd.includes('s')) rh = d.orig.h + dy
      if (hd.includes('w')) { x = d.orig.x + dx; rw = d.orig.w - dx }
      if (hd.includes('n')) { y = d.orig.y + dy; rh = d.orig.h - dy }
      rect = snapRect({ x, y, w: Math.max(16, rw), h: Math.max(16, rh) }, canvas, others, e.altKey ? 0 : tol, 'resize')
    }
    setDraft((cur) => (cur ?? canvas.regions).map((r) => (r.id === d.id ? { ...r, rect } : r)))
  }
  const onUp = (): void => {
    const d = drag.current
    drag.current = null
    if (!d || !draft) return
    const final = draft.filter((r) => !(d.kind === 'draw' && r.id === d.id && (r.rect.w < 32 || r.rect.h < 32)))
    setDraft(null)
    onChange({ ...canvas, regions: final })
  }
  const region = regions.find((r) => r.id === sel)
  const setRegion = (r: Region): void => onChange({ ...canvas, regions: canvas.regions.map((x) => (x.id === r.id ? r : x)) })
  const split = (cols: number, rows: number): void => {
    const out: Region[] = []
    const names = cols === 1 && rows === 2 ? ['Top', 'Bottom'] : cols === 2 && rows === 1 ? ['Left', 'Right'] : cols === 3 && rows === 1 ? ['Left', 'Centre', 'Right'] : null
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x0 = Math.round((canvas.width * c) / cols), x1 = Math.round((canvas.width * (c + 1)) / cols)
      const y0 = Math.round((canvas.height * r) / rows), y1 = Math.round((canvas.height * (r + 1)) / rows)
      out.push({ id: newLocalId(), name: names?.[r * cols + c] ?? `Part ${r * cols + c + 1}`, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } })
    }
    onChange({ ...canvas, regions: out })
    setSel(out[0].id)
  }
  return (
    <Panel title="Regions" actions={
      <div className="row" style={{ gap: 4 }}>
        <span className="dim" style={{ fontSize: 12 }}>Quick split:</span>
        <Button size="sm" onClick={() => split(1, 2)}>Top / bottom</Button>
        <Button size="sm" onClick={() => split(2, 1)}>Left / right</Button>
        <Button size="sm" onClick={() => split(3, 1)}>Three across</Button>
        {canvas.regions.length > 0 && <Button size="sm" variant="ghost" onClick={() => { if (confirm('Remove all regions from this screen?')) onChange({ ...canvas, regions: [] }) }}>Clear</Button>}
      </div>
    }>
      <div className="dsp-region-wrap" ref={box}>
        <div className="dsp-stage" style={{ width: canvas.width * k, height: canvas.height * k }} onPointerDown={(e) => onDown(e, 'draw')} onPointerMove={onMove} onPointerUp={onUp} data-region-stage>
          <div className="dsp-stage-label">{canvas.width}×{canvas.height}</div>
          {regions.map((r, i) => (
            <div key={r.id} className={`dsp-region ${r.id === sel ? 'on' : ''}`} data-region={r.name}
              style={{ left: r.rect.x * k, top: r.rect.y * k, width: r.rect.w * k, height: r.rect.h * k, ['--rc' as string]: COLORS[i % COLORS.length] }}
              onPointerDown={(e) => onDown(e, 'move', r)}>
              <span className="dsp-region-name">{r.name}</span>
              <span className="dsp-region-size">{r.rect.w}×{r.rect.h}</span>
              {r.id === sel && ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map((h) => <span key={h} className={`dsp-handle ${h}`} onPointerDown={(e) => onDown(e, 'resize', r, h)} />)}
            </div>
          ))}
          {!regions.length && <div className="dsp-stage-empty">Drag here to draw a region, or use a quick split.</div>}
        </div>
      </div>
      {region && !draft && (
        <div className="dsp-form dsp-region-fields">
          <Field label="Region name"><RegionName region={region} onCommit={(name) => setRegion({ ...region, name })} /></Field>
          <Field label="X"><NumberInput value={region.rect.x} max={canvas.width - 16} onCommit={(x) => setRegion({ ...region, rect: snapRect({ ...region.rect, x }, canvas, [], 0) })} aria-label="Region x" /></Field>
          <Field label="Y"><NumberInput value={region.rect.y} max={canvas.height - 16} onCommit={(y) => setRegion({ ...region, rect: snapRect({ ...region.rect, y }, canvas, [], 0) })} aria-label="Region y" /></Field>
          <Field label="Width"><NumberInput value={region.rect.w} min={16} max={canvas.width} onCommit={(w2) => setRegion({ ...region, rect: snapRect({ ...region.rect, w: w2 }, canvas, [], 0, 'resize') })} aria-label="Region width" /></Field>
          <Field label="Height"><NumberInput value={region.rect.h} min={16} max={canvas.height} onCommit={(h2) => setRegion({ ...region, rect: snapRect({ ...region.rect, h: h2 }, canvas, [], 0, 'resize') })} aria-label="Region height" /></Field>
          <Field label="Shape"><div className="dsp-readout">{aspectLabel(region.rect.w, region.rect.h)}</div></Field>
          <Field label=" "><Button size="sm" variant="ghost" onClick={() => { onChange({ ...canvas, regions: canvas.regions.filter((r) => r.id !== region.id) }); setSel(null) }}>Remove region</Button></Field>
        </div>
      )}
      <p className="dim dsp-help" style={{ padding: '0 12px 12px' }}>Drag to move, use the handles to resize. Edges snap to the screen and to other regions (hold Alt for free movement). The slide editor shows these regions as guides.</p>
    </Panel>
  )
}

function RegionName({ region, onCommit }: { region: Region; onCommit: (n: string) => void }): ReactNode {
  const [v, setV] = useState(region.name)
  useEffect(() => setV(region.name), [region.name])
  return <Input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() && v !== region.name && onCommit(v.trim())} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} aria-label="Region name" />
}

function nextRegionName(rs: Region[]): string {
  for (let i = rs.length + 1; ; i++) if (!rs.some((r) => r.name === `Region ${i}`)) return `Region ${i}`
}

/* ───────────────────────── new screen: presets + stacked LED wizard ───────────────────────── */

function AddCanvasModal({ onClose, onAdd, existing }: { onClose: () => void; onAdd: (c: Canvas) => void; existing: Canvas[] }): ReactNode {
  const [preset, setPreset] = useState<CanvasPreset>(CANVAS_PRESETS[0])
  const [name, setName] = useState('')
  const [panels, setPanels] = useState([{ name: 'LED Top', width: 1920, height: 1080 }, { name: 'LED Bottom', width: 1920, height: 1080 }])
  const [direction, setDirection] = useState<'vertical' | 'horizontal'>('vertical')
  const wizard = preset.id === 'stacked'
  const color = COLORS[existing.length % COLORS.length]
  const build = (): Canvas => {
    const id = newLocalId()
    const finalName = name.trim() || preset.name
    if (wizard) {
      const s = stackedCanvas(panels.filter((p) => p.width > 0 && p.height > 0), direction)
      return { id, name: name.trim() || 'LED Wall', kind: 'audience', width: s.width, height: s.height, color, regions: s.regions.map((r) => ({ id: newLocalId(), name: r.name, rect: r.rect })) }
    }
    return canvasFromPreset(preset, id, newLocalId, finalName, color)
  }
  const preview = build()
  const k = Math.min(260 / preview.width, 150 / preview.height)
  return (
    <Modal title="New screen" onClose={onClose} width={760} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onAdd(build())} data-add-canvas>Add screen</Button></>}>
      <div className="dsp-preset-grid">
        {CANVAS_PRESETS.map((p) => (
          <button key={p.id} className={`dsp-preset ${p.id === preset.id ? 'on' : ''}`} onClick={() => setPreset(p)} data-preset={p.id}>
            <strong>{p.name}</strong>
            <span className="dim">{p.description}</span>
            <span className="dsp-faint">{p.id === 'stacked' ? 'Sizes per panel' : `${p.width}×${p.height}`}</span>
          </button>
        ))}
      </div>
      <div className="row" style={{ alignItems: 'flex-start', gap: 16, marginTop: 14 }}>
        <div className="col grow">
          <Field label="Name"><Input value={name} placeholder={wizard ? 'LED Wall' : preset.name} onChange={(e) => setName(e.target.value)} aria-label="New screen name" /></Field>
          {wizard && (
            <div className="col" style={{ gap: 6 }}>
              <div className="row">
                <span className="dsp-sub grow">Panels ({direction === 'vertical' ? 'top to bottom' : 'left to right'})</span>
                <Select style={{ width: 'auto' }} value={direction} onChange={(e) => setDirection(e.target.value as 'vertical')}><option value="vertical">Stacked</option><option value="horizontal">Side by side</option></Select>
              </div>
              {panels.map((p, i) => (
                <div key={i} className="row" style={{ gap: 6 }}>
                  <Input style={{ flex: 2 }} value={p.name} onChange={(e) => setPanels(panels.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label={`Panel ${i + 1} name`} />
                  <Input style={{ width: 80 }} type="number" value={p.width} onChange={(e) => setPanels(panels.map((x, j) => (j === i ? { ...x, width: Number(e.target.value) } : x)))} aria-label={`Panel ${i + 1} width`} />
                  <span className="dim">×</span>
                  <Input style={{ width: 80 }} type="number" value={p.height} onChange={(e) => setPanels(panels.map((x, j) => (j === i ? { ...x, height: Number(e.target.value) } : x)))} aria-label={`Panel ${i + 1} height`} />
                  <Button size="sm" variant="ghost" disabled={panels.length <= 1} onClick={() => setPanels(panels.filter((_, j) => j !== i))}>✕</Button>
                </div>
              ))}
              <div><Button size="sm" onClick={() => setPanels([...panels, { name: `Panel ${panels.length + 1}`, width: 1920, height: 1080 }])}>+ Add panel</Button></div>
              <p className="dim dsp-help">Enter each LED processor’s output size in pixels. Panels of different widths are centred. You’ll design one slide across the whole wall; each panel becomes a region you can send to its own output.</p>
            </div>
          )}
        </div>
        <div className="col" style={{ alignItems: 'center', width: 280 }}>
          <div className="dsp-stage mini" style={{ width: preview.width * k, height: preview.height * k }}>
            {preview.regions.map((r, i) => (
              <div key={r.id} className="dsp-region" style={{ left: r.rect.x * k, top: r.rect.y * k, width: r.rect.w * k, height: r.rect.h * k, ['--rc' as string]: COLORS[i % COLORS.length] }}>
                <span className="dsp-region-name">{r.name}</span>
              </div>
            ))}
          </div>
          <span className="dim" style={{ marginTop: 6 }}>{preview.width}×{preview.height} · {aspectLabel(preview.width, preview.height)}</span>
        </div>
      </div>
    </Modal>
  )
}
