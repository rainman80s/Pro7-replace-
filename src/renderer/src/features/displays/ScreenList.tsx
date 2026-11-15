import { useState, type ReactNode } from 'react'
import type { Canvas, ID, Region } from '@shared/model'
import { CANVAS_PRESETS, canvasFromPreset, stackedCanvas, type CanvasPreset, type TestPatternId } from '@shared/outputs'
import { Button, Field, Input, Modal, NumberInput, Toggle, confirm, openContextMenu, openMenuAt, toast } from '@ui/index'
import { api, useApp } from '../../app/store'
import { newLocalId, removeOutput, saveCanvases, useCanvases, useDisplays } from './state'
import { outputsFor, selEq, type Sel } from './screens-logic'

const COLORS = ['#3886CE', '#E6A20F', '#4fa88b', '#d8523f', '#9b6bd1', '#e0739c', '#6f6e6a']

const preset = (id: string, name: string, description: string, kind: Canvas['kind'], width: number, height: number): CanvasPreset => ({ id, name, description, kind, width, height, regions: [] })
const LED_SIZES = [preset('led-wall', 'LED WALL', 'LED wall 1920×880', 'audience', 1920, 880), preset('led-lyrics', 'LED LYRICS', 'LED lyric strip 1920×320', 'audience', 1920, 320)]
const byId = (id: string): CanvasPreset => CANVAS_PRESETS.find((p) => p.id === id)!

const PATTERNS: { id: TestPatternId; name: string }[] = [
  { id: 'grid', name: 'Alignment grid' }, { id: 'bars', name: 'Colour bars' }, { id: 'regions', name: 'Region labels' }, { id: 'pixels', name: 'Pixel grid + size' },
  { id: 'focus', name: 'Focus star' }, { id: 'white', name: 'Full white' }, { id: 'black', name: 'Full black' }
]

