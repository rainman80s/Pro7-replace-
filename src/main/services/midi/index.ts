/**
 * MIDI service: devices are per computer (local settings), the note map is shared (workspace doc `midi`).
 * See docs/control/midi.md.
 */
import {
  PRO_PRESET_ID, applyPreset, defaultMidiDevices, proPresenterPreset,
  type MidiDeviceSettings, type MidiDoc, type MidiMapping, type MidiSendParams
} from '@shared/control-midi'
import { uid } from '@shared/control'
import { defineService } from '../../core/service'
import { api } from '../../core/api'
import { live } from '../../core/live'
import { local } from '../../core/local'
import { DocStore, P, announceRun, defineAction } from '../macros/lib'
import { runMacro } from '../macros'
import { loadMidiBackend } from './backend'
import { MidiEngine } from './engine'

export const midiDoc = new DocStore<MidiDoc>('midi', () => ({ enabled: true, mappings: proPresenterPreset() }), (d) => ({ enabled: true, ...d, mappings: d.mappings ?? [] }))

let engine: MidiEngine | null = null
let poll: NodeJS.Timeout | null = null

const runMapped = async (type: string, params: Record<string, unknown>, label: string): Promise<void> => {
  announceRun('MIDI', label)
  if (type === 'macro.run') return runMacro(params, 'MIDI')
  await live.runAction({ id: 'midi', type, params, label })
}

export default defineService({
  name: 'midi',
  order: 60,
  async setup() {
    await midiDoc.get()
    const { backend, reason } = loadMidiBackend()
    const settings = { ...defaultMidiDevices(), ...local.get<Partial<MidiDeviceSettings>>('midi.devices', {}) }
    engine = new MidiEngine(backend, {
      mappings: () => midiDoc.current,
      run: runMapped,
      emit: (event: string, payload: unknown) => api.emit(event as 'midi.message', payload as never)
    }, settings, reason)
    engine.refresh()
    if (backend) poll = setInterval(() => engine?.refresh(), 2000)
    else console.log('[midi]', reason)
    const e = engine

    api.handle('midi.ports', () => e.refresh(), 'control')
    api.handle('midi.devices', (patch) => {
      if (patch && Object.keys(patch).length) {
        const s = e.configure(patch)
        local.set('midi.devices', s)
      }
      return e.settings
    }, 'control')
    api.handle('midi.mappings', () => midiDoc.get(), 'control')
    api.handle('midi.saveMapping', async ({ mapping }) => {
      const m: MidiMapping = { name: 'MIDI command', enabled: true, ...mapping, id: mapping.id || uid('midi') }
      await midiDoc.update((d) => {
        const i = d.mappings.findIndex((x) => x.id === m.id)
        if (i >= 0) d.mappings[i] = m
        else d.mappings.push(m)
      })
      return m
    })
    api.handle('midi.removeMapping', async ({ id }) => { await midiDoc.update((d) => { d.mappings = d.mappings.filter((m) => m.id !== id) }) })
    api.handle('midi.setEnabled', ({ enabled }) => midiDoc.update((d) => { d.enabled = enabled }))
    api.handle('midi.applyPreset', ({ offset, remove }) =>
      midiDoc.update((d) => (remove ? { ...d, mappings: d.mappings.filter((m) => m.preset !== PRO_PRESET_ID) } : applyPreset(d, proPresenterPreset(offset ?? 0)))))
    api.handle('midi.learn', (req) => e.learn(req?.timeoutMs ?? 15000), 'control')
    api.handle('midi.cancelLearn', () => e.cancelLearn(), 'control')
    api.handle('midi.send', (p) => { e.send(p) })
    api.handle('midi.log', () => e.history(), 'control')
    api.handle('midi.simulate', ({ message, bytes, port }) => e.receive(port ?? 'Test', message ?? bytes ?? []))

    defineAction({
      type: 'midi.send', label: 'Send MIDI', category: 'MIDI', description: 'Send a MIDI note, CC or program change (e.g. to Ableton, a lighting desk or a mixer).',
      params: [
        P.select('kind', 'Message', [
          { value: 'noteon', label: 'Note On' }, { value: 'noteoff', label: 'Note Off' }, { value: 'cc', label: 'Control Change (CC)' },
          { value: 'pc', label: 'Program Change' }, { value: 'sysex', label: 'SysEx' }, { value: 'raw', label: 'Raw bytes' }
        ], { default: 'noteon' }),
        P.num('channel', 'Channel', { default: 1, min: 1, max: 16, when: { key: 'kind', in: ['noteon', 'noteoff', 'cc', 'pc'] } }),
        P.num('number', 'Note / CC / program number', { default: 60, min: 0, max: 127, when: { key: 'kind', in: ['noteon', 'noteoff', 'cc', 'pc'] } }),
        P.num('value', 'Velocity / value', { default: 127, min: 0, max: 127, when: { key: 'kind', in: ['noteon', 'noteoff', 'cc'] } }),
        P.text('bytes', 'Bytes (hex)', { hint: 'F0 7E 7F 06 01 F7', when: { key: 'kind', in: ['sysex', 'raw'] } }),
        P.num('duration', 'Send Note Off after (ms)', { optional: true, when: { key: 'kind', in: ['noteon'] } }),
        P.text('output', 'Output (empty = all chosen outputs)', { optional: true })
      ]
    }, (p) => { e.send(p as MidiSendParams) })
  },
  dispose() {
    if (poll) clearInterval(poll)
    engine?.close()
  }
})
