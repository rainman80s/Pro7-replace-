/** Pure rich-text operations on the Paragraph/TextRun model (used by the in-place text editor). */
import type { Paragraph, TextRun, TextStyle } from './model'

export interface TextPos { p: number; o: number }
export interface TextRange { start: TextPos; end: TextPos }

export function cleanStyle(s: TextStyle | undefined): TextStyle | undefined {
  if (!s) return undefined
  const o: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s)) if (v !== undefined && v !== null && v !== '') o[k] = v
  return Object.keys(o).length ? (o as TextStyle) : undefined
}
const styleKey = (s?: TextStyle): string => (s ? JSON.stringify(Object.entries(s).sort(([a], [b]) => a.localeCompare(b))) : '')

/** Merge neighbouring runs with the same style and drop empty runs (each paragraph keeps ≥ 1 run). */
export function normalizeParagraphs(ps: Paragraph[]): Paragraph[] {
  const out = ps.map((p) => {
    const runs: TextRun[] = []
    for (const r of p.runs) {
      const style = cleanStyle(r.style)
      const last = runs[runs.length - 1]
      if (!r.text && p.runs.length > 1) continue
      if (last && styleKey(last.style) === styleKey(style)) last.text += r.text
      else runs.push(style ? { text: r.text, style } : { text: r.text })
    }
    if (!runs.length) runs.push({ text: '' })
    const np: Paragraph = { runs }
    if (p.align) np.align = p.align
    return np
  })
  return out.length ? out : [{ runs: [{ text: '' }] }]
}

const paraLen = (p: Paragraph): number => p.runs.reduce((n, r) => n + r.text.length, 0)

export function orderRange(r: TextRange): TextRange {
  const { start: a, end: b } = r
  return a.p < b.p || (a.p === b.p && a.o <= b.o) ? r : { start: b, end: a }
}
export const isCollapsed = (r: TextRange): boolean => r.start.p === r.end.p && r.start.o === r.end.o
export function wholeRange(ps: Paragraph[]): TextRange {
  return { start: { p: 0, o: 0 }, end: { p: ps.length - 1, o: paraLen(ps[ps.length - 1]) } }
}

/** Apply a style patch to a range (undefined values remove that override). */
export function styleRange(ps: Paragraph[], range: TextRange, patch: Partial<TextStyle>): Paragraph[] {
  const { start, end } = orderRange(range)
  const out = ps.map((p, pi) => {
    if (pi < start.p || pi > end.p) return p
    const from = pi === start.p ? start.o : 0
    const to = pi === end.p ? end.o : Infinity
    const runs: TextRun[] = []
    let pos = 0
    for (const r of p.runs) {
      const a = pos
      const b = pos + r.text.length
      pos = b
      const s = Math.max(a, from)
      const e = Math.min(b, to)
      if (s >= e && !(r.text.length === 0 && from <= a && to >= b)) { runs.push(r); continue }
      if (s > a) runs.push({ ...r, text: r.text.slice(0, s - a) })
      const style = cleanStyle({ ...r.style, ...patch })
      runs.push(style ? { text: r.text.slice(s - a, e - a), style } : { text: r.text.slice(s - a, e - a) })
      if (e < b) runs.push({ ...r, text: r.text.slice(e - a) })
    }
    return { ...p, runs }
  })
  return normalizeParagraphs(out)
}

/** Style values shared by every run in the range ('mixed' keys are left out). Collapsed = the run at the caret. */
export function rangeStyle(ps: Paragraph[], range: TextRange): TextStyle {
  const { start, end } = orderRange(range)
  const collapsed = isCollapsed(range)
  const styles: (TextStyle | undefined)[] = []
  ps.forEach((p, pi) => {
    if (pi < start.p || pi > end.p) return
    const from = pi === start.p ? start.o : 0
    const to = pi === end.p ? end.o : Infinity
    let pos = 0
    for (const r of p.runs) {
      const a = pos
      const b = pos + r.text.length
      pos = b
      if (collapsed ? from > a - (a === 0 ? 1 : 0) && from <= b : Math.max(a, from) < Math.min(b, to)) styles.push(r.style)
    }
  })
  if (!styles.length) return {}
  const first = styles[0] ?? {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(first)) {
    if (styles.every((s) => JSON.stringify((s as Record<string, unknown> | undefined)?.[k]) === JSON.stringify(v))) out[k] = v
  }
  return out as TextStyle
}

export function setParagraphAlign(ps: Paragraph[], range: TextRange, align: Paragraph['align'] | undefined): Paragraph[] {
  const { start, end } = orderRange(range)
  return ps.map((p, i) => {
    if (i < start.p || i > end.p) return p
    const n = { ...p }
    if (align) n.align = align
    else delete n.align
    return n
  })
}

/** Remove per-run overrides for the given keys everywhere (when the box-level style changes). */
export function clearRunOverrides(ps: Paragraph[], keys: (keyof TextStyle)[]): Paragraph[] {
  let touched = false
  const out = ps.map((p) => ({
    ...p,
    runs: p.runs.map((r) => {
      if (!r.style || !keys.some((k) => k in r.style!)) return r
      touched = true
      const s = { ...r.style }
      for (const k of keys) delete s[k]
      const c = cleanStyle(s)
      return c ? { text: r.text, style: c } : { text: r.text }
    })
  }))
  return touched ? normalizeParagraphs(out) : ps
}
