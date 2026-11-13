/**
 * Lyrics text → Presentation. Pure (no Node / Electron imports) so the importers, the Planning Center
 * integration, the renderer's paste box and tests can all share it.
 *
 *   import { importLyricsText, parseLyricSections } from '@shared/import-lyrics'
 *   const song = importLyricsText('Amazing Grace', text, { author: 'John Newton', ccliNumber: '22025' })
 *
 * Rules: a blank line starts a new slide. A line that is only a section name ("Verse 1", "[Chorus]",
 * "CHORUS 2:", "Pre-Chorus", "Bridge (x2)") starts a new group. Text before the first heading is ungrouped.
 */
import type { Arrangement, ID, Presentation, PresentationMeta, Size, Slide, SlideGroup, TextElement } from './model'
import { DEFAULT_SIZE, textToParagraphs } from './model'

export function newImportId(): ID {
  const b = new Uint8Array(8)
  globalThis.crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

export interface LyricSection {
  /** Display name, e.g. "Verse 1". Empty string for text before any heading. */
  name: string
  /** One entry per slide; each entry is the slide's lines joined with \n. */
  slides: string[]
}

const SECTION_WORDS: Record<string, string> = {
  verse: 'Verse', v: 'Verse', chorus: 'Chorus', c: 'Chorus', refrain: 'Refrain', bridge: 'Bridge', b: 'Bridge',
  'pre-chorus': 'Pre-Chorus', prechorus: 'Pre-Chorus', 'pre chorus': 'Pre-Chorus', pc: 'Pre-Chorus', p: 'Pre-Chorus',
  intro: 'Intro', outro: 'Outro', tag: 'Tag', ending: 'Ending', interlude: 'Interlude',
  instrumental: 'Instrumental', vamp: 'Vamp', turnaround: 'Turnaround', coda: 'Coda', hook: 'Hook',
  'post-chorus': 'Post-Chorus', postchorus: 'Post-Chorus', 'post chorus': 'Post-Chorus', rap: 'Rap', spoken: 'Spoken',
  'spoken word': 'Spoken', misc: 'Misc', blank: 'Blank',
  // Common non-English names found in real libraries
  strophe: 'Verse', vers: 'Verse', refrão: 'Chorus', coro: 'Chorus', estrofa: 'Verse', verso: 'Verse', puente: 'Bridge',
  refrein: 'Chorus', couplet: 'Verse', brücke: 'Bridge', zwischenspiel: 'Interlude'
}
const SINGLE_LETTER = new Set(['v', 'c', 'b', 'p'])

/**
 * If `line` is a section heading, returns its normalised name ("Verse 1"), else null.
 * Accepts "Verse 1", "VERSE 1:", "[Chorus]", "(Bridge)", "Chorus 2 (x2)", "V1", "C", "Pre-Chorus 1".
 */
export function parseSectionHeading(line: string): string | null {
  let s = line.trim()
  if (!s || s.length > 40) return null
  const bracketed = /^[[({<].*[\])}>]:?$/.test(s)
  s = s.replace(/^[[({<]\s*/, '').replace(/\s*[\])}>]\s*:?$/, '').replace(/:$/, '').trim()
  // "(x2)", "x2", "2x", "(repeat)" suffixes
  let suffix = ''
  const rep = /\s*[([]?\s*(x\s*\d+|\d+\s*x|repeat)\s*[)\]]?$/i.exec(s)
  if (rep && rep.index > 0) { suffix = ` (${rep[1].replace(/\s+/g, '').toLowerCase()})`; s = s.slice(0, rep.index).trim() }
  const m = /^([A-Za-zÀ-ÿ]+(?:[- ][A-Za-zÀ-ÿ]+)?)\s*(\d{1,2}[a-z]?)?$/.exec(s)
  if (!m) return null
  const word = m[1].toLowerCase()
  const base = SECTION_WORDS[word]
  if (!base) return null
  // Bare single letters ("C", "V") are only headings when numbered or bracketed — otherwise they're lyrics/chords.
  if (SINGLE_LETTER.has(word) && !m[2] && !bracketed) return null
  return `${base}${m[2] ? ` ${m[2].toUpperCase()}` : ''}${suffix}`
}

export interface LyricParseOptions {
  /** Split slides that have more than this many lines (0/undefined = keep the author's breaks). */
  linesPerSlide?: number
  /** Treat every line break as a new slide instead of blank lines. */
  slidePerLine?: boolean
}

export function parseLyricSections(text: string, opts: LyricParseOptions = {}): LyricSection[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/[\u2028\u2029\v\f]/g, '\n').split('\n')
  const sections: LyricSection[] = []
  let current: LyricSection | null = null
  let buf: string[] = []
  const flush = (): void => {
    if (!buf.length) return
    if (!current) { current = { name: '', slides: [] }; sections.push(current) }
    const n = opts.linesPerSlide && opts.linesPerSlide > 0 ? opts.linesPerSlide : 0
    if (n && buf.length > n) for (let i = 0; i < buf.length; i += n) current.slides.push(buf.slice(i, i + n).join('\n'))
    else current.slides.push(buf.join('\n'))
    buf = []
  }
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) { flush(); continue }
    const heading = buf.length === 0 ? parseSectionHeading(line) : null
    if (heading) {
      current = { name: heading, slides: [] }
      sections.push(current)
      continue
    }
    buf.push(line.trim())
    if (opts.slidePerLine) flush()
  }
  flush()
  return sections.filter((s) => s.name || s.slides.length)
}

