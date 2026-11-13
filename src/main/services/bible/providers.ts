/**
 * Bible sources behind one interface. Offline public-domain files are handled by the service itself;
 * these are the network providers. No scraping — official APIs only, each with its own terms
 * (see docs/integrations/bibles.md): cache caps, required copyright lines, verse-count limits.
 */
import type { BibleFile, Passage, TranslationInfo, Verse } from '@shared/bible'
import { BOOKS, bookById, formatReference } from '@shared/bible'
import { HttpClient } from '../integrations/http'

export interface ProviderTerms {
  /** Max verses we may keep cached on disk (Infinity = public domain). */
  cacheVerses: number
  /** Max verses per request / per displayed passage. */
  maxVerses: number
  /** Shown in the UI next to the key field. */
  note: string
}

export interface BibleProvider {
  id: string
  name: string
  needsKey: boolean
  terms: ProviderTerms
  translations(): Promise<TranslationInfo[]>
  verses(translationId: string, passage: Passage): Promise<{ verses: Verse[]; copyright?: string }>
}

const env = (name: string, fallback: string): string => process.env[name] || fallback

/* ───────────── Free Use Bible API (bible.helloao.org) — whole public-domain translations for offline use ───────────── */

export const OFFLINE_CATALOG: { id: string; abbreviation: string; name: string; license: string; note: string }[] = [
  { id: 'BSB', abbreviation: 'BSB', name: 'Berean Standard Bible', license: 'Public domain (dedicated 30 April 2023)', note: 'Modern English, closest in feel to ESV/CSB/NIV.' },
  { id: 'ENGWEBP', abbreviation: 'WEB', name: 'World English Bible', license: 'Public domain', note: 'Modern English update of the ASV.' },
  { id: 'eng_kjv', abbreviation: 'KJV', name: 'King James (Authorized) Version', license: 'Public domain (Crown rights apply inside the UK only)', note: 'The classic 1769 text.' },
  { id: 'eng_asv', abbreviation: 'ASV', name: 'American Standard Version (1901)', license: 'Public domain', note: 'Formal, literal.' },
  { id: 'spa_r09', abbreviation: 'RV1909', name: 'Reina Valera 1909', license: 'Public domain', note: 'Spanish.' }
]

type AoContent = string | { text?: string; noteId?: number; lineBreak?: boolean; heading?: string }
interface AoComplete {
  translation: { id: string; name: string; shortName?: string; englishName?: string; language?: string; licenseUrl?: string; license?: { publicDomain?: boolean; attribution?: string } | null; website?: string }
  books: { id: string; chapters: { chapter: { number: number; content: { type: string; number?: number; content?: AoContent[] }[] } }[] }[]
}

export function verseTextFromAo(content: AoContent[] | undefined): string {
  let out = ''
  for (const c of content ?? []) {
    const piece = typeof c === 'string' ? c : c.text ?? (c.lineBreak ? ' ' : '')
    if (!piece) continue
    out += out && !/\s$/.test(out) && !/^[\s,.;:!?”’)\]]/.test(piece) ? ' ' + piece : piece
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** Convert a helloao `complete.json` into our compact offline file. */
export function bibleFileFromAo(data: AoComplete, abbreviation?: string): BibleFile {
  const books: BibleFile['books'] = {}
  const known = new Set(BOOKS.map((b) => b.id))
  for (const b of data.books) {
    if (!known.has(b.id)) continue // deuterocanon etc. are skipped for now
    const chapters: string[][] = []
    for (const c of b.chapters) {
      const verses: string[] = []
      for (const item of c.chapter.content) if (item.type === 'verse' && item.number) verses[item.number - 1] = verseTextFromAo(item.content)
      for (let i = 0; i < verses.length; i++) verses[i] ??= ''
      chapters[c.chapter.number - 1] = verses
    }
    for (let i = 0; i < chapters.length; i++) chapters[i] ??= []
    books[b.id] = chapters
  }
  const t = data.translation
  const pd = t.license?.publicDomain !== false
  return {
    id: t.id, name: t.englishName ?? t.name, abbreviation: abbreviation ?? t.shortName ?? t.id, language: t.language ?? 'eng',
    license: pd ? 'Public domain' : `See ${t.licenseUrl ?? t.website ?? 'publisher'}`, copyright: pd ? '' : t.name,
    source: 'bible.helloao.org', downloadedAt: new Date().toISOString(), books
  }
}

