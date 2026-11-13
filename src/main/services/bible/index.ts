import { app } from 'electron'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import type { ID, Playlist, Presentation, Slide } from '@shared/model'
import type { BibleFile, Passage, TranslationInfo, Verse } from '@shared/bible'
import { bookById, formatReference, parseReferences, passageOf, searchFile, versesFromFile } from '@shared/bible'
import type { IntegrationStatus } from '@shared/integrations'
import { defineService, type ServiceContext } from '../../core/service'
import { newId, readJson, writeJson } from '../../core/files'
import { newPresentation } from '../../core/library'
import { errMessage } from '../integrations/http'
import { ApiBibleProvider, EsvProvider, HelloAoSource, OFFLINE_CATALOG, VerseCache, type BibleProvider } from './providers'

export interface BibleResult {
  passage: Passage
  reference: string
  verses: Verse[]
  translation: TranslationInfo
  copyright?: string
  /** Same verses in other translations (parallel). */
  parallel: { translation: TranslationInfo; verses: Verse[]; copyright?: string }[]
  fromCache?: boolean
}
export interface BibleLookup { results: BibleResult[]; warnings: string[] }
export interface BibleSettings { cloud: TranslationInfo[]; defaultTranslation?: string }
export interface BibleProviderStatus { id: string; name: string; hasKey: boolean; note: string }

declare module '@shared/api' {
  interface ApiMethods {
    'bible.status': { req: void; res: IntegrationStatus & { providers: BibleProviderStatus[]; settings: BibleSettings } }
    'bible.translations': { req: void; res: TranslationInfo[] }
    'bible.catalog': { req: { provider: 'offline' | 'apibible' | 'esv'; all?: boolean }; res: { id: string; name: string; abbreviation: string; note?: string; license?: string; installed: boolean; language?: string }[] }
    'bible.download': { req: { id: string; abbreviation?: string }; res: TranslationInfo }
    'bible.remove': { req: { id: string }; res: void }
    'bible.setKey': { req: { provider: string; key: string | null }; res: void }
    'bible.enableCloud': { req: { translation: TranslationInfo; enabled: boolean }; res: BibleSettings }
    'bible.setDefault': { req: { id: string }; res: BibleSettings }
    'bible.lookup': { req: { query?: string; passages?: Passage[]; translation?: string; parallel?: string[] }; res: BibleLookup }
    'bible.search': { req: { q: string; translation?: string }; res: { verses: Verse[]; translation?: TranslationInfo } }
    'bible.chapterLength': { req: { book: string; chapter: number; translation?: string }; res: number }
    /** Save generated slides as a presentation (kind 'scripture'), optionally adding it to a service plan. */
    'bible.save': { req: { title: string; slides: Slide[]; playlistId?: ID; themeId?: ID; copyright?: string }; res: Presentation }
  }
  interface ApiEvents {
    'bible.changed': void
    'bible.progress': { id: string; state: 'downloading' | 'done' | 'error'; message?: string }
  }
}

const DOC = 'integrations-bible'

/** Singleton so other services (Notion scripture auto-fill) can look verses up. */
class BibleService {
  ctx!: ServiceContext
  private files = new Map<string, BibleFile>()
  private infos: TranslationInfo[] | null = null
  private cache = new VerseCache({})
  private cachePath = ''
  providers: Record<string, BibleProvider> = {}
  private ao = new HelloAoSource()

  get dir(): string { return join(this.ctx.workspace.root, 'bibles') }

  async init(ctx: ServiceContext): Promise<void> {
    this.ctx = ctx
    const key = (id: string) => (): string | null => ctx.local.getSecret(`bible.${id}`)
    this.providers = { apibible: new ApiBibleProvider(key('apibible')), esv: new EsvProvider(key('esv')) }
    this.cache = new VerseCache(Object.fromEntries(Object.values(this.providers).map((p) => [p.id, p.terms.cacheVerses])))
    this.cachePath = join(app.getPath('userData'), 'bible-cache.json')
    const saved = await readJson<{ data?: VerseCache['data']; copyright?: Record<string, string> }>(this.cachePath, {})
    this.cache.data = saved.data ?? {}
    this.cache.copyright = saved.copyright ?? {}
    await fs.mkdir(this.dir, { recursive: true })
    ctx.workspace.watch(this.dir, () => { this.infos = null; this.files.clear(); ctx.api.emit('bible.changed') })
    ctx.api.on('bible.changed', () => { this.infos = null })
  }