const GROUP_COLORS: Record<string, string> = {
  verse: '#3886CE', chorus: '#E6A20F', refrain: '#E6A20F', bridge: '#9B6BD3', 'pre-chorus': '#4FA88B', 'post-chorus': '#4FA88B',
  intro: '#7A7A7A', outro: '#7A7A7A', tag: '#D8674F', ending: '#7A7A7A', interlude: '#7A7A7A', instrumental: '#7A7A7A',
  vamp: '#D8674F', turnaround: '#7A7A7A', coda: '#7A7A7A', hook: '#D8674F'
}
/** Reach's default colour for a section name (same palette the library uses). */
export function sectionColor(name: string): string {
  const k = name.toLowerCase().replace(/\s*\(.*\)$/, '').replace(/\s*\d+[a-z]?$/, '').trim()
  return GROUP_COLORS[k] ?? '#7A7A7A'
}

/** A standard centred lyric slide in Reach's default look (mirrors main/core/library lyricSlide). */
export function makeLyricSlide(text: string, size: Size = DEFAULT_SIZE): Slide {
  const el: TextElement = {
    id: newImportId(), type: 'text', role: 'lyrics', name: 'Lyrics',
    frame: { x: size.width * 0.08, y: size.height * 0.1, w: size.width * 0.84, h: size.height * 0.8 },
    paragraphs: textToParagraphs(text), align: 'center', verticalAlign: 'middle', autoFit: true,
    style: { fontFamily: 'Reach Sans', fontSize: Math.round(size.height * 0.085), fontWeight: 600, color: '#FFFFFF', lineHeight: 1.2 }
  }
  return { id: newImportId(), elements: [el] }
}

export interface LyricsImportMeta extends PresentationMeta {
  kind?: Presentation['kind']
  size?: Size
  /** Section order, e.g. ["Verse 1", "Chorus", "Verse 2", "Chorus"] (Planning Center sequence, OpenLyrics verseOrder). */
  sequence?: string[]
  /** Name for the arrangement built from `sequence`. */
  arrangementName?: string
  parse?: LyricParseOptions
}

