import { useMemo, useState, type ReactNode } from 'react'
import type { Canvas, ID, Output, OutputTransform, Rect } from '@shared/model'
import { deckLinkModeLabel, sortDeckLinkModes, KEYING_LABELS, type DeckLinkKeying } from '@shared/decklink'
import { destinationLabel, fitRect, isGroup, routeWarnings, type TestPatternId } from '@shared/outputs'
import { colorFilterCss, normalizePlacement, placementCss } from '@shared/placement'
import { OutputSurface } from '@shared/render/LiveCanvas'
import { Button, ColorInput, Field, Input, NumberInput, SegmentedControl, Select, Slider, Tabs, confirm } from '@ui/index'
import { api, useApp } from '../../app/store'
import { CornerPin } from './Inspector'
import { OutputMenu, type Choice } from './OutputMenu'
import { newLocalId, removeOutput, saveCanvases, saveOutput, useCanvases, useDisplays } from './state'
import { destSizeOf, groupFor, initialPlacement, modeOf, outputsFor, sourceSize, type ScreenMode, type Sel } from './screens-logic'

type Tab = 'hardware' | 'color' | 'pin' | 'alpha'
const TABS: { id: Tab; label: string }[] = [{ id: 'hardware', label: 'Hardware' }, { id: 'color', label: 'Color' }, { id: 'pin', label: 'Corner Pin' }, { id: 'alpha', label: 'Alpha Key' }]
const MODE_LABEL: Record<ScreenMode, string> = { single: 'Single', grouped: 'Grouped / mirrored', wall: 'Video wall split' }
const PATTERNS: { id: TestPatternId | ''; name: string }[] = [{ id: '', name: 'Off (show live content)' }, { id: 'grid', name: 'Alignment grid' }, { id: 'bars', name: 'Colour bars' }, { id: 'pixels', name: 'Pixel grid + size' }, { id: 'white', name: 'Full white' }, { id: 'black', name: 'Full black' }]
const rectEq = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

