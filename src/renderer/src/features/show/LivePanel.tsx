import { useMemo, type ReactNode } from 'react'
import type { Canvas, LiveState } from '@shared/model'
import { slideText } from '@shared/model'
import { Fit, SlideThumb } from '@shared/render/SlideView'
import { LiveCanvas } from '@shared/render/LiveCanvas'
import { Badge, Button, ErrorBoundary, Icon, Kbd, Panel, Tooltip } from '@ui/index'
import { allShowPanels } from '../../app/registry'
import { useApp } from '../../app/store'
import { advance, clearAll, clearMedia, clearSlide, peekNext, retreat, toggleBlackout, toggleLogo } from './actions'

/** Short words for what each layer is showing, for the Clear buttons' indicators. */
function layerSummary(live: LiveState): { slide: string | null; media: string | null; extras: string[] } {
  const media = live.video?.media.name ?? live.background?.media.name ?? live.audio?.media.name ?? (live.video || live.background || live.audio ? 'Media' : null)
  const extras: string[] = []
  if (live.announcement) extras.push('announcement')
  if (live.props.length) extras.push(live.props.length === 1 ? 'a prop' : `${live.props.length} props`)
  if (live.messages.length) extras.push(live.messages.length === 1 ? 'a message' : `${live.messages.length} messages`)
  return { slide: live.slide ? (live.slide.presentationTitle || 'Slide') : null, media, extras }
}

/** Right column: what the room sees right now, what's next, and the controls to move on or get out. */
export function LivePanel(): ReactNode {
  const live = useApp((s) => s.live)
  const workspace = useApp((s) => s.workspace)
  const presentations = useApp((s) => s.presentations)
  // Subscribe to everything "up next" depends on, then compute it.
  useApp((s) => s.playlists)
  useApp((s) => s.selectedPresentationId)
  useApp((s) => s.prefs.autoContinue)
  const next = peekNext()
  const panels = allShowPanels()
  const sum = layerSummary(live)
  const anything = !!(live.slide || live.video || live.background || live.audio || live.props.length || live.messages.length || live.announcement)
  const audience = (workspace?.canvases ?? []).filter((c) => c.kind === 'audience')
  const stage = (workspace?.canvases ?? []).filter((c) => c.kind !== 'audience')
  const status = live.blackout ? 'Screens are black' : live.logo ? 'Showing the logo' : anything ? 'On screen now' : 'Nothing on screen'

  const nextCard = useMemo(() => {
    if (next.kind === 'slide' && live.slide?.next) {
      const p = presentations[live.slide.presentationId]
      return { label: 'Next slide', title: slideText(live.slide.next.slide).split('\n').slice(0, 2).join(' / ') || `Slide ${live.slide.next.index + 1}`, thumb: p ? <SlideThumb elements={live.slide.next.slide.elements} background={live.slide.next.slide.background} size={live.slide.size} /> : null }
    }
    if (next.kind === 'item') return { label: 'Next in the service', title: next.title, thumb: null }
    if (next.kind === 'start') return { label: 'Press Next to start', title: 'First slide of the selected item', thumb: null }
    if (next.kind === 'end') return { label: 'Up next', title: 'Nothing — this is the end', thumb: null }
    return { label: 'Up next', title: 'Pick an item from the service', thumb: null }
  }, [next.kind, next.kind === 'item' ? next.title : '', live.slide, presentations])

  return (
    <aside className="live-col scroll" data-testid="live-panel">
      <section className={`onair ${anything || live.logo || live.blackout ? 'is-on' : ''}`} data-testid="on-screen">
        <header className="onair-head">
          <span className={`dot ${anything || live.logo || live.blackout ? 'live' : ''}`} />
          <span className="onair-status" data-testid="live-status">{status}</span>
          <div className="grow" />
          {live.slide && <span className="t-meta truncate" style={{ maxWidth: 150 }}>{live.slide.presentationTitle}{live.slide.index >= 0 ? ` · ${live.slide.index + 1}` : ''}</span>}
        </header>
        {audience.map((c) => <Preview key={c.id} canvas={c} live={live} label={audience.length + stage.length > 1 ? c.name : undefined} />)}
        {!audience.length && <div className="onair-none">No screens are set up yet.</div>}
      </section>

      <div className="advance">
        <Tooltip label="Back one slide" shortcut="←">
          <Button size="lg" icon="prev" className="advance-back" data-testid="go-prev" aria-label="Back" onClick={() => void retreat()} disabled={!live.slide} />
        </Tooltip>
        <Button size="lg" variant="primary" className="advance-next grow" data-testid="go-next" onClick={() => void advance()} disabled={next.kind === 'none'}>
          <span>{next.kind === 'item' ? 'Next item' : next.kind === 'start' ? 'Start' : 'Next'}</span><Icon name="next" size={18} /><Kbd>Space</Kbd>
        </Button>
      </div>

      <section className="upnext" data-testid="up-next">
        {nextCard.thumb && <div className="upnext-thumb">{nextCard.thumb}</div>}
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="t-label">{nextCard.label}</div>
          <div className="upnext-title">{nextCard.title}</div>
        </div>
      </section>

      <section className="clears" aria-label="Clear the screens">
        <ClearButton label="Clear slide" what={sum.slide} shortcut="Esc" testId="clear-slide" icon="clearSlide" onClick={() => void clearSlide()} />
        <ClearButton label="Clear media" what={sum.media} testId="clear-media" icon="video" onClick={() => void clearMedia()} />
        <ClearButton label="Clear all" what={anything ? 'everything' : null} testId="clear-all" icon="close" danger onClick={() => void clearAll()} detail={sum.extras.length ? `Also clears ${sum.extras.join(', ')}` : undefined} />
      </section>
      <div className="row flags">
        <Button size="sm" icon="logo" active={live.logo} data-testid="toggle-logo" className="grow" onClick={() => void toggleLogo()}>Logo</Button>
        <Button size="sm" icon="blackout" active={live.blackout} data-testid="toggle-black" className="grow" onClick={() => void toggleBlackout()}>Black screen</Button>
      </div>

      {stage.map((c) => (
        <Panel key={c.id} title={c.name} collapsible id={`preview-${c.id}`} defaultCollapsed>
          <div style={{ padding: '0 10px 10px' }}><Preview canvas={c} live={live} small /></div>
        </Panel>
      ))}

      {panels.map((p) => (
        <Panel key={p.id} title={p.title} collapsible id={`show-${p.id}`}>
          <ErrorBoundary name={p.title} compact><p.component /></ErrorBoundary>
        </Panel>
      ))}
    </aside>
  )
}

