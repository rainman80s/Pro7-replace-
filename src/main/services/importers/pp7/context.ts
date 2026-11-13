import type { MediaRef } from '@shared/model'
import type { PB } from './proto'

/** A media reference found while converting; the caller resolves it and rewrites `ref.src`. */
export interface MediaRequest {
  ref: MediaRef
  url: PP7Url
  /** Where in the document it was found, for the report. */
  where: string
}

/** Normalised view of an rv.data.URL. */
export interface PP7Url {
  /** Absolute filesystem path as recorded (POSIX or Windows form), if any. */
  absolute?: string
  /** http(s) URL for web media. */
  web?: string
  /** ROOT_* name of the root-relative form, e.g. "ROOT_SHOW". */
  root?: string
  /** Path relative to `root`. */
  relative?: string
  platform?: string
  /** Last path component (never contains separators). */
  basename: string
  /** External volume info when stored on a removable/network drive. */
  volume?: string
}

/** Collects everything worth telling the user about one file. Never throws. */
export class ConvertContext {
  warnings: string[] = []
  /** Known ProPresenter features we saw but have no equivalent for yet (feature → count). */
  unmapped: Record<string, number> = {}
  media: MediaRequest[] = []
  /** Raw payloads of cue actions we could not map, preserved under meta.source.unmapped. */
  unmappedActions: { slideId?: string; type: string; name?: string; data: unknown }[] = []
  private ids = 0
  constructor(public newId: () => string, public opts: { strictOrder?: boolean } = {}) {}

  note(feature: string, n = 1): void {
    this.unmapped[feature] = (this.unmapped[feature] ?? 0) + n
  }
  warn(msg: string): void {
    if (this.warnings.length < 200 && !this.warnings.includes(msg)) this.warnings.push(msg)
  }
  seq(): number {
    return ++this.ids
  }
}

/** JSON-safe copy of a decoded protobuf object (Buffers → short base64 / dropped), size-limited. */
export function jsonSafe(v: PB, depth = 0): unknown {
  if (v === null || v === undefined) return v
  if (typeof v === 'string') return v.length > 2000 ? v.slice(0, 2000) + '…' : v
  if (typeof v !== 'object') return v
  if (v instanceof Uint8Array) return v.length > 512 ? `<${v.length} bytes>` : Buffer.from(v).toString('base64')
  if (depth > 12) return '<…>'
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => jsonSafe(x, depth + 1))
  const o: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) o[k] = jsonSafe(x, depth + 1)
  return o
}
