import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { getApi, onConnection } from '@shared/client'
import { emptyLiveState, type LiveState, type Playlist } from '@shared/model'
import { formatTimer, liveSummary, messageFields, timerLevel, timerValue, type MessagesDoc, type TimersDoc } from '@shared/control'
import '../ui/fonts.css'
import '../ui/tokens.css'
import './remote.css'

const api = getApi()
const q = new URLSearchParams(location.search)
try { if (q.get('token')) localStorage.setItem('reach.token', q.get('token')!) } catch { /* private mode */ }

function PinGate({ onRetry, bad }: { onRetry: () => void; bad: boolean }): ReactNode {
  const [pin, setPin] = useState('')
  const go = (e: React.FormEvent): void => {
    e.preventDefault()
    try { localStorage.setItem('reach.token', pin.trim()) } catch { /* ignore */ }
    // The connection reads the PIN when it opens, so reconnect with it.
    location.replace(location.pathname + '?token=' + encodeURIComponent(pin.trim()))
    onRetry()
  }
  return (
    <form className="rm" onSubmit={go}>
      <h1>Reach Remote</h1>
      <div className="rm-card">
        <div className="rm-label">Type the PIN shown on the main computer</div>
        <input className="rm-in rm-pin" name="pin" inputMode="numeric" autoComplete="off" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} aria-label="PIN" />
        {bad && <div className="rm-err">That PIN didn’t work. Check Settings → Remote &amp; API.</div>}
      </div>
      <button className="rm-btn primary" type="submit" disabled={pin.length < 4}>Connect</button>
    </form>
  )
}

function useDoc<T>(method: 'timers.list' | 'messages.list', name: string): T | null {
  const [d, setD] = useState<T | null>(null)
  useEffect(() => {
    const load = (): void => { void (api.invoke as (m: string) => Promise<T>)(method).then(setD).catch(() => {}) }
    load()
    return api.on('workspace.docChanged', (e) => { if (e.name === name) load() })
  }, [method, name])
  return d
}

