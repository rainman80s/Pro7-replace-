import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Playlist, Presentation } from '@shared/model'
import { groupOfSlide, orderedSlides } from '@shared/model'
import { SlideThumb, Fit } from '@shared/render/SlideView'
import { LiveCanvas } from '@shared/render/LiveCanvas'
import { Button, Empty, Input, Panel } from '@ui/index'
import { defineFeature } from '../../app/feature'
import { allShowPanels } from '../../app/registry'
import { api, useApp } from '../../app/store'
import './show.css'

/** BASELINE Show screen: playlist → slides grid → live previews. Click a slide to send it live; arrows/space to step. */
function ShowView(): ReactNode {
  const { playlists, library, live, workspace, selectedPlaylistId, selectedPlaylistItemId, selectedPresentationId, select, loadPresentation, presentations } = useApp()
  const [q, setQ] = useState('')
  const playlist: Playlist | undefined = playlists.find((p) => p.id === selectedPlaylistId)
  const presentation: Presentation | undefined = selectedPresentationId ? presentations[selectedPresentationId] : undefined

  useEffect(() => { if (selectedPresentationId) void loadPresentation(selectedPresentationId) }, [selectedPresentationId, loadPresentation])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable]')) return
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); void api.invoke('live.next') }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); void api.invoke('live.prev') }
      if (e.key === 'Escape') void api.invoke('live.clear', { layer: 'slide' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const results = useMemo(() => {
    const n = q.trim().toLowerCase()
    return n ? library.filter((p) => p.title.toLowerCase().includes(n) || p.excerpt?.toLowerCase().includes(n)) : library
  }, [q, library])

  const slides = presentation ? orderedSlides(presentation) : []
  const panels = allShowPanels()
  return (
    <div className="show">
      <aside className="show-side col">
        <Panel title="Service" className="grow col" style={{ minHeight: 0 }}
          actions={<select className="select" value={selectedPlaylistId ?? ''} onChange={(e) => select({ selectedPlaylistId: e.target.value })}>{playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}>
          <div className="scroll grow">
            {playlist?.items.map((it) =>
              it.type === 'header' ? <div key={it.id} className="pl-header">{it.title}</div> : (
                <div key={it.id} className={`pl-item ${it.id === selectedPlaylistItemId ? 'on' : ''} ${live.slide?.playlistItemId === it.id ? 'live' : ''}`}
                  onClick={() => select({ selectedPlaylistItemId: it.id, selectedPresentationId: it.type === 'presentation' ? it.presentationId : null })}>
                  {it.type === 'presentation' ? (it.title ?? library.find((l) => l.id === it.presentationId)?.title ?? 'Missing') : it.title ?? 'Media'}
                  {it.type === 'placeholder' && <span className="dim"> — {it.hint ?? 'empty'}</span>}
                </div>
              )
            )}
          </div>
        </Panel>
        <Panel title="Library" className="grow col" style={{ minHeight: 0 }}>
          <div style={{ padding: '0 8px 8px' }}><Input placeholder="Search songs & slides…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%' }} /></div>
          <div className="scroll grow">
            {results.map((p) => (
              <div key={p.id} className={`pl-item ${p.id === selectedPresentationId && !selectedPlaylistItemId ? 'on' : ''}`} onClick={() => select({ selectedPresentationId: p.id, selectedPlaylistItemId: null })}>
                {p.title} <span className="dim">· {p.slideCount}</span>
              </div>
            ))}
          </div>
        </Panel>
      </aside>

      <section className="show-grid scroll">
        {!presentation ? <Empty title="Pick something to present">Choose an item from the service or search the library.</Empty> : (
          <>
            <h2 className="show-title">{presentation.title}</h2>
            <div className="slides">
              {slides.map((s, i) => {
                const g = groupOfSlide(presentation, s.id)
                const isLive = live.slide?.presentationId === presentation.id && live.slide.index === i
                return (
                  <button key={`${s.id}-${i}`} className={`slide ${isLive ? 'live' : ''}`} style={{ ['--group' as string]: g?.color ?? '#555' }}
                    onClick={() => void api.invoke('live.goToSlide', { presentationId: presentation.id, index: i, playlistId: selectedPlaylistItemId ? selectedPlaylistId ?? undefined : undefined, playlistItemId: selectedPlaylistItemId ?? undefined })}>
                    <SlideThumb elements={s.elements} background={s.background} size={presentation.size} />
                    <div className="slide-label"><span>{i + 1}</span><span>{s.label ?? g?.name ?? ''}</span></div>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </section>

      <aside className="show-live col scroll">
        {workspace?.canvases.map((c) => (
          <Panel key={c.id} title={c.name}>
            <div style={{ aspectRatio: `${c.width} / ${c.height}`, margin: '0 8px 8px', background: '#000', borderRadius: 4, overflow: 'hidden' }}>
              <Fit size={{ width: c.width, height: c.height }}><LiveCanvas canvas={c} live={live} workspace={workspace} showRegions /></Fit>
            </div>
          </Panel>
        ))}
        <div className="row" style={{ padding: '0 2px' }}>
          <Button className="grow" onClick={() => void api.invoke('live.prev')}>← Prev</Button>
          <Button className="grow" variant="live" onClick={() => void api.invoke('live.next')}>Next →</Button>
        </div>
        {panels.map((p) => <Panel key={p.id} title={p.title}><p.component /></Panel>)}
      </aside>
    </div>
  )
}

export default defineFeature({
  id: 'show',
  views: [{ id: 'show', title: 'Show', order: 10, component: ShowView, shortcut: '⌘1' }]
})
