/**
 * Shared HTTP helper for every integration: timeouts, retries with backoff,
 * 429 + Retry-After handling, a simple per-host rate limiter and friendly errors.
 * Pure (global fetch only) so it runs under vitest without Electron.
 */

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string = '',
    /** 'auth' | 'notfound' | 'ratelimit' | 'server' | 'offline' | 'timeout' | 'other' */
    public kind: string = 'other'
  ) {
    super(message)
  }
}

export interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  /** Per-attempt timeout (ms). Default 15s. */
  timeout?: number
  /** Retries for network errors / 5xx / 429. Default 3. */
  retries?: number
  /** Return the raw Response (binary downloads). */
  raw?: boolean
  signal?: AbortSignal
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Spaces requests so we never exceed `perSecond` (Notion: 3 rps, Figma/PCO: be polite). */
export class RateLimiter {
  private next = 0
  constructor(private perSecond: number) {}
  async wait(): Promise<void> {
    const gap = 1000 / this.perSecond
    const now = Date.now()
    const at = Math.max(now, this.next)
    this.next = at + gap
    if (at > now) await sleep(at - now)
  }
  /** Push everything back (after a 429). */
  penalize(ms: number): void {
    this.next = Math.max(this.next, Date.now() + ms)
  }
}

export interface HttpClientConfig {
  /** Service name used in error messages: "Planning Center". */
  name: string
  baseUrl: string
  headers: () => Record<string, string> | Promise<Record<string, string>>
  perSecond?: number
  /** Cap for Retry-After waits (ms). Tests set this low. */
  maxRetryWait?: number
  /** Base backoff (ms). Tests set this low. */
  backoff?: number
}

export class HttpClient {
  private limiter: RateLimiter
  constructor(public cfg: HttpClientConfig) {
    this.limiter = new RateLimiter(cfg.perSecond ?? 8)
  }

  url(path: string, query?: Record<string, string | number | boolean | undefined | string[]>): string {
    const u = /^https?:/.test(path) ? new URL(path) : new URL(this.cfg.baseUrl.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path))
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined) continue
      if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, x))
      else u.searchParams.set(k, String(v))
    }
    return u.toString()
  }

  async request<T = unknown>(path: string, opts: RequestOptions & { query?: Record<string, string | number | boolean | undefined | string[]> } = {}): Promise<T> {
    const { name } = this.cfg
    const retries = opts.retries ?? 3
    const backoff = this.cfg.backoff ?? 600
    const url = this.url(path, opts.query)
    let lastErr: HttpError | null = null
    for (let attempt = 0; attempt <= retries; attempt++) {
      await this.limiter.wait()
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), opts.timeout ?? 15000)
      const onAbort = (): void => ctl.abort()
      opts.signal?.addEventListener('abort', onAbort)
      try {
        const headers: Record<string, string> = { accept: 'application/json', ...(await this.cfg.headers()), ...opts.headers }
        let body: BodyInit | undefined
        if (opts.body !== undefined) {
          if (typeof opts.body === 'string' || opts.body instanceof Uint8Array) body = opts.body as BodyInit
          else { body = JSON.stringify(opts.body); headers['content-type'] ??= 'application/json' }
        }
        const res = await fetch(url, { method: opts.method ?? 'GET', headers, body, signal: ctl.signal })
        if (res.status === 429 || res.status >= 500) {
          const ra = Number(res.headers.get('retry-after'))
          const wait = Math.min(this.cfg.maxRetryWait ?? 30000, ra > 0 ? ra * 1000 : backoff * 2 ** attempt)
          const text = await res.text().catch(() => '')
          lastErr = res.status === 429
            ? new HttpError(`${name} is rate-limiting us — try again in a moment.`, 429, text, 'ratelimit')
            : new HttpError(`${name} is having trouble right now (error ${res.status}).`, res.status, text, 'server')
          if (attempt < retries) { this.limiter.penalize(wait); await sleep(wait); continue }
          throw lastErr
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          if (res.status === 401 || res.status === 403) throw new HttpError(`${name} rejected the credentials — check them in Integrations.`, res.status, text, 'auth')
          if (res.status === 404) throw new HttpError(`${name} couldn't find that (404). It may have been deleted or not shared with this account.`, 404, text, 'notfound')
          throw new HttpError(`${name} returned an error (${res.status}).`, res.status, text, 'other')
        }
        if (opts.raw) return res as unknown as T
        if (res.status === 204) return undefined as T
        const ct = res.headers.get('content-type') ?? ''
        return (ct.includes('json') ? await res.json() : await res.text()) as T
      } catch (e) {
        if (e instanceof HttpError) throw e
        const aborted = (e as Error)?.name === 'AbortError'
        if (aborted && opts.signal?.aborted) throw new HttpError('Cancelled', 0, '', 'other')
        lastErr = aborted
          ? new HttpError(`${name} took too long to respond.`, 0, '', 'timeout')
          : new HttpError(`Can't reach ${name} — check the internet connection.`, 0, String(e), 'offline')
        if (attempt < retries) { await sleep(backoff * 2 ** attempt); continue }
        throw lastErr
      } finally {
        clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
      }
    }
    throw lastErr ?? new HttpError(`${name} request failed`, 0)
  }

  get<T = unknown>(path: string, query?: Record<string, string | number | boolean | undefined | string[]>, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...opts, query })
  }

  /** Download a URL to a Buffer (images, exports). No auth headers are sent to foreign hosts. */
  async download(url: string, opts: { timeout?: number; auth?: boolean } = {}): Promise<{ data: Buffer; contentType: string }> {
    const sameHost = url.startsWith(this.cfg.baseUrl)
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), opts.timeout ?? 60000)
    try {
      const res = await fetch(url, { headers: opts.auth ?? sameHost ? await this.cfg.headers() : {}, signal: ctl.signal })
      if (!res.ok) throw new HttpError(`Couldn't download a file from ${this.cfg.name} (${res.status}).`, res.status)
      return { data: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? '' }
    } catch (e) {
      if (e instanceof HttpError) throw e
      throw new HttpError(`Couldn't download a file from ${this.cfg.name} — check the internet connection.`, 0, String(e), 'offline')
    } finally {
      clearTimeout(timer)
    }
  }
}

export const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Small stable hash for change detection (not security). */
export function hashOf(value: unknown): string {
  const s = typeof value === 'string' ? value : JSON.stringify(value)
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}
