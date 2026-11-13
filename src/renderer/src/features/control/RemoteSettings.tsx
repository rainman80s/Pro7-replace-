import { useState, type ReactNode } from 'react'
import { Button, Field, Input, Select, toast } from '@ui/index'
import { api } from '../../app/store'
import { attempt, useRpc } from './hooks'

const ENDPOINTS: [string, string][] = [
  ['GET /api/v1/status · /live', 'What is on screen now'],
  ['GET /api/v1/next · /prev', 'Next / previous slide'],
  ['GET /api/v1/slide/{number} · /section/{name}', 'Go to a slide or a song section'],
  ['GET /api/v1/clear/{layer}', 'Clear all, slide, media, props, audio, messages'],
  ['GET /api/v1/blackout/{on|off|toggle}', 'Black screen'],
  ['GET /api/v1/timer/{id}/{start|stop|reset}', 'Timers'],
  ['GET /api/v1/message/{id}/show · /hide', 'Messages'],
  ['PUT /api/v1/stage-message', 'Stage screen message'],
  ['GET /api/v1/macro/{id}', 'Run a macro'],
  ['GET /api/v1/trigger/{name}', 'Fire an automation'],
  ['GET /v1/status/slide · /v1/timers · /v1/trigger/next', 'ProPresenter-compatible (Companion, Stream Deck)']
]

export function RemoteSettings(): ReactNode {
  const [s, reload] = useRpc('remote.settings')
  const [osc, setOsc] = useState<string | null>(null)
  if (!s) return null
  const configure = (p: Parameters<typeof api.invoke<'remote.configure'>>[1]): void => void attempt(api.invoke('remote.configure', p), toast).then(() => reload())
  const base = s.urls[0] ?? `http://localhost:${s.port}`
  return (
    <div className="ctl-settings col" data-testid="remote-settings">
      <p className="dim">Open this address on a phone or tablet on the same Wi-Fi, then type the PIN. It lets a helper move slides, clear the screen and start timers.</p>
      <div className="ctl-bigurl">
        {s.urls.length ? s.urls.map((u) => <div key={u} className="ctl-mono">{u.replace(/\/$/, '')}/remote</div>) : <div className="ctl-mono">http://localhost:{s.port}/remote</div>}
        <div className="ctl-pin">PIN <b data-testid="remote-pin">{s.pin}</b></div>
        <Button size="sm" onClick={() => { if (confirm('Make a new PIN? Phones that use the old one will have to type the new one.')) configure({ newPin: true }) }}>New PIN</Button>
      </div>
      <Field label="ProPresenter-compatible address (for Companion and Stream Deck)" hint="Uses the same port. Needs the PIN unless you choose “Anyone on the network”.">
        <Select value={s.compat} onChange={(e) => configure({ compat: e.target.value as typeof s.compat })}>
          <option value="pin">On — PIN needed</option>
          <option value="open">On — anyone on the network</option>
          <option value="off">Off</option>
        </Select>
      </Field>
      <Field label="OSC port (0 = off)" hint="Lets lighting and sound desks send commands like /reach/next">
        <Input type="number" min={0} max={65535} value={osc ?? s.oscPort} onChange={(e) => setOsc(e.target.value)} onBlur={() => { if (osc !== null) { configure({ oscPort: Number(osc) || 0 }); setOsc(null) } }} />
      </Field>
      <div className="ctl-sub">What other programs can do</div>
      <div className="ctl-table">
        {ENDPOINTS.map(([e, d]) => <div key={e} className="ctl-tr"><span className="ctl-mono grow">{e}</span><span className="dim">{d}</span></div>)}
      </div>
      <p className="dim">Send the PIN as <span className="ctl-mono">?token=PIN</span> or <span className="ctl-mono">Authorization: Bearer PIN</span>. Example: <span className="ctl-mono">{base.replace(/\/$/, '')}/api/v1/next?token={s.pin}</span></p>
    </div>
  )
}
