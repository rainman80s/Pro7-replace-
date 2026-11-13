/**
 * Notion blocks → slides. Pure and deterministic so the rules can be documented for the pastors
 * (docs/integrations/notion-slide-rules.md) and tested (tests/notion.test.ts).
 */
import type { Passage } from '@shared/bible'
import { formatReference, isReferenceOnly, parseReferences } from '@shared/bible'
import type { SlideDraft } from '@shared/integrations'
import { hashOf } from '../integrations/http'
import type { NBlock, NRichText } from './client'

export interface Run { text: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; ref?: boolean }
export type Para = Run[]

export interface SlideSpec {
  key: string
  srcHash: string
  kind: SlideDraft['kind']
  title?: Para
  body: Para[]
  /** Body paragraphs are list items. */
  bullets?: boolean
  /** Reveal list items one at a time (comment "one at a time" or toggle setting). */
  reveal?: boolean
  /** Reference line (scripture slides). */
  reference?: string
  /** Scripture to fetch from the Bible service (reference with no pasted text). */
  fill?: Passage[]
  attribution?: string
  image?: { blockId: string; url: string; name: string; caption?: string }
  notes: string[]
  blockIds: string[]
  warnings: string[]
}

export interface ConvertOptions {
  mode: 'auto' | 'dividers' | 'headings' | 'announcement'
  /** Skip synced blocks (Reach's page template keeps its instructions in synced blocks). */
  skipSynced?: boolean
  maxChars?: number
  defaultTranslation?: string
  /** Comments by block id (operator notes). */
  comments?: Record<string, string[]>
}

/* ───────────── flatten ───────────── */

interface Item {
  kind: 'heading' | 'para' | 'bullet' | 'number' | 'quote' | 'callout' | 'divider' | 'image' | 'video' | 'embed' | 'code' | 'notes'
  level?: number
  runs: Run[]
  id: string
  depth: number
  url?: string
  name?: string
  caption?: string
  /** For 'notes': plain text lines. */
  lines?: string[]
}

const runsOf = (rt: NRichText[] | undefined): Run[] => (rt ?? []).filter((r) => r.plain_text).map((r) => {
  const a = r.annotations ?? {}
  const run: Run = { text: r.plain_text }
  if (a.bold) run.bold = true
  if (a.italic) run.italic = true
  if (a.underline) run.underline = true
  if (a.strikethrough) run.strike = true
  return run
})
export const runsText = (runs: Run[]): string => runs.map((r) => r.text).join('')
const val = (b: NBlock): Record<string, unknown> => (b[b.type] as Record<string, unknown>) ?? {}
const rich = (b: NBlock): NRichText[] => (val(b).rich_text as NRichText[]) ?? (val(b).text as NRichText[]) ?? []

const NOTES_TITLE = /^\s*(speaker\s*|operator\s*|presenter\s*|pastor'?s?\s*)?(notes?|talking points?)\s*:?\s*$/i
const SLIDES_TITLE = /^\s*slides?\s*:?\s*$/i
const BREAK_TEXT = /^\s*(\[\s*slide\s*\]|---+|\*\*\*+|___+|\/\/\s*slide)\s*$/i

function plainLines(blocks: NBlock[] | undefined, depth = 0): string[] {
  const out: string[] = []
  for (const b of blocks ?? []) {
    const t = rich(b).map((r) => r.plain_text).join('').trim()
    if (t) out.push((/list_item|to_do/.test(b.type) ? '  '.repeat(depth) + '• ' : '') + t)
    if (b.children?.length) out.push(...plainLines(b.children, depth + 1))
  }
  return out
}

function fileUrl(v: Record<string, unknown>): string {
  const f = (v.file as { url?: string }) ?? (v.external as { url?: string })
  return f?.url ?? ''
}
function fileName(url: string, id: string): string {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || id) } catch { return id }
}