/** Right side of the Screen Configuration window, for the selected screen or region. */
export function ScreenEditor({ sel }: { sel: Sel }): ReactNode {
  const canvases = useCanvases()
  const outputs = useApp((s) => s.outputs)
  const displays = useApp((s) => s.displays)
  const { receivers, ports, health } = useDisplays()
  const [tab, setTab] = useState<Tab>('hardware')
  const [modeForced, setModeForced] = useState<{ key: string; mode: ScreenMode } | null>(null)
  const [activeId, setActiveId] = useState<ID | null>(null)

  const canvas = canvases.find((c) => c.id === sel.canvasId)
  const region = canvas?.regions.find((r) => r.id === sel.regionId)
  const key = `${sel.canvasId}:${sel.regionId ?? ''}`
  const src = sourceSize(canvas, sel.regionId)
  const mine = outputsFor(outputs, sel)
  const group = groupFor(outputs, sel)
  const derived = modeOf(outputs, sel)
  const mode: ScreenMode = derived !== 'single' ? derived : modeForced?.key === key ? modeForced.mode : 'single'
  const output = mine.find((o) => o.id === activeId) ?? mine[0]
  const h = output ? health.find((x) => x.outputId === output.id) : undefined
  const dest = destSizeOf(output, displays, receivers, ports, src)
  const screenName = region ? `${canvas?.name} › ${region.name}` : canvas?.name ?? ''

  const taken = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of outputs) {
      if (o.id === output?.id || isGroup(o)) continue
      const t = o.target
      if (t.type === 'display') m.set(`display:${t.displayKey}`, o.name)
      else if (t.type === 'decklink') m.set(`decklink:${t.device}`, o.name)
      else if (t.type === 'network') m.set(`network:${t.receiverId}`, o.name)
    }
    return m
  }, [outputs, output?.id])

  if (!canvas || !src) return <div className="scr-detail-empty">Select a screen on the left.</div>

  const patch = (o: Output, p: Partial<Output>): void => void saveOutput({ ...o, ...p })
  const setT = (o: Output, p: Partial<OutputTransform>): void => patch(o, { transform: { ...o.transform, ...p } })

  /** Pick a destination: changes the active output, or creates one for this screen. */
  const choose = (c: Choice, into?: Output): void => {
    const base: Output = into ?? { id: newLocalId(), name: screenName, canvasId: sel.canvasId, regionId: sel.regionId, target: c.target, enabled: true }
    let target = c.target
    if (target.type === 'ndi' && !target.name) target = { type: 'ndi', name: `Reach ${base.name}` }
    const next: Output = { ...base, target, ...(target.type === 'ndi' ? { frameRate: base.frameRate ?? 30 } : {}) }
    const d = destSizeOf(next, displays, receivers, ports, src)
    next.placement = into?.placement && d && target.type === 'decklink' && into.target.type === 'decklink' ? into.placement : initialPlacement(src, d)
    void saveOutput(next).then((list) => {
      if (!into) { setActiveId(next.id); if (group) void api.invoke('outputs.groupMember', { groupId: group.id, memberId: next.id, member: true }); void list }
    })
  }
  const addOutput = (): void => choose({ target: { type: 'placeholder' }, label: 'Placeholder' })
  const setMode = (m: ScreenMode): void => {
    setModeForced({ key, mode: m })
    if (m === 'wall') {
      void api.invoke('outputs.saveGroup', { id: group?.id, name: `${screenName} wall`, canvasId: sel.canvasId, regionId: sel.regionId, memberIds: mine.map((o) => o.id), layout: { mode: 'wall', columns: Math.max(1, mine.length), rows: 1 } })
    } else if (group) {
      void api.invoke('outputs.saveGroup', { id: group.id, name: group.name, canvasId: sel.canvasId, regionId: sel.regionId, memberIds: group.target.type === 'group' ? group.target.outputIds : [], layout: { mode: 'mirror' } })
    }
  }

  const updateCanvas = (next: Canvas): void => void saveCanvases(canvases.map((c) => (c.id === next.id ? next : c)))
  const setSize = (w: number, hh: number): void => {
    if (region) updateCanvas({ ...canvas, regions: canvas.regions.map((r) => (r.id === region.id ? { ...r, rect: { ...r.rect, w, h: hh } } : r)) })
    else updateCanvas({ ...canvas, width: w, height: hh })
  }
  const label = output ? targetLabel(output, displays, receivers, ports) : 'Not connected'

  return (
    <div className="scr-detail" data-screen-editor={key}>
      <header className="scr-head">
        <div className="grow" style={{ minWidth: 0 }}>
          <Input className="scr-title" value={region?.name ?? canvas.name} aria-label="Screen name" onChange={(e) => (region ? updateCanvas({ ...canvas, regions: canvas.regions.map((r) => (r.id === region.id ? { ...r, name: e.target.value } : r)) }) : updateCanvas({ ...canvas, name: e.target.value }))} />
          <div className="scr-size row">
            <NumberInput value={src.width} min={16} max={16384} onChange={(n) => setSize(n, src.height)} aria-label="Screen width" style={{ width: 116 }} />
            <span className="dim">×</span>
            <NumberInput value={src.height} min={16} max={16384} onChange={(n) => setSize(src.width, n)} aria-label="Screen height" style={{ width: 116 }} />
            <span className="dim">px</span>
          </div>
        </div>
        {!region && (
          <label className="row scr-color">
            <input type="checkbox" checked={!!canvas.color} onChange={(e) => updateCanvas({ ...canvas, color: e.target.checked ? '#3886CE' : undefined })} data-screen-color /> Screen Color
            <ColorInput value={canvas.color ?? '#3886CE'} swatches={false} disabled={!canvas.color} onChange={(c) => updateCanvas({ ...canvas, color: c })} aria-label="Screen color" />
          </label>
        )}
      </header>

      <div className="scr-mode row">
        <span className="dim">Output mode</span>
        <Select value={mode} onChange={(e) => setMode(e.target.value as ScreenMode)} aria-label="Output mode" data-screen-mode style={{ width: 200 }}>
          <option value="single" disabled={mine.length > 1}>{MODE_LABEL.single}</option>
          <option value="grouped">{MODE_LABEL.grouped}</option>
          <option value="wall">{MODE_LABEL.wall}</option>
        </Select>
        {mode === 'wall' && group && (
          <span className="row" style={{ gap: 6 }}>
            <NumberInput value={group.groupLayout?.columns ?? 1} min={1} max={16} aria-label="Wall columns" style={{ width: 64 }} onChange={(n) => void api.invoke('outputs.saveGroup', { id: group.id, name: group.name, canvasId: group.canvasId, regionId: group.regionId, memberIds: group.target.type === 'group' ? group.target.outputIds : [], layout: { mode: 'wall', columns: n, rows: group.groupLayout?.rows ?? 1 } })} />
            <span className="dim">×</span>
            <NumberInput value={group.groupLayout?.rows ?? 1} min={1} max={16} aria-label="Wall rows" style={{ width: 64 }} onChange={(n) => void api.invoke('outputs.saveGroup', { id: group.id, name: group.name, canvasId: group.canvasId, regionId: group.regionId, memberIds: group.target.type === 'group' ? group.target.outputIds : [], layout: { mode: 'wall', columns: group.groupLayout?.columns ?? 1, rows: n } })} />
            <span className="dim">screens, left to right then down</span>
          </span>
        )}
      </div>
      {mode !== 'single' && (
        <div className="scr-outs row" data-output-strip>
          {mine.map((o, i) => (
            <button key={o.id} type="button" className={`scr-chip ${o.id === output?.id ? 'on' : ''}`} onClick={() => setActiveId(o.id)}>{mode === 'wall' ? `${i + 1}. ` : ''}{o.name}</button>
          ))}
          <Button size="sm" onClick={addOutput} data-add-output>+ Add output</Button>
        </div>
      )}

      <Preview src={src} dest={dest ?? src} output={output} canvas={canvas} sel={sel} name={label} unknownDest={!dest} />

      {h && !h.ok && h.status !== 'waiting' && <div className="dsp-warn bad" data-output-warning>{health2(h.message, label)}</div>}
      {output && dest && !output.placement && routeWarnings({ sourceName: screenName, source: src, destName: label, dest, fit: output.transform?.fit, rotate: output.transform?.rotate }).map((w, i) => <div key={i} className={`dsp-warn ${w.level}`}>{w.text}</div>)}

      <Tabs tabs={TABS} value={tab} onChange={setTab} className="scr-tabs" />
      <div className="scr-tab-body">
        {tab === 'hardware' && (
          <Hardware sel={sel} output={output} src={src} dest={dest} label={label} taken={taken}
            onChoose={(c) => choose(c, output)} patch={(p) => output && patch(output, p)} setT={(p) => output && setT(output, p)} />
        )}
        {output && tab === 'color' && <ColorTab output={output} setT={(p) => setT(output, p)} />}
        {output && tab === 'pin' && <PinTab output={output} setT={(p) => setT(output, p)} />}
        {output && tab === 'alpha' && <AlphaTab output={output} patch={(p) => patch(output, p)} />}
        {!output && tab !== 'hardware' && <div className="dsp-help">Choose an Output on the Hardware tab first.</div>}
        {output && (
          <div className="row scr-foot">
            <label className="row"><input type="checkbox" checked={output.enabled} onChange={(e) => patch(output, { enabled: e.target.checked })} data-enabled /> Output on</label>
            <div className="grow" />
            <Button size="sm" variant="ghost" onClick={() => void api.invoke('outputs.identifyOne', { id: output.id })}>Identify</Button>
            <Select style={{ width: 'auto' }} value={output.testPattern ?? ''} onChange={(e) => void api.invoke('outputs.testPattern', { id: output.id, pattern: (e.target.value || null) as TestPatternId | null })} aria-label="Test pattern">
              {PATTERNS.map((p) => <option key={p.id} value={p.id}>{p.id ? `Test: ${p.name}` : 'No test pattern'}</option>)}
            </Select>
            <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: `Remove “${output.name}”?`, message: 'The display stays connected; it just stops showing this screen.', confirmLabel: 'Remove', danger: true })) { await removeOutput(output.id); setActiveId(null) } }}>Remove output</Button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Plain-language rewording of the DeckLink "busy" message the way the tech lead reads it. */
