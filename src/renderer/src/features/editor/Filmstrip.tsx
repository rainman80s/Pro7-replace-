/** Slide list down the left, grouped by song section; click / ⇧-click / ⌘-click, drag to reorder. */
import { useState, type ReactNode } from 'react'
import type { ID, Presentation, Slide } from '@shared/model'
import { resolveSlideForCanvas } from '@shared/model'
import { SlideThumb } from '@shared/render/SlideView'
import { RegionGuide } from '@shared/render/LiveCanvas'
import { sampleTokens } from '@shared/editor-stagelayouts'
import { Button } from '@ui/index'
import { useApp } from '../../app/store'
import { deleteSlides, duplicateSlides, moveSlides, newSlide, selectSlide, useDoc, useEditor } from './store'

export function Filmstrip(): ReactNode {
  const doc = useDoc()
  const slideIds = useEditor((s) => s.slideIds)
  const slideId = useEditor((s) => s.slideId)
  const canvasId = useEditor((s) => s.canvasId)
  const kind = useEditor((s) => s.kind)
  const live = useApp((s) => s.live.slide)
  const canvas = useApp((s) => s.workspace?.canvases.find((c) => c.id === canvasId))
  const [dragOver, setDragOver] = useState<{ id: ID | null; groupId?: ID | null } | null>(null)
  if (!doc) return <div className="ed-film" />

  const rows: ({ type: 'group'; id: ID | null; name: string; color?: string } | { type: 'slide'; slide: Slide; n: number })[] = []
  let prev: string | null | undefined
  doc.slides.forEach((s, i) => {
    const g = doc.groups.find((x) => x.slideIds.includes(s.id))
    if ((g?.id ?? null) !== prev && (g || prev)) rows.push({ type: 'group', id: g?.id ?? null, name: g?.name ?? 'No section', color: g?.color })
    prev = g?.id ?? null
    rows.push({ type: 'slide', slide: s, n: i + 1 })
  })
  const drop = (beforeId: ID | null, groupId?: ID | null) => (e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(null)
    const ids = JSON.parse(e.dataTransfer.getData('application/x-reach-slides') || '[]') as ID[]
    if (ids.length) moveSlides(ids, beforeId, groupId)
  }
  const noun = kind === 'theme' ? 'template' : 'slide'
  return (
    <div className="ed-film" data-testid="filmstrip">
      <div className="ed-film-list scroll">
        {rows.map((r, i) => r.type === 'group'
          ? <div key={`g${i}`} className="ed-film-group" style={{ ['--group' as string]: r.color ?? '#555' }} onDragOver={(e) => e.preventDefault()} onDrop={drop(rows[i + 1]?.type === 'slide' ? (rows[i + 1] as { slide: Slide }).slide.id : null, r.id)}>{r.name}</div>
          : (
            <div key={r.slide.id}
              className={`ed-film-item ${slideIds.includes(r.slide.id) ? 'sel' : ''} ${r.slide.id === slideId ? 'focus' : ''} ${live?.presentationId === doc.id && live.slideId === r.slide.id ? 'live' : ''} ${r.slide.enabled === false ? 'off' : ''} ${dragOver?.id === r.slide.id ? 'drop' : ''}`}
              data-testid="film-slide" draggable
              onClick={(e) => selectSlide(r.slide.id, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'single')}
              onDragStart={(e) => {
                const ids = slideIds.includes(r.slide.id) ? slideIds : [r.slide.id]
                e.dataTransfer.setData('application/x-reach-slides', JSON.stringify(ids))
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-reach-slides')) { e.preventDefault(); setDragOver({ id: r.slide.id }) } }}
              onDragLeave={() => setDragOver(null)}
              onDrop={drop(r.slide.id)}
            >
              <span className="ed-film-n">{r.n}</span>
              <FilmThumb doc={doc} slide={r.slide} canvas={canvas} stage={kind === 'stage'} />
              {(r.slide.label || (canvas && r.slide.variants?.[canvas.id])) && (
                <div className="ed-film-meta">
                  <span>{r.slide.label}</span>
                  {canvas && r.slide.variants?.[canvas.id] && <span className="ed-badge" title={`Has its own ${canvas.name} layout`}>{canvas.name}</span>}
                </div>
              )}
            </div>
          ))}
        <div className="ed-film-end" onDragOver={(e) => e.preventDefault()} onDrop={drop(null)} />
      </div>
      {kind !== 'stage' && (
        <div className="ed-film-foot">
          <Button size="sm" variant="primary" onClick={newSlide} data-testid="new-slide" title={`New ${noun} with the same look`}>+ {noun[0].toUpperCase() + noun.slice(1)}</Button>
          <Button size="sm" onClick={duplicateSlides} title="Duplicate (⌘D with no item selected)">Duplicate</Button>
          <Button size="sm" variant="ghost" onClick={() => deleteSlides()} disabled={!slideIds.length}>Delete</Button>
        </div>
      )}
    </div>
  )
}

function FilmThumb({ doc, slide, canvas, stage }: { doc: Presentation; slide: Slide; canvas?: { id: string; width: number; height: number; regions: { id: string; name: string; rect: { x: number; y: number; w: number; h: number } }[] }; stage: boolean }): ReactNode {
  if (canvas && slide.variants?.[canvas.id]) {
    const r = resolveSlideForCanvas(slide, doc.size, canvas)
    return <div className="ed-film-thumb tall"><SlideThumb elements={r.elements} background={r.background} size={r.size}>{canvas.regions.map((g) => <RegionGuide key={g.id} region={g} />)}</SlideThumb></div>
  }
  return <div className="ed-film-thumb"><SlideThumb elements={slide.elements} background={slide.background} size={doc.size} tokens={stage ? sampleTokens() : undefined} /></div>
}
