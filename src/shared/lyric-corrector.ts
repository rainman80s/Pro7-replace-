/**
 * Deterministic worship-lyric correction rules (no AI, no network).
 *
 * TypeScript port of `pro7corrector/rules.py` from pro7-lyric-corrector
 * https://github.com/stephenrgarcia/pro7-lyric-corrector
 * MIT License, Copyright (c) 2026 Stephen Garcia (full text: vendor/licenses/pro7-lyric-corrector-LICENSE).
 *
 * Not ported: ProPresenter .pro file I/O, RTF codec, monitor, backup, wire, and the AI batch pass.
 * Genuinely ambiguous theological capitalisation (spirit/Spirit, word/Word, he/He ...) is never guessed:
 * it is returned as `flags` so a person can decide. Operates on logical text (lines split by "\n").
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Unambiguous divine / proper names -> always capitalized when found lowercase. */
export const ALWAYS_CAP: Record<string, string> = {
  god: 'God', jesus: 'Jesus', christ: 'Christ', messiah: 'Messiah',
  emmanuel: 'Emmanuel', immanuel: 'Immanuel', yahweh: 'Yahweh',
  jehovah: 'Jehovah', adonai: 'Adonai', elohim: 'Elohim',
  // hallelujah / alleluia / hosanna are exclamations, NOT names of God: not force-capitalized here.
  calvary: 'Calvary', zion: 'Zion', bethlehem: 'Bethlehem',
  galilee: 'Galilee', nazareth: 'Nazareth', jerusalem: 'Jerusalem',
  israel: 'Israel', judah: 'Judah', alpha: 'Alpha', omega: 'Omega',
  lord: 'Lord', savior: 'Savior', saviour: 'Savior',
  redeemer: 'Redeemer', almighty: 'Almighty', abba: 'Abba',
  // Lion / Lamb are clear divine metaphors; "King" is also a human title so it is flagged instead.
  lion: 'Lion', lamb: 'Lamb'
}

/** Second-person address: context-dependent, flagged (recased only when divineSecondPerson is on). */
export const SECOND_PERSON: Record<string, string> = {
  you: 'You', your: 'Your', yours: 'Yours', yourself: 'Yourself',
  yourselves: 'Yourselves', thee: 'Thee', thou: 'Thou',
  thy: 'Thy', thine: 'Thine'
}

/** Third-person pronouns for God: context-dependent, flagged. */
export const THIRD_PERSON = new Set(['he', 'him', 'his', 'himself'])

/** First-person pronouns (Christ speaking vs worshipper): context-dependent, flagged. */
export const FIRST_PERSON = new Set(['me', 'my', 'mine', 'myself'])

/** Multi-word divine titles -> canonical capitalization. */
export const PHRASE_RULES: [RegExp, string][] = [
  [/\bking of kings\b/gi, 'King of Kings'],
  [/\blord of lords\b/gi, 'Lord of Lords'],
  [/\bson of man\b/gi, 'Son of Man'],
  [/\bson of god\b/gi, 'Son of God'],
  [/\blamb of god\b/gi, 'Lamb of God'],
  [/\blion of judah\b/gi, 'Lion of Judah'],
  [/\bholy one\b/gi, 'Holy One'],
  [/\bholy spirit\b/gi, 'Holy Spirit'],
  [/\bholy ghost\b/gi, 'Holy Ghost'],
  [/\bprince of peace\b/gi, 'Prince of Peace'],
  [/\bmorning star\b/gi, 'Morning Star'],
  [/\bthe great i am\b/gi, 'the Great I Am']
]

/** House style. */
export const HOUSE_CAP: Record<string, string> = { church: 'Church' }

/** Depends on whether the referent is divine: left unchanged, flagged. */
export const AMBIGUOUS_DIVINE = new Set([
  'spirit', 'word', 'name', 'father', 'son',
  'king', 'rock', 'shepherd', 'light', 'life', 'way',
  'truth', 'vine', 'bread', 'gate', 'door', 'branch', 'root', 'dove',
  'one', 'master', 'author'
])

