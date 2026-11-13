import { describe, expect, it } from 'vitest'
import { BOOKS, defaultPaging, formatReference, isReferenceOnly, pageVerses, parseReference, parseReferences, scriptureSlides, searchFile, shiftPassage, versesFromFile, type Passage, type Verse } from '@shared/bible'
import { slideText } from '@shared/model'

const P = (book: string, chapter: number, verse?: number, endChapter = chapter, endVerse = verse): Passage => {
  const p: Passage = { book, chapter, endChapter }
  if (verse !== undefined) p.verse = verse
  if (endVerse !== undefined) p.endVerse = endVerse
  return p
}

describe('reference parser', () => {
  const cases: [string, Passage[]][] = [
    ['John 3:16', [P('JHN', 3, 16)]],
    ['jn 3 16-18', [P('JHN', 3, 16, 3, 18)]],
    ['jn3:16', [P('JHN', 3, 16)]],
    ['John 3.16', [P('JHN', 3, 16)]],
    ['John 3:16–18', [P('JHN', 3, 16, 3, 18)]],
    ['John 3:16 — 18', [P('JHN', 3, 16, 3, 18)]],
    ['john 3', [P('JHN', 3)]],
    ['Matt 1 2 3', [P('MAT', 1, 2, 1, 3)]],
    ['1 cor 13', [P('1CO', 13)]],
    ['1cor 13:4-7', [P('1CO', 13, 4, 13, 7)]],
    ['1 Corinthians 13:4-7', [P('1CO', 13, 4, 13, 7)]],
    ['I Corinthians 13:4', [P('1CO', 13, 4)]],
    ['First Corinthians 13:4', [P('1CO', 13, 4)]],
    ['2nd Timothy 3:16', [P('2TI', 3, 16)]],
    ['III John 4', [P('3JN', 1, 4)]],
    ['Gen 1:1-2:3', [P('GEN', 1, 1, 2, 3)]],
    ['Genesis 1-2', [P('GEN', 1, undefined, 2, undefined)]],
    ['Rev 2-3', [P('REV', 2, undefined, 3, undefined)]],
    ['Rev. 3:1–6', [P('REV', 3, 1, 3, 6)]],
    ['Revelation 2:18-29', [P('REV', 2, 18, 2, 29)]],
    ['John 3:16,18,20-22', [P('JHN', 3, 16), P('JHN', 3, 18), P('JHN', 3, 20, 3, 22)]],
    ['1 Corinthians 5:1-2,5', [P('1CO', 5, 1, 5, 2), P('1CO', 5, 5)]],
    ['John 3:16; 4:1-2', [P('JHN', 3, 16), P('JHN', 4, 1, 4, 2)]],
    ['Ps 23; John 1:1', [P('PSA', 23), P('JHN', 1, 1)]],
    ['Psalm 119:105', [P('PSA', 119, 105)]],
    ['psalms 1', [P('PSA', 1)]],
    ['Jude 5', [P('JUD', 1, 5)]],
    ['Jude 1:5-7', [P('JUD', 1, 5, 1, 7)]],
    ['Jude 5-7', [P('JUD', 1, 5, 1, 7)]],
    ['Jude', [P('JUD', 1)]],
    ['Philemon 1', [P('PHM', 1)]],
    ['Obadiah 3', [P('OBA', 1, 3)]],
    ['Song of Songs 2:1', [P('SNG', 2, 1)]],
    ['Song of Solomon 2:1', [P('SNG', 2, 1)]],
    ['sos 2 1', [P('SNG', 2, 1)]],
    ['Phil 4:13', [P('PHP', 4, 13)]],
    ['Philem 6', [P('PHM', 1, 6)]],
    ['Heb 12:29', [P('HEB', 12, 29)]],
    ['Hab 2:4', [P('HAB', 2, 4)]],
    ['Malachi 3:2–3', [P('MAL', 3, 2, 3, 3)]],
    ['Acts 16:14', [P('ACT', 16, 14)]],
    ['Daniel 7:9-10', [P('DAN', 7, 9, 7, 10)]],
    ['mk 1 1', [P('MRK', 1, 1)]],
    ['Luke 2 verses 1-7', [P('LUK', 2, 1, 2, 7)]],
    ['Luke 2 v 4', [P('LUK', 2, 4)]],
    ['Rom 8:28a', [P('ROM', 8, 28)]],
    ['romans 8:1 to 4', [P('ROM', 8, 1, 8, 4)]],
    ['  “John 3:16”  ', [P('JHN', 3, 16)]],
    ['1 john 4:8', [P('1JN', 4, 8)]],
    ['1jn 4 8', [P('1JN', 4, 8)]],
    ['2 Kgs 2:11', [P('2KI', 2, 11)]],
    ['Deut 6:4-9', [P('DEU', 6, 4, 6, 9)]],
    ['Is 53', [P('ISA', 53)]],
    ['Ecc 3:1', [P('ECC', 3, 1)]],
    ['Eph 2:8-9', [P('EPH', 2, 8, 2, 9)]],
    ['Jas 1:2', [P('JAS', 1, 2)]],
    ['1 Pet 5:7', [P('1PE', 5, 7)]],
    ['Zech 4:6', [P('ZEC', 4, 6)]],
    ['Matthew 5:3-7:27', [P('MAT', 5, 3, 7, 27)]]
  ]
  for (const [text, want] of cases) it(`parses "${text.trim()}"`, () => expect(parseReferences(text)).toEqual(want))

  it('reads translations', () => {
    expect(parseReference('Revelation 2:18 (ESV)')).toEqual({ ...P('REV', 2, 18), translation: 'ESV' })
    expect(parseReference('Revelation 2:18-29 (ESV')).toEqual({ ...P('REV', 2, 18, 2, 29), translation: 'ESV' })
    expect(parseReference('John 3:16 NIV')).toEqual({ ...P('JHN', 3, 16), translation: 'NIV' })
    expect(parseReference('john 3 16 kjv')?.translation).toBe('KJV')
    expect(parseReferences('John 3:16 (ESV); Rom 8:1 (NLT)').map((p) => p.translation)).toEqual(['ESV', 'NLT'])
  })

  const rejects = ['', 'John', 'Mark my words', 'Numbers 5 things to know', 'John 99:1', 'John 3:16-4', 'Acts of kindness 3', 'See John 3:16 for more', '3:16', 'Hello 1:1', 'John 3:16 is great', 'Job well done', 'Romans 17', 'John 0', '1. SEE HIS FACE', '5 SEE HIM', 'Slide 1', 'December 5', 'Nov. 22', 'Sunday, Dec. 6 - 1:30pm']
  for (const text of rejects) it(`rejects "${text}"`, () => expect(parseReferences(text)).toEqual([]))

  it('knows every book by name, id and has 66', () => {
    expect(BOOKS).toHaveLength(66)
    for (const b of BOOKS) {
      expect(parseReference(`${b.name} 1`)?.book, b.name).toBe(b.id)
      expect(parseReference(`${b.id} 1`)?.book, b.id).toBe(b.id)
      for (const a of b.aliases) expect(parseReference(`${a} 1:1`)?.book ?? parseReference(`${a} 1`)?.book, `${b.name} alias ${a}`).toBeTruthy()
    }
  })

  it('detects reference-only lines (Notion paragraphs)', () => {
    expect(isReferenceOnly('Revelation 2:18-29 (ESV)')).toBe(true)
    expect(isReferenceOnly('1 Corinthians 10:14-22 (ESV)')).toBe(true)
    expect(isReferenceOnly('Acts 16:14')).toBe(true)
    expect(isReferenceOnly('“For our God is a consuming fire.”')).toBe(false)
    expect(isReferenceOnly('IDOLATRY = WORSHIPPING 2 THINGS')).toBe(false)
    expect(isReferenceOnly('Leader: This is the Word of the Lord!')).toBe(false)
  })

  it('formats references', () => {
    expect(formatReference(P('JHN', 3, 16, 3, 18))).toBe('John 3:16–18')
    expect(formatReference(P('JHN', 3, 16))).toBe('John 3:16')
    expect(formatReference(P('JHN', 3))).toBe('John 3')
    expect(formatReference(P('GEN', 1, 1, 2, 3))).toBe('Genesis 1:1–2:3')
    expect(formatReference(P('GEN', 1, undefined, 2, undefined))).toBe('Genesis 1–2')
    expect(formatReference(P('JUD', 1, 5, 1, 7))).toBe('Jude 5–7')
    expect(formatReference(P('PSA', 23))).toBe('Psalm 23')
    expect(formatReference({ ...P('REV', 2, 18), translation: 'ESV' }, { translation: true })).toBe('Revelation 2:18 (ESV)')
    expect(formatReference(P('1CO', 13, 4, 13, 7), { short: true })).toBe('1 Cor 13:4–7')
  })
})

