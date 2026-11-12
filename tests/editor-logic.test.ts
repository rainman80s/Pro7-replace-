import { describe, expect, it } from 'vitest'
import type { Canvas, Presentation, Slide, TextElement } from '@shared/model'
import { linkVariantElements, resolveSlideForCanvas, slideText } from '@shared/model'
import { aabb, resizeRect, snapMove, snapResize, snapTargets, fitRect, regionAt, alignRect } from '@shared/editor-geometry'
import { createHistory, pushHistory, undo, redo, canUndo, canRedo } from '@shared/editor-history'
import { applyVariantLayout, createVariant, fillRegion, linkedSource, normalizeSlide, setVariant } from '@shared/editor-variants'
import { applyReflow, parseReflow, presentationToText, splitLongBlocks } from '@shared/editor-reflow'
import { mergePresentation } from '@shared/editor-merge'
import { normalizeParagraphs, rangeStyle, styleRange } from '@shared/editor-richtext'
import { allThemes, applyTheme, pickTemplate, removeTheme, resolveSlideWithCanvasTheme, themeFromSlide } from '@shared/themes'
import { BUILTIN_THEMES } from '@shared/themes-builtin'
import { BUILTIN_STAGE_LAYOUTS } from '@shared/editor-stagelayouts'
import { clone, paragraphsText, primaryText, setParagraphsText } from '@shared/editor-util'

const lyric = (id: string, text: string, extra: Partial<TextElement> = {}): TextElement => ({
  id, type: 'text', role: 'lyrics', frame: { x: 160, y: 108, w: 1600, h: 864 }, paragraphs: text.split('\n').map((t) => ({ runs: [{ text: t }] })),
  style: { fontSize: 90, color: '#fff' }, ...extra
})
const slide = (id: string, text: string): Slide => ({ id, elements: [lyric(`${id}-t`, text)] })
const pres = (): Presentation => ({
  id: 'p', title: 'Song', size: { width: 1920, height: 1080 }, meta: {}, createdAt: '', updatedAt: 't0',
  slides: [slide('s1', 'Amazing grace\nHow sweet the sound'), slide('s2', 'I once was lost\nBut now am found'), slide('s3', 'Chorus line one\nChorus line two')],
  groups: [{ id: 'g1', name: 'Verse 1', color: '#3886CE', slideIds: ['s1', 's2'] }, { id: 'g2', name: 'Chorus', color: '#E6A20F', slideIds: ['s3'] }],
  arrangements: [{ id: 'a', name: 'Default', groupIds: ['g1', 'g2', 'g1'] }]
})
const wall: Canvas = {
  id: 'wall', name: 'LED Wall', kind: 'audience', width: 1920, height: 2160,
  regions: [{ id: 'top', name: 'LED Top', rect: { x: 0, y: 0, w: 1920, h: 1080 } }, { id: 'bottom', name: 'LED Bottom', rect: { x: 0, y: 1080, w: 1920, h: 1080 } }]
}

