/**
 * Lyrics formats → Presentation: plain text, CCLI SongSelect (.txt and legacy .usr), ChordPro, OpenLyrics, OpenSong.
 * All pure (string in, Presentation out) so they also run in tests and the CLI.
 */
import { DOMParser } from '@xmldom/xmldom'
import type { Presentation } from '@shared/model'
import { importLyricsText, parseSectionHeading, presentationFromSections, type LyricSection, type LyricsImportMeta } from '@shared/import-lyrics'

export interface TextImportResult { presentation: Presentation; warnings: string[] }

const decodeText = (b: Uint8Array): string => {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2))
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2))
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/^﻿/, '') } catch { return new TextDecoder('windows-1252').decode(b) }
}
export { decodeText }

/* ── Plain text ── */
export function importPlainText(title: string, text: string, meta: LyricsImportMeta = {}): TextImportResult {
  return { presentation: importLyricsText(title, text, { source: { type: 'text' }, ...meta }), warnings: [] }
}

/* ── CCLI SongSelect lyrics .txt ──
 * Title
 * (blank)
 * Verse 1
 * lines…
 * (blank)
 * Chorus …
 * …
 * CCLI Song # 1234567
 * Author One | Author Two
 * © 2004 Publisher
 * For use solely with the SongSelect® Terms of Use. All rights reserved. www.ccli.com
 * CCLI License # 12345
 */
