import { useEffect, useState, type ReactNode } from 'react'
import {
  describeMatch, matchFromMessage, noteName, toHex,
  type MidiDeviceSettings, type MidiLogEntry, type MidiMapping, type MidiMatch, type MidiPorts
} from '@shared/control-midi'
import { Button, Field, Input, Modal, Select, toast } from '@ui/index'
import { api } from '../../app/store'
import { ActionPicker, ActionSummary } from './ActionPicker'
import { attempt, useRpc } from './hooks'

function useMidiLog(limit = 50): MidiLogEntry[] {
  const [log, setLog] = useState<MidiLogEntry[]>([])
  useEffect(() => {
    void api.invoke('midi.log').then((l) => setLog(l.slice(-limit))).catch(() => {})
    return api.on('midi.message', (e) => setLog((l) => [...l.slice(-(limit - 1)), e]))
  }, [limit])
  return log
}

function usePorts(): MidiPorts | null {
  const [p, setP] = useState<MidiPorts | null>(null)
  useEffect(() => {
    void api.invoke('midi.ports').then(setP).catch(() => {})
    return api.on('midi.portsChanged', setP)
  }, [])
  return p
}

export function MidiLog({ entries }: { entries: MidiLogEntry[] }): ReactNode {
  return (
    <div className="ctl-midilog" role="log">
      {entries.length === 0 && <div className="ctl-empty">Nothing received yet. Press a pad or play a note.</div>}
      {[...entries].reverse().map((e) => (
        <div key={e.id} className={`ctl-midirow ${e.dir}`}>
          <span className="ctl-mono dim">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          <span className="ctl-dir">{e.dir === 'in' ? 'IN' : 'OUT'}</span>
          <span className="grow">{e.text}<span className="dim"> · {e.port}</span></span>
          {e.fired?.length ? <span className="ctl-badge">{e.fired.join(', ')}</span> : null}
        </div>
      ))}
    </div>
  )
}

/** Compact monitor for the Show screen. */
export function MidiPanel(): ReactNode {
  const log = useMidiLog(6)
  const ports = usePorts()
  if (ports && !ports.available) return <div className="ctl-panel"><div className="ctl-empty">MIDI is off on this computer. {ports.reason}</div></div>
  return <div className="ctl-panel"><MidiLog entries={log} /></div>
}