  async settings(): Promise<BibleSettings> {
    return { cloud: [], ...(await this.ctx.workspace.readDoc<Partial<BibleSettings>>(DOC, {})) }
  }

  private async offlineInfos(): Promise<TranslationInfo[]> {
    if (this.infos) return this.infos
    const out: TranslationInfo[] = []
    for (const f of await fs.readdir(this.dir).catch(() => [])) {
      if (!f.endsWith('.json') || f.startsWith('.')) continue
      // Read only the head of the file for metadata (books is last and large).
      try {
        const fh = await fs.open(join(this.dir, f), 'r')
        const buf = Buffer.alloc(2048)
        const { bytesRead } = await fh.read(buf, 0, 2048, 0)
        await fh.close()
        const head = buf.subarray(0, bytesRead).toString('utf8')
        const pick = (k: string): string => new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(head)?.[1] ?? ''
        const id = pick('id') || f.replace(/\.json$/, '')
        out.push({ id, name: pick('name') || id, abbreviation: pick('abbreviation') || id, language: pick('language') || 'eng', provider: 'offline', offline: true, copyright: pick('copyright') || undefined, license: pick('license') || undefined })
      } catch { /* partial download from a cloud folder — ignore until complete */ }
    }
    const ORDER = ['BSB', 'WEB', 'KJV', 'ASV']
    out.sort((a, b) => (ORDER.indexOf(a.abbreviation) + 99) % 99 - (ORDER.indexOf(b.abbreviation) + 99) % 99 || a.name.localeCompare(b.name))
    this.infos = out
    return out
  }

  async translations(): Promise<TranslationInfo[]> {
    const s = await this.settings()
    const cloud = s.cloud.filter((t) => this.providers[t.provider] && this.ctx.local.getSecret(`bible.${t.provider}`))
    return [...(await this.offlineInfos()), ...cloud]
  }

  private async file(id: string): Promise<BibleFile | null> {
    if (this.files.has(id)) return this.files.get(id)!
    const info = (await this.offlineInfos()).find((t) => t.id === id)
    if (!info) return null
    const f = await readJson<BibleFile | null>(join(this.dir, `${safe(id)}.json`), null)
    if (f?.books) this.files.set(id, f)
    return f?.books ? f : null
  }

  /** Find a translation by id or abbreviation ("ESV", "kjv"). Falls back to the default, then the first offline one. */
  async resolve(want?: string, strict = false): Promise<TranslationInfo | null> {
    const all = await this.translations()
    const w = want?.toLowerCase()
    const hit = w ? all.find((t) => t.id.toLowerCase() === w) ?? all.find((t) => t.abbreviation.toLowerCase() === w) : undefined
    if (hit || strict) return hit ?? null
    const def = (await this.settings()).defaultTranslation
    return all.find((t) => t.id === def) ?? all[0] ?? null
  }

  async versesFor(t: TranslationInfo, p: Passage): Promise<{ verses: Verse[]; copyright?: string; fromCache?: boolean }> {
    if (t.provider === 'offline') {
      const f = await this.file(t.id)
      if (!f) throw new Error(`${t.abbreviation} is still downloading or missing from the workspace.`)
      return { verses: versesFromFile(f, p), copyright: f.copyright || undefined }
    }
    const provider = this.providers[t.provider]
    if (!provider) throw new Error(`Unknown Bible source: ${t.provider}`)
    const tid = t.id.slice(t.provider.length + 1)
    const cached = this.cache.get(provider.id, tid, p)
    if (cached) return { verses: cached, copyright: this.cache.copyright[tid] ?? t.copyright, fromCache: true }
    const r = await provider.verses(tid, p)
    const verses = r.verses.slice(0, provider.terms.maxVerses)
    this.cache.put(provider.id, tid, verses, r.copyright)
    void writeJson(this.cachePath, { data: this.cache.data, copyright: this.cache.copyright }).catch(() => {})
    return { verses, copyright: r.copyright ?? t.copyright }
  }