const tiny = { books: { JHN: [[], [], Array.from({ length: 36 }, (_, i) => `Verse ${i + 1} of chapter three with some words.`), ['Four one.', 'Four two.', '', 'Four four.']] } }

describe('verses & paging', () => {
  it('reads ranges across chapters and skips omitted verses', () => {
    expect(versesFromFile(tiny, P('JHN', 3, 16, 3, 18)).map((v) => v.verse)).toEqual([16, 17, 18])
    expect(versesFromFile(tiny, P('JHN', 3, 35, 4, 4)).map((v) => `${v.chapter}:${v.verse}`)).toEqual(['3:35', '3:36', '4:1', '4:2', '4:4'])
    expect(versesFromFile(tiny, P('JHN', 4))).toHaveLength(3)
    expect(versesFromFile(tiny, P('JHN', 3, 30, 3, 99)).at(-1)?.verse).toBe(36)
    expect(versesFromFile(tiny, P('ROM', 1))).toEqual([])
  })
  it('pages by verse count', () => {
    const vs = versesFromFile(tiny, P('JHN', 3, 1, 3, 5))
    expect(pageVerses(vs, { mode: 'verses', versesPerSlide: 2, maxChars: 300 }).map((p) => p.verses.length)).toEqual([2, 2, 1])
  })
  it('pages by length, never splitting a verse that fits', () => {
    const vs = versesFromFile(tiny, P('JHN', 3, 1, 3, 9))
    const pages = pageVerses(vs, { mode: 'fit', versesPerSlide: 1, maxChars: 130 })
    expect(pages.map((p) => p.verses.length)).toEqual([3, 3, 3])
    expect(pages.every((p) => p.verses.reduce((s, v) => s + v.text.length, 0) <= 135)).toBe(true)
  })
  it('splits a very long verse at sentence boundaries', () => {
    const long: Verse = { book: 'EST', chapter: 8, verse: 9, text: Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} goes on for a while here.`).join(' ') }
    const pages = pageVerses([long], { ...defaultPaging(), maxChars: 200 })
    expect(pages.length).toBeGreaterThan(2)
    expect(pages[0].continued).toBeFalsy()
    expect(pages[1].continued).toBe(true)
    expect(pages.map((p) => p.verses[0].text).join(' ')).toBe(long.text)
    expect(Math.max(...pages.map((p) => p.verses[0].text.length))).toBeLessThanOrEqual(250)
  })
  it('builds slides with body + reference roles and copyright on the last slide', () => {
    const vs = versesFromFile(tiny, P('JHN', 3, 16, 3, 18))
    const pages = pageVerses(vs, { mode: 'verses', versesPerSlide: 2, maxChars: 300 })
    const slides = scriptureSlides(pages, { ...P('JHN', 3, 16, 3, 18), translation: 'KJV' }, { copyright: 'Public domain' })
    expect(slides).toHaveLength(2)
    expect(slideText(slides[0], 'reference')).toBe('John 3:16–17 (KJV)')
    expect(slideText(slides[1], 'reference')).toBe('John 3:18 (KJV)')
    expect(slideText(slides[0], 'body')).toContain('16 Verse 16')
    expect(slides[0].elements.some((e) => e.type === 'text' && e.role === 'caption')).toBe(false)
    expect(slideText(slides[1], 'caption')).toBe('Public domain')
    const par = scriptureSlides(pages, P('JHN', 3, 16, 3, 18), { translationLabel: 'KJV' }, { pages: pages.map((p) => p.verses), label: 'WEB' })
    expect(par[0].elements.filter((e) => e.type === 'text').map((e) => (e as { role?: string }).role)).toEqual(['body', 'translation', 'reference'])
  })
  it('searches text', () => {
    expect(searchFile(tiny, 'four two').map((v) => v.verse)).toEqual([2])
    expect(searchFile(tiny, 'chapter three', 5)).toHaveLength(5)
  })
  it('steps to next/previous verses across chapters', () => {
    const len = (_b: string, c: number): number => (c === 3 ? 36 : 4)
    expect(shiftPassage(P('JHN', 3, 16, 3, 17), 1, len)).toMatchObject({ chapter: 3, verse: 18, endVerse: 19 })
    expect(shiftPassage(P('JHN', 3, 36), 1, len)).toMatchObject({ chapter: 4, verse: 1, endVerse: 1 })
    expect(shiftPassage(P('JHN', 4, 1), -1, len)).toMatchObject({ chapter: 3, verse: 36 })
    expect(shiftPassage(P('JHN', 1, 1), -1, () => 51)).toBeNull()
  })
})
