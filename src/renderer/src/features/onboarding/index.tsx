import { useEffect, useState, type ReactNode } from 'react'
import type { SystemInfo } from '@shared/api'
import { Button, Icon, Logo, type IconName } from '@ui/index'
import { createPortal } from 'react-dom'
import { defineFeature } from '../../app/feature'
import { allCommands, allViews } from '../../app/registry'
import { api, useApp } from '../../app/store'
import './onboarding.css'

/**
 * First-run welcome. Four short steps, each with one obvious action and a "Skip" — nothing is required.
 * Completion is stored on this computer (`local.set('ui.onboarded', true)`).
 * Skipped automatically under test automation (navigator.webdriver) so e2e scripts aren't blocked.
 */
function Welcome(): ReactNode {
  const ready = useApp((s) => s.ready)
  const onboarded = useApp((s) => s.prefs.onboarded)
  const overlay = useApp((s) => s.overlay)
  const setOverlay = useApp((s) => s.setOverlay)
  useEffect(() => {
    if (ready && !onboarded && !overlay && !navigator.webdriver) setOverlay('welcome')
  }, [ready, onboarded]) // eslint-disable-line react-hooks/exhaustive-deps
  if (overlay !== 'welcome') return null
  return <WelcomeDialog />
}

/** Go to another feature's screen if it exists; otherwise run a matching quick command; otherwise Settings. */
function goTo(viewIds: string[], commandHint?: string): void {
  const s = useApp.getState()
  const view = allViews().find((v) => viewIds.includes(v.id))
  finish()
  if (view) return s.setView(view.id)
  const cmd = commandHint ? allCommands().find((c) => c.id.toLowerCase().includes(commandHint) || c.title.toLowerCase().includes(commandHint)) : undefined
  if (cmd) return void cmd.run()
  s.setView('settings')
}

function finish(): void {
  const s = useApp.getState()
  s.setPrefs({ onboarded: true })
  s.setOverlay(null)
}

interface Step { id: string; icon: IconName; title: string; body: ReactNode; action?: { label: string; run: () => void }; aside?: ReactNode }

function WelcomeDialog(): ReactNode {
  const [i, setI] = useState(0)
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const displays = useApp((s) => s.displays)
  const outputs = useApp((s) => s.outputs)
  const library = useApp((s) => s.library)
  useEffect(() => { void api.invoke('system.info').then(setInfo).catch(() => {}) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopImmediatePropagation(); finish() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const steps: Step[] = [
    {
      id: 'folder', icon: 'folder', title: 'Where your songs live',
      body: <>Everything — songs, services, media — is kept in one ordinary folder. Put it in iCloud Drive, Dropbox or a shared drive and every computer at church sees the same library.</>,
      aside: <div className="wel-path"><Icon name="folder" size={16} /><span className="t-meta">{info?.workspacePath ?? '…'}</span></div>,
      action: { label: 'Choose a different folder', run: () => goTo(['settings']) }
    },
    {
      id: 'screens', icon: 'displays', title: 'Connect the screens',
      body: <>Plug in the projector, TVs or LED wall and tell Reach what each one shows. It remembers them, so next Sunday they come back on their own.</>,
      aside: <div className="wel-path"><Icon name="displays" size={16} /><span className="t-meta">{displays.length} display{displays.length === 1 ? '' : 's'} found · {outputs.filter((o) => o.enabled).length} in use</span></div>,
      action: { label: 'Set up screens', run: () => goTo(['displays']) }
    },
    {
      id: 'songs', icon: 'download', title: 'Bring your songs across',
      body: <>Moving from ProPresenter? Import your library and playlists in one go. Or just paste lyrics into a new song — a blank line starts a new slide.</>,
      aside: <div className="wel-path"><Icon name="music" size={16} /><span className="t-meta">{library.length} item{library.length === 1 ? '' : 's'} in the library now</span></div>,
      action: { label: 'Import from ProPresenter', run: () => goTo(['import', 'files'], 'import') }
    },
    {
      id: 'plans', icon: 'integrations', title: 'Connect Planning Center',
      body: <>Pull this week’s service order straight from Planning Center, and sermon notes from Notion, instead of building it by hand.</>,
      action: { label: 'Connect services', run: () => goTo(['integrations']) }
    }
  ]
  const step = steps[i]

  return createPortal(
    <div className="wel-backdrop" data-testid="welcome">
      <div className="wel" role="dialog" aria-modal="true" aria-labelledby="wel-title">
        <aside className="wel-brand">
          <Logo variant="combo" height={108} />
          <div className="wel-hello">Let’s get you set up</div>
          <div className="wel-sub t-meta">Four quick steps. You can skip any of them and come back from Settings.</div>
          <div className="wel-steps" aria-hidden>
            {steps.map((s, j) => <button key={s.id} type="button" tabIndex={-1} className={`wel-step ${j === i ? 'on' : ''} ${j < i ? 'done' : ''}`} onClick={() => setI(j)}><span>{j < i ? <Icon name="check" size={12} /> : j + 1}</span>{s.title}</button>)}
          </div>
        </aside>
        <section className="wel-main">
          <div className="wel-count t-label">Step {i + 1} of {steps.length}</div>
          <div className="wel-icon"><Icon name={step.icon} size={26} /></div>
          <h2 id="wel-title" className="wel-title">{step.title}</h2>
          <p className="wel-body">{step.body}</p>
          {step.aside}
          {step.action && <Button size="lg" variant="primary" className="wel-action" data-testid="welcome-action" onClick={step.action.run}>{step.action.label}<Icon name="external" size={15} /></Button>}
          <div className="grow" />
          <footer className="wel-foot">
            <Button variant="ghost" data-testid="welcome-skip" onClick={finish}>Skip setup</Button>
            <div className="grow" />
            {i > 0 && <Button onClick={() => setI(i - 1)}>Back</Button>}
            {i < steps.length - 1
              ? <Button variant="primary" data-testid="welcome-next" autoFocus onClick={() => setI(i + 1)}>Next</Button>
              : <Button variant="primary" data-testid="welcome-done" autoFocus onClick={finish}>Start using Reach</Button>}
          </footer>
        </section>
      </div>
    </div>,
    document.body
  )
}

export default defineFeature({ id: 'onboarding', background: [Welcome] })