  async lookup(req: { query?: string; passages?: Passage[]; translation?: string; parallel?: string[] }): Promise<BibleLookup> {
    const passages = req.passages ?? parseReferences(req.query ?? '')
    const warnings: string[] = []
    const results: BibleResult[] = []
    for (const p of passages) {
      let t = p.translation ? await this.resolve(p.translation, true) : null
      if (p.translation && !t) warnings.push(`${p.translation} isn't set up here — showing ${(await this.resolve(req.translation))?.abbreviation ?? 'another translation'} instead.`)
      t ??= await this.resolve(req.translation)
      if (!t) { warnings.push('No Bible translations are installed yet. Download a free one in Integrations → Bibles.'); break }
      try {
        const r = await this.versesFor(t, p)
        if (!r.verses.length) { warnings.push(`${formatReference(p)} wasn't found in ${t.abbreviation}.`); continue }
        const actual = passageOf(r.verses, t.abbreviation)!
        const parallel: BibleResult['parallel'] = []
        for (const pid of req.parallel ?? []) {
          const pt = await this.resolve(pid, true)
          if (!pt || pt.id === t.id) continue
          try { const pr = await this.versesFor(pt, actual); if (pr.verses.length) parallel.push({ translation: pt, verses: pr.verses, copyright: pr.copyright }) }
          catch (e) { warnings.push(`${pt.abbreviation}: ${errMessage(e)}`) }
        }
        results.push({ passage: actual, reference: formatReference(actual), verses: r.verses, translation: t, copyright: r.copyright, parallel, fromCache: r.fromCache })
      } catch (e) {
        warnings.push(`${t.abbreviation}: ${errMessage(e)}`)
        // Offline on a Sunday: fall back to the first offline translation rather than showing nothing.
        const fb = (await this.offlineInfos())[0]
        if (fb && fb.id !== t.id) {
          const r = await this.versesFor(fb, p).catch(() => null)
          if (r?.verses.length) { const actual = passageOf(r.verses, fb.abbreviation)!; results.push({ passage: actual, reference: formatReference(actual), verses: r.verses, translation: fb, copyright: r.copyright, parallel: [] }) }
        }
      }
    }
    return { results, warnings }
  }

  async search(q: string, translation?: string): Promise<{ verses: Verse[]; translation?: TranslationInfo }> {
    const want = await this.resolve(translation)
    const t = want?.offline ? want : (await this.offlineInfos())[0]
    const f = t && (await this.file(t.id))
    return f ? { verses: searchFile(f, q, 60), translation: t } : { verses: [] }
  }

  async download(id: string, abbreviation?: string): Promise<TranslationInfo> {
    const { api, workspace } = this.ctx
    api.emit('bible.progress', { id, state: 'downloading' })
    try {
      const cat = OFFLINE_CATALOG.find((c) => c.id === id)
      const file = await this.ao.download(id, abbreviation ?? cat?.abbreviation)
      if (cat) { file.name = cat.name; file.license = cat.license }
      await fs.mkdir(this.dir, { recursive: true })
      const path = join(this.dir, `${safe(file.id)}.json`)
      workspace.markOwnWrite(path)
      // `books` last so metadata can be read from the head of the file.
      const { books, ...meta } = file
      await writeJsonCompact(path, { ...meta, books })
      this.infos = null
      this.files.set(file.id, file)
      api.emit('bible.progress', { id, state: 'done' })
      api.emit('bible.changed')
      return (await this.offlineInfos()).find((t) => t.id === file.id)!
    } catch (e) {
      api.emit('bible.progress', { id, state: 'error', message: errMessage(e) })
      throw e
    }
  }

  async catalog(provider: string, all?: boolean): Promise<{ id: string; name: string; abbreviation: string; note?: string; license?: string; installed: boolean; language?: string }[]> {
    const installed = new Set((await this.translations()).map((t) => t.id))
    if (provider === 'offline') {
      const base = OFFLINE_CATALOG.map((c) => ({ ...c, installed: installed.has(c.id), language: c.id.startsWith('spa') ? 'spa' : 'eng' }))
      if (!all) return base
      const more = (await this.ao.catalog()).filter((t) => t.publicDomain && !OFFLINE_CATALOG.some((c) => c.id === t.id))
      return [...base, ...more.map((t) => ({ id: t.id, name: t.name, abbreviation: t.id.replace(/^[a-z]{3}_/, '').toUpperCase(), license: 'Public domain', language: t.language, installed: installed.has(t.id) }))]
    }
    const p = this.providers[provider]
    if (!p) return []
    return (await p.translations()).map((t) => ({ id: t.id, name: t.name, abbreviation: t.abbreviation, license: t.copyright, language: t.language, installed: installed.has(t.id) }))
  }
}

const safe = (n: string): string => n.replace(/[^a-zA-Z0-9._-]/g, '_')
async function writeJsonCompact(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.${newId().slice(0, 8)}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value))
  await fs.rename(tmp, path)
}

