/**
 * The import pipeline: scan result (or a list of files) → converted presentations, playlists, media and
 * workspace docs written to an ImportTarget, with a per-file report. Never throws for a single bad file;
 * yields to the event loop between files so the app stays responsive while it chews through thousands.
 */
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Canvas, Playlist, Presentation } from '@shared/model'
import type { FileReport, FileStatus, ImportCategory, ImportFormat, ImportOptions, ImportProgress, ImportReport, ImportScan, ImportScanItem } from '@shared/import'
import type { PP7Url } from '../pp7/context'
import { ConvertContext } from '../pp7/context'
import { contentFingerprint } from '../pp7/presentation'
import { decodePP7, idFromUuid } from '../pp7/proto'
import { convertGroups, convertLabels, convertMacros, convertMessages, convertProps, convertStageLayouts, convertTheme, convertTimers, suggestCanvases, summarizeDevices } from '../pp7/config'
import { newImportId } from '@shared/import-lyrics'
import { convertBytes, convertPlaylists, type ConvertedDoc } from './convert'
import { clearBundleEntries, MediaResolver } from './media'
import type { ImportTarget } from './target'
import { extractPresentationBlobs } from './database'

export interface RunHooks {
  onProgress?(p: Omit<ImportProgress, 'jobId'>): void
  isCancelled?(): boolean
  /** Files converted between event-loop yields (default 8). */
  chunk?: number
}

const CONFIG_TYPES: Record<string, string> = {
  Workspace: 'rv.data.ProPresenterWorkspace', Stage: 'rv.data.Stage.Document', Macros: 'rv.data.MacrosDocument', Props: 'rv.data.PropDocument',
  Timers: 'rv.data.TimersDocument', Groups: 'rv.data.ProGroupsDocument', Labels: 'rv.data.ProLabelsDocument', Messages: 'rv.data.MessageDocument',
  ClearGroups: 'rv.data.ClearGroupsDocument', CCLI: 'rv.data.CCLIDocument', KeyMappings: 'rv.data.KeyMappingDocument',
  CommunicationDevices: 'rv.data.ProPresenterCommunications', TestPatterns: 'rv.data.TestPatternDocument'
}
const CONFIG_CATEGORY: Record<string, ImportCategory> = { Macros: 'macros', Props: 'props', Stage: 'stageLayouts', Timers: 'timers', Messages: 'messages', Workspace: 'canvases', CommunicationDevices: 'devices', Groups: 'groups', Labels: 'labels' }

const yieldNow = (): Promise<void> => new Promise((r) => setImmediate(r))
const emptyTotals = (): Record<FileStatus, number> => ({ imported: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, partial: 0 })

export function newReport(root: string, dryRun?: boolean): ImportReport {
  return {
    id: `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`, root, startedAt: new Date().toISOString(), dryRun,
    totals: emptyTotals(), files: [], media: { copied: 0, linked: 0, missing: [], bytes: 0 }, docs: {}, playlists: [], suggestedCanvases: [], unmapped: {}, unknownFields: {}, notes: []
  }
}

const merge = (into: Record<string, number>, from?: Record<string, number>): void => { for (const [k, v] of Object.entries(from ?? {})) into[k] = (into[k] ?? 0) + v }

