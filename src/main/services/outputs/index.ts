import { app, globalShortcut } from 'electron'
import type { ID, Output, StageLayout } from '@shared/model'
import type { OutputDescription } from '@shared/api'
import {
  CANVAS_PRESETS, isGroup, type AudioRoute, type NdiStatus, type OutputHealth, type ReceiverHello
} from '@shared/outputs'
import { defineService, type ServiceContext } from '../../core/service'
import { newId } from '../../core/files'
import { DisplayManager } from './displays'
import { OutputWindows } from './windows'
import { planOutputs, type Plan } from './plan'
import { ReceiverRegistry, type SavedReceiver } from './receivers'
import { Discovery } from './discovery'
import { createNdiSink, loadNdi, ndiAvailable } from './ndi'

/**
 * Outputs service: remembers outputs per machine, matches displays by fingerprint, opens/recovers output
 * windows, runs network receivers + discovery + NDI, and tells every output page exactly what to render.
 * The routing math lives in pure modules (@shared/outputs, ./plan) so it is unit-tested.
 */
let ctx: ServiceContext
let displays: DisplayManager
let windows: OutputWindows
let registry: ReceiverRegistry
let discovery: Discovery
let safeMode = false
let plan: Plan | null = null
let lastHealth = ''
let recomputeTimer: NodeJS.Timeout | null = null

export const SAFE_MODE_SHORTCUT = process.platform === 'darwin' ? 'Command+Shift+Escape' : 'Control+Shift+F12'
const SAFE_MODE_LABEL = process.platform === 'darwin' ? '⌘⇧Esc' : 'Ctrl+Shift+F12'

const getOutputs = (): Output[] => ctx.local.get<Output[]>('outputs', [])
const getAudioRoute = (): AudioRoute => ctx.local.get<AudioRoute>('audioRoute', { device: 'operator' })

function setOutputs(list: Output[]): Output[] {
  // Keep groups consistent: drop members that no longer exist.
  const ids = new Set(list.map((o) => o.id))
  const clean = list.map((o) => (isGroup(o) ? { ...o, target: { type: 'group' as const, outputIds: o.target.outputIds.filter((id) => ids.has(id) && id !== o.id) } } : o))
  ctx.local.set('outputs', clean)
  ctx.api.emit('outputs.changed', clean)
  recompute()
  return clean
}

function receiverList(): ReturnType<ReceiverRegistry['list']> {
  const outputs = getOutputs()
  return registry.list((rid) => outputs.find((o) => o.target.type === 'network' && o.target.receiverId === rid)?.id)
}

function buildPlan(): Plan {
  return planOutputs({
    outputs: getOutputs(), canvases: ctx.workspace.config.canvases, displays: displays.planDisplays(),
    receivers: receiverList().map((r) => ({ id: r.id, name: r.name, connected: r.connected, width: r.width, height: r.height, lastSeen: r.lastSeen })),
    safeMode, ndiAvailable: ndiAvailable(), ndiReason: loadNdi().reason, runtime: windows.runtime(), safeModeShortcut: SAFE_MODE_LABEL
  })
}

/** Recompute the plan and make windows/health match it. Coalesced so bursts of changes cost one pass. */
function recompute(immediate = false): void {
  if (recomputeTimer) clearTimeout(recomputeTimer)
  recomputeTimer = null
  if (!immediate) { recomputeTimer = setTimeout(() => recompute(true), 16); return }
  plan = buildPlan()
  windows.apply(plan.windows)
  emitHealth(false)
}

/** Runtime facts (loaded / crashed / fps) change without a re-plan: refresh the health lines and emit if they changed. */
function emitHealth(rebuild = true): void {
  if (!plan) return
  if (rebuild) plan.health = buildPlan().health
  const key = JSON.stringify(plan.health.map((h) => [h.outputId, h.status, h.message]))
  if (key !== lastHealth) { lastHealth = key; ctx.api.emit('outputs.healthChanged', plan.health) }
}

function health(): OutputHealth[] {
  if (!plan) recompute(true)
  return plan!.health
}

function setSafeMode(on: boolean): { on: boolean; shortcut: string } {
  if (safeMode !== on) {
    safeMode = on
    if (on) windows.closeAll()
    ctx.api.emit('outputs.safeModeChanged', { on })
    ctx.api.emit('ui.notify', on
      ? { level: 'warning', title: 'Safe mode: all outputs hidden', detail: `Press ${SAFE_MODE_LABEL} again or click “Bring outputs back”.` }
      : { level: 'success', title: 'Outputs are back' })
    recompute(true)
  }
  return { on: safeMode, shortcut: SAFE_MODE_LABEL }
}

