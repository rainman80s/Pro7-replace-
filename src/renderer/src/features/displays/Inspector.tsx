import { useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import type { ID, Output, OutputTransform } from '@shared/model'
import { DEFAULT_CORNERS, isGroup, isIdentityPin, type TestPatternId } from '@shared/outputs'
import { Button, Field, Input, Panel, Select } from '@ui/index'
import { api, useApp } from '../../app/store'
import { removeOutput, saveOutput, useCanvases, useDisplays } from './state'
import { SourceOptions, parseSrc, srcKey } from './Routing'
import { DeckLinkSettings } from './DeckLinkSettings'
import { defaultDeckLinkMode } from '@shared/decklink'

const PATTERNS: { id: TestPatternId | ''; name: string }[] = [
  { id: '', name: 'Off (show live content)' }, { id: 'grid', name: 'Alignment grid' }, { id: 'bars', name: 'Colour bars' },
  { id: 'regions', name: 'Region labels' }, { id: 'pixels', name: 'Pixel grid + size' }, { id: 'focus', name: 'Focus star' },
  { id: 'white', name: 'Full white' }, { id: 'black', name: 'Full black' }
]

/** Settings for one output (or group): source, picture adjustments, test pattern, copies, grouping. */
export function Inspector({ output, onClose }: { output: Output; onClose: () => void }): ReactNode {
  const canvases = useCanvases()
  const outputs = useApp((s) => s.outputs)
  const displays = useApp((s) => s.displays)
  const { receivers, health, select, audio, ports } = useDisplays()
  const [name, setName] = useState(output.name)
  const tr = output.transform ?? {}
  const save = (o: Output): void => void saveOutput(o)
  const setT = (patch: Partial<OutputTransform>): void => save({ ...output, transform: { ...tr, ...patch } })
  const h = health.find((x) => x.outputId === output.id)
  const group = outputs.find((g) => isGroup(g) && g.target.outputIds.includes(output.id))
  const groups = outputs.filter(isGroup)
  const display = output.target.type === 'display' ? displays.find((d) => d.key === (output.target as { displayKey: string }).displayKey) : undefined
  const used = new Set(outputs.flatMap((o) => (o.target.type === 'display' ? [`d:${o.target.displayKey}`] : o.target.type === 'network' ? [`n:${o.target.receiverId}`] : o.target.type === 'decklink' ? [`dl:${o.target.device}`] : [])))
  const duplicate = (v: string): void => {
    if (!v) return
    const [kind, ...rest] = v.split(':')
    const id = rest.join(':')
    const port = kind === 'dl' ? ports.find((p) => p.key === id) : undefined
    const target: Output['target'] = kind === 'd' ? { type: 'display', displayKey: id } : kind === 'n' ? { type: 'network', receiverId: id } : kind === 'ndi' ? { type: 'ndi', name: `${output.name} NDI` }
      : kind === 'dl' ? { type: 'decklink', device: id, mode: defaultDeckLinkMode(port?.modes ?? [])?.id ?? 'Hp29', keying: 'none' } : { type: 'window' }
    const destName = kind === 'dl' ? `SDI ${port?.port ?? ''}`.trim() : kind === 'd' ? (displays.find((d) => d.key === id)?.customName || displays.find((d) => d.key === id)?.label) : kind === 'n' ? receivers.find((r) => r.id === id)?.name : kind === 'ndi' ? 'NDI' : 'Window'
    void api.invoke('outputs.duplicate', { id: output.id, target, name: destName ?? undefined })
  }
  const setGroup = (gid: string): void => {
    if (gid === '__new') {
      void api.invoke('outputs.saveGroup', { name: `${output.name} group`, canvasId: output.canvasId, regionId: output.regionId, memberIds: [output.id], layout: { mode: 'mirror' } })
    } else if (gid) void api.invoke('outputs.groupMember', { groupId: gid, memberId: output.id, member: true })
    else if (group) void api.invoke('outputs.groupMember', { groupId: group.id, memberId: output.id, member: false })
  }
  const g = isGroup(output) ? output : null
  const members = g ? g.target.outputIds.map((id) => outputs.find((o) => o.id === id)).filter(Boolean) as Output[] : []
  const candidates = g ? outputs.filter((o) => !isGroup(o) && !g.target.outputIds.includes(o.id)) : []
  const saveGroup = (patch: Partial<{ name: string; canvasId: ID; regionId?: ID; memberIds: ID[]; layout: Output['groupLayout']; enabled: boolean }>): void => {
    if (!g) return
    void api.invoke('outputs.saveGroup', { id: g.id, name: g.name, canvasId: g.canvasId, regionId: g.regionId, memberIds: g.target.outputIds, layout: g.groupLayout, enabled: g.enabled, ...patch })
  }

  return (
    <Panel className="dsp-inspector" title={<span>Settings · <b>{output.name}</b></span>} actions={<Button size="sm" variant="ghost" onClick={onClose} aria-label="Close settings">✕</Button>}>
      <div className="dsp-inspector-body">
        {h && <div className={`dsp-warn ${h.ok ? 'info' : 'bad'}`}>{h.message}</div>}
        <div className="dsp-form">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== output.name && (g ? saveGroup({ name: name.trim() }) : save({ ...output, name: name.trim() }))} aria-label="Output name" /></Field>
          <Field label="On / off">
            <label className="row"><input type="checkbox" checked={output.enabled} onChange={(e) => (g ? saveGroup({ enabled: e.target.checked }) : save({ ...output, enabled: e.target.checked }))} data-enabled /> {output.enabled ? 'On' : 'Off'}</label>
          </Field>
          <Field label="Shows">
            <Select value={srcKey(output.canvasId, output.regionId)} disabled={!!group} onChange={(e) => (g ? saveGroup(parseSrc(e.target.value)) : save({ ...output, ...parseSrc(e.target.value) }))}>
              <SourceOptions canvases={canvases} />
            </Select>
          </Field>
        </div>

        {g && (
          <div className="dsp-section">
            <div className="dsp-sub">Screens in this group</div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <label className="row"><input type="radio" checked={(g.groupLayout?.mode ?? 'mirror') === 'mirror'} onChange={() => saveGroup({ layout: { mode: 'mirror' } })} /> Same picture on all</label>
              <label className="row"><input type="radio" checked={g.groupLayout?.mode === 'wall'} onChange={() => saveGroup({ layout: { mode: 'wall', columns: g.groupLayout?.columns ?? (members.length || 1), rows: g.groupLayout?.rows ?? 1 } })} data-wall /> Split one picture across them (video wall)</label>
            </div>
            {g.groupLayout?.mode === 'wall' && (
              <div className="row" style={{ gap: 6 }}>
                <Field label="Columns"><Input type="number" min={1} max={16} value={g.groupLayout.columns ?? members.length} onChange={(e) => saveGroup({ layout: { ...g.groupLayout!, columns: Math.max(1, Number(e.target.value)) } })} style={{ width: 70 }} /></Field>
                <Field label="Rows"><Input type="number" min={1} max={16} value={g.groupLayout.rows ?? 1} onChange={(e) => saveGroup({ layout: { ...g.groupLayout!, rows: Math.max(1, Number(e.target.value)) } })} style={{ width: 70 }} /></Field>
                <span className="dim dsp-help">Screens fill the grid left to right, top to bottom, in this order.</span>
              </div>
            )}
            {members.map((m, i) => (
              <div key={m.id} className="row dsp-member">
                <span className="dsp-faint">{i + 1}</span>
                <span className="grow">{m.name}</span>
                <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => { const ids = [...g.target.outputIds]; [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; saveGroup({ memberIds: ids }) }} aria-label="Move up">↑</Button>
                <Button size="sm" variant="ghost" onClick={() => saveGroup({ memberIds: g.target.outputIds.filter((x) => x !== m.id) })}>Remove</Button>
              </div>
            ))}
            <Select value="" onChange={(e) => e.target.value && saveGroup({ memberIds: [...g.target.outputIds, e.target.value] })} aria-label="Add to group" data-add-member>
              <option value="">+ Add a screen…</option>
              {candidates.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
            <div className="row">
              <Button size="sm" onClick={() => void api.invoke('outputs.identifyOne', { id: g.id }).then(() => Promise.all(members.map((m) => api.invoke('outputs.identifyOne', { id: m.id }))))}>Identify all</Button>
              <Select style={{ width: 'auto' }} value={members[0]?.testPattern ?? ''} onChange={(e) => void api.invoke('outputs.testPattern', { id: g.id, pattern: (e.target.value || null) as TestPatternId | null })} aria-label="Group test pattern">
                {PATTERNS.map((p) => <option key={p.id} value={p.id}>{p.id ? `Test: ${p.name}` : 'No test pattern'}</option>)}
              </Select>
              <div className="grow" />
              <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Remove the group “${g.name}”? Its screens stay, showing what they showed before.`)) { void removeOutput(g.id); onClose() } }}>Remove group</Button>
            </div>
          </div>
        )}

        {!g && (
          <>
            <div className="dsp-section">
              <div className="row">
                <Select className="grow" value="" onChange={(e) => duplicate(e.target.value)} aria-label="Also show on" data-also-show>
                  <option value="">Also show on…</option>
                  <optgroup label="Displays">{displays.filter((d) => !used.has(`d:${d.key}`) && d.connected !== false).map((d) => <option key={d.key} value={`d:${d.key}`}>{d.customName || d.label}{d.operator ? ' (your screen)' : ''}</option>)}</optgroup>
                  <optgroup label="Network displays">{receivers.filter((r) => !used.has(`n:${r.id}`)).map((r) => <option key={r.id} value={`n:${r.id}`}>{r.name}{r.connected ? '' : ' (offline)'}</option>)}</optgroup>
                  {ports.length > 0 && <optgroup label="SDI ports">{ports.filter((p) => !used.has(`dl:${p.key}`) && p.connected).map((p) => <option key={p.key} value={`dl:${p.key}`}>{p.key}</option>)}</optgroup>}
                  <optgroup label="Other"><option value="w:">A new window</option><option value="ndi:">A new NDI output</option></optgroup>
                </Select>
                <Select style={{ width: 'auto' }} value={group?.id ?? ''} onChange={(e) => setGroup(e.target.value)} aria-label="Group">
                  <option value="">Not in a group</option>
                  {groups.map((x) => <option key={x.id} value={x.id}>In group “{x.name}”</option>)}
                  <option value="__new">+ New group with this</option>
                </Select>
              </div>
              <div className="row">
                <Button size="sm" onClick={() => void api.invoke('outputs.identifyOne', { id: output.id })}>Identify</Button>
                <Select style={{ width: 'auto' }} value={output.testPattern ?? ''} onChange={(e) => void api.invoke('outputs.testPattern', { id: output.id, pattern: (e.target.value || null) as TestPatternId | null })} aria-label="Test pattern" data-test-pattern-select>
                  {PATTERNS.map((p) => <option key={p.id} value={p.id}>{p.id ? `Test: ${p.name}` : 'No test pattern'}</option>)}
                </Select>
                {output.target.type === 'display' && display?.operator && (
                  <label className="row dsp-faint"><input type="checkbox" checked={!!output.allowOperatorScreen} onChange={(e) => save({ ...output, allowOperatorScreen: e.target.checked })} /> Use this screen anyway</label>
                )}
              </div>
              {output.target.type === 'display' && display && <DisplayName displayKey={display.key} name={display.customName ?? ''} />}
            </div>

            {output.target.type === 'decklink' && <DeckLinkSettings output={output as Output & { target: Extract<Output['target'], { type: 'decklink' }> }} />}

            <div className="dsp-section">
              <div className="dsp-sub">Picture</div>
              <div className="dsp-form">
                <Field label="Fit">
                  <Select value={tr.fit ?? 'contain'} onChange={(e) => setT({ fit: e.target.value as OutputTransform['fit'] })}>
                    <option value="contain">Fit inside (black bars if needed)</option><option value="cover">Fill (crop edges)</option><option value="stretch">Stretch</option>
                  </Select>
                </Field>
                <Field label="Rotate">
                  <Select value={String(tr.rotate ?? 0)} onChange={(e) => setT({ rotate: Number(e.target.value) as 0 })}>
                    <option value="0">None</option><option value="90">90° clockwise</option><option value="180">Upside down</option><option value="270">90° anticlockwise</option>
                  </Select>
                </Field>
                <Field label="Mirror">
                  <div className="row"><label className="row"><input type="checkbox" checked={!!tr.flipH} onChange={(e) => setT({ flipH: e.target.checked })} /> Left↔right</label><label className="row"><input type="checkbox" checked={!!tr.flipV} onChange={(e) => setT({ flipV: e.target.checked })} /> Up↔down</label></div>
                </Field>
                <Field label={`Brightness ${Math.round((tr.brightness ?? 1) * 100)}%`}><input type="range" min={0.2} max={1.5} step={0.05} value={tr.brightness ?? 1} onChange={(e) => setT({ brightness: Number(e.target.value) })} /></Field>
                <Field label={`Edge shrink ${Math.round((tr.overscan ?? 0) * 100)}%`} hint="For TVs that cut off the edges"><input type="range" min={0} max={0.1} step={0.005} value={tr.overscan ?? 0} onChange={(e) => setT({ overscan: Number(e.target.value) })} /></Field>
                {(output.target.type === 'ndi' || output.target.type === 'window') && (
                  <Field label="Background"><label className="row"><input type="checkbox" checked={!!output.transparent} onChange={(e) => save({ ...output, transparent: e.target.checked })} /> Transparent (for keying)</label></Field>
                )}
                {output.target.type === 'ndi' && (
                  <>
                    <Field label="NDI name"><Input defaultValue={output.target.name} onBlur={(e) => e.target.value.trim() && save({ ...output, target: { type: 'ndi', name: e.target.value.trim() } })} /></Field>
                    <Field label="Frame rate"><Select value={String(output.frameRate ?? 30)} onChange={(e) => save({ ...output, frameRate: Number(e.target.value) })}><option>25</option><option>30</option><option>50</option><option>60</option></Select></Field>
                  </>
                )}
              </div>
              <CornerPin points={tr.cornerPin} onChange={(cornerPin) => setT({ cornerPin })} />
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="dim dsp-help">{audio.device === 'output' && audio.outputId === output.id ? 'Program audio plays from this output.' : ''}</span>
              <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Remove “${output.name}”? The display stays connected; it just stops showing Reach.`)) { void removeOutput(output.id); select({ selectedOutputId: null }) } }}>Remove output</Button>
            </div>
          </>
        )}
      </div>
    </Panel>
  )
}

