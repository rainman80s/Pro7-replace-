/**
 * Output planning — PURE (no Electron), unit-tested in tests/plan.test.ts.
 *
 * Given the remembered outputs, the canvases, what is plugged in right now and which screen the operator
 * is using, decide for every output: open a fullscreen window on display X, a floating window, an offscreen
 * capture (NDI), rely on a network receiver, or show nothing — plus a plain-language health line.
 */
import type { Canvas, ID, Output, Rect, Size } from '@shared/model'
import { normalizePlacement } from '@shared/placement'
import { evenSize, isGroup, resolveOutputs, type HealthStatus, type OutputHealth, type ResolvedOutput } from '@shared/outputs'
import { deckLinkRate, type DeckLinkAlign, type DeckLinkDevice, type DeckLinkKeying } from '@shared/decklink'

export interface PlanDisplay {
  key: string
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  /** Native pixel size. */
  size: Size
  connected: boolean
  operator: boolean
  lastSeen?: number
}

export interface PlanReceiver {
  id: string
  name: string
  connected: boolean
  width?: number
  height?: number
  lastSeen: number
}

export type PlannedWindow =
  | { outputId: ID; kind: 'display'; displayKey: string; bounds: PlanDisplay['bounds'] }
  | { outputId: ID; kind: 'window' }
  | { outputId: ID; kind: 'capture'; size: Size; fps: number; name: string; transparent: boolean; decklink?: PlannedDeckLink }

/** A capture window that feeds a DeckLink port instead of NDI. */
export interface PlannedDeckLink {
  device: string
  index: number
  displayName: string
  mode: string
  /** Exact rate for pacing (timeScale / frameDuration). */
  rate: { num: number; den: number }
  keying: DeckLinkKeying
  keyLevel: number
  align: DeckLinkAlign
  /** SDI frame size + the custom placement of the picture in it (see Output.placement). */
  modeSize?: Size
  placement?: Rect
  delayFrames?: number
  frameMs?: number
}

export interface PlanInput {
  outputs: Output[]
  canvases: Canvas[]
  displays: PlanDisplay[]
  receivers: PlanReceiver[]
  safeMode: boolean
  ndiAvailable: boolean
  ndiReason?: string
  /** DeckLink ports on this machine (connected + remembered) and, when unusable, why. */
  decklink?: { available: boolean; reason?: string; devices: DeckLinkDevice[] }
  /** Runtime facts about open windows. */
  runtime?: Record<ID, { loaded?: boolean; crashes?: number; recovering?: boolean; fps?: number; sinkProblem?: string }>
  now?: number
  safeModeShortcut?: string
}

export interface Plan {
  windows: PlannedWindow[]
  health: OutputHealth[]
  resolved: Map<ID, ResolvedOutput>
}

const ago = (now: number, t?: number): string => {
  if (!t) return 'a while ago'
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 90) return 'just now'
  const m = Math.round(s / 60)
  if (m < 90) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

export function sourceLabel(canvases: Canvas[], canvasId: ID, regionId?: ID): string {
  const c = canvases.find((x) => x.id === canvasId)
  if (!c) return 'a screen that no longer exists'
  const r = regionId ? c.regions.find((x) => x.id === regionId) : undefined
  return r ? `${c.name} › ${r.name}` : c.name
}

export function cropSize(r: ResolvedOutput | undefined): Size | undefined {
  return r?.crop ? { width: r.crop.w, height: r.crop.h } : undefined
}