/** Incrementally writes presentations, handling idempotent re-import. */
class PresentationSink {
  private bySourceUuid = new Map<string, Presentation>()
  private bySourceRef = new Map<string, Presentation>()
  private byId = new Map<string, Presentation>()
  /** lower-case file name (and full path) → presentation id, for playlist resolution. */
  byFile = new Map<string, string>()
  byTitle = new Map<string, string>()
  private pending: Presentation[] = []
  /** ids written during this run → the file they came from (detects two files with the same ProPresenter UUID). */
  private thisRun = new Map<string, string>()
  /** Source refs of every file in the current import (so a UUID twin isn't mistaken for a re-import). */
  liveRefs = new Set<string>()
  constructor(private target: ImportTarget, private opts: ImportOptions) {}
  async init(): Promise<void> {
    for (const p of await this.target.listPresentations()) {
      this.byId.set(p.id, p)
      const src = p.meta?.source as Record<string, unknown> | undefined
      if (src?.uuid && String(src.type ?? '').startsWith('propresenter')) this.bySourceUuid.set(String(src.uuid).toLowerCase(), p)
      if (typeof src?.ref === 'string') { this.indexFile(src.ref, p.id); this.bySourceRef.set(src.ref.toLowerCase(), p) }
      this.byTitle.set(p.title.toLowerCase(), p.id)
    }
  }
  indexFile(ref: string, id: string): void {
    const clean = ref.split('#').pop()!
    this.byFile.set(clean.toLowerCase(), id)
    this.byFile.set(basename(clean).toLowerCase(), id)
    this.byFile.set(basename(clean, extname(clean)).toLowerCase(), id)
  }
  /** Decide what to do with a freshly converted presentation. */
  decide(p: Presentation): { status: FileStatus; presentation: Presentation; note?: string } {
    const src = p.meta.source as Record<string, unknown>
    const uuid = String(src?.uuid ?? '').toLowerCase()
    const ref = typeof src?.ref === 'string' ? src.ref.toLowerCase() : ''
    const sameFile = ref ? this.bySourceRef.get(ref) : undefined
    const existing = sameFile ?? ((uuid && this.bySourceUuid.get(uuid)) || this.byId.get(p.id))
    if (!existing) return { status: 'imported', presentation: p }
    const twin = this.thisRun.get(existing.id)
    if (twin || (!sameFile && ref && typeof existing.meta?.source?.ref === 'string' && this.bySourceRef.get(existing.meta.source.ref.toLowerCase()) === existing && existing.meta.source.ref.toLowerCase() !== ref && this.liveRefs.has(existing.meta.source.ref.toLowerCase()))) {
      // Two files in one import share a ProPresenter UUID (copied .pro files, bundle + library copy): keep both.
      p.id = newImportId()
      ;(src as Record<string, unknown>).duplicateOf = uuid
      src.uuid = undefined
      return { status: 'imported', presentation: p, note: `same ProPresenter document as ${twin ?? existing.meta.source?.ref} — imported as a separate copy` }
    }
    const exSrc = (existing.meta?.source ?? {}) as Record<string, unknown>
    const editedInReach = exSrc.fingerprint ? exSrc.fingerprint !== contentFingerprint(existing) : !exSrc.type
    if (exSrc.hash && src.hash && exSrc.hash === src.hash && !editedInReach) return { status: 'unchanged', presentation: existing }
    if (editedInReach) {
      const policy = this.opts.onConflict ?? 'skip'
      if (policy === 'skip') return { status: 'skipped', presentation: existing, note: 'edited in Reach since the last import — kept the Reach version (choose "overwrite" or "keep both" to change this)' }
      if (policy === 'duplicate') {
        p.id = newImportId()
        p.title = `${p.title} (ProPresenter)`
        ;(p.meta.source as Record<string, unknown>).uuid = undefined
        ;(p.meta.source as Record<string, unknown>).originalUuid = uuid
        return { status: 'imported', presentation: p, note: 'kept both: the Reach-edited copy and a fresh import' }
      }
    }
    p.id = existing.id
    p.createdAt = existing.createdAt
    if (existing.themeId && !p.themeId) p.themeId = existing.themeId
    return { status: 'updated', presentation: p }
  }
  async add(p: Presentation): Promise<void> {
    const src = p.meta.source as Record<string, unknown>
    src.fingerprint = contentFingerprint(p)
    this.byId.set(p.id, p)
    this.thisRun.set(p.id, String(src.ref ?? p.title))
    if (src.uuid && !this.bySourceUuid.has(String(src.uuid).toLowerCase())) this.bySourceUuid.set(String(src.uuid).toLowerCase(), p)
    if (typeof src.ref === 'string') { this.indexFile(src.ref, p.id); this.bySourceRef.set(src.ref.toLowerCase(), p) }
    this.byTitle.set(p.title.toLowerCase(), p.id)
    this.pending.push(p)
    if (this.pending.length >= 40) await this.flush()
  }
  async flush(): Promise<void> {
    if (!this.pending.length) return
    const batch = this.pending
    this.pending = []
    if (!this.opts.dryRun) await this.target.savePresentations(batch)
  }
  resolve(url: PP7Url | null, name: string): string | undefined {
    const cands = [url?.absolute, url?.relative, url?.basename, url?.basename?.replace(/\.pro$/i, '')].filter(Boolean) as string[]
    for (const c of cands) {
      const hit = this.byFile.get(c.toLowerCase()) ?? this.byFile.get(basename(c.replace(/\\/g, '/')).toLowerCase())
      if (hit) return hit
    }
    return name ? this.byTitle.get(name.toLowerCase()) : undefined
  }
}

