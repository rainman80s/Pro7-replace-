/**
 * One file → zero or more converted documents (presentations / playlists), format-agnostic.
 * No I/O except reading the given bytes; media requests are returned for the caller to resolve.
 */
import { basename, extname } from 'node:path'
import { createHash } from 'node:crypto'
import type { Playlist, Presentation } from '@shared/model'
import type { ImportFormat } from '@shared/import'
import type { MediaRequest } from '../pp7/context'
import { ConvertContext } from '../pp7/context'
import { convertPP7Presentation } from '../pp7/presentation'
import { convertPlaylistDocument, type ConvertedPlaylists } from '../pp7/playlist'
import { decodePP7, isPresentationBytes } from '../pp7/proto'
import type { PP7Url } from '../pp7/context'
import { convertPro6 } from '../pp6/pro6'
import { readZip, safeEntryPath } from '../util/zip'
import { decodeText, importChordPro, importOpenLyrics, importOpenSong, importPlainText, importSongSelectText, importSongSelectUsr } from '../text/lyrics'
import { parseRtf } from '../rtf/rtf'
import { importLyricsText, newImportId } from '@shared/import-lyrics'
import { detectFormat } from './detect'

export interface ConvertedDoc {
  presentation: Presentation
  media: MediaRequest[]
  warnings: string[]
  unmapped: Record<string, number>
  unknownFields?: Record<string, number>
  stats: Record<string, number | string>
  /** Where the source lives (for CURRENT_RESOURCE / beside-the-file media). */
  baseDir?: string
  /** Name of the entry inside an archive. */
  entry?: string
}

export interface ConvertedFile {
  format: ImportFormat
  docs: ConvertedDoc[]
  /** Archive entries that are media (bundle / playlist exports). */
  bundleMedia: { path: string; data: Uint8Array }[]
  /** Playlist documents (resolved later, once presentations are known). */
  playlistDocs: { doc: unknown; source: string }[]
  warnings: string[]
}

const titleOf = (path: string): string => basename(path, extname(path))

