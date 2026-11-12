/**
 * Universal API client. Inside Electron it talks IPC through the preload bridge;
 * in a plain browser (network display, phone remote, another computer) it talks
 * WebSocket to the app's built-in server. Same code runs everywhere.
 */
import type { ApiClient, ApiEvents, EventName } from './api'

interface Bridge {
  invoke(method: string, payload: unknown): Promise<unknown>
  on(cb: (event: string, payload: unknown) => void): () => void
  mediaBase?: string
  platform?: string
}

declare global {
  interface Window {
    reachBridge?: Bridge
  }
}

type Listener = (payload: unknown) => void

function createWsClient(): ApiClient {
  const listeners = new Map<string, Set<Listener>>()
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  let seq = 1
  let ws: WebSocket | null = null
  let queue: string[] = []
  let retry = 500

  const params = new URLSearchParams(location.search)
  const token = params.get('token') ?? localStorage.getItem('reach.token') ?? ''

  const connect = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const host = params.get('server') ?? location.host
    ws = new WebSocket(`${proto}://${host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`)
    ws.onopen = () => {
      retry = 500
      for (const m of queue) ws!.send(m)
      queue = []
      listeners.get('$connected')?.forEach((l) => l(true))
    }
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.event) {
        listeners.get(msg.event)?.forEach((l) => l(msg.payload))
      } else if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id)!
        pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error))
        else p.resolve(msg.result)
      }
    }
    ws.onclose = () => {
      listeners.get('$connected')?.forEach((l) => l(false))
      for (const p of pending.values()) p.reject(new Error('Disconnected'))
      pending.clear()
      setTimeout(connect, retry)
      retry = Math.min(retry * 1.6, 5000)
    }
    ws.onerror = () => ws?.close()
  }
  connect()

  return {
    transport: 'ws',
    invoke(method: string, payload?: unknown) {
      return new Promise((resolve, reject) => {
        const id = seq++
        pending.set(id, { resolve, reject })
        const m = JSON.stringify({ id, method, payload })
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(m)
        else queue.push(m)
      })
    },
    on(event: string, cb: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(cb)
      return () => listeners.get(event)?.delete(cb)
    }
  } as ApiClient
}

function createIpcClient(bridge: Bridge): ApiClient {
  const listeners = new Map<string, Set<Listener>>()
  bridge.on((event, payload) => listeners.get(event)?.forEach((l) => l(payload)))
  return {
    transport: 'ipc',
    invoke: (method: string, payload?: unknown) => bridge.invoke(method, payload),
    on(event: string, cb: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(cb)
      return () => listeners.get(event)?.delete(cb)
    }
  } as ApiClient
}

let client: ApiClient | null = null
export function getApi(): ApiClient {
  if (!client) client = window.reachBridge ? createIpcClient(window.reachBridge) : createWsClient()
  return client
}

/** Fires with true/false as the WebSocket connects/disconnects (always true on IPC). */
export function onConnection(cb: (connected: boolean) => void): () => void {
  const api = getApi()
  if (api.transport === 'ipc') {
    cb(true)
    return () => {}
  }
  return (api.on as (e: string, cb: Listener) => () => void)('$connected', cb as Listener)
}

export type { ApiEvents, EventName }