describe('geometry & snapping', () => {
  it('snaps a moving box to slide centre, element edges and region edges', () => {
    const t = snapTargets({ width: 1920, height: 2160 }, [{ frame: { x: 100, y: 100, w: 200, h: 100 } }], wall.regions)
    const a = snapMove({ x: 857, y: 500, w: 200, h: 100 }, t, 6)
    expect(a.dx).toBe(3) // centre 957 → 960
    const b = snapMove({ x: 500, y: 1076, w: 200, h: 100 }, t, 6)
    expect(b.dy).toBe(4)
    expect(b.guides.find((g) => g.axis === 'y')?.label).toBeTruthy()
    const c = snapMove({ x: 302, y: 600, w: 50, h: 50 }, t, 6)
    expect(c.dx).toBe(-2) // left edge → other element's right edge (300)
    expect(snapMove({ x: 433, y: 333, w: 50, h: 50 }, t, 6)).toMatchObject({ dx: 0, dy: 0, guides: [] })
  })
  it('resizes from each side keeping the opposite side fixed', () => {
    const r = { x: 100, y: 100, w: 200, h: 100 }
    expect(resizeRect(r, 'e', 50, 0)).toEqual({ x: 100, y: 100, w: 250, h: 100 })
    expect(resizeRect(r, 'w', -50, 0)).toEqual({ x: 50, y: 100, w: 250, h: 100 })
    expect(resizeRect(r, 'nw', 20, 10)).toEqual({ x: 120, y: 110, w: 180, h: 90 })
    expect(resizeRect(r, 'se', 100, 0, { keepAspect: true })).toEqual({ x: 100, y: 100, w: 300, h: 150 })
    expect(resizeRect(r, 'e', 50, 0, { fromCenter: true })).toEqual({ x: 50, y: 100, w: 300, h: 100 })
    expect(resizeRect(r, 'e', -500, 0).w).toBe(4)
  })
  it('resizes a rotated box along its own axes with a fixed anchor', () => {
    const r = { x: 0, y: 0, w: 100, h: 100 }
    const out = resizeRect(r, 'e', 0, 40, { rotation: 90 }) // local +x points down
    expect(out.w).toBeCloseTo(140)
    // anchor = local left edge centre, which on screen is the top edge centre (50, 0)
    const cx = out.x + out.w / 2
    const cy = out.y + out.h / 2
    expect(cx).toBeCloseTo(50)
    expect(cy - out.w / 2).toBeCloseTo(0)
  })
  it('snapResize moves only the dragged edge', () => {
    const t = snapTargets({ width: 1920, height: 1080 }, [])
    const { rect, guides } = snapResize({ x: 100, y: 100, w: 1817, h: 100 }, 'e', t, 6)
    expect(rect).toEqual({ x: 100, y: 100, w: 1820, h: 100 })
    expect(guides).toHaveLength(1)
  })
  it('helpers', () => {
    expect(aabb({ x: 0, y: 0, w: 100, h: 50 }, 90)).toMatchObject({ w: expect.closeTo(50), h: expect.closeTo(100) })
    expect(fitRect({ width: 1920, height: 1080 }, { x: 0, y: 0, w: 1920, h: 2160 })).toMatchObject({ x: 0, y: 540, w: 1920, h: 1080 })
    expect(regionAt({ x: 10, y: 1500, w: 10, h: 10 }, wall.regions)?.id).toBe('bottom')
    expect(alignRect({ x: 5, y: 5, w: 10, h: 10 }, { x: 0, y: 0, w: 100, h: 100 }, 'hcenter').x).toBe(45)
  })
})

describe('history', () => {
  it('undo / redo and coalescing', () => {
    let h = createHistory('a')
    h = pushHistory(h, 'b', 'edit', undefined, 1000)
    h = pushHistory(h, 'c', 'type', 'k', 2000)
    h = pushHistory(h, 'd', 'type', 'k', 2300) // same gesture
    expect(h.past.map((x) => x.state)).toEqual(['a', 'b'])
    h = pushHistory(h, 'e', 'type', 'k', 9000) // too late → new step
    expect(h.past).toHaveLength(3)
    h = undo(h)
    expect(h.present).toBe('d')
    h = undo(h)
    expect(h.present).toBe('b')
    expect(canRedo(h)).toBe(true)
    h = redo(h)
    expect(h.present).toBe('d')
    h = pushHistory(h, 'x', 'new')
    expect(canRedo(h)).toBe(false)
    h = undo(undo(undo(undo(h))))
    expect(h.present).toBe('a')
    expect(canUndo(h)).toBe(false)
  })
})

