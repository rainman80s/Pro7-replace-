import type { ID, MediaRef, Presentation, Slide } from '@shared/model'
import type { DocSlideChange, IntegrationStatus, NotionDbInfo, NotionMapping, NotionPageSummary, NotionSettings, SlideDraft } from '@shared/integrations'
import { defaultNotionSettings } from '@shared/integrations'
import { defineService, type ServiceContext } from '../../core/service'
import { newId } from '../../core/files'
import { newPresentation } from '../../core/library'
import { errMessage, HttpError } from '../integrations/http'
import { docSource, syncDocSlides, tidyPresentation, type GeneratedSlide } from '../integrations/docsync'
import { attachToPlaylist, saveRemoteMedia, themeById, themed } from '../integrations/attach'
import { bible } from '../bible'
import { autoDetect, NotionClient, pageMatches, summarize, titleProp, type NBlock, type NPage } from './client'
import { blocksToSpecs, specToDraft, type SlideSpec } from './blocks'
import { fillScripture, specToSlides, type VerseLookup } from './layout'

type Which = 'sermons' | 'announcements'

export interface NotionPreview {
  pages: NotionPageSummary[]
  drafts: SlideDraft[]
  changes: DocSlideChange[]
  warnings: string[]
  mode: string
  presentationId?: ID
  target?: { playlistId: ID; playlistName: string; itemTitle?: string } | null
}

declare module '@shared/api' {
  interface ApiMethods {
    'notion.status': { req: void; res: IntegrationStatus & { settings: NotionSettings } }
    'notion.connect': { req: { token: string }; res: IntegrationStatus }
    'notion.disconnect': { req: void; res: void }
    'notion.databases': { req: void; res: NotionDbInfo[] }
    'notion.autoDetect': { req: void; res: NotionSettings }
    'notion.setSettings': { req: Partial<NotionSettings>; res: NotionSettings }
    'notion.pages': { req: { which: Which; date?: string; upcoming?: boolean }; res: NotionPageSummary[] }
    'notion.preview': { req: { which: Which; pageIds: string[] }; res: NotionPreview }
    'notion.import': { req: { which: Which; pageIds: string[]; decisions?: Record<string, 'accept' | 'reject'>; playlistId?: ID; itemId?: ID; attach?: boolean; themeId?: ID }; res: { presentation: Presentation; attached: { playlistId: ID; itemId: ID; playlistName: string } | null; changes: DocSlideChange[]; warnings: string[] } }
    /** For a service plan: find the sermon + announcements pages for its date. */
    'notion.forPlaylist': { req: { playlistId: ID }; res: { sermons: NotionPageSummary[]; announcements: NotionPageSummary[]; date?: string } }
  }
  interface ApiEvents {
    'notion.progress': { message: string }
    'notion.statusChanged': void
  }
}

const DOC = 'integrations-notion'

