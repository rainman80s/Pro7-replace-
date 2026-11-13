/**
 * Tolerant ZIP reader for ProPresenter bundles/playlists.
 *
 * ProPresenter writes ZIP64 archives whose ZIP64 end-of-central-directory record is off by 98 bytes from where the
 * locator says (and whose central-directory size is 98 bytes too large). Strict readers (including fflate's unzipSync)
 * reject these. Strategy, in order:
 *   1. classic EOCD → central directory (with ZIP64 fields when present, located by SCANNING for the ZIP64 EOCD
 *      signature rather than trusting the locator's offset);
 *   2. if the central directory can't be read, walk local file headers from the start of the file.
 * Entry names are untrusted: use `safeEntryPath()` before touching the filesystem.
 */
import { inflateSync, zipSync, type Zippable } from 'fflate'

export interface ZipEntry {
  name: string
  size: number
  compressedSize: number
  method: number
  /** Decompress on demand. Throws on unsupported methods / corrupt data. */
  read(): Uint8Array
}

export interface ZipReadResult {
  entries: ZipEntry[]
  /** Which path succeeded and what had to be repaired. */
  notes: string[]
}

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const SIG_Z64_EOCD = 0x06064b50
const SIG_Z64_LOC = 0x07064b50
const MAX_ENTRY = 2 ** 31 // refuse absurd sizes (zip bombs / corrupt headers)

export function isZip(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6)
}

export function readZip(bytes: Uint8Array, opts: { maxEntries?: number } = {}): ZipReadResult {
  const notes: string[] = []
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const maxEntries = opts.maxEntries ?? 100000
  try {
    const cd = readCentral(bytes, dv, notes, maxEntries)
    if (cd) return { entries: cd, notes }
  } catch (e) {
    notes.push(`central directory unreadable (${(e as Error).message}); scanning local headers`)
  }
  return { entries: scanLocal(bytes, dv, notes, maxEntries), notes }
}

function findBackwards(b: Uint8Array, dv: DataView, sig: number, from: number, limit: number): number {
  for (let i = Math.min(from, b.length - 4); i >= Math.max(0, from - limit); i--) if (dv.getUint32(i, true) === sig) return i
  return -1
}

function readCentral(b: Uint8Array, dv: DataView, notes: string[], maxEntries: number): ZipEntry[] | null {
  const eocd = findBackwards(b, dv, SIG_EOCD, b.length - 22, 65557)
  if (eocd < 0) { notes.push('no end-of-central-directory record'); return null }
  let count = dv.getUint16(eocd + 10, true)
  let cdSize = dv.getUint32(eocd + 12, true)
  let cdOffset = dv.getUint32(eocd + 16, true)
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff || dv.getUint32(Math.max(0, eocd - 20), true) === SIG_Z64_LOC) {
    const loc = eocd - 20
    let z64 = -1
    if (loc >= 0 && dv.getUint32(loc, true) === SIG_Z64_LOC) {
      const claimed = Number(dv.getBigUint64(loc + 8, true))
      if (claimed + 56 <= b.length && dv.getUint32(claimed, true) === SIG_Z64_EOCD) z64 = claimed
      else notes.push(`ZIP64 locator points to ${claimed}, which is not a ZIP64 record (ProPresenter offset bug)`)
    }
    if (z64 < 0) z64 = findBackwards(b, dv, SIG_Z64_EOCD, (loc >= 0 ? loc : eocd) - 56, 1 << 20)
    if (z64 >= 0) {
      const c64 = Number(dv.getBigUint64(z64 + 32, true))
      const s64 = Number(dv.getBigUint64(z64 + 40, true))
      const o64 = Number(dv.getBigUint64(z64 + 48, true))
      if (count === 0xffff) count = c64
      if (cdOffset === 0xffffffff) cdOffset = o64
      if (cdSize === 0xffffffff) cdSize = s64
      // ProPresenter: recorded CD size is 98 bytes too large — trust the record's position instead.
      if (cdOffset + cdSize > z64) { notes.push(`repaired ZIP64 central-directory size (${cdSize} → ${z64 - cdOffset})`); cdSize = z64 - cdOffset }
    } else notes.push('ZIP64 end record not found; using classic values')
  }
  if (cdOffset >= b.length || dv.getUint32(cdOffset, true) !== SIG_CENTRAL) {
    // Some writers get the offset wrong: look for the first central header just before the EOCD.
    let p = cdSize > 0 && cdSize < eocd ? eocd - cdSize : -1
    if (p < 0 || dv.getUint32(p, true) !== SIG_CENTRAL) {
      p = -1
      for (let i = eocd - 46; i >= 0; i--) {
        if (dv.getUint32(i, true) === SIG_CENTRAL) p = i
        else if (p >= 0 && dv.getUint32(i, true) === SIG_LOCAL) break
      }
    }
    if (p < 0) return null
    notes.push(`central directory found at ${p} (header said ${cdOffset})`)
    cdOffset = p
  }
  const out: ZipEntry[] = []
  let p = cdOffset
  for (let n = 0; n < Math.min(count || maxEntries, maxEntries) && p + 46 <= b.length && dv.getUint32(p, true) === SIG_CENTRAL; n++) {
    const flags = dv.getUint16(p + 8, true)
    const method = dv.getUint16(p + 10, true)
    let csize = dv.getUint32(p + 20, true)
    let usize = dv.getUint32(p + 24, true)
    const nlen = dv.getUint16(p + 28, true)
    const xlen = dv.getUint16(p + 30, true)
    const clen = dv.getUint16(p + 32, true)
    let lho = dv.getUint32(p + 42, true)
    const name = decodeName(b.subarray(p + 46, p + 46 + nlen), (flags & 0x800) !== 0)
    // ZIP64 extra field
    let x = p + 46 + nlen
    const xend = x + xlen
    while (x + 4 <= xend) {
      const id = dv.getUint16(x, true)
      const sz = dv.getUint16(x + 2, true)
      if (id === 0x0001) {
        let q = x + 4
        if (usize === 0xffffffff && q + 8 <= x + 4 + sz) { usize = Number(dv.getBigUint64(q, true)); q += 8 }
        if (csize === 0xffffffff && q + 8 <= x + 4 + sz) { csize = Number(dv.getBigUint64(q, true)); q += 8 }
        if (lho === 0xffffffff && q + 8 <= x + 4 + sz) { lho = Number(dv.getBigUint64(q, true)); q += 8 }
      }
      x += 4 + sz
    }
    out.push(entryAt(b, dv, lho, name, method, csize, usize))
    p = xend + clen
  }
  if (!out.length && count > 0) return null
  return out
}

