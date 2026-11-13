import { describe, expect, it } from 'vitest'
import {
  PROPRESENTER_NOTE_MAP, applyPreset, decodeMidi, encodeMidi, matchFromMessage, noteName, parseBytes, proPresenterPreset, resolveMidi,
  type MidiDoc, type MidiLogEntry
} from '../src/shared/control-midi'
import { MidiEngine, VIRTUAL_NAME, type MidiBackend } from '../src/main/services/midi/engine'

describe('MIDI codec', () => {
  it('round-trips channel messages', () => {
    for (const m of [
      { kind: 'noteon' as const, channel: 1, number: 60, value: 100 },
      { kind: 'noteoff' as const, channel: 16, number: 0, value: 0 },
      { kind: 'cc' as const, channel: 3, number: 7, value: 127 },
      { kind: 'pc' as const, channel: 10, number: 5 },
      { kind: 'pitchbend' as const, channel: 2, value: 12000 }
    ]) expect(decodeMidi(encodeMidi(m))).toEqual(m)
  })
  it('treats Note On velocity 0 as Note Off', () => {
    expect(decodeMidi([0x90, 12, 0]).kind).toBe('noteoff')
  })
  it('clamps and encodes', () => {
    expect(encodeMidi({ kind: 'noteon', channel: 2, number: 200, value: -4 })).toEqual([0x91, 127, 0])
    expect(encodeMidi({ kind: 'sysex', bytes: [0x7e, 0x7f, 0x06, 0x01] })).toEqual([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7])
    expect(parseBytes('F0 7E 7F 06 01 F7')).toEqual([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7])
    expect(parseBytes('144, 60, 127')).toEqual([144, 60, 127])
  })
  it('names notes with middle C = C3 like ProPresenter', () => {
    expect(noteName(0)).toBe('C-2')
    expect(noteName(60)).toBe('C3')
    expect(noteName(30)).toBe('F#0')
  })
})

describe('ProPresenter-compatible map', () => {
  it('matches the official MIDI Map (auto-fill from 0)', () => {
    const n = (name: string): number | undefined => PROPRESENTER_NOTE_MAP.find((r) => r.name.startsWith(name))?.note
    expect(n('Clear All')).toBe(0)
    expect(n('Next Slide')).toBe(12)
    expect(n('Previous Slide')).toBe(13)
    expect(n('Select Playlist (')).toBe(17)
    expect(n('Trigger Slide')).toBe(19)
    expect(n('Toggle Prop')).toBe(24)
    expect(n('Trigger Macro')).toBe(29)
    expect(n('Clear Announcements')).toBe(30)
  })
  it('note + velocity selects by index', () => {
    const rows = proPresenterPreset()
    const hits = resolveMidi(rows, decodeMidi([0x95, 19, 6]))
    expect(hits).toHaveLength(1)
    expect(hits[0].type).toBe('live.slideIndex')
    expect(hits[0].params.index).toBe(6)
    expect(resolveMidi(rows, decodeMidi([0x90, 12, 1]))[0].type).toBe('live.next')
    expect(resolveMidi(rows, decodeMidi([0x80, 12, 64]))).toHaveLength(0)
  })
  it('offset shifts the whole map and re-applying replaces only preset rows', () => {
    const mine = { id: 'm', name: 'Mine', enabled: true, match: { kind: 'cc' as const, number: 1 }, action: { type: 'live.next' } }
    let doc: MidiDoc = { mappings: [mine, ...proPresenterPreset()] }
    doc = applyPreset(doc, proPresenterPreset(1))
    expect(doc.mappings.filter((m) => m.id === 'm')).toHaveLength(1)
    expect(resolveMidi(doc.mappings, decodeMidi([0x90, 13, 1]))[0].type).toBe('live.next')
    expect(doc.mappings.length).toBe(1 + proPresenterPreset().length)
  })
  it('learn builds a match from a message', () => {
    expect(matchFromMessage(decodeMidi([0xb2, 20, 99]))).toEqual({ kind: 'cc', channel: 3, number: 20 })
  })
})

