import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ApiBibleProvider, bibleFileFromAo, EsvProvider, VerseCache, versesFromApiBible, versesFromEsvText } from '@main/services/bible/providers'
import { versesFromFile } from '@shared/bible'

const fx = (n: string): unknown => JSON.parse(readFileSync(join(__dirname, 'fixtures', n), 'utf8'))
afterEach(() => vi.unstubAllGlobals())

describe('Bible providers', () => {
  it('parses API.Bible JSON content by verseId, ignoring verse-number tags', () => {
    const d = fx('apibible-passage.json') as { data: { content: never[] } }
    expect(versesFromApiBible(d.data.content)).toEqual([
      { book: 'JHN', chapter: 3, verse: 16, text: 'For God so loved the world, that he gave his only Son.' },
      { book: 'JHN', chapter: 3, verse: 17, text: 'For God did not send his Son to condemn.' }
    ])
  })
  it('calls API.Bible with the api-key header and returns the copyright line', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> })
      return new Response(JSON.stringify(fx('apibible-passage.json')), { headers: { 'content-type': 'application/json' } })
    })
    const p = new ApiBibleProvider(() => 'k123')
    const r = await p.verses('abc', { book: 'JHN', chapter: 3, verse: 16, endChapter: 3, endVerse: 17 })
    expect(calls[0].url).toContain('/bibles/abc/passages/JHN.3.16-JHN.3.17')
    expect(calls[0].url).toContain('content-type=json')
    expect(calls[0].headers['api-key']).toBe('k123')
    expect(r.verses).toHaveLength(2)
    expect(r.copyright).toMatch(/Example Publisher/)
  })
  it('parses ESV text with verse markers across chapters', () => {
    const t = '[35] Jesus wept. [36] So the Jews said, “See how he loved him!” [1] Now a man was ill. (ESV)'
    expect(versesFromEsvText(t, { book: 'JHN', chapter: 11, verse: 35, endChapter: 12, endVerse: 1 })).toEqual([
      { book: 'JHN', chapter: 11, verse: 35, text: 'Jesus wept.' },
      { book: 'JHN', chapter: 11, verse: 36, text: 'So the Jews said, “See how he loved him!”' },
      { book: 'JHN', chapter: 12, verse: 1, text: 'Now a man was ill.' }
    ])
  })
  it('ESV sends the Token header and retries a 429 using Retry-After', async () => {
    let n = 0
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).authorization).toBe('Token esvkey')
      if (n++ === 0) return new Response('slow down', { status: 429, headers: { 'retry-after': '0' } })
      return new Response(JSON.stringify({ passages: ['[16] For God so loved the world.'] }), { headers: { 'content-type': 'application/json' } })
    })
    const p = new EsvProvider(() => 'esvkey')
    p.http.cfg.backoff = 1
    const r = await p.verses('ESV', { book: 'JHN', chapter: 3, verse: 16, endChapter: 3, endVerse: 16 })
    expect(n).toBe(2)
    expect(r.verses[0].text).toBe('For God so loved the world.')
    expect(r.copyright).toMatch(/Crossway/)
  })
  it('gives a friendly error on bad keys', async () => {
    vi.stubGlobal('fetch', async () => new Response('no', { status: 401 }))
    await expect(new ApiBibleProvider(() => 'bad').translations()).rejects.toThrow(/rejected the credentials/)
  })
  it('converts a helloao complete.json into the offline format', () => {
    const f = bibleFileFromAo(fx('helloao-complete.json') as never)
    expect(f.abbreviation).toBe('TSB')
    expect(f.license).toBe('Public domain')
    expect(Object.keys(f.books)).toEqual(['JHN'])
    expect(f.books.JHN[0][0]).toBe('In the beginning was the Word, and the Word was with God.')
    expect(f.books.JHN[1]).toEqual([])
    expect(versesFromFile(f, { book: 'JHN', chapter: 3, verse: 16, endChapter: 3, endVerse: 16 })[0].text).toBe('For God so loved the world.')
  })
  it('caps the verse cache per provider terms', () => {
    const c = new VerseCache({ esv: 5 })
    const vs = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ book: 'JHN', chapter: 3, verse: from + i, text: `v${from + i}` }))
    c.put('esv', 'ESV', vs(1, 4))
    c.put('esv', 'ESV', vs(10, 12))
    expect(Object.keys(c.data.esv.ESV)).toHaveLength(5)
    expect(c.get('esv', 'ESV', { book: 'JHN', chapter: 3, verse: 10, endChapter: 3, endVerse: 12 })).toHaveLength(3)
    expect(c.get('esv', 'ESV', { book: 'JHN', chapter: 3, verse: 1, endChapter: 3, endVerse: 2 })).toBeNull()
    const none = new VerseCache({})
    none.put('x', 'X', vs(1, 2))
    expect(none.data).toEqual({})
  })
})
