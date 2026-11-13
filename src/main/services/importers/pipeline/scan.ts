/**
 * Walk a ProPresenter folder: classify every file, build a file-type census, detect the workspace
 * generation (loose .pro files vs the v22 database layout) and probe unknown files that look like databases.
 * Read-only, bounded (file count and depth), never throws for a bad file.
 */
import { promises as fs } from 'node:fs'
import { basename, extname, join, relative, sep } from 'node:path'
import { homedir } from 'node:os'
import type { CensusEntry, ImportScan, ImportScanItem, PPGeneration } from '@shared/import'
import { probeDatabase } from './database'

const MAX_FILES = 250000
const CONFIG_NAMES = new Set(['Workspace', 'Stage', 'Macros', 'Props', 'Timers', 'Groups', 'Labels', 'Messages', 'ClearGroups', 'CCLI', 'KeyMappings', 'Calendar', 'CommunicationDevices', 'TestPatterns', 'Preferences', 'NetworkLink'])
const DB_EXT = new Set(['.sqlite', '.sqlite3', '.db', '.db3', '.realm', '.store', '.sqlitedb', '.ldb', '.cblite2', '.lmdb', '.mdb'])

/** Default places a ProPresenter library lives on this computer. */
export function guessProPresenterFolders(): { path: string; label: string }[] {
  const h = homedir()
  const out = [
    { path: join(h, 'Documents', 'ProPresenter'), label: 'Documents/ProPresenter' },
    { path: join(h, 'Documents', 'ProPresenter7'), label: 'Documents/ProPresenter7' },
    { path: join(h, 'Library', 'Application Support', 'RenewedVision', 'ProPresenter'), label: 'Application Support/RenewedVision/ProPresenter' },
    { path: join(h, 'Documents', 'ProPresenter6'), label: 'Documents/ProPresenter6 (ProPresenter 6)' },
    { path: join(h, 'Documents', 'ProPresenter6 Library'), label: 'ProPresenter 6 library' }
  ]
  if (process.env.APPDATA) out.push({ path: join(process.env.APPDATA, 'RenewedVision', 'ProPresenter', 'LocalWorkspaces'), label: 'AppData/RenewedVision/ProPresenter/LocalWorkspaces' })
  if (process.platform === 'darwin') out.push({ path: join(h, 'Library', 'Application Support', 'RenewedVision', 'ProPresenter', 'LocalWorkspaces'), label: 'Application Support/…/LocalWorkspaces' })
  return out
}