function health2(message: string, label: string): string {
  return /is busy/.test(message) ? `${label} is in use by ProPresenter (or another app). Quit it there — Reach keeps trying and starts by itself.` : message
}

function targetLabel(o: Output, displays: ReturnType<typeof useApp.getState>['displays'], receivers: ReturnType<typeof useDisplays.getState>['receivers'], ports: ReturnType<typeof useDisplays.getState>['ports']): string {
  const t = o.target
  if (t.type === 'decklink') return ports.find((p) => p.key === t.device)?.displayName ?? t.device
  if (t.type === 'ndi') return t.name ? `NDI “${t.name}”` : 'New NDI'
  if (t.type === 'placeholder') return 'Placeholder'
  return destinationLabel(o, displays, receivers)
}

function Preview({ src, dest, output, canvas, sel, name, unknownDest }: { src: { width: number; height: number }; dest: { width: number; height: number }; output?: Output; canvas: Canvas; sel: Sel; name: string; unknownDest: boolean }): ReactNode {
  const live = useApp((s) => s.live)
  const ws = useApp((s) => s.workspace)
  const fit = output?.transform?.fit ?? 'contain'
  const rect = output?.placement ? normalizePlacement(output.placement) : fitRect(src, dest, fit)
  const crop = sel.regionId ? canvas.regions.find((r) => r.id === sel.regionId)?.rect : undefined
  return (
    <div className="scr-preview" data-preview>
      <div className="scr-frame" style={{ aspectRatio: `${dest.width} / ${dest.height}`, filter: colorFilterCss(output?.transform) }}>
        <div className="scr-pic" style={{ position: 'absolute', ...placementCss(rect, dest) }} data-preview-pic>
          <OutputSurface canvas={canvas} crop={crop} live={live} workspace={ws ?? undefined} fit="stretch" />
        </div>
        <span className="scr-frame-label">{name}</span>
      </div>
      <div className="scr-preview-cap dim">{unknownDest ? 'Destination size not known yet' : `${dest.width}×${dest.height} frame`} · picture {rect.w}×{rect.h} at {rect.x},{rect.y}</div>
    </div>
  )
}

