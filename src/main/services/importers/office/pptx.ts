/**
 * PowerPoint .pptx → editable Reach slides (text boxes with position, size, font size, bold/italic, colour,
 * alignment; slide pictures as image elements; speaker notes). Layout/master inheritance, SmartArt, charts,
 * tables and animations are not interpreted (reported). For pixel-perfect "import as images", export the deck
 * to PDF/PNG from PowerPoint/Keynote and import the images (see docs/formats/reach-format.md).
 */
import { DOMParser } from '@xmldom/xmldom'
import type { ImageElement, Paragraph, Presentation, Slide, TextElement, TextRun } from '@shared/model'
import { newImportId } from '@shared/import-lyrics'
import { ConvertContext } from '../pp7/context'
import { readZip } from '../util/zip'

const EMU = 914400 / 96 // EMU per CSS px
type El = Element
const parse = (b: Uint8Array): Document => new DOMParser({ errorHandler: { warning: () => {}, error: () => {}, fatalError: () => {} } }).parseFromString(Buffer.from(b).toString('utf8'), 'text/xml') as unknown as Document
const all = (e: El | Document, local: string): El[] => Array.from((e as El).getElementsByTagName('*')).filter((x) => (x.localName ?? x.nodeName.split(':').pop()) === local) as El[]
const first = (e: El | Document, local: string): El | undefined => all(e, local)[0]
const kidsNamed = (e: El, local: string): El[] => Array.from(e.childNodes).filter((n) => n.nodeType === 1 && ((n as El).localName ?? n.nodeName.split(':').pop()) === local) as El[]

