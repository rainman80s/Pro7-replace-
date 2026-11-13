/**
 * OBS Studio via obs-websocket v5 (built into OBS 28+; Tools → WebSocket Server Settings).
 * Slide/macro actions: `obs.setScene` {scene}, `obs.request` {requestType, requestData} (start/stop stream or recording…).
 * Machine-local: each computer talks to its own OBS.
 */
import { createHash, randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import type { IntegrationStatus } from '@shared/integrations'
import { defineService } from '../../core/service'

declare module '@shared/api' {
  interface ApiMethods {
    'obs.status': { req: void; res: IntegrationStatus & { url: string; scenes: string[] } }
    'obs.connect': { req: { url: string; password?: string }; res: IntegrationStatus & { url: string; scenes: string[] } }
    'obs.disconnect': { req: void; res: void }
  }
}

export function obsAuth(password: string, salt: string, challenge: string): string {
  const secret = createHash('sha256').update(password + salt).digest('base64')
  return createHash('sha256').update(secret + challenge).digest('base64')
}

export class ObsClient {
  private ws: WebSocket | null = null
  private ready: Promise<void> | null = null
  private pending = new Map<string, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>()
  constructor(public url: string, private password: () => string | null) {}
  connect(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url, 'obswebsocket.json', { handshakeTimeout: 4000 })
      this.ws = ws
      const fail = (e: Error): void => { this.ready = null; this.ws = null; reject(e); for (const p of this.pending.values()) p.reject(e); this.pending.clear() }
      ws.on('error', (e) => fail(new Error(`Can’t reach OBS at ${this.url} — is OBS open with the WebSocket server enabled? (${e.message})`)))
      ws.on('close', (code, reason) => fail(new Error(code === 4009 ? 'OBS rejected the password.' : `OBS closed the connection (${code} ${reason})`)))
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as { op: number; d: Record<string, unknown> }
        if (msg.op === 0) {
          const auth = msg.d.authentication as { challenge: string; salt: string } | undefined
          const pw = this.password()
          if (auth && !pw) return fail(new Error('OBS needs the WebSocket server password.'))
          ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, ...(auth ? { authentication: obsAuth(pw!, auth.salt, auth.challenge) } : {}) } }))
        } else if (msg.op === 2) resolve()
        else if (msg.op === 7) {
          const id = String(msg.d.requestId)
          const p = this.pending.get(id)
          if (!p) return
          this.pending.delete(id)
          const st = msg.d.requestStatus as { result: boolean; comment?: string; code?: number }
          if (st.result) p.resolve((msg.d.responseData as Record<string, unknown>) ?? {})
          else p.reject(new Error(`OBS: ${st.comment ?? 'request failed'} (${st.code})`))
        }
      })
    })
    return this.ready
  }
  async request(requestType: string, requestData?: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.connect()
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      this.ws!.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }))
      setTimeout(() => { if (this.pending.delete(requestId)) reject(new Error('OBS didn’t answer in time')) }, 5000)
    })
  }
  close(): void { this.ws?.close(); this.ws = null; this.ready = null }
}

export default defineService({
  name: 'obs',
  setup(ctx) {
    const { api, local, live } = ctx
    let client: ObsClient | null = null
    let error = ''
    let scenes: string[] = []
    const url = (): string => local.get<string>('obs.url', '')
    const get = (): ObsClient => {
      if (!url()) throw new Error('OBS isn’t set up on this computer (Integrations → OBS).')
      if (!client || client.url !== url()) { client?.close(); client = new ObsClient(url(), () => local.getSecret('obs.password')) }
      return client
    }
    const status = () => ({ id: 'obs' as const, connected: !!url() && !error, account: url() || undefined, error: error || undefined, url: url(), scenes })
    const refresh = async (): Promise<void> => {
      try { const r = await get().request('GetSceneList'); scenes = ((r.scenes as { sceneName: string }[]) ?? []).map((s) => s.sceneName).reverse(); error = '' } catch (e) { error = (e as Error).message; client?.close(); client = null }
    }
    api.handle('obs.status', async () => { if (url() && !scenes.length) await refresh(); return status() }, 'local')
    api.handle('obs.connect', async ({ url: u, password }) => {
      local.set('obs.url', u.trim().replace(/^(?!wss?:\/\/)/, 'ws://'))
      if (password !== undefined) local.setSecret('obs.password', password || null)
      client?.close(); client = null
      await refresh()
      if (error) throw new Error(error)
      return status()
    }, 'local')
    api.handle('obs.disconnect', () => { client?.close(); client = null; local.set('obs.url', undefined); local.setSecret('obs.password', null); scenes = [] }, 'local')
    live.registerAction('obs.setScene', async (p) => { await get().request('SetCurrentProgramScene', { sceneName: String(p.scene ?? p.sceneName ?? '') }) })
    live.registerAction('obs.request', async (p) => { await get().request(String(p.requestType), (p.requestData as Record<string, unknown>) ?? undefined) })
    this.dispose = () => client?.close()
  }
})
