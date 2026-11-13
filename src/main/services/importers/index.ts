/**
 * Import / export service: ProPresenter library migration (background job with progress events),
 * single-file import (drag & drop, File ▸ Open, macOS open-file), lyrics paste, exports.
 * RPC contract: src/shared/import.ts.
 */
import { app } from 'electron'
import { promises as fs, existsSync, readFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { MediaItem, Playlist, Presentation, Theme, WorkspaceConfig } from '@shared/model'
import type { FileImportResult, ImportReport } from '@shared/import'
import '@shared/import'
import { importLyricsText } from '@shared/import-lyrics'
import { mediaKindFromPath } from '@shared/media'
import { defineService, type ServiceContext } from '../../core/service'
import { guessProPresenterFolders, scanFolder } from './pipeline/scan'
import { canvasesFromSuggestions, itemsForFiles, runImport } from './pipeline/run'
import type { ImportTarget } from './pipeline/target'
import { reportToText } from './pipeline/report'
import { imagesToPresentation } from './office/pptx'
import { importReachBundle } from '../exporters/bundle-import'
import { buildReachBundle, encodeProLyrics, lyricsExport, openLyricsExport, songCsv } from '../exporters/formats'

class CoreTarget implements ImportTarget {
  constructor(private ctx: ServiceContext) {}
  get mediaDir(): string { return this.ctx.workspace.mediaDir }
  async listPresentations(): Promise<Presentation[]> { return this.ctx.library.all() }
  async getPresentation(id: string): Promise<Presentation | null> { return this.ctx.library.get(id) }
  async savePresentations(list: Presentation[]): Promise<void> {
    if (!list.length) return
    // library.save stamps updatedAt; keep our fingerprint consistent by saving as-is
    await this.ctx.library.saveMany(list)
  }
  async listPlaylists(): Promise<Playlist[]> { return this.ctx.library.listPlaylists() }
  async savePlaylist(p: Playlist): Promise<void> { await this.ctx.library.savePlaylist(p) }
  readDoc<T>(name: string, fallback: T): Promise<T> { return this.ctx.workspace.readDoc<T>(name, fallback) }
  writeDoc(name: string, value: unknown): Promise<void> { return this.ctx.workspace.writeDoc(name, value) }
  async addMedia(items: MediaItem[]): Promise<void> {
    await this.ctx.library.importMedia(items.map((i) => join(this.mediaDir, ...i.src.replace(/^workspace:/, '').split('/'))), undefined, false)
  }
  async getWorkspace(): Promise<WorkspaceConfig | null> { return this.ctx.workspace.config }
  async updateWorkspace(patch: Partial<WorkspaceConfig>): Promise<void> { await this.ctx.workspace.update(patch) }
  markOwnWrite(p: string): void { this.ctx.workspace.markOwnWrite(p) }
}

const REPORTS_INDEX = 'import-reports'
const reportDoc = (id: string): string => `import-report-${id.replace(/[^a-zA-Z0-9-]/g, '')}`

export default defineService({
  name: 'importers',
  order: 60,
  setup(ctx) {
    const { api } = ctx
    const target = new CoreTarget(ctx)
    const jobs = new Map<string, { cancelled: boolean }>()

    const saveReport = async (r: ImportReport): Promise<void> => {
      await ctx.workspace.writeDoc(reportDoc(r.id), r)
      await fs.writeFile(join(ctx.workspace.docsDir, `${reportDoc(r.id)}.txt`), reportToText(r)).catch(() => {})
      const idx = await ctx.workspace.readDoc<{ id: string; root: string; startedAt: string; totals: ImportReport['totals'] }[]>(REPORTS_INDEX, [])
      idx.unshift({ id: r.id, root: r.root, startedAt: r.startedAt, totals: r.totals })
      await ctx.workspace.writeDoc(REPORTS_INDEX, idx.slice(0, 100))
    }

    api.handle('import.guessFolders', () => guessProPresenterFolders().map((g) => ({ ...g, exists: existsSync(g.path) })), 'local')
    api.handle('import.scan', ({ root }) => scanFolder(root), 'local')
    api.handle('import.start', ({ root, options }) => {
      const jobId = `job-${Date.now().toString(36)}`
      const state = { cancelled: false }
      jobs.set(jobId, state)
      void (async () => {
        try {
          const scan = await scanFolder(root)
          api.emit('import.progress', { jobId, phase: 'scan', done: scan.items.length, total: scan.items.length })
          const report = await runImport(scan, target, options ?? {}, {
            isCancelled: () => state.cancelled,
            onProgress: (p) => api.emit('import.progress', { jobId, ...p })
          })
          if (!options?.dryRun) await saveReport(report)
          else reportCache.set(report.id, report)
          api.emit('import.done', { jobId, reportId: report.id, totals: report.totals, cancelled: report.cancelled })
          api.emit('ui.notify', { level: report.totals.failed ? 'warning' : 'success', title: options?.dryRun ? 'Dry run finished' : 'ProPresenter import finished', detail: `${report.totals.imported + report.totals.partial + report.totals.updated} presentations, ${report.playlists.length} playlists` })
        } catch (e) {
          api.emit('import.done', { jobId, reportId: '', totals: { imported: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, partial: 0 }, error: (e as Error).message })
        } finally { jobs.delete(jobId) }
      })()
      return { jobId }
    }, 'local')
    const reportCache = new Map<string, ImportReport>()
    api.handle('import.cancel', ({ jobId }) => { const j = jobs.get(jobId); if (j) j.cancelled = true }, 'local')
    api.handle('import.reports', () => ctx.workspace.readDoc(REPORTS_INDEX, []), 'local')
    api.handle('import.report', async ({ id }) => reportCache.get(id) ?? ctx.workspace.readDoc<ImportReport | null>(reportDoc(id), null), 'local')
    api.handle('import.createCanvases', async ({ reportId, names }) => {
      const r = reportCache.get(reportId) ?? (await ctx.workspace.readDoc<ImportReport | null>(reportDoc(reportId), null))
      if (!r) throw new Error('report not found')
      const add = canvasesFromSuggestions(r.suggestedCanvases, names, ctx.workspace.config.canvases)
      if (add.length) await ctx.workspace.update({ canvases: [...ctx.workspace.config.canvases, ...add] })
      return { created: add.map((c) => c.name) }
    }, 'local')

    const importFiles = async (paths: string[], options: Parameters<typeof runImport>[2] & { playlistId?: string } = {}): Promise<FileImportResult> => {
      const res: FileImportResult = { reports: [], presentationIds: [], playlistIds: [] }
      const images: string[] = []
      const rest: string[] = []
      for (const p of paths) {
        const st = await fs.stat(p).catch(() => null)
        if (st?.isDirectory()) {
          // a folder: a ProPresenter library, or an image folder → deck
          const ents = (await fs.readdir(p)).filter((f) => !f.startsWith('.')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          const imgs = ents.filter((f) => mediaKindFromPath(f) === 'image')
          if (imgs.length && imgs.length >= ents.length / 2) {
            const added = await ctx.library.importMedia(imgs.map((f) => join(p, f)), `Imported/${basename(p)}`)
            const pres = imagesToPresentation(basename(p), added.map((m) => ({ src: m.src, name: m.name })), ctx.workspace.config.defaultSize)
            await ctx.library.save(pres)
            res.presentationIds.push(pres.id)
            res.reports.push({ path: p, format: 'image-folder', status: 'imported', title: pres.title, presentationId: pres.id, warnings: [] })
          } else {
            const scan = await scanFolder(p)
            const r = await runImport(scan, target, options)
            await saveReport(r)
            res.reports.push(...r.files)
            res.presentationIds.push(...r.files.map((f) => f.presentationId!).filter(Boolean))
          }
          continue
        }
        const ext = extname(p).toLowerCase()
        if (mediaKindFromPath(p) === 'image') { images.push(p); continue }
        if (mediaKindFromPath(p)) { await ctx.library.importMedia([p]); res.reports.push({ path: p, format: 'media', status: 'imported', title: basename(p), warnings: ['added to the media bin'] }); continue }
        if (ext === '.reach' || ext === '.json') {
          try {
            const pres = JSON.parse(await fs.readFile(p, 'utf8')) as Presentation
            if (!pres?.id || !Array.isArray(pres.slides)) throw new Error('not a Reach presentation')
            await ctx.library.save(pres)
            res.presentationIds.push(pres.id)
            res.reports.push({ path: p, format: 'reach', status: 'imported', title: pres.title, presentationId: pres.id, warnings: [] })
          } catch (e) { res.reports.push({ path: p, format: 'reach', status: 'failed', warnings: [], error: (e as Error).message }) }
          continue
        }
        if (ext === '.reachbundle') {
          try {
            const r = await importReachBundle(await fs.readFile(p), target, p)
            res.reports.push(...r.reports); res.presentationIds.push(...r.presentationIds); res.playlistIds.push(...r.playlistIds)
          } catch (e) { res.reports.push({ path: p, format: 'reach-bundle', status: 'failed', warnings: [], error: (e as Error).message }) }
          continue
        }
        rest.push(p)
      }
      if (images.length) {
        const added = await ctx.library.importMedia(images, 'Imported')
        const pres = imagesToPresentation(images.length === 1 ? basename(images[0], extname(images[0])) : 'Imported images', added.map((m) => ({ src: m.src, name: m.name })), ctx.workspace.config.defaultSize)
        await ctx.library.save(pres)
        res.presentationIds.push(pres.id)
        res.reports.push({ path: images[0], format: 'image', status: 'imported', title: pres.title, presentationId: pres.id, warnings: [] })
      }
      if (rest.length) {
        const r = await runImport({ root: rest.length === 1 ? rest[0] : 'files', items: itemsForFiles(rest) }, target, options)
        res.reports.push(...r.files)
        res.presentationIds.push(...r.files.filter((f) => f.presentationId).map((f) => f.presentationId!))
        if (r.playlists.length) res.playlistIds.push(...(await target.listPlaylists()).filter((pl) => r.playlists.some((x) => x.name.endsWith(pl.name))).map((pl) => pl.id))
        if (r.totals.failed || r.files.some((f) => f.warnings.length || f.missingMedia?.length)) await saveReport(r)
      }
      // add to a playlist
      if (options.playlistId && res.presentationIds.length) {
        const pl = ctx.library.getPlaylist(options.playlistId)
        if (pl) {
          for (const id of res.presentationIds) pl.items.push({ id: `${id}-${Date.now().toString(36)}`, type: 'presentation', presentationId: id })
          await ctx.library.savePlaylist(pl)
        }
      }
      return res
    }
    api.handle('import.files', ({ paths, options }) => importFiles(paths, options), 'local')
    api.handle('import.text', async ({ title, text, meta }) => {
      const p = importLyricsText(title, text, { ...(meta ?? {}), source: { type: 'text', importedAt: new Date().toISOString() } })
      await ctx.library.save(p)
      return { id: p.id }
    }, 'control')

    // Bytes from the renderer (drag & drop of files the renderer can't give paths for).
    api.handle('import.data', async ({ name, base64 }) => {
      const dir = await fs.mkdtemp(join(tmpdir(), 'reach-drop-'))
      const safe = basename(name).replace(/[^\w .()[\]-]/g, '_') || 'dropped'
      const p = join(dir, safe)
      await fs.writeFile(p, Buffer.from(base64, 'base64'))
      try { return await importFiles([p]) } finally { void fs.rm(dir, { recursive: true, force: true }) }
    }, 'local')

    /* ── exports ── */
    const readMedia = (src: string): Uint8Array | null => {
      const rel = src.replace(/^workspace:/, '').split('/').filter((s) => s && s !== '..')
      try { return readFileSync(join(ctx.workspace.mediaDir, ...rel)) } catch { return null }
    }
    api.handle('export.run', async (req) => {
      const warnings: string[] = []
      const playlists = (req.playlistIds ?? []).map((id) => ctx.library.getPlaylist(id)).filter((p): p is Playlist => !!p)
      const ids = new Set(req.presentationIds ?? [])
      for (const pl of playlists) for (const it of pl.items) if (it.type === 'presentation') ids.add(it.presentationId)
      const pres = (ids.size ? [...ids].map((id) => ctx.library.get(id)) : req.format === 'csv' ? ctx.library.all() : []).filter((p): p is Presentation => !!p)
      let bytes: Uint8Array
      switch (req.format) {
        case 'reachbundle': {
          const themes = req.includeThemes === false ? [] : (await ctx.workspace.readDoc<Theme[]>('themes', [])).filter((t) => pres.some((p) => p.themeId === t.id))
          const b = buildReachBundle({ presentations: pres, playlists, themes, readMedia: req.includeMedia === false ? () => null : readMedia, app: `Reach Presenter ${app.getVersion()}` })
          if (b.manifest.missingMedia.length) warnings.push(`${b.manifest.missingMedia.length} media files were missing and are not in the bundle`)
          bytes = b.bytes
          break
        }
        case 'reach': case 'json': bytes = Buffer.from(JSON.stringify(pres.length === 1 ? pres[0] : pres, null, 2)); break
        case 'text': bytes = Buffer.from(pres.map((p) => lyricsExport(p)).join('\n\n----\n\n')); break
        case 'lyrics-plain': case 'chordpro-less': bytes = Buffer.from(pres.map((p) => lyricsExport(p, false)).join('\n\n')); break
        case 'csv': bytes = Buffer.from(songCsv(pres)); break
        case 'openlyrics': bytes = Buffer.from(pres.map(openLyricsExport).join('\n')); break
        case 'pro': {
          if (pres.length !== 1) throw new Error('choose one presentation to export as .pro')
          bytes = encodeProLyrics(pres[0])
          warnings.push('Experimental: lyrics-only .pro (groups, arrangements, text). Formatting, media and cues are not exported.')
          break
        }
        default: throw new Error(`unknown export format ${String(req.format)}`)
      }
      await fs.writeFile(req.path, bytes)
      return { path: req.path, bytes: bytes.length, warnings }
    }, 'local')
    api.handle('export.reportText', async ({ id, path }) => {
      const r = reportCache.get(id) ?? (await ctx.workspace.readDoc<ImportReport | null>(reportDoc(id), null))
      if (!r) throw new Error('report not found')
      await fs.writeFile(path, reportToText(r))
    }, 'local')

    /* ── macOS: double-click / "Open With" on .reach, .reachbundle, .pro, .probundle … ── */
    const pendingOpen: string[] = []
    const openFile = (p: string): void => {
      void importFiles([p]).then((r) => {
        const ok = r.reports.filter((x) => x.status !== 'failed')
        api.emit('ui.notify', { level: ok.length ? 'success' : 'error', title: ok.length ? `Imported ${basename(p)}` : `Could not open ${basename(p)}`, detail: r.reports.find((x) => x.error)?.error })
        api.emit('import.opened', r)
      })
    }
    app.on('open-file', (e, p) => { e.preventDefault(); if (app.isReady()) openFile(p); else pendingOpen.push(p) })
    for (const p of pendingOpen.splice(0)) openFile(p)
    // Windows/Linux: file paths on the command line
    for (const a of process.argv.slice(1)) if (/\.(reach|reachbundle|probundle|proplaylist|pro6?)$/i.test(a) && existsSync(a)) openFile(a)
  }
})