export function importSongSelectText(text: string, fallbackTitle = 'Untitled'): TextImportResult {
  const warnings: string[] = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  while (lines.length && !lines[0].trim()) lines.shift()
  const title = (lines.shift() ?? fallbackTitle).trim() || fallbackTitle
  // Footer: from the first "CCLI Song #" line (or a © line near the end) to the end.
  let footerAt = lines.findIndex((l) => /^\s*CCLI\s+Song\s*#/i.test(l))
  if (footerAt < 0) { const c = lines.findIndex((l, i) => i > lines.length - 8 && /^\s*(©|\(c\)|Copyright)/i.test(l)); footerAt = c >= 0 ? Math.max(0, c - 1) : lines.length }
  const body = lines.slice(0, footerAt)
  const footer = lines.slice(footerAt).map((l) => l.trim()).filter(Boolean)
  const meta: LyricsImportMeta = { source: { type: 'songselect' } }
  for (const l of footer) {
    let m: RegExpExecArray | null
    if ((m = /^CCLI\s+Song\s*#\s*(\d+)/i.exec(l))) meta.ccliNumber = m[1]
    else if ((m = /^CCLI\s+Licen[cs]e\s*#\s*(\d+)/i.exec(l))) meta.ccliLicense = m[1]
    else if (/^(©|\(c\)|copyright)/i.test(l)) meta.copyright = l.replace(/^\(c\)/i, '©')
    else if (/songselect|ccli\.com|all rights reserved|terms of use/i.test(l)) continue
    else if (!meta.author) meta.author = l.split('|').map((s) => s.trim()).filter(Boolean).join(', ')
  }
  // Older exports put the author line before the © line without the CCLI line first.
  const pres = importLyricsText(title, body.join('\n'), meta)
  if (!meta.ccliNumber) warnings.push('no CCLI song number found in the footer')
  return { presentation: pres, warnings }
}

/* ── SongSelect .usr (INI) ── */
export function importSongSelectUsr(text: string, fallbackTitle = 'Untitled'): TextImportResult {
  const warnings: string[] = []
  const kv = new Map<string, string>()
  let songNo = ''
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const sec = /^\s*\[S\s*A?(\d+)\]/i.exec(raw)
    if (sec) { songNo = sec[1]; continue }
    const m = /^\s*([A-Za-z]+)\s*=\s*(.*)$/.exec(raw)
    if (m) kv.set(m[1].toLowerCase(), m[2])
  }
  const title = kv.get('title') || fallbackTitle
  const fields = (kv.get('fields') ?? '').split('/t')
  const words = (kv.get('words') ?? '').split('/t')
  if (!words.join('').trim()) warnings.push('no Words= field')
  const sections: LyricSection[] = words.map((w, i) => {
    const name = parseSectionHeading(fields[i] ?? '') ?? (fields[i]?.trim() || '')
    const lines = w.split('/n').map((s) => s.trim())
    // Blank lines inside a section split slides.
    const slides: string[] = []
    let cur: string[] = []
    for (const l of lines) { if (!l) { if (cur.length) slides.push(cur.join('\n')); cur = [] } else cur.push(l) }
    if (cur.length) slides.push(cur.join('\n'))
    return { name, slides }
  }).filter((s) => s.slides.length)
  const authors = (kv.get('author') ?? '').split('|').map((s) => s.trim()).filter(Boolean)
  const meta: LyricsImportMeta = { source: { type: 'songselect-usr' }, author: authors.join(', ') || undefined, copyright: kv.get('copyright')?.replace(/\|/g, ', ') || undefined, ccliNumber: songNo || undefined, category: kv.get('themes')?.split('/t').join(', ') || undefined }
  if (kv.get('keys')) meta.key = kv.get('keys')!.split('/t')[0]
  return { presentation: presentationFromSections(title, sections, meta), warnings }
}

/* ── ChordPro ── */
export interface ChordProResult extends TextImportResult { chords: number }
const CHORD = /\[([^\]]{1,16})\]/g
export function importChordPro(text: string, fallbackTitle = 'Untitled'): ChordProResult {
  const warnings: string[] = []
  const meta: LyricsImportMeta = { source: { type: 'chordpro' } }
  let title = ''
  const sections: LyricSection[] = []
  let cur: LyricSection | null = null
  let buf: string[] = []
  let bufChords: string[] = []
  let chords = 0
  const chordLines: string[][] = []
  const flush = (): void => {
    if (!buf.length) return
    if (!cur) { cur = { name: '', slides: [] }; sections.push(cur) }
    cur.slides.push(buf.join('\n'))
    chordLines.push(bufChords)
    buf = []
    bufChords = []
  }
  const start = (name: string): void => { flush(); cur = { name, slides: [] }; sections.push(cur) }
  const counters: Record<string, number> = {}
  const autoName = (base: string, label?: string): string => {
    if (label?.trim()) return parseSectionHeading(label) ?? label.trim()
    counters[base] = (counters[base] ?? 0) + 1
    return base === 'Chorus' ? 'Chorus' : `${base} ${counters[base]}`
  }
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (/^\s*#/.test(line)) continue
    const d = /^\s*\{\s*([a-z_]+)\s*(?:[: ]\s*(.*?))?\s*\}\s*$/i.exec(line)
    if (d) {
      const k = d[1].toLowerCase()
      const v = (d[2] ?? '').trim()
      switch (k) {
        case 'title': case 't': title = v; break
        case 'subtitle': case 'st': meta.subtitle = v; break
        case 'artist': meta.artist = v; break
        case 'composer': case 'lyricist': case 'author': meta.author = meta.author ? `${meta.author}, ${v}` : v; break
        case 'copyright': meta.copyright = v; break
        case 'ccli': case 'ccli_number': case 'ccli_song_number': meta.ccliNumber = v.replace(/\D/g, ''); break
        case 'key': meta.key = v; break
        case 'tempo': meta.tempo = v; break
        case 'album': meta.album = v; break
        case 'year': meta.year = v; break
        case 'start_of_chorus': case 'soc': start(autoName('Chorus', v)); break
        case 'start_of_verse': case 'sov': start(autoName('Verse', v)); break
        case 'start_of_bridge': case 'sob': start(autoName('Bridge', v)); break
        case 'start_of_tab': case 'sot': case 'start_of_grid': case 'sog': start('__skip'); break
        case 'end_of_chorus': case 'eoc': case 'end_of_verse': case 'eov': case 'end_of_bridge': case 'eob': case 'end_of_tab': case 'eot': case 'end_of_grid': case 'eog':
          flush(); cur = null; break
        case 'chorus': // "repeat the chorus" marker
          break
        case 'comment': case 'c': case 'comment_italic': case 'ci': case 'comment_box': case 'cb': {
          const h = parseSectionHeading(v)
          if (h) start(h)
          break
        }
        default: if (!/^(textfont|textsize|chordfont|chordsize|define|new_page|np|column_break|colb|columns|col|capo|time|duration|meta|x_)/.test(k)) warnings.push(`unknown directive {${k}}`)
      }
      continue
    }
    if (cur && (cur as LyricSection).name === '__skip') continue
    if (!line.trim()) { flush(); continue }
    const heading = buf.length === 0 ? parseSectionHeading(line.replace(CHORD, '')) : null
    if (heading && !CHORD.test(line)) { start(heading); continue }
    CHORD.lastIndex = 0
    const found: string[] = []
    const lyric = line.replace(CHORD, (_m, c: string) => { found.push(c); chords++; return '' }).replace(/\s{2,}/g, ' ').trim()
    bufChords.push(found.join(' '))
    if (lyric) buf.push(lyric)
  }
  flush()
  const kept = sections.filter((s) => s.name !== '__skip')
  const p = presentationFromSections(title || fallbackTitle, kept, meta)
  if (chords) (p.meta as Record<string, unknown>).chordpro = text.length < 100000 ? text : undefined
  return { presentation: p, warnings: [...new Set(warnings)].slice(0, 20), chords }
}

/* ── XML helpers ── */
const parseXml = (text: string): Document => new DOMParser({ errorHandler: { warning: () => {}, error: () => {}, fatalError: () => {} } }).parseFromString(text, 'text/xml') as unknown as Document
const kids = (el: Element | Document | null, name: string): Element[] => {
  if (!el) return []
  const out: Element[] = []
  const list = (el as Element).childNodes
  for (let i = 0; i < list.length; i++) {
    const n = list[i] as Element
    if (n.nodeType === 1 && (n.localName ?? n.nodeName).toLowerCase() === name.toLowerCase()) out.push(n)
  }
  return out
}
const kid = (el: Element | Document | null, name: string): Element | null => kids(el, name)[0] ?? null
const textOf = (el: Element | null): string => (el?.textContent ?? '').trim()

/* ── OpenLyrics ── */
export function importOpenLyrics(text: string, fallbackTitle = 'Untitled'): TextImportResult {
  const warnings: string[] = []
  const doc = parseXml(text)
  const song = kid(doc, 'song')
  if (!song) throw new Error('not an OpenLyrics document (no <song>)')
  const props = kid(song, 'properties')
  const titles = kids(kid(props, 'titles'), 'title')
  const title = textOf(titles.find((t) => !t.getAttribute('lang')) ?? titles[0] ?? null) || fallbackTitle
  const authors = kids(kid(props, 'authors'), 'author').map(textOf).filter(Boolean)
  const meta: LyricsImportMeta = { source: { type: 'openlyrics' } }
  if (authors.length) meta.author = authors.join(', ')
  const cr = textOf(kid(props, 'copyright'))
  if (cr) meta.copyright = cr
  const ccli = textOf(kid(props, 'ccliNo'))
  if (ccli) meta.ccliNumber = ccli
  const pub = textOf(kid(props, 'publisher'))
  if (pub) meta.publisher = pub
  const key = textOf(kid(props, 'key'))
  if (key) meta.key = key
  const themes = kids(kid(props, 'themes'), 'theme').map(textOf).filter(Boolean)
  if (themes.length) meta.category = themes[0]
  const order = textOf(kid(props, 'verseOrder')).split(/\s+/).filter(Boolean)
  const nameOf = (code: string): string => {
    const m = /^([a-z]+)(\d*)([a-z]?)$/i.exec(code)
    if (!m) return code
    const base: Record<string, string> = { v: 'Verse', c: 'Chorus', b: 'Bridge', p: 'Pre-Chorus', i: 'Intro', e: 'Ending', o: 'Other' }
    const b = base[m[1].toLowerCase()] ?? m[1]
    return `${b}${m[2] ? ` ${m[2]}` : ''}${m[3] ? m[3] : ''}`
  }
  const sections: LyricSection[] = []
  const codeToName = new Map<string, string>()
  const lyrics = kid(song, 'lyrics')
  let langs = 0
  for (const v of kids(lyrics, 'verse')) {
    const code = v.getAttribute('name') ?? ''
    if (v.getAttribute('lang') && sections.some((s) => codeToName.get(code) === s.name)) { langs++; continue } // translations: keep the first language
    const name = nameOf(code)
    codeToName.set(code, name)
    const slides: string[] = []
    for (const linesEl of kids(v, 'lines')) {
      const parts: string[] = []
      const walk = (n: Node): void => {
        for (let i = 0; i < n.childNodes.length; i++) {
          const c = n.childNodes[i] as Element
          if (c.nodeType === 3) parts.push(c.nodeValue ?? '')
          else if (c.nodeType === 1) {
            const tag = (c.localName ?? c.nodeName).toLowerCase()
            if (tag === 'br') parts.push('\n')
            else if (tag === 'chord' || tag === 'comment') { if (c.childNodes.length) walk(c) }
            else walk(c)
          }
        }
      }
      walk(linesEl)
      const t = parts.join('').split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
      if (t) slides.push(t)
    }
    sections.push({ name, slides })
  }
  if (langs) warnings.push(`${langs} translated verses skipped (multi-language OpenLyrics)`)
  if (order.length) meta.sequence = order.map((c) => codeToName.get(c) ?? nameOf(c))
  return { presentation: presentationFromSections(title, sections, meta), warnings }
}

/* ── OpenSong ── */
export function importOpenSong(text: string, fallbackTitle = 'Untitled'): TextImportResult {
  const doc = parseXml(text)
  const song = kid(doc, 'song')
  if (!song) throw new Error('not an OpenSong document')
  const title = textOf(kid(song, 'title')) || fallbackTitle
  const meta: LyricsImportMeta = { source: { type: 'opensong' } }
  const author = textOf(kid(song, 'author'))
  if (author) meta.author = author
  const cr = textOf(kid(song, 'copyright'))
  if (cr) meta.copyright = cr
  const ccli = textOf(kid(song, 'ccli'))
  if (ccli) meta.ccliNumber = ccli
  const key = textOf(kid(song, 'key'))
  if (key) meta.key = key
  // [V1] headers, lines starting with '.' are chords, ';' comments, ' ' lyrics, '|' / '||' slide breaks.
  const sections: LyricSection[] = []
  let cur: LyricSection | null = null
  let buf: string[] = []
  const flush = (): void => { if (buf.length && cur) cur.slides.push(buf.join('\n')); buf = [] }
  const name = (code: string): string => {
    const m = /^([A-Za-z]+)\s*(\d*)$/.exec(code.trim())
    const base: Record<string, string> = { V: 'Verse', C: 'Chorus', B: 'Bridge', P: 'Pre-Chorus', T: 'Tag', I: 'Intro', E: 'Ending' }
    return m ? `${base[m[1].toUpperCase()] ?? m[1]}${m[2] ? ` ${m[2]}` : ''}` : code
  }
  for (const raw of textOf(kid(song, 'lyrics')).replace(/\r\n?/g, '\n').split('\n')) {
    const h = /^\s*\[([^\]]+)\]/.exec(raw)
    if (h) { flush(); cur = { name: name(h[1]), slides: [] }; sections.push(cur); continue }
    if (/^[.;]/.test(raw)) continue
    if (!cur) { cur = { name: '', slides: [] }; sections.push(cur) }
    if (/^\s*\|\|?\s*$/.test(raw) || !raw.trim()) { flush(); continue }
    const l = raw.replace(/^\d?\s?/, '').replace(/_/g, '').replace(/\|/g, '').trim()
    if (l) buf.push(l)
  }
  flush()
  const pres = textOf(kid(song, 'presentation')).split(/\s+/).filter(Boolean)
  if (pres.length) meta.sequence = pres.map(name)
  return { presentation: presentationFromSections(title, sections, meta), warnings: [] }
}
