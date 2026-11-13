/**
 * A real RTF tokenizer + parser for the two dialects ProPresenter writes:
 *
 *  - macOS (Cocoa):   {\rtf1\ansi\ansicpg1252\cocoartf2761 … {\*\expandedcolortbl;;\cssrgb\c100000…;} … \f0\fs84 \cf2 Text\⏎More}
 *  - Windows (PP7):   {\rtf0\ansi\ansicpg1252{\fonttbl…}{\colortbl…}{\*\expandedcolortbl;\csgenericrgb\c…\c100000;}…\uc1 … \u539 ?text\par\pard…}
 *
 * plus generic RTF 1.x as produced by ProPresenter 4–6 (TextEdit / .NET RichTextBox).
 * It is deliberately tolerant: malformed input never throws, it just yields what could be read.
 * No dependencies; safe to run on untrusted bytes.
 */

export interface RtfColor {
  r: number
  g: number
  b: number
  /** 0..1 */
  a: number
}

export interface RtfRunStyle {
  font?: string
  /** Points (RTF \fs is half-points). */
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: RtfColor
  background?: RtfColor
  /** Raw \strokewidth value; interpretation depends on dialect (see strokeWidthPx). */
  strokeWidth?: number
  strokeColor?: RtfColor
  caps?: boolean
  smallCaps?: boolean
  /** Character spacing in points (\expnd is quarter-points, \expndtw / \kerning twips-ish). */
  kerning?: number
  superscript?: boolean
  subscript?: boolean
}

export interface RtfRun {
  text: string
  style: RtfRunStyle
}

export interface RtfParagraph {
  runs: RtfRun[]
  align?: 'left' | 'center' | 'right' | 'justify'
  /** Line height multiple when the paragraph uses \slmult1. */
  lineHeight?: number
}

export interface RtfDocument {
  dialect: 'cocoa' | 'windows' | 'generic'
  paragraphs: RtfParagraph[]
  fonts: Record<number, string>
  colors: (RtfColor | null)[]
  /** Text with paragraphs joined by \n. */
  plain: string
  /** Non-fatal problems (unbalanced braces, undecodable bytes…). */
  warnings: string[]
}

/* ───────────────────────────── tokenizer ───────────────────────────── */

type Token =
  | { t: '{' }
  | { t: '}' }
  | { t: 'w'; word: string; param: number | null }
  | { t: 's'; sym: string }
  | { t: 'h'; byte: number }
  | { t: 'x'; text: string }

/** Tokenise RTF source (a latin1 / binary string: one char per byte). */
export function tokenizeRtf(src: string): Token[] {
  const out: Token[] = []
  const n = src.length
  let i = 0
  let text = ''
  const flush = (): void => { if (text) { out.push({ t: 'x', text }); text = '' } }
  while (i < n) {
    const c = src[i]
    if (c === '{') { flush(); out.push({ t: '{' }); i++; continue }
    if (c === '}') { flush(); out.push({ t: '}' }); i++; continue }
    if (c === '\r' || c === '\n' || c === '\0') { i++; continue } // raw line breaks are not content
    if (c !== '\\') { text += c; i++; continue }
    // control
    flush()
    i++
    if (i >= n) break
    const d = src[i]
    if ((d >= 'a' && d <= 'z') || (d >= 'A' && d <= 'Z')) {
      let j = i
      while (j < n && ((src[j] >= 'a' && src[j] <= 'z') || (src[j] >= 'A' && src[j] <= 'Z')) && j - i < 32) j++
      const word = src.slice(i, j)
      let param: number | null = null
      let k = j
      if (k < n && (src[k] === '-' || (src[k] >= '0' && src[k] <= '9'))) {
        const neg = src[k] === '-'
        if (neg) k++
        let digits = ''
        while (k < n && src[k] >= '0' && src[k] <= '9' && digits.length < 10) digits += src[k++]
        if (digits) param = (neg ? -1 : 1) * parseInt(digits, 10)
        else k = j // a lone '-' is text, not a parameter
      }
      if (k < n && src[k] === ' ') k++ // the delimiter space belongs to the control word
      out.push({ t: 'w', word, param })
      i = k
      // \binN: skip N raw bytes
      if (word === 'bin' && param && param > 0) i = Math.min(n, i + param)
      continue
    }
    if (d === "'") {
      const hex = src.slice(i + 1, i + 3)
      const byte = parseInt(hex, 16)
      if (/^[0-9a-fA-F]{2}$/.test(hex)) { out.push({ t: 'h', byte }); i += 3 } else i += 1
      continue
    }
    // control symbol (includes "\" + newline = paragraph break in Cocoa RTF)
    out.push({ t: 's', sym: d })
    i++
  }
  flush()
  return out
}

