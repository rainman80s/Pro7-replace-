/**
 * Displays & outputs — shared types, RPC contract and PURE logic (no Electron, no DOM).
 *
 * Everything here is unit-tested with simulated display sets (tests/outputs.test.ts):
 *   - display identity: fingerprints + score matching so a replugged display gets its role back
 *   - routing resolution: groups (mirror / video-wall), effective source rect per output
 *   - geometry: fit, snapping, corner-pin homography → CSS matrix3d
 *   - clock sync: NTP-style offset estimation for network receivers
 *   - canvas presets ("Stacked LED wall", triple-wide…)
 */
import type { Canvas, ID, Output, Rect, Region, Size } from './model'
import type { DisplayInfo } from './api'

/* ───────────────────────── additive model / api fields (declaration merging) ───────────────────────── */

export type TestPatternId = 'grid' | 'bars' | 'regions' | 'pixels' | 'white' | 'black' | 'focus'

export interface GroupLayout {
  /** mirror = every member shows the same thing. wall = members each show one cell of the source, row by row. */
  mode: 'mirror' | 'wall'
  columns?: number
  rows?: number
}

declare module './model' {
  interface Output {
    /** Show a test pattern on this output instead of the live content. */
    testPattern?: TestPatternId | null
    /** Group outputs (target.type === 'group'): how members share the source. Default mirror. */
    groupLayout?: GroupLayout
    /** Render without the black backdrop / background layer so the output can be keyed (NDI alpha, OBS overlays). */
    transparent?: boolean
    /** The operator explicitly chose to put this output on the screen the app itself is on. */
    allowOperatorScreen?: boolean
    /** NDI outputs: frames per second (default 30). */
    frameRate?: number
  }
  interface OutputTransform {
    /** Shrink the picture by this fraction per side (0..0.2) for TVs that cut off the edges. */
    overscan?: number
  }
}

