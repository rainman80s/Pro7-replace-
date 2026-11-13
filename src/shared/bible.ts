/**
 * Bible references, paging and slide building. Pure — shared by the main-process Bible
 * service, the Notion importer (scripture auto-fill) and the Bible view.
 */
import type { Size, Slide, TextElement, TextRun } from './model'
import { DEFAULT_SIZE } from './model'

/* ───────────── books ───────────── */

export interface BookInfo { id: string; name: string; chapters: number; aliases: string[] }

// [USFM id, name, chapters, extra aliases…]  (names and unique ≥3-letter prefixes always match)
const RAW: [string, string, number, ...string[]][] = [
  ['GEN', 'Genesis', 50, 'gn', 'ge'], ['EXO', 'Exodus', 40, 'ex', 'exod'], ['LEV', 'Leviticus', 27, 'lv', 'le'], ['NUM', 'Numbers', 36, 'nm', 'nu', 'nb'],
  ['DEU', 'Deuteronomy', 34, 'dt', 'de', 'deut'], ['JOS', 'Joshua', 24, 'jsh', 'josh'], ['JDG', 'Judges', 21, 'jdg', 'jg', 'jdgs', 'judg'], ['RUT', 'Ruth', 4, 'rth', 'ru'],
  ['1SA', '1 Samuel', 31, '1sm', '1sa', '1s'], ['2SA', '2 Samuel', 24, '2sm', '2sa', '2s'], ['1KI', '1 Kings', 22, '1kgs', '1ki', '1k', '1kg'], ['2KI', '2 Kings', 25, '2kgs', '2ki', '2k', '2kg'],
  ['1CH', '1 Chronicles', 29, '1chr', '1ch', '1chron'], ['2CH', '2 Chronicles', 36, '2chr', '2ch', '2chron'], ['EZR', 'Ezra', 10, 'ezr'], ['NEH', 'Nehemiah', 13, 'ne'],
  ['EST', 'Esther', 10, 'es', 'esth'], ['JOB', 'Job', 42, 'jb'], ['PSA', 'Psalms', 150, 'ps', 'psalm', 'pslm', 'psa', 'psm', 'pss'], ['PRO', 'Proverbs', 31, 'prv', 'pr', 'prov'],
  ['ECC', 'Ecclesiastes', 12, 'ec', 'qoh', 'eccl', 'eccles'], ['SNG', 'Song of Songs', 8, 'sos', 'song', 'songofsolomon', 'canticles', 'sng', 'ss', 'so'], ['ISA', 'Isaiah', 66, 'is'], ['JER', 'Jeremiah', 52, 'jr', 'je'],
  ['LAM', 'Lamentations', 5, 'la'], ['EZK', 'Ezekiel', 48, 'ezk', 'ez', 'ezek'], ['DAN', 'Daniel', 12, 'dn', 'da'], ['HOS', 'Hosea', 14, 'ho'],
  ['JOL', 'Joel', 3, 'jl', 'joe'], ['AMO', 'Amos', 9, 'am'], ['OBA', 'Obadiah', 1, 'ob', 'obad'], ['JON', 'Jonah', 4, 'jnh', 'jon'],
  ['MIC', 'Micah', 7, 'mc', 'mi'], ['NAM', 'Nahum', 3, 'na', 'nah'], ['HAB', 'Habakkuk', 3, 'hb'], ['ZEP', 'Zephaniah', 3, 'zp', 'zep', 'zeph'],
  ['HAG', 'Haggai', 2, 'hg'], ['ZEC', 'Zechariah', 14, 'zc', 'zec', 'zech'], ['MAL', 'Malachi', 4, 'ml'],
  ['MAT', 'Matthew', 28, 'mt', 'matt'], ['MRK', 'Mark', 16, 'mk', 'mr', 'mrk'], ['LUK', 'Luke', 24, 'lk', 'lu'], ['JHN', 'John', 21, 'jn', 'jhn', 'joh'],
  ['ACT', 'Acts', 28, 'ac'], ['ROM', 'Romans', 16, 'rm', 'ro'], ['1CO', '1 Corinthians', 16, '1cor', '1co'], ['2CO', '2 Corinthians', 13, '2cor', '2co'],
  ['GAL', 'Galatians', 6, 'ga'], ['EPH', 'Ephesians', 6, 'ep', 'ephes'], ['PHP', 'Philippians', 4, 'php', 'phil', 'pp', 'phl'], ['COL', 'Colossians', 4, 'co'],
  ['1TH', '1 Thessalonians', 5, '1thess', '1th', '1thes'], ['2TH', '2 Thessalonians', 3, '2thess', '2th', '2thes'], ['1TI', '1 Timothy', 6, '1tim', '1ti', '1tm'], ['2TI', '2 Timothy', 4, '2tim', '2ti', '2tm'],
  ['TIT', 'Titus', 3, 'ti', 'tit'], ['PHM', 'Philemon', 1, 'phm', 'philem', 'pm', 'phlm'], ['HEB', 'Hebrews', 13, 'hb', 'he'], ['JAS', 'James', 5, 'jas', 'jm', 'ja'],
  ['1PE', '1 Peter', 5, '1pet', '1pe', '1pt', '1p'], ['2PE', '2 Peter', 3, '2pet', '2pe', '2pt', '2p'], ['1JN', '1 John', 5, '1jn', '1jhn', '1jo', '1j'], ['2JN', '2 John', 1, '2jn', '2jhn', '2jo', '2j'],
  ['3JN', '3 John', 1, '3jn', '3jhn', '3jo', '3j'], ['JUD', 'Jude', 1, 'jd', 'jud'], ['REV', 'Revelation', 22, 'rv', 're', 'revelations', 'apocalypse', 'apoc']
]

