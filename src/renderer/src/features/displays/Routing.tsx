import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import type { DisplayInfo, ReceiverInfo } from '@shared/api'
import type { Canvas, ID, Output } from '@shared/model'
import { isGroup, resolveOutputs, routeWarnings, type OutputHealth } from '@shared/outputs'
import { OutputSurface } from '@shared/render/LiveCanvas'
import { Button, Panel, Select, toast } from '@ui/index'
import { api, useApp } from '../../app/store'
import { Inspector } from './Inspector'
import { newLocalId, removeOutput, rescanDeckLink, saveOutput, useCanvases, useDisplays } from './state'
import { defaultDeckLinkMode, deckLinkModeLabel, type DeckLinkDevice } from '@shared/decklink'

/* ───────── helpers ───────── */

export const srcKey = (canvasId: ID, regionId?: ID): string => `${canvasId}::${regionId ?? ''}`
export const parseSrc = (k: string): { canvasId: ID; regionId?: ID } => { const [canvasId, regionId] = k.split('::'); return { canvasId, regionId: regionId || undefined } }

export function sourceName(canvases: Canvas[], canvasId: ID, regionId?: ID): string {
  const c = canvases.find((x) => x.id === canvasId)
  if (!c) return 'Deleted screen'
  const r = regionId ? c.regions.find((x) => x.id === regionId) : undefined
  return r ? `${c.name} › ${r.name}` : c.name
}

export function SourceOptions({ canvases }: { canvases: Canvas[] }): ReactNode {
  return (
    <>
      {canvases.map((c) => (
        <optgroup key={c.id} label={c.name}>
          <option value={srcKey(c.id)}>{c.name}{c.regions.length ? ' (whole screen)' : ''}</option>
          {c.regions.map((r) => <option key={r.id} value={srcKey(c.id, r.id)}>{c.name} › {r.name}</option>)}
        </optgroup>
      ))}
    </>
  )
}

const statusClass = (h?: OutputHealth): string => (!h ? 'idle' : h.status === 'live' ? 'live' : h.status === 'off' ? 'idle' : h.ok ? 'idle' : 'bad')

function useThumbnail(output: Output | undefined, health?: OutputHealth): string | null {
  const [src, setSrc] = useState<string | null>(null)
  const local = output && (output.target.type === 'display' || output.target.type === 'window' || output.target.type === 'ndi' || output.target.type === 'decklink')
  const live = health?.status === 'live'
  useEffect(() => {
    if (!output || !local || !live) { setSrc(null); return }
    let alive = true
    const tick = (): void => void api.invoke('outputs.thumbnail', { id: output.id, width: 320 }).then((s) => { if (alive) setSrc(s) }).catch(() => {})
    tick()
    const t = setInterval(tick, 2000)
    return () => { alive = false; clearInterval(t) }
  }, [output?.id, local, live])
  return src
}

/* ───────── main routing view ───────── */