declare module './api' {
  interface DisplayInfo {
    /** False = a remembered display that is not plugged in right now. */
    connected?: boolean
    /** True if the operator window is on this display (never auto-used as an output). */
    operator?: boolean
    /** Native pixel size (bounds × scaleFactor). */
    nativeSize?: Size
    rotation?: number
    /** Friendly name the user gave it ("Left projector"). */
    customName?: string
    lastSeen?: number
  }
  interface ReceiverInfo {
    pixelRatio?: number
    /** Estimated one-way latency in ms and clock offset, reported by the receiver. */
    rttMs?: number
    clockOffsetMs?: number
    /** live.rev the receiver last rendered. */
    rev?: number
    firstSeen?: number
    /** Number of open connections with this receiver id (2 = the page is open twice). */
    connections?: number
    /** 'receiver' = waiting to be assigned; 'adhoc' = opened with ?canvasId (OBS / preview). */
    role?: string
  }
  interface OutputDescription {
    /** Exact source rectangle in canvas pixels (region or video-wall cell). Undefined = whole canvas. */
    crop?: Rect
    /** This output is the one place that plays program audio. */
    audio?: boolean
    /** False = configured but switched off (output shows black). */
    enabled?: boolean
    /** Receivers that aren't assigned yet get their own identity back so they can show it. */
    receiver?: { id: string; name: string } | null
    /** Main-process time when this description was produced (coarse; use outputs.time for sync). */
    serverTime?: number
  }
  interface ApiMethods {
    /** Per-output status in plain words, for the Displays view and the app status strip. */
    'outputs.health': { req: void; res: OutputHealth[] }
    /** Emergency: hide every output window on this computer (toggle). */
    'outputs.safeMode': { req: { on?: boolean } | void; res: { on: boolean; shortcut: string } }
    'outputs.testPattern': { req: { id?: ID; pattern: TestPatternId | null }; res: Output[] }
    /** One-click "Also show on…": a new output with the same source on another destination. */
    'outputs.duplicate': { req: { id: ID; target: Output['target']; name?: string }; res: Output[] }
    /** Create/update a group. Members keep their own destination but show the group's source. */
    'outputs.saveGroup': { req: { id?: ID; name: string; canvasId: ID; regionId?: ID; memberIds: ID[]; layout?: GroupLayout; enabled?: boolean }; res: Output[] }
    'outputs.groupMember': { req: { groupId: ID; memberId: ID; member: boolean }; res: Output[] }
    /** PNG data URL of what an output is showing right now (local windows / NDI only). */
    'outputs.thumbnail': { req: { id: ID; width?: number }; res: string | null }
    'outputs.identifyOne': { req: { id: ID; ms?: number }; res: void }
    /** NTP-style clock probe for receivers. */
    'outputs.time': { req: void; res: { t: number } }
    'outputs.audioRoute': { req: void; res: AudioRoute }
    'outputs.setAudioRoute': { req: AudioRoute; res: AudioRoute }
    'outputs.canvasPresets': { req: void; res: CanvasPreset[] }
    'outputs.ndiStatus': { req: void; res: NdiStatus }
    'displays.rename': { req: { key: string; name: string }; res: DisplayInfo[] }
    'displays.forget': { req: { key: string }; res: DisplayInfo[] }
    /** Called by a receiver page when it connects (and every few seconds as a heartbeat). */
    'receivers.hello': { req: ReceiverHello; res: { id: string; name: string; serverTime: number } }
    'receivers.list': { req: void; res: ReceiverInfo[] }
    'receivers.rename': { req: { id: string; name: string }; res: ReceiverInfo[] }
    /** Point a receiver at a canvas/region (creates or updates its output). canvasId null = unassign. */
    'receivers.assign': { req: { id: string; canvasId: ID | null; regionId?: ID }; res: Output[] }
    'receivers.forget': { req: { id: string }; res: ReceiverInfo[] }
    /** What mDNS found on the network (other Reach computers, Cast / AirPlay capable devices). */
    'discovery.scan': { req: { refresh?: boolean } | void; res: DiscoveryState }
  }
  interface ApiEvents {
    'outputs.healthChanged': OutputHealth[]
    'outputs.safeModeChanged': { on: boolean }
    'outputs.identifyOne': { id: ID; on: boolean }
    'outputs.audioRouteChanged': AudioRoute
    'discovery.changed': DiscoveryState
  }
}

export interface AudioRoute {
  /** 'operator' = the operator window on this computer; 'output' = the output named by outputId; 'none' = nowhere. */
  device: 'operator' | 'output' | 'none'
  outputId?: ID
}

export type HealthStatus = 'live' | 'off' | 'waiting' | 'missing' | 'offline' | 'blocked' | 'recovering' | 'unavailable' | 'safe-mode'

export interface OutputHealth {
  outputId: ID
  name: string
  status: HealthStatus
  /** Plain-language sentence a volunteer can act on. */
  message: string
  ok: boolean
  /** Destination pixel size when known. */
  size?: Size
  fps?: number
  crashes?: number
  groupId?: ID
}

export interface ReceiverHello {
  receiverId: string
  name?: string
  width?: number
  height?: number
  pixelRatio?: number
  role?: string
  rttMs?: number
  clockOffsetMs?: number
  rev?: number
}

export interface NdiStatus {
  available: boolean
  /** Plain-language reason when not available. */
  reason?: string
  version?: string
  senders: { outputId: ID; name: string; fps: number; frames: number; dropped: number; connections?: number }[]
}

export interface DiscoveredDevice {
  id: string
  name: string
  kind: 'reach' | 'cast' | 'airplay' | 'receiver-capable'
  host?: string
  addresses: string[]
  port?: number
  model?: string
  /** Honest guidance on how (or whether) this device can be used. */
  hint: string
}

export interface DiscoveryState {
  advertising: boolean
  /** e.g. "Reach Presenter (Booth-Mac)". */
  serviceName?: string
  hostname?: string
  /** URLs a receiver can open, best first (IP first: many TVs cannot resolve .local names). */
  urls: string[]
  devices: DiscoveredDevice[]
  error?: string
}