describe('variants', () => {
  it('fit scales into the canvas centre; region and per-region strategies place by region', () => {
    const s = pres().slides[0]
    const fit = createVariant(s, { width: 1920, height: 1080 }, wall)
    expect(fit.elements[0].frame).toEqual({ x: 160, y: 648, w: 1600, h: 864 })
    const bottom = createVariant(s, { width: 1920, height: 1080 }, wall, { type: 'region', regionId: 'bottom' })
    expect(bottom.elements[0].frame.y).toBe(1188)
    expect(bottom.elements[0].regionId).toBe('bottom')
    const per = createVariant(s, { width: 1920, height: 1080 }, wall, { type: 'perRegion' })
    expect(per.elements).toHaveLength(2)
    expect(per.elements.map((e) => e.regionId)).toEqual(['top', 'bottom'])
    expect(new Set(per.elements.map((e) => e.id)).size).toBe(2)
    const small = createVariant(s, { width: 1920, height: 1080 }, { width: 960, height: 540, regions: [] })
    expect((small.elements[0] as TextElement).style.fontSize).toBe(45)
  })
  it('lyrics are single-source: variant text follows the base by role', () => {
    let s = pres().slides[0]
    s = setVariant(s, 'wall', createVariant(s, { width: 1920, height: 1080 }, wall, { type: 'perRegion' }))
    const edited: Slide = { ...s, elements: [{ ...(s.elements[0] as TextElement), paragraphs: [{ runs: [{ text: 'New words' }] }] }] }
    const r = resolveSlideForCanvas(edited, { width: 1920, height: 1080 }, wall)
    expect(r.size).toEqual({ width: 1920, height: 2160 })
    expect(r.elements.map((e) => paragraphsText((e as TextElement).paragraphs))).toEqual(['New words', 'New words'])
    expect((r.elements[0] as TextElement).style.fontSize).toBe(90) // keeps the variant's own styling
    // unlinked copies keep their own text
    const v = edited.variants!.wall
    const un = { ...edited, variants: { wall: { elements: [{ ...(v.elements[0] as TextElement), linked: false }, v.elements[1]] } } }
    const r2 = resolveSlideForCanvas(un, { width: 1920, height: 1080 }, wall)
    expect(paragraphsText((r2.elements[0] as TextElement).paragraphs)).toContain('Amazing grace')
    expect(linkedSource(un.elements, un.variants.wall.elements, v.elements[0].id)).toBeUndefined()
    expect(linkedSource(un.elements, un.variants.wall.elements, v.elements[1].id)?.id).toBe('s1-t')
    expect(normalizeSlide(edited).variants!.wall.elements.every((e) => paragraphsText((e as TextElement).paragraphs) === 'New words')).toBe(true)
    expect(linkVariantElements(s.elements, s.variants!.wall.elements)).toBe(s.variants!.wall.elements)
  })
  it('apply layout to other slides keeps their own words', () => {
    const p = pres()
    let s1 = p.slides[0]
    const variant = createVariant(s1, p.size, wall, { type: 'region', regionId: 'bottom' })
    variant.elements.push(fillRegion({ id: 'bg', type: 'shape', shape: 'rect', frame: { x: 0, y: 0, w: 10, h: 10 }, fill: { type: 'color', color: '#292929' } }, wall.regions[0]))
    s1 = setVariant(s1, 'wall', variant)
    const s2 = applyVariantLayout(s1, 'wall', p.slides[1])
    const r = resolveSlideForCanvas(s2, p.size, wall)
    expect(r.elements).toHaveLength(2)
    expect(slideText({ id: 'x', elements: r.elements })).toContain('I once was lost')
    expect(r.elements[1].frame).toEqual(wall.regions[0].rect)
    expect(r.elements[0].id).not.toBe(variant.elements[0].id)
    // a slide whose text has another role still gets the layout
    const title: Slide = { id: 't', elements: [lyric('tt', 'Welcome', { role: 'title' })] }
    const t2 = applyVariantLayout(s1, 'wall', title)
    expect(slideText({ id: 'x', elements: resolveSlideForCanvas(t2, p.size, wall).elements })).toBe('Welcome')
    // removing
    expect(setVariant(s2, 'wall', null).variants).toBeUndefined()
  })
})

