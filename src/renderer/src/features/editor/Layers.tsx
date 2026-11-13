/** Layers: top of the list = in front. Click to select, eye/lock toggles, double-click to rename, drag to reorder. */
import { useState, type ReactNode } from 'react'
import type { ID, SlideElement } from '@shared/model'
import { useApp } from '../../app/store'
import { patchElements, surfaceOf, updateElements, useDoc, useEditor, audienceCanvases } from './store'

const icon = (e: SlideElement): string => (e.type === 'text' ? (e.dynamic ? '{}' : 'T') : e.type === 'shape' ? (e.shape === 'ellipse' ? '○' : e.shape === 'line' ? '—' : '▭') : e.type === 'image' ? '▣' : e.type === 'video' ? '▶' : '◉')
export const elementLabel = (e: SlideElement): string => e.name || (e.type === 'text' ? e.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join(' ').slice(0, 30) || 'Text' : e.type[0].toUpperCase() + e.type.slice(1))

export function Layers(): ReactNode {
  const doc = useDoc()
  const slideId = useEditor((s) => s.slideId)
  const canvasId = useEditor((s) => s.canvasId)
  const selection = useEditor((s) => s.selection)
  useApp((s) => s.workspace)
  const [renaming, setRenaming] = useState<ID | null>(null)
  const [over, setOver] = useState<ID | null>(null)
  const surf = surfaceOf(doc, slideId, canvasId, audienceCanvases())
  if (!surf) return null
  const list = [...surf.elements].reverse()
  const regionName = (id?: ID): string | undefined => surf.regions.find((r) => r.id === id)?.name
  const move = (id: ID, beforeId: ID): void => {
    updateElements((els) => {
      const it = els.find((e) => e.id === id)!
      const rest = els.filter((e) => e.id !== id)
      // list is reversed: dropping "before" X in the list = just above X in z-order.
      const at = rest.findIndex((e) => e.id === beforeId)
      return [...rest.slice(0, at + 1), it, ...rest.slice(at + 1)]
    }, 'Reorder')
  }
  return (
    <div className="ed-layers" data-testid="layers">
      {!list.length && <div className="dim" style={{ padding: 10 }}>No items on this slide.</div>}
      {list.map((e) => (
        <div key={e.id} className={`ed-layer ${selection.includes(e.id) ? 'sel' : ''} ${e.hidden ? 'off' : ''} ${over === e.id ? 'drop' : ''}`} draggable={!surf.inherited}
          onClick={(ev) => useEditor.setState({ selection: ev.shiftKey || ev.metaKey ? (selection.includes(e.id) ? selection.filter((x) => x !== e.id) : [...selection, e.id]) : [e.id], tab: 'design' })}
          onDoubleClick={() => !surf.inherited && setRenaming(e.id)}
          onDragStart={(ev) => ev.dataTransfer.setData('application/x-reach-layer', e.id)}
          onDragOver={(ev) => { if (ev.dataTransfer.types.includes('application/x-reach-layer')) { ev.preventDefault(); setOver(e.id) } }}
          onDragLeave={() => setOver(null)}
          onDrop={(ev) => { setOver(null); const id = ev.dataTransfer.getData('application/x-reach-layer'); if (id && id !== e.id) move(id, e.id) }}>
          <span className="ed-layer-icon">{icon(e)}</span>
          {renaming === e.id
            ? <input className="input" autoFocus defaultValue={e.name ?? ''} onBlur={(ev) => { patchElements([e.id], { name: ev.target.value || undefined }, 'Rename'); setRenaming(null) }} onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); if (ev.key === 'Escape') setRenaming(null) }} onClick={(ev) => ev.stopPropagation()} />
            : <span className="grow ed-layer-name">{elementLabel(e)}{e.fromTheme && <span className="dim"> · theme</span>}</span>}
          {regionName(e.regionId) && <span className="ed-badge">{regionName(e.regionId)}</span>}
          {!surf.inherited && (
            <>
              <button className={`ed-ico ${e.hidden ? 'on' : ''}`} title={e.hidden ? 'Show' : 'Hide'} onClick={(ev) => { ev.stopPropagation(); patchElements([e.id], { hidden: e.hidden ? undefined : true }, e.hidden ? 'Show' : 'Hide') }}>{e.hidden ? '◌' : '◉'}</button>
              <button className={`ed-ico ${e.locked ? 'on' : ''}`} title={e.locked ? 'Unlock' : 'Lock'} onClick={(ev) => { ev.stopPropagation(); patchElements([e.id], { locked: e.locked ? undefined : true }, e.locked ? 'Unlock' : 'Lock') }}>{e.locked ? '🔒︎' : '🔓︎'}</button>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