export const BOOKS: BookInfo[] = RAW.map(([id, name, chapters, ...aliases]) => ({ id, name, chapters, aliases }))
const BY_ID = new Map(BOOKS.map((b) => [b.id, b]))
export const bookById = (id: string): BookInfo | undefined => BY_ID.get(id.toUpperCase())

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const ALIAS = new Map<string, string>()
for (const b of BOOKS) {
  for (const a of [b.name, b.id, ...b.aliases]) if (!ALIAS.has(squash(a))) ALIAS.set(squash(a), b.id)
  // "Habakkuk" also claimed 'hb'; Hebrews keeps 'heb' via prefix below.
}
ALIAS.set('hb', 'HAB'); ALIAS.set('psalms', 'PSA'); ALIAS.set('songofsongs', 'SNG')
// Unique prefixes (≥3 letters, or ≥2 after a leading digit): "rev", "gen", "matth", "1cori"…
for (const b of BOOKS) {
  const full = squash(b.name)
  const min = /^\d/.test(full) ? 3 : 3
  for (let n = min; n < full.length; n++) {
    const pre = full.slice(0, n)
    if (ALIAS.has(pre)) continue
    const clash = BOOKS.filter((o) => squash(o.name).startsWith(pre))
    if (clash.length === 1 || clash[0].id === b.id) ALIAS.set(pre, clash[0].id)
  }
}

const ORDINAL: [RegExp, string][] = [
  [/^(?:1st|first|i)\s+(?=[a-z])/, '1 '], [/^(?:2nd|second|ii)\s+(?=[a-z])/, '2 '], [/^(?:3rd|third|iii)\s+(?=[a-z])/, '3 ']
]

