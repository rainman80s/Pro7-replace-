import { useEffect, useState, type ReactNode } from 'react'
import type { FigmaFileInfo } from '@shared/integrations'
import { Button, Input, Select, toast } from '@ui/index'
import { api, useApp } from '../../app/store'
import { Logo, StatusLine, ago, openUrl, useAction } from './common'

type FStatus = Awaited<ReturnType<typeof api.invoke<'figma.status'>>>

export function FigmaCard(): ReactNode {
  const [st, setSt] = useState<FStatus | null>(null)
  const [token, setToken] = useState('')
  const [url, setUrl] = useState('')
  const [info, setInfo] = useState<(FigmaFileInfo & { containerName: string; nodeId?: string }) | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [scale, setScale] = useState(1)
  const [smart, setSmart] = useState(true)
  const a = useAction()
  const { select, setView } = useApp()
  const load = async (): Promise<void> => setSt(await api.invoke('figma.status'))
  useEffect(() => { void load() }, [])
  const done = (r: { presentation: { id: string; title: string }; changes: unknown[]; warnings: string[] }, verb: string): void => {
    toast(`${verb} “${r.presentation.title}”`, 'success', `${r.changes.length} slide change${r.changes.length === 1 ? '' : 's'}`)
    r.warnings.slice(0, 3).forEach((w) => toast(w, 'warning'))
    void load()
  }
  return (
    <div className="ix-card" data-testid="figma-card">
      <div className="ix-card-head">
        <Logo text="F" color="#a259ff" />
        <div className="grow"><div className="ix-title">Figma — designed slides</div><StatusLine s={st} /></div>
        {st?.connected && <Button size="sm" variant="ghost" onClick={() => void a.run(async () => { await api.invoke('figma.disconnect'); await load() })}>Disconnect</Button>}
      </div>
      {st && !st.connected && (
        <>
          <div className="ix-help">Each Figma frame becomes a slide (rendered at full resolution). In Figma: <b>Settings → Security → Personal access tokens</b> → generate one with <b>File content: read</b> (<a onClick={() => openUrl('https://www.figma.com/developers/api#access-tokens')}>help</a>).</div>
          <div className="ix-row">
            <Input type="password" placeholder="figd_…" value={token} onChange={(e) => setToken(e.target.value)} style={{ flex: 1 }} data-testid="figma-token" />
            <Button variant="primary" disabled={!token || a.busy} data-testid="figma-connect" onClick={() => void a.run(async () => { await api.invoke('figma.connect', { token }); setToken(''); await load() })}>Connect</Button>
          </div>
        </>
      )}
      {st?.connected && (
        <>
          <div className="ix-row">
            <Input placeholder="Paste a Figma link to a page, section or frame" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1 }} data-testid="figma-url" />
            <Button size="sm" disabled={!url || a.busy} data-testid="figma-inspect" onClick={() => void a.run(async () => { const i = await api.invoke('figma.inspect', { url }); setInfo(i); setPicked(i.frames.map((f) => f.id)) })}>Find frames</Button>
          </div>
          {info && (
            <>
              <div className="ix-help"><b>{info.name}</b> · {info.containerName} · {info.frames.length} frames</div>
              <div className="ix-list" style={{ maxHeight: 220, overflow: 'auto' }}>
                {info.frames.map((f) => (
                  <label key={f.id} className="ix-pick">
                    <input type="checkbox" checked={picked.includes(f.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, f.id] : picked.filter((x) => x !== f.id))} />
                    <span className="grow">{f.name}</span><span className="ix-mono">{f.width}×{f.height}</span>
                  </label>
                ))}
              </div>
              <div className="ix-row">
                <Select value={String(scale)} onChange={(e) => setScale(Number(e.target.value))}><option value="1">1× (canvas size)</option><option value="2">2× (sharper, bigger files)</option></Select>
                <label className="ix-row ix-help" title="Frames named like a screen or region (“LED Top”, “Lobby”) become that screen’s version of the slide before them."><input type="checkbox" checked={smart} onChange={(e) => setSmart(e.target.checked)} /> Screen-named frames → variants</label>
                <div className="grow" />
                <Button size="sm" variant="primary" disabled={!picked.length || a.busy} data-testid="figma-import" onClick={() => void a.run(async () => { const r = await api.invoke('figma.import', { url, frameIds: picked, scale, smart }); done(r, 'Imported'); setInfo(null); select({ selectedPresentationId: r.presentation.id }) })}>{a.busy ? 'Rendering…' : `Import ${picked.length} slides`}</Button>
              </div>
            </>
          )}
          {st.linked.length > 0 && (
            <div className="ix-list">
              {st.linked.map((l) => (
                <div key={l.id}><span className="grow">{l.title}<span className="dim" style={{ fontSize: 11 }}>{l.syncedAt ? ` · synced ${ago(l.syncedAt)}` : ''}</span></span>
                  <Button size="sm" variant="ghost" onClick={() => { select({ selectedPresentationId: l.id }); setView('show') }}>Open</Button>
                  <Button size="sm" disabled={a.busy} onClick={() => void a.run(async () => done(await api.invoke('figma.resync', { presentationId: l.id }), 'Re-synced'))}>Re-sync from Figma</Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {a.error && <div className="ix-err">{a.error}</div>}
    </div>
  )
}