/* ───────────────────────────── code pages ───────────────────────────── */

const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ'

const CHARSET_TO_CP: Record<number, number> = {
  0: 1252, 1: 0, 2: 42, 77: 10000, 78: 10001, 79: 10003, 80: 10008, 81: 10002, 83: 10005, 84: 10004, 85: 10006, 86: 10081, 87: 10021,
  88: 10029, 89: 10007, 128: 932, 129: 949, 130: 1361, 134: 936, 136: 950, 161: 1253, 162: 1254, 163: 1258, 177: 1255, 178: 1256,
  186: 1257, 204: 1251, 222: 874, 238: 1250, 254: 437, 255: 850
}
const CP_LABEL: Record<number, string> = {
  1250: 'windows-1250', 1251: 'windows-1251', 1253: 'windows-1253', 1254: 'windows-1254', 1255: 'windows-1255', 1256: 'windows-1256',
  1257: 'windows-1257', 1258: 'windows-1258', 874: 'windows-874', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5',
  10000: 'macintosh', 65001: 'utf-8', 28591: 'iso-8859-1', 866: 'ibm866', 10007: 'x-mac-cyrillic'
}
const decoders = new Map<number, TextDecoder | null>()

export function decodeCodepage(bytes: number[], cp: number): string {
  if (cp === 1252 || cp === 0 || !cp) {
    let s = ''
    for (const b of bytes) s += b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b)
    return s
  }
  let dec = decoders.get(cp)
  if (dec === undefined) {
    try { dec = CP_LABEL[cp] ? new TextDecoder(CP_LABEL[cp]) : null } catch { dec = null }
    decoders.set(cp, dec)
  }
  if (!dec) return decodeCodepage(bytes, 1252)
  return dec.decode(Uint8Array.from(bytes))
}

/* ───────────────────────────── parser ───────────────────────────── */

interface CharState {
  f: number | null
  fs: number | null
  b: boolean
  i: boolean
  ul: boolean
  strike: boolean
  cf: number
  cb: number
  sw: number | null
  sc: number
  caps: boolean
  scaps: boolean
  kern: number
  sup: boolean
  sub: boolean
  uc: number
  dest: 'body' | 'skip' | 'fonttbl' | 'colortbl' | 'xcolortbl'
}

const SKIP_DESTINATIONS = new Set([
  'info', 'stylesheet', 'pict', 'object', 'header', 'footer', 'headerl', 'headerr', 'headerf', 'footerl', 'footerr', 'footerf',
  'footnote', 'listtable', 'listoverridetable', 'generator', 'filetbl', 'revtbl', 'rsidtbl', 'themedata', 'colorschememapping',
  'latentstyles', 'datastore', 'fldinst', 'xmlnstbl', 'mmathPr', 'pgdsctbl', 'operator', 'author', 'title', 'subject', 'keywords',
  'comment', 'doccomm', 'company', 'category', 'manager', 'nonshppict', 'shpinst', 'pntext', 'listtext', 'bkmkstart', 'bkmkend',
  'tc', 'xe', 'private', 'userprops', 'wgrffmtfilter', 'falt', 'panose', 'fname', 'fontemb', 'fontfile'
])

