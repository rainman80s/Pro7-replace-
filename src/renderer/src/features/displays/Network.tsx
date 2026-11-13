import { useMemo, useState, type ReactNode } from 'react'
import qrcode from 'qrcode-generator'
import type { ReceiverInfo } from '@shared/api'
import { Button, Field, Input, Panel, Select, toast } from '@ui/index'
import { api, useApp } from '../../app/store'
import { SourceOptions, parseSrc, sourceName, srcKey } from './Routing'
import { useCanvases, useDisplays } from './state'

export function QrCode({ text, size = 148 }: { text: string; size?: number }): ReactNode {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(text)
    qr.make()
    return qr.createSvgTag({ cellSize: Math.max(2, Math.floor(size / (qr.getModuleCount() + 4))), margin: 2, scalable: true })
  }, [text, size])
  return <div className="dsp-qr" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />
}

const ago = (t: number): string => {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} days ago`
}

export function NetworkView(): ReactNode {
  const { discovery, receivers } = useDisplays()
  const outputs = useApp((s) => s.outputs)
  const canvases = useCanvases()
  const [searching, setSearching] = useState(false)
  const urls = discovery?.urls ?? []
  const [urlIdx, setUrlIdx] = useState(0)
  const url = urls[urlIdx] ?? urls[0] ?? ''
  const search = (): void => {
    setSearching(true)
    void api.invoke('discovery.scan', { refresh: true }).then((d) => useDisplays.setState({ discovery: d })).finally(() => setTimeout(() => setSearching(false), 2500))
  }
  const online = receivers.filter((r) => r.connected)
  const offline = receivers.filter((r) => !r.connected)
  const found = discovery?.devices ?? []
  const base = url.replace(/\/output\.html$/, '')
  return (
    <div className="dsp-network">
      <Panel title="Connect a TV, Raspberry Pi or browser" actions={<Button variant="primary" size="sm" onClick={search} disabled={searching} data-search-network>{searching ? 'Searching…' : 'Search network displays'}</Button>}>
        <div className="row dsp-connect" style={{ alignItems: 'flex-start' }}>
          {url && <QrCode text={url} />}
          <div className="col grow">
            <ol className="dsp-steps">
              <li>Connect the TV (or a Raspberry Pi / Fire TV stick plugged into it) to the <b>same network</b> as this computer — Ethernet is best.</li>
              <li>Open its web browser and go to:<div className="dsp-url" data-url>{url || 'starting…'}</div>{urls.length > 1 && <Select style={{ width: 'auto', marginTop: 4 }} value={urlIdx} onChange={(e) => setUrlIdx(Number(e.target.value))} aria-label="Other addresses">{urls.map((u, i) => <option key={u} value={i}>{u}</option>)}</Select>}</li>
              <li>It appears below within a few seconds. Choose what it shows. Reach remembers it — after a reboot it comes straight back.</li>
            </ol>
            <span className="dim dsp-help">Tip: add <code>?name=Lobby%20Left</code> to the address to name it, and <code>&amp;receiverId=lobby-left</code> on kiosks that forget their storage. Tap the TV screen once to go full screen. {discovery?.advertising ? `Advertised on the network as “${discovery.serviceName}”.` : discovery?.error ? discovery.error : ''}</span>
          </div>
        </div>
      </Panel>

      <Panel title={`Network displays (${online.length} online)`}>
        <div className="col" style={{ padding: 10, gap: 6 }}>
          {!receivers.length && <div className="dim dsp-help">None yet. Open the address above on a TV or browser.</div>}
          {[...online, ...offline].map((r) => <ReceiverRow key={r.id} r={r} canvases={canvases} assignedTo={outputs.find((o) => o.target.type === 'network' && o.target.receiverId === r.id)} />)}
        </div>
      </Panel>

      {receivers.length > 1 && <VideoWallWizard receivers={receivers} />}

      <Panel title="Other devices found on the network">
        <div className="col" style={{ padding: 10, gap: 8 }}>
          {!found.length && <div className="dim dsp-help">{searching ? 'Looking…' : 'Nothing else found. (Some church and guest Wi-Fi networks block discovery — the address and QR code above still work.)'}</div>}
          {found.map((d) => (
            <div key={d.id} className="dsp-found">
              <div className="row"><strong className="grow">{d.name}</strong><span className="dsp-kind">{({ cast: 'Chromecast / Google TV', airplay: 'AirPlay', reach: 'Reach Presenter', 'receiver-capable': 'Device' })[d.kind]}</span></div>
              <div className="dim">{[d.model, ...d.addresses].filter(Boolean).join(' · ')}</div>
              <div className="dsp-help">{d.hint}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Live stream overlays (OBS, vMix browser source)">
        <div className="col" style={{ padding: 12, gap: 6 }}>
          <span className="dsp-help">Add a <b>Browser source</b> in OBS with one of these addresses (size = the screen’s pixel size). The background is transparent, so lyrics sit over your camera shot.</span>
          {canvases.filter((c) => c.kind === 'audience').map((c) => (
            <div key={c.id} className="row"><span style={{ width: 160 }}>{c.name}</span><code className="dsp-url small grow">{base}/output.html?canvasId={c.id}&amp;transparent=1</code><Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(`${base}/output.html?canvasId=${c.id}&transparent=1`).then(() => toast('Copied'))}>Copy</Button></div>
          ))}
          <span className="dim dsp-help">For a lyrics-only stream, make a screen with the “Stream overlay” preset (no backgrounds or videos).</span>
        </div>
      </Panel>
    </div>
  )
}

function ReceiverRow({ r, canvases, assignedTo }: { r: ReceiverInfo; canvases: ReturnType<typeof useCanvases>; assignedTo?: { canvasId: string; regionId?: string } }): ReactNode {
  const [name, setName] = useState(r.name)
  return (
    <div className={`dsp-receiver row ${r.connected ? '' : 'dim-card'}`} data-receiver-row={r.id}>
      <span className={`dsp-dot ${r.connected ? 'live' : 'idle'}`} />
      <Input style={{ width: 180 }} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== r.name && void api.invoke('receivers.rename', { id: r.id, name })} aria-label="Receiver name" />
      <span className="dim" style={{ width: 230 }}>{r.connected ? 'Online' : `Offline · last seen ${ago(r.lastSeen)}`}{r.width ? ` · ${r.width}×${r.height}` : ''}{r.address ? ` · ${r.address}` : ''}{r.connected && r.rttMs != null ? ` · ${r.rttMs} ms` : ''}</span>
      <Select className="grow" value={assignedTo ? srcKey(assignedTo.canvasId, assignedTo.regionId) : ''} onChange={(e) => { const s = e.target.value ? parseSrc(e.target.value) : null; void api.invoke('receivers.assign', { id: r.id, canvasId: s?.canvasId ?? null, regionId: s?.regionId }) }} aria-label={`What ${r.name} shows`}>
        <option value="">— Nothing (shows “ready”) —</option>
        <SourceOptions canvases={canvases} />
      </Select>
      <Button size="sm" variant="ghost" onClick={() => void api.invoke('outputs.identifyOne', { id: r.id })} disabled={!r.connected}>Identify</Button>
      <Button size="sm" variant="ghost" disabled={r.connected} title={r.connected ? 'Only offline displays can be forgotten' : undefined} onClick={() => { if (confirm(`Forget “${r.name}”?`)) void api.invoke('receivers.forget', { id: r.id }) }}>Forget</Button>
    </div>
  )
}

/** "Three TVs over Ethernet as one display": pick receivers + a screen → a video-wall group (or a mirror group). */
function VideoWallWizard({ receivers }: { receivers: ReceiverInfo[] }): ReactNode {
  const canvases = useCanvases()
  const outputs = useApp((s) => s.outputs)
  const [picked, setPicked] = useState<string[]>([])
  const [src, setSrc] = useState(canvases[0] ? srcKey(canvases[0].id) : '')
  const [mode, setMode] = useState<'wall' | 'mirror'>('wall')
  const [name, setName] = useState('TV wall')
  const create = async (): Promise<void> => {
    const s = parseSrc(src)
    let list = outputs
    for (const id of picked) if (!list.some((o) => o.target.type === 'network' && o.target.receiverId === id)) list = await api.invoke('receivers.assign', { id, canvasId: s.canvasId, regionId: s.regionId })
    const memberIds = picked.map((id) => list.find((o) => o.target.type === 'network' && o.target.receiverId === id)!.id)
    await api.invoke('outputs.saveGroup', { name, ...s, memberIds, layout: mode === 'wall' ? { mode: 'wall', columns: picked.length, rows: 1 } : { mode: 'mirror' } })
    toast(`Group “${name}” created`, 'success', mode === 'wall' ? `${sourceName(canvases, s.canvasId, s.regionId)} is split across ${picked.length} screens, left to right.` : undefined)
    setPicked([])
  }
  return (
    <Panel title="Make several network displays act as one">
      <div className="col" style={{ padding: 12, gap: 8 }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {receivers.map((r) => (
            <label key={r.id} className={`dsp-pick ${picked.includes(r.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={picked.includes(r.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.id] : picked.filter((x) => x !== r.id))} />
              {picked.includes(r.id) && <b>{picked.indexOf(r.id) + 1}</b>} {r.name}
            </label>
          ))}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Field label="Group name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Shows"><Select value={src} onChange={(e) => setSrc(e.target.value)}><SourceOptions canvases={canvases} /></Select></Field>
          <Field label="How">
            <Select value={mode} onChange={(e) => setMode(e.target.value as 'wall')}><option value="wall">Split the picture across them (left to right, in the order ticked)</option><option value="mirror">Same picture on every one</option></Select>
          </Field>
          <Field label=" "><Button variant="primary" disabled={picked.length < 2 || !name.trim()} onClick={() => void create()}>Create group</Button></Field>
        </div>
      </div>
    </Panel>
  )
}
