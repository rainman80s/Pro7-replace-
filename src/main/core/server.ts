import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { createReadStream, promises as fs } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { networkInterfaces } from 'node:os'
import { randomInt } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import { mediaKindFromPath } from '@shared/media'
import { api, type CallContext } from './api'
import { local } from './local'
import { workspace } from './workspace'

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/opus',
  txt: 'text/plain; charset=utf-8', map: 'application/json', webmanifest: 'application/manifest+json'
}

export interface NetClient {
  id: string
  address: string
  userAgent: string
  authorized: boolean
  /** Whatever the client announced about itself (receiver id, name, screen size, role). */
  hello: Record<string, unknown>
  send(event: string, payload: unknown): void
  connectedAt: number
}

export type RouteHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => boolean | void | Promise<boolean | void>

/**
 * Built-in LAN server. It serves:
 *   /                 the same web UI the desktop app uses (operator / remote)
 *   /output.html      the output renderer — open on any TV/browser/Pi to make it a network display
 *   /media/...        media files (with HTTP range support for video)
 *   /ws               WebSocket RPC + live events
 * Features can add routes with `server.route('/api/', handler)`.
 */
class NetServer {
  port = 0
  private http: Server | null = null
  private wss: WebSocketServer | null = null
  private routes: { prefix: string; handler: RouteHandler }[] = []
  clients = new Map<string, NetClient>()
  private clientListeners = new Set<(type: 'connect' | 'disconnect' | 'hello', c: NetClient) => void>()
  rendererDir = ''
  devUrl = ''

  /** PIN that phones/other computers must present for control access. */
  get pin(): string {
    let pin = local.get('remotePin', '')
    if (!pin) {
      pin = String(randomInt(100000, 999999))
      local.set('remotePin', pin)
    }
    return pin
  }

  route(prefix: string, handler: RouteHandler): void {
    this.routes.push({ prefix, handler })
    this.routes.sort((a, b) => b.prefix.length - a.prefix.length)
  }

  onClient(cb: (type: 'connect' | 'disconnect' | 'hello', c: NetClient) => void): () => void {
    this.clientListeners.add(cb)
    return () => this.clientListeners.delete(cb)
  }

  urls(): string[] {
    const out: string[] = []
    for (const list of Object.values(networkInterfaces())) {
      for (const ni of list ?? []) if (ni.family === 'IPv4' && !ni.internal) out.push(`http://${ni.address}:${this.port}`)
    }
    return out.length ? out : [`http://127.0.0.1:${this.port}`]
  }

  get localBase(): string {
    return `http://127.0.0.1:${this.port}`
  }

  async start(rendererDir: string, devUrl?: string): Promise<void> {
    this.rendererDir = rendererDir
    this.devUrl = devUrl ?? ''
    const preferred = Number(process.env.REACH_PORT) || local.get('serverPort', 4780)
    this.http = createServer((req, res) => void this.handle(req, res))
    this.port = await listen(this.http, preferred)
    this.wss = new WebSocketServer({ server: this.http, path: '/ws' })
    this.wss.on('connection', (ws, req) => this.onSocket(ws, req))
    api.addSink((event, payload) => {
      const msg = JSON.stringify({ event, payload })
      for (const ws of this.wss!.clients) if (ws.readyState === ws.OPEN) ws.send(msg)
    })
  }