/* ───────────────────────── display identity ───────────────────────── */

/** What we can know about a physical display (Electron exposes no EDID/serial). */
export interface DisplaySnapshot {
  /** Electron's volatile id. */
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  rotation?: number
  internal: boolean
  primary: boolean
  /** The operator window is on this display. */
  operator?: boolean
}

export interface DisplayFingerprint {
  key: string
  electronId: number
  label: string
  native: Size
  scaleFactor: number
  rotation: number
  internal: boolean
  /** Top-left relative to the primary display's top-left, in DIP. */
  position: { x: number; y: number }
  customName?: string
  lastSeen: number
}

export const nativeSize = (d: Pick<DisplaySnapshot, 'bounds' | 'scaleFactor'>): Size => ({
  width: Math.round(d.bounds.width * d.scaleFactor),
  height: Math.round(d.bounds.height * d.scaleFactor)
})

export function fingerprintOf(d: DisplaySnapshot, all: DisplaySnapshot[], key: string, now: number, prev?: DisplayFingerprint): DisplayFingerprint {
  const primary = all.find((x) => x.primary) ?? all[0] ?? d
  return {
    key,
    electronId: d.id,
    label: d.label,
    native: nativeSize(d),
    scaleFactor: d.scaleFactor,
    rotation: d.rotation ?? 0,
    internal: d.internal,
    position: { x: d.bounds.x - primary.bounds.x, y: d.bounds.y - primary.bounds.y },
    customName: prev?.customName,
    lastSeen: now
  }
}

/** Minimum score for a live display to be treated as a remembered one. */
export const MATCH_THRESHOLD = 50
/** The operator's screen is only matched on near-certain evidence, so an output never jumps onto it by guesswork. */
export const OPERATOR_MATCH_THRESHOLD = 75

/**
 * How strongly does a live display look like a remembered one?
 * label + native size is the backbone (50); the volatile id and position break ties between identical displays.
 * An internal/external mismatch can never match.
 */
export function scoreDisplay(fp: DisplayFingerprint, d: DisplaySnapshot, all: DisplaySnapshot[]): number {
  if (fp.internal !== d.internal) return -Infinity
  const primary = all.find((x) => x.primary) ?? all[0] ?? d
  const n = nativeSize(d)
  let s = 0
  const sameLabel = !!fp.label && fp.label === d.label
  const sameSize = fp.native.width === n.width && fp.native.height === n.height
  if (sameLabel) s += 30
  if (sameSize) s += 20
  // A changed label means a different monitor even at the same id/port (e.g. projector swapped for a TV).
  if (fp.label && d.label && !sameLabel) s -= 30
  // Windows often reports no label at all: two unlabeled displays are weak evidence of "the same".
  if (!fp.label && !d.label) s += 15
  if (fp.electronId === d.id) s += 35
  const dx = d.bounds.x - primary.bounds.x - fp.position.x
  const dy = d.bounds.y - primary.bounds.y - fp.position.y
  const dist = Math.hypot(dx, dy)
  if (dist < 1) s += 15
  else if (dist < 400) s += 8
  if (Math.abs(fp.scaleFactor - d.scaleFactor) < 0.01) s += 3
  if ((d.rotation ?? 0) === fp.rotation) s += 2
  if (fp.internal && d.internal) s += 20 // there is normally exactly one built-in panel
  return s
}

export interface DisplayMatch {
  /** live display id → remembered key. */
  byDisplay: Map<number, string>
  /** Displays never seen before (the caller mints a key for each). */
  unknown: DisplaySnapshot[]
  /** Remembered keys with no live display right now. */
  missing: string[]
}

