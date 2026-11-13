import { app } from 'electron'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import type { CloudStatus, HistoryEntry, SyncConflict, SyncPeer } from '@shared/integrations'
import type { ID } from '@shared/model'
import { defineService, type ServiceContext } from '../../core/service'
import { createSyncHost } from './host'
import { HttpRemote, SyncEngine } from './engine'
import { detectProvider, findConflictCopies, isSyncthing, resolveConflictCopy } from './folder'
import { HISTORY_DIR, listHistory, restoreHistory, snapshot } from './history'
import { scan } from './manifest'

declare module '@shared/api' {
  interface ApiMethods {
    'cloud.status': { req: void; res: CloudStatus }
    'cloud.host': { req: { enabled: boolean }; res: CloudStatus }
    'cloud.join': { req: { url: string; pin: string; replace?: boolean }; res: CloudStatus }
    'cloud.leave': { req: void; res: CloudStatus }
    'cloud.syncNow': { req: void; res: CloudStatus }
    'cloud.discover': { req: void; res: { name: string; url: string }[] }
    'cloud.moveWorkspace': { req: { target: string; mode: 'copy' | 'use' }; res: { restartRequired: boolean; provider: CloudStatus['provider'] } }
    'cloud.dismissConflict': { req: { id: string }; res: CloudStatus }
    'cloud.setEditing': { req: { ids: ID[] }; res: SyncPeer[] }
    'history.list': { req: { presentationId?: ID; path?: string }; res: HistoryEntry[] }
    'history.restore': { req: { presentationId?: ID; path?: string; id: string }; res: void }
    'history.snapshot': { req: { presentationId: ID; reason?: string }; res: void }
  }
  interface ApiEvents { 'cloud.changed': CloudStatus }
}