/** The leaf output (if any) that should play program audio, so exactly one place does. */
function audioOutputId(): ID | undefined {
  const r = getAudioRoute()
  if (r.device !== 'output' || !r.outputId) return undefined
  const all = getOutputs()
  const o = all.find((x) => x.id === r.outputId)
  if (!o) return undefined
  if (!isGroup(o)) return o.id
  return o.target.outputIds.find((id) => all.find((x) => x.id === id)?.enabled)
}

async function describe(req: { outputId?: ID; receiverId?: string; canvasId?: ID; regionId?: ID }): Promise<OutputDescription | null> {
  const ws = ctx.workspace.config
  const outputs = getOutputs()
  const output = outputs.find((o) => !isGroup(o) && (o.id === req.outputId || (req.receiverId && o.target.type === 'network' && o.target.receiverId === req.receiverId))) ?? null
  const resolved = output ? (plan?.resolved.get(output.id) ?? planOutputs({ outputs, canvases: ws.canvases, displays: [], receivers: [], safeMode, ndiAvailable: false }).resolved.get(output.id)) : undefined
  const canvasId = resolved?.canvasId ?? req.canvasId ?? (req.receiverId ? undefined : ws.canvases[0]?.id)
  const rec = req.receiverId ? registry.get(req.receiverId) : undefined
  const receiver = rec ? { id: rec.id, name: rec.name } : null
  const canvas = ws.canvases.find((c) => c.id === canvasId)
  if (!canvas) return req.receiverId ? ({ output: null, canvas: null as never, workspace: ws, receiver, serverTime: Date.now() } as OutputDescription) : null
  let stageLayout: StageLayout | null = null
  if (canvas.kind === 'stage') {
    const layouts = await ctx.workspace.readDoc<StageLayout[]>('stageLayouts', [])
    stageLayout = layouts.find((l) => l.id === canvas.stageLayoutId) ?? layouts[0] ?? null
  }
  const regionId = resolved ? resolved.regionId : req.regionId
  const crop = resolved?.crop ?? (regionId ? canvas.regions.find((r) => r.id === regionId)?.rect : undefined)
  const virtual: Output | null = output
    ? { ...output, canvasId: canvas.id, regionId }
    : req.canvasId ? { id: 'preview', name: 'Preview', canvasId: canvas.id, regionId, target: { type: 'window' }, enabled: true } : null
  return {
    output: virtual, canvas, workspace: ws, stageLayout, crop,
    audio: !!output && audioOutputId() === output.id,
    enabled: (resolved ? resolved.enabled : true) && !safeMode,
    receiver, serverTime: Date.now()
  }
}

function saveOutput(output: Output): Output[] {
  const list = getOutputs()
  if (!output.id) output.id = newId()
  const i = list.findIndex((o) => o.id === output.id)
  return setOutputs(i >= 0 ? list.map((o, j) => (j === i ? output : o)) : [...list, output])
}

