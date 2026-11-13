// Ported from pro7-lyric-corrector tests/run_tests.py (MIT, (c) 2026 Stephen Garcia) — rule cases only.
import { describe, expect, it } from 'vitest'
import { correctText, preventOrphans, NBSP } from '../src/shared/lyric-corrector'

const t = (s: string): string => correctText(s).text
const N = NBSP

describe('divine / capitalization', () => {
  it('line-start You via first-word cap', () => expect(t('you are good\nyour mercy')).toBe('You are good\nYour mercy'))
  it('mid-line second person not capitalized, flagged', () => {
    const r = correctText("To you who boast\nTomorrow's gain")
    expect(r.text).toBe('To you who boast\nTomorrow’s gain')
    expect(r.flags).toContain('second-person')
  })
  it('divineSecondPerson option capitalizes', () => expect(correctText('praise you always', { divineSecondPerson: true }).text).toBe('Praise You always'))
  it('the-one-who flagged only', () => {
    const r = correctText('he is the one who saves')
    expect(r.text).toBe('He is the one who saves')
    expect(r.flags).toContain('relative-pronoun')
  })
  it('human pronouns stay lowercase', () => expect(t('I told him he is loved')).toBe('I told him he is loved'))
  it('church house style', () => expect(t('build your church')).toBe('Build your Church'))
  it('first word cap', () => expect(t('amazing grace')).toBe('Amazing grace'))
  it('god -> God', () => expect(t('I am a child of god')).toBe('I am a child of God'))
  it('Lion/Lamb', () => expect(t('behold the lion and the lamb')).toBe('Behold the Lion and the Lamb'))
  it('king flagged not capitalized', () => {
    const r = correctText('the splendor of a king')
    expect(r.text).toBe('The splendor of a king')
    expect(r.flags).toContain("ambiguous-divine:'king'")
  })
})

describe('word-initial quotes', () => {
  it("'Twas", () => expect(t("'Twas grace that taught my heart")).toBe('’Twas grace that taught my heart'))
  it('’Tis preserved', () => expect(t('’Tis grace')).toBe('’Tis grace'))
  it('‘Cause healed', () => expect(t('‘Cause I know')).toBe('’Cause I know'))
  it("'Round", () => expect(t("'Round the throne")).toBe('’Round the throne'))
  it('elision not flagged', () => expect(correctText("'Cause I know").flags).not.toContain('word-initial-quote'))
  it('opening quote on non-elision preserved + flagged', () => {
    const r = correctText('‘Holy’ is the cry')
    expect(r.text).toBe('‘Holy’ is the cry')
    expect(r.flags).toContain('word-initial-quote')
  })
  it('mid/end apostrophes', () => expect(t("don't stop\nGod's love")).toBe('Don’t stop\nGod’s love'))
})

describe('mid-word capitals', () => {
  it('stray cap', () => expect(t('come evEry battle')).toBe('Come every battle'))
  it('multiple', () => expect(t('JeSUS reigns')).toBe('Jesus reigns'))
  it('all-caps word', () => expect(t('GOD is good')).toBe('God is good'))
  it('legit caps preserved', () => expect(t('Holy Spirit fall')).toBe('Holy Spirit fall'))
})