export function convertBytes(path: string, bytes: Uint8Array, opts: { library?: string; format?: ImportFormat; baseDir?: string } = {}): ConvertedFile {
  const format = opts.format ?? detectFormat(path, bytes)
  const out: ConvertedFile = { format, docs: [], bundleMedia: [], playlistDocs: [], warnings: [] }
  const fileHash = createHash('sha1').update(bytes).digest('hex')
  const pushPres = (p: Presentation, ctx: ConvertContext | null, stats: Record<string, number | string> = {}, unknownFields?: Record<string, number>, entry?: string): void => {
    const src = (p.meta.source ??= { type: format }) as Record<string, unknown>
    if (!src.hash) src.hash = entry ? `${fileHash}:${entry}` : fileHash
    out.docs.push({
      presentation: p, media: ctx?.media ?? [], warnings: ctx?.warnings ?? [], unmapped: ctx?.unmapped ?? {}, unknownFields, entry, baseDir: opts.baseDir,
      stats: { slides: p.slides.length, groups: p.groups.length, arrangements: p.arrangements.length, ...stats }
    })
  }
  const text = (): string => decodeText(bytes)
  const fromLyrics = (r: { presentation: Presentation; warnings: string[] }, kind: string): void => {
    const ctx = new ConvertContext(newImportId)
    ctx.warnings.push(...r.warnings)
    r.presentation.meta.source = { ...(r.presentation.meta.source ?? { type: kind }), ref: path, importedAt: new Date().toISOString() }
    if (opts.library && !r.presentation.meta.category) r.presentation.meta.category = opts.library
    pushPres(r.presentation, ctx)
  }
  switch (format) {
    case 'pp7-presentation': {
      const r = convertPP7Presentation(bytes, { sourcePath: path, library: opts.library })
      pushPres(r.presentation, r.ctx, { app: r.info.appVersion ?? '', platform: r.info.platform ?? '' }, r.unknownFields)
      break
    }
    case 'pp7-bundle': case 'pp7-playlist': case 'pp6-bundle': case 'pp6-playlist': {
      const zip = readZip(bytes)
      for (const n of zip.notes) out.warnings.push(`zip: ${n}`)
      let dataDoc: Uint8Array | null = null
      for (const e of zip.entries) {
        const safe = safeEntryPath(e.name)
        if (!safe) { if (e.name && !e.name.endsWith('/')) out.warnings.push(`ignored unsafe archive entry "${e.name}"`); continue }
        let data: Uint8Array
        try { data = e.read() } catch (err) { out.warnings.push(`could not read "${e.name}": ${(err as Error).message}`); continue }
        const lower = safe.toLowerCase()
        if (lower === 'data' && format === 'pp7-playlist') { dataDoc = data; continue }
        if (/\.pro$/i.test(lower) && isPresentationBytes(data)) {
          try {
            const r = convertPP7Presentation(data, { sourcePath: `${path}#${safe}`, library: opts.library })
            pushPres(r.presentation, r.ctx, { app: r.info.appVersion ?? '' }, r.unknownFields, safe)
          } catch (err) { out.warnings.push(`${safe}: ${(err as Error).message}`) }
        } else if (/\.pro[456]$/i.test(lower)) {
          try { const r = convertPro6(decodeText(data), { sourcePath: `${path}#${safe}`, library: opts.library }); pushPres(r.presentation, r.ctx, { version: r.info.version }, undefined, safe) } catch (err) { out.warnings.push(`${safe}: ${(err as Error).message}`) }
        } else if (/\.(xml|pro6pl|data)$/i.test(lower) && format === 'pp6-playlist') {
          out.warnings.push('ProPresenter 6 playlist structure is not imported; its presentations and media are')
        } else out.bundleMedia.push({ path: safe, data })
      }
      if (format === 'pp7-bundle' && !out.docs.length) throw new Error('bundle contains no ProPresenter presentation')
      if (dataDoc) {
        const doc = decodePlaylistDoc(dataDoc)
        if (doc) out.playlistDocs.push({ doc, source: path })
        else out.warnings.push('playlist data could not be decoded')
      }
      break
    }
    case 'pp7-playlist-doc': {
      const doc = decodePlaylistDoc(bytes)
      if (!doc) throw new Error('not a ProPresenter playlist document')
      out.playlistDocs.push({ doc, source: path })
      break
    }
    case 'pp6-presentation': {
      const r = convertPro6(text(), { sourcePath: path, library: opts.library })
      pushPres(r.presentation, r.ctx, { version: r.info.version })
      break
    }
    case 'chordpro': { const r = importChordPro(text(), titleOf(path)); fromLyrics(r, 'chordpro'); out.docs[out.docs.length - 1].stats.chords = r.chords; break }
    case 'openlyrics': fromLyrics(importOpenLyrics(text(), titleOf(path)), 'openlyrics'); break
    case 'opensong': fromLyrics(importOpenSong(text(), titleOf(path)), 'opensong'); break
    case 'songselect-usr': fromLyrics(importSongSelectUsr(text(), titleOf(path)), 'songselect-usr'); break
    case 'songselect-txt': fromLyrics(importSongSelectText(text(), titleOf(path)), 'songselect'); break
    case 'text': fromLyrics(importPlainText(titleOf(path), text()), 'text'); break
    case 'rtf': fromLyrics({ presentation: importLyricsText(titleOf(path), parseRtf(bytes).plain, { source: { type: 'rtf' } }), warnings: [] }, 'rtf'); break
    default:
      throw new Error(`unsupported file type (${format})`)
  }
  return out
}

/** Playlist files: try PlaylistDocument first, fall back to a bare Playlist (bussnet's reading). */
export function decodePlaylistDoc(bytes: Uint8Array): unknown | null {
  for (const t of ['rv.data.PlaylistDocument', 'rv.data.Playlist']) {
    try {
      const d = decodePP7(t, bytes) as { root_node?: unknown; items?: unknown; playlists?: unknown; name?: string }
      if (d && (d.root_node || d.items || d.playlists)) return t === 'rv.data.Playlist' ? { root_node: d } : d
    } catch { /* next */ }
  }
  return null
}

export function convertPlaylists(doc: unknown, source: string, resolve: (url: PP7Url | null, name: string) => string | undefined): { result: ConvertedPlaylists; ctx: ConvertContext } {
  const ctx = new ConvertContext(newImportId)
  return { result: convertPlaylistDocument(doc, ctx, { resolvePresentation: resolve, source }), ctx }
}

export type { Playlist }