function DisplayName({ displayKey, name }: { displayKey: string; name: string }): ReactNode {
  return (
    <Field label="Remember this display as" hint="A friendly name, e.g. “Left projector”. Reach recognises it when it is plugged back in.">
      <Input defaultValue={name} placeholder="Display name" onBlur={(e) => e.target.value !== name && void api.invoke('displays.rename', { key: displayKey, name: e.target.value })} />
    </Field>
  )
}

/** Drag the four corners to keystone / map onto an angled surface. */
export function CornerPin({ points, onChange }: { points?: [number, number][]; onChange: (p: [number, number][] | undefined) => void }): ReactNode {
  const [draft, setDraft] = useState<[number, number][] | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<number | null>(null)
  const pts = draft ?? (points && points.length === 4 ? points : DEFAULT_CORNERS)
  const W = 240, H = 135, pad = 24
  const move = (e: RPointerEvent): void => {
    if (drag.current == null || !box.current) return
    const r = box.current.getBoundingClientRect()
    const x = Math.max(-0.1, Math.min(1.1, (e.clientX - r.left - pad) / W))
    const y = Math.max(-0.1, Math.min(1.1, (e.clientY - r.top - pad) / H))
    setDraft(pts.map((p, i) => (i === drag.current ? [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000] : p)) as [number, number][])
  }
  const up = (): void => {
    drag.current = null
    if (draft) onChange(isIdentityPin(draft) ? undefined : draft)
    setDraft(null)
  }
  const poly = pts.map(([x, y]) => `${pad + x * W},${pad + y * H}`).join(' ')
  return (
    <div className="dsp-pin">
      <div className="row"><span className="dsp-sub grow">Corner pin (keystone)</span><Button size="sm" variant="ghost" disabled={isIdentityPin(points)} onClick={() => onChange(undefined)}>Reset</Button></div>
      <div ref={box} className="dsp-pin-box" style={{ width: W + pad * 2, height: H + pad * 2 }} onPointerMove={move} onPointerUp={up} onPointerLeave={up}>
        <svg width={W + pad * 2} height={H + pad * 2}>
          <rect x={pad} y={pad} width={W} height={H} fill="none" stroke="var(--border)" strokeDasharray="4 4" />
          <polygon points={poly} fill="rgba(56,134,206,.25)" stroke="var(--accent)" strokeWidth={2} />
          {pts.map(([x, y], i) => (
            <circle key={i} cx={pad + x * W} cy={pad + y * H} r={8} fill="var(--mustard)" stroke="#1b1b1b" strokeWidth={2} style={{ cursor: 'grab' }}
              onPointerDown={(e) => { drag.current = i; (e.target as Element).setPointerCapture?.(e.pointerId) }} data-corner={i} />
          ))}
        </svg>
      </div>
      <span className="dim dsp-help">Turn on the alignment grid test pattern, then drag the corners until the grid lines up with the screen’s edges.</span>
    </div>
  )
}
