import { join, basename, extname, relative, sep } from 'node:path'
import { promises as fs } from 'node:fs'
import type { ID, MediaItem, Playlist, Presentation, Slide, TextElement } from '@shared/model'
import { DEFAULT_SIZE, slideText, textToParagraphs } from '@shared/model'
import type { PresentationSummary } from '@shared/api'
import { mediaKindFromPath } from '@shared/media'
import { api } from './api'
import { newId, readJson } from './files'
import { workspace } from './workspace'

/** Presentations, playlists and the media bin — all stored as files in the workspace. */
class Library {
  private presentations = new Map<ID, Presentation>()
  private playlists = new Map<ID, Playlist>()
  private media: MediaItem[] = []

  async init(): Promise<void> {
    await this.loadAll()
    workspace.watch(workspace.libraryDir, async (file) => {
      if (!file.endsWith('.reach')) return
      const id = file.replace(/\.reach$/, '')
      const p = await readJson<Presentation | null>(join(workspace.libraryDir, file), null)
      if (p) this.presentations.set(p.id, p)
      else this.presentations.delete(id)
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

  async loadAll(): Promise<void> {
    this.presentations.clear()
    this.playlists.clear()
    for (const f of await fs.readdir(workspace.libraryDir).catch(() => [])) {
      if (!f.endsWith('.reach')) continue
      const p = await readJson<Presentation | null>(join(workspace.libraryDir, f), null)
      if (p?.id) this.presentations.set(p.id, p)
    }
    for (const f of await fs.readdir(workspace.playlistsDir).catch(() => [])) {
      if (!f.endsWith('.json')) continue
      const p = await readJson<Playlist | null>(join(workspace.playlistsDir, f), null)
      if (p?.id) this.playlists.set(p.id, p)
    }
    this.media = await readJson<MediaItem[]>(join(workspace.mediaDir, 'index.json'), [])
  }

  /* ── presentations ── */

  summaries(): PresentationSummary[] {
    return [...this.presentations.values()].map(summarize).sort((a, b) => a.title.localeCompare(b.title))
  }

  get(id: ID): Presentation | null {
    return this.presentations.get(id) ?? null
  }

  all(): Presentation[] {
    return [...this.presentations.values()]
  }

  async save(p: Presentation, opts: { silent?: boolean } = {}): Promise<Presentation> {
    p.updatedAt = new Date().toISOString()
    if (!p.createdAt) p.createdAt = p.updatedAt
    this.presentations.set(p.id, p)
    await workspace.write(join(workspace.libraryDir, `${p.id}.reach`), p)
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
    for (const p of this.presentations.values()) {
      const title = p.title.toLowerCase()
      let score = title.startsWith(needle) ? 100 : title.includes(needle) ? 60 : 0
      if (!score) {
        const body = p.slides.map((s) => slideText(s)).join('\n').toLowerCase()
        if (body.includes(needle)) score = 20
        else if (String(p.meta.ccliNumber ?? '') === needle) score = 90
      }
      if (score) hits.push({ s: summarize(p), score })
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