async function upsertDoc<T extends { id: string }>(target: ImportTarget, report: ImportReport, name: string, items: T[], opts: ImportOptions, wrap?: { key: string; base: Record<string, unknown> }): Promise<void> {
  const stat = report.docs[name] ?? { added: 0, updated: 0, skipped: 0 }
  report.docs[name] = stat
  const raw = await target.readDoc<unknown>(name, wrap ? { ...wrap.base } : [])
  const list: T[] = wrap ? (((raw as Record<string, unknown>)?.[wrap.key] as T[]) ?? []) : Array.isArray(raw) ? (raw as T[]) : []
  for (const it of items) {
    const i = list.findIndex((x) => x.id === it.id)
    if (i < 0) { list.push(it); stat.added++ }
    else if (((list[i] as { source?: { type?: string } }).source?.type ?? '') === 'propresenter7') { list[i] = it; stat.updated++ }
    else stat.skipped++
  }
  if (opts.dryRun) return
  if (wrap) await target.writeDoc(name, { ...wrap.base, ...(raw as object), [wrap.key]: list })
  else await target.writeDoc(name, list)
}

export interface RunInput {
  root: string
  items: ImportScanItem[]
  generation?: ImportScan['generation']
  databases?: ImportScan['databases']
  workspaces?: ImportScan['workspaces']
}