/** Greedy best-score assignment of live displays to remembered fingerprints. Pure + deterministic. */
export function matchDisplays(known: DisplayFingerprint[], live: DisplaySnapshot[]): DisplayMatch {
  const pairs: { key: string; id: number; score: number; operator: boolean }[] = []
  for (const fp of known) {
    for (const d of live) {
      const score = scoreDisplay(fp, d, live)
      const threshold = d.operator && !fp.internal ? OPERATOR_MATCH_THRESHOLD : MATCH_THRESHOLD
      if (score >= threshold) pairs.push({ key: fp.key, id: d.id, score, operator: !!d.operator })
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key) || a.id - b.id)
  const byDisplay = new Map<number, string>()
  const usedKeys = new Set<string>()
  for (const p of pairs) {
    if (byDisplay.has(p.id) || usedKeys.has(p.key)) continue
    byDisplay.set(p.id, p.key)
    usedKeys.add(p.key)
  }
  return {
    byDisplay,
    unknown: live.filter((d) => !byDisplay.has(d.id)),
    missing: known.filter((k) => !usedKeys.has(k.key)).map((k) => k.key)
  }
}

/**
 * Full reconcile step: match, mint keys for new displays, refresh fingerprints of matched ones.
 * Returns the new remembered list and the key of each live display.
 */
export function reconcileDisplays(
  known: DisplayFingerprint[],
  live: DisplaySnapshot[],
  now: number,
  mintKey: () => string
): { known: DisplayFingerprint[]; keys: Map<number, string>; missing: string[] } {
  const m = matchDisplays(known, live)
  const keys = new Map(m.byDisplay)
  const next = new Map(known.map((k) => [k.key, k]))
  for (const d of live) {
    let key = keys.get(d.id)
    if (!key) {
      key = mintKey()
      keys.set(d.id, key)
    }
    next.set(key, fingerprintOf(d, live, key, now, next.get(key)))
  }
  return { known: [...next.values()], keys, missing: m.missing }
}

/* ───────────────────────── routing resolution (groups, walls) ───────────────────────── */

export const canvasRect = (c: Pick<Canvas, 'width' | 'height'>): Rect => ({ x: 0, y: 0, w: c.width, h: c.height })

export function sourceRect(canvas: Canvas | undefined, regionId?: ID): Rect | undefined {
  if (!canvas) return undefined
  const r = regionId ? canvas.regions.find((x) => x.id === regionId) : undefined
  return r ? { ...r.rect } : canvasRect(canvas)
}

/** Split a source rectangle into columns × rows cells, row by row (video wall). Cells tile exactly (no gaps from rounding). */
export function wallCells(src: Rect, columns: number, rows: number): Rect[] {
  const cols = Math.max(1, Math.floor(columns))
  const rws = Math.max(1, Math.floor(rows))
  const xs = Array.from({ length: cols + 1 }, (_, i) => src.x + Math.round((src.w * i) / cols))
  const ys = Array.from({ length: rws + 1 }, (_, i) => src.y + Math.round((src.h * i) / rws))
  const out: Rect[] = []
  for (let r = 0; r < rws; r++) for (let c = 0; c < cols; c++) out.push({ x: xs[c], y: ys[r], w: xs[c + 1] - xs[c], h: ys[r + 1] - ys[r] })
  return out
}

/** Sensible default grid for N wall members: a single row (TVs side by side) unless told otherwise. */
export function wallGrid(members: number, layout?: GroupLayout): { columns: number; rows: number } {
  const n = Math.max(1, members)
  if (layout?.columns && layout?.rows) return { columns: layout.columns, rows: layout.rows }
  if (layout?.columns) return { columns: layout.columns, rows: Math.ceil(n / layout.columns) }
  if (layout?.rows) return { columns: Math.ceil(n / layout.rows), rows: layout.rows }
  return { columns: n, rows: 1 }
}

export interface ResolvedOutput {
  output: Output
  /** The group this output belongs to, if any (its source wins). */
  groupId?: ID
  canvasId: ID
  regionId?: ID
  /** Source rect in canvas pixels; undefined when the canvas is unknown. */
  crop?: Rect
  enabled: boolean
  /** Index within its group. */
  memberIndex?: number
}

