import { describe, expect, it } from 'vitest'
import { decodeCodepage, escapeRtfText, parseRtf, rtfColorToCss, strokeWidthPx, tokenizeRtf } from '@main/services/importers/rtf/rtf'

const COCOA = String.raw`{\rtf1\ansi\ansicpg1252\cocoartf2761
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fnil\fcharset0 HelveticaNeue;\f1\fswiss\fcharset0 Arial-BoldMT;}
{\colortbl;\red255\green255\blue255;\red255\green255\blue255;\red255\green0\blue0;}
{\*\expandedcolortbl;;\cssrgb\c100000\c100000\c100000;\cssrgb\c100000\c0\c0\c50000;}
\deftab1680
\pard\pardeftab1680\pardirnatural\qc\partightenfactor0

\f0\fs84 \cf2 And I will call upon Your name\
And keep my eyes \f1\b above\f0\b0  the waves\
\pard\qr
\cf3 \outl0\strokewidth-40 \strokec2 Caf\'e9 \uc0@U@8364  \u-10179 \u-8704 }`.replaceAll('@U@', '\\u')

const WINDOWS = String.raw`{\rtf0\ansi\ansicpg1252{\fonttbl\f0\fnil Helvetica;}{\colortbl;\red255\green255\blue255;\red151\green238\blue21;\red255\green255\blue255;\red0\green0\blue0;}{\*\expandedcolortbl;\csgenericrgb\c100000\c100000\c100000\c100000;\csgenericrgb\c59215\c93333\c8235\c100000;\csgenericrgb\c100000\c100000\c100000\c0;\csgenericrgb\c0\c0\c0\c100000;}{\*\listtable}{\*\listoverridetable}\uc1\paperw12240\margl0\margr0\margt0\margb0\pard\li0\fi0\ri0\qc\sb0\sa0\sl240\slmult1\slleading0\f0\b0\i0\ul0\strike0\fs140\expnd0\expndtw0\cf1\strokewidth100\strokec2\nosupersub\ulc0\highlight3\cb3 two \u539 ?text\par\pard\li0\fi0\ri0\ql\sb0\sa0\sl360\slmult1\slleading0\f0\b\i\ul\strike0\fs140\expnd0\expndtw0\cf4\strokewidth0\strokec2\nosupersub\ulc0\highlight3\cb3 line \{2\} \\ end\par\pard\li0\fi0\ri0\qc\f0\fs140\cf4}`

describe('RTF tokenizer', () => {
  it('splits control words, parameters, symbols, hex escapes and groups', () => {
    const t = tokenizeRtf(String.raw`{\rtf1\fs-84 a\'e9\~b\
c}`)
    expect(t[0]).toEqual({ t: '{' })
    expect(t[1]).toEqual({ t: 'w', word: 'rtf', param: 1 })
    expect(t[2]).toEqual({ t: 'w', word: 'fs', param: -84 })
    expect(t[3]).toEqual({ t: 'x', text: 'a' })
    expect(t[4]).toEqual({ t: 'h', byte: 0xe9 })
    expect(t[5]).toEqual({ t: 's', sym: '~' })
    expect(t[6]).toEqual({ t: 'x', text: 'b' })
    expect(t[7]).toEqual({ t: 's', sym: '\n' })
    expect(t[8]).toEqual({ t: 'x', text: 'c' })
    expect(t[9]).toEqual({ t: '}' })
  })
  it('consumes exactly one delimiter space after a control word', () => {
    const t = tokenizeRtf(String.raw`\b  x`)
    expect(t).toEqual([{ t: 'w', word: 'b', param: null }, { t: 'x', text: ' x' }])
  })
})

describe('RTF parser — macOS (Cocoa) dialect', () => {
  const doc = parseRtf(COCOA)
  it('detects the dialect and reads fonts + colours', () => {
    expect(doc.dialect).toBe('cocoa')
    expect(doc.fonts).toEqual({ 0: 'HelveticaNeue', 1: 'Arial-BoldMT' })
    expect(rtfColorToCss(doc.colors[2])).toBe('#FFFFFF')
    expect(rtfColorToCss(doc.colors[3])).toBe('rgba(255, 0, 0, 0.5)') // alpha from \expandedcolortbl
  })
  it('treats backslash-newline as a line break and keeps run styles', () => {
    expect(doc.plain).toBe('And I will call upon Your name\nAnd keep my eyes above the waves\nCafé € 😀')
    expect(doc.paragraphs).toHaveLength(3)
    expect(doc.paragraphs[0].align).toBe('center')
    expect(doc.paragraphs[2].align).toBe('right')
    const p2 = doc.paragraphs[1].runs
    expect(p2.map((r) => r.text)).toEqual(['And keep my eyes ', 'above', ' the waves'])
    expect(p2[0].style).toMatchObject({ font: 'HelveticaNeue', fontSize: 42 })
    expect(p2[1].style).toMatchObject({ font: 'Arial-BoldMT', bold: true })
    expect(p2[2].style.bold).toBeUndefined()
  })
  it('reads stroke (percent of font size) and \\uN with \\uc0, incl. surrogate pairs', () => {
    const run = doc.paragraphs[2].runs[0]
    expect(run.style.strokeWidth).toBe(-40)
    expect(strokeWidthPx('cocoa', run.style.strokeWidth, run.style.fontSize)).toBeCloseTo(0.84, 2)
    expect(rtfColorToCss(run.style.strokeColor)).toBe('#FFFFFF')
    expect(rtfColorToCss(run.style.color)).toBe('rgba(255, 0, 0, 0.5)')
  })
})

