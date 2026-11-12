import type { ID, Playlist, Presentation } from '@shared/model'
import type {
  IntegrationStatus, PcoPlan, PcoPlanSummary, PcoServiceType, PcoSettings, PlanChange, PlanPullPreview, SongDecision
} from '@shared/integrations'
import { defaultPcoSettings, pcoSource } from '@shared/integrations'
import { defineService, type ServiceContext } from '../../core/service'
import { newId } from '../../core/files'
import { errMessage } from '../integrations/http'
import { PcoClient } from './client'
import { desiredItems, matchSong, parseSong, songToText, syncPlaylist, timerSuggestions, type DesiredItem, type LibrarySong, type TimerDoc } from './map'

declare module '@shared/api' {
  interface ApiMethods {
    'pco.status': { req: void; res: IntegrationStatus & { settings: PcoSettings } }
    'pco.connect': { req: { appId: string; secret: string }; res: IntegrationStatus }
    'pco.disconnect': { req: void; res: void }
    'pco.setSettings': { req: Partial<PcoSettings>; res: PcoSettings }
    'pco.serviceTypes': { req: void; res: PcoServiceType[] }
    'pco.plans': { req: { serviceTypeId: string; filter?: 'future' | 'past' }; res: PcoPlanSummary[] }
    /** Fetch the plan and work out what pulling it would do (nothing is saved). */
    'pco.preview': { req: { serviceTypeId: string; planId: string }; res: PlanPullPreview }
    /** Create/update the playlist. `decisions` are per-change accept/reject; `songs` per unmatched song. */
    'pco.pull': { req: { serviceTypeId: string; planId: string; decisions?: Record<string, 'accept' | 'reject'>; songs?: Record<string, SongDecision>; timers?: string[] }; res: { playlist: Playlist; changes: PlanChange[]; applied: number } }
    /** Re-check a pulled playlist against Planning Center. */
    'pco.check': { req: { playlistId: ID }; res: PlanPullPreview }
    'pco.pending': { req: void; res: Record<ID, PlanChange[]> }
  }
  interface ApiEvents {
    'pco.changes': { playlistId: ID; changes: PlanChange[] }
    'pco.statusChanged': void
  }
}

const DOC = 'integrations-pco'