export function flatten(blocks: NBlock[], opts: Pick<ConvertOptions, 'skipSynced'>, depth = 0, out: Item[] = [], warnings: string[] = []): Item[] {
  for (const b of blocks) {
    const v = val(b)
    switch (b.type) {
      case 'synced_block':
        if (!opts.skipSynced) flatten(b.children ?? [], opts, depth, out, warnings)
        break
      case 'heading_1': case 'heading_2': case 'heading_3': {
        const runs = trimRuns(runsOf(rich(b)))
        const text = runsText(runs)
        if (v.is_toggleable && NOTES_TITLE.test(text)) { out.push({ kind: 'notes', runs: [], id: b.id, depth, lines: plainLines(b.children) }); break }
        if (text) out.push({ kind: 'heading', level: Number(b.type.slice(-1)), runs, id: b.id, depth })
        if (b.children?.length) flatten(b.children, opts, depth, out, warnings)
        break
      }
      case 'paragraph': {
        const runs = trimRuns(runsOf(rich(b)))
        const text = runsText(runs)
        if (BREAK_TEXT.test(text)) out.push({ kind: 'divider', runs: [], id: b.id, depth })
        else if (text.trim()) {
          // Soft line breaks inside one paragraph (Shift+Enter) become separate lines.
          for (const [i, line] of splitRunsByNewline(runs).entries()) if (runsText(line).trim()) out.push({ kind: 'para', runs: line, id: i ? `${b.id}:${i}` : b.id, depth })
        }
        if (b.children?.length) flatten(b.children, opts, depth + 1, out, warnings)
        break
      }
      case 'bulleted_list_item': case 'numbered_list_item': case 'to_do': {
        const runs = trimRuns(runsOf(rich(b)))
        if (runsText(runs)) out.push({ kind: b.type === 'numbered_list_item' ? 'number' : 'bullet', runs, id: b.id, depth })
        if (b.children?.length) flatten(b.children, opts, depth + 1, out, warnings)
        break
      }
      case 'quote': case 'callout': {
        const runs = trimRuns(runsOf(rich(b)))
        if (runsText(runs)) out.push({ kind: b.type, runs, id: b.id, depth })
        if (b.children?.length) flatten(b.children, opts, depth + 1, out, warnings)
        break
      }
      case 'toggle': {
        const title = runsText(runsOf(rich(b)))
        if (SLIDES_TITLE.test(title)) flatten(b.children ?? [], opts, depth, out, warnings)
        else out.push({ kind: 'notes', runs: [], id: b.id, depth, lines: [...(NOTES_TITLE.test(title) ? [] : [title.trim()]), ...plainLines(b.children)].filter(Boolean) })
        break
      }
      case 'divider':
        out.push({ kind: 'divider', runs: [], id: b.id, depth })
        break
      case 'image': {
        const url = fileUrl(v)
        if (url) out.push({ kind: 'image', runs: [], id: b.id, depth, url, name: fileName(url, b.id), caption: runsText(runsOf(v.caption as NRichText[])) || undefined })
        break
      }
      case 'video': {
        const url = fileUrl(v)
        if (url) out.push({ kind: 'video', runs: [], id: b.id, depth, url, name: fileName(url, b.id) })
        break
      }
      case 'column_list': case 'column':
        flatten(b.children ?? [], opts, depth, out, warnings)
        break
      case 'code':
        out.push({ kind: 'notes', runs: [], id: b.id, depth, lines: [runsText(runsOf(rich(b)))] })
        break
      case 'table':
        warnings.push('A table was skipped — tables aren’t turned into slides. Use bullets instead.')
        break
      case 'embed': case 'bookmark': case 'link_preview': case 'pdf': case 'file': case 'audio':
        warnings.push(`A ${b.type.replace('_', ' ')} block was skipped.`)
        break
      default:
        // child_page, child_database, table_of_contents, breadcrumb, link_to_page, equation, unsupported…
        break
    }
  }
  return out
}

function trimRuns(runs: Run[]): Run[] {
  const out = runs.map((r) => ({ ...r }))
  while (out.length && !out[0].text.replace(/^[\s ]+/, '')) out.shift()
  while (out.length && !out[out.length - 1].text.replace(/[\s ]+$/, '')) out.pop()
  if (out.length) { out[0].text = out[0].text.replace(/^[\s ]+/, ''); out[out.length - 1].text = out[out.length - 1].text.replace(/[\s ]+$/, '') }
  return out.filter((r) => r.text)
}
function splitRunsByNewline(runs: Run[]): Run[][] {
  const lines: Run[][] = [[]]
  for (const r of runs) {
    const parts = r.text.split('\n')
    parts.forEach((p, i) => { if (i) lines.push([]); if (p) lines[lines.length - 1].push({ ...r, text: p }) })
  }
  return lines.map(trimRuns)
}

/* ───────────── segment & compose ───────────── */