export function convertPptx(bytes: Uint8Array, opts: { sourcePath?: string; title?: string } = {}): { presentation: Presentation; ctx: ConvertContext; media: { name: string; data: Uint8Array }[] } {
  const ctx = new ConvertContext(newImportId)
  const zip = readZip(bytes)
  const files = new Map(zip.entries.map((e) => [e.name.replace(/^\/+/, ''), e]))
  const read = (p: string): Uint8Array | null => { try { return files.get(p)?.read() ?? null } catch { return null } }
  const pres = read('ppt/presentation.xml')
  if (!pres) throw new Error('not a PowerPoint file (no ppt/presentation.xml)')
  const pdoc = parse(pres)
  const sz = first(pdoc, 'sldSz')
  const width = Math.round(Number(sz?.getAttribute('cx') ?? 12192000) / EMU)
  const height = Math.round(Number(sz?.getAttribute('cy') ?? 6858000) / EMU)
  const rels = parse(read('ppt/_rels/presentation.xml.rels') ?? new Uint8Array())
  const relTarget = new Map(all(rels, 'Relationship').map((r) => [r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '']))
  const slidePaths = all(pdoc, 'sldId').map((s) => relTarget.get(s.getAttribute('r:id') ?? '') ?? '').filter(Boolean).map((t) => `ppt/${t.replace(/^\/?ppt\//, '')}`)
  const media: { name: string; data: Uint8Array }[] = []
  const slides: Slide[] = []
  const title = opts.title ?? first(parse(read('docProps/core.xml') ?? new Uint8Array()), 'title')?.textContent ?? 'PowerPoint'
  for (const [si, sp] of slidePaths.entries()) {
    const xml = read(sp)
    if (!xml) continue
    const doc = parse(xml)
    const relPath = sp.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels')
    const srels = new Map(all(parse(read(relPath) ?? new Uint8Array()), 'Relationship').map((r) => [r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '']))
    const slide: Slide = { id: newImportId(), elements: [] }
    const frameOf = (e: El) => {
      const off = first(e, 'off'), ext = first(e, 'ext')
      return { x: Math.round(Number(off?.getAttribute('x') ?? 0) / EMU), y: Math.round(Number(off?.getAttribute('y') ?? 0) / EMU), w: Math.round(Number(ext?.getAttribute('cx') ?? 0) / EMU), h: Math.round(Number(ext?.getAttribute('cy') ?? 0) / EMU) }
    }
    for (const pic of all(doc, 'pic')) {
      const blip = first(pic, 'blip')
      const target = srels.get(blip?.getAttribute('r:embed') ?? '')
      if (!target) continue
      const path = `ppt/${target.replace(/^\.\.\//, '')}`
      const data = read(path)
      if (!data) continue
      const name = path.split('/').pop()!
      media.push({ name, data })
      const img: ImageElement = { id: newImportId(), type: 'image', frame: frameOf(pic), fit: 'stretch', media: { kind: 'image', src: `pptx-media:${name}`, name } }
      ctx.media.push({ ref: img.media, url: { basename: name, relative: name, root: 'ROOT_CURRENT_RESOURCE' }, where: `slide ${si + 1}` })
      slide.elements.push(img)
    }
    for (const shape of all(doc, 'sp')) {
      const body = first(shape, 'txBody')
      if (!body) continue
      const paragraphs: Paragraph[] = []
      let maxSize = 0
      for (const p of kidsNamed(body, 'p')) {
        const runs: TextRun[] = []
        for (const r of Array.from(p.childNodes).filter((n) => n.nodeType === 1) as El[]) {
          const local = r.localName ?? r.nodeName.split(':').pop()
          if (local === 'br') { runs.push({ text: '\n' }); continue }
          if (local !== 'r' && local !== 'fld') continue
          const rPr = first(r, 'rPr')
          const t = first(r, 't')?.textContent ?? ''
          const style: TextRun['style'] = {}
          const szv = rPr?.getAttribute('sz')
          if (szv) { style.fontSize = Math.round(Number(szv) / 100 * 96 / 72); maxSize = Math.max(maxSize, style.fontSize) }
          if (rPr?.getAttribute('b') === '1') style.fontWeight = 700
          if (rPr?.getAttribute('i') === '1') style.italic = true
          if (rPr?.getAttribute('u') && rPr.getAttribute('u') !== 'none') style.underline = true
          const clr = rPr ? first(rPr, 'srgbClr')?.getAttribute('val') : undefined
          if (clr) style.color = `#${clr.toUpperCase()}`
          const font = rPr ? first(rPr, 'latin')?.getAttribute('typeface') : undefined
          if (font && !font.startsWith('+')) style.fontFamily = font
          runs.push(Object.keys(style).length ? { text: t, style } : { text: t })
        }
        const algn = first(p, 'pPr')?.getAttribute('algn')
        // split runs at hard breaks into separate paragraphs
        let cur: TextRun[] = []
        const push = (): void => { paragraphs.push({ runs: cur.length ? cur : [{ text: '' }], align: algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : undefined }); cur = [] }
        for (const r of runs) { if (r.text === '\n') push(); else cur.push(r) }
        push()
      }
      if (!paragraphs.some((p) => p.runs.some((r) => r.text.trim()))) continue
      const ph = first(shape, 'ph')?.getAttribute('type')
      let frame = frameOf(shape)
      if (!frame.w || !frame.h) { frame = ph === 'title' || ph === 'ctrTitle' ? { x: width * 0.07, y: height * 0.05, w: width * 0.86, h: height * 0.2 } : { x: width * 0.07, y: height * 0.28, w: width * 0.86, h: height * 0.65 }; ctx.note('pptx.inheritedPlacement') }
      const t: TextElement = {
        id: newImportId(), type: 'text', frame, paragraphs, autoFit: true, verticalAlign: ph === 'title' || ph === 'ctrTitle' ? 'middle' : 'top',
        style: { fontSize: maxSize || Math.round(height * (ph === 'title' || ph === 'ctrTitle' ? 0.07 : 0.045)), color: '#FFFFFF' },
        role: ph === 'title' || ph === 'ctrTitle' ? 'title' : ph === 'subTitle' ? 'subtitle' : 'body', align: paragraphs[0]?.align
      }
      slide.elements.push(t)
    }
    for (const k of ['graphicFrame', 'AlternateContent']) if (all(doc, k).length) ctx.note(`pptx.${k}`)
    const notesTarget = [...srels.values()].find((t) => /notesSlide/.test(t))
    if (notesTarget) {
      const nd = read(`ppt/${notesTarget.replace(/^\.\.\//, '')}`)
      if (nd) { const txt = all(parse(nd), 't').map((t) => t.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim(); if (txt && !/^\d+$/.test(txt)) slide.notes = txt }
    }
    slide.background = { type: 'color', color: '#000000' }
    slides.push(slide)
  }
  const now = new Date().toISOString()
  return {
    presentation: { id: newImportId(), title, kind: 'generic', size: { width, height }, slides, groups: [], arrangements: [], meta: { source: { type: 'pptx', ref: opts.sourcePath, importedAt: now } }, createdAt: now, updatedAt: now },
    ctx, media
  }
}

/** Images → one full-screen image slide each. */
export function imagesToPresentation(title: string, images: { src: string; name: string }[], size = { width: 1920, height: 1080 }): Presentation {
  const now = new Date().toISOString()
  return {
    id: newImportId(), title, kind: 'generic', size,
    slides: images.map((im) => ({ id: newImportId(), label: im.name, background: { type: 'color', color: '#000000' }, elements: [{ id: newImportId(), type: 'image', name: im.name, frame: { x: 0, y: 0, w: size.width, h: size.height }, fit: 'contain', media: { kind: 'image', src: im.src, name: im.name } } as ImageElement] })),
    groups: [], arrangements: [], meta: { source: { type: 'images', importedAt: now } }, createdAt: now, updatedAt: now
  }
}
