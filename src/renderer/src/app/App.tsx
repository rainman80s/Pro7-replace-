import { useEffect, type ReactNode } from 'react'
import { ToastHost, toast, Button } from '@ui/index'
import { allBackground, allToolbar, allViews } from './registry'
import { api, startSync, useApp } from './store'
import './app.css'

export function App(): ReactNode {
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const ready = useApp((s) => s.ready)
  const live = useApp((s) => s.live)
  const views = allViews()
  const current = views.find((v) => v.id === view) ?? views[0]

  useEffect(() => {
    void startSync()
    return api.on('ui.notify', (n) => toast(n.title, n.level, n.detail))
  }, [])

  // ⌘/Ctrl + number switches screens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        const v = views[Number(e.key) - 1]
        if (v) { e.preventDefault(); setView(v.id) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [views, setView])

  const View = current?.component
  const clear = (layer: Parameters<typeof api.invoke<'live.clear'>>[1]['layer']) => () => void api.invoke('live.clear', { layer })
  return (
    <div className="app" data-platform={window.reachBridge?.platform ?? 'web'}>
      <header className="topbar">
        <div className="brand">Reach</div>
        <nav className="nav">
          {views.map((v) => (
            <button key={v.id} className={`nav-item ${v.id === current?.id ? 'on' : ''}`} onClick={() => setView(v.id)} title={v.shortcut}>
              {v.icon}
              <span>{v.title}</span>
            </button>
          ))}
        </nav>
        <div className="grow" />
        {allToolbar().map((t) => <t.component key={t.id} />)}
        <div className="clears">
          <Button size="sm" variant="ghost" onClick={clear('slide')} disabled={!live.slide}>Clear Slide</Button>
          <Button size="sm" variant="ghost" onClick={clear('background')} disabled={!live.background && !live.video}>Clear Media</Button>
          <Button size="sm" variant="danger" onClick={clear('all')}>Clear All</Button>
        </div>
      </header>
      <main className="main">{ready && View ? <View /> : <div className="empty">Loading…</div>}</main>
      {allBackground().map((C, i) => <C key={i} />)}
      <ToastHost />
    </div>
  )
}