export default defineService({
  name: 'pco',
  async setup(ctx: ServiceContext) {
    const { api, local, library, workspace } = ctx
    let account = local.get<string>('pco.account', '')
    let lastError = ''
    let lastSync = local.get<string>('pco.lastSync', '')
    const pending: Record<ID, PlanChange[]> = {}
    const planCache = new Map<string, { at: number; plan: PcoPlan }>()

    const creds = (): { appId: string; secret: string } | null => {
      const appId = local.getSecret('pco.appId'), secret = local.getSecret('pco.secret')
      return appId && secret ? { appId, secret } : null
    }
    const client = (): PcoClient => {
      const c = creds()
      if (!c) throw new Error('Planning Center is not connected yet — add your token in Integrations.')
      return new PcoClient({ type: 'pat', ...c })
    }
    const settings = async (): Promise<PcoSettings> => ({ ...defaultPcoSettings(), ...(await workspace.readDoc<Partial<PcoSettings>>(DOC, {})) })
    const saveSettings = async (patch: Partial<PcoSettings>): Promise<PcoSettings> => {
      const s = { ...(await settings()), ...patch }
      await workspace.writeDoc(DOC, s)
      return s
    }
    const status = (): IntegrationStatus => ({ id: 'pco', connected: !!creds(), account: account || undefined, lastSync: lastSync || undefined, error: lastError || undefined })

    const librarySongs = (): LibrarySong[] => library.all().map((p) => ({ id: p.id, title: p.title, ccliNumber: p.meta.ccliNumber, kind: p.kind, arrangements: p.arrangements.map((a) => ({ id: a.id, name: a.name })) }))

    async function fetchPlan(serviceTypeId: string, planId: string, maxAgeMs = 0): Promise<PcoPlan> {
      const key = `${serviceTypeId}/${planId}`
      const hit = planCache.get(key)
      if (hit && Date.now() - hit.at < maxAgeMs) return hit.plan
      try {
        const plan = await client().plan(serviceTypeId, planId)
        planCache.set(key, { at: Date.now(), plan })
        lastError = ''
        return plan
      } catch (e) {
        lastError = errMessage(e)
        throw e
      }
    }

    function resolver(s: PcoSettings, songs: LibrarySong[], extra: Record<string, { presentationId: ID } | null> = {}) {
      return (d: DesiredItem): { presentationId: ID; arrangementId?: ID } | undefined => {
        if (d.item.id in extra) {
          const x = extra[d.item.id]
          if (!x) return undefined
          return { presentationId: x.presentationId, arrangementId: arrangementFor(x.presentationId, d) }
        }
        const m = matchSong(d.item, songs, s.songLinks)
        return m.presentationId ? { presentationId: m.presentationId, arrangementId: arrangementFor(m.presentationId, d) } : undefined
      }
    }
    function arrangementFor(presentationId: ID, d: DesiredItem): ID | undefined {
      const p = library.get(presentationId)
      const name = d.item.arrangement?.name?.toLowerCase()
      return (name && p?.arrangements.find((a) => a.name.toLowerCase() === name)?.id) || undefined
    }
    const findPlaylist = (planId: string): Playlist | null => library.listPlaylists().find((p) => pcoSource(p)?.ref === planId) ?? null

    async function preview(serviceTypeId: string, planId: string): Promise<PlanPullPreview> {
      const s = await settings()
      const plan = await fetchPlan(serviceTypeId, planId)
      const existing = findPlaylist(planId)
      const songs = librarySongs()
      const r = syncPlaylist(existing, plan, { settings: s, resolveSong: resolver(s, songs), newId })
      const desired = desiredItems(plan, s)
      const timers = await workspace.readDoc<TimerDoc[]>('timers', [])
      const { items: _i, people: _p, ...summary } = plan
      return {
        plan: summary, playlistId: existing?.id, playlistExists: !!existing, changes: r.changes,
        songs: desired.filter((d) => d.kind === 'song').map((d) => matchSong(d.item, songs, s.songLinks)),
        itemCount: desired.length, roles: (r.playlist.source as { roles?: Record<string, string[]> }).roles ?? {},
        timerSuggestions: timerSuggestions(plan, Array.isArray(timers) ? timers : [])
      }
    }

    async function importSong(d: DesiredItem): Promise<Presentation | null> {
      const song = d.item.song
      if (!song || !d.item.arrangement) return null
      const arr = await client().arrangement(song.id, d.item.arrangement.id)
      const parsed = parseSong({ ...arr, sequence: d.item.customSequence ?? arr.sequence })
      if (!parsed.sections.length) return null
      const p = await library.create(song.title, 'song', songToText(parsed))
      p.meta = { ...p.meta, author: song.author, copyright: song.copyright, ccliNumber: song.ccli, source: { type: 'pco', ref: song.id, arrangementId: arr.id, importedAt: new Date().toISOString() } }
      const byName = new Map(p.groups.map((g) => [g.name.toLowerCase(), g.id]))
      const groupIds = parsed.sequence.map((l) => byName.get(l.toLowerCase())).filter((x): x is string => !!x)
      if (groupIds.length) {
        const a = { id: newId(), name: arr.name || 'Planning Center', groupIds }
        p.arrangements.push(a)
        p.activeArrangementId = a.id
      }
      return library.save(p)
    }

    api.handle('pco.status', async () => ({ ...status(), settings: await settings() }), 'local')
    api.handle('pco.connect', async ({ appId, secret }) => {
      const c = new PcoClient({ type: 'pat', appId: appId.trim(), secret: secret.trim() })
      account = await c.organization() // throws a friendly error on bad credentials
      local.setSecret('pco.appId', appId.trim())
      local.setSecret('pco.secret', secret.trim())
      local.set('pco.account', account)
      lastError = ''
      const s = await settings()
      if (!s.serviceTypeId) {
        const types = await c.serviceTypes().catch(() => [])
        const guess = types.find((t) => /gathering|sunday|worship|weekend|service/i.test(t.name)) ?? types[0]
        if (guess) await saveSettings({ serviceTypeId: guess.id })
      }
      api.emit('pco.statusChanged')
      schedule()
      return status()
    }, 'local')
    api.handle('pco.disconnect', () => {
      local.setSecret('pco.appId', null); local.setSecret('pco.secret', null); local.set('pco.account', undefined)
      account = ''
      api.emit('pco.statusChanged')
    }, 'local')
    api.handle('pco.setSettings', async (patch) => { const s = await saveSettings(patch); schedule(); return s }, 'local')
    api.handle('pco.serviceTypes', () => client().serviceTypes(), 'local')
    api.handle('pco.plans', ({ serviceTypeId, filter }) => client().plans(serviceTypeId, filter ?? 'future'), 'local')
    api.handle('pco.preview', ({ serviceTypeId, planId }) => preview(serviceTypeId, planId), 'local')
    api.handle('pco.check', async ({ playlistId }) => {
      const src = pcoSource(library.getPlaylist(playlistId))
      if (!src) throw new Error('This service plan did not come from Planning Center.')
      return preview(src.serviceTypeId, src.ref)
    }, 'local')
    api.handle('pco.pending', () => pending, 'local')

    api.handle('pco.pull', async ({ serviceTypeId, planId, decisions, songs, timers }) => {
      const s = await settings()
      const plan = await fetchPlan(serviceTypeId, planId, 60_000)
      const desired = desiredItems(plan, s)
      const extra: Record<string, { presentationId: ID } | null> = {}
      const links = { ...s.songLinks }
      for (const [pcoItemId, dec] of Object.entries(songs ?? {})) {
        const d = desired.find((x) => x.item.id === pcoItemId)
        if (!d) continue
        if (dec.action === 'use') { extra[pcoItemId] = { presentationId: dec.presentationId }; if (d.item.song) links[d.item.song.id] = dec.presentationId }
        else if (dec.action === 'placeholder') extra[pcoItemId] = null
        else {
          try {
            const p = await importSong(d)
            if (p) { extra[pcoItemId] = { presentationId: p.id }; if (d.item.song) links[d.item.song.id] = p.id }
            else { extra[pcoItemId] = null; api.emit('ui.notify', { level: 'warning', title: `No lyrics in Planning Center for “${d.base.title}”`, detail: 'Left as a placeholder — import the song file or type the lyrics.' }) }
          } catch (e) {
            extra[pcoItemId] = null
            api.emit('ui.notify', { level: 'warning', title: `Couldn't import “${d.base.title}”`, detail: errMessage(e) })
          }
        }
      }
      if (JSON.stringify(links) !== JSON.stringify(s.songLinks)) await saveSettings({ songLinks: links })
      const existing = findPlaylist(planId)
      const r = syncPlaylist(existing, plan, { settings: s, resolveSong: resolver({ ...s, songLinks: links }, librarySongs(), extra), decisions, newId })
      const playlist = await library.savePlaylist(r.playlist)
      delete pending[playlist.id]
      if (timers?.length) {
        const cur = await workspace.readDoc<TimerDoc[]>('timers', [])
        const list = Array.isArray(cur) ? cur : []
        const want = timerSuggestions(plan, list).filter((t) => timers.includes(t.id) && !t.exists)
        if (want.length) await workspace.writeDoc('timers', [...list, ...want.map((t) => ({ id: t.id, name: t.name, kind: 'countdownTo' as const, target: t.target, running: false, source: 'pco' }))])
      }
      lastSync = new Date().toISOString()
      local.set('pco.lastSync', lastSync)
      api.emit('pco.statusChanged')
      return { playlist, changes: r.changes, applied: r.applied }
    }, 'local')

    /* ── background re-check of upcoming pulled plans ── */
    let timer: NodeJS.Timeout | null = null
    async function refresh(): Promise<void> {
      if (!creds()) return
      const s = await settings()
      const cutoff = Date.now() - 36 * 3600_000
      for (const pl of library.listPlaylists()) {
        const src = pcoSource(pl)
        if (!src) continue
        const when = Date.parse(src.times.find((t) => t.type === 'service')?.startsAt ?? pl.date ?? '')
        if (!(when > cutoff)) continue // past services don't change
        try {
          const plan = await fetchPlan(src.serviceTypeId, src.ref)
          const r = syncPlaylist(pl, plan, { settings: s, resolveSong: resolver(s, librarySongs()), newId })
          const before = JSON.stringify(pending[pl.id] ?? [])
          if (r.changes.length) pending[pl.id] = r.changes
          else delete pending[pl.id]
          if (JSON.stringify(pending[pl.id] ?? []) !== before) api.emit('pco.changes', { playlistId: pl.id, changes: r.changes })
        } catch { /* offline on a Sunday is fine — the pulled plan keeps working */ }
      }
    }
    function schedule(): void {
      if (timer) clearInterval(timer)
      timer = null
      void settings().then((s) => {
        if (s.autoRefreshMinutes > 0 && creds()) timer = setInterval(() => void refresh(), Math.max(1, s.autoRefreshMinutes) * 60_000)
      })
    }
    schedule()
    if (creds()) setTimeout(() => void refresh(), 8000)
    this.dispose = () => { if (timer) clearInterval(timer) }

    /* ── PCO Services Live (optional; writes to Planning Center, so opt-in) ── */
    const liveStep = async (dir: 'go_to_next_item' | 'go_to_previous_item', playlistId?: ID): Promise<void> => {
      const pl = (playlistId && library.getPlaylist(playlistId)) || library.listPlaylists().find((p) => pcoSource(p))
      const src = pcoSource(pl)
      if (!src) throw new Error('No Planning Center plan is loaded')
      await client().live(src.serviceTypeId, src.ref, dir)
    }
    ctx.live.registerAction('pco.live.next', (p) => liveStep('go_to_next_item', p.playlistId as ID | undefined))
    ctx.live.registerAction('pco.live.previous', (p) => liveStep('go_to_previous_item', p.playlistId as ID | undefined))
    let lastFollowed = ''
    api.on('live.changed', (state) => {
      const itemId = state.slide?.playlistItemId, playlistId = state.slide?.playlistId
      if (!itemId || !playlistId || itemId === lastFollowed) return
      lastFollowed = itemId
      void (async () => {
        const s = await settings()
        if (!s.liveFollow || !creds()) return
        const src = pcoSource(library.getPlaylist(playlistId))
        const target = src?.origins[itemId]?.pcoItemId
        if (!src || !target) return
        try {
          const c = client()
          const order = src.baseOrder
          for (let i = 0; i < 12; i++) {
            const cur = await c.liveCurrentItemId(src.serviceTypeId, src.ref)
            if (!cur || cur === target) return
            await c.live(src.serviceTypeId, src.ref, order.indexOf(target) > order.indexOf(cur) ? 'go_to_next_item' : 'go_to_previous_item')
          }
        } catch (e) { console.warn('[pco] live follow failed:', errMessage(e)) }
      })()
    })
  }
})
