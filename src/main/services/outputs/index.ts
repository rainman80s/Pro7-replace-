import { BrowserWindow, screen, type Display } from 'electron'
import { join } from 'node:path'
import type { ID, Output, StageLayout } from '@shared/model'
import type { DisplayInfo, OutputDescription } from '@shared/api'
import { defineService, type ServiceContext } from '../../core/service'
import { newId } from '../../core/files'

/**
 * BASELINE outputs service: remembers outputs, opens a fullscreen window on each
 * assigned display (or a floating window), and tells output pages what to render.
 * (Display identity, network receivers, NDI, grouping, hot-plug polish build on this.)
 */
let ctx: ServiceContext
const windows = new Map<ID, BrowserWindow>()

const getOutputs = (): Output[] => ctx.local.get<Output[]>('outputs', [])
function setOutputs(list: Output[]): Output[] {
  ctx.local.set('outputs', list)
  ctx.api.emit('outputs.changed', list)
  syncWindows()
  return list
}

/** A display identity that survives reboots/replugging better than Electron's numeric id. */
function displayKeys(): Map<number, string> {
  const seen = new Map<string, number>()
  const out = new Map<number, string>()
  for (const d of [...screen.getAllDisplays()].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)) {
    const base = `${d.label || 'Display'}|${d.size.width}x${d.size.height}|${d.internal ? 'int' : 'ext'}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    out.set(d.id, n > 1 ? `${base}#${n}` : base)
  }
  return out
}

function listDisplays(): DisplayInfo[] {
  const keys = displayKeys()
  const primary = screen.getPrimaryDisplay().id
  const outputs = getOutputs()
  return screen.getAllDisplays().map((d) => {
    const key = keys.get(d.id)!
    return {
      key, id: d.id, label: d.label || (d.internal ? 'Built-in Display' : `Display ${d.id}`), bounds: d.bounds, scaleFactor: d.scaleFactor,
      internal: d.internal, primary: d.id === primary,
      outputIds: outputs.filter((o) => o.target.type === 'display' && o.target.displayKey === key).map((o) => o.id)
    }
  })
}

function findDisplay(key: string): Display | undefined {
  const keys = displayKeys()
  return screen.getAllDisplays().find((d) => keys.get(d.id) === key)
}

function syncWindows(): void {
  const outputs = getOutputs()
  for (const [id, win] of windows) {
    const o = outputs.find((x) => x.id === id)
    const stillValid = o && o.enabled && (o.target.type === 'window' || (o.target.type === 'display' && findDisplay(o.target.displayKey)))
    if (!stillValid) {
      windows.delete(id)
      if (!win.isDestroyed()) win.destroy()
    }
  }
  for (const o of outputs) {
    if (!o.enabled || windows.has(o.id)) {
      const w = windows.get(o.id)
      if (w && o.target.type === 'display') {
        const d = findDisplay(o.target.displayKey)
        if (d && !w.isDestroyed()) w.setBounds(d.bounds)
      }
      continue
    }
    if (o.target.type === 'display') {
      const d = findDisplay(o.target.displayKey)
      if (!d) continue
      openWindow(o, { ...d.bounds, frame: false, fullscreen: process.platform !== 'darwin', kiosk: false, alwaysOnTop: true, skipTaskbar: true, focusable: false })
    } else if (o.target.type === 'window') {
      openWindow(o, { width: 960, height: 540, frame: true, title: `Output — ${o.name}` })
    }
  }
}

function openWindow(o: Output, opts: Electron.BrowserWindowConstructorOptions): void {
  const win = new BrowserWindow({
    ...opts,
    backgroundColor: '#000000',
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, backgroundThrottling: false }
  })
  win.setMenuBarVisibility(false)
  if (o.target.type === 'display' && process.platform === 'darwin') {
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true)
    win.setSimpleFullScreen(true)
  }
  win.once('ready-to-show', () => (o.target.type === 'display' ? win.showInactive() : win.show()))
  win.on('closed', () => {
    if (windows.get(o.id) === win) {
      windows.delete(o.id)
      // Closing a floating output window disables that output.
      if (o.target.type === 'window') {
        const list = getOutputs().map((x) => (x.id === o.id ? { ...x, enabled: false } : x))
        ctx.local.set('outputs', list)
        ctx.api.emit('outputs.changed', list)
      }
    }
  })
  windows.set(o.id, win)
  void ctx.loadPage(win, 'output', { outputId: o.id })
}

async function describe(req: { outputId?: ID; receiverId?: string; canvasId?: ID; regionId?: ID }): Promise<OutputDescription | null> {
  const ws = ctx.workspace.config
  const output = getOutputs().find((o) => o.id === req.outputId || (req.receiverId && o.target.type === 'network' && o.target.receiverId === req.receiverId)) ?? null
  const canvasId = output?.canvasId ?? req.canvasId ?? ws.canvases[0]?.id
  const canvas = ws.canvases.find((c) => c.id === canvasId)
  if (!canvas) return null
  let stageLayout: StageLayout | null = null
  if (canvas.kind === 'stage') {
    const layouts = await ctx.workspace.readDoc<StageLayout[]>('stageLayouts', [])
    stageLayout = layouts.find((l) => l.id === canvas.stageLayoutId) ?? layouts[0] ?? null
  }
  const virtual: Output | null = output ?? (req.canvasId ? { id: 'preview', name: 'Preview', canvasId, regionId: req.regionId, target: { type: 'window' }, enabled: true } : null)
  return { output: virtual, canvas, workspace: ws, stageLayout }
}

export default defineService({
  name: 'outputs',
  order: 10,
  setup(c) {
    ctx = c
    const { api } = ctx
    api.handle('outputs.list', () => getOutputs(), 'control')
    api.handle('outputs.save', ({ output }) => {
      const list = getOutputs()
      if (!output.id) output.id = newId()
      const i = list.findIndex((o) => o.id === output.id)
      // Changing where an output goes: rebuild its window.
      const prev = list[i]
      if (prev && JSON.stringify(prev.target) !== JSON.stringify(output.target)) {
        const w = windows.get(prev.id)
        windows.delete(prev.id)
        w?.destroy()
      }
      const next = i >= 0 ? list.map((o, j) => (j === i ? output : o)) : [...list, output]
      return setOutputs(next)
    }, 'local')
    api.handle('outputs.remove', ({ id }) => setOutputs(getOutputs().filter((o) => o.id !== id)), 'local')
    api.handle('outputs.displays', () => listDisplays(), 'control')
    api.handle('outputs.receivers', () => [], 'control')
    api.handle('outputs.describe', (req) => describe(req), 'public')
    api.handle('outputs.identify', () => {
      api.emit('outputs.identify', { on: true })
      setTimeout(() => api.emit('outputs.identify', { on: false }), 4000)
    })
    const onDisplays = (): void => {
      syncWindows()
      api.emit('outputs.displaysChanged', listDisplays())
    }
    screen.on('display-added', onDisplays)
    screen.on('display-removed', onDisplays)
    screen.on('display-metrics-changed', onDisplays)
    api.on('workspace.changed', () => api.emit('outputs.changed', getOutputs()))
    syncWindows()
  }
})
