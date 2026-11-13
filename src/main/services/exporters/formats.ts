/**
 * Exports: .reachbundle (move a service between computers), .reach JSON, lyrics text, CSV song list,
 * OpenLyrics XML, and an EXPERIMENTAL lyrics-only ProPresenter 7 .pro encoder. Pure: data in, bytes out.
 */
import type { ID, MediaRef, Playlist, Presentation, TextElement, Theme } from '@shared/model'
import { lyricsTextOf } from '@shared/import-lyrics'
import { encodePP7 } from '../importers/pp7/proto'
import { escapeRtfText } from '../importers/rtf/rtf'
import { writeZip } from '../importers/util/zip'

export const REACH_BUNDLE_VERSION = 1

export interface BundleManifest {
  format: 'reachbundle'
  version: number
  createdAt: string
  app?: string
  presentations: { id: ID; title: string; file: string }[]
  playlists: { id: ID; name: string; file: string }[]
  media: { src: string; file: string; bytes: number }[]
  themes?: string
  missingMedia: string[]
}

/** Every MediaRef inside a presentation (elements, fills, variants, actions). */
export function mediaRefsOf(value: unknown, out: MediaRef[] = []): MediaRef[] {
  if (!value || typeof value !== 'object') return out
  if (Array.isArray(value)) { for (const v of value) mediaRefsOf(v, out); return out }
  const o = value as Record<string, unknown>
  if (typeof o.src === 'string' && typeof o.kind === 'string' && ['image', 'video', 'audio'].includes(o.kind as string)) out.push(o as unknown as MediaRef)
  for (const v of Object.values(o)) if (v && typeof v === 'object') mediaRefsOf(v, out)
  return out
}

export function buildReachBundle(input: {
  presentations: Presentation[]; playlists: Playlist[]; themes?: Theme[]
  /** workspace:<rel> → file bytes (null when missing). */
  readMedia(src: string): Uint8Array | null
  app?: string
}): { bytes: Uint8Array; manifest: BundleManifest } {
  const files: Record<string, Uint8Array> = {}
  const manifest: BundleManifest = { format: 'reachbundle', version: REACH_BUNDLE_VERSION, createdAt: new Date().toISOString(), app: input.app, presentations: [], playlists: [], media: [], missingMedia: [] }
  const enc = (v: unknown): Uint8Array => Buffer.from(JSON.stringify(v, null, 2))
  const seen = new Set<string>()
  for (const p of input.presentations) {
    const file = `presentations/${p.id}.reach`
    files[file] = enc(p)
    manifest.presentations.push({ id: p.id, title: p.title, file })
    for (const r of mediaRefsOf(p)) {
      if (!r.src.startsWith('workspace:') || seen.has(r.src)) continue
      seen.add(r.src)
      const data = input.readMedia(r.src)
      if (!data) { manifest.missingMedia.push(r.src); continue }
      const rel = r.src.slice('workspace:'.length).split('/').filter((s) => s && s !== '..').join('/')
      files[`media/${rel}`] = data
      manifest.media.push({ src: r.src, file: `media/${rel}`, bytes: data.length })
    }
  }
  for (const pl of input.playlists) {
    const file = `playlists/${pl.id}.json`
    files[file] = enc(pl)
    manifest.playlists.push({ id: pl.id, name: pl.name, file })
    for (const it of pl.items) if (it.type === 'media' && it.media.src.startsWith('workspace:') && !seen.has(it.media.src)) {
      seen.add(it.media.src)
      const data = input.readMedia(it.media.src)
      if (data) { const rel = it.media.src.slice(10); files[`media/${rel}`] = data; manifest.media.push({ src: it.media.src, file: `media/${rel}`, bytes: data.length }) }
    }
  }
  if (input.themes?.length) { files['docs/themes.json'] = enc(input.themes); manifest.themes = 'docs/themes.json' }
  files['manifest.json'] = enc(manifest)
  return { bytes: writeZip(files), manifest }
}

/* ── text exports ── */
export const lyricsExport = (p: Presentation, headings = true): string => `${p.title}\n\n${lyricsTextOf(p, { headings })}${footer(p)}`
function footer(p: Presentation): string {
  const m = p.meta
  const lines = [m.author && `Words & music: ${m.author}`, m.copyright, m.ccliNumber && `CCLI Song # ${m.ccliNumber}`].filter(Boolean)
  return lines.length ? `\n${lines.join('\n')}\n` : ''
}