/** Longest leading book name in `s` (already lower-case). Returns the book and the rest of the string. */
export function matchBook(input: string): { book: BookInfo; rest: string } | null {
  let s = input.trim().toLowerCase()
  for (const [re, rep] of ORDINAL) s = s.replace(re, rep)
  // Candidate prefix: optional digit, then letters / spaces / dots — stop at the first digit after letters.
  const m = /^([123]?\s*[a-z][a-z.\s]*?)\s*(?=\d|$)/.exec(s)
  if (!m) return null
  const words = m[1].replace(/\./g, ' ').trim().split(/\s+/)
  for (let n = words.length; n >= 1; n--) {
    const id = ALIAS.get(squash(words.slice(0, n).join('')))
    if (!id) continue
    if (n < words.length) return null // trailing words that aren't part of a book name ("john said 3")
    return { book: BY_ID.get(id)!, rest: s.slice(m[0].length).trim() }
  }
  return null
}

/* ───────────── references ───────────── */

export interface Passage {
  /** USFM book id: GEN, JHN, 1CO… */
  book: string
  chapter: number
  /** Undefined = from the start of the chapter. */
  verse?: number
  endChapter: number
  /** Undefined = to the end of `endChapter`. */
  endVerse?: number
  translation?: string
}

export const TRANSLATIONS = ['ESV', 'NIV', 'KJV', 'NKJV', 'CSB', 'HCSB', 'NLT', 'NASB', 'NASB95', 'BSB', 'WEB', 'ASV', 'MSG', 'AMP', 'NET', 'RSV', 'NRSV', 'NRSVUE', 'LSB', 'NIRV', 'CEV', 'GNT', 'YLT', 'TPT', 'NVI', 'RVR', 'RVR1960', 'NTV', 'LBLA']