/** British -> American spelling (case pattern preserved). */
export const SPELLING: Record<string, string> = {
  saviour: 'savior', honour: 'honor', honours: 'honors',
  honoured: 'honored', honouring: 'honoring', favour: 'favor',
  favours: 'favors', favoured: 'favored', favouring: 'favoring',
  colour: 'color', colours: 'colors', coloured: 'colored',
  glamour: 'glamor', labour: 'labor', labours: 'labors',
  neighbour: 'neighbor', neighbours: 'neighbors', splendour: 'splendor',
  valour: 'valor', ardour: 'ardor', fervour: 'fervor',
  vapour: 'vapor', vapours: 'vapors', clamour: 'clamor',
  centre: 'center', centres: 'centers', theatre: 'theater',
  fibre: 'fiber', sceptre: 'scepter', sombre: 'somber',
  travelling: 'traveling', travelled: 'traveled', traveller: 'traveler',
  marvellous: 'marvelous', counsellor: 'counselor',
  counsellors: 'counselors', jewellery: 'jewelry', defence: 'defense',
  offence: 'offense', fulfil: 'fulfill', fulfilment: 'fulfillment',
  worshipper: 'worshiper', worshippers: 'worshipers',
  worshipping: 'worshiping'
}

/** Conservative, well-known worship-lyric typos only. */
export const TYPOS: Record<string, string> = {
  alright: 'all right', untill: 'until', recieve: 'receive',
  beleive: 'believe', definately: 'definitely', seperate: 'separate',
  freind: 'friend', thier: 'their', wich: 'which', halleluiah: 'hallelujah'
}

/** Common words that are safe to de-capitalize mid-line. */
export const COMMON_WORDS = new Set([
  'world', 'see', 'saw', 'seen', 'let', 'all', 'every', 'when', 'where',
  'while', 'before', 'after', 'above', 'below', 'through', 'beyond',
  'within', 'without', 'again', 'today', 'tonight', 'forever', 'always',
  'never', 'here', 'there', 'now', 'then', 'come', 'came', 'coming', 'go',
  'goes', 'going', 'gone', 'run', 'running', 'walk', 'walking', 'stand',
  'standing', 'rise', 'rising', 'fall', 'falling', 'fell', 'hold', 'holding',
  'held', 'give', 'giving', 'given', 'gave', 'take', 'taking', 'taken',
  'took', 'bring', 'bringing', 'brought', 'shout', 'shouting', 'cry',
  'crying', 'call', 'calling', 'wait', 'waiting', 'seek', 'seeking', 'find',
  'finding', 'found', 'know', 'knowing', 'knew', 'known', 'feel', 'feeling',
  'hear', 'hearing', 'speak', 'speaking', 'tell', 'telling', 'make',
  'making', 'made', 'open', 'close', 'high', 'low', 'deep', 'wide', 'far',
  'near', 'good', 'great', 'strong', 'sweet', 'bright', 'morning',
  'evening', 'river', 'sea', 'ocean', 'mountain', 'mountains', 'valley',
  'ground', 'earth', 'sky', 'wind', 'rain', 'storm', 'sun', 'moon', 'star',
  'stars', 'song', 'songs', 'sing', 'singing', 'praise', 'praises',
  'wonder', 'wonders', 'love', 'loving', 'loved', 'joy', 'peace', 'hope',
  'fear', 'darkness', 'shadow', 'shadows', 'ever', 'more', 'most', 'many',
  'much', 'old', 'new', 'free', 'alive', 'awake', 'anew',
  // Christian common-nouns / attributes that are never names or titles.
  'grace', 'glory', 'glories', 'blood', 'mercy', 'mercies',
  'majesty', 'majesties', 'kingdom', 'kingdoms', 'holy',
  'cross', 'crosses'
])

/** Grammatical function words: never capitalized mid-line in lyrics. */
export const FUNCTION_WORDS = new Set([
  'a', 'an', 'the',
  'and', 'but', 'or', 'nor', 'yet', 'so', 'for', 'as', 'than', 'if',
  'though', 'although', 'because', 'unless', 'until', 'till', 'while',
  'in', 'on', 'at', 'of', 'to', 'by', 'with', 'from', 'into', 'unto',
  'onto', 'upon', 'over', 'under', 'beneath', 'beside', 'between', 'among',
  'through', 'throughout', 'around', 'about', 'before', 'after', 'behind',
  'within', 'without', 'against', 'toward', 'towards', 'across', 'along',
  'beyond', 'near', 'off', 'out', 'up', 'down',
  'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being', 'do', 'does',
  'did', 'has', 'have', 'had', 'having', 'will', 'would', 'shall', 'should',
  'can', 'could', 'may', 'might', 'must',
  'not', 'no', 'this', 'that', 'these', 'those'
])

