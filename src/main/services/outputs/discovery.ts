/**
 * mDNS / Bonjour: advertise this app so receivers and other Reach computers can find it, and
 * look for devices that could be displays. Pure-JS (bonjour-service, MIT). Everything is best-effort:
 * many networks block multicast, so the UI always shows the plain IP address + QR code too.
 */
import { hostname } from 'node:os'
import type { DiscoveredDevice, DiscoveryState } from '@shared/outputs'

type BonjourCtor = typeof import('bonjour-service').Bonjour
interface FoundService { name: string; type: string; host?: string; port?: number; addresses?: string[]; txt?: Record<string, unknown>; fqdn?: string }

const HINTS = {
  cast: 'Chromecast / Google TV. It can’t be controlled directly (Google requires a registered, internet-hosted app). Use the TV’s own web browser — or plug a Raspberry Pi into it — and open the address shown above.',
  airplay: 'AirPlay device. On this Mac open Control Centre → Screen Mirroring, pick it, then choose “Use As Separate Display”. It will appear under “Connected to this computer” like any other screen.',
  reach: 'Another computer running Reach Presenter.'
}

export class Discovery {
  private bonjour: InstanceType<BonjourCtor> | null = null
  private browsers: { stop(): void }[] = []
  private devices = new Map<string, DiscoveredDevice>()
  private error: string | undefined
  private advertising = false
  private serviceName = ''
  private listeners = new Set<(s: DiscoveryState) => void>()
  private notifyTimer: NodeJS.Timeout | null = null

  constructor(private port: () => number, private urls: () => string[], private version: string) {}

  onChange(cb: (s: DiscoveryState) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private notify(): void {
    if (this.notifyTimer) return
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null
      const s = this.state()
      this.listeners.forEach((l) => l(s))
    }, 300)
  }

  state(): DiscoveryState {
    const host = hostname()
    const local = host.endsWith('.local') ? host : `${host}.local`
    return {
      advertising: this.advertising,
      serviceName: this.serviceName || undefined,
      hostname: local,
      // IP first: smart-TV browsers usually can't resolve .local names.
      urls: [...this.urls().map((u) => `${u}/output.html`), `http://${local}:${this.port()}/output.html`],
      devices: [...this.devices.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
      error: this.error
    }
  }

  async start(): Promise<void> {
    if (this.bonjour || process.env.REACH_NO_MDNS) return
    try {
      const mod = await import('bonjour-service')
      const Bonjour = (mod.Bonjour ?? (mod as unknown as { default: BonjourCtor }).default) as BonjourCtor
      this.bonjour = new Bonjour(undefined, (e: unknown) => { this.error = `Network discovery isn’t available here (${e instanceof Error ? e.message : String(e)}). Use the address or QR code instead.`; this.notify() })
      this.serviceName = `Reach Presenter (${hostname().replace(/\.local$/, '')})`
      const txt = { version: this.version, path: '/output.html', app: 'reach-presenter' }
      for (const type of ['reach-presenter', 'http']) {
        try {
          const svc = this.bonjour.publish({ name: this.serviceName, type, port: this.port(), txt, probe: true })
          svc.on('error', (e: unknown) => { this.error = String(e); this.notify() })
          svc.on('up', () => { this.advertising = true; this.notify() })
        } catch (e) {
          this.error = String(e)
        }
      }
      this.browse()
    } catch (e) {
      this.error = `Network discovery isn’t available here (${e instanceof Error ? e.message : String(e)}).`
    }
    this.notify()
  }

  private browse(): void {
    if (!this.bonjour) return
    const watch = (type: string, kind: DiscoveredDevice['kind']): void => {
      try {
        const b = this.bonjour!.find({ type }, (s: FoundService) => this.found(kind, s))
        b.on('down', (s: FoundService) => { this.devices.delete(`${kind}:${s.fqdn ?? s.name}`); this.notify() })
        this.browsers.push(b)
      } catch (e) {
        this.error = String(e)
      }
    }
    watch('reach-presenter', 'reach')
    watch('googlecast', 'cast')
    watch('airplay', 'airplay')
  }

  private found(kind: DiscoveredDevice['kind'], s: FoundService): void {
    if (kind === 'reach' && s.name === this.serviceName) return // that's us
    const txt = s.txt ?? {}
    const addresses = (s.addresses ?? []).filter((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a))
    const name = kind === 'cast' ? String(txt.fn ?? s.name) : s.name.replace(/^[0-9A-F]{12}@/i, '')
    const model = String(txt.md ?? txt.model ?? '') || undefined
    const hint = kind === 'reach' ? `${HINTS.reach}${addresses[0] ? ` Its screens page is http://${addresses[0]}:${s.port}/output.html` : ''}` : HINTS[kind as 'cast' | 'airplay']
    this.devices.set(`${kind}:${s.fqdn ?? s.name}`, { id: `${kind}:${s.fqdn ?? s.name}`, name, kind, host: s.host, addresses, port: s.port, model, hint })
    this.notify()
  }

  /** Re-query the network (the "Search network displays" button). */
  refresh(): void {
    for (const b of this.browsers) try { (b as unknown as { update?: () => void }).update?.() } catch { /* ignore */ }
    this.notify()
  }

  stop(): void {
    for (const b of this.browsers) try { b.stop() } catch { /* ignore */ }
    this.browsers = []
    try { this.bonjour?.unpublishAll(() => this.bonjour?.destroy()) } catch { /* ignore */ }
    this.bonjour = null
    this.advertising = false
  }
}