const isQuoteText = (t: string): boolean => /^["“”‘'«]/.test(t.trim()) && t.trim().length > 12
const isAttribution = (t: string): boolean => /^[—–-]\s*\S/.test(t.trim()) || (t.trim().length <= 70 && !/[.!?:”"]$/.test(t.trim()) && /^[A-Z]/.test(t.trim()) && t.trim().split(/\s+/).length <= 9)

function refOf(item: Item, defaultTranslation?: string): Passage[] | null {
  if (item.kind !== 'para' && item.kind !== 'heading') return null
  const t = runsText(item.runs)
  if (!isReferenceOnly(t)) return null
  const ps = parseReferences(t)
  return ps.map((p) => ({ ...p, translation: p.translation ?? defaultTranslation }))
}

function decideMode(items: Item[], mode: ConvertOptions['mode']): ConvertOptions['mode'] {
  if (mode !== 'auto') return mode
  const slideHeads = items.filter((i) => i.kind === 'heading' && /^slide\s*\d+/i.test(runsText(i.runs))).length
  if (slideHeads >= 1) return 'announcement'
  return items.some((i) => i.kind === 'divider') ? 'dividers' : 'headings'
}

function segments(items: Item[], mode: ConvertOptions['mode']): { slides: Item[][]; tail: Item[] } {
  const out: Item[][] = [[]]
  const push = (): void => { if (out[out.length - 1].length) out.push([]) }
  if (mode === 'announcement') {
    let started = false
    const tail: Item[] = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.kind === 'heading' && /^slide\s*\d+/i.test(runsText(it.runs))) { started = true; push(); out[out.length - 1].push(it); continue }
      if (!started) continue
      if (it.kind === 'divider') { tail.push(...items.slice(i + 1)); break }
      out[out.length - 1].push(it)
    }
    return { slides: out.filter((s) => s.length), tail }
  }
  for (const it of items) {
    if (it.kind === 'divider') { push(); continue }
    if (mode === 'headings') {
      const cur = out[out.length - 1]
      const hasContent = cur.some((x) => x.kind !== 'notes')
      if (hasContent && ((it.kind === 'heading' && (it.level ?? 1) <= 2) || it.kind === 'image' || (refOf(it) && cur.some((x) => x.kind !== 'heading' && x.kind !== 'notes')))) push()
    }
    out[out.length - 1].push(it)
  }
  return { slides: out.filter((s) => s.some((x) => x.kind !== 'notes') ), tail: [] }
}

function emptySpec(key: string): SlideSpec {
  return { key, srcHash: '', kind: 'text', body: [], notes: [], blockIds: [], warnings: [] }
}

function finish(spec: SlideSpec): SlideSpec {
  const { srcHash: _h, warnings: _w, ...content } = spec
  spec.srcHash = hashOf(content)
  if (!spec.title && !spec.body.length && !spec.image && !spec.fill) spec.kind = 'text'
  return spec
}

function composeSegment(seg: Item[], opts: ConvertOptions, comments: Record<string, string[]>): SlideSpec[] {
  const out: SlideSpec[] = []
  const notes: string[] = []
  const ids = seg.map((s) => s.id)
  for (const id of ids) for (const c of comments[id.split(':')[0]] ?? []) notes.push(c)
  const reveal = notes.some((n) => /one (at a|by) (a )?time|build/i.test(n))
  const text: SlideSpec = emptySpec(seg.find((s) => s.kind !== 'notes')?.id ?? seg[0].id)
  let refs: string[] = []
  let hasQuote = false
  let textStarted = -1
  const slots: { at: number; spec: SlideSpec }[] = []
  for (let i = 0; i < seg.length; i++) {
    const it = seg[i]
    if (it.kind === 'notes') { notes.push(...(it.lines ?? [])); continue }
    if (it.kind === 'image' || it.kind === 'video') {
      const s = emptySpec(it.id)
      s.kind = 'image'
      s.image = { blockId: it.id, url: it.url!, name: it.name!, caption: it.caption }
      s.blockIds.push(it.id)
      if (it.kind === 'video') s.warnings.push('Videos from Notion are imported as media items, not slides.')
      slots.push({ at: i, spec: s })
      continue
    }
    const ps = refOf(it, opts.defaultTranslation)
    if (ps) {
      // Reference with nothing (or only another reference/heading) after it in this slide → fetch from the Bible.
      const next = seg.slice(i + 1).find((x) => x.kind !== 'notes')
      const pasted = next && (next.kind === 'para' || next.kind === 'quote' || next.kind === 'callout') && !refOf(next)
      if (!pasted) {
        const s = emptySpec(it.id)
        s.kind = 'scripture'
        s.fill = ps
        s.reference = formatReference(ps[0], { translation: true })
        s.blockIds.push(it.id)
        slots.push({ at: i, spec: s })
        continue
      }
      refs.push(runsText(it.runs).trim())
      if (textStarted < 0) textStarted = i
      text.body.push([{ text: runsText(it.runs).trim(), ref: true }])
      text.blockIds.push(it.id)
      continue
    }
    if (textStarted < 0) textStarted = i
    text.blockIds.push(it.id)
    if (it.kind === 'heading') {
      if (!text.title && !text.body.length) text.title = it.runs
      else text.body.push(it.level === 3 || text.title ? it.runs.map((r) => ({ ...r, bold: true })) : it.runs)
      continue
    }
    if (it.kind === 'bullet' || it.kind === 'number') {
      text.bullets = true
      const prefix = it.depth > 0 ? '   '.repeat(it.depth) + '– ' : it.kind === 'number' ? '' : '• '
      text.body.push(prefix ? [{ text: prefix }, ...it.runs] : it.runs)
      continue
    }
    if ((it.kind === 'quote' || it.kind === 'callout' || (it.kind === 'para' && isQuoteText(runsText(it.runs)) && !refs.length))) {
      hasQuote = true
      text.body.push(it.runs)
      const next = seg[i + 1]
      if (next && next.kind === 'para' && isAttribution(runsText(next.runs)) && !refOf(next)) {
        text.attribution = runsText(next.runs).replace(/^[—–-]\s*/, '')
        text.blockIds.push(next.id)
        i++
      }
      continue
    }
    text.body.push(it.runs)
  }
  if (text.title || text.body.length) {
    text.notes = []
    if (refs.length && !text.title) {
      text.kind = 'scripture'
      if (refs.length === 1 && text.body[0]?.[0]?.ref) { text.reference = refs[0]; text.body.shift() }
    } else if (hasQuote && !text.title && !refs.length) text.kind = 'quote'
    else if (text.title && !text.body.length) text.kind = 'title'
    else if (text.title) text.kind = text.bullets || text.body.length > 1 ? 'points' : 'point'
    else text.kind = text.bullets ? 'points' : 'text'
    if (reveal && text.bullets) text.reveal = true
    slots.push({ at: textStarted < 0 ? 0 : textStarted, spec: text })
  }
  slots.sort((a, b) => a.at - b.at)
  // Speaker notes + comments go on the first slide of the segment.
  if (slots[0]) slots[0].spec.notes = notes
  for (const { spec } of slots) out.push(spec)
  return out
}

/** Split an over-long scripture slide into pages at paragraph, then sentence boundaries. */
export function pageScripture(spec: SlideSpec, maxChars: number): SlideSpec[] {
  const len = (ps: Para[]): number => ps.reduce((s, p) => s + runsText(p).length + 1, 0)
  if (spec.kind !== 'scripture' || len(spec.body) <= maxChars * 1.3) return [spec]
  const pieces: Para[] = []
  for (const p of spec.body) {
    if (runsText(p).length <= maxChars) { pieces.push(p); continue }
    let cur: Run[] = [], n = 0
    for (const r of p) {
      for (const part of r.text.split(/(?<=[.;:!?”’"]\s)/)) {
        if (n && n + part.length > maxChars) { pieces.push(trimRuns(cur)); cur = []; n = 0 }
        cur.push({ ...r, text: part }); n += part.length
      }
    }
    if (cur.length) pieces.push(trimRuns(cur))
  }
  const pages: Para[][] = []
  let cur: Para[] = [], n = 0
  let lastRef: Para | null = null
  for (const p of pieces) {
    const l = runsText(p).length
    if (p[0]?.ref) {
      lastRef = p
      if (n > maxChars * 0.6) { pages.push(cur); cur = []; n = 0 }
      cur.push(p)
      continue
    }
    if (n && n + l > maxChars) { pages.push(cur); cur = lastRef ? [lastRef] : []; n = 0 }
    cur.push(p); n += l
  }
  pages.push(cur)
  return pages.filter((pg) => pg.some((p) => !p[0]?.ref)).map((body, i) => finish({ ...spec, key: i ? `${spec.key}#${i + 1}` : spec.key, body, notes: i ? [] : spec.notes, warnings: [...spec.warnings] }))
}

/* ───────────── announcements ───────────── */

function composeAnnouncement(seg: Item[], comments: Record<string, string[]>): SlideSpec {
  const s = emptySpec(seg[0].id)
  s.kind = 'announcement'
  let inDetails = false
  for (const it of seg.slice(1)) {
    s.blockIds.push(it.id)
    for (const c of comments[it.id] ?? []) s.notes.push(c)
    if (it.kind === 'notes') { s.notes.push(...(it.lines ?? [])); continue }
    if (it.kind === 'image' && !s.image) { s.image = { blockId: it.id, url: it.url!, name: it.name!, caption: it.caption }; continue }
    const t = runsText(it.runs).trim()
    const head = /^(heading|title|headline)\s*:\s*(.*)$/i.exec(t)
    if (head) { s.title = [{ text: head[2].trim() }]; inDetails = false; continue }
    if (/^(details?|body|copy|text)\s*:\s*(.*)$/i.test(t)) {
      inDetails = true
      const rest = /^\w+\s*:\s*(.*)$/.exec(t)?.[1]?.trim()
      if (rest) s.body.push([{ text: rest }])
      continue
    }
    if (it.kind === 'heading' && !s.title) { s.title = it.runs; continue }
    if (inDetails || it.depth > 0 || it.kind !== 'heading') s.body.push(it.runs.map((r) => ({ ...r, bold: false })))
  }
  return s
}

const normHead = (t: string): string => t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

function attachTalkingPoints(specs: SlideSpec[], tail: Item[]): void {
  // Sections start with a bold-only paragraph or a heading ("ANNUAL REPORT").
  const sections: { head: string; lines: string[] }[] = []
  for (const it of tail) {
    if (it.kind === 'notes') { sections[sections.length - 1]?.lines.push(...(it.lines ?? [])); continue }
    const t = runsText(it.runs).trim()
    if (!t) continue
    const boldOnly = it.runs.length > 0 && it.runs.every((r) => r.bold || !r.text.trim())
    if ((it.kind === 'heading' || (it.kind === 'para' && boldOnly)) && t.length < 80) { sections.push({ head: t, lines: [] }); continue }
    if (!sections.length) { if (/talking points?/i.test(t)) continue; sections.push({ head: '', lines: [] }) }
    sections[sections.length - 1].lines.push((it.kind === 'bullet' ? '• ' : '') + t)
  }
  for (const sec of sections) {
    const h = normHead(sec.head)
    const target = specs.find((s) => {
      const title = normHead(runsText(s.title ?? []))
      return h && title && (title.includes(h) || h.includes(title) || h.split(' ').filter((w) => w.length > 3 && title.includes(w)).length >= 2)
    }) ?? (sections.length === 1 ? specs[0] : undefined)
    if (target) target.notes.push(...sec.lines)
  }
}

/* ───────────── entry ───────────── */

export interface ConvertResult { specs: SlideSpec[]; mode: ConvertOptions['mode']; warnings: string[] }

export function blocksToSpecs(blocks: NBlock[], opts: ConvertOptions): ConvertResult {
  const warnings: string[] = []
  const items = flatten(blocks, { skipSynced: opts.skipSynced ?? true }, 0, [], warnings)
  const mode = decideMode(items, opts.mode)
  const { slides, tail } = segments(items, mode)
  const comments = opts.comments ?? {}
  let specs: SlideSpec[]
  if (mode === 'announcement') {
    specs = slides.map((seg) => composeAnnouncement(seg, comments))
    attachTalkingPoints(specs, tail)
  } else {
    specs = slides.flatMap((seg) => composeSegment(seg, opts, comments)).flatMap((s) => pageScripture(s, opts.maxChars ?? 340))
  }
  specs = specs.map(finish)
  for (const s of specs) {
    const chars = runsText(s.title ?? []).length + s.body.reduce((n, p) => n + runsText(p).length, 0)
    if (s.kind !== 'scripture' && chars > (opts.maxChars ?? 340) * 1.5) s.warnings.push('Lots of text on one slide — consider splitting it with a divider.')
  }
  // Keys must be unique (same block can't appear twice, but be safe).
  const seen = new Map<string, number>()
  for (const s of specs) { const n = seen.get(s.key) ?? 0; seen.set(s.key, n + 1); if (n) s.key = `${s.key}~${n}` }
  return { specs, mode, warnings }
}

export function specLabel(s: SlideSpec): string {
  const t = runsText(s.title ?? []).trim() || s.reference || (s.image ? s.image.caption ?? 'Image' : '') || runsText(s.body.find((p) => !p[0]?.ref) ?? []).trim()
  return t.length > 48 ? t.slice(0, 46) + '…' : t
}

export function specToDraft(s: SlideSpec): SlideDraft {
  const lines = [runsText(s.title ?? []), ...s.body.map(runsText)].filter(Boolean)
  return {
    key: s.key, srcHash: s.srcHash, kind: s.kind, label: specLabel(s),
    text: s.fill ? `${s.reference} — from the Bible` : s.image && !lines.length ? `[image] ${s.image.name}` : lines.join('\n') + (s.reference ? `\n— ${s.reference}` : '') + (s.attribution ? `\n— ${s.attribution}` : ''),
    notes: s.notes.length ? s.notes.join('\n') : undefined, warnings: s.warnings.length ? s.warnings : undefined
  }
}