function Hardware({ sel, output, src, dest, label, taken, onChoose, patch, setT }: {
  sel: Sel; output?: Output; src: { width: number; height: number }; dest?: { width: number; height: number }; label: string; taken: Map<string, string>
  onChoose: (c: Choice) => void; patch: (p: Partial<Output>) => void; setT: (p: Partial<OutputTransform>) => void
}): ReactNode {
  const displays = useApp((s) => s.displays)
  const { receivers, ports } = useDisplays()
  void sel
  const t = output?.target
  const port = t?.type === 'decklink' ? ports.find((p) => p.key === t.device) : undefined
  const modes = sortDeckLinkModes(port?.modes ?? [])
  const display = t?.type === 'display' ? displays.find((d) => d.key === t.displayKey) : undefined
  const fit = output?.transform?.fit ?? 'contain'
  const fitR = dest ? fitRect(src, dest, fit) : undefined
  const custom = !!output?.placement && !(fitR && rectEq(normalizePlacement(output.placement), fitR))
  const pl = output?.placement ?? fitR ?? { x: 0, y: 0, w: src.width, h: src.height }
  const setPl = (p: Partial<Rect>): void => patch({ placement: normalizePlacement({ ...pl, ...p }) })
  const setFit = (): void => patch({ placement: t?.type === 'decklink' && fitR ? fitR : undefined })
  const setCustom = (): void => patch({ placement: initialPlacement(src, dest) ?? { x: 0, y: 0, w: src.width, h: src.height } })
  return (
    <div className="scr-form" data-hardware>
      <Field label="Output">
        <OutputMenu output={output} displays={displays} ports={ports} receivers={receivers} taken={taken} label={label} onPick={onChoose} />
      </Field>
      {output && (
        <>
          <Field label="Name"><Input key={output.id} defaultValue={output.name} aria-label="Output name" onBlur={(e) => e.target.value.trim() && e.target.value !== output.name && patch({ name: e.target.value.trim() })} /></Field>
          <Field label="Mode">
            {t?.type === 'decklink' ? (
              <Select value={t.mode} aria-label="Video format" data-decklink-mode onChange={(e) => patch({ target: { ...t, mode: e.target.value } })}>
                {!modes.some((m) => m.id === t.mode) && <option value={t.mode}>{t.mode}</option>}
                {modes.map((m) => <option key={m.id} value={m.id}>{deckLinkModeLabel(m)} ({m.width}x{m.height})</option>)}
              </Select>
            ) : t?.type === 'ndi' ? (
              <div className="row" style={{ gap: 6 }}>
                <Input defaultValue={t.name} aria-label="NDI name" onBlur={(e) => e.target.value.trim() && patch({ target: { type: 'ndi', name: e.target.value.trim() } })} />
                <Select style={{ width: 90 }} value={String(output.frameRate ?? 30)} onChange={(e) => patch({ frameRate: Number(e.target.value) })} aria-label="Frame rate"><option>25</option><option>30</option><option>50</option><option>60</option></Select>
              </div>
            ) : <div className="scr-readout">{dest ? `${dest.width}×${dest.height}` : '—'}{display ? ' (current resolution)' : ''}</div>}
          </Field>
          <Field label="Video Delay" hint={t?.type === 'decklink' ? undefined : 'DeckLink only — remembered here, applied when this goes out over SDI.'}>
            <div className="row" style={{ gap: 6 }}><NumberInput value={output.videoDelay ?? 0} min={0} max={120} onChange={(n) => patch({ videoDelay: n || undefined })} aria-label="Video delay frames" style={{ width: 80 }} data-video-delay /><span className="dim">frames</span></div>
          </Field>
          <Field label="Output Target">
            <Select value={custom ? 'custom' : 'fit'} onChange={(e) => (e.target.value === 'custom' ? setCustom() : setFit())} aria-label="Output target" data-output-target>
              <option value="fit">Fit (scale)</option>
              <option value="custom">Custom</option>
            </Select>
          </Field>
          {custom ? (
            <div className="scr-xywh" data-placement>
              {(['x', 'y', 'w', 'h'] as const).map((k) => (
                <label key={k} className="col scr-xy"><span className="dim">{({ x: 'X', y: 'Y', w: 'Width', h: 'Height' })[k]}</span>
                  <NumberInput value={pl[k]} min={k === 'w' || k === 'h' ? 1 : -16384} max={16384} suffix="px" onChange={(n) => setPl({ [k]: n })} aria-label={`Placement ${k}`} />
                </label>
              ))}
            </div>
          ) : (
            <Field label="Fit">
              <Select value={fit} onChange={(e) => setT({ fit: e.target.value as OutputTransform['fit'] })} aria-label="Fit style">
                <option value="contain">Fit inside (black bars if needed)</option><option value="cover">Fill (crop edges)</option><option value="stretch">Stretch</option>
              </Select>
            </Field>
          )}
          {t?.type === 'display' && display?.operator && (
            <label className="row dsp-faint"><input type="checkbox" checked={!!output.allowOperatorScreen} onChange={(e) => patch({ allowOperatorScreen: e.target.checked })} /> Use this screen anyway</label>
          )}
        </>
      )}
      {!output && <div className="dsp-help">Nothing is connected to this screen yet. Choose where it should go.</div>}
    </div>
  )
}