describe('hallelujah / attributes', () => {
  it('hallelujah mid-line stays', () => expect(t('sing a hallelujah tonight')).toBe('Sing a hallelujah tonight'))
  it('hallelujah line start', () => expect(t('hallelujah')).toBe('Hallelujah'))
  it('attributes lowercase', () => expect(t('By His Grace and Glory and Blood and Majesty and Mercy and Kingdom')).toBe('By His grace and glory and blood and majesty and mercy and kingdom'))
  it('amazing grace', () => expect(t('Amazing Grace how sweet')).toBe('Amazing grace how sweet'))
  it('standalone Holy', () => expect(t('Our God is Holy')).toBe('Our God is holy'))
  it('Holy Spirit / Ghost / One kept', () => {
    expect(t('Come Holy Spirit')).toBe('Come Holy Spirit')
    expect(t('Father Son and Holy Ghost')).toBe('Father Son and Holy Ghost')
    expect(t('You are the Holy One')).toBe('You are the Holy One')
  })
  it('cross lowercase, not flagged', () => {
    expect(t('nailed to the Cross')).toBe('Nailed to the cross')
    expect(correctText('at the cross i bow').flags).not.toContain("ambiguous-divine:'cross'")
  })
  it('name flagged, grace not', () => {
    expect(correctText('praise his name forever').flags).toContain("ambiguous-divine:'name'")
    expect(correctText('your grace is enough').flags).not.toContain("ambiguous-divine:'grace'")
  })
})

describe('function words and first person', () => {
  it('function words lowercased', () => expect(t('Glory To God In The highest')).toBe('Glory to God in the highest'))
  it('In Your name', () => expect(t('there’s salvation In Your name')).toBe('There’s salvation in Your name'))
  it('first-person flagged only', () => {
    expect(correctText('come to me and follow me').flags).toContain('first-person')
    expect(t('hold my hand and lead me')).toBe('Hold my hand and lead me')
  })
})

describe('punctuation, spelling, spacing', () => {
  it('smart apostrophes', () => expect(t("you're so\nGod's love\ndon't stop")).toBe('You’re so\nGod’s love\nDon’t stop'))
  it('smart quotes', () => expect(t('"holy holy holy"')).toBe('“Holy holy holy”'))
  it('feet/inches', () => expect(t('it was 6\'2" tall')).toBe('It was 6\'2" tall'))
  it('american spelling', () => expect(t('our Saviour reigns')).toBe('Our Savior reigns'))
  it('spelling off', () => expect(correctText('all honour to the King', { spelling: false }).text).toBe('All honour to the King'))
  it('honour', () => expect(t('all honour to the King')).toBe('All honor to the King'))
  it('all-caps', () => expect(t('HOLY IS THE LORD GOD ALMIGHTY')).toBe('Holy is the Lord God Almighty'))
  it('midline decap', () => expect(t('Let the World see Your glory')).toBe('Let the world see Your glory'))
  it('double spaces', () => expect(t('we  have   spaces')).toBe('We have spaces'))
  it('typos', () => expect(t('alright untill thier')).toBe('All right until their'))
  it('blank lines cleaned', () => expect(t('\n\na b\n\n\n\nc d\n\n')).toBe('A b\n\nC d'))
})

describe('flags & no-op', () => {
  it('ambiguous flagged', () => expect(correctText('the spirit and the word').flags.some((f) => f.includes('spirit'))).toBe(true))
  it('already-correct -> unchanged', () => expect(correctText('You are good\nYour mercy').changed).toBe(false))
  it('idempotent', () => {
    const a = t('amazing grace how sweet the sound\nthat saved a wretch like me')
    expect(correctText(a).changed).toBe(false)
  })
})

describe('orphan guard', () => {
  it('joins last two words', () => expect(preventOrphans('amazing grace how sweet the sound')).toBe(`amazing grace how sweet the${N}sound`))
  it('single word untouched', () => expect(preventOrphans('Grace')).toBe('Grace'))
  it('two-line slide', () => expect(preventOrphans('how sweet the sound\nGrace')).toBe(`how sweet the${N}sound\nGrace`))
  it('blank lines preserved', () => expect(preventOrphans('a b\n\nc d')).toBe(`a${N}b\n\nc${N}d`))
  it('empty', () => expect(preventOrphans('')).toBe(''))
  it('idempotent', () => { const o = preventOrphans('amazing grace how sweet the sound'); expect(preventOrphans(o)).toBe(o) })
  it('extra internal spacing', () => expect(preventOrphans('a  b   c')).toBe(`a  b${N}c`))
})