function Remote(): ReactNode {
  const [live, setLive] = useState<LiveState>(emptyLiveState())
  const [connected, setConnected] = useState(true)
  const [auth, setAuth] = useState<'checking' | 'ok' | 'bad'>('checking')
  const [lists, setLists] = useState<Playlist[]>([])
  const [stage, setStage] = useState('')
  const [now, setNow] = useState(Date.now())
  const timers = useDoc<TimersDoc>('timers.list', 'timers')
  const messages = useDoc<MessagesDoc>('messages.list', 'messages')
  const call = useCallback((m: string, p?: unknown): void => { void (api.invoke as (m: string, p?: unknown) => Promise<unknown>)(m, p).catch(() => {}) }, [])

  useEffect(() => onConnection(setConnected), [])
  useEffect(() => {
    if (!connected) return
    api.invoke('remote.hello').then(() => {
      setAuth('ok')
      void api.invoke('live.get').then(setLive)
      void api.invoke('playlists.list').then(setLists)
    }).catch(() => setAuth('bad'))
  }, [connected])
  useEffect(() => {
    const offs = [api.on('live.changed', setLive), api.on('playlists.changed', () => void api.invoke('playlists.list').then(setLists))]
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => { offs.forEach((o) => o()); clearInterval(t) }
  }, [])

  if (auth === 'bad') return <PinGate bad={!!q.get('token') || !!localStorage.getItem('reach.token')} onRetry={() => {}} />
  if (auth === 'checking') return <div className="rm"><h1>Reach Remote</h1><div className="rm-conn off"><i />Connecting…</div></div>

  const sum = liveSummary(live)
  const list = lists.find((l) => l.id === live.slide?.playlistId) ?? lists[0]
  const items = list?.items ?? []
  const clears: [string, string][] = [['All', 'all'], ['Slide', 'slide'], ['Props', 'props'], ['Messages', 'message']]

  return (
    <div className="rm" data-testid="remote">
      <div className="rm-top">
        <h1>Reach Remote</h1>
        <span className={`rm-conn ${connected ? '' : 'off'}`}><i />{connected ? 'Connected' : 'Reconnecting…'}</span>
      </div>

      <div className="rm-card">
        <div className="rm-label">On screen now{sum.title ? ` · ${sum.title}` : ''}{sum.label ? ` · ${sum.label}` : ''}</div>
        <div className="rm-slide" data-testid="rm-current">{sum.current || <span style={{ color: 'var(--text-faint)' }}>Nothing on screen</span>}</div>
        {sum.next && <><div className="rm-label" style={{ marginTop: 10 }}>Next</div><div className="rm-next" data-testid="rm-next">{sum.next}</div></>}
      </div>

      <div className="rm-nav">
        <button className="rm-btn big" onClick={() => call('live.prev')}>◀ Back</button>
        <button className="rm-btn big primary" data-testid="rm-next-btn" onClick={() => call('live.next')}>Next ▶</button>
      </div>

      <div className="rm-grid">
        {clears.map(([label, layer]) => <button key={layer} className="rm-btn sm" onClick={() => call('live.clear', { layer })}>Clear {label.toLowerCase()}</button>)}
        <button className={`rm-btn sm ${live.blackout ? 'on' : ''}`} onClick={() => call('live.setFlag', { flag: 'blackout', value: !live.blackout })}>Black screen</button>
        <button className={`rm-btn sm ${live.logo ? 'on' : ''}`} onClick={() => call('live.setFlag', { flag: 'logo', value: !live.logo })}>Logo</button>
      </div>

      {items.length > 0 && (
        <div className="rm-card">
          <div className="rm-label">Service · {list?.name}</div>
          <div className="rm-items">
            {items.map((it) => it.type === 'presentation'
              ? <button key={it.id} className={`rm-btn sm rm-item ${live.slide?.playlistItemId === it.id ? 'cur' : ''}`}
                  onClick={() => call('live.goToSlide', { presentationId: it.presentationId, index: 0, playlistId: list!.id, playlistItemId: it.id, arrangementId: it.arrangementId })}>{it.title || 'Untitled'}</button>
              : <div key={it.id} className="rm-label" style={{ marginTop: 6 }}>{it.title}</div>)}
          </div>
        </div>
      )}

      {live.timers.length > 0 && (
        <div className="rm-card">
          <div className="rm-label">Timers</div>
          {live.timers.map((t) => (
            <div key={t.id} className="rm-timer">
              <b>{t.name}</b>
              <span className={`rm-time ${timerLevel(timers?.timers.find((d) => d.id === t.id), t, now)}`}>{formatTimer(timerValue(t, now))}</span>
              {t.kind !== 'countdownTo' && <button className={`rm-btn sm ${t.running ? 'on' : ''}`} style={{ flex: 'none' }}
                onClick={() => call('timers.control', { id: t.id, action: t.running ? 'stop' : 'start' })}>{t.running ? 'Pause' : 'Start'}</button>}
              <button className="rm-btn sm" style={{ flex: 'none' }} onClick={() => call('timers.control', { id: t.id, action: 'reset' })}>↺</button>
            </div>
          ))}
        </div>
      )}

      {!!messages?.messages.length && (
        <div className="rm-card">
          <div className="rm-label">Messages</div>
          <div className="rm-grid">
            {messages.messages.filter((m) => messageFields(m.text).length === 0).map((m) => {
              const on = live.messages.some((x) => x.id === m.id)
              return <button key={m.id} className={`rm-btn sm ${on ? 'on' : ''}`} onClick={() => call(on ? 'messages.hide' : 'messages.show', { id: m.id })}>{m.name}</button>
            })}
          </div>
        </div>
      )}

      <div className="rm-card">
        <div className="rm-label">Stage message{live.stageMessage ? ` · showing “${live.stageMessage}”` : ''}</div>
        <form className="rm-row" onSubmit={(e) => { e.preventDefault(); if (stage.trim()) call('messages.stage', { text: stage.trim(), flash: true }) }}>
          <input className="rm-in" style={{ flex: 3 }} value={stage} onChange={(e) => setStage(e.target.value)} placeholder="Only the band and stage see this" aria-label="Stage message" />
          <button className="rm-btn sm primary" type="submit">Send</button>
        </form>
        <div className="rm-chips">
          {(messages?.stagePresets ?? []).map((p) => <button key={p} className="rm-chip" onClick={() => call('messages.stage', { text: p, flash: true })}>{p}</button>)}
          {live.stageMessage && <button className="rm-chip" onClick={() => { setStage(''); call('messages.stage', { text: '' }) }}>Clear</button>}
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Remote />)
