/**
 * Remote surfaces: the phone/tablet remote page (/remote), the REST API (/api/v1/), the ProPresenter-compatible
 * shim (/v1/, /version) and an optional OSC listener. See docs/control/api.md.
 */
import { createSocket, type Socket } from 'node:dgram'
import { join } from 'node:path'
import { hostname, release } from 'node:os'
import { randomInt } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { app } from 'electron'
import type { RemoteSettings } from '@shared/control'
import { defineService } from '../../core/service'
import { api } from '../../core/api'
import { live } from '../../core/live'
import { local } from '../../core/local'
import { readBody, send, serveFile, server } from '../../core/server'
import { announceRun } from '../macros/lib'
import { runMacro } from '../macros'
import { compatApi, reachApi, type RestDeps } from './rest'
import { decodeOsc, oscToAction } from './osc'

let osc: Socket | null = null

function settings(): RemoteSettings {
  return {
    pin: server.pin, urls: server.urls(), port: server.port,
    compat: local.get<RemoteSettings['compat']>('remote.compat', 'pin'),
    oscPort: local.get<number>('remote.oscPort', 0)
  }
}

function isAuthorized(req: IncomingMessage, url: URL): boolean {
  const addr = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
  if (addr === '127.0.0.1' || addr === '::1') return true
  const pin = server.pin
  const auth = String(req.headers.authorization ?? '')
  return url.searchParams.get('token') === pin || auth === `Bearer ${pin}` || String(req.headers['x-reach-pin'] ?? '') === pin
}

const deps: RestDeps = {
  call: (method, payload) => api.call(method, payload, { transport: 'internal', authorized: true }),
  rpc: (method, payload) => api.call(method, payload, { transport: 'ws', authorized: true }),
  live: () => live.state,
  info: { version: app.getVersion(), platform: process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform, osVersion: release(), host: hostname() }
}

async function respond(req: IncomingMessage, res: ServerResponse, url: URL, handler: typeof reachApi, needAuth: boolean): Promise<boolean> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, x-reach-pin' })
    res.end()
    return true
  }
  if (needAuth && !isAuthorized(req, url)) {
    send(res, 401, { error: 'Enter the remote PIN: add ?token=<PIN> or the header "Authorization: Bearer <PIN>". The PIN is in Settings → Remote & API.' }, { 'www-authenticate': 'Bearer' })
    return true
  }
  let body: unknown
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const raw = (await readBody(req, 1024 * 1024)).toString('utf8')
    if (raw.trim()) { try { body = JSON.parse(raw) } catch { body = raw } }
  }
  const out = await handler({ method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, body }, deps)
  if (!out) { send(res, 404, { error: 'Not found' }); return true }
  if (out.status === 204 || out.body === undefined) { res.writeHead(out.status); res.end(); return true }
  send(res, out.status, JSON.stringify(out.body), { 'content-type': 'application/json' })
  return true
}

function startOsc(port: number): void {
  osc?.close()
  osc = null
  if (!port) return
  const sock = createSocket('udp4')
  sock.on('message', (buf) => {
    for (const m of decodeOsc(new Uint8Array(buf))) {
      const a = oscToAction(m)
      if (!a) continue
      announceRun('OSC', m.address)
      if ('macro' in a) void runMacro({ id: a.macro }, 'OSC').catch(() => {})
      else void live.runAction({ id: 'osc', type: a.type, params: a.params })
    }
  })
  sock.on('error', (e) => { api.emit('ui.notify', { level: 'error', title: `OSC can't listen on port ${port}`, detail: e.message }); sock.close(); if (osc === sock) osc = null })
  sock.bind(port)
  osc = sock
}

export default defineService({
  name: 'remote',
  order: 70,
  setup() {
    server.route('/remote', async (req, res, url) => {
      if (url.pathname !== '/remote' && url.pathname !== '/remote/') return false
      if (server.devUrl) {
        const r = await fetch(server.devUrl.replace(/\/$/, '') + '/remote.html')
        res.writeHead(r.status, { 'content-type': 'text/html; charset=utf-8' })
        res.end(Buffer.from(await r.arrayBuffer()))
        return true
      }
      await serveFile(req, res, join(server.rendererDir, 'remote.html'))
      return true
    })
    server.route('/api/v1/', (req, res, url) => respond(req, res, url, reachApi, true))
    const compat = (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> | boolean => {
      const mode = settings().compat
      if (mode === 'off') return false
      if (url.pathname === '/version' || url.pathname.startsWith('/v1/')) return respond(req, res, url, compatApi, mode === 'pin')
      return false
    }
    server.route('/v1/', compat)
    server.route('/version', compat)

    api.handle('remote.settings', () => settings(), 'local')
    api.handle('remote.configure', ({ compat: c, oscPort, newPin }) => {
      if (c) local.set('remote.compat', c)
      if (oscPort !== undefined) { local.set('remote.oscPort', oscPort); startOsc(oscPort) }
      if (newPin) local.set('remotePin', typeof newPin === 'string' && /^\d{4,8}$/.test(newPin) ? newPin : String(randomInt(100000, 999999)))
      return settings()
    }, 'local')
    api.handle('remote.hello', () => ({ ok: true as const, name: hostname() }), 'control')
    startOsc(settings().oscPort)
  },
  dispose() { osc?.close() }
})
