/**
 * "Format song": one-click clean-up of imported / pasted lyrics.
 *
 *  - merges lines that were broken mid-phrase ("How great the chasm" / "that lay between us" → one line)
 *  - re-slides each section so a slide holds `linesPerSlide` full lines
 *  - keeps section headings (Verse / Chorus…) and strips stray blank lines + trailing punctuation clutter
 *  - optional sentence case, and the worship-lyric corrector (capitalisation of God/Lord…, typos, smart quotes)
 *
 * It works on the Text-mode representation and maps the result back with `applyReflow`, so slide styling,
 * per-canvas variants, notes and ids survive wherever the words still line up.
 */
import type { Presentation } from './model'
import { applyReflow, headingName, parseReflow, presentationToText, BLANK } from './editor-reflow'
import { ALWAYS_CAP, correctText, type CorrectorConfig } from './lyric-corrector'

export interface LyricFormatSettings {
  /** Lines per slide (default 2). */
  linesPerSlide: number
  /** Longest line in characters (default 40). Longer lines are split; shorter fragments are merged up to this. */
  maxLineChars: number
  mergeShortLines: boolean
  /** Keep section headings (Verse 1, [Chorus]) and re-slide within each section; false drops the headings. */
  keepSections: boolean
  /** Remove trailing , ; : . and repeated !!/?? at the end of lines. */
  stripTrailingPunctuation: boolean
  /** 'sentence' lowercases SHOUTING / Title Case lines (keeping I and God/Lord…) and capitalises each line's first letter. */
  caseMode: 'keep' | 'sentence'
  /** Run the worship-lyric corrector (ported from pro7-lyric-corrector). */
  correct: boolean
  corrector?: Partial<CorrectorConfig>
}

export const DEFAULT_LYRIC_FORMAT: LyricFormatSettings = {
  linesPerSlide: 2, maxLineChars: 40, mergeShortLines: true, keepSections: true,
  stripTrailingPunctuation: true, caseMode: 'keep', correct: true
}

/** Workspace doc `lyricFormat`. */
export interface LyricFormatDoc {
  format: LyricFormatSettings
  /** Run the corrector on songs that arrive from ProPresenter import, Planning Center or pasted lyrics. */
  autoCorrectImported: boolean
}
export const DEFAULT_LYRIC_FORMAT_DOC: LyricFormatDoc = { format: DEFAULT_LYRIC_FORMAT, autoCorrectImported: true }

export function resolveLyricFormat(doc: Partial<LyricFormatDoc> | null | undefined, override?: Partial<LyricFormatSettings>): LyricFormatSettings {
  return { ...DEFAULT_LYRIC_FORMAT, ...(doc?.format ?? {}), ...(override ?? {}) }
}

export interface FlaggedLine { slide: number; text: string; flags: string[] }

export interface FormatReport {
  changed: boolean
  slidesBefore: number
  slidesAfter: number
  /** Lines joined or split by the layout pass. */
  linesReflowed: number
  /** Number of individual corrector edits. */
  corrections: number
  /** A few example corrector notes, for the preview. */
  correctionNotes: string[]
  /** Lines a person should look at (ambiguous God/He/Spirit… capitalisation). */
  flagged: FlaggedLine[]
}

export interface FormatResult { presentation: Presentation; text: string; report: FormatReport }

const TERMINAL = /[.!?;:]["'”’)]*$/
const clean = (s: string): string => s.replace(/[ \t]+/g, ' ').trim()

function stripTrailing(line: string): string {
  return line.replace(/([!?])\1+$/, '$1').replace(/(?:\s*[,;:.\-–—]+)+\s*$/, '').trimEnd()
}

/** Merge broken lines greedily while the result fits `max` and the earlier line doesn't end a sentence. */
function mergeLines(lines: string[], max: number, merge: boolean): string[] {
  const out: string[] = []
  for (const raw of lines) {
    const line = clean(raw)
    if (!line) continue
    const cur = out[out.length - 1]
    if (merge && cur !== undefined && !TERMINAL.test(cur) && cur.length + 1 + line.length <= max && (/^\p{Ll}/u.test(line) || cur.length < max * 0.6)) {
      out[out.length - 1] = `${cur} ${line}`
    } else out.push(line)
  }
  return out
}

/** Split a line longer than `max` at word boundaries into balanced pieces (preferring commas). */
function splitLong(line: string, max: number): string[] {
  if (line.length <= max) return [line]
  const n = Math.ceil(line.length / max)
  const words = line.split(' ')
  const target = line.length / n
  const out: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (cur && out.length < n - 1 && (next.length > max || (cur.length >= target * 0.9 && /,$/.test(cur)) || next.length > target * 1.15)) { out.push(cur); cur = w } else cur = next
  }
  if (cur) out.push(cur)
  return out
}