export class HelloAoSource {
  http = new HttpClient({ name: 'the free Bible library', baseUrl: env('REACH_HELLOAO_API', 'https://bible.helloao.org/api'), headers: () => ({}), perSecond: 4 })
  async catalog(): Promise<{ id: string; name: string; language: string; publicDomain: boolean }[]> {
    const d = await this.http.get<{ translations: { id: string; name: string; englishName?: string; language: string; license?: { publicDomain?: boolean } | null }[] }>('/available_translations.json', undefined, { timeout: 30000 })
    return d.translations.map((t) => ({ id: t.id, name: t.englishName ?? t.name, language: t.language, publicDomain: !!t.license?.publicDomain }))
  }
  async download(id: string, abbreviation?: string): Promise<BibleFile> {
    const d = await this.http.get<AoComplete>(`/${encodeURIComponent(id)}/complete.json`, undefined, { timeout: 120000, retries: 2 })
    if (!d?.books?.length) throw new Error('That translation came back empty.')
    return bibleFileFromAo(d, abbreviation)
  }
}

/* ───────────── API.Bible (American Bible Society) ───────────── */

interface AbNode { type?: string; name?: string; text?: string; attrs?: { verseId?: string; number?: string; style?: string }; items?: AbNode[] }

/** Walk API.Bible's JSON content tree, grouping text by `attrs.verseId` ("JHN.3.16"). */
export function versesFromApiBible(content: AbNode[]): Verse[] {
  const map = new Map<string, string>()
  const walk = (nodes: AbNode[], inVerseTag: boolean): void => {
    for (const n of nodes) {
      if (n.type === 'text' || n.text !== undefined) {
        const id = n.attrs?.verseId
        if (id && !inVerseTag && n.text) map.set(id, (map.get(id) ?? '') + n.text)
      }
      if (n.items) walk(n.items, inVerseTag || n.name === 'verse' || n.attrs?.style === 'v')
    }
  }
  walk(content, false)
  const out: Verse[] = []
  for (const [id, text] of map) {
    const [book, c, v] = id.split('.')
    const t = text.replace(/\s+/g, ' ').replace(/^¶\s*/, '').trim()
    if (bookById(book) && t) out.push({ book, chapter: Number(c), verse: Number(v), text: t })
  }
  return out.sort((a, b) => a.chapter - b.chapter || a.verse - b.verse)
}

export class ApiBibleProvider implements BibleProvider {
  id = 'apibible'
  name = 'API.Bible'
  needsKey = true
  terms: ProviderTerms = { cacheVerses: 500, maxVerses: 500, note: 'Free non-commercial key; each translation carries its own copyright line (shown on the last slide). Up to 5,000 requests/day; we cache at most 500 verses on this computer.' }
  http: HttpClient
  constructor(key: () => string | null) {
    this.http = new HttpClient({ name: 'API.Bible', baseUrl: env('REACH_APIBIBLE_API', 'https://rest.api.bible/v1'), headers: () => ({ 'api-key': key() ?? '' }), perSecond: 4 })
  }
  async translations(): Promise<TranslationInfo[]> {
    const d = await this.http.get<{ data: { id: string; name: string; nameLocal?: string; abbreviation?: string; abbreviationLocal?: string; language?: { id?: string }; copyright?: string }[] }>('/bibles', { language: 'eng' })
    return d.data.map((b) => ({ id: `apibible:${b.id}`, name: b.nameLocal ?? b.name, abbreviation: (b.abbreviationLocal ?? b.abbreviation ?? b.name).toUpperCase(), language: b.language?.id, provider: this.id, offline: false, copyright: b.copyright }))
  }
  async verses(translationId: string, p: Passage): Promise<{ verses: Verse[]; copyright?: string }> {
    const start = `${p.book}.${p.chapter}${p.verse !== undefined ? '.' + p.verse : ''}`
    const end = `${p.book}.${p.endChapter}${p.endVerse !== undefined ? '.' + p.endVerse : ''}`
    const id = p.verse === undefined && p.endVerse === undefined && p.chapter === p.endChapter ? start : `${start}-${end}`
    const path = p.verse === undefined && p.chapter === p.endChapter && p.endVerse === undefined ? 'chapters' : 'passages'
    const d = await this.http.get<{ data: { content: AbNode[]; copyright?: string }; meta?: { fumsToken?: string; fumsId?: string } }>(`/bibles/${translationId}/${path}/${id}`, {
      'content-type': 'json', 'include-notes': false, 'include-titles': false, 'include-chapter-numbers': false, 'include-verse-numbers': true, 'include-verse-spans': false
    })
    return { verses: versesFromApiBible(d.data.content ?? []), copyright: d.data.copyright?.replace(/\s+/g, ' ').trim() }
  }
}

