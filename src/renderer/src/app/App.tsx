import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { slideText } from '@shared/model'
import { Button, ErrorBoundary, Icon, IconButton, Kbd, Logo, Spinner, Tooltip, UIHost, overlayOpen, toast } from '@ui/index'
import { allBackground, allStatusItems, allToolbar, allViews } from './registry'
import { api, startSync, useApp } from './store'
import { toggleLock } from './lock'
import { StatusItem } from './status'
import './app.css'

/** Default icons for the well-known screens, so the nav looks whole even if a feature forgets one. */
const NAV_ICONS: Record<string, string> = { show: 'show', edit: 'edit', media: 'media', bible: 'bible', displays: 'displays', integrations: 'integrations', settings: 'settings' }

const isTyping = (e: KeyboardEvent): boolean => !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')

export function App(): ReactNode {
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const ready = useApp((s) => s.ready)
  const locked = useApp((s) => s.locked)
  const scale = useApp((s) => s.prefs.scale)
  const setOverlay = useApp((s) => s.setOverlay)
  const views = useMemo(() => allViews().filter((v) => !locked || v.id === 'show' || v.volunteer), [locked])
  const current = views.find((v) => v.id === view) ?? views[0]

  useEffect(() => {
    void startSync()
    return api.on('ui.notify', (n) => toast(n.title, n.level, n.detail))
  }, [])

  useEffect(() => { document.documentElement.style.zoom = scale === 1 ? '' : String(scale) }, [scale])

  // App-wide keys: ⌘/Ctrl+number switches screens, ⌘/Ctrl+K searches, ? lists the shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && /^[1-9]$/.test(e.key)) {
        const v = views[Number(e.key) - 1]
        if (v) { e.preventDefault(); setView(v.id) }
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOverlay(useApp.getState().overlay === 'search' ? null : 'search')
      } else if (e.key === '?' && !isTyping(e) && !overlayOpen()) {
        e.preventDefault()
        setOverlay('shortcuts')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [views, setView, setOverlay])

  const View = current?.component
  return (
    <div className={`app ${locked ? 'is-locked' : ''}`} data-platform={window.reachBridge?.platform ?? 'web'} data-view={current?.id}>
      <header className="topbar">
        <Tooltip label="About Reach Presenter">
          <button type="button" className="brand" aria-label="About Reach Presenter" onClick={() => setOverlay('about')}>
            <Logo variant="wordmark" height={19} />
          </button>
        </Tooltip>
        <nav className="nav" aria-label="Screens">
          {views.map((v, i) => (
            <Tooltip key={v.id} label={v.title} shortcut={i < 9 ? `${window.reachBridge?.platform === 'darwin' ? '⌘' : 'Ctrl+'}${i + 1}` : undefined}>
              <button type="button" className={`nav-item ${v.id === current?.id ? 'on' : ''}`} aria-current={v.id === current?.id ? 'page' : undefined} data-testid={`nav-${v.id}`} onClick={() => setView(v.id)}>
                {v.icon ?? <Icon name={NAV_ICONS[v.id] ?? 'slides'} size={15} />}
                <span>{v.title}</span>
              </button>
            </Tooltip>
          ))}
        </nav>
        <div className="grow" />
        {allToolbar().map((t) => <ErrorBoundary key={t.id} name={t.id} fallback={() => null}><t.component /></ErrorBoundary>)}
        <LivePill />
        <button type="button" className="search-trigger" data-testid="open-search" onClick={() => setOverlay('search')}>
          <Icon name="search" size={14} /><span>Find a song or slide</span><Kbd keys="mod+K" />
        </button>
        <IconButton icon="keyboard" label="Keyboard shortcuts" shortcut="?" data-testid="open-shortcuts" onClick={() => setOverlay('shortcuts')} />
        {locked
          ? <Button size="sm" icon="lock" className="lock-on" data-testid="lock-toggle" onClick={toggleLock}>Volunteer mode</Button>
          : <IconButton icon="unlock" label="Switch to Volunteer mode (hides editing and settings)" data-testid="lock-toggle" onClick={toggleLock} />}
      </header>
      <main className="main">
        {ready && View
          ? <ErrorBoundary name={`The ${current.title} screen`} resetKey={current.id}><View /></ErrorBoundary>
          : <div className="boot"><Logo variant="combo" height={96} /><Spinner label="Starting Reach Presenter" /></div>}
      </main>
      <StatusStrip />
      {allBackground().map((C, i) => <ErrorBoundary key={i} name="A background helper" fallback={() => null}><C /></ErrorBoundary>)}
      <UIHost />
    </div>
  )
}

/** Always-visible answer to "is something on the screens right now?" — from any screen in the app. */
function LivePill(): ReactNode {
  const live = useApp((s) => s.live)
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const text = live.slide ? slideText(live.slide.slide).split('\n')[0] : ''
  const state = live.blackout ? 'Screens are black' : live.logo ? 'Logo is showing' : live.slide ? (live.slide.presentationTitle || 'Slide') : live.video ? 'Video playing' : live.background ? 'Background only' : null
  if (view === 'show') return null
  return (
    <Tooltip label={state ? 'Something is on the screens. Click to go to Show.' : 'Nothing is on the screens. Click to go to Show.'}>
      <button type="button" className={`live-pill ${state ? 'on' : ''}`} data-testid="live-pill" onClick={() => setView('show')}>
        <span className={`dot ${state ? 'live' : ''}`} />
        <span className="live-pill-label">{state ? 'Live' : 'Clear'}</span>
        {state && <span className="live-pill-text truncate">{state}{live.slide && !live.blackout && !live.logo && text ? ` — ${text}` : ''}</span>}
      </button>
    </Tooltip>
  )
}

function StatusStrip(): ReactNode {
  const outputs = useApp((s) => s.outputs)
  const displays = useApp((s) => s.displays)
  const workspace = useApp((s) => s.workspace)
  const locked = useApp((s) => s.locked)
  const setView = useApp((s) => s.setView)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 10_000); return () => clearInterval(t) }, [])

  // Built-in health check: is anything actually going to a screen?
  const enabled = outputs.filter((o) => o.enabled)
  const missing = enabled.filter((o) => o.target.type === 'display' && !displays.some((d) => o.target.type === 'display' && d.key === o.target.displayKey))
  const goDisplays = locked ? undefined : () => setView('displays')
  const screens = !enabled.length
    ? <StatusItem tone="warn" testId="status-screens" label="No screens set up" detail={locked ? 'Nothing is being sent to a screen. Ask your tech lead to set up Displays.' : 'Nothing is being sent to a screen yet. Click to set up Displays.'} onClick={goDisplays} />
    : missing.length
      ? <StatusItem tone="danger" testId="status-screens" label={`${missing.length} screen${missing.length > 1 ? 's' : ''} unplugged`} detail={`Can't find: ${missing.map((o) => o.name).join(', ')}. Check the cable — it reconnects by itself.`} onClick={goDisplays} />
      : <StatusItem tone="ok" testId="status-screens" label={`${enabled.length} screen${enabled.length > 1 ? 's' : ''} connected`} detail={enabled.map((o) => o.name).join(', ')} onClick={goDisplays} />

  return (
    <footer className="statusbar" aria-label="Status">
      {screens}
      {allStatusItems().map((s) => <ErrorBoundary key={s.id} name={s.id} fallback={() => null}><s.component /></ErrorBoundary>)}
      <div className="grow" />
      {workspace && <span className="status-text truncate">{workspace.name}</span>}
      <span className="status-text status-clock">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
    </footer>
  )
}
