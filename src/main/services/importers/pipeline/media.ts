/**
 * Media reference resolution + copying for ProPresenter imports.
 *
 * Resolution order (matches observed ProPresenter / Simple Presenter behaviour):
 *   1. root-relative (URL.local) against THIS computer: ROOT_SHOW → the ProPresenter folder being imported,
 *      ROOT_USER_* → this user's folders, ROOT_CURRENT_RESOURCE → beside the .pro / inside the bundle;
 *   2. the recorded absolute path (only if it exists here — Windows paths never match on a Mac);
 *   3. by file name anywhere under <ProPresenter>/Media/, extra search paths, and bundle entries.
 * Found files are copied into the workspace (`media/ProPresenter/<sub path>`), de-duplicated by size+content hash,
 * and refs are rewritten to `workspace:` paths. Nothing outside the chosen folders is ever written.
 */
import { promises as fs, createReadStream } from 'node:fs'
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import type { MediaItem } from '@shared/model'
import type { MediaRequest, PP7Url } from '../pp7/context'
import { isWindowsPath } from '../pp7/url'
import { mediaItemFor, type ImportTarget } from './target'

export interface MediaResolverOptions {
  /** ProPresenter folder(s) (ROOT_SHOW) — the scanned root and any workspaces found inside it. */
  showRoot?: string
  showRoots?: string[]
  /** Extra folders searched by file name. */
  searchPaths?: string[]
  copy?: boolean
  dryRun?: boolean
  /** Subfolder of the workspace media dir to copy into. */
  folder?: string
}

export interface ResolvedMedia {
  src: string
  /** How it was found. */
  via: 'relative' | 'absolute' | 'filename' | 'bundle' | 'web' | 'linked'
  path?: string
}

const ROOTS: Record<string, () => string> = {
  ROOT_USER_HOME: () => homedir(),
  ROOT_USER_DOCUMENTS: () => join(homedir(), 'Documents'),
  ROOT_USER_DOWNLOADS: () => join(homedir(), 'Downloads'),
  ROOT_USER_MUSIC: () => join(homedir(), 'Music'),
  ROOT_USER_PICTURES: () => join(homedir(), 'Pictures'),
  ROOT_USER_VIDEOS: () => join(homedir(), process.platform === 'darwin' ? 'Movies' : 'Videos'),
  ROOT_USER_DESKTOP: () => join(homedir(), 'Desktop'),
  ROOT_USER_APP_SUPPORT: () => (process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support') : process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')),
  ROOT_SHARED: () => (process.platform === 'darwin' ? '/Users/Shared' : process.env.PUBLIC ?? 'C:\\Users\\Public'),
  ROOT_BOOT_VOLUME: () => (process.platform === 'win32' ? 'C:\\' : '/')
}

/** Strip anything that could escape a base directory from an untrusted relative path. */
export function safeRelative(p: string): string | null {
  const parts = p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '').split('/').filter((s) => s && s !== '.')
  if (!parts.length || parts.some((s) => s === '..' || s.includes('\0'))) return null
  return parts.join('/')
}

const exists = (p: string): Promise<boolean> => fs.stat(p).then((s) => s.isFile(), () => false)

export class MediaResolver {
  private byName: Map<string, string[]> | null = null
  /** Bundle entries by lower-case file name and by safe path → bytes. */
  private bundle = new Map<string, Uint8Array>()
  private copied = new Map<string, string>() // source path / bundle key → workspace src
  private hashes = new Map<string, string>() // content hash → workspace src
  stats = { copied: 0, linked: 0, bytes: 0, missing: new Set<string>() }
  newItems: MediaItem[] = []

  constructor(private target: ImportTarget, private opts: MediaResolverOptions = {}) {}

  private shows(): string[] {
    return [...new Set([...(this.opts.showRoots ?? []), ...(this.opts.showRoot ? [this.opts.showRoot] : [])])]
  }

  addBundleEntry(path: string, data: Uint8Array): void {
    this.bundle.set(path.toLowerCase(), data)
    this.bundle.set(`name:${basename(path).toLowerCase()}`, data)
  }