/** Left column of the Screen Configuration window: Audience / Stage lists, Identify Screens, Test Patterns… */
export function ScreenList({ sel, onSelect }: { sel: Sel | null; onSelect: (s: Sel) => void }): ReactNode {
  const canvases = useCanvases()
  const outputs = useApp((s) => s.outputs)
  const { health } = useDisplays()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [stacked, setStacked] = useState<Canvas['kind'] | null>(null)
  const [patterns, setPatterns] = useState(false)
  const [identify, setIdentify] = useState(false)

  const color = (): string => COLORS[canvases.length % COLORS.length]
  const add = (c: Canvas): void => { void saveCanvases([...canvases, c]); onSelect({ canvasId: c.id }) }
  const fromPreset = (p: CanvasPreset, kind: Canvas['kind']): void => add(canvasFromPreset({ ...p, kind }, newLocalId(), newLocalId, undefined, color()))
  const setEnabled = (kind: Canvas['kind'], on: boolean): void => void saveCanvases(canvases.map((c) => (c.kind === kind ? { ...c, enabled: on ? undefined : false } : c)))
  const update = (next: Canvas): void => void saveCanvases(canvases.map((c) => (c.id === next.id ? next : c)))

  const plusMenu = (el: Element, kind: Canvas['kind']): void => {
    openMenuAt(el, kind === 'stage'
      ? [
        { label: 'Stage display (1080p)', onSelect: () => fromPreset(byId('stage'), 'stage') },
        { label: 'Stage display (4K)', onSelect: () => fromPreset({ ...byId('4k'), name: 'Stage display (4K)' }, 'stage') }
      ]
      : [
        { type: 'heading', label: 'Add a screen' },
        { label: 'Full HD (1080p)', onSelect: () => fromPreset(byId('hd'), kind) },
        { label: '4K', onSelect: () => fromPreset(byId('4k'), kind) },
        { type: 'separator' },
        ...LED_SIZES.map((p) => ({ label: p.description, onSelect: () => fromPreset(p, kind) })),
        { label: 'Stacked LED wall…', onSelect: () => setStacked(kind) },
        { type: 'separator' },
        { label: 'Livestream (16:9)', onSelect: () => fromPreset(byId('livestream'), kind) },
        ...['ultrawide', 'portrait', 'side-by-side', 'lobby'].map((id) => ({ label: byId(id).name, onSelect: () => fromPreset(byId(id), kind) }))
      ], { align: 'end' })
  }

  const removeCanvas = async (c: Canvas): Promise<void> => {
    if (canvases.length <= 1) return void toast('You need at least one screen', 'warning')
    if (!(await confirm({ title: `Delete “${c.name}”?`, message: 'Its outputs are removed too. The displays stay connected.', confirmLabel: 'Delete', danger: true }))) return
    for (const o of outputs.filter((x) => x.canvasId === c.id)) await removeOutput(o.id)
    await saveCanvases(canvases.filter((x) => x.id !== c.id))
    onSelect({ canvasId: canvases.find((x) => x.id !== c.id)!.id })
  }
  const duplicateCanvas = (c: Canvas): void => {
    const copy: Canvas = { ...c, id: newLocalId(), name: `${c.name} copy`, regions: c.regions.map((r) => ({ ...r, id: newLocalId() })) }
    add(copy)
  }
  const removeRegion = async (c: Canvas, r: Region): Promise<void> => {
    if (!(await confirm({ title: `Delete the region “${r.name}”?`, message: 'The output that showed it is removed.', confirmLabel: 'Delete', danger: true }))) return
    for (const o of outputs.filter((x) => x.canvasId === c.id && x.regionId === r.id)) await removeOutput(o.id)
    update({ ...c, regions: c.regions.filter((x) => x.id !== r.id) })
    onSelect({ canvasId: c.id })
  }

  const dot = (s: Sel): string => {
    const os = outputsFor(outputs, s)
    if (!os.length) return 'idle'
    const hs = os.map((o) => health.find((h) => h.outputId === o.id))
    return hs.some((h) => h && !h.ok) ? 'bad' : hs.some((h) => h?.status === 'live') ? 'live' : 'idle'
  }

  const row = (c: Canvas, r?: Region): ReactNode => {
    const s: Sel = { canvasId: c.id, regionId: r?.id }
    const key = `${c.id}:${r?.id ?? ''}`
    const name = r?.name ?? c.name
    const size = r ? `${r.rect.w}×${r.rect.h}` : `${c.width}×${c.height}`
    const on = !!sel && selEq(s, sel)
    const rename = (v: string): void => {
      setRenaming(null)
      const n = v.trim()
      if (!n || n === name) return
      update(r ? { ...c, regions: c.regions.map((x) => (x.id === r.id ? { ...x, name: n } : x)) } : { ...c, name: n })
    }
    return (
      <div key={key} className={`scr-row ${r ? 'region' : ''} ${on ? 'on' : ''} ${c.enabled === false ? 'off' : ''}`} data-screen={key}
        onClick={() => onSelect(s)} onDoubleClick={() => setRenaming(key)}
        onContextMenu={(e) => { onSelect(s); openContextMenu(e, [
          { label: 'Rename', onSelect: () => setRenaming(key) },
          { label: 'Duplicate', onSelect: () => (r ? update({ ...c, regions: [...c.regions, { ...r, id: newLocalId(), name: `${r.name} copy` }] }) : duplicateCanvas(c)) },
          { type: 'separator' },
          { label: 'Delete', danger: true, onSelect: () => void (r ? removeRegion(c, r) : removeCanvas(c)) }
        ]) }}>
        <span className={`dsp-dot ${dot(s)}`} />
        {renaming === key
          ? <Input autoFocus defaultValue={name} aria-label="Screen name" onClick={(e) => e.stopPropagation()} onBlur={(e) => rename(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') rename((e.target as HTMLInputElement).value); if (e.key === 'Escape') setRenaming(null) }} />
          : <span className="scr-row-name">{name}</span>}
        <span className="scr-row-size">{size}</span>
      </div>
    )
  }

  const section = (kind: Canvas['kind'], title: string): ReactNode => {
    const list = canvases.filter((c) => c.kind === kind)
    const on = list.some((c) => c.enabled !== false)
    return (
      <section className="scr-section" data-section={kind}>
        <header className="scr-section-h">
          <span className="scr-section-title">{title}</span>
          <Toggle checked={on} onChange={(v) => setEnabled(kind, v)} aria-label={`${title} screens on`} disabled={!list.length} />
          <button type="button" className="scr-plus" onClick={(e) => plusMenu(e.currentTarget, kind)} aria-label={`Add ${title} screen`} data-add-screen={kind}>+</button>
        </header>
        {list.map((c) => (
          <div key={c.id}>
            {row(c)}
            {c.regions.map((r) => row(c, r))}
          </div>
        ))}
        {!list.length && <div className="scr-empty">No {title.toLowerCase()} screens. Click + to add one.</div>}
      </section>
    )
  }

  return (
    <aside className="scr-list">
      <div className="scr-list-scroll">
        {section('audience', 'Audience')}
        {section('stage', 'Stage')}
      </div>
      <footer className="scr-list-foot">
        <Toggle checked={identify} onChange={(v) => { setIdentify(v); if (v) { void api.invoke('outputs.identify'); window.setTimeout(() => setIdentify(false), 4000) } }} label="Identify Screens" data-testid="identify-screens" />
        <Button size="sm" onClick={() => setPatterns(true)} data-test-patterns>Test Patterns…</Button>
      </footer>
      {stacked && <StackedWizard kind={stacked} onClose={() => setStacked(null)} onCreate={(c) => { add({ ...c, color: color() }); setStacked(null) }} />}
      {patterns && <PatternsModal onClose={() => setPatterns(false)} />}
    </aside>
  )
}

function PatternsModal({ onClose }: { onClose: () => void }): ReactNode {
  const outputs = useApp((s) => s.outputs)
  const current = outputs.find((o) => o.testPattern)?.testPattern ?? null
  const set = (pattern: TestPatternId | null): void => void api.invoke('outputs.testPattern', { pattern })
  return (
    <Modal title="Test Patterns" onClose={onClose} width={380} footer={<><Button variant="ghost" onClick={() => set(null)}>Show live content again</Button><Button onClick={onClose}>Done</Button></>}>
      <div className="col" style={{ gap: 6 }}>
        <span className="dsp-help">Shows the pattern on every output at once, to line up projectors and LED walls. Switch it off when you are done.</span>
        {PATTERNS.map((p) => <Button key={p.id} variant={current === p.id ? 'primary' : 'default'} onClick={() => set(p.id)} data-test-pattern-pick={p.id}>{p.name}</Button>)}
      </div>
    </Modal>
  )
}

/** Stacked LED wall wizard: panels top to bottom, each with its own pixel size → one canvas with a region per panel. */
function StackedWizard({ kind, onClose, onCreate }: { kind: Canvas['kind']; onClose: () => void; onCreate: (c: Canvas) => void }): ReactNode {
  const [name, setName] = useState('LED Wall')
  const [panels, setPanels] = useState([{ name: 'LED WALL', width: 1920, height: 880 }, { name: 'LED LYRICS', width: 1920, height: 320 }])
  const set = (i: number, patch: Partial<(typeof panels)[number]>): void => setPanels(panels.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const s = stackedCanvas(panels)
  return (
    <Modal title="Stacked LED wall" onClose={onClose} width={520} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" data-stacked-create onClick={() => onCreate({ id: newLocalId(), name, kind, width: s.width, height: s.height, regions: s.regions.map((r) => ({ id: newLocalId(), name: r.name, rect: r.rect })) })}>Create {s.width}×{s.height} screen</Button></>}>
      <div className="col" style={{ gap: 10 }}>
        <span className="dsp-help">One picture across panels stacked top to bottom. Each panel becomes a region you can send to its own output.</span>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {panels.map((p, i) => (
          <div key={i} className="row" style={{ gap: 6 }}>
            <Input value={p.name} onChange={(e) => set(i, { name: e.target.value })} aria-label={`Panel ${i + 1} name`} />
            <NumberInput value={p.width} min={16} max={16384} onChange={(n) => set(i, { width: n })} aria-label={`Panel ${i + 1} width`} style={{ width: 90 }} />
            <span className="dim">×</span>
            <NumberInput value={p.height} min={16} max={16384} onChange={(n) => set(i, { height: n })} aria-label={`Panel ${i + 1} height`} style={{ width: 90 }} />
            <Button size="sm" variant="ghost" disabled={panels.length <= 2} onClick={() => setPanels(panels.filter((_, j) => j !== i))} aria-label="Remove panel">✕</Button>
          </div>
        ))}
        <div><Button size="sm" onClick={() => setPanels([...panels, { name: `Panel ${panels.length + 1}`, width: 1920, height: 1080 }])}>+ Add panel</Button></div>
      </div>
    </Modal>
  )
}

export type { ID }