function Preview({ canvas, live, label, small }: { canvas: Canvas; live: LiveState; label?: string; small?: boolean }): ReactNode {
  const workspace = useApp((s) => s.workspace)
  return (
    <figure className={`preview ${small ? 'small' : ''}`} data-testid="live-preview" style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}>
      <Fit size={{ width: canvas.width, height: canvas.height }}><LiveCanvas canvas={canvas} live={live} workspace={workspace ?? undefined} showRegions /></Fit>
      {label && <figcaption>{label}</figcaption>}
    </figure>
  )
}

function ClearButton({ label, what, shortcut, icon, onClick, danger, testId, detail }: { label: string; what: string | null; shortcut?: string; icon: 'clearSlide' | 'video' | 'close'; onClick: () => void; danger?: boolean; testId: string; detail?: string }): ReactNode {
  const tip = what ? `${label}${what !== 'everything' ? `: ${what}` : ' — takes everything off the screens'}${detail ? `. ${detail}` : ''}` : `${label} — nothing to clear`
  return (
    <Tooltip label={tip} shortcut={shortcut} side="top">
      <button type="button" className={`clear-btn ${danger ? 'danger' : ''} ${what ? 'has' : ''}`} data-testid={testId} disabled={!what} onClick={onClick}>
        <Icon name={icon} size={18} />
        <span className="clear-label">{label}</span>
        <span className="clear-state">{what ? <Badge tone="live">On</Badge> : <span className="faint">Off</span>}</span>
      </button>
    </Tooltip>
  )
}
