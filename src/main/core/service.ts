import type { BrowserWindow } from 'electron'
import type { Api } from './api'
import type { live } from './live'
import type { library } from './library'
import type { workspace } from './workspace'
import type { local } from './local'
import type { server } from './server'

export interface ServiceContext {
  api: Api
  live: typeof live
  library: typeof library
  workspace: typeof workspace
  local: typeof local
  server: typeof server
  /** Load one of the renderer pages ('index' | 'output') into a window, in dev or production. */
  loadPage(win: BrowserWindow, page: 'index' | 'output', query?: Record<string, string>): Promise<void>
  /** The operator window (may be null briefly at startup / in headless tests). */
  mainWindow(): BrowserWindow | null
}

export interface Service {
  name: string
  /** Lower runs first. Default 100. */
  order?: number
  setup(ctx: ServiceContext): void | Promise<void>
  dispose?(): void | Promise<void>
}

/**
 * A main-process feature module. Drop a folder in src/main/services/<name>/index.ts
 * that default-exports defineService({...}) and it is loaded automatically.
 */
export const defineService = (s: Service): Service => s
