/**
 * The headline feature: a tab per audience screen above the stage. "Main design" edits slide.elements;
 * any other tab edits (or offers to create) slide.variants[canvasId] in that screen's pixels with region guides.
 */
import { useState, type ReactNode } from 'react'
import type { Fill, Size, SlideElement } from '@shared/model'
import { resolveSlideForCanvas } from '@shared/model'
import { Fit, SlideThumb, SlideView } from '@shared/render/SlideView'
import { RegionGuide } from '@shared/render/LiveCanvas'
import { resolveSlideWithCanvasTheme } from '@shared/themes'
import { Button, Modal } from '@ui/index'
import { useApp } from '../../app/store'
import { applyLayoutTo, resetVariant } from './actions'
import { themeList, useDoc, useEditor } from './store'

export function CanvasTabs({ showAll, setShowAll }: { showAll: boolean; setShowAll: (v: boolean) => void }): ReactNode {
  const doc = useDoc()
  const slideId = useEditor((s) => s.slideId)
  const canvasId = useEditor((s) => s.canvasId)
  const canvases = useApp((s) => s.workspace?.canvases ?? []).filter((c) => c.kind !== 'stage')
  const [confirm, setConfirm] = useState<null | 'all' | 'group' | 'selected' | 'reset-all'>(null)
  const slide = doc?.slides.find((s) => s.id === slideId)
  const canvas = canvases.find((c) => c.id === canvasId)
  const custom = !!(slide && canvas && slide.variants?.[canvas.id])
  const group = doc && slide ? doc.groups.find((g) => g.slideIds.includes(slide.id)) : undefined
  const count = doc && canvas ? doc.slides.filter((s) => s.variants?.[canvas.id]).length : 0
  const pick = (id: string | null): void => useEditor.setState({ canvasId: id, selection: [], editingId: null })
  return (
    <>
      <div className="ed-canvas-tabs" data-testid="canvas-tabs">
        <button className={`ed-ctab ${!canvas ? 'on' : ''}`} onClick={() => pick(null)} data-testid="ctab-main">
          <span className="ed-ctab-dot" style={{ background: '#a9a7a1' }} />Main design<span className="dim">{doc?.size.width}×{doc?.size.height}</span>
        </button>
        {canvases.map((c) => (
          <button key={c.id} className={`ed-ctab ${c.id === canvasId ? 'on' : ''}`} onClick={() => pick(c.id)} data-testid={`ctab-${c.name}`}>
            <span className="ed-ctab-dot" style={{ background: c.color ?? '#3886CE' }} />{c.name}
            <span className="dim">{c.width}×{c.height}</span>
            {slide?.variants?.[c.id] && <span className="ed-badge" title="This slide has its own layout here">custom</span>}
          </button>
        ))}
        <div className="grow" />
        <Button size="sm" variant={showAll ? 'primary' : 'ghost'} onClick={() => setShowAll(!showAll)} data-testid="all-screens" title="Preview this slide on every screen">All screens</Button>
      </div>
      {canvas && custom && (
        <div className="ed-variant-bar" data-testid="variant-bar">
          <span><b>{canvas.name}</b> has its own layout for this slide{count > 1 ? ` (and ${count - 1} other${count > 2 ? 's' : ''})` : ''}. Words stay linked to the main design.</span>
          <div className="grow" />
          <Button size="sm" onClick={() => setConfirm('all')} data-testid="apply-all">Use this layout on all slides</Button>
          {group && group.slideIds.length > 1 && <Button size="sm" onClick={() => setConfirm('group')}>…on all of {group.name}</Button>}
          <Button size="sm" variant="ghost" onClick={() => resetVariant()} data-testid="reset-variant">Reset to main design</Button>
        </div>
      )}
      {canvas && !custom && count > 0 && (
        <div className="ed-variant-bar subtle"><span>{count} slide{count > 1 ? 's have' : ' has'} a custom {canvas.name} layout.</span><div className="grow" /><Button size="sm" variant="ghost" onClick={() => setConfirm('reset-all')}>Reset all to main design</Button></div>
      )}
      {showAll && doc && slide && (
        <div className="ed-allscreens" data-testid="allscreens">
          {[{ id: '', name: 'Main design', width: doc.size.width, height: doc.size.height, regions: [] as typeof canvases[number]['regions'], themeId: undefined } , ...canvases].map((c) => {
            const real = canvases.find((x) => x.id === c.id)
            const themed = real ? resolveSlideWithCanvasTheme(slide, doc.size, real, themeList()) : null
            const r = themed ?? (real ? resolveSlideForCanvas(slide, doc.size, real) : { elements: slide.elements, background: slide.background, size: doc.size })
            const size = real ? { width: real.width, height: real.height } : doc.size
            const inner = r.size.width === size.width && r.size.height === size.height
            return (
              <button key={c.id || 'main'} className={`ed-allscreen ${(c.id || null) === canvasId ? 'on' : ''}`} onClick={() => pick(c.id || null)} style={{ aspectRatio: `${size.width} / ${size.height}` }}>
                <SlideThumb elements={inner ? r.elements : []} background={inner ? r.background : undefined} size={size}>
                  {!inner && <div style={{ position: 'absolute', inset: 0 }}><ScaledInto r={r} size={size} /></div>}
                  {c.regions.map((g) => <RegionGuide key={g.id} region={g} />)}
                </SlideThumb>
                <span>{c.name}</span>
              </button>
            )
          })}
        </div>
      )}
      {confirm && canvas && (
        <Modal title={confirm === 'reset-all' ? `Reset ${canvas.name}?` : `Use this ${canvas.name} layout on ${confirm === 'all' ? 'every slide' : confirm === 'group' ? `all of ${group?.name}` : 'the selected slides'}?`} onClose={() => setConfirm(null)}
          footer={<><Button onClick={() => setConfirm(null)}>Cancel</Button><Button variant="primary" data-testid="confirm" onClick={() => {
            if (confirm === 'reset-all') resetVariant(doc!.slides.map((s) => s.id))
            else applyLayoutTo(confirm)
            setConfirm(null)
          }}>{confirm === 'reset-all' ? 'Reset all' : 'Apply'}</Button></>}>
          {confirm === 'reset-all'
            ? <p>Every slide goes back to showing the main design scaled on {canvas.name}. You can undo this.</p>
            : <p>Each slide keeps its own words; boxes, positions and styling for {canvas.name} are copied from this slide. Slides that already have a {canvas.name} layout are replaced. You can undo this (⌘Z).</p>}
        </Modal>
      )}
    </>
  )
}

function ScaledInto({ r, size }: { r: { elements: SlideElement[]; background?: Fill; size: Size }; size: Size }): ReactNode {
  return <div style={{ position: 'absolute', inset: 0, width: size.width, height: size.height }}><Fit size={r.size}><SlideView elements={r.elements} background={r.background} size={r.size} /></Fit></div>
}