function registerApi(): void {
  const { api } = ctx
  api.handle('outputs.list', () => getOutputs(), 'control')
  api.handle('outputs.save', ({ output }) => saveOutput(output), 'local')
  api.handle('outputs.remove', ({ id }) => setOutputs(getOutputs().filter((o) => o.id !== id)), 'local')
  api.handle('outputs.displays', () => displays.list(getOutputs()), 'control')
  api.handle('outputs.receivers', () => receiverList(), 'control')
  api.handle('outputs.describe', (req) => describe(req), 'public')
  api.handle('outputs.identify', () => {
    api.emit('outputs.identify', { on: true })
    setTimeout(() => api.emit('outputs.identify', { on: false }), 4000)
  })
  api.handle('outputs.identifyOne', ({ id, ms }) => {
    api.emit('outputs.identifyOne', { id, on: true })
    setTimeout(() => api.emit('outputs.identifyOne', { id, on: false }), ms ?? 3000)
  })
  api.handle('outputs.health', () => health(), 'control')
  // With `on` it sets safe mode; without, it only reports it (the keyboard shortcut is the toggle).
  api.handle('outputs.safeMode', (req) => setSafeMode(req && typeof req.on === 'boolean' ? req.on : safeMode), 'control')
  api.handle('outputs.testPattern', ({ id, pattern }) => {
    const list = getOutputs()
    const group = list.find((o) => o.id === id && isGroup(o))
    const targets = new Set(id ? [id, ...(group && isGroup(group) ? group.target.outputIds : [])] : list.map((o) => o.id))
    return setOutputs(list.map((o) => (targets.has(o.id) ? { ...o, testPattern: pattern } : o)))
  }, 'local')
  api.handle('outputs.duplicate', ({ id, target, name }) => {
    const src = getOutputs().find((o) => o.id === id)
    if (!src) throw new Error('Output not found')
    const copy: Output = { ...src, id: newId(), name: name ?? `${src.name} (copy)`, target, testPattern: null, allowOperatorScreen: false }
    if (isGroup(src)) { // "also show on" a group = add a member
      const list = setOutputs([...getOutputs(), { ...copy, target, canvasId: src.canvasId, regionId: src.regionId, groupLayout: undefined }])
      return setOutputs(list.map((o) => (o.id === src.id && isGroup(o) ? { ...o, target: { type: 'group', outputIds: [...o.target.outputIds, copy.id] } } : o)))
    }
    return setOutputs([...getOutputs(), copy])
  }, 'local')
  api.handle('outputs.saveGroup', ({ id, name, canvasId, regionId, memberIds, layout, enabled }) => {
    const list = getOutputs()
    const gid = id || newId()
    const existing = list.find((o) => o.id === gid)
    // An output can only be in one group.
    const stripped = list.map((o) => (isGroup(o) && o.id !== gid ? { ...o, target: { type: 'group' as const, outputIds: o.target.outputIds.filter((m) => !memberIds.includes(m)) } } : o))
    const group: Output = { ...(existing ?? {}), id: gid, name, canvasId, regionId, target: { type: 'group', outputIds: memberIds }, enabled: enabled ?? existing?.enabled ?? true, groupLayout: layout ?? existing?.groupLayout ?? { mode: 'mirror' } }
    return setOutputs(existing ? stripped.map((o) => (o.id === gid ? group : o)) : [...stripped, group])
  }, 'local')
  api.handle('outputs.groupMember', ({ groupId, memberId, member }) => {
    return setOutputs(getOutputs().map((o) => {
      if (!isGroup(o)) return o
      const ids = o.target.outputIds.filter((m) => m !== memberId)
      if (o.id === groupId && member) ids.push(memberId)
      return { ...o, target: { type: 'group', outputIds: ids } }
    }))
  }, 'local')
  api.handle('outputs.thumbnail', ({ id, width }) => windows.thumbnail(id, width), 'local')
  api.handle('outputs.time', () => ({ t: Date.now() }), 'public')
  api.handle('outputs.audioRoute', () => getAudioRoute(), 'control')
  api.handle('outputs.setAudioRoute', (r) => {
    const route: AudioRoute = r.device === 'output' && r.outputId ? { device: 'output', outputId: r.outputId } : { device: r.device === 'none' ? 'none' : 'operator' }
    ctx.local.set('audioRoute', route)
    api.emit('outputs.audioRouteChanged', route)
    api.emit('outputs.changed', getOutputs()) // output pages re-describe → audio flag
    return route
  }, 'local')
  api.handle('outputs.canvasPresets', () => CANVAS_PRESETS, 'control')
  api.handle('outputs.ndiStatus', (): NdiStatus => {
    const n = loadNdi()
    return {
      available: ndiAvailable(), reason: n.reason, version: n.version,
      senders: getOutputs().filter((o) => o.target.type === 'ndi').map((o) => {
        const s = windows.pumpStats(o.id)
        return { outputId: o.id, name: o.target.type === 'ndi' ? o.target.name : o.name, fps: s?.fps ?? 0, frames: s?.frames ?? 0, dropped: s?.dropped ?? 0 }
      })
    }
  }, 'control')
  api.handle('displays.rename', ({ key, name }) => { displays.rename(key, name); return displays.list(getOutputs()) }, 'local')
  api.handle('displays.forget', ({ key }) => { displays.forget(key); return displays.list(getOutputs()) }, 'local')

  // Network receivers.
  api.handle('receivers.hello', (hello: ReceiverHello, c) => {
    if (c.transport !== 'ws' || !c.clientId) throw new Error('receivers.hello is for network displays')
    const client = ctx.server.clients.get(c.clientId)
    const rec = registry.hello(c.clientId, hello, c.address ?? '', client?.userAgent ?? '')
    return { id: rec.id, name: rec.name, serverTime: Date.now() }
  }, 'public')
  api.handle('receivers.list', () => receiverList(), 'control')
  api.handle('receivers.rename', ({ id, name }) => {
    registry.rename(id, name)
    // Keep the output's name in step when it was auto-named after the receiver.
    const list = getOutputs()
    const o = list.find((x) => x.target.type === 'network' && x.target.receiverId === id)
    if (o) setOutputs(list.map((x) => (x.id === o.id ? { ...x, name: name.trim() || x.name } : x)))
    return receiverList()
  }, 'local')
  api.handle('receivers.assign', ({ id, canvasId, regionId }) => {
    const list = getOutputs()
    const o = list.find((x) => x.target.type === 'network' && x.target.receiverId === id)
    if (!canvasId) return o ? setOutputs(list.filter((x) => x.id !== o.id)) : list
    if (o) return saveOutput({ ...o, canvasId, regionId, enabled: true })
    return saveOutput({ id: newId(), name: registry.get(id)?.name ?? 'Network display', canvasId, regionId, target: { type: 'network', receiverId: id }, enabled: true })
  }, 'local')
  api.handle('receivers.forget', ({ id }) => {
    registry.forget(id)
    const list = getOutputs()
    const o = list.find((x) => x.target.type === 'network' && x.target.receiverId === id)
    if (o) setOutputs(list.filter((x) => x.id !== o.id))
    return receiverList()
  }, 'local')
  api.handle('discovery.scan', (req) => {
    if (req && req.refresh) discovery.refresh()
    return discovery.state()
  }, 'control')

  // Test hooks.
  api.handle('outputs.simulateDisplays', ({ displays: list }) => { displays.simulate(list); return displays.list(getOutputs()) }, 'local')
  api.handle('outputs.crashForTest', ({ id }) => windows.crashForTest(id), 'local')
}

