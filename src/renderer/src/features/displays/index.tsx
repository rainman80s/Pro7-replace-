import { useEffect, useState, type ReactNode } from 'react'
import { ProgramAudio } from '@shared/render/LiveCanvas'
import { isGroup } from '@shared/outputs'
import { Button, Panel, Select } from '@ui/index'
import { defineFeature } from '../../app/feature'
import { api, useApp } from '../../app/store'
import { CanvasEditor } from './CanvasEditor'
import { ScreenEditor } from './ScreenEditor'
import { ScreenList } from './ScreenList'
import { selEq, type Sel } from './screens-logic'
import { NetworkView } from './Network'
import { RoutingView } from './Routing'
import { startDisplaysSync, useDisplays } from './state'
import './displays.css'

type Tab = 'routing' | 'canvases' | 'network' | 'sound'
const TABS: { id: Tab; name: string }[] = [
  { id: 'routing', name: 'Where things show' },
  { id: 'canvases', name: 'Screens & regions' },
  { id: 'network', name: 'Network displays' },
  { id: 'sound', name: 'Sound & safety' }
]
type Page = 'screens' | 'advanced'

function DisplaysView(): ReactNode {
  const [page, setPageState] = useState<Page>(() => (localStorage.getItem('reach.displays.page') as Page) || 'screens')
  const setPage = (p: Page): void => { localStorage.setItem('reach.displays.page', p); setPageState(p) }
  const [tab, setTabState] = useState<Tab>(() => (localStorage.getItem('reach.displays.tab') as Tab) || 'routing')
  const setTab = (t: Tab): void => { localStorage.setItem('reach.displays.tab', t); setTabState(t) }
  const { safeMode, health } = useDisplays()
  useEffect(() => { startDisplaysSync() }, [])
  // Other parts of the app ask for a sub-tab (“Search network displays…”); those all live under Network & advanced.
  useEffect(() => {
    const on = (e: Event): void => { setTab((e as CustomEvent<Tab>).detail); setPage('advanced') }
    window.addEventListener('reach:displays-tab', on)
    return () => window.removeEventListener('reach:displays-tab', on)
  }, [])
  const problems = health.filter((h) => !h.ok && h.status !== 'safe-mode')
  return (
    <div className="dsp-root">
      <div className="dsp-top row">
        <h2 className="dsp-h">Screen Configuration</h2>
        <div className="dsp-tabs row">
          <button className={`dsp-tab ${page === 'screens' ? 'on' : ''}`} onClick={() => setPage('screens')} data-page="screens">Screens</button>
          <button className={`dsp-tab ${page === 'advanced' ? 'on' : ''}`} onClick={() => setPage('advanced')} data-page="advanced">Network &amp; advanced</button>
        </div>
        <div className="grow" />
        {problems.length > 0 && <span className="dsp-problems" title={problems.map((p) => `${p.name}: ${p.message}`).join('\n')}>{problems.length} need attention</span>}
        <SafeModeButton />
      </div>
      {safeMode.on && (
        <div className="dsp-safe-banner row">
          <strong>Safe mode — every output is hidden.</strong>
          <span className="grow">The audience sees nothing (or black). Press {safeMode.shortcut} or click the button to bring them back.</span>
          <Button variant="live" onClick={() => void api.invoke('outputs.safeMode', { on: false })}>Bring outputs back</Button>
        </div>
      )}
      {page === 'screens' ? <ScreensPage /> : (
        <div className="dsp-adv">
          <div className="dsp-tabs row dsp-subtabs">
            {TABS.map((t) => <button key={t.id} className={`dsp-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)} data-tab={t.id}>{t.name}</button>)}
          </div>
          <div className="dsp-body">
            {tab === 'routing' && <RoutingView />}
            {tab === 'canvases' && <CanvasEditor />}
            {tab === 'network' && <NetworkView />}
            {tab === 'sound' && <SoundAndSafety />}
          </div>
        </div>
      )}
    </div>
  )
}

/** ProPresenter-style Screen Configuration: screens on the left, the selected screen's output settings on the right. */
function ScreensPage(): ReactNode {
  const canvases = useApp((s) => s.workspace?.canvases ?? [])
  const [picked, setPicked] = useState<Sel | null>(null)
  const sel: Sel | null = picked && canvases.some((c) => c.id === picked.canvasId && (!picked.regionId || c.regions.some((r) => r.id === picked.regionId))) ? picked : canvases[0] ? { canvasId: canvases[0].id } : null
  return (
    <div className="scr-window">
      <ScreenList sel={sel} onSelect={(s) => setPicked((p) => (p && selEq(p, s) ? p : s))} />
      <main className="scr-main">{sel ? <ScreenEditor key={`${sel.canvasId}:${sel.regionId ?? ''}`} sel={sel} /> : <div className="scr-detail-empty">Add a screen with + to get started.</div>}</main>
    </div>
  )
}

function SafeModeButton(): ReactNode {
  const { safeMode } = useDisplays()
  return safeMode.on
    ? <Button variant="live" onClick={() => void api.invoke('outputs.safeMode', { on: false })} data-safe-mode="on">Bring outputs back</Button>
    : <Button variant="danger" onClick={() => void api.invoke('outputs.safeMode', { on: true })} title={`Hide every output immediately (${safeMode.shortcut})`} data-safe-mode="off">Hide all outputs</Button>
}

function SoundAndSafety(): ReactNode {
  const { audio, safeMode, ndi, decklink } = useDisplays()
  const outputs = useApp((s) => s.outputs)
  const value = audio.device === 'output' ? `o:${audio.outputId}` : audio.device
  return (
    <div className="dsp-sound col">
      <Panel title="Program audio">
        <div className="col" style={{ padding: 12, gap: 8 }}>
          <span className="dsp-help">Video and audio-file sound plays from exactly <b>one</b> place, so you never get an echo. Usually that is this computer (its headphone or HDMI audio goes to the sound desk).</span>
          <label className="row" style={{ gap: 8 }}>
            <span style={{ width: 140 }}>Audio plays from</span>
            <Select style={{ width: 360 }} value={value} data-audio-route onChange={(e) => {
              const v = e.target.value
              void api.invoke('outputs.setAudioRoute', v.startsWith('o:') ? { device: 'output', outputId: v.slice(2) } : { device: v as 'operator' | 'none' })
            }}>
              <option value="operator">This computer (the operator window)</option>
              <optgroup label="An output (e.g. a TV with speakers, an HDMI audio embedder)">
                {outputs.filter((o) => o.target.type !== 'ndi' && o.target.type !== 'decklink').map((o) => <option key={o.id} value={`o:${o.id}`}>{o.name}{isGroup(o) ? ' (first screen in group)' : ''}</option>)}
              </optgroup>
              <option value="none">Nowhere (muted)</option>
            </Select>
          </label>
        </div>
      </Panel>
      <Panel title="Safe mode">
        <div className="col" style={{ padding: 12, gap: 8 }}>
          <span className="dsp-help">If something wrong is on the screens, press <b>{safeMode.shortcut || '…'}</b> (works even when Reach isn’t the front window) or click “Hide all outputs”. Every output on this computer and every network display goes dark at once. Press it again to bring them back.</span>
          <div><SafeModeButton /></div>
        </div>
      </Panel>
      <Panel title="NDI">
        <div className="col" style={{ padding: 12, gap: 6 }}>
          {ndi?.available ? <span>NDI is ready{ndi.version ? ` (${ndi.version})` : ''}. Add an NDI output under “Where things show”.</span> : <span className="dsp-warn info">{ndi?.reason ?? 'Checking…'}</span>}
          {ndi?.senders.map((s) => <span key={s.outputId} className="dim">{s.name}: {s.fps} fps, {s.frames} frames sent{s.dropped ? `, ${s.dropped} skipped` : ''}</span>)}
        </div>
      </Panel>
      <Panel title="SDI (Blackmagic DeckLink)">
        <div className="col" style={{ padding: 12, gap: 6 }} data-decklink-status>
          {decklink?.available ? <span>{decklink.message}</span> : <span className="dsp-warn info">{decklink?.message ?? 'Checking…'}</span>}
          {decklink?.outputs.map((s) => <span key={s.outputId} className="dim">{s.name} → {s.device}: {s.problem ?? `${s.fps} fps from Reach, ${s.fresh} new frames${s.late || s.dropped ? `, ${s.late + s.dropped} late` : ''}`}</span>)}
        </div>
      </Panel>
    </div>
  )
}

/** Compact status for the top bar: how many outputs are live / need attention. Click → Displays. */
function OutputsStatus(): ReactNode {
  const { health, safeMode } = useDisplays()
  useEffect(() => { startDisplaysSync() }, [])
  const leaves = health.filter((h) => !health.some((g) => g.outputId !== h.outputId && h.groupId === g.outputId) || !h.groupId)
  const bad = leaves.filter((h) => !h.ok && h.status !== 'safe-mode').length
  const live = leaves.filter((h) => h.status === 'live').length
  if (!health.length && !safeMode.on) return null
  return (
    <button className={`dsp-status ${safeMode.on ? 'safe' : bad ? 'bad' : 'ok'}`} onClick={() => useApp.getState().setView('displays')} title={health.map((h) => `${h.name}: ${h.message}`).join('\n')} data-outputs-status>
      <span className="dsp-dot" />{safeMode.on ? 'Outputs hidden' : bad ? `${bad} output${bad > 1 ? 's need' : ' needs'} attention` : `${live} output${live === 1 ? '' : 's'} live`}
    </button>
  )
}

/** Plays program audio in the operator window when that is the chosen place (and only then). */
function OperatorAudio(): ReactNode {
  const live = useApp((s) => s.live)
  const { audio } = useDisplays()
  useEffect(() => { startDisplaysSync() }, [])
  if (audio.device !== 'operator' || window.reachBridge === undefined) return null
  return <ProgramAudio live={live} />
}

export default defineFeature({
  id: 'displays',
  views: [{ id: 'displays', title: 'Displays', order: 60, component: DisplaysView }],
  toolbar: [{ id: 'outputs-status', order: 90, component: OutputsStatus }],
  background: [OperatorAudio]
})