const SPECIAL_CHARS: Record<string, string> = {
  tab: '\t', emdash: '—', endash: '–', emspace: ' ', enspace: ' ', qmspace: ' ', bullet: '•',
  lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', zwj: '\u200D', zwnj: '\u200C', ltrmark: '', rtlmark: ''
}

export function parseRtf(input: Uint8Array | string): RtfDocument {
  const src = typeof input === 'string' ? input : latin1(input)
  const warnings: string[] = []
  const doc: RtfDocument = { dialect: 'generic', paragraphs: [], fonts: {}, colors: [], plain: '', warnings }
  if (!/^\s*\{\\rtf/.test(src)) {
    if (src.trim()) {
      // Not RTF at all — treat as plain text so callers still get the words.
      warnings.push('not RTF; treated as plain text')
      const decoded = typeof input === 'string' ? src : new TextDecoder('utf-8', { fatal: false }).decode(input)
      doc.paragraphs = decoded.replace(/\r\n?/g, '\n').split('\n').map((line) => ({ runs: line ? [{ text: line, style: {} }] : [] }))
      doc.plain = doc.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n')
    }
    return doc
  }
  if (src.includes('\\cocoartf')) doc.dialect = 'cocoa'
  else if (/^\s*\{\\rtf0/.test(src) || src.includes('\\csgenericrgb')) doc.dialect = 'windows'

  const tokens = tokenizeRtf(src)
  let ansicpg = 1252
  let deff: number | null = null
  const fontCp: Record<number, number> = {}
  const colortbl: (RtfColor | null)[] = []
  const xcolortbl: (RtfColor | null | undefined)[] = []

  const initial: CharState = {
    f: null, fs: null, b: false, i: false, ul: false, strike: false, cf: 0, cb: 0, sw: null, sc: 0, caps: false, scaps: false,
    kern: 0, sup: false, sub: false, uc: 1, dest: 'body'
  }
  let st: CharState = { ...initial }
  const stack: CharState[] = []

  // paragraph state
  let align: RtfParagraph['align']
  let sl = 0
  let slmult = 0
  let para: RtfParagraph = { runs: [] }
  const paragraphs: RtfParagraph[] = []
  const paraProps = (): void => {
    para.align = align
    if (slmult === 1 && sl > 0) para.lineHeight = Math.round((sl / 240) * 1000) / 1000
  }
  const endParagraph = (): void => {
    flushBytes()
    paraProps()
    paragraphs.push(para)
    para = { runs: [] }
  }

  // pending text assembly
  let pendingBytes: number[] = []
  let skip = 0 // fallback chars to skip after \uN
  let pendingHigh = 0 // high surrogate waiting for its pair

  // font / colour table builders
  let fontNum: number | null = null
  let fontName = ''
  let fontDepth = 0
  let color: { r: number; g: number; b: number; any: boolean } = { r: 0, g: 0, b: 0, any: false }
  let xc: { space: string; comps: number[] } = { space: '', comps: [] }

  const styleOf = (s: CharState): RtfRunStyle => {
    const o: RtfRunStyle = {}
    const f = s.f ?? deff
    if (f !== null && doc.fonts[f] !== undefined) o.font = doc.fonts[f]
    if (s.fs !== null) o.fontSize = s.fs / 2
    if (s.b) o.bold = true
    if (s.i) o.italic = true
    if (s.ul) o.underline = true
    if (s.strike) o.strike = true
    const col = colorAt(s.cf)
    if (col) o.color = col
    const bg = colorAt(s.cb)
    if (bg && bg.a > 0) o.background = bg
    if (s.sw) {
      o.strokeWidth = s.sw
      const sc = colorAt(s.sc)
      if (sc) o.strokeColor = sc
    }
    if (s.caps) o.caps = true
    if (s.scaps) o.smallCaps = true
    if (s.kern) o.kerning = s.kern
    if (s.sup) o.superscript = true
    if (s.sub) o.subscript = true
    return o
  }
  const colorAt = (idx: number): RtfColor | undefined => {
    if (!idx) return undefined
    const x = xcolortbl[idx]
    if (x) return x
    return colortbl[idx] ?? undefined
  }
  const sameStyle = (a: RtfRunStyle, b: RtfRunStyle): boolean => JSON.stringify(a) === JSON.stringify(b)

  const emit = (text: string): void => {
    if (!text) return
    if (pendingHigh) { pendingHigh = 0; text = '\uFFFD' + text } // lone high surrogate
    if (st.dest === 'fonttbl') { fontName += text; return }
    if (st.dest !== 'body') return
    // U+2028 / U+2029 are Cocoa's line / paragraph separators
    const parts = text.split(/[\u2028\u2029\n]/)
    for (let p = 0; p < parts.length; p++) {
      if (p > 0) endParagraph()
      const piece = parts[p]
      if (!piece) continue
      const style = styleOf(st)
      const last = para.runs[para.runs.length - 1]
      if (last && sameStyle(last.style, style)) last.text += piece
      else para.runs.push({ text: piece, style })
    }
  }
  const currentCp = (): number => {
    const f = st.f ?? deff
    if (f !== null && fontCp[f]) return fontCp[f]
    return ansicpg
  }
  function flushBytes(): void {
    if (!pendingBytes.length) return
    const bytes = pendingBytes
    pendingBytes = []
    emit(decodeCodepage(bytes, currentCp()))
  }
  const finishFont = (): void => {
    if (fontNum !== null) {
      const name = fontName.replace(/;\s*$/, '').trim()
      if (name || doc.fonts[fontNum] === undefined) doc.fonts[fontNum] = name
    }
    fontNum = null
    fontName = ''
  }
  const finishXColor = (): void => {
    const c = xc.comps.map((v) => Math.max(0, Math.min(1, v / 100000)))
    let col: RtfColor | undefined
    if (xc.space === 'csgray' || xc.space === 'csgenericgray') {
      if (c.length >= 1) col = { r: to255(c[0]), g: to255(c[0]), b: to255(c[0]), a: c[1] ?? 1 }
    } else if (xc.space) {
      if (c.length >= 3) col = { r: to255(c[0]), g: to255(c[1]), b: to255(c[2]), a: c[3] ?? 1 }
    }
    xcolortbl.push(col) // undefined = "use \colortbl entry"
    xc = { space: '', comps: [] }
  }

  let depth = 0
  for (let ti = 0; ti < tokens.length; ti++) {
    const tok = tokens[ti]
    switch (tok.t) {
      case '{': {
        flushBytes()
        stack.push({ ...st })
        depth++
        // Ignorable destination: {\*\word …}
        const n1 = tokens[ti + 1]
        const n2 = tokens[ti + 2]
        if (n1 && n1.t === 's' && n1.sym === '*') {
          if (n2 && n2.t === 'w' && n2.word === 'expandedcolortbl') { st.dest = 'xcolortbl'; ti += 2; xc = { space: '', comps: [] } }
          else { st.dest = 'skip'; ti += 1 }
        } else if (st.dest === 'fonttbl') {
          fontDepth++
        }
        break
      }
      case '}': {
        flushBytes()
        if (st.dest === 'fonttbl') {
          if (fontDepth > 0) { fontDepth--; if (fontDepth === 0) finishFont() } else finishFont()
        }
        const prev = stack.pop()
        if (prev) st = prev
        else warnings.push('unbalanced }')
        depth--
        break
      }
      case 'h': {
        if (skip > 0) { skip--; break }
        if (st.dest === 'body' || st.dest === 'fonttbl') pendingBytes.push(tok.byte)
        break
      }
      case 'x': {
        let text = tok.text
        if (skip > 0) {
          const k = Math.min(skip, text.length)
          text = text.slice(k)
          skip -= k
          if (!text) break
        }
        if (st.dest === 'colortbl') {
          for (const ch of text) if (ch === ';') { colortbl.push(color.any ? { r: color.r, g: color.g, b: color.b, a: 1 } : null); color = { r: 0, g: 0, b: 0, any: false } }
          break
        }
        if (st.dest === 'xcolortbl') {
          for (const ch of text) if (ch === ';') finishXColor()
          break
        }
        if (st.dest === 'fonttbl') {
          flushBytes()
          const semi = text.indexOf(';')
          if (semi >= 0) { fontName += text.slice(0, semi); if (fontDepth === 0) finishFont() } else fontName += text
          break
        }
        if (st.dest !== 'body') break
        // text bytes ≥ 0x80 that were not escaped: decode with the current code page
        if (/[\x80-\xff]/.test(text)) {
          for (let k = 0; k < text.length; k++) pendingBytes.push(text.charCodeAt(k) & 0xff)
          break
        }
        flushBytes()
        emit(text)
        break
      }
      case 's': {
        if (skip > 0 && tok.sym !== '\n' && tok.sym !== '\r') { skip--; break }
        if (st.dest !== 'body') break
        switch (tok.sym) {
          case '\n': case '\r': endParagraph(); break
          case '~': flushBytes(); emit('\u00A0'); break
          case '_': flushBytes(); emit('\u2011'); break
          case '-': break // optional hyphen
          case '\\': case '{': case '}': flushBytes(); emit(tok.sym); break
          case '*': break
          default: break
        }
        break
      }
      case 'w': {
        const { word, param } = tok
        const on = param !== 0
        if (word === 'u') {
          if (st.dest !== 'body' && st.dest !== 'fonttbl') { skip = st.uc; break }
          if (pendingBytes.length) flushBytes()
          let code = param ?? 0
          if (code < 0) code += 65536
          if (code >= 0xd800 && code <= 0xdbff) {
            if (pendingHigh) { pendingHigh = 0; emit('\uFFFD') }
            pendingHigh = code
          } else if (code >= 0xdc00 && code <= 0xdfff) {
            if (pendingHigh) { const hi = pendingHigh; pendingHigh = 0; emit(String.fromCharCode(hi, code)) } else emit('\uFFFD')
          } else {
            emit(String.fromCodePoint(code))
          }
          skip = st.uc
          break
        }
        if (skip > 0) { skip--; break } // a control word counts as one fallback "character"
        flushBytes()
        // destinations
        if (SKIP_DESTINATIONS.has(word)) { st.dest = 'skip'; break }
        if (word === 'fonttbl') { st.dest = 'fonttbl'; fontDepth = 0; fontNum = null; fontName = ''; break }
        if (word === 'colortbl') { st.dest = 'colortbl'; color = { r: 0, g: 0, b: 0, any: false }; break }
        if (st.dest === 'fonttbl') {
          if (word === 'f') { if (fontDepth === 0 && fontNum !== null) finishFont(); fontNum = param ?? 0 }
          else if (word === 'fcharset' && fontNum !== null && param !== null) { const cp = CHARSET_TO_CP[param]; if (cp) fontCp[fontNum] = cp }
          else if (word === 'cpg' && fontNum !== null && param) fontCp[fontNum] = param
          break
        }
        if (st.dest === 'colortbl') {
          if (word === 'red') { color.r = clamp255(param); color.any = true }
          else if (word === 'green') { color.g = clamp255(param); color.any = true }
          else if (word === 'blue') { color.b = clamp255(param); color.any = true }
          break
        }
        if (st.dest === 'xcolortbl') {
          if (word === 'c') xc.comps.push(param ?? 0)
          else if (word.startsWith('cs')) xc.space = word
          break
        }
        if (st.dest === 'skip') break
        switch (word) {
          case 'ansicpg': if (param) ansicpg = param; break
          case 'mac': ansicpg = 10000; break
          case 'pc': ansicpg = 437; break
          case 'pca': ansicpg = 850; break
          case 'deff': deff = param; break
          case 'uc': st.uc = Math.max(0, param ?? 1); break
          case 'par': case 'line': case 'sect': case 'page': case 'row': endParagraph(); break
          case 'pard': align = undefined; sl = 0; slmult = 0; break
          case 'plain': st = { ...initial, uc: st.uc, dest: st.dest, f: st.f }; break
          case 'ql': align = 'left'; break
          case 'qc': align = 'center'; break
          case 'qr': align = 'right'; break
          case 'qj': case 'qd': align = 'justify'; break
          case 'sl': sl = Math.abs(param ?? 0); break
          case 'slmult': slmult = param ?? 0; break
          case 'f': st.f = param; break
          case 'fs': st.fs = param; break
          case 'b': st.b = on; break
          case 'i': st.i = on; break
          case 'ul': case 'uld': case 'uldb': case 'ulw': case 'ulth': case 'uldash': case 'ulwave': st.ul = on; break
          case 'ulnone': st.ul = false; break
          case 'strike': case 'striked': st.strike = on; break
          case 'cf': st.cf = param ?? 0; break
          case 'cb': case 'highlight': case 'chcbpat': st.cb = param ?? 0; break
          case 'strokewidth': st.sw = param; break
          case 'strokec': st.sc = param ?? 0; break
          case 'outl': if (doc.dialect !== 'cocoa' && doc.dialect !== 'windows' && on && !st.sw) st.sw = 0; break
          case 'caps': st.caps = on; break
          case 'scaps': st.scaps = on; break
          case 'expnd': st.kern = (param ?? 0) / 4; break
          case 'expndtw': st.kern = (param ?? 0) / 20; break
          case 'super': st.sup = true; st.sub = false; break
          case 'sub': st.sub = true; st.sup = false; break
          case 'nosupersub': st.sup = false; st.sub = false; break
          case 'up': st.sup = (param ?? 0) > 0; break
          case 'dn': st.sub = (param ?? 0) > 0; break
          default:
            if (word in SPECIAL_CHARS) emit(SPECIAL_CHARS[word])
        }
        break
      }
    }
  }
  flushBytes()
  if (depth !== 0) warnings.push('unbalanced braces')
  if (para.runs.length) { paraProps(); paragraphs.push(para) } else if (paragraphs.length) { /* trailing empty paragraph: drop */ }
  // Drop trailing empty paragraphs (both dialects end with a dangling break).
  while (paragraphs.length && !paragraphs[paragraphs.length - 1].runs.some((r) => r.text)) paragraphs.pop()
  doc.paragraphs = paragraphs
  doc.colors = colortbl.map((c, i) => xcolortbl[i] ?? c)
  doc.plain = paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n')
  return doc
}

/** Stroke width in pixels (slide units) for a run, given the dialect's meaning of \strokewidth. */
export function strokeWidthPx(dialect: RtfDocument['dialect'], raw: number | undefined, fontSizePt: number | undefined): number {
  if (!raw) return 0
  // ProPresenter for Windows writes points × 20. Cocoa writes percent-of-font-size × 20 (negative = stroke + fill).
  if (dialect === 'windows') return Math.abs(raw) / 20
  return (Math.abs(raw) / 20 / 100) * (fontSizePt ?? 12)
}

export function rtfColorToCss(c: RtfColor | undefined | null): string | undefined {
  if (!c) return undefined
  const hex = '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
  return c.a >= 0.999 ? hex : `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(c.a * 1000) / 1000})`
}

/** Extract only the text (fast path for search/indexing and Pro6 fallbacks). */
export function rtfToPlainText(input: Uint8Array | string): string {
  return parseRtf(input).plain
}

function latin1(bytes: Uint8Array): string {
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH) as unknown as number[])
  return s
}
const to255 = (v: number): number => Math.round(v * 255)
const clamp255 = (v: number | null): number => Math.max(0, Math.min(255, v ?? 0))

/* ───────────────────────────── writer (for exports) ───────────────────────────── */

/** Escape text for inclusion in RTF (Unicode-safe). */
export function escapeRtfText(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const code = text.charCodeAt(i)
    if (ch === '\\' || ch === '{' || ch === '}') out += '\\' + ch
    else if (ch === '\n') out += '\\\n'
    else if (ch === '\t') out += '\\tab '
    else if (code < 0x80) out += ch
    else out += `\\uc0\\u${code > 32767 ? code - 65536 : code} `
  }
  return out
}