export default defineService({
  name: 'sync',
  order: 20,
  async setup(ctx: ServiceContext) {
    const { api, local, workspace, library, server } = ctx
    const machineId = local.get<string>('machineId', '') || (() => { const id = randomBytes(6).toString('hex'); local.set('machineId', id); return id })()
    const machineName = (): string => process.env.REACH_MACHINE_NAME || local.get<string>('machineName', '') || hostname().replace(/\.local$/, '')
    let mode: CloudStatus['mode'] = (local.get<string>('cloud.mode', '') as CloudStatus['mode']) || 'local'
    if (process.env.REACH_SYNC_HOST === '1') mode = 'host'
    const peers = new Map<string, SyncPeer>()
    let editing: ID[] = []
    let remotePeers: SyncPeer[] = []
    let health: CloudStatus['health'] = 'ok'
    let message = ''
    let lastSync = local.get<string>('cloud.lastSync', '')
    let pending = 0
    let progress: CloudStatus['progress']
    let placeholders: string[] = []
    let conflicts = local.get<SyncConflict[]>('cloud.conflicts', [])
    let provider: CloudStatus['provider'] = detectProvider(workspace.root)
    if (!provider && (await isSyncthing(workspace.root))) provider = 'syncthing'

    const self = (): SyncPeer => ({ id: machineId, name: machineName(), onAir: !!(ctx.live.state.slide || ctx.live.state.background || ctx.live.state.video), editing, lastSeen: Date.now(), version: app.getVersion() })
    const status = (): CloudStatus => ({
      mode, workspacePath: workspace.root, provider, health, message, lastSync: lastSync || undefined, pending, conflicts: conflicts.filter((c) => !c.resolved).slice(-30), placeholders,
      peers: mode === 'host' ? [{ ...self(), host: true }, ...[...peers.values()].filter((p) => Date.now() - p.lastSeen < 45_000)] : mode === 'replica' ? remotePeers : [self()],
      hostUrl: mode === 'replica' ? local.get<string>('cloud.hostUrl', '') : mode === 'host' ? server.urls()[0] : undefined,
      machineName: machineName(), machineId, progress
    })
    const changed = (): void => api.emit('cloud.changed', status())
    const addConflicts = (list: SyncConflict[]): void => {
      if (!list.length) return
      conflicts = [...conflicts, ...list].slice(-100)
      local.set('cloud.conflicts', conflicts)
      for (const c of list) api.emit('ui.notify', { level: 'warning', title: 'Edited on two computers', detail: `${c.path}: ${c.reason}` })
    }

    /* ── host ── */
    const hostHandler = createSyncHost({
      root: () => workspace.root, pin: () => server.pin, name: () => machineName(), enabled: () => mode === 'host', peers, self,
      onChange: () => { lastSync = new Date().toISOString(); changed() }
    })
    server.route('/sync/', (req, res, url) => hostHandler(req, res, url))
    let bonjour: { publish: (o: unknown) => unknown; find: (o: unknown, cb: (s: { name: string; port: number; addresses?: string[]; host?: string }) => void) => { stop(): void }; unpublishAll: () => void; destroy: () => void } | null = null
    const publish = async (): Promise<void> => {
      try {
        const { Bonjour } = await import('bonjour-service')
        bonjour ??= new Bonjour() as never
        bonjour!.unpublishAll()
        if (mode === 'host') bonjour!.publish({ name: `Reach — ${machineName()}`, type: 'reach-sync', port: server.port })
      } catch (e) { console.warn('[sync] bonjour unavailable', e) }
    }
    if (mode === 'host') void publish()

    /* ── replica ── */
    let engine: SyncEngine | null = null
    let timer: NodeJS.Timeout | null = null
    let failures = 0
    let presenceAt = 0
    const remote = (): HttpRemote => new HttpRemote(local.get<string>('cloud.hostUrl', ''), () => local.getSecret('cloud.hostPin') ?? '')
    const startReplica = async (): Promise<void> => {
      engine = new SyncEngine(remote(), {
        root: workspace.root, statePath: join(app.getPath('userData'), 'sync-state.json'), deviceName: machineName(),
        onProgress: (p) => { progress = p; if (p.done % 10 === 0) changed() },
        onFileChanged: () => {}
      })
      await engine.load()
      loop(500)
    }
    const loop = (ms: number): void => { if (timer) clearTimeout(timer); timer = setTimeout(() => void tick(), ms) }
    async function tick(): Promise<void> {
      if (mode !== 'replica' || !engine) return
      try {
        if (!engine.running) {
          const r = await engine.syncOnce()
          progress = undefined
          pending = r.pending
          addConflicts(r.conflicts)
          const n = r.downloaded.length + r.uploaded.length + r.deletedLocal.length + r.deletedRemote.length
          if (n || r.conflicts.length) lastSync = new Date().toISOString()
          if (!lastSync) lastSync = new Date().toISOString()
          if ([...r.downloaded, ...r.deletedLocal].some((p) => p.startsWith('bibles/'))) api.emit('bible.changed')
          if (n) { local.set('cloud.lastSync', lastSync); await library.loadAll(); api.emit('library.changed', {}); api.emit('playlists.changed', {}); api.emit('media.changed') }
          health = pending ? 'syncing' : 'ok'
          message = n ? `Synced ${n} file${n > 1 ? 's' : ''}` : 'Up to date'
          failures = 0
        }
        if (Date.now() - presenceAt > 8000) {
          presenceAt = Date.now()
          const r = await fetch(local.get<string>('cloud.hostUrl', '') + '/sync/presence', { method: 'POST', headers: { 'x-reach-pin': local.getSecret('cloud.hostPin') ?? '', 'content-type': 'application/json' }, body: JSON.stringify(self()), signal: AbortSignal.timeout(8000) })
          if (r.ok) remotePeers = ((await r.json()) as { peers: SyncPeer[] }).peers
        }
      } catch (e) {
        failures++
        health = 'offline'
        message = `${e instanceof Error ? e.message : String(e)} — working from this computer’s copy; will catch up automatically.`
        pending = await engine.pending().catch(() => pending)
      }
      changed()
      loop(failures ? Math.min(60_000, 2000 * 2 ** failures) : 3000)
    }
    if (mode === 'replica' && local.get<string>('cloud.hostUrl', '')) void startReplica()

    /* ── cloud folder health (iCloud / Dropbox / …) ── */
    async function folderCheck(): Promise<void> {
      if (mode === 'replica') return
      try {
        const copies = await findConflictCopies(workspace.root)
        const resolved: SyncConflict[] = []
        for (const c of copies) resolved.push(await resolveConflictCopy(workspace.root, c))
        addConflicts(resolved.filter((r) => r.winner !== 'original' || r.backup))
        if (resolved.length) { await library.loadAll(); api.emit('library.changed', {}); api.emit('playlists.changed', {}) }
        const ph: string[] = []
        await scan(workspace.root, new Map(), { onPlaceholder: (p) => ph.push(p) })
        placeholders = ph.slice(0, 50)
        if (mode !== 'host') {
          health = placeholders.length ? 'warning' : 'ok'
          message = placeholders.length ? `${placeholders.length} file(s) are still downloading from ${provider ?? 'the cloud'} — keep this computer online (or choose “Always keep on this device”).` : provider ? `Workspace is in ${PROVIDER[provider]}.` : 'Workspace is on this computer only.'
        }
        changed()
      } catch (e) { console.warn('[sync] folder check', e) }
    }
    const folderTimer = setInterval(() => void folderCheck(), 30_000)
    setTimeout(() => void folderCheck(), 3000)

    /* ── version history ── */
    const relFor = (req: { presentationId?: ID; path?: string }): string => {
      if (req.presentationId) return `library/${req.presentationId}.reach`
      if (req.path && !req.path.includes('..') && !req.path.startsWith(HISTORY_DIR)) return req.path
      throw new Error('Nothing to look up')
    }
    api.on('library.changed', ({ ids }) => { for (const id of ids ?? []) void snapshot(workspace.root, `library/${id}.reach`, 'edit', { minGapMs: 120_000, keep: 60 }).catch(() => {}) })
    api.handle('history.list', (req) => listHistory(workspace.root, relFor(req)), 'local')
    api.handle('history.snapshot', async ({ presentationId, reason }) => { await snapshot(workspace.root, `library/${presentationId}.reach`, reason ?? 'manual') }, 'local')
    api.handle('history.restore', async (req) => {
      await restoreHistory(workspace.root, relFor(req), req.id)
      await library.loadAll()
      api.emit('library.changed', { ids: req.presentationId ? [req.presentationId] : undefined })
      api.emit('playlists.changed', {})
    }, 'local')

    /* ── RPC ── */
    api.handle('cloud.status', () => status(), 'local')
    api.handle('cloud.host', async ({ enabled }) => {
      if (mode === 'replica' && enabled) throw new Error('This computer is following another one. Choose “Stop syncing” first.')
      mode = enabled ? 'host' : 'local'
      local.set('cloud.mode', mode)
      await publish()
      changed()
      return status()
    }, 'local')
    api.handle('cloud.join', async ({ url, pin, replace }) => {
      const clean = url.trim().replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'http://')
      const hello = await new HttpRemote(clean, () => pin.trim()).hello()
      if (replace !== false) {
        // Keep whatever was here (sample content, old work) — nothing is deleted.
        const keep = join(workspace.root, HISTORY_DIR, `before-join-${new Date().toISOString().replace(/[:.]/g, '-')}`)
        await fs.mkdir(keep, { recursive: true })
        // Move contents, not the folders themselves, so the app's file watchers keep working.
        for (const f of await fs.readdir(workspace.root, { withFileTypes: true })) {
          if (f.name.startsWith('.')) continue
          if (f.isDirectory()) {
            await fs.mkdir(join(keep, f.name), { recursive: true })
            for (const g of await fs.readdir(join(workspace.root, f.name))) await fs.rename(join(workspace.root, f.name, g), join(keep, f.name, g))
          } else await fs.rename(join(workspace.root, f.name), join(keep, f.name))
        }
        await fs.rm(join(app.getPath('userData'), 'sync-state.json'), { force: true })
        await fs.mkdir(workspace.libraryDir, { recursive: true }); await fs.mkdir(workspace.playlistsDir, { recursive: true }); await fs.mkdir(workspace.mediaDir, { recursive: true }); await fs.mkdir(workspace.docsDir, { recursive: true })
      }
      local.set('cloud.hostUrl', clean)
      local.setSecret('cloud.hostPin', pin.trim())
      local.set('cloud.hostName', hello.name)
      mode = 'replica'
      local.set('cloud.mode', mode)
      message = `Joining ${hello.name}…`
      health = 'syncing'
      await startReplica()
      changed()
      return status()
    }, 'local')
    api.handle('cloud.leave', () => {
      if (timer) clearTimeout(timer)
      engine = null
      mode = 'local'
      local.set('cloud.mode', mode)
      health = 'ok'; message = 'Not syncing — this computer keeps its own copy.'
      changed()
      return status()
    }, 'local')
    api.handle('cloud.syncNow', async () => { if (mode === 'replica') { failures = 0; await tick() } else await folderCheck(); return status() }, 'local')
    api.handle('cloud.dismissConflict', ({ id }) => { conflicts = conflicts.map((c) => (c.id === id ? { ...c, resolved: true } : c)); local.set('cloud.conflicts', conflicts); changed(); return status() }, 'local')
    api.handle('cloud.setEditing', async ({ ids }) => {
      editing = ids
      presenceAt = 0
      const others = status().peers.filter((p) => p.id !== machineId)
      return others.filter((p) => p.editing.some((x) => ids.includes(x)))
    }, 'local')
    api.handle('cloud.discover', async () => {
      try {
        const { Bonjour } = await import('bonjour-service')
        bonjour ??= new Bonjour() as never
        const found: { name: string; url: string }[] = []
        const b = bonjour!.find({ type: 'reach-sync' }, (s) => { const addr = s.addresses?.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ?? s.host; if (addr) found.push({ name: s.name, url: `http://${addr}:${s.port}` }) })
        await new Promise((r) => setTimeout(r, 2500))
        b.stop()
        return found.filter((f, i) => found.findIndex((x) => x.url === f.url) === i && !server.urls().includes(f.url))
      } catch { return [] }
    }, 'local')
    api.handle('cloud.moveWorkspace', async ({ target, mode: how }) => {
      if (!target) throw new Error('Choose a folder')
      const exists = await fs.stat(join(target, 'workspace.json')).then(() => true, () => false)
      if (how === 'copy') {
        if (exists) throw new Error('That folder already has a Reach workspace — choose “Use it” instead.')
        await fs.mkdir(target, { recursive: true })
        await fs.cp(workspace.root, target, { recursive: true, filter: (src) => !/[\\/]\.sync-(partial|uploads)/.test(src) })
      } else if (!exists) throw new Error('No Reach workspace in that folder.')
      local.set('workspacePath', target)
      if (!process.env.REACH_WORKSPACE) setTimeout(() => { app.relaunch(); app.exit(0) }, 600)
      return { restartRequired: true, provider: detectProvider(target) }
    }, 'local')

    this.dispose = () => { if (timer) clearTimeout(timer); clearInterval(folderTimer); try { bonjour?.destroy() } catch { /* ignore */ } }
  }
})

const PROVIDER: Record<string, string> = { icloud: 'iCloud Drive', dropbox: 'Dropbox', gdrive: 'Google Drive', onedrive: 'OneDrive', syncthing: 'Syncthing', network: 'a network drive' }
