import { type ReactNode } from 'react'
import type { Output } from '@shared/model'
import { Button, Panel, Select } from '@ui/index'
import { defineFeature } from '../../app/feature'
import { api, useApp } from '../../app/store'

/** BASELINE Displays screen: see connected displays, route a canvas/region to each. */
function DisplaysView(): ReactNode {
  const { displays, outputs, workspace } = useApp()
  const canvases = workspace?.canvases ?? []
  const save = (output: Output): void => void api.invoke('outputs.save', { output })
  const add = (target: Output['target'], name: string): void => save({ id: '', name, canvasId: canvases[0]?.id ?? 'main', target, enabled: true })
  return (
    <div className="col scroll" style={{ padding: 16, height: '100%', gap: 16 }}>
      <div className="row">
        <h2 style={{ font: '28px/1.2 var(--font-display)', fontWeight: 400, margin: 0 }}>Displays</h2>
        <div className="grow" />
        <Button onClick={() => void api.invoke('outputs.identify')}>Identify</Button>
        <Button onClick={() => add({ type: 'window' }, 'Preview Window')}>+ Floating window</Button>
      </div>
      <Panel title="Connected to this computer">
        <div className="col" style={{ padding: 12 }}>
          {displays.map((d) => (
            <div key={d.key} className="row">
              <strong style={{ width: 240 }}>{d.label}{d.primary ? ' (operator)' : ''}</strong>
              <span className="dim" style={{ width: 120 }}>{d.bounds.width}×{d.bounds.height}</span>
              {d.outputIds.length ? <span className="dim">in use</span> : <Button size="sm" variant="primary" disabled={d.primary} onClick={() => add({ type: 'display', displayKey: d.key }, d.label)}>Use as output</Button>}
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Outputs">
        <div className="col" style={{ padding: 12 }}>
          {!outputs.length && <span className="dim">No outputs yet.</span>}
          {outputs.map((o) => {
            const canvas = canvases.find((c) => c.id === o.canvasId)
            return (
              <div key={o.id} className="row">
                <input type="checkbox" checked={o.enabled} onChange={(e) => save({ ...o, enabled: e.target.checked })} />
                <strong style={{ width: 220 }}>{o.name}</strong>
                <span className="dim" style={{ width: 90 }}>{o.target.type}</span>
                <Select value={o.canvasId} onChange={(e) => save({ ...o, canvasId: e.target.value, regionId: undefined })}>{canvases.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
                <Select value={o.regionId ?? ''} onChange={(e) => save({ ...o, regionId: e.target.value || undefined })}>
                  <option value="">Whole canvas</option>
                  {canvas?.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
                <Button size="sm" variant="ghost" onClick={() => void api.invoke('outputs.remove', { id: o.id })}>Remove</Button>
              </div>
            )
          })}
        </div>
      </Panel>
    </div>
  )
}

export default defineFeature({
  id: 'displays',
  views: [{ id: 'displays', title: 'Displays', order: 60, component: DisplaysView }]
})