function watchOperatorWindow(): void {
  // The operator window: track which screen it is on, and give it the safe-mode key even when a global shortcut can't be had.
  app.on('browser-window-created', (_e, win) => {
    setTimeout(() => {
      if (win.isDestroyed() || windows.isOutputWindow(win)) return
      if (win !== ctx.mainWindow()) return
      const moved = (): void => displays.operatorMoved()
      win.on('moved', moved)
      win.on('move', moved)
      win.on('show', () => displays.schedule(200))
      win.webContents.on('before-input-event', (ev, input) => {
        if (input.type !== 'keyDown') return
        const mod = process.platform === 'darwin' ? input.meta : input.control
        const hit = process.platform === 'darwin' ? input.key === 'Escape' : input.key === 'F12'
        if (mod && input.shift && hit && !globalShortcut.isRegistered(SAFE_MODE_SHORTCUT)) { ev.preventDefault(); setSafeMode(!safeMode) }
      })
      displays.schedule(200)
    }, 0)
  })
}

export default defineService({
  name: 'outputs',
  order: 10,
  async setup(c) {
    ctx = c
    displays = new DisplayManager(ctx.local, () => ctx.mainWindow())
    windows = new OutputWindows(ctx, createNdiSink)
    windows.onRuntime = () => emitHealth()
    windows.onUserClosed = (id) => setOutputs(getOutputs().map((o) => (o.id === id ? { ...o, enabled: false } : o)))
    registry = new ReceiverRegistry({ load: () => ctx.local.get<SavedReceiver[]>('receivers', []), save: (l) => ctx.local.set('receivers', l) })
    registry.onChange(() => { ctx.api.emit('outputs.receiversChanged', receiverList()); recompute() })
    ctx.server.onClient((type, client) => { if (type === 'disconnect') registry.disconnect(client.id) })
    discovery = new Discovery(() => ctx.server.port, () => ctx.server.urls(), app.getVersion())
    discovery.onChange((s) => ctx.api.emit('discovery.changed', s))

    registerApi()
    displays.onChange(() => {
      ctx.api.emit('outputs.displaysChanged', displays.list(getOutputs()))
      recompute()
    })
    ctx.api.on('workspace.changed', () => { ctx.api.emit('outputs.changed', getOutputs()); recompute() })
    watchOperatorWindow()
    displays.start()
    try { globalShortcut.register(SAFE_MODE_SHORTCUT, () => setSafeMode(!safeMode)) } catch { /* taken by another app: in-window key still works */ }
    // Offline receivers age ("last seen 5 min ago"): refresh health once a minute.
    setInterval(() => emitHealth(), 60_000).unref?.()
    void discovery.start()
    recompute(true)
  },
  dispose() {
    try { globalShortcut.unregister(SAFE_MODE_SHORTCUT) } catch { /* ignore */ }
    discovery?.stop()
    displays?.dispose()
    windows?.closeAll()
  }
})

