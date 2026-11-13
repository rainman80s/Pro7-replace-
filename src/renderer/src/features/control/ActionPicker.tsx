/**
 * <ActionPicker/> — choose an action type and fill in its parameters. Forms are generated from the
 * parameter schemas the main process publishes (`actions.types`), so new action types appear automatically.
 * Used by the macro editor, triggers, MIDI map, shortcuts — and exported for the slide inspector.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { describeAction, type ActionTypeInfo, type ParamSpec } from '@shared/control'
import { Input, Select, TextArea } from '@ui/index'
import { api } from '../../app/store'
import { useActionTypes } from './hooks'

export interface PickedAction { type: string; params?: Record<string, unknown>; delay?: number }

interface Option { value: string; label: string }
const optionCache = new Map<string, Promise<Option[]>>()

function listFor(kind: ParamSpec['kind']): Promise<Option[]> {
  const load = async (): Promise<Option[]> => {
    if (kind === 'timer') return (await api.invoke('timers.list')).timers.map((t) => ({ value: t.id, label: t.name }))
    if (kind === 'macro') return (await api.invoke('macros.list')).map((m) => ({ value: m.id, label: m.name }))
    if (kind === 'message') return (await api.invoke('messages.list')).messages.map((m) => ({ value: m.id, label: m.name }))
    if (kind === 'prop') return (await api.invoke('props.list')).props.map((p) => ({ value: p.id, label: p.name }))
    if (kind === 'audioPlaylist') return (await api.invoke('audio.list')).playlists.map((p) => ({ value: p.id, label: p.name }))
    return []
  }
  if (!optionCache.has(kind)) {
    const p = load().catch(() => [])
    optionCache.set(kind, p)
    setTimeout(() => optionCache.delete(kind), 3000)
  }
  return optionCache.get(kind)!
}

function ParamField({ spec, value, onChange }: { spec: ParamSpec; value: unknown; onChange: (v: unknown) => void }): ReactNode {
  const [opts, setOpts] = useState<Option[]>([])
  const isList = ['timer', 'macro', 'message', 'prop', 'audioPlaylist'].includes(spec.kind)
  useEffect(() => { if (isList) void listFor(spec.kind).then(setOpts) }, [spec.kind, isList])
  const v = value ?? ''
  let input: ReactNode
  if (spec.kind === 'boolean') {
    input = <input type="checkbox" checked={value === undefined ? !!spec.default : !!value} onChange={(e) => onChange(e.target.checked)} />
  } else if (spec.kind === 'select' || isList) {
    const options = spec.kind === 'select' ? (spec.options ?? []).map((o) => ({ value: String(o.value), label: o.label })) : opts
    input = (
      <Select value={String(v === '' && spec.default !== undefined ? spec.default : v)} onChange={(e) => onChange(e.target.value)}>
        {(spec.optional || v === '') && <option value="">{spec.optional ? '—' : 'Choose…'}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    )
  } else if (spec.kind === 'number' || spec.kind === 'duration') {
    input = <Input type="number" value={String(v)} min={spec.min} max={spec.max} placeholder={spec.default !== undefined ? String(spec.default) : spec.kind === 'duration' ? 'seconds' : ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
  } else if (spec.kind === 'json') {
    const [text, setText] = [typeof v === 'string' ? v : v === '' ? '' : JSON.stringify(v), (s: string) => { try { onChange(s.trim() ? JSON.parse(s) : undefined) } catch { onChange(s) } }]
    input = <Input value={text} placeholder={spec.hint ?? '{}'} onChange={(e) => setText(e.target.value)} />
  } else if (spec.kind === 'longtext') {
    input = <TextArea rows={3} value={String(v)} onChange={(e) => onChange(e.target.value)} />
  } else {
    input = <Input value={String(v)} placeholder={spec.hint} onChange={(e) => onChange(e.target.value || undefined)} />
  }
  return (
    <label className={`ctl-param ${spec.kind === 'boolean' ? 'inline' : ''}`}>
      <span>{spec.label}</span>
      {input}
    </label>
  )
}

export function ActionPicker({ value, onChange, showDelay, compact }: { value: PickedAction | null; onChange: (a: PickedAction) => void; showDelay?: boolean; compact?: boolean }): ReactNode {
  const types = useActionTypes()
  const info = types.find((t) => t.type === value?.type)
  const groups = useMemo(() => {
    const g = new Map<string, ActionTypeInfo[]>()
    for (const t of types) { if (!g.has(t.category)) g.set(t.category, []); g.get(t.category)!.push(t) }
    return [...g.entries()]
  }, [types])
  const params = value?.params ?? {}
  const visible = (info?.params ?? []).filter((p) => !p.when || p.when.in.includes(params[p.when.key] ?? (info?.params.find((x) => x.key === p.when!.key)?.default)))
  return (
    <div className={`ctl-action ${compact ? 'compact' : ''}`}>
      <label className="ctl-param">
        <span>Do this</span>
        <Select value={value?.type ?? ''} onChange={(e) => onChange({ ...value, type: e.target.value, params: {} })}>
          <option value="">Choose an action…</option>
          {groups.map(([cat, list]) => (
            <optgroup key={cat} label={cat}>
              {list.map((t) => <option key={t.type} value={t.type} disabled={t.available === false}>{t.label}</option>)}
            </optgroup>
          ))}
        </Select>
      </label>
      {info?.description && <div className="ctl-hint">{info.description}</div>}
      {visible.map((spec) => spec.key === '$json'
        ? <ParamField key="$json" spec={spec} value={value?.params} onChange={(v) => onChange({ ...value!, params: (v ?? {}) as Record<string, unknown> })} />
        : <ParamField key={spec.key} spec={spec} value={params[spec.key]} onChange={(v) => onChange({ ...value!, params: { ...params, [spec.key]: v } })} />)}
      {showDelay && value?.type && (
        <label className="ctl-param">
          <span>Wait before (seconds)</span>
          <Input type="number" min={0} step={0.5} value={value.delay ?? ''} onChange={(e) => onChange({ ...value, delay: e.target.value === '' ? undefined : Number(e.target.value) })} />
        </label>
      )}
    </div>
  )
}

/** Short summary for lists, e.g. "Start timer · sermon". */
export function ActionSummary({ action }: { action: PickedAction }): ReactNode {
  const types = useActionTypes()
  return <span>{describeAction({ type: action.type, params: action.params }, types)}{action.delay ? ` (after ${action.delay}s)` : ''}</span>
}

export default ActionPicker
