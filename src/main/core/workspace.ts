import { app } from 'electron'
import { join } from 'node:path'
import { promises as fs, watch, type FSWatcher } from 'node:fs'
import type { WorkspaceConfig } from '@shared/model'
import { api } from './api'
import { local } from './local'
import { debounce, newId, readJson, writeJson } from './files'

/**
 * The workspace is a plain folder — everything that should be the same on every
 * Reach computer lives here, as human-readable files:
 *
 *   <workspace>/workspace.json        canvases, defaults
 *   <workspace>/library/*.reach       presentations (JSON)
 *   <workspace>/playlists/*.json      service plans
 *   <workspace>/media/                media files (referenced as `workspace:<relative path>`)
 *   <workspace>/media/index.json      media bin metadata
 *   <workspace>/docs/<name>.json      themes, macros, stage layouts, timers, bibles config...
 *
 * Because it's just a folder, it can live in iCloud Drive / Dropbox / Google Drive /
 * Syncthing, or be synced by the built-in cloud sync service. All writes are atomic
 * and external changes are picked up by file watchers.
 */
class Workspace {
  root = ''
  config!: WorkspaceConfig
  private watchers: FSWatcher[] = []
  /** Paths we wrote ourselves recently — so watchers can ignore our own writes. */
  private ownWrites = new Map<string, number>()

  get libraryDir(): string { return join(this.root, 'library') }
  get playlistsDir(): string { return join(this.root, 'playlists') }
  get mediaDir(): string { return join(this.root, 'media') }
  get docsDir(): string { return join(this.root, 'docs') }

  async init(): Promise<void> {
    this.root = process.env.REACH_WORKSPACE || local.get('workspacePath', '') || join(app.getPath('documents'), 'Reach Presenter')
    await this.open(this.root)
  }

  async open(root: string): Promise<void> {
    this.close()
    this.root = root
    for (const d of [this.root, this.libraryDir, this.playlistsDir, this.mediaDir, this.docsDir]) await fs.mkdir(d, { recursive: true })
    this.config = await readJson<WorkspaceConfig>(join(root, 'workspace.json'), defaultWorkspace())
    if (!this.config.canvases?.length) this.config.canvases = defaultWorkspace().canvases
    await this.save()
    this.watch(root, (file) => {
      if (file === 'workspace.json') void this.reloadConfig()
    })
    this.watch(this.docsDir, (file) => {
      if (file.endsWith('.json')) api.emit('workspace.docChanged', { name: file.replace(/\.json$/, '') })
    })
  }

  private async reloadConfig(): Promise<void> {
    this.config = await readJson<WorkspaceConfig>(join(this.root, 'workspace.json'), this.config)
    api.emit('workspace.changed', this.config)
  }

  async save(): Promise<void> {
    await this.write(join(this.root, 'workspace.json'), this.config)
  }

  async update(patch: Partial<WorkspaceConfig>): Promise<WorkspaceConfig> {
    this.config = { ...this.config, ...patch, version: 1 }
    await this.save()
    api.emit('workspace.changed', this.config)
    return this.config
  }

  async readDoc<T>(name: string, fallback: T): Promise<T> {
    return readJson<T>(join(this.docsDir, `${safeName(name)}.json`), fallback)
  }

  async writeDoc(name: string, value: unknown): Promise<void> {
    await this.write(join(this.docsDir, `${safeName(name)}.json`), value)
    api.emit('workspace.docChanged', { name })
  }

  /** Atomic JSON write that file watchers will recognise as our own. */
  async write(path: string, value: unknown): Promise<void> {
    this.ownWrites.set(path, Date.now())
    await writeJson(path, value)
  }

  markOwnWrite(path: string): void {
    this.ownWrites.set(path, Date.now())
  }

  isOwnWrite(path: string): boolean {
    const t = this.ownWrites.get(path)
    return !!t && Date.now() - t < 1500
  }

  /** Watch a directory for EXTERNAL changes (cloud sync, another computer, manual edits). */
  watch(dir: string, onChange: (file: string) => void): void {
    try {
      const pending = new Set<string>()
      const flush = debounce(() => {
        const files = [...pending]
        pending.clear()
        for (const f of files) if (!this.isOwnWrite(join(dir, f))) onChange(f)
      }, 300)
      const w = watch(dir, (_ev, file) => {
        if (!file || file.endsWith('.tmp') || file.startsWith('.')) return
        pending.add(file.toString())
        flush()
      })
      this.watchers.push(w)
    } catch (e) {
      console.warn('[workspace] cannot watch', dir, e)
    }
  }

  close(): void {
    for (const w of this.watchers) w.close()
    this.watchers = []
  }
}

const safeName = (n: string): string => n.replace(/[^a-zA-Z0-9._-]/g, '_')

export function defaultWorkspace(): WorkspaceConfig {
  return {
    version: 1,
    name: 'Reach',
    defaultSize: { width: 1920, height: 1080 },
    canvases: [
      { id: 'main', name: 'Main Screen', kind: 'audience', width: 1920, height: 1080, regions: [], color: '#3886CE' },
      { id: 'stage', name: 'Stage Display', kind: 'stage', width: 1920, height: 1080, regions: [], color: '#E6A20F' }
    ]
  }
}

export const workspace = new Workspace()

export function registerWorkspaceApi(): void {
  api.handle('workspace.get', () => workspace.config, 'public')
  api.handle('workspace.update', (patch) => workspace.update(patch))
  api.handle('workspace.readDoc', ({ name }) => workspace.readDoc<unknown>(name, null), 'public')
  api.handle('workspace.writeDoc', ({ name, value }) => workspace.writeDoc(name, value))
  api.handle('local.get', ({ key }) => (key.startsWith('secret:') ? null : local.get<unknown>(key, null)), 'local')
  api.handle('local.set', ({ key, value }) => { if (!key.startsWith('secret:')) local.set(key, value) }, 'local')
}

export { newId }
