import { useEffect, useState, type ReactNode } from 'react'
import { Button, Input, toast } from '@ui/index'
import { api } from '../../app/store'
import { Logo, StatusLine, useAction } from './common'

type OStatus = Awaited<ReturnType<typeof api.invoke<'obs.status'>>>

export function ObsCard(): ReactNode {
  const [st, setSt] = useState<OStatus | null>(null)
  const [url, setUrl] = useState('ws://127.0.0.1:4455')
  const [pw, setPw] = useState('')
  const a = useAction()
  useEffect(() => { void api.invoke('obs.status').then((s) => { setSt(s); if (s.url) setUrl(s.url) }).catch(() => {}) }, [])
  return (
    <div className="ix-card" data-testid="obs-card">
      <div className="ix-card-head">
        <Logo text="OBS" color="#302e31" />
        <div className="grow"><div className="ix-title">OBS Studio — livestream scenes</div><StatusLine s={st} offText="Not set up on this computer" /></div>
      </div>
      <div className="ix-help">Switch OBS scenes when a slide goes live (slide action <span className="ix-mono">obs.setScene</span>), or start/stop the stream from a macro (<span className="ix-mono">obs.request</span>). In OBS: <b>Tools → WebSocket Server Settings</b> → enable, copy the password.</div>
      <div className="ix-row">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 2 }} />
        <Input type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ flex: 1 }} />
        <Button size="sm" disabled={a.busy} onClick={() => void a.run(async () => { const s = await api.invoke('obs.connect', { url, password: pw }); setSt(s); toast(`OBS connected — ${s.scenes.length} scenes`, 'success') })}>{st?.connected ? 'Reconnect' : 'Connect'}</Button>
      </div>
      {!!st?.scenes.length && <div className="ix-row">{st.scenes.map((s) => <Button key={s} size="sm" variant="ghost" onClick={() => void api.invoke('live.runAction', { type: 'obs.setScene', params: { scene: s } })}>{s}</Button>)}</div>}
      {a.error && <div className="ix-err">{a.error}</div>}
    </div>
  )
}
