/**
 * "Text view" of a presentation: the whole thing as a plain document.
 *
 *   Verse 1                    ← a section name on its own line starts a group ([Any Name] also works)
 *   Amazing grace how sweet    ← lines = the slide's text
 *   That saved a wretch
 *                              ← blank line = next slide
 *   I once was lost
 *
 * `applyReflow` maps edited text back onto the existing slides so styling, per-canvas
 * variants, notes and ids survive wherever the words still line up.
 */
import type { Presentation, Slide, SlideGroup, TextElement } from './model'
import { groupOfSlide } from './model'
import { cloneSlide, paragraphsText, primaryText, setParagraphsText, uid } from './editor-util'
import { normalizeSlide } from './editor-variants'

const SECTION_RE = /^((verse|chorus|bridge|pre-?chorus|intro|outro|tag|ending|interlude|refrain|vamp|turnaround|instrumental|hook|coda)\s*\d*[a-z]?)\s*:?$/i
const BRACKET_RE = /^\[\s*(.+?)\s*\]:?$/
export const BLANK = '(blank)'
const UNGROUPED = '-'

const GROUP_COLORS: Record<string, string> = {
  verse: '#3886CE', chorus: '#E6A20F', bridge: '#9B6BD3', 'pre-chorus': '#4FA88B', prechorus: '#4FA88B',
  intro: '#7A7A7A', outro: '#7A7A7A', tag: '#D8674F', ending: '#7A7A7A', interlude: '#7A7A7A',
  refrain: '#E6A20F', vamp: '#D8674F', turnaround: '#7A7A7A', instrumental: '#7A7A7A', hook: '#D8674F', coda: '#7A7A7A'
}
export const GROUP_PALETTE = ['#3886CE', '#E6A20F', '#9B6BD3', '#4FA88B', '#D8674F', '#7A7A7A', '#C95B8E', '#5BA7C9']
export function groupColor(name: string): string {
  return GROUP_COLORS[name.toLowerCase().replace(/\s*\d+[a-z]?$/, '').trim()] ?? '#7A7A7A'
}
const titleCase = (s: string): string => s.toLowerCase().replace(/(^|\s|-)\w/g, (c) => c.toUpperCase())

/** If the line is a section heading, return the group name. */
export function headingName(line: string): string | null {
  const t = line.trim()
  const b = BRACKET_RE.exec(t)
  if (b) return b[1]
  const m = SECTION_RE.exec(t)
  return m ? titleCase(m[1]) : null
}
const headingLine = (name: string): string => (SECTION_RE.test(name) && titleCase(name) === name ? name : `[${name}]`)

export function slideReflowText(slide: Slide): string {
  const t = primaryText(slide.elements)
  const text = t ? paragraphsText(t.paragraphs).replace(/\n\s*\n/g, '\n').trim() : ''
  return text || BLANK
}

export function presentationToText(p: Presentation): string {
  const out: string[] = []
  let prev: SlideGroup | undefined | null = null
  for (const s of p.slides) {
    const g = groupOfSlide(p, s.id)
    let head = ''
    if (g !== prev && (g || prev)) head = (g ? headingLine(g.name) : `[${UNGROUPED}]`) + '\n'
    prev = g
    out.push(head + slideReflowText(s))
  }
  return out.join('\n\n')
}

export type ReflowItem = { type: 'group'; name: string } | { type: 'slide'; text: string }

export function parseReflow(text: string): ReflowItem[] {
  const items: ReflowItem[] = []
  const blocks = text.replace(/\r/g, '').split(/\n[ \t]*(?:\n[ \t]*)+/)
  for (const raw of blocks) {
    const lines = raw.split('\n').map((l) => l.replace(/\s+$/, ''))
    while (lines.length && !lines[0].trim()) lines.shift()
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
    if (!lines.length) continue
    // Headings can appear at the top of a block; several in a row make empty groups.
    while (lines.length) {
      const h = headingName(lines[0])
      if (h === null) break
      items.push({ type: 'group', name: h })
      lines.shift()
    }
    if (lines.length) items.push({ type: 'slide', text: lines.join('\n') })
  }
  return items
}

/** Split any slide longer than `maxLines` into evenly sized slides. */
export function splitLongBlocks(text: string, maxLines: number): string {
  if (!maxLines || maxLines < 1) return text
  const out: string[] = []
  let pendingHead: string[] = []
  for (const it of parseReflow(text)) {
    if (it.type === 'group') { pendingHead.push(headingLine(it.name)); continue }
    const lines = it.text.split('\n')
    const n = Math.ceil(lines.length / maxLines)
    const per = Math.ceil(lines.length / n)
    for (let i = 0; i < n; i++) {
      const chunk = lines.slice(i * per, (i + 1) * per).join('\n')
      out.push([...pendingHead, chunk].join('\n'))
      pendingHead = []
    }
  }
  if (pendingHead.length) out.push(pendingHead.join('\n'))
  return out.join('\n\n')
}