export async function scanFolder(rootIn: string, opts: { probeDatabases?: boolean } = {}): Promise<ImportScan> {
  const t0 = Date.now()
  const root = rootIn.replace(/[\\/]+$/, '')
  const items: ImportScanItem[] = []
  const census = new Map<string, CensusEntry>()
  const databases: ImportScan['databases'] = []
  const wsRoots = new Set<string>()
  const mediaRoots = new Set<string>()
  const libCounts = new Map<string, number>()
  const counts = { presentations: 0, playlists: 0, media: 0, themes: 0, configs: 0, legacy: 0, other: 0 }
  let scanned = 0
  let truncated = false
  const unknownCandidates: string[] = []

  const stat = await fs.stat(root).catch(() => null)
  if (!stat) throw new Error(`Folder not found: ${root}`)
  if (!stat.isDirectory()) throw new Error(`Not a folder: ${root}`)

  const rel = (p: string): string => relative(root, p).split(sep).join('/')
  const add = (it: Omit<ImportScanItem, 'rel'>): void => { items.push({ ...it, rel: rel(it.path) }) }

  const walk = async (dir: string, depth: number, ctxDirs: string[]): Promise<void> => {
    if (depth > 14 || truncated) return
    let ents: import('node:fs').Dirent[]
    try { ents = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    const names = new Set(ents.map((e) => e.name))
    if (names.has('Libraries') || names.has('Configuration') || (names.has('Playlists') && names.has('Media'))) wsRoots.add(dir)
    if (names.has('CURRENT') && [...names].some((n) => n.startsWith('MANIFEST-'))) databases.push({ path: dir, kind: 'leveldb', size: 0 })
    for (const e of ents) {
      if (e.name.startsWith('.') && e.name !== '.DS_Store') continue
      if (e.name === '.DS_Store') continue
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (/\.(cblite2|realm\.management|bundle|app|photoslibrary|fcpbundle)$/i.test(e.name)) { databases.push({ path: p, kind: e.name.split('.').pop()!, size: 0 }); continue }
        if (e.name === 'node_modules') continue
        await walk(p, depth + 1, [...ctxDirs, e.name])
        continue
      }
      if (!e.isFile()) continue
      if (++scanned > MAX_FILES) { truncated = true; return }
      let size = 0
      try { size = (await fs.stat(p)).size } catch { /* ignore */ }
      const ext = extname(e.name).toLowerCase()
      const key = ext || '(none)'
      const c = census.get(key) ?? { ext: key, count: 0, bytes: 0, examples: [] }
      c.count++
      c.bytes += size
      if (c.examples.length < 3) c.examples.push(rel(p))
      census.set(key, c)

      const inDir = (n: string): number => ctxDirs.lastIndexOf(n)
      const libIdx = inDir('Libraries')
      if (ext === '.pro') {
        const lib = libIdx >= 0 ? ctxDirs[libIdx + 1] ?? 'Default' : basename(dir)
        add({ path: p, format: 'pp7-presentation', group: lib, size, title: basename(e.name, ext) })
        libCounts.set(lib, (libCounts.get(lib) ?? 0) + 1)
        counts.presentations++
      } else if (ext === '.probundle') { add({ path: p, format: 'pp7-bundle', size, title: basename(e.name, ext), group: 'Bundles' }); counts.presentations++ }
      else if (ext === '.proplaylist') { add({ path: p, format: 'pp7-playlist', size, title: basename(e.name, ext) }); counts.playlists++ }
      else if (['.pro6', '.pro5', '.pro4'].includes(ext)) { add({ path: p, format: 'pp6-presentation', size, title: basename(e.name, ext), group: ctxDirs[ctxDirs.length - 1] ?? 'ProPresenter 6' }); counts.legacy++ }
      else if (ext === '.pro6plx') { add({ path: p, format: 'pp6-playlist', size, title: basename(e.name, ext) }); counts.legacy++ }
      else if (!ext && ctxDirs[ctxDirs.length - 1] === 'Configuration' && CONFIG_NAMES.has(e.name)) { add({ path: p, format: 'pp7-config', size, title: e.name }); counts.configs++ }
      else if (!ext && ctxDirs[ctxDirs.length - 1] === 'Playlists') { add({ path: p, format: 'pp7-playlist-doc', size, title: e.name }); counts.playlists++ }
      else if (!ext && e.name === 'Theme' && inDir('Themes') >= 0) { add({ path: p, format: 'pp7-theme', size, title: ctxDirs[ctxDirs.length - 1] }); counts.themes++ }
      else if (inDir('Media') >= 0 && /\.(png|jpe?g|gif|webp|bmp|heic|tiff?|mp4|mov|m4v|webm|mkv|avi|mpg|mp3|wav|m4a|aac|aiff?|flac|ogg)$/i.test(ext)) {
        counts.media++
        const mi = ctxDirs.lastIndexOf('Media')
        mediaRoots.add(join(root, ...rel(p).split('/').slice(0, rel(p).split('/').length - (ctxDirs.length - mi))))
      } else if (DB_EXT.has(ext) || /-wal$|-shm$|\.sqlite-journal$/i.test(e.name)) {
        if (!/-wal$|-shm$|-journal$/.test(e.name)) databases.push({ path: p, kind: ext.slice(1) || 'database', size })
      } else {
        counts.other++
        if (!ext && size > 15 && unknownCandidates.length < 400) unknownCandidates.push(p)
      }
    }
  }
  await walk(root, 0, [])

  // Extension-less files we don't recognise: sniff for SQLite headers (v22 databases may not use an extension).
  for (const p of unknownCandidates) {
    try {
      const fh = await fs.open(p, 'r')
      const buf = Buffer.alloc(16)
      await fh.read(buf, 0, 16, 0)
      await fh.close()
      if (buf.toString('latin1').startsWith('SQLite format 3')) databases.push({ path: p, kind: 'sqlite', size: (await fs.stat(p)).size })
    } catch { /* ignore */ }
  }
  if (opts.probeDatabases !== false) {
    for (const db of databases.slice(0, 20)) {
      try { db.detail = await probeDatabase(db.path, db.kind) } catch (e) { db.detail = `could not read: ${(e as Error).message}` }
    }
  }

  const loosePro = items.filter((i) => i.format === 'pp7-presentation').length
  const legacy = counts.legacy
  let generation: PPGeneration = 'unknown'
  if (databases.length && loosePro < 5) generation = 'pp22-database'
  else if (databases.length && loosePro) generation = 'mixed'
  else if (loosePro || counts.configs || counts.playlists) generation = 'pp7-files'
  else if (legacy) generation = 'pp6'

  const advice: string[] = []
  if (generation === 'pp22-database' || generation === 'mixed') {
    advice.push('This looks like a ProPresenter 22 (or newer) workspace: presentations and playlists are kept in a database, not as loose .pro files.')
    advice.push('In ProPresenter choose File ▸ Export Legacy Workspace…, then point Reach at the exported folder. Or export presentations as .pro / .proBundle and playlists as .proPlaylist (with media) and drag those files onto Reach.')
    if (databases.some((d) => /Presentation blobs: [1-9]/.test(d.detail ?? ''))) advice.push('Reach found ProPresenter presentation data inside the database and can try an experimental direct import of it.')
  }
  if (generation === 'pp7-files') advice.push(`Found ${loosePro} presentations in ${libCounts.size} libraries, ${counts.playlists} playlist files, ${counts.themes} themes and ${counts.media} media files.`)
  if (generation === 'pp6') advice.push(`Found ${legacy} ProPresenter 6 documents. They will be converted (text, groups, arrangements, backgrounds).`)
  if (generation === 'unknown') advice.push('No ProPresenter library was recognised here. Choose the folder that contains "Libraries", "Playlists" and "Media" (usually Documents/ProPresenter), or drag individual .pro / .proBundle files onto Reach.')
  if (truncated) advice.push(`Stopped after ${MAX_FILES} files — choose a more specific folder.`)

  const workspaces = [...wsRoots].map((w) => ({ path: w, name: w === root ? basename(root) : rel(w), generation }))
  return {
    root, generation, advice, workspaces, counts,
    libraries: [...libCounts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
    items, census: [...census.values()].sort((a, b) => b.count - a.count), databases, mediaRoots: [...mediaRoots],
    scannedFiles: scanned, truncated, durationMs: Date.now() - t0
  }
}
