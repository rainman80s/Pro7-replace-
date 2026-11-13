import { join, basename, extname, relative, sep } from 'node:path'
import { promises as fs, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { app } from 'electron'
import type { ID, MediaItem, Playlist, Presentation, Slide, TextElement } from '@shared/model'
import { DEFAULT_SIZE, slideText, textToParagraphs } from '@shared/model'
import type { PresentationSummary } from '@shared/api'
import { mediaKindFromPath } from '@shared/media'
import { api } from './api'
import { newId, readJson, writeJson, debounce } from './files'
import { workspace } from './workspace'

/** What the library list needs per file, cached so the list can appear before any .reach file is parsed. */
interface IndexEntry {
  file: string
  mtimeMs: number
  size: number
  summary: PresentationSummary
  /** Lower-cased slide text (capped) for full-text search without loading the presentation. */
  body: string
}
const INDEX_VERSION = 1
const BODY_CAP = 6000
const LOADED_CAP = 80
const SCAN_CONCURRENCY = 8

/** Run `fn` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

/**
 * Presentations, playlists and the media bin — all stored as files in the workspace.
 *
 * Startup is index-first: a compact per-machine index (summaries + mtime/size per file, in userData —
 * mtimes differ per machine so it must not be synced) answers `library.list` immediately; a background
 * scan then re-reads only files whose mtime/size changed and emits `library.changed`. Full presentations
 * load lazily on `get()` and are kept in a small cache.
 */
class Library {
  /** Presentations loaded in full (lazy, capped; recently saved/opened ones). */
  private presentations = new Map<ID, Presentation>()
  private entries = new Map<string, IndexEntry>() // by file name
  private fileById = new Map<ID, string>()
  private playlists = new Map<ID, Playlist>()
  private media: MediaItem[] = []
  private scanning: Promise<void> | null = null
  private indexPath = ''

  async init(): Promise<void> {
    this.indexPath = join(app.getPath('userData'), `library-index-${createHash('sha1').update(workspace.root).digest('hex').slice(0, 10)}.json`)
    await this.loadIndex()
    // Playlists and the media bin are small; presentations are not, so they are never awaited here.
    await this.loadSmall()
    void this.scan().catch((e) => console.warn('[library] scan failed', e))
    workspace.watch(workspace.libraryDir, async (file) => {
      if (!file.endsWith('.reach')) return
      const id = file.replace(/\.reach$/, '')
      await this.refreshFile(file)
      api.emit('library.changed', { ids: [id] })
    })
    workspace.watch(workspace.playlistsDir, async (file) => {
      if (!file.endsWith('.json')) return
      const id = file.replace(/\.json$/, '')
      const p = await readJson<Playlist | null>(join(workspace.playlistsDir, file), null)
      if (p) this.playlists.set(p.id, p)
      else this.playlists.delete(id)
      api.emit('playlists.changed', { ids: [id] })
    })
    workspace.watch(workspace.mediaDir, async (file) => {
      if (file === 'index.json') {
        this.media = await readJson<MediaItem[]>(join(workspace.mediaDir, 'index.json'), this.media)
        api.emit('media.changed')
      }
    })
  }

  private async loadIndex(): Promise<void> {
    this.entries.clear()
    this.fileById.clear()
    const idx = await readJson<{ v: number; root: string; entries: IndexEntry[] } | null>(this.indexPath, null)
    if (!idx || idx.v !== INDEX_VERSION || idx.root !== workspace.root) return
    for (const e of idx.entries) this.setEntry(e)
  }

  private setEntry(e: IndexEntry): void {
    const old = this.entries.get(e.file)
    if (old && old.summary.id !== e.summary.id) this.fileById.delete(old.summary.id)
    this.entries.set(e.file, e)
    this.fileById.set(e.summary.id, e.file)
  }
  private dropEntry(file: string): void {
    const old = this.entries.get(file)
    if (old) this.fileById.delete(old.summary.id)
    this.entries.delete(file)
  }

  private saveIndex = debounce(() => {
    void writeJson(this.indexPath, { v: INDEX_VERSION, root: workspace.root, entries: [...this.entries.values()] }).catch(() => undefined)
  }, 1500)

  private async loadSmall(): Promise<void> {
    this.playlists.clear()
    const files = (await fs.readdir(workspace.playlistsDir).catch(() => [] as string[])).filter((f) => f.endsWith('.json'))
    await pool(files, SCAN_CONCURRENCY, async (f) => {
      const p = await readJson<Playlist | null>(join(workspace.playlistsDir, f), null)
      if (p?.id) this.playlists.set(p.id, p)
    })
    this.media = await readJson<MediaItem[]>(join(workspace.mediaDir, 'index.json'), [])
  }

  /** (Re)read one file into the index; returns the parsed presentation (not cached unless already loaded). */
  private async refreshFile(file: string): Promise<Presentation | null> {
    const path = join(workspace.libraryDir, file)
    try {
      const [st, text] = await Promise.all([fs.stat(path), fs.readFile(path, 'utf8')])
      const p = JSON.parse(text) as Presentation
      if (!p?.id) throw new Error('no id')
      this.setEntry(entryFor(file, st.mtimeMs, st.size, p))
      if (this.presentations.has(p.id)) this.presentations.set(p.id, p)
      this.saveIndex()
      return p
    } catch {
      const old = this.entries.get(file)
      if (old) this.presentations.delete(old.summary.id)
      this.dropEntry(file)
      this.saveIndex()
      return null
    }
  }

  /** Validate the index against the folder: parse only new/changed files, drop vanished ones. */
  scan(): Promise<void> {
    return (this.scanning ??= this.doScan().finally(() => { this.scanning = null }))
  }
  private async doScan(): Promise<void> {
    const t0 = Date.now()
    const files = (await fs.readdir(workspace.libraryDir).catch(() => [] as string[])).filter((f) => f.endsWith('.reach'))
    const seen = new Set(files)
    const changed: string[] = []
    await pool(files, 32, async (f) => {
      const st = await fs.stat(join(workspace.libraryDir, f)).catch(() => null)
      const e = this.entries.get(f)
      if (st && (!e || e.mtimeMs !== st.mtimeMs || e.size !== st.size)) changed.push(f)
    })
    const ids = new Set<ID>()
    for (const f of [...this.entries.keys()]) if (!seen.has(f)) { ids.add(this.entries.get(f)!.summary.id); this.presentations.delete(this.entries.get(f)!.summary.id); this.dropEntry(f) }
    let done = 0
    let lastEmit = Date.now()
    await pool(changed, SCAN_CONCURRENCY, async (f) => {
      const p = await this.refreshFile(f)
      if (p) ids.add(p.id)
      // First run (no index): show progress instead of an empty list for the whole scan.
      if (++done % 200 === 0 && Date.now() - lastEmit > 400) { lastEmit = Date.now(); api.emit('library.changed', {}) }
    })
    this.saveIndex()
    console.log(`[library] scan ${Date.now() - t0}ms: ${files.length} files, ${changed.length} re-read, ${ids.size} changed`)
    if (ids.size || changed.length) api.emit('library.changed', { ids: [...ids] })
  }

  /** True when the library folder has no presentations (cheap; doesn't parse anything). */
  async isEmpty(): Promise<boolean> {
    return !(await fs.readdir(workspace.libraryDir).catch(() => [] as string[])).some((f) => f.endsWith('.reach'))
  }

  /** Back-compat: force a full rescan. */
  async loadAll(): Promise<void> {
    this.entries.clear(); this.fileById.clear(); this.presentations.clear()
    await this.loadSmall()
    await this.scan()
  }

  /* ── presentations ── */

  summaries(): PresentationSummary[] {
    return [...this.entries.values()].map((e) => e.summary).sort((a, b) => a.title.localeCompare(b.title))
  }

  /** Full presentation. Loaded from disk on first use (one small synchronous read) and cached. */
  get(id: ID): Presentation | null {
    const hit = this.presentations.get(id)
    if (hit) return hit
    const file = this.fileById.get(id) ?? `${id}.reach`
    try {
      const p = JSON.parse(readFileSync(join(workspace.libraryDir, file), 'utf8')) as Presentation
      if (!p?.id) return null
      this.remember(p)
      if (!this.entries.has(file)) {
        const st = statSync(join(workspace.libraryDir, file))
        this.setEntry(entryFor(file, st.mtimeMs, st.size, p))
        this.saveIndex()
      }
      return p
    } catch {
      return null
    }
  }

  private remember(p: Presentation): void {
    this.presentations.delete(p.id)
    this.presentations.set(p.id, p)
    while (this.presentations.size > LOADED_CAP) this.presentations.delete(this.presentations.keys().next().value as ID)
  }

  /** Every presentation in full. Slow on big libraries (loads them all) — prefer summaries()/search(). */
  all(): Presentation[] {
    return [...this.entries.values()].map((e) => this.get(e.summary.id)).filter((p): p is Presentation => !!p)
  }

  async save(p: Presentation, opts: { silent?: boolean } = {}): Promise<Presentation> {
    p.updatedAt = new Date().toISOString()
    if (!p.createdAt) p.createdAt = p.updatedAt
    this.remember(p)
    const file = `${p.id}.reach`
    await workspace.write(join(workspace.libraryDir, file), p)
    const st = await fs.stat(join(workspace.libraryDir, file)).catch(() => null)
    if (st) { this.setEntry(entryFor(file, st.mtimeMs, st.size, p)); this.saveIndex() }
    if (!opts.silent) api.emit('library.changed', { ids: [p.id] })
    return p
  }

  /** Save many at once (imports) with a single change event. */
  async saveMany(list: Presentation[]): Promise<void> {
    for (const p of list) await this.save(p, { silent: true })
    api.emit('library.changed', { ids: list.map((p) => p.id) })
  }

  async create(title: string, kind?: Presentation['kind'], text?: string): Promise<Presentation> {
    const p = newPresentation(title, kind)
    if (text?.trim()) {
      // Blank line = new slide. A line like "Verse 1" / "Chorus" on its own starts a group.
      const blocks = text.replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
      let group = null as null | Presentation['groups'][number]
      for (const block of blocks) {
        const lines = block.split('\n')
        const m = /^\[?\s*((verse|chorus|bridge|pre-?chorus|intro|outro|tag|ending|interlude|refrain|vamp|turnaround)\s*\d*)\s*\]?:?$/i.exec(lines[0].trim())
        if (m) {
          group = { id: newId(), name: titleCase(m[1]), color: groupColor(m[1]), slideIds: [] }
          p.groups.push(group)
          lines.shift()
          if (!lines.length) continue
        }
        const s = lyricSlide(lines.join('\n'))
        p.slides.push(s)
        if (group) group.slideIds.push(s.id)
      }
    }
    if (!p.slides.length) p.slides.push(lyricSlide(''))
    return this.save(p)
  }

  async delete(id: ID): Promise<void> {
    this.presentations.delete(id)
    this.dropEntry(this.fileById.get(id) ?? `${id}.reach`)
    this.saveIndex()
    await fs.rm(join(workspace.libraryDir, `${id}.reach`), { force: true })
    api.emit('library.changed', { ids: [id] })
  }

  async duplicate(id: ID): Promise<Presentation> {
    const src = this.get(id)
    if (!src) throw new Error('Presentation not found')
    const copy: Presentation = JSON.parse(JSON.stringify(src))
    copy.id = newId()
    copy.title = `${src.title} copy`
    copy.createdAt = ''
    return this.save(copy)
  }

  search(q: string): PresentationSummary[] {
    const needle = q.trim().toLowerCase()
    if (!needle) return this.summaries()
    const hits: { s: PresentationSummary; score: number }[] = []
    for (const e of this.entries.values()) {
      const title = e.summary.title.toLowerCase()
      let score = title.startsWith(needle) ? 100 : title.includes(needle) ? 60 : 0
      if (!score) {
        if (e.body.includes(needle)) score = 20
        else if (String(e.summary.ccliNumber ?? '') === needle) score = 90
      }
      if (score) hits.push({ s: e.summary, score })
    }
    return hits.sort((a, b) => b.score - a.score || a.s.title.localeCompare(b.s.title)).map((h) => h.s)
  }

  /* ── playlists ── */

  listPlaylists(): Playlist[] {
    return [...this.playlists.values()].sort((a, b) => (b.date ?? b.updatedAt).localeCompare(a.date ?? a.updatedAt))
  }
  getPlaylist(id: ID): Playlist | null {
    return this.playlists.get(id) ?? null
  }
  async savePlaylist(p: Playlist): Promise<Playlist> {
    p.updatedAt = new Date().toISOString()
    this.playlists.set(p.id, p)
    await workspace.write(join(workspace.playlistsDir, `${p.id}.json`), p)
    api.emit('playlists.changed', { ids: [p.id] })
    return p
  }
  async deletePlaylist(id: ID): Promise<void> {
    this.playlists.delete(id)
    await fs.rm(join(workspace.playlistsDir, `${id}.json`), { force: true })
    api.emit('playlists.changed', { ids: [id] })
  }

  /* ── media bin ── */

  listMedia(): MediaItem[] {
    return this.media
  }
  private async saveMedia(): Promise<void> {
    await workspace.write(join(workspace.mediaDir, 'index.json'), this.media)
    api.emit('media.changed')
  }
  /** Add files to the media bin. By default they're copied into the workspace so every computer gets them. */
  async importMedia(paths: string[], folder?: string, copy = true): Promise<MediaItem[]> {
    const added: MediaItem[] = []
    for (const path of paths) {
      const kind = mediaKindFromPath(path)
      if (!kind) continue
      let src: string
      const rel = relative(workspace.mediaDir, path)
      if (!rel.startsWith('..') && !rel.startsWith(sep)) {
        src = 'workspace:' + rel.split(sep).join('/')
      } else if (copy) {
        let name = basename(path)
        const dir = join(workspace.mediaDir, folder ?? '')
        await fs.mkdir(dir, { recursive: true })
        let n = 1
        while (await fs.stat(join(dir, name)).then(() => true, () => false)) {
          name = `${basename(path, extname(path))}-${++n}${extname(path)}`
        }
        workspace.markOwnWrite(join(dir, name))
        await fs.copyFile(path, join(dir, name))
        src = 'workspace:' + [folder, name].filter(Boolean).join('/')
      } else {
        src = 'file:' + path
      }
      const existing = this.media.find((m) => m.src === src)
      if (existing) { added.push(existing); continue }
      const item: MediaItem = {
        id: newId(), kind, src, name: basename(path, extname(path)), folder,
        behavior: kind === 'video' || kind === 'image' ? 'background' : undefined,
        loop: kind === 'video' ? true : undefined,
        addedAt: new Date().toISOString()
      }
      this.media.push(item)
      added.push(item)
    }
    await this.saveMedia()
    return added
  }
  /** Replace the whole media bin (used for batched metadata updates). */
  async replaceMedia(list: MediaItem[]): Promise<void> {
    this.media = list
    await this.saveMedia()
  }
  async updateMedia(item: MediaItem): Promise<MediaItem> {
    const i = this.media.findIndex((m) => m.id === item.id)
    if (i >= 0) this.media[i] = item
    else this.media.push(item)
    await this.saveMedia()
    return item
  }
  async removeMedia(id: ID): Promise<void> {
    this.media = this.media.filter((m) => m.id !== id)
    await this.saveMedia()
  }
}

function entryFor(file: string, mtimeMs: number, size: number, p: Presentation): IndexEntry {
  return { file, mtimeMs, size, summary: summarize(p), body: p.slides.map((sl) => slideText(sl)).join('\n').toLowerCase().slice(0, BODY_CAP) }
}

function summarize(p: Presentation): PresentationSummary {
  return {
    id: p.id, title: p.title, kind: p.kind, slideCount: p.slides.length, updatedAt: p.updatedAt,
    category: p.meta.category, artist: p.meta.artist ?? p.meta.author, ccliNumber: p.meta.ccliNumber,
    excerpt: p.slides.slice(0, 2).map((s) => slideText(s)).join(' / ').slice(0, 140)
  }
}

export function newPresentation(title: string, kind?: Presentation['kind']): Presentation {
  const now = new Date().toISOString()
  return {
    id: newId(), title, kind: kind ?? 'generic', size: { ...(workspace.config?.defaultSize ?? DEFAULT_SIZE) },
    slides: [], groups: [], arrangements: [], meta: {}, createdAt: now, updatedAt: now
  }
}

/** A standard centered lyric slide in Reach's default look. */
export function lyricSlide(text: string, size = DEFAULT_SIZE): Slide {
  const el: TextElement = {
    id: newId(), type: 'text', role: 'lyrics', name: 'Lyrics',
    frame: { x: size.width * 0.08, y: size.height * 0.1, w: size.width * 0.84, h: size.height * 0.8 },
    paragraphs: textToParagraphs(text), align: 'center', verticalAlign: 'middle', autoFit: true,
    style: { fontFamily: 'Reach Sans', fontSize: Math.round(size.height * 0.085), fontWeight: 600, color: '#FFFFFF', lineHeight: 1.2 }
  }
  return { id: newId(), elements: [el] }
}

const GROUP_COLORS: Record<string, string> = {
  verse: '#3886CE', chorus: '#E6A20F', bridge: '#9B6BD3', 'pre-chorus': '#4FA88B', prechorus: '#4FA88B',
  intro: '#7A7A7A', outro: '#7A7A7A', tag: '#D8674F', ending: '#7A7A7A', interlude: '#7A7A7A',
  refrain: '#E6A20F', vamp: '#D8674F', turnaround: '#7A7A7A'
}
export function groupColor(name: string): string {
  const k = name.toLowerCase().replace(/\s*\d+$/, '').trim()
  return GROUP_COLORS[k] ?? '#7A7A7A'
}
const titleCase = (s: string): string => s.toLowerCase().replace(/(^|\s|-)\w/g, (c) => c.toUpperCase())

export const library = new Library()

export function registerLibraryApi(): void {
  api.handle('library.list', () => library.summaries(), 'control')
  api.handle('library.get', ({ id }) => library.get(id), 'control')
  api.handle('library.save', ({ presentation }) => library.save(presentation))
  api.handle('library.create', ({ title, kind, text }) => library.create(title, kind, text))
  api.handle('library.delete', ({ id }) => library.delete(id))
  api.handle('library.duplicate', ({ id }) => library.duplicate(id))
  api.handle('library.search', ({ q }) => library.search(q))
  api.handle('playlists.list', () => library.listPlaylists())
  api.handle('playlists.get', ({ id }) => library.getPlaylist(id))
  api.handle('playlists.save', ({ playlist }) => library.savePlaylist(playlist))
  api.handle('playlists.delete', ({ id }) => library.deletePlaylist(id))
  api.handle('media.list', () => library.listMedia())
  api.handle('media.import', ({ paths, folder, copy }) => library.importMedia(paths, folder, copy), 'local')
  api.handle('media.update', ({ item }) => library.updateMedia(item))
  api.handle('media.remove', ({ id }) => library.removeMedia(id))
}