export const bible = new BibleService()

export default defineService({
  name: 'bible',
  order: 40,
  async setup(ctx) {
    await bible.init(ctx)
    const { api, local, library, workspace } = ctx
    const providerStatus = (): BibleProviderStatus[] => Object.values(bible.providers).map((p) => ({ id: p.id, name: p.name, hasKey: !!local.getSecret(`bible.${p.id}`), note: p.terms.note }))

    api.handle('bible.status', async () => {
      const ts = await bible.translations()
      const off = ts.filter((t) => t.offline)
      return {
        id: 'bible' as const, connected: ts.length > 0, account: ts.length ? ts.map((t) => t.abbreviation).join(', ') : undefined,
        detail: off.length ? `${off.length} offline translation${off.length > 1 ? 's' : ''}` : 'No offline Bible downloaded yet',
        providers: providerStatus(), settings: await bible.settings()
      }
    }, 'control')
    api.handle('bible.translations', () => bible.translations(), 'control')
    api.handle('bible.catalog', ({ provider, all }) => bible.catalog(provider, all), 'local')
    api.handle('bible.download', ({ id, abbreviation }) => bible.download(id, abbreviation), 'local')
    api.handle('bible.remove', async ({ id }) => {
      await fs.rm(join(bible.dir, `${safe(id)}.json`), { force: true })
      const s = await bible.settings()
      await workspace.writeDoc(DOC, { ...s, cloud: s.cloud.filter((t) => t.id !== id) })
      api.emit('bible.changed')
    }, 'local')
    api.handle('bible.setKey', async ({ provider, key }) => {
      if (!bible.providers[provider]) throw new Error('Unknown Bible source')
      if (key) {
        // Validate before saving so a typo is caught now, not on Sunday.
        const prev = local.getSecret(`bible.${provider}`)
        local.setSecret(`bible.${provider}`, key.trim())
        try {
          if (provider === 'esv') await bible.providers.esv.verses('ESV', { book: 'JHN', chapter: 11, verse: 35, endChapter: 11, endVerse: 35 })
          else await bible.providers[provider].translations()
        } catch (e) { local.setSecret(`bible.${provider}`, prev); throw e }
        if (provider === 'esv') {
          const s = await bible.settings()
          const [esv] = await bible.providers.esv.translations()
          if (!s.cloud.some((t) => t.id === esv.id)) await workspace.writeDoc(DOC, { ...s, cloud: [...s.cloud, esv] })
        }
      } else local.setSecret(`bible.${provider}`, null)
      api.emit('bible.changed')
    }, 'local')
    api.handle('bible.enableCloud', async ({ translation, enabled }) => {
      const s = await bible.settings()
      const cloud = s.cloud.filter((t) => t.id !== translation.id)
      if (enabled) cloud.push({ ...translation, offline: false })
      const next = { ...s, cloud }
      await workspace.writeDoc(DOC, next)
      api.emit('bible.changed')
      return next
    }, 'local')
    api.handle('bible.setDefault', async ({ id }) => {
      const next = { ...(await bible.settings()), defaultTranslation: id }
      await workspace.writeDoc(DOC, next)
      api.emit('bible.changed')
      return next
    })
    api.handle('bible.lookup', (req) => bible.lookup(req), 'control')
    api.handle('bible.search', ({ q, translation }) => bible.search(q, translation), 'control')
    api.handle('bible.chapterLength', async ({ book, chapter, translation }) => {
      const t = await bible.resolve(translation)
      if (!t) return 0
      const r = await bible.versesFor(t, { book, chapter, endChapter: chapter }).catch(() => ({ verses: [] as Verse[] }))
      return r.verses.at(-1)?.verse ?? (bookById(book) ? 30 : 0)
    }, 'control')
    api.handle('bible.save', async ({ title, slides, playlistId, themeId, copyright }) => {
      const p = newPresentation(title, 'scripture')
      p.slides = slides.map((s) => ({ ...s, id: newId() }))
      p.themeId = themeId
      p.meta = { copyright, source: { type: 'bible', ref: title, importedAt: new Date().toISOString() } }
      const saved = await library.save(p)
      if (playlistId) {
        const pl = library.getPlaylist(playlistId)
        if (pl) {
          const next: Playlist = { ...pl, items: [...pl.items, { id: newId(), type: 'presentation', presentationId: saved.id, title }] }
          await library.savePlaylist(next)
        }
      }
      return saved
    })
  }
})
