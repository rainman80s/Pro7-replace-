import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Playlist, PlaylistItem, Presentation } from '@shared/model'
import { groupOfSlide, orderedSlides, slideText } from '@shared/model'
import { mediaUrl } from '@shared/media'
import { SlideThumb } from '@shared/render/SlideView'
import { Badge, Button, Empty, Icon, Kbd, Slider, Spinner, Tooltip, openContextMenu } from '@ui/index'
import { openPresentation, useApp, useLocked } from '../../app/store'
import { goToSlide, showMedia, useShowUi } from './actions'
import { formatLength, itemTitle } from './logic'
import { BackgroundDialog, SlideActionsDialog } from './SlideDialogs'
import { setBackground } from './slideOps'

/** Centre column: the slides of whatever is selected. Clicking a slide puts it on screen. */
export function SlideGrid({ playlist }: { playlist: Playlist | undefined }): ReactNode {
  const live = useApp((s) => s.live)
  const library = useApp((s) => s.library)
  const presentations = useApp((s) => s.presentations)
  const selectedPresentationId = useApp((s) => s.selectedPresentationId)
  const selectedItemId = useApp((s) => s.selectedPlaylistItemId)
  const thumbSize = useApp((s) => s.prefs.thumbSize)
  const setPrefs = useApp((s) => s.setPrefs)
  const loadPresentation = useApp((s) => s.loadPresentation)
  const locked = useLocked()
  const ui = useShowUi()
  const [dialog, setDialog] = useState<{ kind: 'actions' | 'background'; slideId: string } | null>(null)

  const item: PlaylistItem | undefined = playlist?.items.find((x) => x.id === selectedItemId)
  const presentation: Presentation | undefined = selectedPresentationId ? presentations[selectedPresentationId] : undefined
  const missing = !!selectedPresentationId && !library.some((l) => l.id === selectedPresentationId)

  useEffect(() => { if (selectedPresentationId) void loadPresentation(selectedPresentationId) }, [selectedPresentationId, loadPresentation])

  const arrangementId = item?.type === 'presentation' ? item.arrangementId : undefined
  const slides = useMemo(() => (presentation ? orderedSlides(presentation, arrangementId) : []), [presentation, arrangementId])

  // "Live here" = this presentation is on screen from this same place (service item, or the library).
  const liveHere = !!presentation && live.slide?.presentationId === presentation.id && (live.slide.playlistItemId ?? null) === (item?.id ?? null)
  const liveIndex = liveHere ? live.slide!.index : -1
  const nextIndex = liveHere && live.slide?.next ? live.slide.next.index : -1

  // Keep the live slide in view as the operator steps through with the keyboard.
  const gridRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (liveIndex < 0) return
    gridRef.current?.querySelector<HTMLElement>(`[data-index="${liveIndex}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [liveIndex, presentation?.id])

  if (item?.type === 'placeholder') {
    return (
      <section className="grid-col">
        <Empty title={item.title} icon="placeholder" action={locked ? undefined : <>
          <Button variant="primary" icon="search" onClick={() => ui.openSearch({ kind: 'replace', itemId: item.id })}>Choose from the library</Button>
          <Button icon="music" onClick={() => ui.set({ newSong: { addToService: true } })}>New from pasted text</Button>
        </>}>
          {item.hint ? `Still to be added: ${item.hint}.` : 'This part of the service has not been prepared yet.'}
          {locked && ' Ask your tech lead.'}
        </Empty>
      </section>
    )
  }

  if (item?.type === 'media') {
    const playing = [live.video, live.background, live.audio].some((m) => m?.media.src === item.media.src)
    return (
      <section className="grid-col">
        <header className="grid-head"><div className="grid-title-wrap"><h2 className="grid-title truncate">{itemTitle(item, library)}</h2><div className="t-meta">{item.media.kind}{item.length ? ` · ${formatLength(item.length)}` : ''}</div></div></header>
        <div className="media-stage">
          <div className={`media-frame ${playing ? 'is-live' : ''}`}>
            {item.media.kind === 'image' ? <img src={mediaUrl(item.media)} alt="" /> : item.media.kind === 'video' ? <video src={mediaUrl(item.media)} muted preload="metadata" /> : <Icon name="audio" size={48} />}
          </div>
          <Button variant="primary" size="lg" icon="play" data-testid="media-play" onClick={() => void showMedia(item.media)}>{playing ? 'Play again from the start' : 'Play on the screens'}</Button>
        </div>
      </section>
    )
  }

  if (!selectedPresentationId) {
    return (
      <section className="grid-col">
        <Empty title="Pick something from the service" logo>
          Choose an item on the left to see its slides here. Nothing goes on the screens until you click a slide or press <Kbd>Space</Kbd>.
        </Empty>
      </section>
    )
  }
  if (missing) {
    return <section className="grid-col"><Empty title="This item is no longer in the library" icon="warning">It may have been deleted or not synced to this computer yet.{locked ? ' Tell your tech lead.' : ' Remove it from the service or choose a replacement.'}</Empty></section>
  }
  if (!presentation) return <section className="grid-col"><div className="empty"><Spinner label="Loading slides" /></div></section>

  const meta = [presentation.meta.artist ?? presentation.meta.author, presentation.meta.ccliNumber ? `CCLI ${presentation.meta.ccliNumber}` : undefined, `${slides.length} slide${slides.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')
  const serviceMeta = item?.type === 'presentation' ? [item.people?.join(', '), formatLength(item.length), item.notes].filter(Boolean).join(' · ') : ''
  let lastGroup: string | undefined

  return (
    <section className="grid-col">
      <header className="grid-head">
        <div className="grid-title-wrap">
          <h2 className="grid-title truncate" data-testid="grid-title">{item ? itemTitle(item, library) : presentation.title}</h2>
          <div className="t-meta truncate">{meta}{!item && ' · not in this service'}</div>
          {serviceMeta && <div className="grid-note truncate"><Icon name="note" size={13} />{serviceMeta}</div>}
        </div>
        <Tooltip label="Thumbnail size">
          <span className="thumb-size"><Icon name="grid" size={14} /><Slider aria-label="Thumbnail size" min={150} max={380} step={10} value={thumbSize} onChange={(n) => setPrefs({ thumbSize: n })} style={{ width: 96 }} /></span>
        </Tooltip>
        {!locked && <Button icon="edit" data-testid="edit-presentation" onClick={() => openPresentation(presentation.id, 'edit')}>Edit</Button>}
      </header>

      <div className="slides scroll" ref={gridRef} style={{ ['--thumb' as string]: `${thumbSize}px` }} data-testid="slide-grid">
        {slides.map((s, i) => {
          const g = groupOfSlide(presentation, s.id)
          const startsGroup = (g?.id ?? '') !== lastGroup
          lastGroup = g?.id ?? ''
          const isLive = i === liveIndex
          const isNext = i === nextIndex
          const label = s.label || g?.name || ''
          return (
            <button key={`${s.id}-${i}`} type="button" data-index={i} data-testid="slide"
              className={`slide ${isLive ? 'live' : ''} ${isNext ? 'next' : ''}`} style={{ ['--group' as string]: g?.color ?? 'var(--border-strong)' }}
              aria-label={`Slide ${i + 1}${label ? `, ${label}` : ''}: ${slideText(s).replace(/\n/g, ' / ') || 'no text'}${isLive ? ' (on screen now)' : ''}`} aria-pressed={isLive}
              onClick={() => void goToSlide(presentation.id, i, { playlistId: playlist?.id, itemId: item?.id })}
              onContextMenu={(e) => openContextMenu(e, [
                { label: 'Show this slide', icon: 'play', onSelect: () => void goToSlide(presentation.id, i, { playlistId: playlist?.id, itemId: item?.id }) },
                locked ? null : { label: 'Edit slide', icon: 'edit', onSelect: () => openPresentation(presentation.id, 'edit', s.id), testId: 'slide-edit' },
                locked ? null : { label: 'Edit all slides', icon: 'edit', onSelect: () => openPresentation(presentation.id, 'edit') },
                locked ? null : { type: 'separator' },
                locked ? null : { label: 'Slide actions…', icon: 'sparkle', onSelect: () => setDialog({ kind: 'actions', slideId: s.id }), testId: 'slide-actions' },
                locked ? null : { label: 'Set background…', icon: 'image', onSelect: () => setDialog({ kind: 'background', slideId: s.id }), testId: 'slide-set-bg' },
                locked || !s.background ? null : { label: 'Clear background', icon: 'close', onSelect: () => void setBackground(presentation.id, [s.id], undefined, 'this slide'), testId: 'slide-clear-bg' }
              ])}>
              <span className="slide-frame">
                <SlideThumb checker elements={s.elements} background={s.background} size={presentation.size} />
                {isLive && <Badge tone="live" className="slide-flag">Live</Badge>}
                {isNext && <Badge tone="outline" className="slide-flag">Next</Badge>}
              </span>
              <span className="slide-label">
                <span className="slide-num">{i + 1}</span>
                <span className={`slide-group truncate ${startsGroup ? 'first' : ''}`}>{label}</span>
                {!!s.autoAdvance && <Tooltip label={`Moves on by itself after ${s.autoAdvance}s`}><span className="slide-auto"><Icon name="clock" size={12} /></span></Tooltip>}
              </span>
            </button>
          )
        })}
      </div>

      {dialog?.kind === 'actions' && presentation.slides.find((x) => x.id === dialog.slideId) && <SlideActionsDialog presentation={presentation} slide={presentation.slides.find((x) => x.id === dialog.slideId)!} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'background' && <BackgroundDialog presentationId={presentation.id} slideIds={[dialog.slideId]} scope="this slide" onClose={() => setDialog(null)} />}

      <footer className="grid-hint" data-testid="advance-hint">
        <span><strong>Click a slide</strong> to put it on the screens</span>
        <span><Kbd>Space</Kbd> or <Kbd>→</Kbd> next</span>
        <span><Kbd>←</Kbd> back</span>
        <span><Kbd>Esc</Kbd> clear the words</span>
        <span><Kbd>?</Kbd> all shortcuts</span>
      </footer>
    </section>
  )
}