export function RoutingView(): ReactNode {
  const canvases = useCanvases()
  const outputs = useApp((s) => s.outputs)
  const displays = useApp((s) => s.displays)
  const { receivers, health, selectedOutputId, select, ports, decklink } = useDisplays()
  const [dragSrc, setDragSrc] = useState<string | null>(null)
  const healthOf = (id: ID): OutputHealth | undefined => health.find((h) => h.outputId === id)
  const groupOf = useMemo(() => {
    const m = new Map<ID, Output>()
    for (const g of outputs) if (isGroup(g)) for (const id of g.target.outputIds) m.set(id, g)
    return m
  }, [outputs])
  const selected = outputs.find((o) => o.id === selectedOutputId)

  const assignDisplay = (d: DisplayInfo, key: string | null): void => {
    const existing = outputs.find((o) => o.target.type === 'display' && o.target.displayKey === d.key)
    if (!key) { if (existing) void removeOutput(existing.id); return }
    const s = parseSrc(key)
    if (existing) void saveOutput({ ...existing, ...s, enabled: true })
    else void saveOutput({ id: newLocalId(), name: d.customName || d.label, ...s, target: { type: 'display', displayKey: d.key }, enabled: true}).then((list) => {
      const o = list.find((x) => x.target.type === 'display' && x.target.displayKey === d.key)
      if (o) select({ selectedOutputId: o.id })
    })
    if (d.operator && !existing) toast('That’s the screen you are working on', 'warning', 'Reach won’t cover it unless you tick “Use this screen anyway” in the output’s settings.')
  }
  const assignReceiver = (r: ReceiverInfo, key: string | null): void => {
    const s = key ? parseSrc(key) : null
    void api.invoke('receivers.assign', { id: r.id, canvasId: s?.canvasId ?? null, regionId: s?.regionId })
  }
  const assignOutput = (o: Output, key: string): void => void saveOutput({ ...o, ...parseSrc(key) })
  const outputForPort = (d: DeckLinkDevice): Output | undefined => outputs.find((o) => o.target.type === 'decklink' && o.target.device === d.key)
  const assignPort = (d: DeckLinkDevice, key: string | null): void => {
    const existing = outputForPort(d)
    if (!key) { if (existing) void removeOutput(existing.id); return }
    const s = parseSrc(key)
    if (existing) { void saveOutput({ ...existing, ...s, enabled: true }); return }
    const mode = defaultDeckLinkMode(d.modes)
    void saveOutput({ id: newLocalId(), name: `SDI ${d.port}${d.name.includes('Duo') ? '' : ` (${d.name})`}`, ...s, target: { type: 'decklink', device: d.key, mode: mode?.id ?? 'Hp29', keying: 'none' }, enabled: true }).then((list) => {
      const o = list.find((x) => x.target.type === 'decklink' && x.target.device === d.key)
      if (o) select({ selectedOutputId: o.id })
    })
  }

  const addWindow = (): void => void saveOutput({ id: newLocalId(), name: 'Preview window', canvasId: canvases[0]?.id ?? 'main', target: { type: 'window' }, enabled: true })
  const addNdi = (): void => {
    const n = outputs.filter((o) => o.target.type === 'ndi').length + 1
    void saveOutput({ id: newLocalId(), name: `NDI ${n}`, canvasId: canvases[0]?.id ?? 'main', target: { type: 'ndi', name: `Reach ${n}` }, enabled: true, frameRate: 30 })
  }
  const addGroup = (): void => void api.invoke('outputs.saveGroup', { name: `Group ${outputs.filter(isGroup).length + 1}`, canvasId: canvases[0]?.id ?? 'main', memberIds: [], layout: { mode: 'mirror' } }).then((list) => select({ selectedOutputId: list.filter(isGroup).at(-1)?.id ?? null }))

  const drop = (fn: (key: string) => void) => ({
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes('text/x-reach-source')) { e.preventDefault(); e.dataTransfer.dropEffect = 'link' } },
    onDrop: (e: DragEvent) => { const k = e.dataTransfer.getData('text/x-reach-source'); if (k) { e.preventDefault(); fn(k) } setDragSrc(null) }
  })
  const others = outputs.filter((o) => o.target.type === 'window' || o.target.type === 'ndi')
  const groups = outputs.filter(isGroup)
  const outputForDisplay = (d: DisplayInfo): Output | undefined => outputs.find((o) => o.target.type === 'display' && o.target.displayKey === d.key)
  const outputForReceiver = (r: ReceiverInfo): Output | undefined => outputs.find((o) => o.target.type === 'network' && o.target.receiverId === r.id)

  return (
    <div className={`dsp-routing ${dragSrc ? 'dragging' : ''}`}>
      <Panel title="What to show" className="dsp-sources">
        <div className="col" style={{ padding: 10, gap: 10 }}>
          {canvases.map((c) => (
            <div key={c.id} className="dsp-source-card" style={{ ['--cc' as string]: c.color ?? '#3886CE' }}>
              <SourceChip canvas={c} label={c.name} sub={`${c.width}×${c.height}${c.kind === 'stage' ? ' · stage' : ''}`} k={srcKey(c.id)} onDrag={setDragSrc} big />
              {c.regions.map((r) => <SourceChip key={r.id} canvas={c} label={r.name} sub={`${r.rect.w}×${r.rect.h}`} k={srcKey(c.id, r.id)} onDrag={setDragSrc} />)}
            </div>
          ))}
          <p className="dim dsp-help">Drag a screen or region onto a destination, or pick it from the list on each destination.</p>
        </div>
      </Panel>

      <div className="dsp-dests col">
        <Panel title="Displays on this computer" actions={<Button size="sm" variant="ghost" onClick={() => void api.invoke('outputs.identify')}>Identify all</Button>}>
          <Arrangement displays={displays} outputs={outputs} canvases={canvases} healthOf={healthOf} onSelect={(id) => select({ selectedOutputId: id })} selectedId={selectedOutputId} dropFor={(d) => drop((k) => assignDisplay(d, k))} />
          <div className="dsp-dest-grid">
            {displays.map((d) => {
              const o = outputForDisplay(d)
              return (
                <DestCard key={d.key} kind="display" title={d.customName || d.label} subtitle={`${d.nativeSize?.width ?? d.bounds.width}×${d.nativeSize?.height ?? d.bounds.height}${d.operator ? ' · you are using this screen' : ''}${d.connected === false ? ' · unplugged' : ''}`}
                  output={o} group={o && groupOf.get(o.id)} health={o && healthOf(o.id)} canvases={canvases} selected={!!o && o.id === selectedOutputId}
                  destSize={d.nativeSize} onPick={(k) => assignDisplay(d, k)} onSelect={() => o && select({ selectedOutputId: o.id })} drop={drop((k) => assignDisplay(d, k))} dim={d.connected === false}
                  emptyHint={d.operator ? 'This is your operator screen. Reach won’t use it unless you choose to.' : 'Not used yet.'} data-display={d.key} />
              )
            })}
          </div>
        </Panel>

        <Panel title="Network displays" actions={<Button size="sm" variant="ghost" data-goto-network onClick={() => window.dispatchEvent(new CustomEvent('reach:displays-tab', { detail: 'network' }))}>Search network displays…</Button>}>
          <div className="dsp-dest-grid">
            {!receivers.length && <div className="dim dsp-help" style={{ padding: 12 }}>No TVs or browsers have connected yet. Click “Search network displays…” for the address to open on them.</div>}
            {receivers.map((r) => {
              const o = outputForReceiver(r)
              return (
                <DestCard key={r.id} kind="network" title={r.name} subtitle={`${r.width && r.height ? `${r.width}×${r.height} · ` : ''}${r.connected ? 'online' : 'offline'}${r.address ? ` · ${r.address}` : ''}`}
                  output={o} group={o && groupOf.get(o.id)} health={o && healthOf(o.id)} canvases={canvases} selected={!!o && o.id === selectedOutputId}
                  destSize={r.width && r.height ? { width: r.width, height: r.height } : undefined} onPick={(k) => assignReceiver(r, k)} onSelect={() => o && select({ selectedOutputId: o.id })}
                  drop={drop((k) => assignReceiver(r, k))} dim={!r.connected} emptyHint="Waiting for you to choose what it shows." data-receiver={r.id} />
              )
            })}
          </div>
        </Panel>

        <Panel title="SDI outputs (Blackmagic DeckLink)" actions={<Button size="sm" variant="ghost" onClick={() => void rescanDeckLink()} data-decklink-rescan>Check again</Button>}>
          <div className="dsp-dest-grid" data-decklink-panel>
            {!ports.length && <div className="dim dsp-help" style={{ padding: 12 }}>{decklink && !decklink.available ? decklink.message : 'No SDI card found on this computer. A DeckLink card’s ports show here, each one like a display: pick what it shows.'}</div>}
            {ports.map((d) => {
              const o = outputForPort(d)
              const mode = o?.target.type === 'decklink' ? d.modes.find((m) => m.id === (o.target as { mode: string }).mode) : undefined
              const keying = o?.target.type === 'decklink' ? o.target.keying ?? 'none' : 'none'
              return (
                <DestCard key={d.key} kind="decklink" title={d.key} subtitle={`${mode ? deckLinkModeLabel(mode) : d.displayName}${keying === 'external' ? ' · fill + key' : keying === 'internal' ? ' · keyed on card' : ''}${d.connected ? '' : ' · not connected'}`}
                  output={o} group={o && groupOf.get(o.id)} health={o && healthOf(o.id)} canvases={canvases} selected={!!o && o.id === selectedOutputId}
                  onPick={(k) => assignPort(d, k)} onSelect={() => o && select({ selectedOutputId: o.id })}
                  drop={drop((k) => assignPort(d, k))} dim={!d.connected} emptyHint="Not used yet." data-decklink={d.key} />
              )
            })}
          </div>
        </Panel>

        <Panel title="Groups" actions={<Button size="sm" onClick={addGroup} data-add-group>+ New group</Button>}>
          <div className="dsp-dest-grid">
            {!groups.length && <div className="dim dsp-help" style={{ padding: 12 }}>A group treats several displays as one: they all show the same thing (e.g. three lobby TVs), or one picture split across them (a video wall). Switch them on and off together.</div>}
            {groups.map((g) => (
              <DestCard key={g.id} kind="group" title={g.name} subtitle={`${g.target.type === 'group' ? g.target.outputIds.length : 0} screens · ${g.groupLayout?.mode === 'wall' ? 'split across (video wall)' : 'same picture on all'}`}
                output={g} health={healthOf(g.id)} canvases={canvases} selected={g.id === selectedOutputId} onPick={(k) => k && assignOutput(g, k)} onSelect={() => select({ selectedOutputId: g.id })}
                drop={drop((k) => assignOutput(g, k))} data-group={g.id} />
            ))}
          </div>
        </Panel>

        <Panel title="Windows & NDI" actions={<><Button size="sm" onClick={addWindow} data-add-window>+ Window</Button><Button size="sm" onClick={addNdi} data-add-ndi>+ NDI output</Button></>}>
          <div className="dsp-dest-grid">
            {!others.length && <div className="dim dsp-help" style={{ padding: 12 }}>A window is handy for a preview or for screen-sharing. NDI sends a picture over the network to OBS, vMix or a video switcher.</div>}
            {others.map((o) => (
              <DestCard key={o.id} kind={o.target.type as 'window' | 'ndi'} title={o.name} subtitle={o.target.type === 'ndi' ? `NDI source “${o.target.name}”` : 'Floating window'}
                output={o} group={groupOf.get(o.id)} health={healthOf(o.id)} canvases={canvases} selected={o.id === selectedOutputId} onPick={(k) => k && assignOutput(o, k)}
                onSelect={() => select({ selectedOutputId: o.id })} drop={drop((k) => assignOutput(o, k))} data-output-card={o.id} />
            ))}
          </div>
        </Panel>
      </div>

      {selected && <Inspector key={selected.id} output={selected} onClose={() => select({ selectedOutputId: null })} />}
    </div>
  )
}

