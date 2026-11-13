/**
 * ProPresenter 7 protobuf access. The schema is compiled ahead of time by scripts/build-pp7-descriptor.mjs
 * into descriptor.json (bundled), so no .proto files are needed at runtime.
 */
import protobuf from 'protobufjs'
import bundle from './descriptor.json'

/* eslint-disable @typescript-eslint/no-explicit-any */
export type PB = any

let root: protobuf.Root | null = null
export function pp7Root(): protobuf.Root {
  if (!root) root = protobuf.Root.fromJSON((bundle as any).descriptor)
  return root
}
export const PP7_PROTO_VERSION: string = (bundle as any).version

const TO_OBJECT = { longs: Number, enums: String, bytes: Buffer, defaults: false, arrays: false, objects: false, oneofs: false } as const

export function pp7Type(name: string): protobuf.Type {
  return pp7Root().lookupType(name)
}

/** Decode `bytes` as message `typeName` → plain object (snake_case keys as in the .proto, enums as names, bytes as Buffer). */
export function decodePP7(typeName: string, bytes: Uint8Array): PB {
  const T = pp7Type(typeName)
  return T.toObject(T.decode(bytes), TO_OBJECT as any)
}

export function encodePP7(typeName: string, obj: PB): Uint8Array {
  const T = pp7Type(typeName)
  return T.encode(T.fromObject(obj)).finish()
}

/**
 * Walk the raw wire format alongside the schema and count fields the schema doesn't know
 * (i.e. things a newer ProPresenter wrote that our vendored protos predate). Never throws.
 * Returns e.g. { "rv.data.Presentation#31": 1, "rv.data.Graphics.Text#14": 12 }.
 */
export function unknownFieldCensus(typeName: string, bytes: Uint8Array, out: Record<string, number> = {}, budget = { n: 400000 }): Record<string, number> {
  let T: protobuf.Type
  try { T = pp7Type(typeName) } catch { return out }
  walk(T, bytes, 0, bytes.length, out, budget, 0)
  return out
}

function walk(T: protobuf.Type, b: Uint8Array, start: number, end: number, out: Record<string, number>, budget: { n: number }, depth: number): boolean {
  let p = start
  const varint = (): number => {
    let r = 0
    let shift = 0
    for (;;) {
      if (p >= end) throw new Error('eof')
      const x = b[p++]
      if (shift < 28) r |= (x & 0x7f) << shift
      else r += (x & 0x7f) * 2 ** shift
      if (!(x & 0x80)) break
      shift += 7
      if (shift > 63) throw new Error('varint')
    }
    return r >>> 0 === r ? r : r
  }
  try {
    while (p < end) {
      if (budget.n-- <= 0) return true
      const tag = varint()
      const no = Math.floor(tag / 8)
      const wt = tag & 7
      if (no === 0) return false
      const field = T.fieldsById[no]
      if (!field) out[`${T.fullName.replace(/^\./, '')}#${no}`] = (out[`${T.fullName.replace(/^\./, '')}#${no}`] ?? 0) + 1
      if (wt === 0) varint()
      else if (wt === 1) p += 8
      else if (wt === 5) p += 4
      else if (wt === 2) {
        const len = varint()
        if (len < 0 || p + len > end) return false
        if (field && depth < 64) {
          const rt = field.resolvedType
          if (rt instanceof protobuf.Type && !field.map) walk(rt, b, p, p + len, out, budget, depth + 1)
        }
        p += len
      } else if (wt === 3 || wt === 4) {
        return false // groups are not used by proto3
      } else return false
    }
    return p === end
  } catch {
    return false
  }
}

/**
 * Structural plausibility check: does `bytes` parse cleanly as wire format with no unknown top-level noise?
 * Used to tell a ProPresenter `.pro` from a ChordPro text file with the same extension, and to probe unknown files.
 */
export function looksLikeMessage(typeName: string, bytes: Uint8Array): boolean {
  if (!bytes.length) return false
  let T: protobuf.Type
  try { T = pp7Type(typeName) } catch { return false }
  const census: Record<string, number> = {}
  const ok = walk(T, bytes, 0, bytes.length, census, { n: 200000 }, 0)
  if (!ok) return false
  const unknownTop = Object.keys(census).filter((k) => k.startsWith(T.fullName.replace(/^\./, '') + '#')).length
  return unknownTop <= 3
}

/* ───────────────────────────── small shared helpers ───────────────────────────── */

export const uuidOf = (u: PB): string => (u && typeof u.string === 'string' ? u.string : '')
/** Stable, filesystem-safe id derived from a ProPresenter UUID (so re-imports keep ids). */
export const idFromUuid = (u: PB | string, fallback: () => string): string => {
  const s = (typeof u === 'string' ? u : uuidOf(u)).toLowerCase().replace(/[^0-9a-f]/g, '')
  return s.length >= 16 && !/^0+$/.test(s) ? s : fallback()
}

export interface RGBA { red?: number; green?: number; blue?: number; alpha?: number }
/** rv.data.Color (floats 0..1) → CSS. Returns undefined for fully transparent / missing colours unless keepTransparent. */
export function cssColor(c: RGBA | undefined | null, opts: { keepTransparent?: boolean; opacity?: number } = {}): string | undefined {
  if (!c) return undefined
  const a = Math.max(0, Math.min(1, (c.alpha ?? 0) * (opts.opacity ?? 1)))
  if (a <= 0 && !opts.keepTransparent) return undefined
  const ch = (v: number | undefined): number => Math.max(0, Math.min(255, Math.round((v ?? 0) * 255)))
  const [r, g, b] = [ch(c.red), ch(c.green), ch(c.blue)]
  if (a >= 0.999) return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`
}

/** Stricter than looksLikeMessage: decodes and requires presentation-ish content (uuid / name / cues). */
export function isPresentationBytes(bytes: Uint8Array): boolean {
  if (!looksLikeMessage('rv.data.Presentation', bytes)) return false
  try {
    const p = pp7Type('rv.data.Presentation').decode(bytes) as unknown as { uuid?: { string?: string }; name?: string; cues?: unknown[]; application_info?: unknown }
    return !!(p.uuid?.string && /^[0-9a-f-]{32,36}$/i.test(p.uuid.string)) || !!(p.application_info && (p.name || p.cues?.length))
  } catch { return false }
}