const ACRONYMS = new Set<string>()

/** Front-clipped elisions whose leading mark is ALWAYS an apostrophe, never an opening quote. */
export const ELISIONS = new Set(['cause', 'twas', 'tis', 'twill', 'til', 'till', 'em', 'round', 'neath', 'gainst', 'fore', 'bout', 'cept', 'nuff', 'n'])

// ---------------------------------------------------------------------------
// Config & result
// ---------------------------------------------------------------------------

export interface CorrectorConfig {
  /** Capitalize You/Your/Thy... everywhere (default off: human-vs-God is context-dependent). */
  divineSecondPerson: boolean
  allcaps: boolean
  /** British -> American spelling. */
  spelling: boolean
  smartPunct: boolean
  midline: boolean
  typos: boolean
  /** Divine names, phrase titles and house style. */
  divine: boolean
  /** Lowercase stray mid-word capitals. */
  intercaps: boolean
  /** Join each line's last two words with a non-breaking space (see preventOrphans). */
  nbspOrphan: boolean
}

export const DEFAULT_CORRECTOR: CorrectorConfig = {
  divineSecondPerson: false, allcaps: true, spelling: true, smartPunct: true, midline: true,
  typos: true, divine: true, intercaps: true, nbspOrphan: true
}

export interface CorrectionResult {
  text: string
  changed: boolean
  notes: string[]
  /** Ambiguities (e.g. "ambiguous-divine:'king'", "second-person") a human should review. */
  flags: string[]
}

const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g
const APOS = '’'
const LDQ = '“'
const RDQ = '”'
const WORD_INITIAL_QUOTE = /(?<![A-Za-z0-9])['’‘]([A-Za-z]+)/g
export const NBSP = ' '

const isAlpha = (c: string): boolean => c !== '' && /^\p{L}$/u.test(c)
const isDigit = (c: string): boolean => c !== '' && /^\p{Nd}$/u.test(c)
const hasCased = (w: string): boolean => w.toLowerCase() !== w.toUpperCase()
/** Python str.isupper(): at least one cased char and no lowercase ones. */
const isUpper = (w: string): boolean => hasCased(w) && w === w.toUpperCase()
const isLowerCh = (c: string): boolean => c !== '' && c !== c.toUpperCase()
const isUpperCh = (c: string): boolean => c !== '' && c !== c.toLowerCase()

/** Map a lowercase replacement onto the case pattern of templateWord. */
export function applyCase(templateWord: string, lowerReplacement: string): string {
  if (isUpper(templateWord) && templateWord.length > 1) return lowerReplacement.toUpperCase()
  if (isUpperCh(templateWord.slice(0, 1))) return lowerReplacement.slice(0, 1).toUpperCase() + lowerReplacement.slice(1)
  return lowerReplacement
}

const isAllcapsWord = (w: string): boolean => w.length > 1 && isUpper(w) && /^[A-Za-z]+$/.test(w)

const mapWords = (line: string, fn: (w: string) => string): string => line.replace(WORD_RE, fn)
const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

// ---------------------------------------------------------------------------
// Per-line passes
// ---------------------------------------------------------------------------

function smartPunctuation(line: string, notes: string[]): string {
  line = line.replace(WORD_INITIAL_QUOTE, (all, w: string) => (ELISIONS.has(w.toLowerCase()) ? APOS + w : all))
  const chars = [...line]
  const n = chars.length
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const ch = chars[i]
    if (ch === "'") {
      const prev = i > 0 ? chars[i - 1] : ''
      const nxt = i + 1 < n ? chars[i + 1] : ''
      if (isAlpha(prev) && (isAlpha(nxt) || !nxt.trim() || '.,!?;:)'.includes(nxt))) { out.push(APOS); continue }
      if (isAlpha(prev) || isAlpha(nxt)) { out.push(APOS); continue }
      out.push(ch)
    } else out.push(ch)
  }
  let line2 = out.join('')
  if (line2.includes('"')) {
    const c2 = [...line2]
    const res: string[] = []
    let opened = false
    for (let i = 0; i < c2.length; i++) {
      const ch = c2[i]
      if (ch === '"') {
        const prev = i > 0 ? c2[i - 1] : ''
        if (isDigit(prev)) { res.push('"'); continue }
        res.push(opened ? RDQ : LDQ)
        opened = !opened
      } else res.push(ch)
    }
    line2 = res.join('')
  }
  if (line2 !== line) notes.push('smart-punct')
  return line2
}