const KEEP_CAP = new Set(Object.values(ALWAYS_CAP))
function sentenceCase(line: string): string {
  const letters = line.replace(/[^A-Za-z]/g, '')
  if (!letters) return line
  // Only touch lines that are shouting or Title Case; leave normal mixed case alone.
  const words = line.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) ?? []
  const caps = words.filter((w) => /^[A-Z]/.test(w)).length
  const shouting = letters === letters.toUpperCase() && letters.length > 3
  const titleCase = words.length >= 3 && caps / words.length > 0.8
  let out = line
  if (shouting || titleCase) {
    out = line.replace(/[A-Za-z]+(?:['’][A-Za-z]+)*/g, (w) => {
      if (w === 'I' || /^I['’]/.test(w)) return w
      const base = w.toLowerCase()
      const proper = [...KEEP_CAP].find((k) => k.toLowerCase() === base)
      return proper && !shouting ? proper : base
    })
  }
  return out.replace(/^(\P{L}*)(\p{Ll})/u, (_, a: string, b: string) => a + b.toUpperCase())
}

interface Section { head: string | null; blocks: string[][] }

/** Pure text → text formatting. Headings are kept verbatim; returns the new Text-mode document. */
export function formatLyricText(text: string, s: LyricFormatSettings, tally?: { reflowed: number }): string {
  const items = parseReflow(text)
  // Section = heading + the slides that follow it. Without headings, each blank-line block stands alone.
  const sections: Section[] = []
  let cur: Section | null = null
  for (const it of items) {
    if (it.type === 'group') {
      if (!s.keepSections) continue
      const line = text.split('\n').find((l) => headingName(l) === it.name) ?? it.name
      cur = { head: line.trim(), blocks: [] }
      sections.push(cur)
    } else {
      const lines = it.text.split('\n')
      if (cur) cur.blocks.push(lines)
      else sections.push({ head: null, blocks: [lines] })
    }
  }
  const outBlocks: string[] = []
  const per = Math.max(1, Math.round(s.linesPerSlide))
  const max = Math.max(10, Math.round(s.maxLineChars))
  for (const sec of sections) {
    let pendingHead = sec.head
    const flat: string[] = []
    const emit = (lines: string[]): void => {
      for (let i = 0; i < lines.length; i += per) {
        outBlocks.push([...(pendingHead ? [pendingHead] : []), ...lines.slice(i, i + per)].join('\n'))
        pendingHead = null
      }
    }
    for (const b of sec.blocks) {
      if (b.length === 1 && b[0].trim() === BLANK) { if (flat.length) { emit(finish(flat.splice(0))); } outBlocks.push([...(pendingHead ? [pendingHead] : []), BLANK].join('\n')); pendingHead = null; continue }
      flat.push(...b)
    }
    if (flat.length) emit(finish(flat))
    else if (pendingHead) outBlocks.push(pendingHead)
  }
  function finish(lines: string[]): string[] {
    const before = lines.filter((l) => l.trim()).length
    let out = mergeLines(lines, max, s.mergeShortLines).flatMap((l) => splitLong(l, max))
    if (s.stripTrailingPunctuation) out = out.map(stripTrailing).filter(Boolean)
    if (s.caseMode === 'sentence') out = out.map(sentenceCase)
    if (tally) tally.reflowed += Math.abs(before - out.length)
    return out
  }
  return outBlocks.join('\n\n')
}

/** Run the corrector over a Text-mode document, leaving heading lines alone. */
export function correctDocumentText(text: string, cfg?: Partial<CorrectorConfig>): { text: string; notes: string[]; flagged: { block: number; text: string; flags: string[] }[] } {
  const notes: string[] = []
  const flagged: { block: number; text: string; flags: string[] }[] = []
  let block = 0
  const out: string[] = []
  let buf: string[] = []
  const flush = (): void => {
    if (!buf.length) return
    // correctText works on a block at a time so each slide's lines are corrected independently.
    const r = correctText(buf.join('\n'), cfg)
    notes.push(...r.notes)
    if (r.flags.length) flagged.push({ block, text: r.text.split('\n')[0] ?? '', flags: r.flags })
    out.push(...(r.text ? r.text.split('\n') : buf))
    buf = []
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) { flush(); out.push(line); block++; continue }
    if (headingName(line) !== null) { flush(); out.push(line); continue }
    buf.push(line)
  }
  flush()
  return { text: out.join('\n'), notes, flagged }
}

function build(p: Presentation, text: string, corrected: ReturnType<typeof correctDocumentText> | null, linesReflowed: number): FormatResult {
  const presentation = applyReflow(p, text)
  const slidesAfter = presentation.slides.length
  const changed = presentation !== p
  // Locate flagged lines by slide index (count slide blocks up to the flagged block).
  const flagged: FlaggedLine[] = []
  if (corrected) {
    const blocks = text.split(/\n[ \t]*\n/)
    let slideNo = 0
    const slideIndexOfBlock: number[] = []
    for (const b of blocks) {
      const hasText = b.split('\n').some((l) => l.trim() && headingName(l) === null)
      slideIndexOfBlock.push(hasText ? slideNo++ : -1)
    }
    for (const f of corrected.flagged) flagged.push({ slide: (slideIndexOfBlock[f.block] ?? 0) + 1, text: f.text, flags: f.flags })
  }
  return {
    presentation, text,
    report: {
      changed, slidesBefore: p.slides.length, slidesAfter, linesReflowed,
      corrections: corrected?.notes.length ?? 0, correctionNotes: [...new Set(corrected?.notes ?? [])].slice(0, 12), flagged
    }
  }
}

/** Format a whole presentation (layout + optional corrector). Returns the same object when nothing changes. */
export function formatPresentation(p: Presentation, settings: Partial<LyricFormatSettings> = {}): FormatResult {
  const s = { ...DEFAULT_LYRIC_FORMAT, ...settings }
  const tally = { reflowed: 0 }
  let text = formatLyricText(presentationToText(p), s, tally)
  const corrected = s.correct ? correctDocumentText(text, s.corrector) : null
  if (corrected) text = corrected.text
  return build(p, text, corrected, tally.reflowed)
}

/** Corrector only (no re-slide): what imported songs get when "Auto-correct imported songs" is on. */
export function correctPresentation(p: Presentation, cfg?: Partial<CorrectorConfig>): FormatResult {
  const corrected = correctDocumentText(presentationToText(p), cfg)
  return build(p, corrected.text, corrected, 0)
}