function fakeBackend(): MidiBackend & { sent: Record<string, number[][]>; plug(name: string): void; push(name: string, b: number[]): void } {
  const inputs = ['Launchpad']
  const outputs = ['IAC Bus 1']
  const listeners = new Map<string, (b: number[]) => void>()
  const sent: Record<string, number[][]> = {}
  return {
    sent,
    supportsVirtual: true,
    inputs: () => [...inputs],
    outputs: () => [...outputs],
    openInput(name, cb) { listeners.set(name, cb); return () => listeners.delete(name) },
    openOutput(name) { sent[name] = []; return { send: (b) => sent[name].push(b), close() {} } },
    openVirtual(name, cb) { listeners.set(name, cb); sent[name] = []; return { output: { send: (b) => sent[name].push(b), close() {} }, close() {} } },
    plug(name) { inputs.push(name) },
    push(name, b) { listeners.get(name)?.(b) }
  }
}

describe('MIDI engine with a fake backend', () => {
  const setup = () => {
    const be = fakeBackend()
    const ran: [string, Record<string, unknown>][] = []
    const events: string[] = []
    const log: MidiLogEntry[] = []
    const doc: MidiDoc = { enabled: true, mappings: proPresenterPreset() }
    const eng = new MidiEngine(be, {
      mappings: () => doc,
      run: (t, p) => void ran.push([t, p]),
      emit: (ev: string, e: unknown) => { events.push(ev); if (ev === 'midi.message') log.push(e as MidiLogEntry) }
    }, { allInputs: true, inputs: [], outputs: ['IAC Bus 1'], virtualPort: true })
    eng.refresh()
    return { be, eng, ran, events, log, doc }
  }
  it('opens inputs, outputs and the virtual port; hot-plugs', () => {
    const { be, eng, events } = setup()
    const p = eng.ports()
    expect(p.inputs).toEqual([{ name: 'Launchpad', open: true }])
    expect(p.outputs).toEqual([{ name: 'IAC Bus 1', open: true }])
    expect(p.virtual.open).toBe(true)
    be.plug('Network Session 1')
    eng.refresh()
    expect(eng.ports().inputs.find((i) => i.name === 'Network Session 1')?.open).toBe(true)
    expect(events.filter((e) => e === 'midi.portsChanged').length).toBe(2)
  })
  it('maps incoming notes to actions and logs them', async () => {
    const { be, ran, log } = setup()
    be.push('Launchpad', [0x90, 12, 100])
    be.push(VIRTUAL_NAME, [0x90, 25, 2])
    await new Promise((r) => setTimeout(r, 0))
    expect(ran).toEqual([['live.next', {}], ['timer.start', { index: 2 }]])
    expect(log[0].fired).toEqual(['Next Slide'])
  })
  it('respects the master switch', async () => {
    const { eng, ran, doc } = setup()
    doc.enabled = false
    await eng.receive('Launchpad', [0x90, 12, 100])
    expect(ran).toEqual([])
  })
  it('learns the next message instead of firing it', async () => {
    const { eng, ran } = setup()
    const p = eng.learn(1000)
    await eng.receive('Launchpad', [0xb0, 64, 127])
    expect((await p)?.message).toEqual({ kind: 'cc', channel: 1, number: 64, value: 127 })
    expect(ran).toEqual([])
  })
  it('sends to chosen outputs + virtual port, with an automatic Note Off', () => {
    const { be, eng } = setup()
    let later: (() => void) | null = null
    const n = eng.send({ kind: 'noteon', channel: 2, number: 60, value: 90, duration: 100 }, (_ms, fn) => { later = fn })
    expect(n).toBe(2)
    expect(be.sent['IAC Bus 1']).toEqual([[0x91, 60, 90]])
    later!()
    expect(be.sent['IAC Bus 1'][1]).toEqual([0x81, 60, 0])
  })
  it('degrades gracefully with no backend', () => {
    const eng = new MidiEngine(null, { mappings: () => ({ mappings: [] }), run: () => {}, emit: () => {} }, { allInputs: true, inputs: [], outputs: [], virtualPort: true }, 'no MIDI here')
    expect(eng.refresh()).toMatchObject({ available: false, reason: 'no MIDI here' })
    expect(eng.send({ kind: 'cc', number: 1, value: 2 })).toBe(0)
  })
})
