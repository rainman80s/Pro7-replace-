/**
 * MIDI engine — device bookkeeping, hot-plug, learn, input mapping and output.
 * No Electron / native imports: the backend is injected, so tests use a fake one.
 */
import {
  decodeMidi, describeMidi, encodeMidi, messageFromParams, resolveMidi,
  type MidiDeviceSettings, type MidiDoc, type MidiLogEntry, type MidiMessage, type MidiPorts, type MidiSendParams
} from '@shared/control-midi'

export const VIRTUAL_NAME = 'Reach Presenter'

export interface MidiOutPort { send(bytes: number[]): void; close(): void }

/** What a MIDI library has to provide. */
export interface MidiBackend {
  inputs(): string[]
  outputs(): string[]
  openInput(name: string, onMessage: (bytes: number[]) => void): () => void
  openOutput(name: string): MidiOutPort
  /** Virtual ports other apps (Ableton, Playback) can connect to. Null when unsupported (Windows). */
  openVirtual?(name: string, onMessage: (bytes: number[]) => void): { output: MidiOutPort; close(): void } | null
  supportsVirtual: boolean
}

export interface EngineDeps {
  mappings(): MidiDoc
  run(type: string, params: Record<string, unknown>, label: string): Promise<void> | void
  emit(event: 'midi.message', e: MidiLogEntry): void
  emit(event: 'midi.portsChanged', e: MidiPorts): void
  now?(): number
}

export class MidiEngine {
  private ins = new Map<string, () => void>()
  private outs = new Map<string, MidiOutPort>()
  private virtual: { output: MidiOutPort; close(): void } | null = null
  private log: MidiLogEntry[] = []
  private seq = 1
  private learners: ((r: { message: MidiMessage; port: string } | null) => void)[] = []
  private lastPorts = ''

  constructor(public backend: MidiBackend | null, private deps: EngineDeps, public settings: MidiDeviceSettings, private reason = 'MIDI is not available on this computer') {}

  get available(): boolean { return !!this.backend }

  ports(): MidiPorts {
    const b = this.backend
    if (!b) return { available: false, reason: this.reason, inputs: [], outputs: [], virtual: { supported: false, open: false, name: VIRTUAL_NAME } }
    const safe = (f: () => string[]): string[] => { try { return f().filter((n) => n !== VIRTUAL_NAME) } catch { return [] } }
    return {
      available: true,
      inputs: safe(() => b.inputs()).map((name) => ({ name, open: this.ins.has(name) })),
      outputs: safe(() => b.outputs()).map((name) => ({ name, open: this.outs.has(name) })),
      virtual: { supported: b.supportsVirtual, open: !!this.virtual, name: VIRTUAL_NAME }
    }
  }

  /** Open/close ports to match settings + what is plugged in. Call on start, on settings change and every few seconds (hot-plug). */
  refresh(): MidiPorts {
    const b = this.backend
    const p = this.ports()
    if (b) {
      const wantIn = new Set(p.inputs.map((i) => i.name).filter((n) => this.settings.allInputs || this.settings.inputs.includes(n)))
      for (const [name, close] of this.ins) if (!wantIn.has(name)) { try { close() } catch { /* unplugged */ } this.ins.delete(name) }
      for (const name of wantIn) {
        if (this.ins.has(name)) continue
        try { this.ins.set(name, b.openInput(name, (bytes) => this.receive(name, bytes))) } catch (e) { console.warn('[midi] cannot open input', name, e) }
      }
      const wantOut = new Set(p.outputs.map((o) => o.name).filter((n) => this.settings.outputs.includes(n)))
      for (const [name, port] of this.outs) if (!wantOut.has(name)) { try { port.close() } catch { /* gone */ } this.outs.delete(name) }
      for (const name of wantOut) {
        if (this.outs.has(name)) continue
        try { this.outs.set(name, b.openOutput(name)) } catch (e) { console.warn('[midi] cannot open output', name, e) }
      }
      if (this.settings.virtualPort && b.supportsVirtual && !this.virtual && b.openVirtual) {
        try { this.virtual = b.openVirtual(VIRTUAL_NAME, (bytes) => this.receive(VIRTUAL_NAME, bytes)) } catch (e) { console.warn('[midi] virtual port failed', e) }
      } else if (!this.settings.virtualPort && this.virtual) { this.virtual.close(); this.virtual = null }
    }
    const now = this.ports()
    const key = JSON.stringify(now)
    if (key !== this.lastPorts) { this.lastPorts = key; this.deps.emit('midi.portsChanged', now) }
    return now
  }