/* ───────────── ESV API (Crossway) ───────────── */

/** ESV text with "[16] " markers → verses. Chapter rolls over when numbers restart. */
export function versesFromEsvText(text: string, p: Passage): Verse[] {
  const out: Verse[] = []
  let chapter = p.chapter
  let last = 0
  const re = /\[(\d+)\]\s*([^[]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const n = Number(m[1])
    if (n < last) chapter++
    last = n
    const t = m[2].replace(/\s+/g, ' ').replace(/\(ESV\)\s*$/, '').trim()
    if (t) out.push({ book: p.book, chapter, verse: n, text: t })
  }
  return out
}

export class EsvProvider implements BibleProvider {
  id = 'esv'
  name = 'ESV (Crossway)'
  needsKey = true
  terms: ProviderTerms = { cacheVerses: 500, maxVerses: 500, note: 'Free for church use with a Crossway API key. At most 500 verses per passage and 500 verses stored; “ESV” must be shown with the text (we add it to the reference line and the copyright line on the last slide).' }
  http: HttpClient
  constructor(key: () => string | null) {
    this.http = new HttpClient({ name: 'the ESV API', baseUrl: env('REACH_ESV_API', 'https://api.esv.org/v3'), headers: () => ({ authorization: `Token ${key() ?? ''}` }), perSecond: 2 })
  }
  async translations(): Promise<TranslationInfo[]> {
    return [{ id: 'esv:ESV', name: 'English Standard Version', abbreviation: 'ESV', language: 'eng', provider: this.id, offline: false, copyright: ESV_COPYRIGHT }]
  }
  async verses(_t: string, p: Passage): Promise<{ verses: Verse[]; copyright?: string }> {
    const d = await this.http.get<{ passages?: string[] }>('/passage/text/', {
      q: formatReference(p).replace(/–/g, '-').replace(/^Psalm /, 'Psalms '), 'include-passage-references': false, 'include-verse-numbers': true, 'include-first-verse-numbers': true,
      'include-footnotes': false, 'include-footnote-body': false, 'include-headings': false, 'include-short-copyright': false, 'include-copyright': false,
      'include-passage-horizontal-lines': false, 'include-heading-horizontal-lines': false, 'include-selahs': true, 'indent-paragraphs': 0, 'indent-poetry': false, 'line-length': 0
    })
    return { verses: versesFromEsvText((d.passages ?? []).join('\n'), p), copyright: ESV_COPYRIGHT }
  }
}
export const ESV_COPYRIGHT = 'Scripture quotations are from the ESV® Bible, © 2001 by Crossway. Used by permission. All rights reserved.'

/* ───────────── verse cache with a hard cap (provider terms) ───────────── */

export class VerseCache {
  /** provider → translation → "JHN.3.16" → text (insertion-ordered = oldest first) */
  data: Record<string, Record<string, Record<string, string>>> = {}
  copyright: Record<string, string> = {}
  constructor(private caps: Record<string, number>) {}
  private count(provider: string): number {
    return Object.values(this.data[provider] ?? {}).reduce((s, t) => s + Object.keys(t).length, 0)
  }
  put(provider: string, translation: string, verses: Verse[], copyright?: string): void {
    const cap = this.caps[provider] ?? 0
    if (cap <= 0) return
    const t = ((this.data[provider] ??= {})[translation] ??= {})
    for (const v of verses) { const k = `${v.book}.${v.chapter}.${v.verse}`; delete t[k]; t[k] = v.text }
    if (copyright) this.copyright[translation] = copyright
    let over = this.count(provider) - cap
    for (const tr of Object.values(this.data[provider])) {
      if (over <= 0) break
      if (tr === t && Object.keys(this.data[provider]).length > 1) continue
      for (const k of Object.keys(tr)) { if (over <= 0) break; delete tr[k]; over-- }
    }
    if (over > 0) for (const k of Object.keys(t)) { if (over <= 0) break; delete t[k]; over-- }
  }
  /** Returns verses only if the WHOLE explicit range is cached. */
  get(provider: string, translation: string, p: Passage): Verse[] | null {
    const t = this.data[provider]?.[translation]
    if (!t || p.verse === undefined || p.endVerse === undefined || p.chapter !== p.endChapter) return null
    const out: Verse[] = []
    for (let v = p.verse; v <= p.endVerse; v++) {
      const text = t[`${p.book}.${p.chapter}.${v}`]
      if (text === undefined) return null
      out.push({ book: p.book, chapter: p.chapter, verse: v, text })
    }
    return out
  }
}