export const isGroup = (o: Output): o is Output & { target: { type: 'group'; outputIds: ID[] } } => o.target.type === 'group'

/** For every leaf output (not the group rows themselves): what it actually shows, taking groups into account. */
export function resolveOutputs(outputs: Output[], canvases: Canvas[]): Map<ID, ResolvedOutput> {
  const res = new Map<ID, ResolvedOutput>()
  const groupOf = new Map<ID, { group: Output; index: number; count: number }>()
  for (const g of outputs) {
    if (!isGroup(g)) continue
    const members = g.target.outputIds.filter((id) => outputs.some((o) => o.id === id && !isGroup(o)))
    members.forEach((id, index) => { if (!groupOf.has(id)) groupOf.set(id, { group: g, index, count: members.length }) })
  }
  for (const o of outputs) {
    if (isGroup(o)) continue
    const m = groupOf.get(o.id)
    const canvasId = m ? m.group.canvasId : o.canvasId
    const regionId = m ? m.group.regionId : o.regionId
    const canvas = canvases.find((c) => c.id === canvasId)
    let crop = sourceRect(canvas, regionId)
    if (m && crop && m.group.groupLayout?.mode === 'wall') {
      const { columns, rows } = wallGrid(m.count, m.group.groupLayout)
      crop = wallCells(crop, columns, rows)[m.index] ?? crop
    }
    res.set(o.id, { output: o, groupId: m?.group.id, canvasId, regionId, crop, enabled: o.enabled && (m ? m.group.enabled : true), memberIndex: m?.index })
  }
  return res
}

/* ───────────────────────── geometry ───────────────────────── */