const csvCell = (v: unknown): string => {
  const s = v === undefined || v === null ? '' : String(v)
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s
}
/** CSV song list for CCLI reporting. */
export function songCsv(list: Presentation[]): string {
  const rows = [['Title', 'CCLI Song Number', 'Author', 'Copyright', 'Publisher', 'Category', 'Slides', 'Source', 'Last updated']]
  for (const p of [...list].sort((a, b) => a.title.localeCompare(b.title))) {
    rows.push([p.title, p.meta.ccliNumber ?? '', p.meta.author ?? p.meta.artist ?? '', p.meta.copyright ?? '', p.meta.publisher ?? '', p.meta.category ?? '', String(p.slides.length), String(p.meta.source?.type ?? 'reach'), p.updatedAt])
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

const xmlEsc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export function openLyricsExport(p: Presentation): string {
  const code = (name: string, i: number): string => {
    const m = /^(verse|chorus|bridge|pre-chorus|intro|ending|tag)\s*(\d*)/i.exec(name)
    const map: Record<string, string> = { verse: 'v', chorus: 'c', bridge: 'b', 'pre-chorus': 'p', intro: 'i', ending: 'e', tag: 'o' }
    return m ? `${map[m[1].toLowerCase()]}${m[2] || '1'}` : `o${i + 1}`
  }
  const verses = p.groups.map((g, i) => {
    const slides = g.slideIds.map((id) => p.slides.find((s) => s.id === id)).filter(Boolean)
    const lines = slides.map((s) => `      <lines>${s!.elements.filter((e): e is TextElement => e.type === 'text' && e.role !== 'translation' && !e.dynamic).map((t) => t.paragraphs.map((q) => xmlEsc(q.runs.map((r) => r.text).join(''))).join('<br/>')).join('<br/>')}</lines>`)
    return { code: code(g.name, i), xml: `    <verse name="${code(g.name, i)}">\n${lines.join('\n')}\n    </verse>`, id: g.id }
  })
  const arr = p.arrangements.find((a) => a.id === p.activeArrangementId) ?? p.arrangements[0]
  const order = arr ? arr.groupIds.map((id) => verses.find((v) => v.id === id)?.code).filter(Boolean).join(' ') : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.9" createdIn="Reach Presenter">
  <properties>
    <titles><title>${xmlEsc(p.title)}</title></titles>
${p.meta.author ? `    <authors>${p.meta.author.split(/,\s*/).map((a) => `<author>${xmlEsc(a)}</author>`).join('')}</authors>\n` : ''}${p.meta.copyright ? `    <copyright>${xmlEsc(p.meta.copyright)}</copyright>\n` : ''}${p.meta.ccliNumber ? `    <ccliNo>${xmlEsc(p.meta.ccliNumber)}</ccliNo>\n` : ''}${order ? `    <verseOrder>${order}</verseOrder>\n` : ''}  </properties>
  <lyrics>
${verses.map((v) => v.xml).join('\n')}
  </lyrics>
</song>
`
}

/* ── EXPERIMENTAL: lyrics-only ProPresenter 7 .pro ──
 * Builds a minimal but complete rv.data.Presentation (groups, arrangements, one text box per slide, CCLI).
 * It is NOT a round-trip of an imported file (formatting, media and cues are dropped) — ProPresenter
 * re-applies its theme. Never byte-identical to anything ProPresenter wrote (see research §2.3).
 */
const uuid = (): string => globalThis.crypto.randomUUID().toUpperCase()
const asUuid = (id: string): string => (/^[0-9a-f]{32}$/i.test(id) ? `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`.toUpperCase() : uuid())
const hexToRgba = (c?: string): { red: number; green: number; blue: number; alpha: number } => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c ?? '')
  const n = m ? parseInt(m[1], 16) : 0x7a7a7a
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255, alpha: 1 }
}
function cocoaRtf(text: string, size = 84): Buffer {
  return Buffer.from(`{\\rtf1\\ansi\\ansicpg1252\\cocoartf2761\n\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f0\\fnil\\fcharset0 HelveticaNeue;}\n{\\colortbl;\\red255\\green255\\blue255;\\red255\\green255\\blue255;}\n{\\*\\expandedcolortbl;;\\cssrgb\\c100000\\c100000\\c100000;}\n\\pard\\pardeftab1680\\pardirnatural\\qc\\partightenfactor0\n\n\\f0\\fs${size} \\cf2 ${escapeRtfText(text)}}`, 'latin1')
}
export function encodeProLyrics(p: Presentation): Uint8Array {
  const W = p.size.width
  const H = p.size.height
  const slideUuid = new Map(p.slides.map((s) => [s.id, asUuid(s.id)]))
  const groupUuid = new Map(p.groups.map((g) => [g.id, asUuid(g.id)]))
  const textOf = (s: Presentation['slides'][number]): string => {
    const t = s.elements.filter((e): e is TextElement => e.type === 'text' && !e.dynamic && e.role !== 'translation')
    return t.map((x) => x.paragraphs.map((q) => q.runs.map((r) => r.text).join('')).join('\n')).join('\n')
  }
  const ungrouped = p.slides.filter((s) => !p.groups.some((g) => g.slideIds.includes(s.id)))
  const groups = [...p.groups.map((g) => ({ id: g.id, name: g.name, color: g.color, slideIds: g.slideIds })), ...(ungrouped.length ? [{ id: 'ungrouped', name: '', color: undefined, slideIds: ungrouped.map((s) => s.id) }] : [])]
  if (!groupUuid.has('ungrouped')) groupUuid.set('ungrouped', uuid())
  const doc = {
    application_info: { platform: 'PLATFORM_MACOS', application: 'APPLICATION_PROPRESENTER', application_version: { major_version: 7, minor_version: 16 } },
    uuid: { string: asUuid(String((p.meta.source as { uuid?: string } | undefined)?.uuid ?? p.id).replace(/-/g, '')) },
    name: p.title, category: p.meta.category ?? (p.kind === 'song' ? 'Song' : 'Presentation'), notes: p.meta.notes ?? '',
    background: { color: { alpha: 1 } },
    selected_arrangement: p.activeArrangementId ? { string: asUuid(p.activeArrangementId) } : undefined,
    arrangements: p.arrangements.map((a) => ({ uuid: { string: asUuid(a.id) }, name: a.name, group_identifiers: a.groupIds.filter((g) => groupUuid.has(g)).map((g) => ({ string: groupUuid.get(g)! })) })),
    cue_groups: groups.map((g) => ({ group: { uuid: { string: groupUuid.get(g.id)! }, name: g.name, color: hexToRgba(g.color) }, cue_identifiers: g.slideIds.filter((id) => slideUuid.has(id)).map((id) => ({ string: slideUuid.get(id)! })) })),
    cues: p.slides.map((s) => ({
      uuid: { string: slideUuid.get(s.id)! }, isEnabled: s.enabled !== false, completion_action_type: 'COMPLETION_ACTION_TYPE_LAST',
      actions: [{
        uuid: { string: uuid() }, isEnabled: true, type: 'ACTION_TYPE_PRESENTATION_SLIDE', label: s.label ? { text: s.label } : undefined,
        slide: { presentation: { base_slide: {
          size: { width: W, height: H }, uuid: { string: uuid() },
          elements: [{ element: { uuid: { string: uuid() }, bounds: { origin: { x: W * 0.08, y: H * 0.1 }, size: { width: W * 0.84, height: H * 0.8 } }, opacity: 1,
            text: { rtf_data: cocoaRtf(textOf(s), Math.round(H * 0.078)), vertical_alignment: 'VERTICAL_ALIGNMENT_MIDDLE', scale_behavior: 'SCALE_BEHAVIOR_SCALE_FONT_DOWN', attributes: { font: { name: 'HelveticaNeue', size: Math.round(H * 0.039), family: 'Helvetica Neue' }, text_solid_fill: { red: 1, green: 1, blue: 1, alpha: 1 }, paragraph_style: { alignment: 'ALIGNMENT_CENTER', line_height_multiple: 1 } } } }, info: 3 }]
        }, notes: s.notes ? { rtf_data: Buffer.from(`{\\rtf1\\ansi ${escapeRtfText(s.notes)}}`, 'latin1') } : undefined } }
      }]
    })),
    ccli: { author: p.meta.author ?? '', song_title: p.title, publisher: p.meta.publisher ?? '', song_number: Number(p.meta.ccliNumber) || 0, display: !!p.meta.ccliNumber, artist_credits: p.meta.artist ?? '' },
    timeline: { duration: 300 }
  }
  return encodePP7('rv.data.Presentation', doc)
}