function allcapsToBase(line: string, notes: string[]): string {
  const next = mapWords(line, (w) => (isAllcapsWord(w) && !ACRONYMS.has(w) && w.toLowerCase() !== 'i' ? w.toLowerCase() : w))
  if (next !== line) notes.push('allcaps->sentence')
  return next
}

function fixIntercaps(line: string, notes: string[]): string {
  return mapWords(line, (w) => {
    if (isUpper(w)) return w
    const fixed = w[0] + [...w.slice(1)].map((c) => (isUpperCh(c) ? c.toLowerCase() : c)).join('')
    if (fixed !== w) notes.push(`intercaps:${w}->${fixed}`)
    return fixed
  })
}

function spellingPass(line: string, notes: string[]): string {
  const next = mapWords(line, (w) => (has(SPELLING, w.toLowerCase()) ? applyCase(w, SPELLING[w.toLowerCase()]) : w))
  if (next !== line) notes.push('us-spelling')
  return next
}

function typosPass(line: string, notes: string[]): string {
  const next = mapWords(line, (w) => {
    const low = w.toLowerCase()
    if (!has(TYPOS, low)) return w
    const rep = TYPOS[low]
    return isLowerCh(rep.slice(0, 1)) ? applyCase(w, rep) : rep
  })
  if (next !== line) notes.push('typo-fix')
  return next
}

function divineWords(line: string, cfg: CorrectorConfig, notes: string[], flags: string[]): string {
  for (const [rx, canon] of PHRASE_RULES) {
    rx.lastIndex = 0
    if (rx.test(line)) { rx.lastIndex = 0; line = line.replace(rx, canon); notes.push('divine-phrase') }
    rx.lastIndex = 0
  }
  return mapWords(line, (w) => {
    const low = w.toLowerCase()
    if (has(ALWAYS_CAP, low)) {
      const rep = ALWAYS_CAP[low]
      if (w !== rep) notes.push(`divine-cap:${low}`)
      return rep
    }
    if (has(HOUSE_CAP, low)) {
      const rep = HOUSE_CAP[low]
      if (w !== rep) notes.push(`house-cap:${low}`)
      return rep
    }
    if (cfg.divineSecondPerson && has(SECOND_PERSON, low)) {
      const rep = SECOND_PERSON[low]
      if (w !== rep) notes.push(`divine-2p:${low}`)
      return rep
    }
    if (AMBIGUOUS_DIVINE.has(low) && isLowerCh(w.slice(0, 1))) flags.push(`ambiguous-divine:'${low}'`)
    return w
  })
}

function pronounI(line: string, notes: string[]): string {
  return mapWords(line, (w) => {
    if (w === 'i') { notes.push('pronoun-I'); return 'I' }
    if (w[0] === 'i' && w.length > 1 && "'’".includes(w[1])) return 'I' + w.slice(1)
    return w
  })
}

function midlineDecap(line: string, notes: string[]): string {
  const matches = [...line.matchAll(WORD_RE)]
  if (!matches.length) return line
  const pieces: string[] = []
  let last = 0
  matches.forEach((m, idx) => {
    const start = m.index!
    pieces.push(line.slice(last, start))
    const w = m[0]
    if (idx === 0) pieces.push(w)
    else {
      const low = w.toLowerCase()
      const nxt = idx + 1 < matches.length ? matches[idx + 1][0].toLowerCase() : ''
      const holyTitle = low === 'holy' && ['spirit', 'ghost', 'one'].includes(nxt)
      if (isUpperCh(w.slice(0, 1)) && !isUpper(w) && (COMMON_WORDS.has(low) || FUNCTION_WORDS.has(low)) && !holyTitle &&
        !has(ALWAYS_CAP, low) && !has(SECOND_PERSON, low) && !has(HOUSE_CAP, low) && !AMBIGUOUS_DIVINE.has(low)) {
        pieces.push(low)
        notes.push(`midline-decap:${low}`)
      } else pieces.push(w)
    }
    last = start + w.length
  })
  pieces.push(line.slice(last))
  return pieces.join('')
}

