/**
 * Network receiver registry — PURE (no Electron) so it can be unit-tested.
 *
 * A receiver is any browser/TV/Pi that opened output.html without an outputId. It introduces
 * itself with a persistent receiverId; we remember it (name, last size, last seen) per machine,
 * so a TV that reboots shows up as the same display and its output assignment still applies.
 */
import type { ReceiverInfo } from '@shared/api'
import type { ReceiverHello } from '@shared/outputs'

export interface SavedReceiver {
  id: string
  name: string
  address?: string
  userAgent?: string
  width?: number
  height?: number
  pixelRatio?: number
  firstSeen: number
  lastSeen: number
  /** True once the user renamed it (we stop auto-naming). */
  named?: boolean
}

export interface ReceiverPersistence {
  load(): SavedReceiver[]
  save(list: SavedReceiver[]): void
}

interface LiveConn { clientId: string; address: string; hello: ReceiverHello; at: number }

/** A short human name from a user agent: "Fire TV", "Raspberry Pi", "iPad"… */
export function deviceNameFromUA(ua = ''): string {
  const tests: [RegExp, string][] = [
    [/AFT[A-Z0-9]+|Fire TV|Silk/i, 'Fire TV'], [/Tizen/i, 'Samsung TV'], [/Web0S|webOS/i, 'LG TV'], [/CrKey/i, 'Chromecast'],
    [/Android TV|GoogleTV|BRAVIA/i, 'Android TV'], [/AppleTV/i, 'Apple TV'], [/Raspbian|armv[67]l|aarch64.*Linux|Linux arm/i, 'Raspberry Pi'],
    [/iPad/i, 'iPad'], [/iPhone/i, 'iPhone'], [/Android/i, 'Android device'], [/OBS\//i, 'OBS'], [/CrOS/i, 'Chromebook'],
    [/Macintosh/i, 'Mac'], [/Windows/i, 'Windows PC'], [/Linux/i, 'Linux computer']
  ]
  for (const [re, name] of tests) if (re.test(ua)) return name
  return 'Network display'
}

export class ReceiverRegistry {
  private saved = new Map<string, SavedReceiver>()
  private conns = new Map<string, LiveConn>() // by clientId
  private listeners = new Set<() => void>()
  /** Heartbeats update lastSeen in memory; we only write to disk at most this often. */
  private lastPersist = 0

  constructor(private persistence: ReceiverPersistence, private now: () => number = Date.now) {
    for (const r of persistence.load()) if (r?.id) this.saved.set(r.id, r)
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  private changed(persist: boolean): void {
    if (persist) {
      this.lastPersist = this.now()
      this.persistence.save([...this.saved.values()])
    }
    this.listeners.forEach((l) => l())
  }

  private uniqueName(base: string, selfId: string): string {
    const taken = new Set([...this.saved.values()].filter((r) => r.id !== selfId).map((r) => r.name))
    if (!taken.has(base)) return base
    for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`
  }

  /** A receiver page said hello (first contact or heartbeat). Returns its record. */
  hello(clientId: string, hello: ReceiverHello, address: string, userAgent = ''): SavedReceiver {
    const id = String(hello.receiverId || '').slice(0, 64)
    if (!id) throw new Error('receiverId required')
    const t = this.now()
    const existing = this.saved.get(id)
    const wasOnline = this.isOnline(id)
    const hadConn = this.conns.has(clientId)
    this.conns.set(clientId, { clientId, address, hello, at: t })
    const asked = hello.name?.trim().slice(0, 60)
    const rec: SavedReceiver = existing
      ? { ...existing }
      : { id, name: this.uniqueName(asked || deviceNameFromUA(userAgent), id), firstSeen: t, lastSeen: t }
    // A name in the URL (?name=Lobby%20Left) wins until the user renames it in the app.
    if (existing && asked && !existing.named && asked !== existing.name) rec.name = this.uniqueName(asked, id)
    rec.address = address
    rec.userAgent = userAgent || rec.userAgent
    if (hello.width) rec.width = hello.width
    if (hello.height) rec.height = hello.height
    if (hello.pixelRatio) rec.pixelRatio = hello.pixelRatio
    rec.lastSeen = t
    const meaningful = !existing || !wasOnline || !hadConn || existing.name !== rec.name || existing.width !== rec.width || existing.height !== rec.height || existing.address !== rec.address
    this.saved.set(id, rec)
    if (meaningful) this.changed(true)
    else if (t - this.lastPersist > 60_000) this.changed(true)
    return rec
  }

  /** The socket behind a connection closed. */
  disconnect(clientId: string): void {
    const c = this.conns.get(clientId)
    if (!c) return
    this.conns.delete(clientId)
    const rec = this.saved.get(c.hello.receiverId)
    if (rec) rec.lastSeen = this.now()
    this.changed(true)
  }

  isOnline(id: string): boolean {
    for (const c of this.conns.values()) if (c.hello.receiverId === id) return true
    return false
  }

  /** clientIds of the open connections for a receiver. */
  clientsOf(id: string): string[] {
    return [...this.conns.values()].filter((c) => c.hello.receiverId === id).map((c) => c.clientId)
  }

  receiverOfClient(clientId: string): string | undefined {
    return this.conns.get(clientId)?.hello.receiverId
  }

  get(id: string): SavedReceiver | undefined {
    return this.saved.get(id)
  }

  rename(id: string, name: string): void {
    const r = this.saved.get(id)
    const n = name.trim().slice(0, 60)
    if (!r || !n) return
    this.saved.set(id, { ...r, name: n, named: true })
    this.changed(true)
  }

  /** Forget an offline receiver (online ones would just re-register). */
  forget(id: string): boolean {
    if (!this.saved.has(id)) return false
    this.saved.delete(id)
    for (const [cid, c] of this.conns) if (c.hello.receiverId === id) this.conns.delete(cid)
    this.changed(true)
    return true
  }

  /** Public view, online first then most recently seen. `outputIdOf` links a receiver to its output. */
  list(outputIdOf: (receiverId: string) => string | undefined = () => undefined): ReceiverInfo[] {
    const out: ReceiverInfo[] = []
    for (const r of this.saved.values()) {
      const conns = [...this.conns.values()].filter((c) => c.hello.receiverId === r.id)
      const latest = conns.sort((a, b) => b.at - a.at)[0]
      out.push({
        id: r.id, name: r.name, address: r.address ?? '', userAgent: r.userAgent, connected: conns.length > 0,
        width: r.width, height: r.height, pixelRatio: r.pixelRatio, outputId: outputIdOf(r.id), lastSeen: conns.length ? this.now() : r.lastSeen,
        firstSeen: r.firstSeen, connections: conns.length, rttMs: latest?.hello.rttMs, clockOffsetMs: latest?.hello.clockOffsetMs, rev: latest?.hello.rev, role: latest?.hello.role
      })
    }
    return out.sort((a, b) => Number(b.connected) - Number(a.connected) || b.lastSeen - a.lastSeen || a.name.localeCompare(b.name))
  }
}