/** Where a source of `src` size lands inside a `dst` box for each fit mode (dst pixels). */
export function fitRect(src: Size, dst: Size, fit: 'contain' | 'cover' | 'stretch' = 'contain'): Rect {
  if (fit === 'stretch' || !src.width || !src.height) return { x: 0, y: 0, w: dst.width, h: dst.height }
  const kx = dst.width / src.width
  const ky = dst.height / src.height
  const k = fit === 'cover' ? Math.max(kx, ky) : Math.min(kx, ky)
  const w = src.width * k
  const h = src.height * k
  return { x: (dst.width - w) / 2, y: (dst.height - h) / 2, w, h }
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
/** "16:9", "32:9", "9:16", or a decimal ratio for odd sizes. */
export function aspectLabel(w: number, h: number): string {
  if (!w || !h) return '?'
  const r = w / h
  const known: [number, string][] = [[16 / 9, '16:9'], [16 / 10, '16:10'], [4 / 3, '4:3'], [32 / 9, '32:9'], [48 / 9, '48:9'], [21 / 9, '21:9'], [9 / 16, '9:16'], [8 / 9, '8:9'], [1, '1:1'], [3 / 4, '3:4'], [5 / 4, '5:4']]
  for (const [v, name] of known) if (Math.abs(r - v) / v < 0.012) return name
  const g = gcd(Math.round(w), Math.round(h))
  const a = Math.round(w) / g
  const b = Math.round(h) / g
  return a <= 64 && b <= 64 ? `${a}:${b}` : `${r.toFixed(2)}:1`
}

export interface RouteWarning {
  level: 'info' | 'warning'
  text: string
}

/** Plain-language warnings about a source → destination pairing. */
export function routeWarnings(opts: { sourceName: string; source?: Size; destName: string; dest?: Size; fit?: 'contain' | 'cover' | 'stretch'; rotate?: number }): RouteWarning[] {
  const out: RouteWarning[] = []
  const { source, dest } = opts
  if (!source || !dest || !dest.width || !dest.height) return out
  const d = opts.rotate === 90 || opts.rotate === 270 ? { width: dest.height, height: dest.width } : dest
  const sa = source.width / source.height
  const da = d.width / d.height
  const fit = opts.fit ?? 'contain'
  if (Math.abs(sa - da) / da > 0.015) {
    const what = `${opts.destName} is ${aspectLabel(d.width, d.height)} but “${opts.sourceName}” is ${aspectLabel(source.width, source.height)}`
    if (fit === 'contain') out.push({ level: 'warning', text: `${what} — it will have black bars ${sa > da ? 'above and below' : 'on the sides'}.` })
    else if (fit === 'cover') out.push({ level: 'warning', text: `${what} — the ${sa > da ? 'left and right edges' : 'top and bottom'} will be cut off.` })
    else out.push({ level: 'warning', text: `${what} — the picture will look ${sa > da ? 'squashed' : 'stretched'}.` })
  }
  const k = Math.min(d.width / source.width, d.height / source.height)
  if (k > 1.6) out.push({ level: 'info', text: `${opts.destName} has more pixels (${d.width}×${d.height}) than “${opts.sourceName}” (${source.width}×${source.height}); it will be scaled up and may look soft.` })
  return out
}

/** Snap a moving value to the nearest candidate within `tolerance`. */
export function snapValue(v: number, candidates: number[], tolerance: number): number {
  let best = v
  let bd = tolerance
  for (const c of candidates) {
    const d = Math.abs(c - v)
    if (d <= bd) { bd = d; best = c }
  }
  return best
}

/** Snap a rect (while moving or resizing) to canvas edges/centre and other regions' edges; keeps it inside the canvas. */
export function snapRect(rect: Rect, canvas: Size, others: Rect[], tolerance: number, mode: 'move' | 'resize' = 'move'): Rect {
  const xs = [0, canvas.width, canvas.width / 2, ...others.flatMap((o) => [o.x, o.x + o.w])]
  const ys = [0, canvas.height, canvas.height / 2, ...others.flatMap((o) => [o.y, o.y + o.h])]
  let { x, y, w, h } = rect
  if (mode === 'move') {
    const l = snapValue(x, xs, tolerance)
    const r = snapValue(x + w, xs, tolerance)
    if (l !== x) x = l
    else if (r !== x + w) x = r - w
    const t = snapValue(y, ys, tolerance)
    const b = snapValue(y + h, ys, tolerance)
    if (t !== y) y = t
    else if (b !== y + h) y = b - h
  } else {
    const l = snapValue(x, xs, tolerance)
    const r = snapValue(x + w, xs, tolerance)
    w = r - l
    x = l
    const t = snapValue(y, ys, tolerance)
    const b = snapValue(y + h, ys, tolerance)
    h = b - t
    y = t
  }
  w = Math.max(16, Math.min(Math.round(w), canvas.width))
  h = Math.max(16, Math.min(Math.round(h), canvas.height))
  x = Math.max(0, Math.min(Math.round(x), canvas.width - w))
  y = Math.max(0, Math.min(Math.round(y), canvas.height - h))
  return { x, y, w, h }
}

export const DEFAULT_CORNERS: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]

export function isIdentityPin(p?: [number, number][] | null): boolean {
  return !p || p.length !== 4 || p.every((q, i) => Math.abs(q[0] - DEFAULT_CORNERS[i][0]) < 1e-6 && Math.abs(q[1] - DEFAULT_CORNERS[i][1]) < 1e-6)
}

/**
 * Homography mapping the unit-less box (0,0)-(w,h) onto four destination points (TL, TR, BR, BL; in the same pixel space).
 * Returns the 3×3 matrix row-major [a,b,c, d,e,f, g,h,1], or null if the corners are degenerate.
 */
export function homography(w: number, h: number, dst: [number, number][]): number[] | null {
  const src: [number, number][] = [[0, 0], [w, 0], [w, h], [0, h]]
  // Solve A·x = b for the 8 unknowns with Gaussian elimination.
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]
    const [u, v] = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  const n = 8
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r
    if (Math.abs(A[pivot][col]) < 1e-10) return null
    ;[A[col], A[pivot]] = [A[pivot], A[col]]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = A[r][col] / A[col][col]
      if (!f) continue
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c]
    }
  }
  const x = A.map((row, i) => row[n] / row[i])
  return [...x, 1]
}