function ColorTab({ output, setT }: { output: Output; setT: (p: Partial<OutputTransform>) => void }): ReactNode {
  const t = output.transform ?? {}
  const row = (label: string, k: 'brightness' | 'contrast' | 'saturation' | 'gamma', min: number, max: number, step: number, def = 1): ReactNode => (
    <Field label={`${label} ${Math.round((t[k] ?? def) * 100)}%`}><Slider value={t[k] ?? def} min={min} max={max} step={step} onChange={(n) => setT({ [k]: n })} aria-label={label} /></Field>
  )
  return (
    <div className="scr-form" data-color-tab>
      {row('Brightness', 'brightness', 0.2, 1.5, 0.05)}
      {row('Contrast', 'contrast', 0.5, 1.5, 0.05)}
      {row('Saturation', 'saturation', 0, 2, 0.05)}
      {row('Gamma', 'gamma', 0.5, 2, 0.05)}
      <Field label={`Color temperature ${(t.temperature ?? 0) === 0 ? 'neutral' : (t.temperature ?? 0) > 0 ? 'warmer' : 'cooler'}`}><Slider value={t.temperature ?? 0} min={-1} max={1} step={0.05} onChange={(n) => setT({ temperature: n })} aria-label="Color temperature" /></Field>
      <div><Button size="sm" variant="ghost" onClick={() => setT({ brightness: undefined, contrast: undefined, saturation: undefined, gamma: undefined, temperature: undefined })}>Reset colour</Button></div>
      <span className="dsp-help">Applied on the output itself, so SDI and NDI frames carry it too.</span>
    </div>
  )
}