function entryAt(b: Uint8Array, dv: DataView, lho: number, name: string, method: number, csize: number, usize: number): ZipEntry {
  return {
    name, method, size: usize, compressedSize: csize,
    read(): Uint8Array {
      if (lho + 30 > b.length || dv.getUint32(lho, true) !== SIG_LOCAL) throw new Error(`bad local header for ${name}`)
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true)
      if (csize > MAX_ENTRY || usize > MAX_ENTRY) throw new Error(`${name} is too large`)
      const data = b.subarray(start, Math.min(b.length, start + csize))
      if (method === 0) return data
      if (method === 8) {
        const out = usize > 0 ? new Uint8Array(usize) : undefined
        return inflateSync(data, out ? { out } : undefined)
      }
      throw new Error(`unsupported compression method ${method} for ${name}`)
    }
  }
}

function scanLocal(b: Uint8Array, dv: DataView, notes: string[], maxEntries: number): ZipEntry[] {
  const out: ZipEntry[] = []
  let p = 0
  while (p + 30 <= b.length && out.length < maxEntries) {
    if (dv.getUint32(p, true) !== SIG_LOCAL) { p++; continue }
    const flags = dv.getUint16(p + 6, true)
    const method = dv.getUint16(p + 8, true)
    let csize = dv.getUint32(p + 18, true)
    let usize = dv.getUint32(p + 22, true)
    const nlen = dv.getUint16(p + 26, true)
    const xlen = dv.getUint16(p + 28, true)
    const name = decodeName(b.subarray(p + 30, p + 30 + nlen), (flags & 0x800) !== 0)
    let x = p + 30 + nlen
    while (x + 4 <= p + 30 + nlen + xlen) {
      const id = dv.getUint16(x, true)
      const sz = dv.getUint16(x + 2, true)
      if (id === 0x0001 && sz >= 16) { usize = Number(dv.getBigUint64(x + 4, true)); csize = Number(dv.getBigUint64(x + 12, true)) }
      x += 4 + sz
    }
    const dataStart = p + 30 + nlen + xlen
    if (flags & 0x8) {
      // sizes in a data descriptor after the data: find the next header to bound it
      let q = dataStart
      while (q + 4 <= b.length && ![SIG_LOCAL, SIG_CENTRAL].includes(dv.getUint32(q, true))) q++
      let end = q
      if (end - 16 >= dataStart && dv.getUint32(end - 16, true) === 0x08074b50) { csize = dv.getUint32(end - 8, true); usize = dv.getUint32(end - 4, true) }
      else { csize = end - dataStart - 12; usize = 0 }
      end = q
      out.push(entryAt(b, dv, p, name, method, csize, usize))
      p = end
      continue
    }
    out.push(entryAt(b, dv, p, name, method, csize, usize))
    p = dataStart + csize
  }
  notes.push(`read ${out.length} entries from local headers`)
  return out
}

function decodeName(raw: Uint8Array, utf8: boolean): string {
  try { return new TextDecoder('utf-8', { fatal: !utf8 ? true : false }).decode(raw) } catch { /* not UTF-8: CP437 */ }
  let s = ''
  for (const c of raw) s += String.fromCharCode(c)
  return s
}

/**
 * Turn an untrusted archive entry name into a safe relative POSIX path, or null if it must be ignored.
 * Strips drive letters / leading slashes (ProPresenter stores media under their ABSOLUTE original path),
 * rejects "..", NUL, and macOS resource-fork junk.
 */
export function safeEntryPath(name: string): string | null {
  if (!name || name.includes('\0')) return null
  const parts = name.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '').split('/').filter((s) => s && s !== '.')
  if (!parts.length || parts.some((s) => s === '..')) return null
  if (parts[0] === '__MACOSX' || parts[parts.length - 1].startsWith('._') || parts[parts.length - 1] === '.DS_Store') return null
  if (name.endsWith('/')) return null
  return parts.map((s) => s.replace(/[<>:"|?*\x00-\x1f]/g, '_')).join('/')
}

/** Write a zip (deflate level 6 for text, store for media that is already compressed). */
export function writeZip(files: Record<string, Uint8Array>): Uint8Array {
  const z: Zippable = {}
  for (const [name, data] of Object.entries(files)) {
    const compressed = /\.(jpe?g|png|gif|webp|mp4|mov|m4v|mp3|m4a|aac|zip|heic|avif|webm)$/i.test(name)
    z[name] = [data, { level: compressed ? 0 : 6 }]
  }
  return zipSync(z)
}
