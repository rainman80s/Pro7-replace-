/**
 * Loads `@julusian/midi` (RtMidi: CoreMIDI on macOS, WinMM on Windows, ALSA on Linux) lazily.
 * It is an optional dependency: if it is missing or the OS has no MIDI system, we return a reason
 * and the rest of the app keeps working.
 */
import { createRequire } from 'node:module'
import type { MidiBackend, MidiOutPort } from './engine'

interface JInput {
  on(ev: 'message', cb: (delta: number, msg: number[]) => void): void
  getPortCount(): number
  getPortName(i: number): string
  openPort(i: number): void
  openVirtualPort(name: string): void
  ignoreTypes(sysex: boolean, timing: boolean, sensing: boolean): void
  closePort(): void
  destroy?(): void
}
interface JOutput {
  getPortCount(): number
  getPortName(i: number): string
  openPort(i: number): void
  openVirtualPort(name: string): void
  sendMessage(msg: number[]): void
  closePort(): void
  destroy?(): void
}
interface JMidi { Input: new () => JInput; Output: new () => JOutput }

export function loadMidiBackend(): { backend: MidiBackend | null; reason?: string } {
  if (process.env.REACH_NO_MIDI) return { backend: null, reason: 'MIDI is turned off (REACH_NO_MIDI).' }
  let mod: JMidi
  try {
    const req = createRequire(__filename)
    mod = req('@julusian/midi') as JMidi
  } catch (e) {
    return { backend: null, reason: `The MIDI module isn't installed on this computer (${(e as Error).message.split('\n')[0]}).` }
  }
  let scanIn: JInput, scanOut: JOutput
  try {
    scanIn = new mod.Input()
    scanOut = new mod.Output()
  } catch {
    return { backend: null, reason: 'This computer has no MIDI system available (no CoreMIDI/WinMM/ALSA).' }
  }
  const names = (p: { getPortCount(): number; getPortName(i: number): string }): string[] => {
    const out: string[] = []
    for (let i = 0; i < p.getPortCount(); i++) out.push(p.getPortName(i))
    return out
  }
  const outPort = (o: JOutput): MidiOutPort => ({ send: (b) => o.sendMessage(b), close: () => { o.closePort(); o.destroy?.() } })
  const backend: MidiBackend = {
    supportsVirtual: process.platform !== 'win32',
    inputs: () => names(scanIn),
    outputs: () => names(scanOut),
    openInput(name, onMessage) {
      const i = names(scanIn).indexOf(name)
      if (i < 0) throw new Error(`No MIDI input called ${name}`)
      const inp = new mod.Input()
      inp.ignoreTypes(false, true, true)
      inp.on('message', (_d, msg) => onMessage(msg))
      inp.openPort(i)
      return () => { inp.closePort(); inp.destroy?.() }
    },
    openOutput(name) {
      const i = names(scanOut).indexOf(name)
      if (i < 0) throw new Error(`No MIDI output called ${name}`)
      const o = new mod.Output()
      o.openPort(i)
      return outPort(o)
    },
    openVirtual(name, onMessage) {
      if (process.platform === 'win32') return null
      const inp = new mod.Input()
      inp.ignoreTypes(false, true, true)
      inp.on('message', (_d, msg) => onMessage(msg))
      inp.openVirtualPort(name)
      const o = new mod.Output()
      o.openVirtualPort(name)
      return { output: outPort(o), close: () => { inp.closePort(); inp.destroy?.(); o.closePort(); o.destroy?.() } }
    }
  }
  return { backend }
}