export function applyHomography(m: number[], x: number, y: number): [number, number] {
  const w = m[6] * x + m[7] * y + m[8]
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]
}

/** CSS `matrix3d(...)` that corner-pins a w×h box (transform-origin 0 0) to normalized corner points (TL, TR, BR, BL). */
export function cornerPinMatrix3d(w: number, h: number, points: [number, number][]): string | null {
  if (isIdentityPin(points)) return null
  const m = homography(w, h, points.map(([px, py]) => [px * w, py * h] as [number, number]))
  if (!m) return null
  const [a, b, c, d, e, f, g, hh] = m
  // Column-major 4×4 with z passed through.
  const v = [a, d, 0, g, b, e, 0, hh, 0, 0, 1, 0, c, f, 0, 1]
  return `matrix3d(${v.map((n) => +n.toFixed(10)).join(',')})`
}

/* ───────────────────────── clock sync ───────────────────────── */

/**
 * NTP-style clock offset estimator. Feed it (clientSend, serverTime, clientReceive) triples;
 * `offset` is what to ADD to the local clock to get server time. Uses the lowest-latency
 * sample in the window (it has the least asymmetric-delay error).
 */
export class ClockSync {
  private samples: { offset: number; rtt: number }[] = []
  constructor(private window = 8) {}
  add(t0: number, serverT: number, t1: number): void {
    const rtt = Math.max(0, t1 - t0)
    this.samples.push({ offset: serverT - (t0 + t1) / 2, rtt })
    if (this.samples.length > this.window) this.samples.shift()
  }
  get best(): { offset: number; rtt: number } | null {
    if (!this.samples.length) return null
    return this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a))
  }
  get offset(): number { return this.best?.offset ?? 0 }
  get rtt(): number { return this.best?.rtt ?? 0 }
  get count(): number { return this.samples.length }
  reset(): void { this.samples = [] }
}

/** Where a synced media element should be right now, in seconds. */
export function mediaPosition(m: { playing: boolean; startedAt?: number; offset?: number; loop?: boolean }, now: number, duration?: number): number {
  const t = (m.offset ?? 0) + (m.playing && m.startedAt ? Math.max(0, now - m.startedAt) / 1000 : 0)
  if (!duration || !isFinite(duration) || duration <= 0) return t
  return m.loop ? t % duration : Math.min(t, duration)
}

/**
 * How to correct drift between where a video is and where it should be:
 * tiny → leave; small → nudge playbackRate (no visible jump); big → seek.
 */
export function driftCorrection(current: number, want: number): { seek?: number; rate: number } {
  const d = want - current
  const a = Math.abs(d)
  if (a < 0.04) return { rate: 1 }
  if (a < 0.6) return { rate: d > 0 ? 1.05 : 0.95 }
  return { seek: want, rate: 1 }
}

/* ───────────────────────── canvas presets ───────────────────────── */

export interface CanvasPreset {
  id: string
  name: string
  description: string
  kind: 'audience' | 'stage'
  width: number
  height: number
  regions: { name: string; rect: Rect }[]
  layers?: Canvas['layers']
}