export async function runImport(input: RunInput, target: ImportTarget, opts: ImportOptions = {}, hooks: RunHooks = {}): Promise<ImportReport> {
  const report = newReport(input.root, opts.dryRun)
  report.generation = input.generation
  const inc = (cat: ImportCategory): boolean => opts.include?.[cat] !== false
  const chunk = hooks.chunk ?? 8
  const sink = new PresentationSink(target, opts)
  await sink.init()
  const resolver = new MediaResolver(target, { showRoot: input.root, showRoots: input.workspaces?.map((w) => w.path), searchPaths: opts.mediaSearchPaths, copy: opts.copyMedia !== false && inc('media'), dryRun: opts.dryRun })
  const progress = (phase: ImportProgress['phase'], done: number, total: number, current?: string): void => hooks.onProgress?.({ phase, done, total, current, totals: { ...report.totals } })
  const missingAll = new Set<string>()

  const libsOk = (it: ImportScanItem): boolean => !opts.libraries?.length || !it.group || opts.libraries.includes(it.group)
  const presItems = input.items.filter((i) => ['pp7-presentation', 'pp7-bundle', 'pp6-presentation', 'pptx', 'pdf', 'chordpro', 'openlyrics', 'opensong', 'songselect-usr', 'songselect-txt', 'text', 'rtf', 'unknown'].includes(i.format) && libsOk(i))
  const playlistFileItems = input.items.filter((i) => i.format === 'pp7-playlist' || i.format === 'pp6-playlist')
  const playlistDocItems = input.items.filter((i) => i.format === 'pp7-playlist-doc')
  const configItems = input.items.filter((i) => i.format === 'pp7-config')
  const themeItems = input.items.filter((i) => i.format === 'pp7-theme')
  const pendingPlaylists: { doc: unknown; source: string; rel?: string }[] = []

  /* ── 1. presentations (incl. those embedded in .proplaylist exports) ── */
  const handleConverted = async (it: ImportScanItem, docs: ConvertedDoc[], bundleMedia: { path: string; data: Uint8Array }[], extraWarnings: string[], format: ImportFormat): Promise<void> => {
    for (const m of bundleMedia) resolver.addBundleEntry(m.path, m.data)
    for (const d of docs) {
      const t0 = Date.now()
      const fr: FileReport = { path: d.entry ? `${it.path}#${d.entry}` : it.path, rel: d.entry ? `${it.rel}#${d.entry}` : it.rel, format, status: 'imported', title: d.presentation.title, warnings: [...extraWarnings, ...d.warnings], unmapped: d.unmapped, unknownFields: d.unknownFields, stats: d.stats }
      try {
        const decision = sink.decide(d.presentation)
        fr.status = decision.status
        fr.presentationId = decision.presentation.id
        if (decision.note) fr.warnings.push(decision.note)
        if (decision.status === 'imported' || decision.status === 'updated') {
          if (inc('media') || opts.copyMedia === false) {
            const { missing } = await resolver.resolveAll(d.media, d.baseDir ?? dirname(it.path))
            if (missing.length) { fr.missingMedia = missing; for (const m of missing) missingAll.add(m) }
          }
          if (opts.categoryFromLibrary !== false && it.group && !d.presentation.meta.category) d.presentation.meta.category = it.group
          await sink.add(decision.presentation)
          if (fr.missingMedia?.length || Object.keys(d.unknownFields ?? {}).length) fr.status = fr.status === 'updated' ? 'updated' : 'partial'
        }
      } catch (e) {
        fr.status = 'failed'
        fr.error = (e as Error).message
      }
      fr.ms = Date.now() - t0
      report.files.push(fr)
      report.totals[fr.status]++
      merge(report.unmapped, d.unmapped)
      merge(report.unknownFields, d.unknownFields)
    }
    if (bundleMedia.length) clearBundleEntries(resolver)
  }
  const fileItems = inc('presentations') ? [...presItems, ...playlistFileItems] : playlistFileItems
  for (const it of fileItems) sink.liveRefs.add(it.path.toLowerCase())
  for (let i = 0; i < fileItems.length; i++) {
    if (hooks.isCancelled?.()) { report.cancelled = true; break }
    const it = fileItems[i]
    if (i % chunk === 0) { progress('presentations', i, fileItems.length, it.rel); await yieldNow() }
    let bytes: Uint8Array
    try { bytes = await fs.readFile(it.path) } catch (e) { pushFail(report, it, `could not read: ${(e as Error).message}`); continue }
    try {
      const conv = convertBytes(it.path, bytes, { library: it.group, format: it.format === 'unknown' ? undefined : it.format, baseDir: dirname(it.path) })
      for (const pd of conv.playlistDocs) pendingPlaylists.push({ ...pd, rel: it.rel })
      if (!conv.docs.length && !conv.playlistDocs.length) { pushFail(report, it, 'nothing importable in this file', conv.format); continue }
      if (inc('presentations')) await handleConverted(it, conv.docs, conv.bundleMedia, conv.warnings, conv.format)
      else if (conv.warnings.length) report.notes.push(...conv.warnings.map((w) => `${it.rel}: ${w}`))
    } catch (e) {
      pushFail(report, it, (e as Error).message)
    }
  }
  // Experimental: presentation blobs found inside a v22 database.
  if (inc('presentations') && input.databases?.some((d) => /Presentation blobs: [1-9]/.test(d.detail ?? ''))) {
    for (const db of input.databases.filter((d) => /Presentation blobs: [1-9]/.test(d.detail ?? ''))) {
      const blobs = extractPresentationBlobs(db.path)
      report.notes.push(`Experimental: read ${blobs.length} presentations from database ${basename(db.path)}`)
      for (const [k, b] of blobs.entries()) {
        if (k % chunk === 0) { progress('presentations', k, blobs.length, `${basename(db.path)} ${b.key}`); await yieldNow() }
        const it: ImportScanItem = { path: `${db.path}#${b.key}`, rel: `${basename(db.path)}#${b.key}`, format: 'pp7-presentation', size: b.bytes.length, group: 'Database' }
        try { const conv = convertBytes(it.path, b.bytes, { format: 'pp7-presentation', library: 'Database' }); await handleConverted(it, conv.docs, [], ['read from the ProPresenter 22 database (experimental)'], 'pp7-presentation') } catch (e) { pushFail(report, it, (e as Error).message) }
      }
    }
  }
  await sink.flush()

  /* ── 2. themes ── */
  if (inc('themes') && themeItems.length && !report.cancelled) {
    const themes = []
    for (const [i, it] of themeItems.entries()) {
      progress('config', i, themeItems.length, it.rel)
      try {
        const ctx = new ConvertContext(newImportId)
        const name = it.title ?? basename(dirname(it.path))
        const theme = convertTheme(decodePP7('rv.data.Template.Document', await fs.readFile(it.path)), name, ctx, `pp7-theme-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)
        const { missing } = await resolver.resolveAll(ctx.media, dirname(it.path))
        theme.source = { ...(theme.source as object), type: 'propresenter7', ref: it.path }
        themes.push(theme)
        report.files.push({ path: it.path, rel: it.rel, format: 'pp7-theme', status: missing.length ? 'partial' : 'imported', title: name, warnings: ctx.warnings, unmapped: ctx.unmapped, missingMedia: missing.length ? missing : undefined, stats: { templates: theme.templates.length } })
        report.totals[missing.length ? 'partial' : 'imported']++
        merge(report.unmapped, ctx.unmapped)
      } catch (e) { pushFail(report, it, (e as Error).message) }
    }
    await upsertDoc(target, report, 'themes', themes, opts)
  }

  /* ── 3. configuration ── */
  let workspaceDoc: unknown = null
  let commDoc: unknown = null
  if (!report.cancelled) {
    for (const [i, it] of configItems.entries()) {
      const name = it.title ?? basename(it.path)
      const cat = CONFIG_CATEGORY[name]
      if (cat && !inc(cat)) continue
      progress('config', i, configItems.length, it.rel)
      const ctx = new ConvertContext(newImportId)
      const fr: FileReport = { path: it.path, rel: it.rel, format: 'pp7-config', status: 'imported', title: name, warnings: [] }
      try {
        const bytes = await fs.readFile(it.path)
        const head = Buffer.from(bytes.subarray(0, 1)).toString()
        let doc: Record<string, unknown> | null = null
        if (head === '[' || head === '{') { try { doc = { json: JSON.parse(Buffer.from(bytes).toString('utf8')) } } catch { /* not JSON */ } }
        if (!doc && CONFIG_TYPES[name]) doc = decodePP7(CONFIG_TYPES[name], bytes)
        if (!doc) { fr.status = 'skipped'; fr.warnings.push('not imported (no Reach equivalent yet)') }
        else switch (name) {
          case 'Macros': { const v = convertMacros(doc, ctx); await upsertDoc(target, report, 'macros', v, opts); fr.stats = { macros: v.length }; break }
          case 'Props': { const v = convertProps(doc, ctx); await upsertDoc(target, report, 'props', v, opts, { key: 'props', base: { props: [], masks: [] } }); fr.stats = { props: v.length }; break }
          case 'Stage': { const v = convertStageLayouts(doc, ctx); await upsertDoc(target, report, 'stageLayouts', v, opts); fr.stats = { layouts: v.length }; break }
          case 'Timers': { const v = convertTimers(doc, ctx); await upsertDoc(target, report, 'timers', v.timers, opts, { key: 'timers', base: { timers: [] } }); fr.stats = { timers: v.timers.length }; break }
          case 'Messages': { const v = convertMessages(doc, ctx); await upsertDoc(target, report, 'messages', v, opts, { key: 'messages', base: { messages: [], stagePresets: [] } }); fr.stats = { messages: v.length }; break }
          case 'Groups': { const v = convertGroups(doc); if (!opts.dryRun) await target.writeDoc('pp7-groups', v); fr.stats = { groups: v.length }; break }
          case 'Labels': { const v = convertLabels(doc); if (!opts.dryRun) await target.writeDoc('pp7-labels', v); fr.stats = { labels: v.length }; break }
          case 'Workspace': workspaceDoc = doc; break
          case 'CommunicationDevices': commDoc = doc; break
          default: fr.status = 'skipped'; fr.warnings.push('read but not imported (no Reach equivalent yet)'); fr.stats = { fields: Object.keys(doc).length }
        }
      } catch (e) { fr.status = 'failed'; fr.error = (e as Error).message }
      fr.warnings.push(...ctx.warnings)
      if (Object.keys(ctx.unmapped).length) fr.unmapped = ctx.unmapped
      merge(report.unmapped, ctx.unmapped)
      if (ctx.media.length) await resolver.resolveAll(ctx.media, input.root)
      report.files.push(fr)
      report.totals[fr.status]++
    }
    if (workspaceDoc && inc('canvases')) {
      const ctx = new ConvertContext(newImportId)
      const s = suggestCanvases(workspaceDoc, ctx)
      const existing = (await target.getWorkspace())?.canvases ?? []
      report.suggestedCanvases = s.canvases.map((c) => ({ ...c, exists: existing.some((e) => e.name.toLowerCase() === c.name.toLowerCase()) }))
      if (!opts.dryRun) await target.writeDoc('pp7-screens', { importedAt: new Date().toISOString(), canvases: report.suggestedCanvases, looks: s.looks, masks: s.masks, videoInputs: s.videoInputs })
      report.notes.push(`ProPresenter screens: ${s.canvases.map((c) => `${c.name} (${c.kind}, ${c.width}×${c.height}${c.regions.length ? `, ${c.regions.length} outputs` : ''})`).join('; ')}. Looks: ${s.looks.map((l) => l.name).join(', ') || 'none'}.`)
    }
    if ((commDoc || workspaceDoc) && inc('devices') && !opts.dryRun) {
      const c = commDoc as { json?: unknown } | null
      await target.writeDoc('pp7-devices', c?.json !== undefined ? { importedAt: new Date().toISOString(), devices: c.json } : summarizeDevices(commDoc, workspaceDoc))
    }
  }
  await resolver.flush()

  /* ── 4. playlists ── */
  if (inc('playlists') && !report.cancelled) {
    const docs = [...pendingPlaylists]
    for (const it of playlistDocItems) {
      if (!/^(Library|Presentation|Presentations)$/i.test(it.title ?? '') && !/library/i.test(it.title ?? '')) {
        // Playlists/Media and Playlists/Audio are media-bin playlists: noted, not imported as service plans.
        report.notes.push(`${it.rel}: media/audio bin playlists are not imported as service plans`)
        continue
      }
      try {
        const conv = convertBytes(it.path, await fs.readFile(it.path), { format: 'pp7-playlist-doc' })
        docs.push(...conv.playlistDocs.map((d) => ({ ...d, rel: it.rel })))
      } catch (e) { pushFail(report, it, (e as Error).message) }
    }
    const existing = new Map((await target.listPlaylists()).map((p) => [p.id, p]))
    for (const [i, d] of docs.entries()) {
      progress('playlists', i, docs.length, d.rel)
      const { result, ctx } = convertPlaylists(d.doc, d.source, (url, name) => sink.resolve(url, name))
      for (const pl of result.playlists) {
        const ex = existing.get(pl.id)
        if (ex && ex.source?.type !== 'propresenter7') { report.notes.push(`playlist "${pl.name}" exists and was edited in Reach — skipped`); continue }
        if (!opts.dryRun) await target.savePlaylist(pl as Playlist)
        existing.set(pl.id, pl as Playlist)
        report.playlists.push({ name: pl.folder ? `${pl.folder} / ${pl.name}` : pl.name, items: pl.items.length, unresolved: result.unresolved.filter((u) => u.playlist === pl.name).map((u) => u.item || u.path || '?') })
      }
      merge(report.unmapped, ctx.unmapped)
    }
  }

  report.media = { copied: resolver.stats.copied, linked: resolver.stats.linked, missing: [...missingAll].sort(), bytes: resolver.stats.bytes }
  report.finishedAt = new Date().toISOString()
  progress('finish', 1, 1)
  return report
}

function pushFail(report: ImportReport, it: ImportScanItem, error: string, format?: ImportFormat): void {
  report.files.push({ path: it.path, rel: it.rel, format: format ?? it.format, status: 'failed', title: it.title, warnings: [], error })
  report.totals.failed++
}

/** Create Reach canvases from suggestions (never touches existing canvases). */
export function canvasesFromSuggestions(s: ImportReport['suggestedCanvases'], names: string[], existing: Canvas[]): Canvas[] {
  const out: Canvas[] = []
  for (const c of s) {
    if (!names.includes(c.name)) continue
    if (existing.some((e) => e.name.toLowerCase() === c.name.toLowerCase())) continue
    const id = `pp-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 40)
    out.push({ id: existing.some((e) => e.id === id) ? `${id}-${randomBytes(2).toString('hex')}` : id, name: c.name, kind: c.kind, width: c.width, height: c.height, regions: c.regions.map((r, i) => ({ id: `${id}-r${i + 1}`, name: r.name, rect: r.rect })) })
  }
  return out
}

/** Items for importing individual files (drag & drop, File ▸ Import). */
export function itemsForFiles(paths: string[]): ImportScanItem[] {
  return paths.map((p) => ({ path: p, rel: basename(p), format: 'unknown' as ImportFormat, size: 0, title: basename(p, extname(p)) }))
}

export { idFromUuid, join }