function SourceChip({ canvas, label, sub, k, onDrag, big }: { canvas: Canvas; label: string; sub: string; k: string; onDrag: (k: string | null) => void; big?: boolean }): ReactNode {
  return (
    <div className={`dsp-chip ${big ? 'big' : ''}`} draggable data-source={k} style={{ ['--cc' as string]: canvas.color ?? '#3886CE' }}
      onDragStart={(e) => { e.dataTransfer.setData('text/x-reach-source', k); e.dataTransfer.effectAllowed = 'link'; onDrag(k) }} onDragEnd={() => onDrag(null)}>
      <span className="dsp-grip">⋮⋮</span>
      <span className="grow"><strong>{label}</strong> <span className="dim">{sub}</span></span>
    </div>
  )
}

type DropProps = { onDragOver: (e: DragEvent) => void; onDrop: (e: DragEvent) => void }

function DestCard(p: {
  kind: 'display' | 'network' | 'group' | 'window' | 'ndi' | 'decklink'; title: string; subtitle: string; output?: Output; group?: Output; health?: OutputHealth; canvases: Canvas[]
  selected: boolean; destSize?: { width: number; height: number }; onPick: (k: string | null) => void; onSelect: () => void; drop: DropProps; dim?: boolean; emptyHint?: string; [k: `data-${string}`]: string
}): ReactNode {
  const { output, group, health, canvases } = p
  const outputs = useApp((s) => s.outputs)
  const live = useApp((s) => s.live)
  const ws = useApp((s) => s.workspace)
  const thumb = useThumbnail(output && !isGroup(output) ? output : undefined, health)
  const resolved = useMemo(() => (output ? resolveOutputs(outputs, canvases).get(output.id) : undefined), [output, outputs, canvases])
  const effective = group ?? output
  const value = effective ? srcKey(effective.canvasId, effective.regionId) : ''
  const canvas = canvases.find((c) => c.id === (resolved?.canvasId ?? effective?.canvasId))
  const warnings = output && canvas && resolved?.crop && p.destSize
    ? routeWarnings({ sourceName: sourceName(canvases, resolved.canvasId, resolved.regionId), source: { width: resolved.crop.w, height: resolved.crop.h }, destName: p.kind === 'network' ? `“${p.title}”` : 'This display', dest: p.destSize, fit: output.transform?.fit, rotate: output.transform?.rotate })
    : []
  const dataAttrs = Object.fromEntries(Object.entries(p).filter(([k]) => k.startsWith('data-')))
  return (
    <div {...dataAttrs} className={`dsp-dest ${p.selected ? 'on' : ''} ${p.dim ? 'dim-card' : ''} ${statusClass(health)}`} {...p.drop} onClick={p.onSelect}>
      <div className="row dsp-dest-head">
        <span className={`dsp-dot ${statusClass(health)}`} title={health?.message} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="dsp-dest-title">{p.title}</div>
          <div className="dim dsp-dest-sub">{p.subtitle}</div>
        </div>
        <span className="dsp-kind">{({ display: 'Display', network: 'Network', group: 'Group', window: 'Window', ndi: 'NDI', decklink: 'SDI' })[p.kind]}</span>
      </div>
      <div className="dsp-thumb">
        {thumb ? <img src={thumb} alt="" /> : output && canvas && resolved?.crop && output.enabled
          ? <div className="dsp-thumb-live"><OutputSurface canvas={canvas} crop={resolved.crop} live={live} workspace={ws ?? undefined} /></div>
          : <div className="dsp-thumb-empty">{output ? (output.enabled ? '' : 'Off') : p.emptyHint ?? 'Not used'}</div>}
        {output?.testPattern && <span className="dsp-badge">Test pattern</span>}
      </div>
      <div className="row" onClick={(e) => e.stopPropagation()}>
        <Select className="grow" value={value} disabled={!!group} onChange={(e) => p.onPick(e.target.value || null)} aria-label={`What ${p.title} shows`} title={group ? `Follows the group “${group.name}”` : undefined}>
          {p.kind !== 'group' && p.kind !== 'window' && p.kind !== 'ndi' && <option value="">— Nothing —</option>}
          <SourceOptions canvases={canvases} />
        </Select>
        {output && <Button size="sm" variant="ghost" onClick={() => void api.invoke('outputs.identifyOne', { id: output.id })} title="Flash this output’s name on it">Identify</Button>}
      </div>
      {group && <div className="dsp-note">Part of group “{group.name}”</div>}
      {health && !health.ok && <div className="dsp-warn bad">{health.message}</div>}
      {warnings.map((w, i) => <div key={i} className={`dsp-warn ${w.level}`}>{w.text}</div>)}
    </div>
  )
}