  /** Index file names under <showRoot>/Media and search paths (lazy, once). */
  private async index(): Promise<Map<string, string[]>> {
    if (this.byName) return this.byName
    const map = new Map<string, string[]>()
    const roots = [...this.shows().flatMap((r) => [join(r, 'Media'), join(r, 'Themes')]), ...(this.opts.searchPaths ?? [])]
    let budget = 200000
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 12 || budget <= 0) return
      let ents: import('node:fs').Dirent[]
      try { ents = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const e of ents) {
        if (budget-- <= 0) return
        if (e.name.startsWith('.')) continue
        const p = join(dir, e.name)
        if (e.isDirectory()) await walk(p, depth + 1)
        else if (e.isFile()) {
          const k = e.name.toLowerCase()
          const arr = map.get(k)
          if (arr) arr.push(p)
          else map.set(k, [p])
        }
      }
    }
    for (const r of roots) await walk(r, 0)
    this.byName = map
    return map
  }

  /** Find a file for this URL. `baseDir` = folder of the referencing file (for CURRENT_RESOURCE). */
  async locate(url: PP7Url, baseDir?: string): Promise<{ path?: string; bundleKey?: string; via: ResolvedMedia['via'] } | null> {
    if (url.web) return { via: 'web' }
    // 1. root-relative
    if (url.relative) {
      const rel = safeRelative(url.relative)
      if (rel) {
        const cands: string[] = []
        if (url.root === 'ROOT_SHOW') for (const r of this.shows()) cands.push(join(r, rel))
        else if (url.root === 'ROOT_CURRENT_RESOURCE' || !url.root || url.root === 'ROOT_UNKNOWN') { if (baseDir) cands.push(join(baseDir, rel)); for (const r of this.shows()) cands.push(join(r, rel)) }
        else if (url.root && ROOTS[url.root]) cands.push(join(ROOTS[url.root](), rel))
        if (this.bundle.has(rel.toLowerCase())) return { bundleKey: rel.toLowerCase(), via: 'bundle' }
        for (const c of cands) if (await exists(c)) return { path: c, via: 'relative' }
      }
    }
    // bundle: media stored under its original absolute path minus the leading "/"
    if (url.absolute) {
      const key = safeRelative(url.absolute)?.toLowerCase()
      if (key && this.bundle.has(key)) return { bundleKey: key, via: 'bundle' }
    }
    // 2. absolute (only meaningful on the same OS family)
    if (url.absolute && (isWindowsPath(url.absolute) === (process.platform === 'win32')) && await exists(url.absolute)) return { path: url.absolute, via: 'absolute' }
    // 3. by file name
    const name = url.basename.toLowerCase()
    if (name) {
      if (this.bundle.has(`name:${name}`)) return { bundleKey: `name:${name}`, via: 'bundle' }
      if (baseDir && await exists(join(baseDir, url.basename))) return { path: join(baseDir, url.basename), via: 'filename' }
      const hits = (await this.index()).get(name)
      if (hits?.length) {
        // Prefer the candidate whose parent folders best match the recorded path.
        const recorded = (url.relative ?? url.absolute ?? '').replace(/\\/g, '/').toLowerCase()
        const best = hits.map((h) => ({ h, score: commonSuffix(h.replace(/\\/g, '/').toLowerCase(), recorded) })).sort((a, b) => b.score - a.score)[0]
        return { path: best.h, via: 'filename' }
      }
    }
    return null
  }

  /** Resolve + copy all requests from one document. Mutates each `ref.src`. Returns the basenames that are missing. */
  async resolveAll(reqs: MediaRequest[], baseDir?: string): Promise<{ missing: string[]; resolved: ResolvedMedia[] }> {
    const missing: string[] = []
    const resolved: ResolvedMedia[] = []
    for (const r of reqs) {
      const loc = await this.locate(r.url, baseDir)
      if (!loc) {
        const label = r.url.relative ?? r.url.absolute ?? r.url.basename
        missing.push(label)
        this.stats.missing.add(label)
        // Keep a usable local reference so the editor's relink UI can show what was expected.
        r.ref.src = r.url.absolute ? (isWindowsPath(r.url.absolute) ? `file:${r.url.absolute}` : `file:${r.url.absolute}`) : `missing:${r.url.basename}`
        ;(r.ref as { missing?: boolean }).missing = true
        continue
      }
      if (loc.via === 'web') { resolved.push({ src: r.ref.src, via: 'web' }); continue }
      const src = await this.bring(loc, r.url)
      r.ref.src = src
      resolved.push({ src, via: loc.via, path: loc.path })
    }
    return { missing: [...new Set(missing)], resolved }
  }

  private async bring(loc: { path?: string; bundleKey?: string }, url: PP7Url): Promise<string> {
    const key = loc.path ?? `bundle:${loc.bundleKey}`
    const done = this.copied.get(key)
    if (done) return done
    if (this.opts.copy === false && loc.path) {
      this.stats.linked++
      const src = `file:${loc.path}`
      this.copied.set(key, src)
      return src
    }
    // Already inside the workspace media folder?
    if (loc.path && this.target.mediaDir) {
      const rel = relative(this.target.mediaDir, loc.path)
      if (!rel.startsWith('..') && !rel.startsWith(sep) && rel !== loc.path) {
        const src = 'workspace:' + rel.split(sep).join('/')
        this.copied.set(key, src)
        return src
      }
    }
    const data = loc.bundleKey ? this.bundle.get(loc.bundleKey)! : null
    const hash = data ? createHash('sha1').update(data).digest('hex') : await hashFile(loc.path!)
    const dup = this.hashes.get(hash)
    if (dup) { this.copied.set(key, dup); return dup }
    // Destination: keep the path below "Media/" when it came from the ProPresenter folder, else just the file name.
    let sub = url.basename || basename(loc.path ?? 'media')
    for (const r of loc.path ? this.shows() : []) {
      const relToShow = relative(join(r, 'Media'), loc.path!)
      if (!relToShow.startsWith('..') && !relToShow.startsWith(sep)) { sub = relToShow.split(sep).join('/'); break }
    }
    const folder = this.opts.folder ?? 'ProPresenter'
    let rel = safeRelative(`${folder}/${sub}`) ?? `${folder}/${Date.now()}`
    if (this.opts.dryRun || !this.target.mediaDir) {
      const src = `workspace:${rel}`
      this.copied.set(key, src)
      this.hashes.set(hash, src)
      this.stats.copied++
      return src
    }
    // Avoid clobbering a different file with the same name.
    let dest = join(this.target.mediaDir, ...rel.split('/'))
    let n = 1
    while (await exists(dest)) {
      const sameHash = await hashFile(dest).catch(() => '')
      if (sameHash === hash) break
      const ext = extname(rel)
      rel = `${rel.slice(0, rel.length - ext.length).replace(/-\d+$/, '')}-${++n}${ext}`
      dest = join(this.target.mediaDir, ...rel.split('/'))
    }
    await fs.mkdir(dirname(dest), { recursive: true })
    this.target.markOwnWrite?.(dest)
    if (!(await exists(dest))) {
      if (data) await fs.writeFile(dest, data)
      else await fs.copyFile(loc.path!, dest)
      const size = data ? data.length : (await fs.stat(dest)).size
      this.stats.bytes += size
      this.stats.copied++
    } else this.stats.linked++ // identical file already in the workspace (re-import)
    const src = `workspace:${rel}`
    this.copied.set(key, src)
    this.hashes.set(hash, src)
    const item = mediaItemFor(rel, basename(rel, extname(rel)), { tags: ['ProPresenter import'] })
    if (item) this.newItems.push(item)
    return src
  }

  async flush(): Promise<void> {
    if (this.newItems.length && !this.opts.dryRun) await this.target.addMedia(this.newItems)
    this.newItems = []
  }
}

function commonSuffix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++
  return i
}

function hashFile(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha1')
    createReadStream(p).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

export function clearBundleEntries(r: MediaResolver): void {
  ;(r as unknown as { bundle: Map<string, Uint8Array> }).bundle.clear()
}
