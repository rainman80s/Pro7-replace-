import { useState, type ReactNode } from 'react'
import { DAY_NAMES, MACRO_COLORS, keyName, uid, type Trigger, type TriggerWhen } from '@shared/control'
import type { Macro, SlideAction } from '@shared/model'
import { Button, Field, Input, Modal, Select, toast } from '@ui/index'
import { api } from '../../app/store'
import { ActionPicker, ActionSummary, type PickedAction } from './ActionPicker'
import { attempt, useRpc } from './hooks'

export function MacroEditor({ macro, onClose }: { macro: Partial<Macro>; onClose: () => void }): ReactNode {
  const [m, setM] = useState<Partial<Macro>>({ color: MACRO_COLORS[0], actions: [], ...macro })
  const [open, setOpen] = useState<number | null>(macro.actions?.length ? null : 0)
  const actions = m.actions ?? []
  const setAction = (i: number, a: PickedAction): void => setM({ ...m, actions: actions.map((x, j) => (j === i ? { ...x, ...a } : x)) })
  const move = (i: number, d: number): void => {
    const next = [...actions]
    const [x] = next.splice(i, 1)
    next.splice(Math.max(0, Math.min(next.length, i + d)), 0, x)
    setM({ ...m, actions: next })
  }
  const save = async (): Promise<void> => {
    if (!m.name?.trim()) return toast('Give the macro a name', 'warning')
    await attempt(api.invoke('macros.save', { macro: { ...m, name: m.name.trim(), actions: actions.filter((a) => a.type) } as Macro }), toast)
    onClose()
  }
  return (
    <Modal title={macro.id ? 'Edit macro' : 'New macro'} onClose={onClose} width={560}
      footer={<>
        {macro.id && <Button variant="danger" onClick={async () => { if (confirm(`Delete the macro "${macro.name}"?`)) { await api.invoke('macros.remove', { id: macro.id! }); onClose() } }}>Delete</Button>}
        <div className="grow" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save</Button>
      </>}>
      <div className="col">
        <div className="row">
          <Field label="Name"><Input autoFocus value={m.name ?? ''} onChange={(e) => setM({ ...m, name: e.target.value })} placeholder="e.g. Pre-service" /></Field>
          <div className="ctl-colors">{MACRO_COLORS.map((c) => <button key={c} className={`ctl-color ${m.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setM({ ...m, color: c })} aria-label={c} />)}</div>
        </div>
        <div className="ctl-sub">Steps — run top to bottom</div>
        {actions.map((a, i) => (
          <div key={a.id} className="ctl-step">
            <div className="row">
              <span className="ctl-step-n">{i + 1}</span>
              <button className="grow ctl-step-sum" onClick={() => setOpen(open === i ? null : i)}>{a.type ? <ActionSummary action={a} /> : <em>Choose an action…</em>}</button>
              <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0}>↑</Button>
              <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === actions.length - 1}>↓</Button>
              <Button size="sm" variant="ghost" onClick={() => setM({ ...m, actions: actions.filter((_, j) => j !== i) })}>✕</Button>
            </div>
            {open === i && <ActionPicker value={a} onChange={(v) => setAction(i, v)} showDelay />}
          </div>
        ))}
        <Button onClick={() => { setM({ ...m, actions: [...actions, { id: uid('a'), type: '' } as SlideAction] }); setOpen(actions.length) }}>+ Add a step</Button>
      </div>
    </Modal>
  )
}

export function MacrosPanel(): ReactNode {
  const [list] = useRpc('macros.list', 'macros')
  const [edit, setEdit] = useState<Partial<Macro> | null>(null)
  return (
    <div className="ctl-panel">
      <div className="ctl-macros">
        {list?.map((m) => (
          <button key={m.id} className="ctl-macro" style={{ ['--c' as string]: m.color ?? MACRO_COLORS[0] }} title="Click to run · right-click to edit"
            onClick={() => void attempt(api.invoke('live.runMacro', { id: m.id }), toast)} onContextMenu={(e) => { e.preventDefault(); setEdit(m) }}>{m.name}</button>
        ))}
      </div>
      {list && !list.length && <div className="ctl-empty">Macros do several things with one click — e.g. clear the screen, start the countdown and play walk-in music.</div>}
      <div className="row ctl-foot"><Button size="sm" variant="ghost" onClick={() => setEdit({})}>+ New macro</Button></div>
      {edit && <MacroEditor macro={edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

const WHEN_LABEL: Record<TriggerWhen['type'], string> = {
  hotkey: 'A key is pressed', schedule: 'On a schedule', label: 'A slide or song section goes live', startup: 'Reach Presenter starts', http: 'A web address is called', timerEnd: 'A timer reaches zero'
}

function defaultWhen(type: TriggerWhen['type']): TriggerWhen {
  switch (type) {
    case 'hotkey': return { type, key: 'F9' }
    case 'schedule': return { type, days: [0], time: '08:55' }
    case 'label': return { type, match: 'Chorus', scope: 'group' }
    case 'http': return { type, name: 'doors-open' }
    case 'timerEnd': return { type, timer: '' }
    default: return { type: 'startup' }
  }
}

function TriggerEditor({ trigger, onClose }: { trigger: Partial<Trigger>; onClose: () => void }): ReactNode {
  const [t, setT] = useState<Partial<Trigger>>({ enabled: true, when: { type: 'schedule', days: [0], time: '08:55' }, action: { type: 'macro.run' }, ...trigger })
  const w = t.when!
  const save = async (): Promise<void> => {
    if (!t.action?.type) return toast('Choose what should happen', 'warning')
    await attempt(api.invoke('triggers.save', { trigger: { ...t, name: t.name?.trim() || WHEN_LABEL[w.type] } as Trigger }), toast)
    onClose()
  }
  return (
    <Modal title={trigger.id ? 'Edit automation' : 'New automation'} onClose={onClose} width={520}
      footer={<>
        {trigger.id && <Button variant="danger" onClick={async () => { await api.invoke('triggers.remove', { id: trigger.id! }); onClose() }}>Delete</Button>}
        <div className="grow" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save</Button>
      </>}>
      <div className="col">
        <Field label="Name"><Input value={t.name ?? ''} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder="e.g. Sunday pre-service" /></Field>
        <Field label="When">
          <Select value={w.type} onChange={(e) => setT({ ...t, when: defaultWhen(e.target.value as TriggerWhen['type']) })}>
            {Object.entries(WHEN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        {w.type === 'hotkey' && <Field label="Key" hint="Click and press the key"><Input readOnly value={w.key} onKeyDown={(e) => { e.preventDefault(); const k = keyName(e); if (k) setT({ ...t, when: { ...w, key: k } }) }} /></Field>}
        {w.type === 'schedule' && <>
          <div className="ctl-chips">{DAY_NAMES.map((d, i) => <button key={d} className={`ctl-chip ${w.days.includes(i) ? 'on' : ''}`} onClick={() => setT({ ...t, when: { ...w, days: w.days.includes(i) ? w.days.filter((x) => x !== i) : [...w.days, i].sort() } })}>{d.slice(0, 3)}</button>)}</div>
          <Field label="At"><Input type="time" value={w.time} onChange={(e) => setT({ ...t, when: { ...w, time: e.target.value } })} /></Field>
        </>}
        {w.type === 'label' && <div className="row">
          <Field label="Name to match (* = anything)"><Input value={w.match} onChange={(e) => setT({ ...t, when: { ...w, match: e.target.value } })} /></Field>
          <Field label="Look at"><Select value={w.scope ?? 'both'} onChange={(e) => setT({ ...t, when: { ...w, scope: e.target.value as 'slide' } })}>
            <option value="group">Song section (Chorus…)</option><option value="slide">Slide label</option><option value="both">Either</option>
          </Select></Field>
        </div>}
        {w.type === 'http' && <Field label="Name" hint={`POST /api/v1/trigger/${w.name}`}><Input value={w.name} onChange={(e) => setT({ ...t, when: { ...w, name: e.target.value.replace(/[^\w-]/g, '-') } })} /></Field>}
        {w.type === 'timerEnd' && <Field label="Timer name"><Input value={w.timer} onChange={(e) => setT({ ...t, when: { ...w, timer: e.target.value } })} /></Field>}
        <div className="ctl-sub">Then</div>
        <ActionPicker value={t.action ?? null} onChange={(a) => setT({ ...t, action: { type: a.type, params: a.params } })} />
      </div>
    </Modal>
  )
}


export function MacrosSettings(): ReactNode {
  const [list] = useRpc('macros.list', 'macros')
  const [trigs] = useRpc('triggers.list', 'triggers')
  const [edit, setEdit] = useState<Partial<Macro> | null>(null)
  const [editT, setEditT] = useState<Partial<Trigger> | null>(null)
  return (
    <div className="ctl-settings col">
      <p className="dim">A <b>macro</b> is a list of steps run with one click. An <b>automation</b> runs a step by itself — at a time, on a key, when a song section goes live, or when another system calls a web address.</p>
      <div className="ctl-sub">Macros</div>
      <div className="ctl-table">
        {list?.map((m) => (
          <div key={m.id} className="ctl-tr">
            <span className="ctl-dot" style={{ background: m.color }} />
            <b className="grow">{m.name}</b>
            <span className="dim">{m.actions.length} step{m.actions.length === 1 ? '' : 's'}</span>
            <Button size="sm" onClick={() => void attempt(api.invoke('live.runMacro', { id: m.id }), toast)}>Run</Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(m)}>Edit</Button>
          </div>
        ))}
      </div>
      <div><Button onClick={() => setEdit({})}>+ New macro</Button></div>
      <div className="ctl-sub row">Automations
        <label className="row dim" style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}>
          <input type="checkbox" checked={trigs?.scheduleEnabled !== false} onChange={(e) => void api.invoke('triggers.settings', { scheduleEnabled: e.target.checked })} /> Schedules on (turn off for weddings & rehearsals)
        </label>
      </div>
      <div className="ctl-table">
        {trigs?.triggers.map((t) => (
          <div key={t.id} className="ctl-tr">
            <input type="checkbox" checked={t.enabled} onChange={(e) => void api.invoke('triggers.save', { trigger: { ...t, enabled: e.target.checked } })} />
            <b>{t.name}</b>
            <span className="dim grow">{describeWhen(t.when)} → <ActionSummary action={t.action} /></span>
            <Button size="sm" onClick={() => void attempt(api.invoke('triggers.fire', { id: t.id }), toast)}>Test</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditT(t)}>Edit</Button>
          </div>
        ))}
      </div>
      <div><Button onClick={() => setEditT({})}>+ New automation</Button></div>
      {edit && <MacroEditor macro={edit} onClose={() => setEdit(null)} />}
      {editT && <TriggerEditor trigger={editT} onClose={() => setEditT(null)} />}
    </div>
  )
}

function describeWhen(w: TriggerWhen): string {
  if (w.type === 'hotkey') return `Key ${w.key}`
  if (w.type === 'schedule') return `${w.days.length === 7 ? 'Every day' : w.days.map((d) => DAY_NAMES[d].slice(0, 3)).join(', ')} at ${w.time}`
  if (w.type === 'label') return `“${w.match}” goes live`
  if (w.type === 'http') return `/api/v1/trigger/${w.name}`
  if (w.type === 'timerEnd') return `Timer “${w.timer}” ends`
  return 'At start-up'
}