describe('reflow', () => {
  it('round-trips without changing anything', () => {
    const p = pres()
    const text = presentationToText(p)
    expect(text).toBe('Verse 1\nAmazing grace\nHow sweet the sound\n\nI once was lost\nBut now am found\n\nChorus\nChorus line one\nChorus line two')
    expect(applyReflow(p, text)).toBe(p)
  })
  it('editing words keeps slide identity, styling and variants', () => {
    let p = pres()
    p = { ...p, slides: [setVariant(p.slides[0], 'wall', createVariant(p.slides[0], p.size, wall)), ...p.slides.slice(1)] }
    const text = presentationToText(p).replace('How sweet the sound', 'How sweet the SOUND')
    const out = applyReflow(p, text)
    expect(out.slides.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
    expect(out.slides[1]).toBe(p.slides[1])
    expect(slideText(out.slides[0])).toBe('Amazing grace\nHow sweet the SOUND')
    expect((out.slides[0].elements[0] as TextElement).style).toEqual(p.slides[0].elements[0].type === 'text' ? p.slides[0].elements[0].style : {})
    expect(paragraphsText((out.slides[0].variants!.wall.elements[0] as TextElement).paragraphs)).toContain('SOUND')
  })
  it('splitting, merging, inserting and deleting slides', () => {
    const p = pres()
    const split = applyReflow(p, presentationToText(p).replace('Amazing grace\nHow', 'Amazing grace\n\nHow'))
    expect(split.slides).toHaveLength(4)
    expect(split.slides[0].id).toBe('s1')
    expect(split.slides.slice(2).map((s) => s.id)).toEqual(['s2', 's3'])
    expect(split.groups[0].slideIds).toEqual(['s1', split.slides[1].id, 's2'])
    expect((split.slides[1].elements[0] as TextElement).style.fontSize).toBe(90)
    const merged = applyReflow(p, presentationToText(p).replace('sound\n\nI once', 'sound\nI once'))
    expect(merged.slides.map((s) => s.id)).toEqual(['s1', 's3'])
    expect(slideText(merged.slides[0]).split('\n')).toHaveLength(4)
    const removed = applyReflow(p, 'Verse 1\nAmazing grace\nHow sweet the sound\n\nChorus\nChorus line one\nChorus line two')
    expect(removed.slides.map((s) => s.id)).toEqual(['s1', 's3'])
    expect(removed.groups.map((g) => g.id)).toEqual(['g1', 'g2'])
  })
  it('headings create, keep and remove groups and update arrangements', () => {
    const p = pres()
    const out = applyReflow(p, presentationToText(p) + '\n\nBridge\nNew bridge words\n\n[Big Finish]\nThe end')
    expect(out.groups.map((g) => g.name)).toEqual(['Verse 1', 'Chorus', 'Bridge', 'Big Finish'])
    expect(out.groups[0].id).toBe('g1')
    expect(out.groups[2].color).toBe('#9B6BD3')
    expect(out.arrangements[0].groupIds).toEqual(['g1', 'g2', out.groups[2].id, out.groups[3].id, 'g1'])
    expect(presentationToText(out)).toContain('[Big Finish]\nThe end')
    const gone = applyReflow(p, 'Verse 1\nAmazing grace\nHow sweet the sound\n\nI once was lost\nBut now am found\n\nChorus line one\nChorus line two')
    expect(gone.groups).toHaveLength(1)
    expect(gone.groups[0].slideIds).toEqual(['s1', 's2', 's3'])
    expect(gone.arrangements[0].groupIds).toEqual(['g1', 'g1'])
  })
  it('max lines auto-split balances lines', () => {
    expect(splitLongBlocks('Verse 1\na\nb\nc\nd\ne', 4)).toBe('Verse 1\na\nb\nc\n\nd\ne')
    expect(splitLongBlocks('a\nb', 2)).toBe('a\nb')
    const p = pres()
    const out = applyReflow(p, presentationToText(p), { maxLines: 1 })
    expect(out.slides).toHaveLength(6)
    expect(parseReflow('Chorus\n\n\n  \nline')).toEqual([{ type: 'group', name: 'Chorus' }, { type: 'slide', text: 'line' }])
  })
  it('slides without text survive', () => {
    const p = pres()
    p.slides.splice(1, 0, { id: 'img', elements: [{ id: 'i', type: 'image', frame: { x: 0, y: 0, w: 10, h: 10 }, media: { kind: 'image', src: 'workspace:a.png' } }] })
    const text = presentationToText(p)
    expect(text).toContain('(blank)')
    expect(applyReflow(p, text)).toBe(p)
    const out = applyReflow(p, text.replace('lost', 'LOST'))
    expect(out.slides[1]).toBe(p.slides[1])
  })
})

describe('merge', () => {
  it('takes non-overlapping edits from both sides and reports conflicts', () => {
    const base = pres()
    const mine = clone(base)
    const theirs = clone(base)
    ;(mine.slides[0].elements[0] as TextElement).paragraphs = [{ runs: [{ text: 'mine' }] }]
    ;(theirs.slides[1].elements[0] as TextElement).paragraphs = [{ runs: [{ text: 'theirs' }] }]
    theirs.title = 'Renamed'
    theirs.slides.push(slide('s4', 'added by them'))
    theirs.updatedAt = 't1'
    const r = mergePresentation(base, mine, theirs)
    expect(r.conflicts).toEqual([])
    expect(r.merged.slides.map((s) => slideText(s).split('\n')[0])).toEqual(['mine', 'theirs', 'Chorus line one', 'added by them'])
    expect(r.merged.title).toBe('Renamed')
    ;(theirs.slides[0].elements[0] as TextElement).paragraphs = [{ runs: [{ text: 'clash' }] }]
    const c = mergePresentation(base, mine, theirs)
    expect(c.conflicts).toEqual(['s1'])
    expect(slideText(c.merged.slides[0])).toBe('mine')
  })
})

describe('rich text', () => {
  it('styles a range, merges runs, reports common style', () => {
    const ps = [{ runs: [{ text: 'Hello world' }] }, { runs: [{ text: 'second' }] }]
    const bold = styleRange(ps, { start: { p: 0, o: 6 }, end: { p: 0, o: 11 } }, { fontWeight: 700 })
    expect(bold[0].runs).toEqual([{ text: 'Hello ' }, { text: 'world', style: { fontWeight: 700 } }])
    expect(rangeStyle(bold, { start: { p: 0, o: 7 }, end: { p: 0, o: 9 } })).toEqual({ fontWeight: 700 })
    expect(rangeStyle(bold, { start: { p: 0, o: 2 }, end: { p: 0, o: 9 } })).toEqual({})
    const across = styleRange(bold, { start: { p: 0, o: 3 }, end: { p: 1, o: 3 } }, { color: '#f00' })
    expect(across[1].runs).toEqual([{ text: 'sec', style: { color: '#f00' } }, { text: 'ond' }])
    const cleared = styleRange(across, { start: { p: 0, o: 0 }, end: { p: 1, o: 6 } }, { color: undefined, fontWeight: undefined })
    expect(cleared).toEqual(ps)
    expect(normalizeParagraphs([{ runs: [{ text: 'a' }, { text: '' }, { text: 'b' }] }])).toEqual([{ runs: [{ text: 'ab' }] }])
    expect(setParagraphsText(bold, 'Hello world\nchanged')[0]).toBe(bold[0])
  })
})

describe('themes', () => {
  it('built-ins are well formed and cover the documented roles', () => {
    expect(BUILTIN_THEMES.length).toBeGreaterThanOrEqual(5)
    const roles = new Set(BUILTIN_THEMES.flatMap((t) => t.templates.flatMap((x) => x.slide.elements.filter((e) => e.type === 'text').map((e) => (e as TextElement).role))))
    for (const r of ['lyrics', 'title', 'subtitle', 'reference', 'body', 'caption']) expect(roles.has(r)).toBe(true)
    expect(new Set(allThemes([{ ...BUILTIN_THEMES[0], name: 'Mine' }]).map((t) => t.id)).size).toBe(BUILTIN_THEMES.length)
    expect(BUILTIN_STAGE_LAYOUTS).toHaveLength(3)
    expect(BUILTIN_STAGE_LAYOUTS.every((l) => l.slide.elements.some((e) => e.type === 'text' && e.dynamic))).toBe(true)
  })
  it('applies by role, keeps words, emphasis and ids; is re-appliable and reversible', () => {
    const p = pres()
    ;(p.slides[0].elements[0] as TextElement).paragraphs[0].runs = [{ text: 'Amazing ', style: { fontSize: 200 } }, { text: 'grace', style: { fontWeight: 700, fontSize: 200 } }]
    const lower = BUILTIN_THEMES.find((t) => t.id === 'reach-lower-third')!
    const themed = applyTheme(p, lower)
    expect(themed.themeId).toBe('reach-lower-third')
    const s = themed.slides[0]
    expect(s.elements).toHaveLength(3)
    const t = primaryText(s.elements)!
    expect(t.id).toBe('s1-t')
    expect(t.frame.y).toBe(815)
    expect(t.paragraphs[0].runs).toEqual([{ text: 'Amazing ' }, { text: 'grace', style: { fontWeight: 700 } }])
    expect(s.elements.filter((e) => e.fromTheme)).toHaveLength(2)
    // re-apply another theme: decoration is replaced, not stacked
    const full = applyTheme(themed, BUILTIN_THEMES[0])
    expect(full.slides[0].elements).toHaveLength(1)
    expect(slideText(full.slides[1])).toBe('I once was lost\nBut now am found')
    // edit words after theming, then remove the theme → original look, new words
    ;(full.slides[1].elements[0] as TextElement).paragraphs = [{ runs: [{ text: 'Edited later' }] }]
    const back = removeTheme(full)
    expect(back.themeId).toBeUndefined()
    expect(back.meta.theme).toBeUndefined()
    expect(back.slides[0].elements).toEqual(p.slides[0].elements)
    expect(slideText(back.slides[1])).toBe('Edited later')
    expect((back.slides[1].elements[0] as TextElement).frame).toEqual(p.slides[1].elements[0].frame)
  })
  it('picks templates by role and carries per-canvas variants from the template', () => {
    const sermon = BUILTIN_THEMES.find((t) => t.id === 'reach-sermon')!
    const titleOnly: Slide = { id: 'a', elements: [lyric('a1', 'Big idea', { role: 'title' }), lyric('a2', 'Series', { role: 'subtitle' })] }
    expect(pickTemplate(sermon, titleOnly)?.id).toBe('reach-sermon-title')
    const point: Slide = { id: 'b', elements: [lyric('b1', 'Point', { role: 'title' }), lyric('b2', 'More', { role: 'body' })] }
    expect(pickTemplate(sermon, point)?.id).toBe('reach-sermon-point')

    const p = pres()
    const designed = setVariant(p.slides[0], 'wall', createVariant(p.slides[0], p.size, wall, { type: 'region', regionId: 'bottom' }))
    const mine = themeFromSlide('Wall look', designed, p.size)
    const out = applyTheme(p, mine)
    const r = resolveSlideForCanvas(out.slides[2], p.size, wall)
    expect(r.elements[0].frame.y).toBe(1188)
    expect(slideText({ id: 'x', elements: r.elements })).toBe('Chorus line one\nChorus line two')
    expect(removeTheme(out).slides[2].variants).toBeUndefined()

    const viaCanvas = resolveSlideWithCanvasTheme(p.slides[1], p.size, { ...wall, themeId: mine.id }, [mine])
    expect(viaCanvas?.size).toEqual({ width: 1920, height: 2160 })
    expect(resolveSlideWithCanvasTheme(p.slides[1], p.size, wall, [mine])).toBeNull()
  })
})