/** Build a Presentation from already-parsed sections. */
export function presentationFromSections(title: string, sections: LyricSection[], meta: LyricsImportMeta = {}): Presentation {
  const { kind, size: sizeOpt, sequence, arrangementName, parse: _parse, ...restMeta } = meta
  const size = sizeOpt ?? DEFAULT_SIZE
  const now = new Date().toISOString()
  const slides: Slide[] = []
  const groups: SlideGroup[] = []
  for (const sec of sections) {
    const made = sec.slides.map((t) => makeLyricSlide(t, size))
    if (!made.length && sec.name) made.push(makeLyricSlide('', size))
    slides.push(...made)
    if (sec.name) groups.push({ id: newImportId(), name: sec.name, color: sectionColor(sec.name), slideIds: made.map((s) => s.id) })
  }
  if (!slides.length) slides.push(makeLyricSlide('', size))
  const arrangements: Arrangement[] = []
  if (sequence?.length) {
    const arr = buildArrangement(groups, sequence, arrangementName)
    if (arr) arrangements.push(arr)
  }
  const cleanMeta: PresentationMeta = {}
  for (const [k, v] of Object.entries(restMeta)) if (v !== undefined && v !== '') cleanMeta[k] = v
  return {
    id: newImportId(), title: title.trim() || 'Untitled', kind: kind ?? 'song', size: { ...size },
    slides, groups, arrangements, activeArrangementId: arrangements[0]?.id, meta: cleanMeta, createdAt: now, updatedAt: now
  }
}

/** Match a sequence of section names (loosely: "v1", "Verse 1", "chorus") to groups → an Arrangement. */
export function buildArrangement(groups: SlideGroup[], sequence: string[], name = 'Default'): Arrangement | null {
  const norm = (s: string): string => (parseSectionHeading(s) ?? s).toLowerCase().replace(/\s+/g, ' ').replace(/\s*\(.*\)$/, '').trim()
  const byName = new Map<string, SlideGroup>()
  for (const g of groups) if (!byName.has(norm(g.name))) byName.set(norm(g.name), g)
  const ids: ID[] = []
  for (const s of sequence) {
    const k = norm(s)
    const g = byName.get(k) ?? byName.get(`${k} 1`) ?? (/ 1$/.test(k) ? byName.get(k.replace(/ 1$/, '')) : undefined)
    if (g) ids.push(g.id)
  }
  return ids.length ? { id: newImportId(), name, groupIds: ids } : null
}

/**
 * THE shared entry point: plain lyrics text → a ready-to-save Presentation.
 * `meta` carries copyright info (author, copyright, ccliNumber, source…) plus optional `sequence`.
 */
export function importLyricsText(title: string, text: string, meta: LyricsImportMeta = {}): Presentation {
  return presentationFromSections(title, parseLyricSections(text, meta.parse), meta)
}

/** Presentation → plain lyrics text (inverse of the above; used by exports). */
export function lyricsTextOf(p: Presentation, opts: { headings?: boolean; role?: string } = {}): string {
  const headings = opts.headings !== false
  const groupOf = new Map<ID, SlideGroup>()
  for (const g of p.groups) for (const id of g.slideIds) if (!groupOf.has(id)) groupOf.set(id, g)
  const out: string[] = []
  let last: SlideGroup | undefined | null = null
  for (const s of p.slides) {
    if (s.enabled === false) continue
    const g = groupOf.get(s.id)
    const texts = s.elements.filter((e): e is TextElement => e.type === 'text' && !e.dynamic && !e.hidden)
    const pick = opts.role ? texts.filter((t) => t.role === opts.role) : texts.filter((t) => t.role !== 'translation' || texts.length === 1)
    const body = (pick.length ? pick : texts).map((t) => t.paragraphs.map((q) => q.runs.map((r) => r.text).join('')).join('\n')).join('\n').trim()
    let block = ''
    if (headings && g && g !== last) block += `${g.name}\n`
    last = g ?? null
    if (!body && !block) continue
    out.push(block + body)
  }
  return out.join('\n\n').trim() + '\n'
}
