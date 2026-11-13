import { useState, type ReactNode } from 'react'
import { imageProp, textProp, type PropDef } from '@shared/control'
import { SlideThumb } from '@shared/render/SlideView'
import { Button, Field, Input, Modal, Select, Toggle, toast } from '@ui/index'
import { api, useLive, useWorkspace } from '../../app/store'
import { attempt, useRpc } from './hooks'

async function pickImage(): Promise<import('@shared/model').MediaRef | null> {
  if (!window.reachBridge) { toast('Adding images works on the main computer', 'warning'); return null }
  const paths = await api.invoke('system.pickFiles', { title: 'Choose an image', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }] })
  if (!paths.length) return null
  const [item] = await api.invoke('media.import', { paths, folder: 'Props' })
  return item ?? null
}

function NewProp({ onClose }: { onClose: () => void }): ReactNode {
  const ws = useWorkspace()
  const size = ws?.defaultSize ?? { width: 1920, height: 1080 }
  const [kind, setKind] = useState<'text' | 'image'>('text')
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [corner, setCorner] = useState<'br' | 'bl' | 'tr' | 'tl' | 'full'>('br')
  const [autoClear, setAutoClear] = useState(0)
  const create = async (): Promise<void> => {
    let p: PropDef | null = null
    if (kind === 'text') {
      if (!text.trim()) return toast('Type the text for the lower third', 'warning')
      p = textProp(name || text.split('\n')[0].slice(0, 30), text, size)
    } else {
      const media = await pickImage()
      if (!media) return
      p = imageProp(name || media.name || 'Logo', media, size, corner)
    }
    if (autoClear > 0) p.autoClear = autoClear
    await attempt(api.invoke('props.save', { prop: p }), toast)
    onClose()
  }
  return (
    <Modal title="New prop" onClose={onClose} width={460}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void create()}>{kind === 'image' ? 'Choose image…' : 'Create'}</Button></>}>
      <div className="col">
        <div className="row"><Button active={kind === 'text'} onClick={() => setKind('text')}>Lower third (text)</Button><Button active={kind === 'image'} onClick={() => setKind('image')}>Logo / image</Button></div>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'text' ? 'e.g. Pastor name' : 'e.g. Logo bug'} /></Field>
        {kind === 'text'
          ? <Field label="Text" hint="Two lines work well: name, then role"><textarea className="textarea" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Pastor Sam Lee\nLead Pastor'} /></Field>
          : <Field label="Where"><Select value={corner} onChange={(e) => setCorner(e.target.value as typeof corner)}>
              <option value="br">Bottom right</option><option value="bl">Bottom left</option><option value="tr">Top right</option><option value="tl">Top left</option><option value="full">Full screen</option>
            </Select></Field>}
        <Field label="Hide by itself after (seconds, 0 = never)"><Input type="number" min={0} value={autoClear} onChange={(e) => setAutoClear(Number(e.target.value))} /></Field>
      </div>
    </Modal>
  )
}

export function PropsPanel(): ReactNode {
  const live = useLive()
  const [doc, reload] = useRpc('props.list', 'props')
  const [adding, setAdding] = useState(false)
  const on = new Set(live.props.map((p) => p.id))
  const addMask = async (): Promise<void> => {
    const m = await pickImage()
    if (m && doc) { await api.invoke('props.masks', { masks: [...doc.masks, m] }); reload() }
  }
  return (
    <div className="ctl-panel">
      <div className="ctl-proplist scroll" data-testid="props-list">
        {doc?.props.map((p) => (
          <div key={p.id} className={`ctl-proprow ${on.has(p.id) ? 'on' : ''}`} data-testid="prop-row" title="Right-click to delete"
            onContextMenu={(e) => { e.preventDefault(); if (confirm(`Delete the prop "${p.name}"?`)) void api.invoke('props.remove', { id: p.id }) }}>
            <span className="ctl-propthumb"><SlideThumb checker elements={p.slide.elements} background={p.slide.background} size={p.size} /></span>
            <span className="ctl-propname truncate">{p.name}</span>
            <Toggle checked={on.has(p.id)} aria-label={`Show ${p.name}`} data-testid="prop-toggle" onChange={() => void attempt(api.invoke('props.toggle', { id: p.id }), toast)} />
          </div>
        ))}
      </div>
      {doc && !doc.props.length && <div className="ctl-empty">Props are overlays that stay up while slides change — a logo, a name lower third.</div>}
      <div className="row ctl-foot">
        <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>+ New prop</Button>
        <div className="grow" />
        {live.props.length > 0 && <Button size="sm" onClick={() => void api.invoke('live.clear', { layer: 'props' })}>Hide all</Button>}
      </div>
      <div className="ctl-sub">Mask</div>
      <div className="ctl-chips">
        {doc?.masks.map((m, i) => (
          <button key={i} className={`ctl-chip ${live.mask?.src === m.src ? 'on' : ''}`} onClick={() => void api.invoke('live.setMask', { media: live.mask?.src === m.src ? null : m })}>{m.name ?? `Mask ${i + 1}`}</button>
        ))}
        <button className="ctl-chip" onClick={() => void addMask()}>+ Add mask image</button>
      </div>
      {adding && <NewProp onClose={() => { setAdding(false); reload() }} />}
    </div>
  )
}
