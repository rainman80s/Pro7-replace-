/**
 * In-place rich text editing: a contenteditable that mirrors the Paragraph/TextRun model.
 * Typing is left to the browser and parsed back on every input; formatting never uses execCommand —
 * it is applied to the model (styleRange) and the DOM is rebuilt, so what you see is exactly what renders.
 */
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import type { Paragraph, TextElement, TextStyle } from '@shared/model'
import { measureAutoFit, textBoxStyles, textStyleCss } from '@shared/render/SlideView'
import { isCollapsed, normalizeParagraphs, rangeStyle, setParagraphAlign, styleRange, wholeRange, type TextPos, type TextRange } from '@shared/editor-richtext'
import { activeText, useEditor } from './store'

const UNITLESS = new Set(['lineHeight', 'fontWeight', 'opacity'])
function applyCss(node: HTMLElement, css: CSSProperties): void {
  for (const [k, v] of Object.entries(css)) {
    if (v === undefined || v === null) continue
    const value = typeof v === 'number' && !UNITLESS.has(k) ? `${v}px` : String(v)
    ;(node.style as unknown as Record<string, string>)[k === 'WebkitTextStroke' ? 'webkitTextStroke' : k] = value
  }
}

export function buildDom(root: HTMLElement, paragraphs: Paragraph[]): void {
  root.textContent = ''
  for (const p of paragraphs) {
    const div = document.createElement('div')
    div.dataset.p = '1'
    if (p.align) { div.dataset.align = p.align; div.style.textAlign = p.align }
    div.style.minHeight = '1em'
    let any = false
    for (const r of p.runs) {
      if (!r.text) continue
      any = true
      const span = document.createElement('span')
      span.dataset.s = r.style ? JSON.stringify(r.style) : ''
      if (r.style) applyCss(span, textStyleCss(r.style))
      span.textContent = r.text
      div.appendChild(span)
    }
    if (!any) div.appendChild(document.createElement('br'))
    root.appendChild(div)
  }
}

const isBlock = (n: Node): n is HTMLElement => n.nodeType === 1 && /^(DIV|P|LI|H[1-6])$/.test((n as HTMLElement).tagName)
const clean = (s: string): string => s.replace(/[​﻿]/g, '').replace(/ /g, ' ')

interface Probe { node: Node; offset: number }

/** DOM → model. Also maps DOM selection points (`probes`) to model positions. */
export function parseDom(root: HTMLElement, probes: Probe[] = []): { paragraphs: Paragraph[]; positions: (TextPos | null)[]; canonical: boolean } {
  const paragraphs: Paragraph[] = []
  const positions: (TextPos | null)[] = probes.map(() => null)
  let cur: Paragraph | null = null
  let canonical = root.childNodes.length > 0
  const len = (): number => (cur ? cur.runs.reduce((n, r) => n + r.text.length, 0) : 0)
  const start = (align?: string): void => {
    cur = { runs: [] }
    if (align) cur.align = align as Paragraph['align']
    paragraphs.push(cur)
  }
  const here = (): TextPos => {
    if (!cur) start()
    return { p: paragraphs.length - 1, o: len() }
  }
  const check = (node: Node, offset: number): void => {
    probes.forEach((pr, i) => { if (!positions[i] && pr.node === node && pr.offset === offset) positions[i] = here() })
  }
  const inline = (node: Node, style: TextStyle | undefined, align?: string): void => {
    if (node.nodeType === 3) {
      const raw = node.nodeValue ?? ''
      if (!cur) start(align)
      probes.forEach((pr, i) => {
        if (!positions[i] && pr.node === node) positions[i] = { p: paragraphs.length - 1, o: len() + clean(raw.slice(0, pr.offset)).length }
      })
      const lines = clean(raw).split('\n')
      lines.forEach((t, i) => {
        if (i > 0) start(align)
        if (t) cur!.runs.push(style ? { text: t, style } : { text: t })
      })
      return
    }
    if (node.nodeType !== 1) return
    const el = node as HTMLElement
    if (el.tagName === 'BR') {
      // A <br> with content after it is a line break; a trailing/only <br> is just Chrome's placeholder.
      let next: Node | null = el.nextSibling
      while (next && next.nodeType === 3 && !clean(next.nodeValue ?? '')) next = next.nextSibling
      if (next) { if (!cur) start(align); start(align) }
      return
    }
    let st = style
    if (el.dataset.s !== undefined) {
      try { st = el.dataset.s ? (JSON.parse(el.dataset.s) as TextStyle) : undefined } catch { st = style }
    }
    children(el, st, align)
  }
  const children = (el: HTMLElement, style: TextStyle | undefined, align?: string): void => {
    const kids = Array.from(el.childNodes)
    kids.forEach((k, i) => {
      check(el, i)
      if (isBlock(k)) {
        if (el !== root) canonical = false
        start(k.dataset.align ?? align)
        children(k, style, k.dataset.align ?? align)
        cur = null
      } else {
        if (el === root) canonical = false
        if (!cur) start(align)
        inline(k, style, align)
      }
    })
    check(el, kids.length)
  }
  children(root, undefined)
  if (!paragraphs.length) paragraphs.push({ runs: [{ text: '' }] })
  return { paragraphs: normalizeParagraphs(paragraphs), positions, canonical }
}

function domPoint(root: HTMLElement, pos: TextPos): Probe {
  const div = root.childNodes[Math.min(pos.p, root.childNodes.length - 1)]
  if (!div) return { node: root, offset: 0 }
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT)
  let left = pos.o
  let last: Text | null = null
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const l = n.nodeValue?.length ?? 0
    if (left <= l) return { node: n, offset: left }
    left -= l
    last = n
  }
  return last ? { node: last, offset: last.nodeValue?.length ?? 0 } : { node: div, offset: 0 }
}