function firstWordCap(line: string, notes: string[]): string {
  WORD_RE.lastIndex = 0
  const m = new RegExp(WORD_RE.source).exec(line)
  if (!m) return line
  const w = m[0]
  if (isLowerCh(w[0])) {
    notes.push('first-word-cap')
    return line.slice(0, m.index) + w[0].toUpperCase() + w.slice(1) + line.slice(m.index + w.length)
  }
  return line
}

function collapseSpaces(line: string, notes: string[]): string {
  const next = line.replace(/[ \t]{2,}/g, ' ').replace(/\s+$/, '')
  if (next !== line) notes.push('spacing')
  return next
}

// ---------------------------------------------------------------------------
// Orphan-word guard (line wrapping, not grammar). NOT part of correctLine/correctText.
// ---------------------------------------------------------------------------

const LAST_WORD_GAP = /^(.*[^ \t ])[ \t]+([^ \t ]+)$/s

function preventOrphanLine(line: string): string {
  const m = LAST_WORD_GAP.exec(line)
  return m ? m[1] + NBSP + m[2] : line
}

/** Glue the last two words of every line with a non-breaking space so a lone word never wraps. */
export function preventOrphans(text: string): string {
  return text.split('\n').map((ln) => (ln.trim() ? preventOrphanLine(ln) : ln)).join('\n')
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

const ONE_WHO = /\bthe one whom?\b/i

/** Flag context-dependent casing for a human to decide (does NOT change the text). */
function flagForReview(line: string, flags: string[]): void {
  const words = line.match(WORD_RE) ?? []
  words.forEach((w, i) => {
    if (i === 0) return
    const low = w.toLowerCase()
    if (has(SECOND_PERSON, low) && !flags.includes('second-person')) flags.push('second-person')
    if (THIRD_PERSON.has(low) && !flags.includes('third-person')) flags.push('third-person')
    if (FIRST_PERSON.has(low) && !flags.includes('first-person')) flags.push('first-person')
  })
  if (ONE_WHO.test(line) && !flags.includes('relative-pronoun')) flags.push('relative-pronoun')
  for (const m of line.matchAll(WORD_INITIAL_QUOTE)) {
    if (!ELISIONS.has(m[1].toLowerCase())) {
      if (!flags.includes('word-initial-quote')) flags.push('word-initial-quote')
      break
    }
  }
}

export function correctLine(line: string, cfg: CorrectorConfig, notes: string[], flags: string[]): string {
  if (!line.trim()) return ''
  flagForReview(line, flags)
  if (cfg.spelling) line = spellingPass(line, notes)
  if (cfg.typos) line = typosPass(line, notes)
  if (cfg.allcaps) line = allcapsToBase(line, notes)
  if (cfg.intercaps) line = fixIntercaps(line, notes)
  if (cfg.smartPunct) line = smartPunctuation(line, notes)
  if (cfg.divine) line = divineWords(line, cfg, notes, flags)
  line = pronounI(line, notes)
  if (cfg.midline) line = midlineDecap(line, notes)
  line = firstWordCap(line, notes)
  line = collapseSpaces(line, notes)
  return line
}

/** Strip leading/trailing blank lines; collapse 2+ internal blanks to 1. */
export function cleanBlankLines(lines: string[]): string[] {
  const l = [...lines]
  while (l.length && !l[0].trim()) l.shift()
  while (l.length && !l[l.length - 1].trim()) l.pop()
  const out: string[] = []
  let blank = false
  for (const ln of l) {
    if (!ln.trim()) {
      if (blank) continue
      blank = true
      out.push('')
    } else { blank = false; out.push(ln) }
  }
  return out
}

export function correctText(text: string, cfg: Partial<CorrectorConfig> = {}): CorrectionResult {
  const c: CorrectorConfig = { ...DEFAULT_CORRECTOR, ...cfg }
  let notes: string[] = []
  const flags: string[] = []
  const corrected = cleanBlankLines(text.split('\n').map((ln) => correctLine(ln, c, notes, flags)))
  let next = corrected.join('\n')
  if (next !== text && !corrected.length && text.trim() === '') next = text
  const changed = next !== text
  if (!changed) notes = []
  return { text: next, changed, notes, flags }
}
