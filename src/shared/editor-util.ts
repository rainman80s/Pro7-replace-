/** Small helpers shared by the editor, themes and reflow code. */
import { nanoid } from 'nanoid'
import type { Paragraph, Slide, SlideElement, TextElement } from './model'

export const uid = (): string => nanoid(12)
export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
export const sameJson = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b)

export const isText = (e: SlideElement): e is TextElement => e.type === 'text'
/** Text a person typed (not a {token} box). */
export const isContentText = (e: SlideElement): e is TextElement => e.type === 'text' && !e.dynamic

const ROLE_PRIORITY = ['lyrics', 'body', 'title', 'reference', 'subtitle', 'caption', 'translation']

/** "The text" of a slide: the lyrics box if there is one, else body/title…, else the first text box. */
export function primaryText(elements: SlideElement[]): TextElement | undefined {
  const texts = elements.filter(isContentText)
  for (const role of ROLE_PRIORITY) {
    const t = texts.find((e) => e.role === role)
    if (t) return t
  }
  return texts.find((t) => !t.fromTheme) ?? texts[0]
}

export const paragraphsText = (ps: Paragraph[]): string => ps.map((p) => p.runs.map((r) => r.text).join('')).join('\n')

/**
 * Replace the text of an element, keeping its look: every new line takes the style/alignment of the
 * paragraph it replaces (or the last one). Lines that did not change keep their rich runs.
 */
export function setParagraphsText(old: Paragraph[], text: string): Paragraph[] {
  const lines = text.split('\n')
  return lines.map((line, i) => {
    const src = old[Math.min(i, old.length - 1)]
    if (src && i < old.length && src.runs.map((r) => r.text).join('') === line) return src
    const style = src?.runs.find((r) => r.style)?.style
    const uniform = src && src.runs.length === 1
    const p: Paragraph = { runs: [uniform && style ? { text: line, style } : { text: line }] }
    if (src?.align) p.align = src.align
    return p
  })
}

/** New ids for a slide and everything in it (duplicate / paste / new from template). */
export function reId<T extends SlideElement>(el: T): T {
  return { ...el, id: uid() }
}
export function cloneSlide(slide: Slide): Slide {
  const s = clone(slide)
  s.id = uid()
  s.elements = s.elements.map(reId)
  if (s.variants) for (const k of Object.keys(s.variants)) s.variants[k] = { ...s.variants[k], elements: s.variants[k].elements.map(reId) }
  if (s.actions) s.actions = s.actions.map((a) => ({ ...a, id: uid() }))
  delete s.hotKey
  return s
}