/** Local displays drawn in their real arrangement (like the OS display settings). */
function Arrangement({ displays, outputs, canvases, healthOf, onSelect, selectedId, dropFor }: { displays: DisplayInfo[]; outputs: Output[]; canvases: Canvas[]; healthOf: (id: ID) => OutputHealth | undefined; onSelect: (id: ID) => void; selectedId: ID | null; dropFor: (d: DisplayInfo) => DropProps }): ReactNode {
  const live = displays.filter((d) => d.connected !== false)
  if (!live.length) return null
  const minX = Math.min(...live.map((d) => d.bounds.x)), minY = Math.min(...live.map((d) => d.bounds.y))
  const maxX = Math.max(...live.map((d) => d.bounds.x + d.bounds.width)), maxY = Math.max(...live.map((d) => d.bounds.y + d.bounds.height))
  const k = Math.min(560 / (maxX - minX), 150 / (maxY - minY))
  return (
    <div className="dsp-arrangement" style={{ height: (maxY - minY) * k + 16 }}>
      <div style={{ position: 'relative', width: (maxX - minX) * k, height: (maxY - minY) * k }}>
        {live.map((d) => {
          const o = outputs.find((x) => x.target.type === 'display' && x.target.displayKey === d.key)
          const h = o && healthOf(o.id)
          return (
            <div key={d.key} className={`dsp-monitor ${d.operator ? 'operator' : ''} ${o && o.id === selectedId ? 'on' : ''} ${statusClass(h)}`} {...dropFor(d)} onClick={() => o && onSelect(o.id)}
              style={{ left: (d.bounds.x - minX) * k, top: (d.bounds.y - minY) * k, width: d.bounds.width * k - 4, height: d.bounds.height * k - 4 }}>
              <strong>{d.customName || d.label}</strong>
              <span>{d.operator ? 'You are here' : o ? sourceName(canvases, o.canvasId, o.regionId) : 'Not used'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
