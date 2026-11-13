/**
 * Where imports go. The app uses CoreTarget (library + workspace singletons, emits change events);
 * the CLI and tests use FolderTarget, which writes the same on-disk workspace layout directly.
 * Keeping the pipeline behind this interface means it has no Electron dependency.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { MediaItem, Playlist, Presentation, WorkspaceConfig } from '@shared/model'
import { mediaKindFromPath } from '@shared/media'

export interface ImportTarget {
  /** Absolute path of the workspace media folder (files copied here are referenced as `workspace:<rel>`). */
  mediaDir: string
  listPresentations(): Promise<Presentation[]>
  getPresentation(id: string): Promise<Presentation | null>
  savePresentations(list: Presentation[]): Promise<void>
  listPlaylists(): Promise<Playlist[]>
  savePlaylist(p: Playlist): Promise<void>
  readDoc<T>(name: string, fallback: T): Promise<T>
  writeDoc(name: string, value: unknown): Promise<void>
  /** Register files already copied under mediaDir in the media bin. */
  addMedia(items: MediaItem[]): Promise<void>
  getWorkspace(): Promise<WorkspaceConfig | null>
  updateWorkspace?(patch: Partial<WorkspaceConfig>): Promise<void>
  /** Called before writing a file into mediaDir (lets the app ignore its own writes in watchers). */
  markOwnWrite?(path: string): void
}

const readJson = async <T>(p: string, fb: T): Promise<T> => {
  try { return JSON.parse(await fs.readFile(p, 'utf8')) as T } catch { return fb }
}
const writeJson = async (p: string, v: unknown): Promise<void> => {
  await fs.mkdir(join(p, '..'), { recursive: true })
  const tmp = `${p}.${randomBytes(4).toString('hex')}.tmp`
  await fs.writeFile(tmp, JSON.stringify(v, null, 2))
  await fs.rename(tmp, p)
}
const safeName = (n: string): string => n.replace(/[^a-zA-Z0-9._-]/g, '_')

/** A Reach workspace folder on disk (same layout as main/core/workspace.ts). */
export class FolderTarget implements ImportTarget {
  constructor(public root: string) {}
  get mediaDir(): string { return join(this.root, 'media') }
  private get lib(): string { return join(this.root, 'library') }
  private get pls(): string { return join(this.root, 'playlists') }

  async listPresentations(): Promise<Presentation[]> {
    const out: Presentation[] = []
    for (const f of await fs.readdir(this.lib).catch(() => [] as string[])) {
      if (!f.endsWith('.reach')) continue
      const p = await readJson<Presentation | null>(join(this.lib, f), null)
      if (p?.id) out.push(p)
    }
    return out
  }
  getPresentation(id: string): Promise<Presentation | null> { return readJson(join(this.lib, `${safeName(id)}.reach`), null) }
  async savePresentations(list: Presentation[]): Promise<void> {
    for (const p of list) await writeJson(join(this.lib, `${safeName(p.id)}.reach`), p)
  }
  async listPlaylists(): Promise<Playlist[]> {
    const out: Playlist[] = []
    for (const f of await fs.readdir(this.pls).catch(() => [] as string[])) {
      if (!f.endsWith('.json')) continue
      const p = await readJson<Playlist | null>(join(this.pls, f), null)
      if (p?.id) out.push(p)
    }
    return out
  }
  async savePlaylist(p: Playlist): Promise<void> { await writeJson(join(this.pls, `${safeName(p.id)}.json`), p) }
  readDoc<T>(name: string, fallback: T): Promise<T> { return readJson(join(this.root, 'docs', `${safeName(name)}.json`), fallback) }
  async writeDoc(name: string, value: unknown): Promise<void> { await writeJson(join(this.root, 'docs', `${safeName(name)}.json`), value) }
  async addMedia(items: MediaItem[]): Promise<void> {
    const idx = join(this.mediaDir, 'index.json')
    const cur = await readJson<MediaItem[]>(idx, [])
    const seen = new Set(cur.map((m) => m.src))
    for (const it of items) if (!seen.has(it.src)) { cur.push(it); seen.add(it.src) }
    await writeJson(idx, cur)
  }
  getWorkspace(): Promise<WorkspaceConfig | null> { return readJson(join(this.root, 'workspace.json'), null) }
  async updateWorkspace(patch: Partial<WorkspaceConfig>): Promise<void> {
    const cur = (await this.getWorkspace()) ?? ({ version: 1, name: 'Reach', canvases: [], defaultSize: { width: 1920, height: 1080 } } as WorkspaceConfig)
    await writeJson(join(this.root, 'workspace.json'), { ...cur, ...patch, version: 1 })
  }
}

/** A target that records everything in memory and writes nothing (dry runs, CLI inspection). */
export class DryRunTarget implements ImportTarget {
  mediaDir = ''
  presentations = new Map<string, Presentation>()
  playlists: Playlist[] = []
  docs = new Map<string, unknown>()
  media: MediaItem[] = []
  constructor(private base?: ImportTarget) { this.mediaDir = base?.mediaDir ?? '' }
  async listPresentations(): Promise<Presentation[]> { return [...(await this.base?.listPresentations() ?? []), ...this.presentations.values()] }
  async getPresentation(id: string): Promise<Presentation | null> { return this.presentations.get(id) ?? (await this.base?.getPresentation(id)) ?? null }
  async savePresentations(list: Presentation[]): Promise<void> { for (const p of list) this.presentations.set(p.id, p) }
  async listPlaylists(): Promise<Playlist[]> { return [...(await this.base?.listPlaylists() ?? []), ...this.playlists] }
  async savePlaylist(p: Playlist): Promise<void> { this.playlists.push(p) }
  async readDoc<T>(name: string, fallback: T): Promise<T> { return (this.docs.get(name) as T) ?? (await this.base?.readDoc(name, fallback)) ?? fallback }
  async writeDoc(name: string, value: unknown): Promise<void> { this.docs.set(name, value) }
  async addMedia(items: MediaItem[]): Promise<void> { this.media.push(...items) }
  async getWorkspace(): Promise<WorkspaceConfig | null> { return (await this.base?.getWorkspace()) ?? null }
}

export function mediaItemFor(rel: string, name: string, extra: Partial<MediaItem> = {}): MediaItem | null {
  const kind = mediaKindFromPath(rel)
  if (!kind) return null
  return {
    id: randomBytes(8).toString('hex'), kind, src: `workspace:${rel}`, name, folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : undefined,
    behavior: kind === 'audio' ? undefined : 'background', loop: kind === 'video' ? true : undefined, addedAt: new Date().toISOString(), ...extra
  }
}