function MappingEditor({ mapping, onClose }: { mapping: Partial<MidiMapping>; onClose: () => void }): ReactNode {
  const [m, setM] = useState<Partial<MidiMapping>>({ enabled: true, match: { kind: 'noteon' }, action: { type: '' }, ...mapping })
  const [learning, setLearning] = useState(false)
  const match = m.match!
  const learn = async (): Promise<void> => {
    setLearning(true)
    const r = await api.invoke('midi.learn', { timeoutMs: 15000 }).catch(() => null)
    setLearning(false)
    const mm = r && matchFromMessage(r.message)
    if (mm) setM({ ...m, match: mm })
    else toast('Nothing heard — check the device is connected', 'warning')
  }
  const setMatch = (p: Partial<MidiMatch>): void => setM({ ...m, match: { ...match, ...p } })
  const num = (v: string): number | undefined => (v === '' ? undefined : Math.max(0, Math.min(127, Number(v))))
  const save = async (): Promise<void> => {
    if (!m.action?.type) return toast('Choose what this MIDI message should do', 'warning')
    await attempt(api.invoke('midi.saveMapping', { mapping: { ...m, name: m.name?.trim() || describeMatch(match) } as MidiMapping }), toast)
    onClose()
  }
  return (
    <Modal title={mapping.id ? 'Edit MIDI command' : 'New MIDI command'} onClose={onClose} width={540}
      footer={<>
        {mapping.id && <Button variant="danger" onClick={async () => { await api.invoke('midi.removeMapping', { id: mapping.id! }); onClose() }}>Delete</Button>}
        <div className="grow" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save</Button>
      </>}>
      <div className="col">
        <Field label="Name"><Input value={m.name ?? ''} onChange={(e) => setM({ ...m, name: e.target.value })} placeholder="e.g. Pad 1 → next slide" /></Field>
        <div className="row">
          <Button variant={learning ? 'live' : 'primary'} onClick={() => (learning ? void api.invoke('midi.cancelLearn') : void learn())}>{learning ? 'Listening… press a pad or key' : 'Learn from device'}</Button>
          <span className="dim">{describeMatch(match)}</span>
        </div>
        <div className="row">
          <Field label="Message"><Select value={match.kind} onChange={(e) => setMatch({ kind: e.target.value as MidiMatch['kind'] })}>
            <option value="noteon">Note On</option><option value="noteoff">Note Off</option><option value="cc">Control Change</option><option value="pc">Program Change</option>
          </Select></Field>
          <Field label={match.kind === 'cc' ? 'CC number' : match.kind === 'pc' ? 'Program' : `Note${match.number !== undefined && match.kind.startsWith('note') ? ` (${noteName(match.number)})` : ''}`}>
            <Input type="number" min={0} max={127} placeholder="any" value={match.number ?? ''} onChange={(e) => setMatch({ number: num(e.target.value) })} /></Field>
          <Field label="Channel"><Input type="number" min={1} max={16} placeholder="any" value={match.channel ?? ''} onChange={(e) => setMatch({ channel: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
          {match.kind !== 'pc' && <Field label="Only value"><Input type="number" min={0} max={127} placeholder="any" value={match.value ?? ''} onChange={(e) => setMatch({ value: num(e.target.value) })} /></Field>}
        </div>
        <label className="row"><input type="checkbox" checked={!!m.valueParam} onChange={(e) => setM({ ...m, valueParam: e.target.checked ? { key: 'index', from: 'value' } : undefined })} />
          Use the velocity / value as a number (e.g. velocity 6 = slide 6)</label>
        {m.valueParam && <Field label="Put it into parameter"><Input value={m.valueParam.key} onChange={(e) => setM({ ...m, valueParam: { ...m.valueParam!, key: e.target.value } })} /></Field>}
        <div className="ctl-sub">Then</div>
        <ActionPicker value={m.action ?? null} onChange={(a) => setM({ ...m, action: { type: a.type, params: a.params } })} />
      </div>
    </Modal>
  )
}

export function MidiSettings(): ReactNode {
  const ports = usePorts()
  const [devices, setDevices] = useState<MidiDeviceSettings | null>(null)
  const [doc] = useRpc('midi.mappings', 'midi')
  const [edit, setEdit] = useState<Partial<MidiMapping> | null>(null)
  const [offset, setOffset] = useState(0)
  const log = useMidiLog(30)
  useEffect(() => { void api.invoke('midi.devices').then(setDevices).catch(() => {}) }, [])
  const setDev = async (p: Partial<MidiDeviceSettings>): Promise<void> => setDevices(await api.invoke('midi.devices', p))
  const toggleList = (list: string[], name: string): string[] => (list.includes(name) ? list.filter((n) => n !== name) : [...list, name])
  return (
    <div className="ctl-settings col">
      <p className="dim">Control Reach Presenter from Ableton, Playback (MultiTracks), a lighting desk or a pad controller — the same way ProPresenter's MIDI Map works. See <span className="ctl-mono">docs/control/midi.md</span>.</p>
      {ports && !ports.available && <div className="ctl-warn">MIDI isn't available on this computer: {ports.reason}</div>}
      {ports?.available && devices && <>
        <div className="ctl-sub">Listen to</div>
        <label className="row"><input type="checkbox" checked={devices.allInputs} onChange={(e) => void setDev({ allInputs: e.target.checked })} /> Every MIDI input (recommended)</label>
        <div className="ctl-chips">
          {ports.inputs.map((i) => <button key={i.name} className={`ctl-chip ${i.open ? 'on' : ''}`} disabled={devices.allInputs} onClick={() => void setDev({ inputs: toggleList(devices.inputs, i.name) })}>{i.name}</button>)}
          {!ports.inputs.length && <span className="dim">No MIDI inputs found. Plug one in — it appears here automatically.</span>}
        </div>
        <div className="ctl-sub">Send to</div>
        <div className="ctl-chips">
          {ports.outputs.map((o) => <button key={o.name} className={`ctl-chip ${devices.outputs.includes(o.name) ? 'on' : ''}`} onClick={() => void setDev({ outputs: toggleList(devices.outputs, o.name) })}>{o.name}</button>)}
          {!ports.outputs.length && <span className="dim">No MIDI outputs found.</span>}
        </div>
        <label className="row"><input type="checkbox" disabled={!ports.virtual.supported} checked={devices.virtualPort} onChange={(e) => void setDev({ virtualPort: e.target.checked })} />
          Offer a “{ports.virtual.name}” MIDI port to other apps on this computer {!ports.virtual.supported && '(not on Windows — use loopMIDI)'}</label>
      </>}
      <div className="ctl-sub row">MIDI commands
        <label className="row dim" style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}>
          <input type="checkbox" checked={doc?.enabled !== false} onChange={(e) => void api.invoke('midi.setEnabled', { enabled: e.target.checked })} /> On
        </label>
      </div>
      <div className="row">
        <Button onClick={() => setEdit({})}>+ New MIDI command</Button>
        <div className="grow" />
        <span className="dim">ProPresenter map, starting note</span>
        <Input type="number" min={0} max={99} style={{ width: 64 }} value={offset} onChange={(e) => setOffset(Number(e.target.value))} />
        <Button onClick={() => void attempt(api.invoke('midi.applyPreset', { preset: 'propresenter', offset }), toast).then(() => toast('ProPresenter-compatible MIDI map added', 'success'))}>Auto fill</Button>
        <Button variant="ghost" onClick={() => void api.invoke('midi.applyPreset', { preset: 'propresenter', remove: true })}>Remove</Button>
      </div>
      <div className="ctl-table ctl-midimap">
        {doc?.mappings.map((m) => (
          <div key={m.id} className="ctl-tr">
            <input type="checkbox" checked={m.enabled} onChange={(e) => void api.invoke('midi.saveMapping', { mapping: { ...m, enabled: e.target.checked } })} />
            <span className="ctl-mono" style={{ width: 170 }}>{describeMatch(m.match)}</span>
            <span className="grow">{m.name} <span className="dim">→ <ActionSummary action={m.action} /></span></span>
            <Button size="sm" variant="ghost" title="Pretend this arrived" onClick={() => void api.invoke('midi.simulate', { message: { kind: m.match.kind, channel: m.match.channel ?? 1, number: m.match.number ?? 0, value: m.match.value ?? 1 } })}>Test</Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(m)}>Edit</Button>
          </div>
        ))}
      </div>
      <div className="ctl-sub">Monitor</div>
      <MidiLog entries={log} />
      <div className="ctl-sub">Send a test note</div>
      <div className="row">
        <Button onClick={() => void api.invoke('midi.send', { kind: 'noteon', channel: 1, number: 60, value: 127, duration: 200 })}>Send Note 60 (C3)</Button>
        <span className="dim ctl-mono">{toHex([0x90, 60, 127])}</span>
      </div>
      {edit && <MappingEditor mapping={edit} onClose={() => setEdit(null)} />}
    </div>
  )
}
