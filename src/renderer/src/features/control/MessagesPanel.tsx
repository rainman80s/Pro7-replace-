import { useState, type ReactNode } from 'react'
import { messageFields, type MessageTemplate } from '@shared/control'
import { Button, Field, Input, Modal, Select, TextArea, toast } from '@ui/index'
import { api, useLive } from '../../app/store'
import { attempt, useRpc } from './hooks'

export function MessageEditor({ msg, onClose }: { msg: Partial<MessageTemplate>; onClose: () => void }): ReactNode {
  const [m, setM] = useState<Partial<MessageTemplate>>({ position: 'bottom', ...msg })
  const save = async (): Promise<void> => {
    if (!m.name?.trim() || !m.text?.trim()) return toast('A message needs a name and some text', 'warning')
    await attempt(api.invoke('messages.save', { message: m as MessageTemplate }), toast)
    onClose()
  }
  return (
    <Modal title={msg.id ? 'Edit message' : 'New message'} onClose={onClose} width={480}
      footer={<>
        {msg.id && <Button variant="danger" onClick={async () => { if (confirm(`Delete "${msg.name}"?`)) { await api.invoke('messages.remove', { id: msg.id! }); onClose() } }}>Delete</Button>}
        <div className="grow" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save</Button>
      </>}>
      <div className="col">
        <Field label="Name"><Input autoFocus value={m.name ?? ''} onChange={(e) => setM({ ...m, name: e.target.value })} placeholder="e.g. Nursery call" /></Field>
        <Field label="Text" hint="{number} = a blank you fill in when showing it · {timer:Name} · {clock}">
          <TextArea rows={3} value={m.text ?? ''} onChange={(e) => setM({ ...m, text: e.target.value })} placeholder="Parent of child {number}, please come to the nursery" />
        </Field>
        <div className="row">
          <Field label="Where"><Select value={m.position} onChange={(e) => setM({ ...m, position: e.target.value as MessageTemplate['position'] })}>
            <option value="bottom">Bottom</option><option value="top">Top</option><option value="center">Middle</option>
          </Select></Field>
          <Field label="Hide after (seconds, 0 = never)"><Input type="number" min={0} value={m.autoHide ?? 0} onChange={(e) => setM({ ...m, autoHide: Number(e.target.value) || undefined })} /></Field>
        </div>
      </div>
    </Modal>
  )
}

function ShowMessage({ msg, onDone }: { msg: MessageTemplate; onDone: () => void }): ReactNode {
  const fields = messageFields(msg.text)
  const [values, setValues] = useState<Record<string, string>>({})
  const show = async (): Promise<void> => {
    await attempt(api.invoke('messages.show', { id: msg.id, values }), toast)
    onDone()
  }
  return (
    <form className="ctl-fill" onSubmit={(e) => { e.preventDefault(); void show() }}>
      {fields.map((f, i) => (
        <Input key={f} autoFocus={i === 0} placeholder={f} value={values[f] ?? ''} onChange={(e) => setValues({ ...values, [f]: e.target.value })} />
      ))}
      <Button size="sm" variant="live" type="submit">Show</Button>
      <Button size="sm" variant="ghost" type="button" onClick={onDone}>Cancel</Button>
    </form>
  )
}

export function MessagesPanel(): ReactNode {
  const live = useLive()
  const [doc] = useRpc('messages.list', 'messages')
  const [filling, setFilling] = useState<string | null>(null)
  const [edit, setEdit] = useState<Partial<MessageTemplate> | null>(null)
  const [stage, setStage] = useState('')
  const onScreen = new Set(live.messages.map((m) => m.id))
  return (
    <div className="ctl-panel">
      {doc?.messages.map((m) => (
        <div key={m.id} className={`ctl-msg ${onScreen.has(m.id) ? 'on' : ''}`}>
          <div className="row">
            <button className="ctl-msg-name" onDoubleClick={() => setEdit(m)} title="Double-click to edit">{m.name}</button>
            {onScreen.has(m.id)
              ? <Button size="sm" onClick={() => void api.invoke('messages.hide', { id: m.id })}>Hide</Button>
              : <Button size="sm" variant="primary" onClick={() => (messageFields(m.text).length ? setFilling(m.id) : void attempt(api.invoke('messages.show', { id: m.id }), toast))}>Show…</Button>}
            <Button size="sm" variant="ghost" onClick={() => setEdit(m)} title="Edit">✎</Button>
          </div>
          {filling === m.id && <ShowMessage msg={m} onDone={() => setFilling(null)} />}
        </div>
      ))}
      <div className="row ctl-foot">
        <Button size="sm" variant="ghost" onClick={() => setEdit({})}>+ New message</Button>
        <div className="grow" />
        {live.messages.length > 0 && <Button size="sm" onClick={() => void api.invoke('messages.hide', {})}>Hide all</Button>}
      </div>
      <div className="ctl-sub">Stage message {live.stageMessage && <span className="ctl-badge">on stage: “{live.stageMessage}”</span>}</div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void api.invoke('messages.stage', { text: stage, flash: true }) }}>
        <Input className="grow" placeholder="Only the stage screen sees this" value={stage} onChange={(e) => setStage(e.target.value)} />
        <Button size="sm" variant="primary" type="submit" disabled={!stage}>Send</Button>
        <Button size="sm" type="button" disabled={!live.stageMessage} onClick={() => { setStage(''); void api.invoke('messages.stage', { text: '' }) }}>Clear</Button>
      </form>
      <div className="ctl-chips">
        {doc?.stagePresets.map((p) => <button key={p} className="ctl-chip" onClick={() => { setStage(p); void api.invoke('messages.stage', { text: p, flash: true }) }}>{p}</button>)}
      </div>
      {edit && <MessageEditor msg={edit} onClose={() => setEdit(null)} />}
    </div>
  )
}