export const CANVAS_PRESETS: CanvasPreset[] = [
  { id: 'hd', name: 'Full HD (1080p)', description: 'One normal TV or projector', kind: 'audience', width: 1920, height: 1080, regions: [] },
  { id: '4k', name: '4K', description: 'One 4K TV or projector', kind: 'audience', width: 3840, height: 2160, regions: [] },
  { id: 'ultrawide', name: 'Ultrawide', description: 'A 32:9 LED strip or blended projectors', kind: 'audience', width: 3840, height: 1080, regions: [] },
  { id: 'portrait', name: 'Portrait', description: 'A TV turned on its side', kind: 'audience', width: 1080, height: 1920, regions: [] },
  {
    id: 'stacked', name: 'Stacked LED wall', description: 'One screen on top of another, designed as one picture', kind: 'audience', width: 1920, height: 2160,
    regions: [{ name: 'LED Top', rect: { x: 0, y: 0, w: 1920, h: 1080 } }, { name: 'LED Bottom', rect: { x: 0, y: 1080, w: 1920, h: 1080 } }]
  },
  {
    id: 'side-by-side', name: 'Side by side', description: 'Two screens next to each other as one picture', kind: 'audience', width: 3840, height: 1080,
    regions: [{ name: 'Left', rect: { x: 0, y: 0, w: 1920, h: 1080 } }, { name: 'Right', rect: { x: 1920, y: 0, w: 1920, h: 1080 } }]
  },
  {
    id: 'triple', name: 'Triple wide', description: 'Three screens in a row as one picture', kind: 'audience', width: 5760, height: 1080,
    regions: [{ name: 'Left', rect: { x: 0, y: 0, w: 1920, h: 1080 } }, { name: 'Centre', rect: { x: 1920, y: 0, w: 1920, h: 1080 } }, { name: 'Right', rect: { x: 3840, y: 0, w: 1920, h: 1080 } }]
  },
  { id: 'lower-third', name: 'Stream overlay', description: 'Lyrics only, no background — for the live stream', kind: 'audience', width: 1920, height: 1080, regions: [], layers: { background: false, video: false } },
  { id: 'lobby', name: 'Lobby TVs', description: 'Announcements only', kind: 'audience', width: 1920, height: 1080, regions: [], layers: { slide: false, video: false, message: false, props: false } },
  { id: 'stage', name: 'Stage display', description: 'Confidence monitor for the people on stage', kind: 'stage', width: 1920, height: 1080, regions: [] }
]

/** Regions stacked top-to-bottom, each with its own pixel size (panels of different widths are centred). */
export function stackedCanvas(panels: { name: string; width: number; height: number }[], direction: 'vertical' | 'horizontal' = 'vertical'): { width: number; height: number; regions: { name: string; rect: Rect }[] } {
  const vertical = direction === 'vertical'
  const width = vertical ? Math.max(...panels.map((p) => p.width)) : panels.reduce((a, p) => a + p.width, 0)
  const height = vertical ? panels.reduce((a, p) => a + p.height, 0) : Math.max(...panels.map((p) => p.height))
  let at = 0
  const regions = panels.map((p) => {
    const rect: Rect = vertical ? { x: Math.round((width - p.width) / 2), y: at, w: p.width, h: p.height } : { x: at, y: Math.round((height - p.height) / 2), w: p.width, h: p.height }
    at += vertical ? p.height : p.width
    return { name: p.name, rect }
  })
  return { width, height, regions }
}

export function canvasFromPreset(p: CanvasPreset, id: ID, mintRegionId: () => ID, name?: string, color?: string): Canvas {
  return {
    id, name: name ?? p.name, kind: p.kind, width: p.width, height: p.height, color,
    regions: p.regions.map((r): Region => ({ id: mintRegionId(), name: r.name, rect: { ...r.rect } })),
    ...(p.layers ? { layers: { ...p.layers } } : {})
  }
}

/* ───────────────────────── small helpers shared by UI + main ───────────────────────── */

export function destinationLabel(o: Output, displays: DisplayInfo[], receivers: { id: string; name: string }[]): string {
  const t = o.target
  if (t.type === 'display') {
    const d = displays.find((x) => x.key === t.displayKey)
    return d ? (d.customName || d.label) : 'Unplugged display'
  }
  if (t.type === 'network') return receivers.find((r) => r.id === t.receiverId)?.name ?? 'Network display'
  if (t.type === 'ndi') return `NDI “${t.name}”`
  if (t.type === 'window') return 'Window on this computer'
  return `Group of ${t.outputIds.length}`
}

/** NDI needs even dimensions; also clamps silly sizes. */
export function evenSize(s: Size): Size {
  const ev = (n: number): number => Math.max(2, Math.min(8192, Math.round(n / 2) * 2))
  return { width: ev(s.width), height: ev(s.height) }
}