function takeTranslation(s: string): { rest: string; translation?: string } {
  const paren = /\s*[([]\s*([A-Za-z][A-Za-z0-9]{1,8})\s*\)?\]?\s*$/.exec(s)
  if (paren && /[([]/.test(paren[0])) return { rest: s.slice(0, paren.index), translation: paren[1].toUpperCase() }
  const word = /[\s,]+([A-Za-z][A-Za-z0-9]{1,8})\s*$/.exec(s)
  if (word && TRANSLATIONS.includes(word[1].toUpperCase())) return { rest: s.slice(0, word.index), translation: word[1].toUpperCase() }
  return { rest: s }
}

const cleanSpec = (s: string): string => s
  .replace(/[‒-―−]/g, '-').replace(/\bto\b/g, '-').replace(/\b(?:verses?|vv?\.?|vs\.?)\s*(?=\d)/g, ':').replace(/\b(?:chapters?|ch\.?)\s*(?=\d)/g, '')
  .replace(/(\d)\s*[.]\s*(\d)/g, '$1:$2').replace(/\s*([:,;-])\s*/g, '$1').replace(/:+/g, ':').replace(/^:/, '').trim()

function parseSpec(book: BookInfo, raw: string): Passage[] | null {
  let spec = cleanSpec(raw)
  if (!spec) return book.chapters === 1 ? [{ book: book.id, chapter: 1, endChapter: 1 }] : null
  if (!/^[\d:,;\- ]+[a-c]?$/.test(spec.replace(/(\d)[a-c]\b/g, '$1'))) return null
  spec = spec.replace(/(\d)[a-c]\b/g, '$1') // "16a" → 16
  // Space-separated shorthand: "3 16-18" → 3:16-18, "1 2 3" → 1:2-3
  if (!spec.includes(':')) {
    const sp = /^(\d+) (\d+)(?:[ -](\d+))?$/.exec(spec)
    if (sp) spec = `${sp[1]}:${sp[2]}${sp[3] ? '-' + sp[3] : ''}`
  }
  if (spec.includes(' ')) return null
  const out: Passage[] = []
  let chapter = 0
  let verseMode = false
  for (const group of spec.split(';')) {
    let first = true
    for (const part of group.split(',')) {
      if (!part) return null
      const [a, b, extra] = part.split('-')
      if (extra !== undefined || a === '') return null
      const A = a.split(':').map(Number), B = b !== undefined && b !== '' ? b.split(':').map(Number) : null
      if (A.length > 2 || (B && B.length > 2) || A.some(isNaN) || (B && B.some(isNaN))) return null
      let p: Passage
      if (A.length === 2) {
        chapter = A[0]; verseMode = true
        p = { book: book.id, chapter, verse: A[1], endChapter: chapter, endVerse: A[1] }
        if (B) { if (B.length === 2) { p.endChapter = B[0]; p.endVerse = B[1] } else p.endVerse = B[0] }
      } else if ((verseMode && !first) || (verseMode && first && group !== spec.split(';')[0] && false)) {
        // bare number after a "c:v" in the same comma list = more verses of that chapter
        p = { book: book.id, chapter, verse: A[0], endChapter: chapter, endVerse: B ? (B.length === 2 ? B[1] : B[0]) : A[0] }
        if (B && B.length === 2) p.endChapter = B[0]
      } else if (book.chapters === 1) {
        // Single-chapter books: "Jude 5" is verse 5 (but "Jude 1" alone is the whole book).
        chapter = 1; verseMode = true
        if (A[0] === 1 && !B && spec === '1') p = { book: book.id, chapter: 1, endChapter: 1 }
        else p = { book: book.id, chapter: 1, verse: A[0], endChapter: 1, endVerse: B ? B[B.length - 1] : A[0] }
      } else {
        chapter = A[0]; verseMode = false
        p = { book: book.id, chapter, endChapter: chapter }
        if (B) { if (B.length === 2) { p.endChapter = B[0]; p.endVerse = B[1] } else p.endChapter = B[0] }
      }
      first = false
      if (p.chapter < 1 || p.endChapter > book.chapters || p.chapter > p.endChapter) return null
      if (p.verse !== undefined && (p.verse < 1 || p.verse > 176)) return null
      if (p.endVerse !== undefined && (p.endVerse < 1 || p.endVerse > 176)) return null
      if (p.chapter === p.endChapter && p.verse !== undefined && p.endVerse !== undefined && p.endVerse < p.verse) return null
      out.push(p)
    }
    verseMode = false
  }
  return out.length ? out : null
}

/**
 * Parse free text into passages: "jn 3 16-18", "John 3:16–18 (ESV)", "1 cor 13", "Gen 1:1-2:3",
 * "John 3:16,18,20-22", "Ps 23; John 1:1", "Jude 5", "Rev 2-3", "Matt 1 2 3".
 * Returns [] when the text is not (entirely) a scripture reference.
 */
export function parseReferences(input: string): Passage[] {
  const t = takeTranslation(input.trim().replace(/^[“"'‘(]+|[”"'’.;,]+$/g, ''))
  const out: Passage[] = []
  let lastBook: BookInfo | null = null
  for (const chunk of t.rest.split(/\s*;\s*/)) {
    if (!chunk.trim()) continue
    const local = takeTranslation(chunk)
    const m = matchBook(local.rest)
    let book = m?.book ?? null
    let rest = m ? m.rest : local.rest
    if (!book) {
      if (!lastBook || !/^\s*\d/.test(chunk)) return []
      book = lastBook
      rest = local.rest
    }
    const ps = parseSpec(book, rest)
    if (!ps) return []
    lastBook = book
    for (const p of ps) { const tr = local.translation ?? t.translation; if (tr) p.translation = tr; out.push(p) }
  }
  return out
}

export const parseReference = (input: string): Passage | null => parseReferences(input)[0] ?? null

/** Is this line nothing but a scripture reference (optionally with a translation)? Used by the Notion importer. */
export function isReferenceOnly(text: string): boolean {
  const s = text.trim()
  if (!s || s.length > 90 || !/\d/.test(s)) return false
  return parseReferences(s).length > 0
}

export function formatReference(p: Passage, opts: { translation?: boolean; short?: boolean } = {}): string {
  const b = BY_ID.get(p.book)
  const name = b ? (opts.short ? shortName(b) : b.id === 'PSA' && p.chapter === p.endChapter ? 'Psalm' : b.name) : p.book
  let s: string
  const single = b?.chapters === 1
  if (p.verse === undefined) s = single ? name : p.chapter === p.endChapter && p.endVerse === undefined ? `${name} ${p.chapter}` : p.endVerse === undefined ? `${name} ${p.chapter}–${p.endChapter}` : `${name} ${p.chapter}:1–${p.endChapter}:${p.endVerse}`
  else if (p.chapter === p.endChapter) s = `${name} ${single ? '' : p.chapter + ':'}${p.verse}${p.endVerse !== undefined && p.endVerse !== p.verse ? '–' + p.endVerse : p.endVerse === undefined ? '–end' : ''}`
  else s = `${name} ${p.chapter}:${p.verse}–${p.endChapter}${p.endVerse !== undefined ? ':' + p.endVerse : ''}`
  return opts.translation && p.translation ? `${s} (${p.translation})` : s
}
const shortName = (b: BookInfo): string => (b.name.length <= 5 ? b.name : b.name.replace(/^(\d )?(\w{3}).*$/, (_m, n, w) => `${n ?? ''}${w}`))

export function passageKey(p: Passage): string {
  return `${p.book}.${p.chapter}${p.verse !== undefined ? '.' + p.verse : ''}-${p.endChapter}${p.endVerse !== undefined ? '.' + p.endVerse : ''}`
}

/* ───────────── verses & offline Bible format ───────────── */

export interface Verse { book: string; chapter: number; verse: number; text: string }

/**
 * Offline translation file: <workspace>/bibles/<ID>.json. Compact so a whole Bible is ~4 MB:
 * books[USFM][chapter-1][verse-1] = text ('' for verses a translation omits).
 */
export interface BibleFile {
  id: string
  name: string
  abbreviation: string
  language: string
  /** Shown on the last slide / footer when required. Empty for public-domain texts. */
  copyright?: string
  license: string
  source?: string
  downloadedAt?: string
  books: Record<string, string[][]>
}

export interface TranslationInfo {
  id: string
  name: string
  abbreviation: string
  language?: string
  provider: string
  /** Available without the internet. */
  offline: boolean
  copyright?: string
  license?: string
}

export function versesFromFile(bible: Pick<BibleFile, 'books'>, p: Passage): Verse[] {
  const book = bible.books[p.book]
  if (!book) return []
  const out: Verse[] = []
  for (let c = p.chapter; c <= p.endChapter; c++) {
    const ch = book[c - 1]
    if (!ch) continue
    const from = c === p.chapter ? p.verse ?? 1 : 1
    const to = c === p.endChapter ? p.endVerse ?? ch.length : ch.length
    for (let v = from; v <= Math.min(to, ch.length); v++) if (ch[v - 1]) out.push({ book: p.book, chapter: c, verse: v, text: ch[v - 1] })
  }
  return out
}

export function searchFile(bible: Pick<BibleFile, 'books'>, query: string, limit = 50): Verse[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1)
  if (!words.length) return []
  const phrase = query.toLowerCase().trim()
  const hits: { v: Verse; score: number }[] = []
  for (const b of BOOKS) {
    const book = bible.books[b.id]
    if (!book) continue
    for (let c = 0; c < book.length; c++) for (let v = 0; v < (book[c]?.length ?? 0); v++) {
      const text = book[c][v]
      if (!text) continue
      const lc = text.toLowerCase()
      if (!words.every((w) => lc.includes(w))) continue
      hits.push({ v: { book: b.id, chapter: c + 1, verse: v + 1, text }, score: lc.includes(phrase) ? 2 : 1 })
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit).map((h) => h.v)
}

/** The passage a list of verses actually covers (after clamping to what exists). */
export function passageOf(verses: Verse[], translation?: string): Passage | null {
  if (!verses.length) return null
  const a = verses[0], z = verses[verses.length - 1]
  return { book: a.book, chapter: a.chapter, verse: a.verse, endChapter: z.chapter, endVerse: z.verse, ...(translation ? { translation } : {}) }
}

/** Step a passage to the next/previous verse-window (crossing chapters) — "Next verse" button. */
export function shiftPassage(p: Passage, dir: 1 | -1, chapterLength: (book: string, chapter: number) => number): Passage | null {
  const b = BY_ID.get(p.book)
  if (!b) return null
  const span = p.verse !== undefined && p.endVerse !== undefined && p.chapter === p.endChapter ? p.endVerse - p.verse + 1 : 1
  if (dir === 1) {
    const last = p.endVerse ?? chapterLength(p.book, p.endChapter)
    let c = p.endChapter, v = last + 1
    if (v > chapterLength(p.book, c)) { c++; v = 1 }
    if (c > b.chapters) return null
    return { ...p, chapter: c, verse: v, endChapter: c, endVerse: Math.min(v + span - 1, chapterLength(p.book, c)) }
  }
  let c = p.chapter, v = (p.verse ?? 1) - span
  if ((p.verse ?? 1) <= 1) { c--; if (c < 1) return null; const len = chapterLength(p.book, c); v = Math.max(1, len - span + 1) }
  v = Math.max(1, v)
  return { ...p, chapter: c, verse: v, endChapter: c, endVerse: Math.min(v + span - 1, chapterLength(p.book, c)) }
}

/* ───────────── paging ───────────── */

export interface PagingOptions {
  /** 'verses' = N verses per slide; 'fit' = as many whole verses as fit in maxChars. */
  mode: 'verses' | 'fit'
  versesPerSlide: number
  maxChars: number
}
export const defaultPaging = (): PagingOptions => ({ mode: 'fit', versesPerSlide: 1, maxChars: 280 })

export interface VersePage { verses: Verse[]; /** True when this page is a continuation of a verse split across slides. */ continued?: boolean }

function splitLong(v: Verse, maxChars: number): Verse[] {
  if (v.text.length <= maxChars * 1.25) return [v]
  const parts: string[] = []
  let cur = ''
  for (const piece of v.text.split(/(?<=[.;:!?”"’)]\s|,\s|—)/)) {
    if (cur && (cur + piece).length > maxChars) { parts.push(cur.trim()); cur = '' }
    cur += piece
    while (cur.length > maxChars * 1.25) { // no punctuation to break on: break at a space
      const at = cur.lastIndexOf(' ', maxChars)
      if (at <= 0) break
      parts.push(cur.slice(0, at).trim()); cur = cur.slice(at + 1)
    }
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts.map((text) => ({ ...v, text }))
}

export function pageVerses(verses: Verse[], opts: PagingOptions): VersePage[] {
  const pages: VersePage[] = []
  if (opts.mode === 'verses') {
    const n = Math.max(1, opts.versesPerSlide)
    for (let i = 0; i < verses.length; i += n) {
      const group = verses.slice(i, i + n)
      const total = group.reduce((s, v) => s + v.text.length, 0)
      if (n === 1 && total > opts.maxChars * 1.25) splitLong(group[0], opts.maxChars).forEach((v, k) => pages.push({ verses: [v], continued: k > 0 }))
      else pages.push({ verses: group })
    }
    return pages
  }
  let cur: Verse[] = [], len = 0
  const flush = (): void => { if (cur.length) pages.push({ verses: cur }); cur = []; len = 0 }
  for (const v of verses) {
    if (v.text.length > opts.maxChars * 1.25) {
      flush()
      splitLong(v, opts.maxChars).forEach((part, k) => pages.push({ verses: [part], continued: k > 0 }))
      continue
    }
    if (cur.length && len + v.text.length > opts.maxChars) flush()
    cur.push(v); len += v.text.length + 1
  }
  flush()
  return pages
}

/* ───────────── slides ───────────── */

const rid = (): string => Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10)

export interface ScriptureSlideOptions {
  size?: Size
  showVerseNumbers?: boolean
  /** 'each' = range shown on each slide, 'passage' = whole passage on each, 'last' = only last slide, 'none'. */
  reference?: 'each' | 'passage' | 'last' | 'none'
  translationLabel?: string
  /** Required copyright line — goes on the last slide. */
  copyright?: string
  newId?: () => string
  fontFamily?: string
}

export function verseRuns(verses: Verse[], showNumbers: boolean, continued = false): TextRun[] {
  const runs: TextRun[] = []
  verses.forEach((v, i) => {
    if (showNumbers && !(continued && i === 0)) runs.push({ text: `${i ? ' ' : ''}${v.verse} `, style: { fontSize: undefined, color: '#E6A20F', fontWeight: 700 } })
    else if (i) runs.push({ text: ' ' })
    runs.push({ text: v.text })
  })
  return runs
}

export function textEl(role: string, runs: TextRun[][], frame: { x: number; y: number; w: number; h: number }, style: TextElement['style'], extra: Partial<TextElement> = {}, newId: () => string = rid): TextElement {
  return {
    id: newId(), type: 'text', role, name: role[0].toUpperCase() + role.slice(1), frame,
    paragraphs: runs.map((r) => ({ runs: r })), style, align: 'center', verticalAlign: 'middle', autoFit: true, ...extra
  }
}

/** Standard Reach scripture look: body text + reference line (+ parallel translation, + copyright on the last slide). */
export function scriptureSlides(pages: VersePage[], passage: Passage, opts: ScriptureSlideOptions = {}, parallel?: { pages: Verse[][]; label: string }): Slide[] {
  const size = opts.size ?? DEFAULT_SIZE
  const id = opts.newId ?? rid
  const W = size.width, H = size.height
  const font = opts.fontFamily ?? 'Reach Sans'
  const refMode = opts.reference ?? 'each'
  const label = opts.translationLabel ?? passage.translation
  return pages.map((page, i) => {
    const last = i === pages.length - 1
    const range = passageOf(page.verses)
    const refText = refMode === 'none' || (refMode === 'last' && !last) ? '' : formatReference(refMode === 'passage' || !range ? passage : range) + (label ? ` (${label})` : '')
    const par = parallel?.pages[i]
    const bodyH = par ? 0.36 : 0.66
    const els: TextElement[] = [
      textEl('body', [verseRuns(page.verses, opts.showVerseNumbers ?? true, page.continued)], { x: W * 0.08, y: H * 0.1, w: W * 0.84, h: H * bodyH },
        { fontFamily: font, fontSize: Math.round(H * 0.07), fontWeight: 500, color: '#FFFFFF', lineHeight: 1.3 }, {}, id)
    ]
    if (par) els.push(textEl('translation', [verseRuns(par, opts.showVerseNumbers ?? true)], { x: W * 0.08, y: H * 0.48, w: W * 0.84, h: H * 0.3 },
      { fontFamily: font, fontSize: Math.round(H * 0.05), fontWeight: 400, italic: true, color: '#F4F2EB', lineHeight: 1.3 }, { name: `Translation (${parallel!.label})` }, id))
    if (refText) els.push(textEl('reference', [[{ text: refText + (par ? ` / ${parallel!.label}` : '') }]], { x: W * 0.08, y: H * 0.8, w: W * 0.84, h: H * 0.08 },
      { fontFamily: font, fontSize: Math.round(H * 0.038), fontWeight: 600, color: '#E6A20F', letterSpacing: 1 }, { autoFit: false }, id))
    if (last && opts.copyright) els.push(textEl('caption', [[{ text: opts.copyright }]], { x: W * 0.08, y: H * 0.9, w: W * 0.84, h: H * 0.06 },
      { fontFamily: font, fontSize: Math.round(H * 0.02), fontWeight: 400, color: '#A9A7A1' }, { name: 'Copyright' }, id))
    return { id: id(), label: range ? formatReference(range, { short: true }) : undefined, elements: els }
  })
}