export default defineService({
  name: 'notion',
  order: 60,
  async setup(ctx: ServiceContext) {
    const { api, local, library, workspace } = ctx
    let account = local.get<string>('notion.account', '')
    let lastError = ''
    let lastSync = local.get<string>('notion.lastSync', '')
    const commentCache = new Map<string, { at: number; list: string[] }>()
    let commentsBlocked = false

    const token = (): string | null => local.getSecret('notion.token')
    const client = (): NotionClient => {
      const t = token()
      if (!t) throw new Error('Notion is not connected yet — paste your integration token in Integrations.')
      return new NotionClient(t)
    }
    const settings = async (): Promise<NotionSettings> => ({ ...defaultNotionSettings(), ...(await workspace.readDoc<Partial<NotionSettings>>(DOC, {})) })
    const save = async (patch: Partial<NotionSettings>): Promise<NotionSettings> => { const s = { ...(await settings()), ...patch }; await workspace.writeDoc(DOC, s); return s }
    const status = (): IntegrationStatus => ({ id: 'notion', connected: !!token(), account: account || undefined, lastSync: lastSync || undefined, error: lastError || undefined })
    const mappingFor = async (which: Which): Promise<NotionMapping> => {
      const m = (await settings())[which]
      if (!m) throw new Error(`Choose which Notion database holds ${which} first (Integrations → Notion).`)
      return m
    }
    const progress = (message: string): void => api.emit('notion.progress', { message })

    async function comments(c: NotionClient, blocks: NBlock[]): Promise<Record<string, string[]>> {
      const s = await settings()
      if (!s.readComments || commentsBlocked) return {}
      const ids: string[] = []
      const walk = (bs: NBlock[]): void => { for (const b of bs) { if (b.type !== 'synced_block' && b.type !== 'divider' && b.type !== 'image') ids.push(b.id); if (b.children && b.type !== 'synced_block') walk(b.children) } }
      walk(blocks)
      const out: Record<string, string[]> = {}
      let n = 0
      for (const id of ids.slice(0, 250)) {
        const hit = commentCache.get(id)
        if (hit && Date.now() - hit.at < 5 * 60_000) { if (hit.list.length) out[id] = hit.list; continue }
        if (++n % 15 === 0) progress(`Reading comments… ${n}/${ids.length}`)
        try {
          const list = (await c.comments(id)).map((x) => x.text)
          commentCache.set(id, { at: Date.now(), list })
          if (list.length) out[id] = list
        } catch (e) {
          if (e instanceof HttpError && (e.status === 403 || e.status === 401)) { commentsBlocked = true; break }
        }
      }
      return out
    }

    async function loadSpecs(which: Which, pageIds: string[]): Promise<{ pages: NPage[]; specs: SlideSpec[]; warnings: string[]; mode: string }> {
      const c = client()
      const s = await settings()
      const m = s[which]
      const pages: NPage[] = []
      const specs: SlideSpec[] = []
      const warnings: string[] = []
      let mode = ''
      for (const id of pageIds) {
        progress('Reading the Notion page…')
        const page = await c.page(id)
        pages.push(page)
        const blocks = await c.blocks(id)
        const cm = await comments(c, blocks)
        const r = blocksToSpecs(blocks, { mode: which === 'announcements' ? (s.slideMode === 'auto' ? 'auto' : s.slideMode) : s.slideMode, skipSynced: true, maxChars: s.scriptureMaxChars, defaultTranslation: s.defaultTranslation, comments: cm })
        mode = r.mode ?? mode
        warnings.push(...r.warnings)
        if (!r.specs.length && which === 'announcements') {
          // A database row with no body: one slide from its properties.
          const sm = summarize(page, m ?? { databaseId: '' })
          specs.push({ key: page.id, srcHash: page.last_edited_time ?? '', kind: 'announcement', title: [{ text: sm.title }], body: sm.date ? [[{ text: sm.date }]] : [], notes: [], blockIds: [], warnings: [] })
        }
        specs.push(...r.specs.map((x) => (pageIds.length > 1 ? { ...x, key: `${id.slice(0, 8)}:${x.key}` } : x)))
      }
      if (commentsBlocked && s.readComments) warnings.push('Comments weren’t read — give the Notion integration the “Read comments” capability to get operator notes.')
      return { pages, specs, warnings, mode }
    }

    const lookup: VerseLookup = async (passages) => {
      const s = await settings()
      const out = []
      for (const p of passages) {
        // Use the translation the pastor wrote if it's installed here; else the fill translation (and say so).
        const want = await bible.resolve(p.translation, true)
        const t = want ?? (await bible.resolve(s.fillTranslation))
        if (!t) { out.push({ verses: [], translation: p.translation ?? '', warning: 'No Bible translations installed — download one in Integrations → Bibles.' }); continue }
        const r = await bible.lookup({ passages: [{ ...p, translation: t.abbreviation }], translation: t.id })
        const hit = r.results[0]
        out.push({ verses: hit?.verses ?? [], translation: hit?.translation.abbreviation ?? t.abbreviation, copyright: hit?.copyright, warning: !want && p.translation ? `${p.translation} isn’t set up on this computer — used ${t.abbreviation} for ${p.book} ${p.chapter}.` : r.warnings[0] })
      }
      return out
    }

    async function generate(which: Which, specs: SlideSpec[], pageId: string): Promise<{ gen: GeneratedSlide[]; warnings: string[] }> {
      const s = await settings()
      const size = workspace.config.defaultSize
      const gen: GeneratedSlide[] = []
      const warnings: string[] = []
      const media: Record<string, MediaRef> = {}
      for (const spec of specs) {
        if (!spec.image) continue
        try {
          progress(`Downloading ${spec.image.name}…`)
          media[spec.image.blockId] = await saveRemoteMedia(ctx, `notion/${pageId.replace(/-/g, '').slice(0, 12)}`, spec.image.blockId.replace(/-/g, ''), () => client().http.download(spec.image!.url, { auth: false }), { name: spec.image.caption ?? spec.image.name.replace(/\.[a-z0-9]+$/i, ''), ext: spec.image.name.split('.').pop() })
        } catch (e) { warnings.push(`Image “${spec.image.name}”: ${errMessage(e)}`) }
      }
      for (const spec of specs) {
        let slides: Slide[]
        if (spec.fill) {
          const r = await fillScripture(spec, lookup, { size, newId, maxChars: s.scriptureMaxChars })
          slides = r.slides
          warnings.push(...r.warnings)
        } else slides = specToSlides(spec, { size, newId, emphasis: s.emphasis, media, autoAdvance: which === 'announcements' ? s.announcementSeconds : undefined })
        slides.forEach((slide, i) => gen.push({ key: i ? `${spec.key}#p${i + 1}` : spec.key, srcHash: spec.srcHash + (i ? `#${i}` : ''), slide, label: slide.label }))
        warnings.push(...spec.warnings.map((w) => `${slides[0]?.label ?? 'Slide'}: ${w}`))
      }
      return { gen, warnings }
    }

    const ref = (which: Which, pageIds: string[]): string => (which === 'announcements' && pageIds.length > 1 ? `announcements:${[...pageIds].sort().join(',')}` : pageIds[0])
    const findExisting = (r: string): Presentation | null => library.all().find((p) => docSource(p, 'notion')?.ref === r) ?? null

    api.handle('notion.status', async () => ({ ...status(), settings: await settings() }), 'local')
    api.handle('notion.connect', async ({ token: t }) => {
      const c = new NotionClient(t.trim())
      account = await c.me()
      local.setSecret('notion.token', t.trim())
      local.set('notion.account', account)
      lastError = ''
      commentsBlocked = false
      const s = await settings()
      if (!s.sermons || !s.announcements) {
        const det = autoDetect(await c.databases().catch(() => []))
        await save({ sermons: s.sermons ?? det.sermons, announcements: s.announcements ?? det.announcements })
      }
      api.emit('notion.statusChanged')
      return status()
    }, 'local')
    api.handle('notion.disconnect', () => { local.setSecret('notion.token', null); local.set('notion.account', undefined); account = ''; api.emit('notion.statusChanged') }, 'local')
    api.handle('notion.databases', () => client().databases(), 'local')
    api.handle('notion.autoDetect', async () => { const det = autoDetect(await client().databases()); return save(det) }, 'local')
    api.handle('notion.setSettings', (patch) => save(patch), 'local')

    api.handle('notion.pages', async ({ which, date, upcoming }) => {
      const m = await mappingFor(which)
      const today = new Date().toISOString().slice(0, 10)
      try {
        const pages = await client().query(m, date ? { date } : upcoming ? { from: new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10), limit: 40 } : { to: today, limit: 30 })
        lastError = ''
        return pages.filter((p) => pageMatches(p, m)).map((p) => summarize(p, m))
      } catch (e) { lastError = errMessage(e); throw e }
    }, 'local')

    api.handle('notion.forPlaylist', async ({ playlistId }) => {
      const pl = library.getPlaylist(playlistId)
      const date = pl?.date?.slice(0, 10)
      if (!date) return { sermons: [], announcements: [], date }
      const s = await settings()
      const get = async (which: Which): Promise<NotionPageSummary[]> => {
        const m = s[which]
        if (!m) return []
        const pages = (await client().query(m, { date }).catch(() => [] as NPage[])).filter((p) => pageMatches(p, m)).map((p) => summarize(p, m))
        // Tie-break by similarity to the plan title (Reach's Notion title == PCO plan title).
        const title = String((pl?.source as { title?: string } | undefined)?.title ?? '').toLowerCase()
        return pages.sort((a, b) => Number(b.title.toLowerCase() === title) - Number(a.title.toLowerCase() === title))
      }
      return { sermons: await get('sermons'), announcements: await get('announcements'), date }
    }, 'local')

    api.handle('notion.preview', async ({ which, pageIds }) => {
      const s = await settings()
      const { pages, specs, warnings, mode } = await loadSpecs(which, pageIds)
      const existing = findExisting(ref(which, pageIds))
      const m = s[which] ?? { databaseId: '' }
      // Diff against what's in the library without generating images/scripture (cheap): keys + source hashes.
      const fake: GeneratedSlide[] = specs.map((x) => ({ key: x.key, srcHash: x.srcHash, slide: { id: newId(), elements: [] }, label: specToDraft(x).label }))
      const diff = existing ? syncDocSlides(existing, 'notion', ref(which, pageIds), fake).changes : []
      const date = summarize(pages[0], m).date
      const target = date ? library.listPlaylists().find((p) => p.date?.slice(0, 10) === date) : undefined
      return {
        pages: pages.map((p) => summarize(p, m)), drafts: specs.map(specToDraft), changes: diff, warnings: [...new Set(warnings)], mode,
        presentationId: existing?.id, target: target ? { playlistId: target.id, playlistName: target.name } : null
      }
    }, 'local')

    api.handle('notion.import', async ({ which, pageIds, decisions, playlistId, itemId, attach, themeId }) => {
      const s = await settings()
      const { pages, specs, warnings } = await loadSpecs(which, pageIds)
      const r = ref(which, pageIds)
      const existing = findExisting(r)
      const { gen, warnings: w2 } = await generate(which, specs, pageIds[0])
      const theme = await themeById(ctx, themeId ?? s.themeId)
      const themedGen = gen.map((g) => ({ ...g, slide: themed([g.slide], theme, specs.find((x) => g.key.startsWith(x.key))?.kind)[0] }))
      const m = s[which] ?? { databaseId: '' }
      const sm = summarize(pages[0], m)
      const sync = syncDocSlides(existing, 'notion', r, themedGen, { decisions, extra: { pageIds, which, url: pages[0].url, lastEdited: pages[0].last_edited_time, date: sm.date } })
      const base = existing ?? newPresentation(which === 'announcements' ? `Announcements — ${sm.date ?? titleProp(pages[0])}` : sm.title, which === 'announcements' ? 'announcement' : 'sermon')
      const p = tidyPresentation({
        ...base, slides: sync.slides, themeId: themeId ?? s.themeId ?? base.themeId,
        meta: { ...base.meta, author: sm.speaker?.join(', ') || base.meta.author, category: which === 'announcements' ? 'Announcements' : sm.series ?? 'Sermons', source: { ...sync.source, importedAt: new Date().toISOString() } }
      })
      if (which === 'announcements' && !existing) p.title = `Announcements — ${sm.date ?? titleProp(pages[0])}`
      const saved = await library.save(p)
      let attached = null
      if (attach !== false) attached = await attachToPlaylist(ctx, saved, which === 'sermons' ? 'sermon' : 'announcements', { date: sm.date, playlistId, itemId, append: !!playlistId })
      lastSync = new Date().toISOString()
      local.set('notion.lastSync', lastSync)
      api.emit('notion.statusChanged')
      return { presentation: saved, attached, changes: sync.changes.filter((c) => c.type !== 'same'), warnings: [...new Set([...warnings, ...w2])] }
    }, 'local')
  }
})
