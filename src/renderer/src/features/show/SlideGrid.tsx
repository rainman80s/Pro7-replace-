import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Playlist, PlaylistItem, Presentation } from '@shared/model'
import { groupOfSlide, orderedSlides, slideText } from '@shared/model'
import { mediaUrl } from '@shared/media'
import { MACRO_COLORS, MACRO_MIME } from '@shared/control'
import { SlideThumb } from '@shared/render/SlideView'
import { Badge, Button, Empty, Icon, Kbd, Slider, Spinner, Tooltip, openContextMenu } from '@ui/index'
import { openPresentation, useApp, useLocked } from '../../app/store'
import { goToSlide, showMedia, useShowUi } from './actions'
import { formatLength, itemTitle } from './logic'
import { BackgroundDialog, SlideActionsDialog } from './SlideDialogs'
import { addMacroAction, setBackground } from './slideOps'
import { MEDIA_MIME } from './MediaBin'
import { useRpc } from '../control/hooks'

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
  const [macros] = useRpc('macros.list', 'macros')
  const [over, setOver] = useState<string | null>(null)
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

  /** Drop target props: media sets the background, macros add an action. `macroTo` overrides where a macro lands (the title only targets the first slide). */
  const dz = (key: string, slideIds: string[], scope: string, macroTo?: { ids: string[]; scope: string; detail: string }) => locked ? {} : {
    onDragOver: (e: React.DragEvent) => {
      const t = e.dataTransfer.types
      if (!t.includes(MEDIA_MIME) && !t.includes(MACRO_MIME)) return
      e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setOver(key)
    },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === key ? null : o)) },
    onDrop: (e: React.DragEvent) => {
      setOver(null)
      const media = e.dataTransfer.getData(MEDIA_MIME)
      const macro = e.dataTransfer.getData(MACRO_MIME)
      if (!media && !macro) return
      e.preventDefault(); e.stopPropagation()
      try {
        if (macro) { const m = JSON.parse(macro) as { id: string; name: string }; void addMacroAction(presentation.id, macroTo?.ids ?? slideIds, m.id, m.name, macroTo?.scope ?? scope, macroTo?.detail) }
        else void setBackground(presentation.id, slideIds, JSON.parse(media), scope)
      } catch { /* not ours */ }
    }
  }
  const allIds = presentation.slides.map((x) => x.id)
  const macroOf = (id: unknown): { color: string; name: string } => {
    const m = macros?.find((x) => x.id === id)
    return { color: m?.color ?? MACRO_COLORS[0], name: m?.name ?? 'Macro' }
  }

  return (
    <section className="grid-col">
      <header className="grid-head">
        <div className="grid-title-wrap">
          <h2 className={`grid-title truncate drop ${over === 'title' ? 'over' : ''}`} data-testid="grid-title" title={locked ? undefined : 'Drop media here for every slide, or a macro for the first slide'} {...dz('title', allIds, 'every slide', { ids: allIds.slice(0, 1), scope: 'the first slide', detail: 'Dropped on the title, so it runs when the song starts' })}>{item ? itemTitle(item, library) : presentation.title}</h2>
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
            <Fragment key={`${s.id}-${i}`}>
            {startsGroup && g && (
              <div className={`slide-group-head drop ${over === `g:${g.id}:${i}` ? 'over' : ''}`} data-testid="group-head" style={{ ['--group' as string]: g.color ?? 'var(--border-strong)' }}
                {...dz(`g:${g.id}:${i}`, g.slideIds, `every slide in ${g.name}`)}>
                <span className="slide-group-dot" /><span className="truncate">{g.name}</span><span className="faint">{g.slideIds.length}</span>
              </div>
            )}
            <button type="button" data-index={i} data-testid="slide"
              className={`slide drop ${isLive ? 'live' : ''} ${isNext ? 'next' : ''} ${over === `s:${s.id}:${i}` ? 'over' : ''}`} {...dz(`s:${s.id}:${i}`, [s.id], 'this slide')} style={{ ['--group' as string]: g?.color ?? 'var(--border-strong)' }}
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
                {!!s.notes?.trim() && <Tooltip label={s.notes}><span className="slide-note" data-testid="slide-note"><Icon name="note" size={12} /></span></Tooltip>}
                {!!s.actions?.length && (
                  <Tooltip label={s.actions.map((a) => (a.type === 'macro.run' ? `Macro: ${macroOf(a.params?.id).name}` : a.label || a.type)).join(', ')}>
                    <span className="slide-acts" data-testid="slide-actions-badge">
                      {s.actions.slice(0, 3).map((a) => <span key={a.id} className="slide-act-dot" style={{ background: a.type === 'macro.run' ? macroOf(a.params?.id).color : 'var(--text-faint)' }} />)}
                      {s.actions.length > 3 && <span className="slide-act-more">+{s.actions.length - 3}</span>}
                    </span>
                  </Tooltip>
                )}
                {!!s.autoAdvance && <Tooltip label={`Moves on by itself after ${s.autoAdvance}s`}><span className="slide-auto"><Icon name="clock" size={12} /></span></Tooltip>}
              </span>
            </button>
            </Fragment>
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