export function planOutputs(input: PlanInput): Plan {
  const now = input.now ?? Date.now()
  const resolved = resolveOutputs(input.outputs, input.canvases)
  const windows: PlannedWindow[] = []
  const health: OutputHealth[] = []
  const usedDisplays = new Map<string, ID>()
  const usedPorts = new Map<string, ID>()

  for (const o of input.outputs) {
    if (isGroup(o)) continue
    const r = resolved.get(o.id)!
    const what = sourceLabel(input.canvases, r.canvasId, r.regionId)
    const push = (status: HealthStatus, message: string, size?: Size, extra: Partial<OutputHealth> = {}): void => {
      health.push({ outputId: o.id, name: o.name, status, message, ok: status === 'live' || status === 'off', size, groupId: r.groupId, ...extra })
    }
    const rt = input.runtime?.[o.id]
    const canvasExists = input.canvases.some((c) => c.id === r.canvasId)
    if (!r.enabled) { push('off', r.groupId && o.enabled ? 'Switched off with its group.' : 'Switched off.'); continue }
    if (!canvasExists) { push('blocked', `Its screen was deleted. Pick what “${o.name}” should show.`); continue }
    if (input.safeMode) {
      push('safe-mode', `Hidden by safe mode.${input.safeModeShortcut ? ` Press ${input.safeModeShortcut} or click “Bring outputs back”.` : ''}`)
      continue
    }
    const runtimeStatus = (size?: Size): void => {
      if (rt?.recovering) push('recovering', `It stopped responding and is restarting${rt.crashes ? ` (${rt.crashes}×)` : ''}.`, size, { crashes: rt.crashes })
      else if (rt && !rt.loaded) push('waiting', 'Starting…', size)
      else push('live', `Showing ${what}.`, size, { crashes: rt?.crashes, fps: rt?.fps })
    }
    const t = o.target
    if (t.type === 'display') {
      const d = input.displays.find((x) => x.key === t.displayKey)
      if (!d || !d.connected) {
        push('missing', `“${d?.label ?? 'This display'}” isn’t plugged in (last seen ${ago(now, d?.lastSeen)}). It comes back by itself when reconnected.`)
        continue
      }
      if (d.operator && !o.allowOperatorScreen) {
        push('blocked', `“${d.label}” is the screen you are working on, so Reach won’t cover it. Move this window to another screen, or choose another display.`, d.size)
        continue
      }
      const other = usedDisplays.get(d.key)
      if (other) {
        const otherName = input.outputs.find((x) => x.id === other)?.name ?? 'another output'
        push('blocked', `“${d.label}” is already showing “${otherName}”. One display can show one output — use “Also show on…” to copy instead.`, d.size)
        continue
      }
      usedDisplays.set(d.key, o.id)
      windows.push({ outputId: o.id, kind: 'display', displayKey: d.key, bounds: { ...d.bounds } })
      runtimeStatus(d.size)
    } else if (t.type === 'window') {
      windows.push({ outputId: o.id, kind: 'window' })
      runtimeStatus()
    } else if (t.type === 'ndi') {
      const size = evenSize(cropSize(r) ?? { width: 1920, height: 1080 })
      if (!input.ndiAvailable) { push('unavailable', input.ndiReason ?? 'NDI isn’t installed on this computer.', size); continue }
      windows.push({ outputId: o.id, kind: 'capture', size, fps: o.frameRate ?? 30, name: t.name || o.name, transparent: !!o.transparent })
      runtimeStatus(size)
    } else if (t.type === 'decklink') {
      const placed = o.placement ? normalizePlacement(o.placement) : undefined
      const size = evenSize(placed ? { width: placed.w, height: placed.h } : cropSize(r) ?? { width: 1920, height: 1080 })
      const dl = input.decklink
      if (!dl?.available) { push('unavailable', dl?.reason ?? 'DeckLink output isn’t available on this computer.', size); continue }
      const dev = dl.devices.find((d) => d.key === t.device)
      if (!dev || !dev.connected) {
        push('missing', `“${t.device}” isn’t connected right now${dev?.lastSeen ? ` (last seen ${ago(now, dev.lastSeen)})` : ''}. It comes back by itself when the card is found.`, size)
        continue
      }
      const mode = dev.modes.find((m) => m.id === t.mode)
      if (!mode) { push('blocked', `“${dev.key}” can’t send the video mode chosen for “${o.name}”. Pick another mode in its settings.`, size); continue }
      const keying = t.keying ?? 'none'
      if ((keying === 'external' && dev.externalKeying === false) || (keying === 'internal' && dev.internalKeying === false) || (keying !== 'none' && !dev.supportsKeying)) {
        push('blocked', `“${dev.key}” can’t do keying. Choose “Picture only”, or use a port that supports fill + key.`, size)
        continue
      }
      const other = usedPorts.get(dev.key)
      if (other) {
        push('blocked', `“${dev.key}” is already showing “${input.outputs.find((x) => x.id === other)?.name ?? 'another output'}”. One SDI port can show one output.`, size)
        continue
      }
      usedPorts.set(dev.key, o.id)
      windows.push({
        outputId: o.id, kind: 'capture', size, fps: mode.fps, name: o.name,
        // Keyed outputs render with a transparent background: alpha becomes the key signal.
        transparent: keying !== 'none' || !!o.transparent,
        decklink: {
          device: dev.key, index: dev.index, displayName: dev.displayName, mode: mode.id, rate: deckLinkRate(mode),
          keying, keyLevel: Math.max(0, Math.min(255, Math.round(t.keyLevel ?? 255))), align: o.decklinkAlign ?? 'top-left',
          modeSize: { width: mode.width, height: mode.height }, placement: placed && { x: placed.x, y: placed.y, w: size.width, h: size.height },
          delayFrames: Math.max(0, Math.min(120, Math.round(o.videoDelay ?? 0))), frameMs: 1000 / mode.fps
        }
      })
      if (rt?.sinkProblem) push('blocked', rt.sinkProblem, size)
      else runtimeStatus(size)
    } else if (t.type === 'placeholder') {
      push('waiting', 'Not connected to anything yet. Pick where it should go under Hardware › Output.')
    } else if (t.type === 'network') {
      const rx = input.receivers.find((x) => x.id === t.receiverId)
      const size = rx?.width && rx?.height ? { width: rx.width, height: rx.height } : undefined
      if (!rx) push('offline', 'This network display hasn’t connected yet. Open the address shown under “Network displays” on the TV.')
      else if (!rx.connected) push('offline', `“${rx.name}” is offline (last seen ${ago(now, rx.lastSeen)}). It reconnects by itself when the TV is back on.`, size)
      else push('live', `Showing ${what}.`, size)
    }
  }

  // Groups: one summary line each, so the status strip can treat them as one destination.
  for (const g of input.outputs) {
    if (!isGroup(g)) continue
    const members = health.filter((h) => h.groupId === g.id)
    const bad = members.filter((h) => !h.ok)
    const what = sourceLabel(input.canvases, g.canvasId, g.regionId)
    let status: HealthStatus = 'live'
    let message = `${members.length} screen${members.length === 1 ? '' : 's'} showing ${what}.`
    if (!g.enabled) { status = 'off'; message = 'Switched off.' }
    else if (!members.length) { status = 'waiting'; message = 'This group has no screens yet. Add some.' }
    else if (bad.length) { status = bad[0].status; message = `${bad.length} of ${members.length} need attention: ${bad.map((b) => b.name).join(', ')}.` }
    health.push({ outputId: g.id, name: g.name, status, message, ok: status === 'live' || status === 'off' })
  }
  return { windows, health, resolved }
}

/** A stable signature: if it changes, the window must be rebuilt (not just moved). */
export function windowSignature(w: PlannedWindow): string {
  if (w.kind === 'display') return `display:${w.displayKey}`
  if (w.kind === 'capture') {
    const d = w.decklink
    const dl = d ? `:dl:${d.device}#${d.index}:${d.mode}:${d.keying}:${d.keyLevel}:${d.align}:${d.placement ? `${d.placement.x},${d.placement.y},${d.placement.w},${d.placement.h}` : ''}:${d.delayFrames}` : ''
    return `capture:${w.size.width}x${w.size.height}@${w.fps}:${w.transparent ? 'a' : 'o'}:${w.name}${dl}`
  }
  return 'window'
}

export function sameBounds(a: Rect | PlanDisplay['bounds'], b: PlanDisplay['bounds']): boolean {
  const ax = 'w' in a ? { x: a.x, y: a.y, width: a.w, height: a.h } : a
  return ax.x === b.x && ax.y === b.y && ax.width === b.width && ax.height === b.height
}
