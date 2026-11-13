/**
 * Minimal OSC 1.0 decoder (UDP messages and bundles; int32, float32, string, blob, true/false) and the
 * address map. Pure — unit-tested. See docs/control/api.md#osc.
 */
export interface OscMessage { address: string; args: (number | string | boolean | null)[] }

const pad4 = (n: number): number => (n + 3) & ~3

function readString(b: Uint8Array, off: number): [string, number] {
  let end = off
  while (end < b.length && b[end] !== 0) end++
  return [new TextDecoder().decode(b.subarray(off, end)), pad4(end + 1)]
}

export function decodeOsc(buf: Uint8Array): OscMessage[] {
  const [address, o1] = readString(buf, 0)
  if (address === '#bundle') {
    const out: OscMessage[] = []
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    let off = o1 + 8
    while (off + 4 <= buf.length) {
      const size = dv.getInt32(off)
      out.push(...decodeOsc(buf.subarray(off + 4, off + 4 + size)))
      off += 4 + size
    }
    return out
  }
  if (!address.startsWith('/')) return []
  const args: OscMessage['args'] = []
  if (o1 >= buf.length) return [{ address, args }]
  const [tags, o2] = readString(buf, o1)
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let off = o2
  for (const t of tags.replace(/^,/, '')) {
    if (t === 'i') { args.push(dv.getInt32(off)); off += 4 }
    else if (t === 'f') { args.push(Math.round(dv.getFloat32(off) * 1e6) / 1e6); off += 4 }
    else if (t === 's') { const [s, n] = readString(buf, off); args.push(s); off = n }
    else if (t === 'b') { const n = dv.getInt32(off); off = pad4(off + 4 + n); args.push(null) }
    else if (t === 'T') args.push(true)
    else if (t === 'F') args.push(false)
    else if (t === 'N') args.push(null)
    else break
  }
  return [{ address, args }]
}

/** Build an OSC message (used by tests and handy for "send OSC" later). */
export function encodeOsc(address: string, args: (number | string)[] = []): Uint8Array {
  const parts: number[] = []
  const str = (s: string): void => { const b = new TextEncoder().encode(s); parts.push(...b, 0); while (parts.length % 4) parts.push(0) }
  str(address)
  str(',' + args.map((a) => (typeof a === 'string' ? 's' : Number.isInteger(a) ? 'i' : 'f')).join(''))
  for (const a of args) {
    if (typeof a === 'string') str(a)
    else {
      const dv = new DataView(new ArrayBuffer(4))
      if (Number.isInteger(a)) dv.setInt32(0, a)
      else dv.setFloat32(0, a)
      parts.push(...new Uint8Array(dv.buffer))
    }
  }
  return new Uint8Array(parts)
}

/** OSC address → action. Returns null for unknown addresses. */
export function oscToAction(m: OscMessage): { type: string; params: Record<string, unknown> } | { macro: string } | null {
  const seg = m.address.split('/').filter(Boolean)
  if (seg[0] !== 'reach') return null
  const a0 = m.args[0]
  const [, cmd, arg] = seg
  switch (cmd) {
    case 'next': return { type: 'live.next', params: {} }
    case 'prev': case 'previous': return { type: 'live.prev', params: {} }
    case 'clear': return { type: 'live.clear', params: { layer: arg ?? (typeof a0 === 'string' ? a0 : 'all') } }
    case 'slide': return { type: 'live.slideIndex', params: { index: Number(arg ?? a0 ?? 1) } }
    case 'item': return { type: 'playlist.item', params: arg === 'next' ? { step: 1 } : arg === 'prev' ? { step: -1 } : { index: Number(arg ?? a0 ?? 1) } }
    case 'section': return { type: 'live.group', params: { name: decodeURIComponent(arg ?? String(a0 ?? '')) } }
    case 'macro': return { macro: decodeURIComponent(arg ?? String(a0 ?? '')) }
    case 'blackout': return { type: 'live.toggleFlag', params: { flag: 'blackout' } }
    case 'timer': {
      const op = seg[3] ?? (typeof a0 === 'string' ? 'start' : 'start')
      return { type: `timer.${['start', 'stop', 'reset', 'restart'].includes(op) ? op : 'start'}`, params: { id: decodeURIComponent(arg ?? String(a0 ?? '')) } }
    }
    case 'prop': return { type: 'prop.toggle', params: { id: decodeURIComponent(arg ?? String(a0 ?? '')) } }
    case 'stage': return { type: 'stage.message', params: { text: String(a0 ?? '') } }
    case 'action': {
      let params: Record<string, unknown> = {}
      if (typeof a0 === 'string') { try { params = JSON.parse(a0) } catch { /* ignore */ } }
      return arg ? { type: arg, params } : null
    }
    default: return null
  }
}