  configure(s: Partial<MidiDeviceSettings>): MidiDeviceSettings {
    this.settings = { ...this.settings, ...s }
    this.refresh()
    return this.settings
  }

  private record(e: Omit<MidiLogEntry, 'id' | 'at'>): MidiLogEntry {
    const entry: MidiLogEntry = { ...e, id: this.seq++, at: this.deps.now?.() ?? Date.now() }
    this.log.push(entry)
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200)
    this.deps.emit('midi.message', entry)
    return entry
  }

  history(): MidiLogEntry[] { return [...this.log] }

  /** A message arrived (from hardware, the virtual port, or `simulate`). Returns the names of the mappings fired. */
  async receive(port: string, bytes: number[] | MidiMessage): Promise<string[]> {
    const m = Array.isArray(bytes) ? decodeMidi(bytes) : bytes
    const raw = Array.isArray(bytes) ? bytes : encodeMidi(m)
    // Clock / active sensing would flood the monitor.
    if (m.kind === 'clock' || (m.kind === 'other' && raw[0] === 0xfe)) return []
    if ((m.kind === 'noteon' || m.kind === 'cc' || m.kind === 'pc') && this.learners.length) {
      const ls = this.learners.splice(0)
      ls.forEach((l) => l({ message: m, port }))
      this.record({ dir: 'in', port, bytes: raw, text: describeMidi(m), fired: ['(learned)'] })
      return []
    }
    const doc = this.deps.mappings()
    const hits = doc.enabled === false ? [] : resolveMidi(doc.mappings, m, port)
    this.record({ dir: 'in', port, bytes: raw, text: describeMidi(m), fired: hits.map((h) => h.mapping.name) })
    for (const h of hits) {
      try { await this.deps.run(h.type, h.params, h.mapping.name) } catch (e) { console.warn('[midi] action failed', h.mapping.name, e) }
    }
    return hits.map((h) => h.mapping.name)
  }

  learn(timeoutMs = 15000): Promise<{ message: MidiMessage; port: string } | null> {
    return new Promise((resolve) => {
      const done = (r: { message: MidiMessage; port: string } | null): void => { clearTimeout(t); resolve(r) }
      const t = setTimeout(() => { this.learners = this.learners.filter((l) => l !== done); resolve(null) }, timeoutMs)
      this.learners.push(done)
    })
  }

  cancelLearn(): void { this.learners.splice(0).forEach((l) => l(null)) }

  /** Send to the named output, or every chosen output + the virtual port. Returns how many ports it went to. */
  send(p: MidiSendParams, sleep: (ms: number, fn: () => void) => void = (ms, fn) => void setTimeout(fn, ms)): number {
    const m = messageFromParams(p)
    const bytes = encodeMidi(m)
    const targets: [string, MidiOutPort][] = []
    if (p.output) {
      const o = p.output === VIRTUAL_NAME ? this.virtual?.output : this.outs.get(p.output) ?? this.openOnDemand(p.output)
      if (o) targets.push([p.output, o])
    } else {
      targets.push(...this.outs.entries())
      if (this.virtual) targets.push([VIRTUAL_NAME, this.virtual.output])
    }
    for (const [name, o] of targets) {
      o.send(bytes)
      this.record({ dir: 'out', port: name, bytes, text: describeMidi(m) })
    }
    if (m.kind === 'noteon' && p.duration && p.duration > 0) {
      sleep(p.duration, () => { this.send({ ...p, kind: 'noteoff', value: 0, duration: 0 }) })
    }
    if (!targets.length) this.record({ dir: 'out', port: '(nowhere)', bytes, text: `${describeMidi(m)} — no MIDI output chosen` })
    return targets.length
  }

  private openOnDemand(name: string): MidiOutPort | undefined {
    if (!this.backend) return undefined
    try {
      const o = this.backend.openOutput(name)
      this.outs.set(name, o)
      return o
    } catch { return undefined }
  }

  close(): void {
    for (const c of this.ins.values()) try { c() } catch { /* ignore */ }
    for (const o of this.outs.values()) try { o.close() } catch { /* ignore */ }
    this.virtual?.close()
    this.ins.clear(); this.outs.clear(); this.virtual = null
  }
}