function defaultTextElement(p: Presentation, text: string): TextElement {
  const { width, height } = p.size
  return {
    id: uid(), type: 'text', role: 'lyrics', name: 'Lyrics',
    frame: { x: width * 0.08, y: height * 0.1, w: width * 0.84, h: height * 0.8 },
    paragraphs: text.split('\n').map((l) => ({ runs: [{ text: l }] })), align: 'center', verticalAlign: 'middle', autoFit: true,
    style: { fontFamily: 'Reach Sans', fontSize: Math.round(height * 0.085), fontWeight: 600, color: '#FFFFFF', lineHeight: 1.2 }
  }
}

/** Set the main text of a slide, keeping everything else about it. */
export function withSlideText(p: Presentation, slide: Slide, text: string): Slide {
  const value = text === BLANK ? '' : text
  const t = primaryText(slide.elements)
  if (!t) return value ? { ...slide, elements: [...slide.elements, defaultTextElement(p, value)] } : slide
  if (paragraphsText(t.paragraphs) === value) return slide
  const next: TextElement = { ...t, paragraphs: setParagraphsText(t.paragraphs, value) }
  return normalizeSlide({ ...slide, elements: slide.elements.map((e) => (e.id === t.id ? next : e)) })
}

/** Longest common subsequence of equal strings → index pairs. */
function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const pairs: [number, number][] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++ } else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return pairs
}

function freshSlide(p: Presentation, template: Slide | undefined, text: string): Slide {
  if (!template) return { id: uid(), elements: [defaultTextElement(p, text === BLANK ? '' : text)] }
  const s = cloneSlide(template)
  delete s.label
  delete s.notes
  delete s.actions
  delete s.autoAdvance
  return withSlideText(p, s, text)
}

export interface ReflowOptions {
  /** Auto-split slides longer than this many lines. */
  maxLines?: number
}

/** Apply edited text to a presentation. Returns the same object if nothing changed. */
export function applyReflow(p: Presentation, text: string, opts: ReflowOptions = {}): Presentation {
  const items = parseReflow(opts.maxLines ? splitLongBlocks(text, opts.maxLines) : text)
  const blocks = items.filter((i): i is Extract<ReflowItem, { type: 'slide' }> => i.type === 'slide').map((i) => i.text)
  const oldTexts = p.slides.map(slideReflowText)

  // 1. Align new blocks with old slides: unchanged text anchors, the gaps pair up in order.
  const result: Slide[] = new Array<Slide>(blocks.length)
  const anchors = [...lcs(oldTexts, blocks), [p.slides.length, blocks.length] as [number, number]]
  let oi = 0
  let ni = 0
  for (const [ao, an] of anchors) {
    const oldGap = ao - oi
    const newGap = an - ni
    for (let k = 0; k < newGap; k++) {
      if (k < oldGap) result[ni + k] = withSlideText(p, p.slides[oi + k], blocks[ni + k])
      else result[ni + k] = freshSlide(p, result[ni + k - 1] ?? p.slides[Math.min(oi, p.slides.length - 1)], blocks[ni + k])
    }
    if (ao < p.slides.length) result[an] = p.slides[ao]
    oi = ao + 1
    ni = an + 1
  }

  // 2. Groups from headings, reusing existing groups (k-th "Chorus" heading ↔ k-th group named Chorus).
  const used = new Set<string>()
  const groups: SlideGroup[] = []
  let current: SlideGroup | null = null
  let si = 0
  for (const it of items) {
    if (it.type === 'group') {
      if (it.name === UNGROUPED) { current = null; continue }
      const existing = p.groups.find((g) => !used.has(g.id) && g.name.toLowerCase() === it.name.toLowerCase())
      // A repeated heading with no matching existing group continues the earlier group of that name.
      const again = existing ? undefined : groups.find((g) => g.name.toLowerCase() === it.name.toLowerCase())
      if (again) { current = again; continue }
      current = existing ? { ...existing, slideIds: [] } : { id: uid(), name: it.name, color: groupColor(it.name), slideIds: [] }
      used.add(current.id)
      groups.push(current)
    } else {
      current?.slideIds.push(result[si].id)
      si++
    }
  }

  // 3. Arrangements: drop removed groups, slot new ones after the group that precedes them in the text.
  const oldIds = new Set(p.groups.map((g) => g.id))
  const arrangements = p.arrangements.map((a) => {
    let ids = a.groupIds.filter((id) => used.has(id))
    groups.forEach((g, gi) => {
      if (oldIds.has(g.id)) return
      const before = groups[gi - 1]
      const at = before ? ids.indexOf(before.id) : -1
      ids = before && at >= 0 ? [...ids.slice(0, at + 1), g.id, ...ids.slice(at + 1)] : gi === 0 ? [g.id, ...ids] : [...ids, g.id]
    })
    return ids.length === a.groupIds.length && ids.every((id, i) => id === a.groupIds[i]) ? a : { ...a, groupIds: ids }
  })

  const sameSlides = result.length === p.slides.length && result.every((s, i) => s === p.slides[i])
  const sameGroups = groups.length === p.groups.length && groups.every((g, i) => g.id === p.groups[i].id && g.slideIds.join() === p.groups[i].slideIds.join())
  const sameArr = arrangements.every((a, i) => a === p.arrangements[i])
  if (sameSlides && sameGroups && sameArr) return p
  return { ...p, slides: sameSlides ? p.slides : result, groups: sameGroups ? p.groups : groups, arrangements }
}