function PinTab({ output, setT }: { output: Output; setT: (p: Partial<OutputTransform>) => void }): ReactNode {
  const t = output.transform ?? {}
  return (
    <div className="scr-form" data-pin-tab>
      <CornerPin points={t.cornerPin} onChange={(cornerPin) => setT({ cornerPin })} />
      <Field label="Rotate">
        <Select value={String(t.rotate ?? 0)} onChange={(e) => setT({ rotate: Number(e.target.value) as 0 })} aria-label="Rotate">
          <option value="0">None</option><option value="90">90° clockwise</option><option value="180">Upside down</option><option value="270">90° anticlockwise</option>
        </Select>
      </Field>
      <Field label="Mirror"><div className="row"><label className="row"><input type="checkbox" checked={!!t.flipH} onChange={(e) => setT({ flipH: e.target.checked })} /> Left↔right</label><label className="row"><input type="checkbox" checked={!!t.flipV} onChange={(e) => setT({ flipV: e.target.checked })} /> Up↕down</label></div></Field>
      <Field label={`Edge shrink ${Math.round((t.overscan ?? 0) * 100)}%`} hint="For TVs that cut off the edges"><Slider value={t.overscan ?? 0} min={0} max={0.1} step={0.005} onChange={(n) => setT({ overscan: n })} aria-label="Edge shrink" /></Field>
    </div>
  )
}

type AlphaMode = 'off' | 'fillkey' | 'alpha'

function AlphaTab({ output, patch }: { output: Output; patch: (p: Partial<Output>) => void }): ReactNode {
  const { ports } = useDisplays()
  const t = output.target
  const dl = t.type === 'decklink' ? t : undefined
  const port = dl ? ports.find((p) => p.key === dl.device) : undefined
  const keying = dl?.keying ?? 'none'
  const mode: AlphaMode = keying !== 'none' ? 'fillkey' : output.transparent ? 'alpha' : 'off'
  const canKey = !!dl && port?.supportsKeying !== false
  const canAlpha = t.type !== 'display' && t.type !== 'placeholder'
  const set = (m: AlphaMode): void => {
    if (dl) patch({ target: { ...dl, keying: m === 'fillkey' ? (dl.keying && dl.keying !== 'none' ? dl.keying : 'external') : 'none' }, transparent: m === 'alpha' ? true : undefined })
    else patch({ transparent: m === 'alpha' ? true : undefined })
  }
  return (
    <div className="scr-form" data-alpha-tab>
      <Field label="Alpha Key" hint={mode === 'off' ? 'The picture is sent as it is, with a black background.' : mode === 'fillkey' ? 'Sends the picture (fill) on this port and its shape (key) on the paired port for the video switcher’s keyer. The background is transparent.' : 'The background is transparent so the receiver can lay it over video.'}>
        <SegmentedControl<AlphaMode> aria-label="Alpha key mode" value={mode} onChange={set} options={([
          { value: 'off', label: 'Off' },
          { value: 'fillkey', label: 'Fill + Key', title: canKey ? undefined : 'Needs an SDI port that supports keying' },
          { value: 'alpha', label: 'Alpha', title: canAlpha ? undefined : 'Alpha needs NDI, SDI or a network display' }
        ] as { value: AlphaMode; label: string; title?: string }[]).filter((o) => (o.value === 'fillkey' ? !!dl : o.value === 'alpha' ? canAlpha : true))} />
      </Field>
      {dl && mode === 'fillkey' && (
        <>
          <Field label="Key type">
            <Select value={keying} onChange={(e) => patch({ target: { ...dl, keying: e.target.value as DeckLinkKeying } })} aria-label="Keying" data-decklink-keying>
              {(['external', 'internal'] as DeckLinkKeying[]).map((k) => <option key={k} value={k} disabled={!!port && (k === 'external' ? port.externalKeying === false : port.internalKeying === false)}>{KEYING_LABELS[k]}</option>)}
            </Select>
          </Field>
          <Field label={`Key strength ${Math.round(((dl.keyLevel ?? 255) / 255) * 100)}%`}><Slider value={dl.keyLevel ?? 255} min={0} max={255} step={1} onChange={(n) => patch({ target: { ...dl, keyLevel: n } })} aria-label="Key strength" /></Field>
        </>
      )}
      {!dl && <span className="dsp-help">Fill + Key is for SDI ports. NDI and network displays use Alpha.</span>}
    </div>
  )
}