function setDomRange(root: HTMLElement, range: TextRange): void {
  const sel = window.getSelection()
  if (!sel) return
  const a = domPoint(root, range.start)
  const b = domPoint(root, range.end)
  try { sel.setBaseAndExtent(a.node, a.offset, b.node, b.offset) } catch { /* detached */ }
}

function readRange(root: HTMLElement): TextRange | null {
  const sel = window.getSelection()
  if (!sel || !sel.anchorNode || !sel.focusNode || !root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null
  const { positions } = parseDom(root, [{ node: sel.anchorNode, offset: sel.anchorOffset }, { node: sel.focusNode, offset: sel.focusOffset }])
  if (!positions[0] || !positions[1]) return null
  return { start: positions[0], end: positions[1] }
}

export function TextEditor({ el, onChange }: { el: TextElement; onChange: (p: Paragraph[]) => void }): ReactNode {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const model = useRef<Paragraph[]>(el.paragraphs)
  const lastRange = useRef<TextRange | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const elRef = useRef(el)
  elRef.current = el

  const fit = (): void => {
    const o = outer.current
    const n = inner.current
    if (!o || !n) return
    const k = elRef.current.autoFit ? measureAutoFit(o, n, elRef.current.padding ?? 0) : 1
    n.style.transform = k !== 1 ? `scale(${k})` : ''
    n.style.width = k !== 1 ? `${100 / k}%` : '100%'
  }
  const publishSel = (): void => {
    const root = inner.current
    if (!root) return
    const r = readRange(root)
    if (!r) return
    lastRange.current = r
    useEditor.setState({ textSel: { style: rangeStyle(model.current, r), range: !isCollapsed(r) } })
  }
  const rebuild = (paragraphs: Paragraph[], range?: TextRange | null): void => {
    const root = inner.current
    if (!root) return
    model.current = paragraphs
    buildDom(root, paragraphs)
    if (range && document.activeElement === root) setDomRange(root, range)
    fit()
  }

  // Mount: build, focus, select all (so typing replaces placeholder text straight away).
  useLayoutEffect(() => {
    const root = inner.current
    if (!root) return
    buildDom(root, el.paragraphs)
    model.current = el.paragraphs
    fit()
    root.focus()
    const all = wholeRange(el.paragraphs)
    setDomRange(root, all)
    lastRange.current = all
    useEditor.setState({ textSel: { style: rangeStyle(el.paragraphs, all), range: !isCollapsed(all) } })
    const onSel = (): void => { if (document.activeElement === root) publishSel() }
    document.addEventListener('selectionchange', onSel)
    activeText.current = {
      applyStyle(patch) {
        const r = lastRange.current
        if (!r || isCollapsed(r)) return false
        const next = styleRange(model.current, r, patch)
        rebuild(next, r)
        onChangeRef.current(next)
        useEditor.setState({ textSel: { style: rangeStyle(next, r), range: true } })
        return true
      },
      setAlign(align) {
        const r = lastRange.current ?? wholeRange(model.current)
        const next = setParagraphAlign(model.current, r, align)
        rebuild(next, r)
        onChangeRef.current(next)
      },
      insertText(text) {
        root.focus()
        if (lastRange.current) setDomRange(root, lastRange.current)
        document.execCommand('insertText', false, text)
      },
      hasRange: () => !!lastRange.current && !isCollapsed(lastRange.current),
      range: () => lastRange.current
    }
    return () => {
      document.removeEventListener('selectionchange', onSel)
      activeText.current = null
      useEditor.setState({ textSel: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el.id])

  // Model changed from outside (undo/redo, inspector, linked text): refresh the DOM.
  useEffect(() => {
    if (JSON.stringify(el.paragraphs) !== JSON.stringify(model.current)) rebuild(el.paragraphs, lastRange.current)
    else fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el.paragraphs, el.style, el.frame.w, el.frame.h, el.autoFit, el.padding, el.align])

  const onInput = (): void => {
    const root = inner.current
    if (!root) return
    const sel = window.getSelection()
    const probes = sel?.focusNode && root.contains(sel.focusNode) ? [{ node: sel.focusNode, offset: sel.focusOffset }] : []
    const { paragraphs, positions, canonical } = parseDom(root, probes)
    model.current = paragraphs
    if (!canonical) {
      const pos = positions[0] ?? { p: paragraphs.length - 1, o: 0 }
      rebuild(paragraphs, { start: pos, end: pos })
    } else fit()
    onChangeRef.current(paragraphs)
    publishSel()
  }

  const st = textBoxStyles(el, 1)
  const innerStyle = { ...st.inner }
  delete innerStyle.transform
  delete innerStyle.width
  return (
    <div
      className="ed-textedit"
      style={{ position: 'absolute', left: el.frame.x, top: el.frame.y, width: el.frame.w, height: el.frame.h, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined, opacity: el.opacity ?? 1 }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div ref={outer} style={{ ...st.outer, overflow: 'visible' }}>
        <div
          ref={inner}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          data-text-editor={el.id}
          style={{ ...innerStyle, outline: 'none', userSelect: 'text', cursor: 'text', minWidth: '1em' }}
          onInput={onInput}
          onPaste={(e) => {
            e.preventDefault()
            const text = e.clipboardData.getData('text/plain').replace(/\r/g, '')
            document.execCommand('insertText', false, text)
          }}
          onDrop={(e) => e.preventDefault()}
        />
      </div>
    </div>
  )
}
