import { ipcMain, webContents } from 'electron'
import type { ApiEvents, EventName, MethodName, Req, Res } from '@shared/api'

export interface CallContext {
  /** 'ipc' = a window of this app (trusted). 'ws' = a network client. */
  transport: 'ipc' | 'ws' | 'internal'
  /** Network clients: has this client presented the control token/PIN? */
  authorized: boolean
  clientId?: string
  address?: string
}

type Handler<K extends MethodName> = (req: Req<K>, ctx: CallContext) => Promise<Res<K>> | Res<K>

interface Registered {
  fn: (req: unknown, ctx: CallContext) => unknown
  /** 'public' = any network client (read-only stuff outputs need). 'control' = needs the remote token. 'local' = app windows only. */
  access: 'public' | 'control' | 'local'
}

type EventSink = (event: string, payload: unknown) => void

class Api {
  private handlers = new Map<string, Registered>()
  private sinks = new Set<EventSink>()
  private localListeners = new Map<string, Set<(payload: unknown) => void>>()

  /**
   * Register an RPC method. `access` controls who may call it over the network:
   *  - 'local'   (default) only this app's own windows
   *  - 'control' network clients that hold the remote-control token (phone remote, other operator)
   *  - 'public'  any network client (what an output/stage receiver needs)
   */
  handle<K extends MethodName>(method: K, fn: Handler<K>, access: Registered['access'] = 'control'): void {
    this.handlers.set(method, { fn: fn as Registered['fn'], access })
  }

  async call(method: string, payload: unknown, ctx: CallContext): Promise<unknown> {
    const h = this.handlers.get(method)
    if (!h) throw new Error(`Unknown method: ${method}`)
    if (ctx.transport === 'ws') {
      if (h.access === 'local') throw new Error(`${method} is only available inside the app`)
      if (h.access === 'control' && !ctx.authorized) throw new Error('Not authorized — enter the remote PIN')
    }
    return h.fn(payload, ctx)
  }

  /** Call a method from inside the main process. */
  invoke<K extends MethodName>(method: K, ...args: Req<K> extends void ? [] : [Req<K>]): Promise<Res<K>> {
    return this.call(method, args[0], { transport: 'internal', authorized: true }) as Promise<Res<K>>
  }

  emit<K extends EventName>(event: K, ...args: ApiEvents[K] extends void ? [] : [ApiEvents[K]]): void {
    const payload = args[0]
    for (const wc of webContents.getAllWebContents()) {
      if (!wc.isDestroyed()) wc.send('reach:event', event, payload)
    }
    for (const s of this.sinks) s(event, payload)
    this.localListeners.get(event)?.forEach((l) => l(payload))
  }

  /** Subscribe from inside the main process. */
  on<K extends EventName>(event: K, cb: (payload: ApiEvents[K]) => void): () => void {
    if (!this.localListeners.has(event)) this.localListeners.set(event, new Set())
    this.localListeners.get(event)!.add(cb as (p: unknown) => void)
    return () => this.localListeners.get(event)?.delete(cb as (p: unknown) => void)
  }

  /** Used by the network server to forward events to WebSocket clients. */
  addSink(sink: EventSink): () => void {
    this.sinks.add(sink)
    return () => this.sinks.delete(sink)
  }

  methods(): string[] {
    return [...this.handlers.keys()].sort()
  }

  bindIpc(): void {
    ipcMain.handle('reach:invoke', async (_e, method: string, payload: unknown) => {
      return this.call(method, payload, { transport: 'ipc', authorized: true })
    })
  }
}

export const api = new Api()
export type { Api }
