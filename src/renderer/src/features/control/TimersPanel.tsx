import { useState, type ReactNode } from 'react'
import { formatTimer, parseDuration, timerLevel, timerValue, type TimerDef } from '@shared/control'
import { useNow } from '@shared/render/LiveCanvas'
import { Button, Field, Input, Modal, Select, toast } from '@ui/index'
import { api, useLive } from '../../app/store'
import { attempt, useRpc } from './hooks'

export function TimerEditor({ timer, onClose }: { timer: Partial<TimerDef>; onClose: () => void }): ReactNode {
  const [t, setT] = useState<Partial<TimerDef>>({ kind: 'countdown', duration: 300, warnAt: 60, ...timer })
  const [len, setLen] = useState(formatTimer(t.duration ?? 300))
  const save = async (): Promise<void> => {
    const duration = parseDuration(len)
    if (t.kind === 'countdown' && duration === null) return toast('Type a length like 5, 5:00 or 1:00:00', 'warning')
    if (!t.name?.trim()) return toast('Give the timer a name', 'warning')
    await attempt(api.invoke('timers.save', { timer: { ...t, name: t.name.trim(), duration: duration ?? t.duration } as TimerDef }), toast)
    onClose()
  }
  return (
    <Modal title={timer.id ? 'Edit timer' : 'New timer'} onClose={onClose} width={440}
      footer={<>
        {timer.id && <Button variant="danger" onClick={async () => { if (confirm(`Delete the timer "${timer.name}"?`)) { await api.invoke('timers.remove', { id: timer.id! }); onClose() } }}>Delete</Button>}
        <div className="grow" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save</Button>
      </>}>
      <div className="col">
        <Field label="Name" hint="Use it in slides as {timer:Name}"><Input autoFocus value={t.name ?? ''} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder="e.g. Service starts" /></Field>
        <Field label="Kind">
          <Select value={t.kind} onChange={(e) => setT({ ...t, kind: e.target.value as TimerDef['kind'] })}>
            <option value="countdown">Count down from a length</option>
            <option value="countdownTo">Count down to a time of day</option>
            <option value="elapsed">Count up (stopwatch)</option>
          </Select>
        </Field>
        {t.kind === 'countdown' && <Field label="Length" hint="5 = five minutes · 5:30 · 1:00:00"><Input value={len} onChange={(e) => setLen(e.target.value)} /></Field>}
        {t.kind === 'countdownTo' && <Field label="Count down to"><Input type="time" value={t.target ?? '09:00'} onChange={(e) => setT({ ...t, target: e.target.value })} /></Field>}
        {t.kind !== 'elapsed' && <>
          <label className="row"><input type="checkbox" checked={!!t.overrun} onChange={(e) => setT({ ...t, overrun: e.target.checked })} /> Keep counting past zero (shows -0:15)</label>
          <Field label="Turn amber with this many seconds left"><Input type="number" min={0} value={t.warnAt ?? 60} onChange={(e) => setT({ ...t, warnAt: Number(e.target.value) })} /></Field>
        </>}
      </div>
    </Modal>
  )
}

export function TimersPanel(): ReactNode {
  const live = useLive()
  const [doc] = useRpc('timers.list', 'timers')
  const [edit, setEdit] = useState<Partial<TimerDef> | null>(null)
  const now = useNow(250)
  const ctl = (id: string, action: 'start' | 'stop' | 'reset' | 'adjust', seconds?: number) => () => void attempt(api.invoke('timers.control', { id, action, seconds }), toast)
  return (
    <div className="ctl-panel">
      {live.timers.length === 0 && <div className="ctl-empty">No timers yet.</div>}
      {live.timers.map((t) => {
        const def = doc?.timers.find((d) => d.id === t.id)
        const lvl = timerLevel(def, t, now)
        return (
          <div key={t.id} className="ctl-timer" data-testid={`timer-${t.id}`}>
            <button className="ctl-timer-name" title="Edit" onClick={() => def && setEdit(def)}>{t.name}</button>
            <span className={`ctl-timer-value lvl-${lvl}`}>{formatTimer(timerValue(t, now))}</span>
            <div className="ctl-timer-btns">
              {t.kind !== 'countdownTo' && (t.running
                ? <Button size="sm" onClick={ctl(t.id, 'stop')} title="Pause">Pause</Button>
                : <Button size="sm" variant="primary" onClick={ctl(t.id, 'start')} title="Start">Start</Button>)}
              <Button size="sm" variant="ghost" onClick={ctl(t.id, 'adjust', -60)} title="One minute less">−1</Button>
              <Button size="sm" variant="ghost" onClick={ctl(t.id, 'adjust', 60)} title="One minute more">+1</Button>
              <Button size="sm" variant="ghost" onClick={ctl(t.id, 'reset')} title="Reset">↺</Button>
              {t.kind !== 'elapsed' && <Button size="sm" variant="ghost" title="Show this countdown full screen on the audience screens"
                onClick={() => void attempt(api.invoke('timers.showCountdown', { id: t.id }), toast)}>Show</Button>}
            </div>
          </div>
        )
      })}
      <div className="row ctl-foot"><Button size="sm" variant="ghost" onClick={() => setEdit({})}>+ New timer</Button></div>
      {edit && <TimerEditor timer={edit} onClose={() => setEdit(null)} />}
    </div>
  )
}
