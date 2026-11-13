import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { hostname } from 'node:os'
import { api } from './core/api'
import { local } from './core/local'
import { workspace, registerWorkspaceApi } from './core/workspace'
import { library, registerLibraryApi } from './core/library'
import { live, registerLiveApi } from './core/live'
import { server } from './core/server'
import type { Service, ServiceContext } from './core/service'
import { seedIfEmpty } from './core/seed'

if (process.env.REACH_USER_DATA) app.setPath('userData', process.env.REACH_USER_DATA)
// Outputs must keep animating/playing video when not focused or occluded.
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

let mainWindow: BrowserWindow | null = null
const services: Service[] = []

async function loadPage(win: BrowserWindow, page: 'index' | 'output', query: Record<string, string> = {}): Promise<void> {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) {
    const qs = new URLSearchParams(query).toString()
    await win.loadURL(`${dev}/${page}.html${qs ? `?${qs}` : ''}`)
  } else {
    await win.loadFile(join(__dirname, `../renderer/${page}.html`), { query })
  }
}

function createMainWindow(): void {
  const bounds = local.get<{ width: number; height: number; x?: number; y?: number }>('mainWindow', { width: 1480, height: 920 })
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Reach Presenter',
    backgroundColor: '#1f1f1f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, backgroundThrottling: false }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', () => { if (mainWindow) local.set('mainWindow', mainWindow.getBounds()) })
  mainWindow.on('closed', () => { mainWindow = null; if (process.platform !== 'darwin') app.quit() })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
  void loadPage(mainWindow, 'index')
}

function registerSystemApi(): void {
  api.handle('system.info', () => ({
    version: app.getVersion(), platform: process.platform, hostname: hostname(),
    workspacePath: workspace.root, serverUrls: server.urls(), serverPort: server.port
  }), 'public')
  api.handle('system.openPath', async ({ path }) => { await shell.openPath(path) }, 'local')
  api.handle('system.pickFiles', async ({ title, filters, multi, directory }) => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      title, filters,
      properties: [directory ? 'openDirectory' : 'openFile', ...(multi ? (['multiSelections'] as const) : [])]
    })
    return r.canceled ? [] : r.filePaths
  }, 'local')
  api.handle('system.pickSave', async ({ title, defaultPath, filters }) => {
    const r = await dialog.showSaveDialog(mainWindow!, { title, defaultPath, filters })
    return r.canceled ? null : (r.filePath ?? null)
  }, 'local')
}

async function boot(): Promise<void> {
  local.init()
  await workspace.init()
  const t0 = Date.now()
  await library.init()
  console.log(`[library] init ${Date.now() - t0}ms, ${library.summaries().length} presentations listed`)
  api.bindIpc()
  registerSystemApi()
  registerWorkspaceApi()
  registerLibraryApi()
  registerLiveApi()
  await seedIfEmpty()

  await server.start(join(__dirname, '../renderer'), process.env.ELECTRON_RENDERER_URL)
  ipcMain.on('reach:mediaBase', (e) => { e.returnValue = server.localBase })

  const ctx: ServiceContext = { api, live, library, workspace, local, server, loadPage, mainWindow: () => mainWindow }
  const mods = import.meta.glob<{ default: Service }>('./services/*/index.ts', { eager: true })
  for (const m of Object.values(mods)) if (m.default) services.push(m.default)
  services.sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
  for (const s of services) {
    try {
      await s.setup(ctx)
      console.log(`[service] ${s.name} ready`)
    } catch (e) {
      console.error(`[service] ${s.name} failed to start`, e)
    }
  }

  if (!process.env.REACH_HEADLESS) createMainWindow()
  console.log(`[reach] ready — workspace ${workspace.root} — server ${server.urls().join(', ')} — pin ${server.pin}`)
}

const gotLock = process.env.REACH_USER_DATA ? true : app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else {
  app.on('second-instance', () => { mainWindow?.show(); mainWindow?.focus() })
  void app.whenReady().then(boot)
  app.on('activate', () => { if (!mainWindow && app.isReady()) createMainWindow() })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('before-quit', async () => {
    for (const s of services) await s.dispose?.()
    server.stop()
    workspace.close()
  })
}
