import { describe, expect, it } from 'vitest'
import { formatLyricText, formatPresentation, correctPresentation, DEFAULT_LYRIC_FORMAT, type LyricFormatSettings } from '../src/shared/lyric-format'
import { applyReflow, presentationToText } from '../src/shared/editor-reflow'
import type { Presentation } from '../src/shared/model'

const S = (o: Partial<LyricFormatSettings> = {}): LyricFormatSettings => ({ ...DEFAULT_LYRIC_FORMAT, correct: false, ...o })
const fmt = (t: string, o: Partial<LyricFormatSettings> = {}): string => formatLyricText(t, S(o))

function song(text: string): Presentation {
  const base: Presentation = { id: 'p', title: 'T', size: { width: 1920, height: 1080 }, slides: [], groups: [], arrangements: [], meta: {}, createdAt: '', updatedAt: '' }
  return applyReflow(base, text)
}

describe('formatLyricText', () => {
  it("the user's example: broken line becomes one line, slide gets 2 full lines", () => {
    expect(fmt('How great the chasm\nthat lay between us\nHow high the mountain\nI could not climb')).toBe(
      'How great the chasm that lay between us\nHow high the mountain I could not climb')
  })
  it('keeps sections and re-slides within them', () => {
    const out = fmt('Verse 1\nAmazing grace how sweet the sound\nThat saved a wretch like me\nI once was lost but now am found\nWas blind but now I see\n\nChorus\nMy chains are gone\nI\'ve been set free')
    expect(out).toBe('Verse 1\nAmazing grace how sweet the sound\nThat saved a wretch like me\n\nI once was lost but now am found\nWas blind but now I see\n\nChorus\nMy chains are gone I\'ve been set free')
  })
  it('messy paste: extra blank lines, trailing punctuation, CRLF, [brackets]', () => {
    const out = fmt('[Verse 1]\r\n\r\n\r\nOh the blood,\r\nthat flowed;;\r\n\r\n\r\n\r\nFor my sin.\r\nAnd my shame...\r\n')
    expect(out).toBe('[Verse 1]\nOh the blood, that flowed\nFor my sin\n\nAnd my shame')
  })
  it('does not merge across sentence ends or past max chars', () => {
    expect(fmt('He is risen.\nthat is all', { linesPerSlide: 4 })).toBe('He is risen\nthat is all')
    const long = 'We lift our voices high and loud\nto the one who sits on the throne above'
    expect(fmt(long, { linesPerSlide: 4 })).toBe('We lift our voices high and loud\nto the one who sits on the throne above')
  })
  it('splits over-long lines at word boundaries', () => {
    const out = fmt('Holy holy holy is the Lord God Almighty who was and is and is to come', { maxLineChars: 40, linesPerSlide: 4 })
    for (const l of out.split('\n')) expect(l.length).toBeLessThanOrEqual(40)
    expect(out.replace(/\n/g, ' ')).toBe('Holy holy holy is the Lord God Almighty who was and is and is to come')
  })
  it('lines per slide and mergeShortLines off', () => {
    expect(fmt('a b\nc d\ne f\ng h', { linesPerSlide: 3, mergeShortLines: false })).toBe('a b\nc d\ne f\n\ng h')
  })
  it('sentence case: shouting and Title Case, keeping I and God', () => {
    expect(fmt('HOW GREAT THE CHASM\nI Will Praise God Forever', { caseMode: 'sentence', mergeShortLines: false })).toBe('How great the chasm\nI will praise God forever')
  })
  it('keeps (blank) slides and drops headings when keepSections is off', () => {
    expect(fmt('Verse 1\nHello world\n\n(blank)\n\nChorus\nBye now', { keepSections: false })).toBe('Hello world\n\n(blank)\n\nBye now')
  })
  it('is idempotent', () => {
    const a = fmt('Verse 1\nHow great the chasm\nthat lay between us\nHow high the mountain\nI could not climb,\n\n\nChorus\nOh oh oh')
    expect(fmt(a)).toBe(a)
  })
})

describe('formatPresentation', () => {
  const messy = 'Verse 1\nhow great the chasm\nthat lay between us\ngod is good,\nand jesus saves\n\nChorus\nHALLELUJAH HALLELUJAH\nthe spirit moves'
  it('reflows slides, applies the corrector and reports flags', () => {
    const p = song(messy)
    const r = formatPresentation(p, { correct: true })
    expect(r.report.changed).toBe(true)
    expect(presentationToText(r.presentation)).toBe('Verse 1\nHow great the chasm that lay between us\nGod is good, and Jesus saves\n\nChorus\nHallelujah hallelujah the spirit moves')
    expect(r.report.corrections).toBeGreaterThan(0)
    expect(r.report.flagged.some((f) => f.flags.some((x) => x.includes('spirit')))).toBe(true)
    expect(r.presentation.groups.map((g) => g.name)).toEqual(['Verse 1', 'Chorus'])
  })
  it('preserves slide ids/styling where text is unchanged and returns same object when nothing to do', () => {
    const p = song('Verse 1\nAmazing grace how sweet the sound\nThat saved a wretch like me')
    expect(formatPresentation(p, { correct: true }).presentation).toBe(p)
  })
  it('correctPresentation changes wording only, not slide layout', () => {
    const p = song('Verse 1\nhow great the chasm\nthat lay between us')
    const r = correctPresentation(p)
    expect(presentationToText(r.presentation)).toBe('Verse 1\nHow great the chasm\nThat lay between us')
    expect(r.presentation.slides).toHaveLength(1)
  })
})