describe('RTF parser — Windows ProPresenter dialect', () => {
  const doc = parseRtf(WINDOWS)
  it('detects the dialect, skips \\uN fallback chars and drops the dangling last paragraph', () => {
    expect(doc.dialect).toBe('windows')
    expect(doc.plain).toBe('two țtext\nline {2} \\ end')
    expect(doc.paragraphs).toHaveLength(2)
  })
  it('reads csgenericrgb colours with alpha, alignment, line height and stroke in points×20', () => {
    const [a, b] = doc.paragraphs
    expect(a.align).toBe('center')
    expect(a.lineHeight).toBe(1)
    expect(b.align).toBe('left')
    expect(b.lineHeight).toBe(1.5)
    expect(a.runs[0].style).toMatchObject({ font: 'Helvetica', fontSize: 70, strokeWidth: 100 })
    expect(strokeWidthPx('windows', 100, 70)).toBe(5)
    expect(rtfColorToCss(a.runs[0].style.color)).toBe('#FFFFFF')
    expect(rtfColorToCss(a.runs[0].style.strokeColor)).toBe('#97EE15')
    expect(a.runs[0].style.background).toBeUndefined() // highlight colour has alpha 0
    expect(b.runs[0].style).toMatchObject({ bold: true, italic: true, underline: true })
    expect(rtfColorToCss(b.runs[0].style.color)).toBe('#000000')
  })
})

describe('RTF parser — generic / legacy', () => {
  it('handles nested font tables, \\par, \\tab, quotes and cp1252 punctuation (ProPresenter 6 / .NET)', () => {
    const doc = parseRtf(String.raw`{\rtf1\prortf1\ansi\ansicpg1252\uc1\htmautsp\deff2{\fonttbl{\f0\fcharset0 Times New Roman;}{\f2\fcharset0 Georgia;}}{\colortbl\red0\green0\blue0;\red255\green255\blue255;}\loch\hich\dbch\pard\slleading0\plain\ltrpar\itap0{\lang1033\fs120\f2\cf1 \cf1\qc{\f2 {\ltrch Amazing grace\rquote s sweet\tab sound}\li0\sa0\sb0\fi0\qc\par}
{\f2 {\ltrch That saved a wretch \'93like me\'94}\li0\sa0\sb0\fi0\qc\par}
}
}`)
    expect(doc.plain).toBe('Amazing grace’s sweet\tsound\nThat saved a wretch “like me”')
    expect(doc.paragraphs[0].runs[0].style).toMatchObject({ font: 'Georgia', fontSize: 60 })
    expect(rtfColorToCss(doc.paragraphs[0].runs[0].style.color)).toBe('#FFFFFF')
    expect(doc.paragraphs[0].align).toBe('center')
  })
  it('decodes per-font code pages (Cyrillic \\fcharset204) and multi-byte runs', () => {
    const doc = parseRtf(String.raw`{\rtf1\ansi\ansicpg1252{\fonttbl{\f0\fcharset204 Arial;}{\f1\fcharset0 Arial;}}\f0 \'cf\'f0\'e8\'e2\'e5\'f2\f1  caf\'e9}`)
    expect(doc.plain).toBe('Привет café')
  })
  it('skips ignorable destinations, pictures and info groups', () => {
    const doc = parseRtf(String.raw`{\rtf1{\info{\title Secret}}{\*\generator Riched20;}{\pict\wmetafile8 0102030405}{\*\unknowndest hidden {nested}}Visible}`)
    expect(doc.plain).toBe('Visible')
  })
  it('never throws on malformed input', () => {
    expect(parseRtf('{\\rtf1 unbalanced {{{ \\u').plain.trim()).toBe('unbalanced')
    expect(parseRtf('{\\rtf1 }}}} extra').warnings.length).toBeGreaterThan(0)
    expect(parseRtf(new Uint8Array([0xff, 0xfe, 0x00])).paragraphs.length).toBeGreaterThanOrEqual(0)
    expect(parseRtf('just text\nline 2').plain).toBe('just text\nline 2')
    expect(parseRtf('').plain).toBe('')
  })
  it('handles csgray, empty expanded entries and U+2028 line separators', () => {
    const doc = parseRtf(String.raw`{\rtf1\ansi\cocoartf2{\fonttbl\f0 A;}{\colortbl;\red1\green2\blue3;\red0\green0\blue0;}{\*\expandedcolortbl;;\csgray\c50000\c25000;}\f0\cf1 a\uc0@U@8232 b\cf2 c}`.replaceAll('@U@', '\\u'))
    expect(doc.plain).toBe('a\nbc')
    expect(rtfColorToCss(doc.paragraphs[0].runs[0].style.color)).toBe('#010203')
    expect(rtfColorToCss(doc.paragraphs[1].runs[1].style.color)).toBe('rgba(128, 128, 128, 0.25)')
  })
})

describe('code pages + writer', () => {
  it('maps the cp1252 C1 range', () => {
    expect(decodeCodepage([0x80, 0x92, 0x93, 0x94, 0x96, 0x97, 0xe9], 1252)).toBe('€’“”–—é')
  })
  it('round-trips escaped text', () => {
    const text = 'Line 1 {x} \\ ț 😀\nLine 2'
    expect(parseRtf(`{\\rtf1\\ansi ${escapeRtfText(text)}}`).plain).toBe(text)
  })
})