  private onSocket(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? '/', 'http://x')
    const address = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
    const isLoopback = address === '127.0.0.1' || address === '::1'
    const client: NetClient = {
      id: Math.random().toString(36).slice(2, 10),
      address,
      userAgent: String(req.headers['user-agent'] ?? ''),
      authorized: isLoopback || url.searchParams.get('token') === this.pin,
      hello: {},
      connectedAt: Date.now(),
      send: (event, payload) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ event, payload })) }
    }
    this.clients.set(client.id, client)
    this.clientListeners.forEach((l) => l('connect', client))
    ws.on('message', async (raw) => {
      let msg: { id?: number; method?: string; payload?: unknown; hello?: Record<string, unknown>; auth?: string }
      try { msg = JSON.parse(String(raw)) } catch { return }
      if (msg.auth !== undefined) {
        client.authorized = client.authorized || msg.auth === this.pin
        client.send('$auth', client.authorized)
        return
      }
      if (msg.hello) {
        client.hello = { ...client.hello, ...msg.hello }
        this.clientListeners.forEach((l) => l('hello', client))
        return
      }
      if (!msg.method) return
      const ctx: CallContext = { transport: 'ws', authorized: client.authorized, clientId: client.id, address }
      try {
        const result = await api.call(msg.method, msg.payload, ctx)
        ws.send(JSON.stringify({ id: msg.id, result: result ?? null }))
      } catch (e) {
        ws.send(JSON.stringify({ id: msg.id, error: e instanceof Error ? e.message : String(e) }))
      }
    })
    ws.on('close', () => {
      this.clients.delete(client.id)
      this.clientListeners.forEach((l) => l('disconnect', client))
    })
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      res.setHeader('Access-Control-Allow-Origin', '*')
      for (const r of this.routes) {
        if (url.pathname.startsWith(r.prefix)) {
          const handled = await r.handler(req, res, url)
          if (handled !== false) return
        }
      }
      if (url.pathname.startsWith('/media/')) return void (await this.serveMedia(req, res, url))
      if (this.devUrl) return void (await this.proxyDev(req, res, url))
      let rel = decodeURIComponent(url.pathname)
      if (rel === '/' || rel === '') rel = '/index.html'
      const file = normalize(join(this.rendererDir, rel))
      if (!file.startsWith(resolve(this.rendererDir) + sep)) return void send(res, 403, 'Forbidden')
      await serveFile(req, res, file)
    } catch (e) {
      if (!res.headersSent) send(res, 500, String(e))
    }
  }

  private async serveMedia(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const parts = url.pathname.split('/').slice(2)
    const scope = parts.shift()
    let file: string
    if (scope === 'w') {
      file = normalize(join(workspace.mediaDir, ...parts.map(decodeURIComponent)))
      if (!file.startsWith(resolve(workspace.mediaDir) + sep)) return send(res, 403, 'Forbidden')
    } else if (scope === 'f') {
      file = normalize(decodeURIComponent(parts.join('/')))
      // Absolute paths are only served for real media file types.
      if (!mediaKindFromPath(file)) return send(res, 403, 'Forbidden')
    } else return send(res, 404, 'Not found')
    await serveFile(req, res, file, 'public, max-age=3600')
  }

  private async proxyDev(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const r = await fetch(this.devUrl.replace(/\/$/, '') + url.pathname + url.search)
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/octet-stream' })
    res.end(Buffer.from(await r.arrayBuffer()))
  }

  stop(): void {
    this.wss?.close()
    this.http?.close()
  }
}

function listen(server: Server, port: number, tries = 20): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const attempt = (p: number, left: number): void => {
      server.once('error', (e: NodeJS.ErrnoException) => {
        if (e.code === 'EADDRINUSE' && left > 0) attempt(p + 1, left - 1)
        else reject(e)
      })
      server.listen(p, '0.0.0.0', () => {
        server.removeAllListeners('error')
        resolvePort(p)
      })
    }
    attempt(port, tries)
  })
}

export function send(res: ServerResponse, status: number, body: string | object, headers: Record<string, string> = {}): void {
  const isObj = typeof body !== 'string'
  res.writeHead(status, { 'content-type': isObj ? 'application/json' : 'text/plain; charset=utf-8', ...headers })
  res.end(isObj ? JSON.stringify(body) : body)
}

export async function readBody(req: IncomingMessage, limit = 20 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > limit) throw new Error('Body too large')
    chunks.push(c as Buffer)
  }
  return Buffer.concat(chunks)
}

/** Static file with HTTP Range support (needed for video seeking). */
export async function serveFile(req: IncomingMessage, res: ServerResponse, file: string, cache = 'no-cache'): Promise<void> {
  let stat
  try {
    stat = await fs.stat(file)
    if (!stat.isFile()) throw new Error('not a file')
  } catch {
    return send(res, 404, 'Not found')
  }
  const type = MIME[extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream'
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
  if (range) {
    let start = range[1] ? parseInt(range[1], 10) : 0
    let end = range[2] ? parseInt(range[2], 10) : stat.size - 1
    if (!range[1] && range[2]) { start = Math.max(0, stat.size - parseInt(range[2], 10)); end = stat.size - 1 }
    end = Math.min(end, stat.size - 1)
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'content-range': `bytes */${stat.size}` })
      return void res.end()
    }
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1, 'cache-control': cache })
    if (req.method === 'HEAD') return void res.end()
    createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'accept-ranges': 'bytes', 'cache-control': cache })
  if (req.method === 'HEAD') return void res.end()
  createReadStream(file).pipe(res)
}

export const server = new NetServer()
