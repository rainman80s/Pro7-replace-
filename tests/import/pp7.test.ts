import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ImageElement, LiveElement, ShapeElement, TextElement } from '@shared/model'
import { orderedSlides, plainText } from '@shared/model'
import { convertPP7Presentation, hotKeyOf } from '@main/services/importers/pp7/presentation'
import { fontFromName } from '@main/services/importers/pp7/text'
import { parsePP7Url } from '@main/services/importers/pp7/url'

const S = join(__dirname, '../../vendor/pp7-samples')
const load = (f: string) => convertPP7Presentation(readFileSync(join(S, f)), { sourcePath: join(S, f) })
const texts = (els: { type: string }[]) => els.filter((e): e is TextElement => e.type === 'text')

describe('PP7 .pro — bussnet_test-translated.pro (macOS, v20, translation)', () => {
  const r = load('bussnet_test-translated.pro')
  const p = r.presentation
  it('reads title, size, CCLI metadata and source pointer', () => {
    expect(p.title).toBe('Oceans (Where Feet May Fail) [TRANS]-1')
    expect(p.kind).toBe('song')
    expect(p.size).toEqual({ width: 1920, height: 1080 })
    expect(p.meta).toMatchObject({ author: 'Joel Houston, Matt Crocker, Salomon Ligthelm', ccliNumber: '6428767', publisher: '2012 Hillsong Music Publishing Australia', copyright: '© 2012 Hillsong Music Publishing Australia', copyrightYear: 2012 })
    expect(p.meta.source).toMatchObject({ type: 'propresenter7', uuid: 'E3961927-7C66-4CAD-B736-E167E711C93C', platform: 'macos' })
    expect(r.info.appVersion).toMatch(/^20/)
    expect(r.unknownFields).toEqual({})
    expect(p.id).toBe('e39619277c664cadb736e167e711c93c') // stable id from the PP7 uuid → idempotent re-import
  })
  it('maps cue groups (names, colours, order) and both arrangements', () => {
    expect(p.slides).toHaveLength(15)
    expect(p.groups.map((g) => g.name)).toEqual(['COPYRIGHT', 'Verse 1', 'Chorus 1', 'Verse 2', 'Interlude', 'Bridge', 'Interlude', 'Chorus 2', 'BLANK'])
    expect(p.groups.map((g) => g.slideIds.length)).toEqual([1, 2, 2, 2, 1, 3, 1, 2, 1])
    expect(p.groups[0].color).toBe('#24B34C')
    expect(p.arrangements.map((a) => [a.name, a.groupIds.length])).toEqual([['normal', 13], ['bene', 14]])
    expect(orderedSlides(p, p.arrangements[0].id).length).toBeGreaterThan(15) // repeats preserved
  })
  it('splits original and translation text boxes into lyrics / translation roles', () => {
    const s = p.slides[1]
    const [tr, main] = texts(s.elements)
    expect(main.role).toBe('lyrics')
    expect(main.name).toBe('Orginal')
    expect(plainText(main)).toBe('You call me out upon the waters\nThe great unknown where feet may fail')
    expect(tr.role).toBe('translation')
    expect(plainText(tr)).toBe('Du rufst mich raus aufs weite Wasser,\nwo Füße nicht mehr sicher stehn.')
    expect(main.style).toMatchObject({ fontFamily: 'Helvetica Neue', fontSize: 42, color: '#FFFFFF' })
    expect(main.align).toBe('center')
    expect(main.verticalAlign).toBe('middle')
    expect(main.frame).toEqual({ x: 150, y: 99.54, w: 1620, h: 182.95 })
  })
  it('maps the macro cue on the copyright slide', () => {
    expect(p.slides[0].actions?.[0]).toMatchObject({ type: 'macro.run', params: { id: '20c1dfde0fb649e5b90ce6608d427212', name: 'Lied 1.Folie' } })
  })
})

describe('PP7 .pro — bussnet_test-with-macro.pro', () => {
  const p = load('bussnet_test-with-macro.pro').presentation
  it('decodes groups, CCLI and a macro action', () => {
    expect(p.title).toBe('Test')
    expect(p.slides).toHaveLength(7)
    expect(p.groups.map((g) => `${g.name}:${g.color}`)).toEqual(['Verse 1:#0077CC', 'Verse 2:#005999', 'Chorus:#CC004E', 'COPYRIGHT:#24B34C', 'BLANK:#000000', 'Ending:#998F1F'])
    expect(p.meta).toMatchObject({ author: 'Autor', artist: 'Künstler', publisher: 'Herausgeber', ccliNumber: '123456789', album: 'Album' })
    expect(p.arrangements.map((a) => a.name)).toEqual(['normal', 'test2'])
    expect(plainText(texts(p.slides[0].elements)[0])).toBe('Vers1.1\nVers1.2')
    const withMacro = p.slides.find((s) => s.actions?.length)!
    expect(withMacro.actions![0]).toMatchObject({ type: 'macro.run', params: { name: 'Lied 1.Folie', collection: '--MAIN--' } })
  })
})

describe('PP7 .pro — chrismbarr_v7-feature-test.pro (Windows 7.13.2)', () => {
  const r = load('chrismbarr_v7-feature-test.pro')
  const p = r.presentation
  it('reads slide label, hot key, background colour and builds', () => {
    expect(p.title).toBe('Feature Test')
    expect(p.slides).toHaveLength(4)
    const s = p.slides[0]
    expect(s.label).toBe('Spoken Word')
    expect(s.hotKey).toBe('G')
    expect(s.background).toEqual({ type: 'color', color: '#414A82' })
    const [first, second] = texts(s.elements)
    expect(first.name).toBe('first box')
    expect(first.rotation).toBe(354)
    expect(first.locked).toBe(true)
    expect(first.fill).toEqual({ type: 'color', color: '#B41616' })
    expect(first.stroke).toEqual({ color: '#10EC46', width: 12 })
    expect(first.style).toMatchObject({ fontFamily: 'Helvetica', fontSize: 100, strokeWidth: 10 })
    expect(second.style.strokeColor).toBe('#97EE15')
    expect(second.style.shadow?.blur).toBe(10)
    expect(second.style.shadow!.y).toBeGreaterThan(0) // 295° = down-right in Cocoa coordinates
    expect(second.buildIn).toBe(1)
    expect(first.buildIn).toBe(2)
    expect(p.groups.find((g) => g.name === 'Tag')?.color).toBe('#CC2929')
  })
  it('converts image fills, web content and shapes; draws back→front', () => {
    const s2 = p.slides[1]
    expect(s2.elements.map((e) => e.name)).toEqual(['Background Image', 'Divider Line', 'Bible Reference', 'Bible Text'])
    const bg = s2.elements[0] as ImageElement
    expect(bg.type).toBe('image')
    expect(bg.media.name).toBe('Clouds')
    const ref = texts(s2.elements).find((t) => t.name === 'Bible Reference')!
    expect(ref.role).toBe('reference')
    expect(ref.align).toBe('right')
    expect(texts(s2.elements).find((t) => t.name === 'Bible Text')!.style.italic).toBe(true)
    const s4 = p.slides[3]
    const web = s4.elements.find((e) => e.type === 'live') as LiveElement
    expect(web.source).toEqual({ kind: 'web', ref: 'https://renewedvision.com/' })
    const box = s4.elements.find((e) => e.name === 'a box') as ShapeElement
    expect(box.type).toBe('shape')
    expect(box.opacity).toBeCloseTo(0.757, 3)
    expect(r.ctx.media.map((m) => m.url.basename).sort()).toEqual(['Clouds.jpg', 'ImageSample1.jpg', 'White Flourish.png', 'avatar.png'])
  })
  it('turns the media cue into a media.play action and records the presentation transition', () => {
    const act = p.slides[2].actions?.[0] ?? (p.slides[2] as { ext?: { disabledActions?: unknown[] } }).ext?.disabledActions?.[0]
    expect(act).toMatchObject({ type: 'media.play', params: { layer: 'background', fit: 'stretch', media: { kind: 'image', name: 'ImageSample1', width: 1024, height: 768 } } })
    expect(p.meta.transition).toMatchObject({ type: 'fade' })
    expect((p.meta.source as Record<string, unknown>).transition).toMatchObject({ name: 'Cube' })
  })
})

describe('PP7 .pro — bes-migrator_windows-template-1.pro (Windows, unicode)', () => {
  const p = load('bes-migrator_windows-template-1.pro').presentation
  it('decodes \\uN escapes (Romanian diacritics, smart quotes) and custom size', () => {
    expect(p.size).toEqual({ width: 1344, height: 768 })
    const lines = plainText(texts(p.slides[1].elements)[0]).split('\n')
    expect(lines).toHaveLength(15)
    expect(lines.map((l) => l.replace('space-not-expected-before ', '').replace('text', ''))).toEqual(['ț', 'Î', 'â', 'î', 'ă', 'Â', 'Ș', 'ș', 'Ă', 'Ț', 'ț', '-', '’', '”', '„'])
    expect(p.meta).toMatchObject({ author: 'Ioan Lucuț', album: 'Biserica Emanuel Sibiu 2023' })
    expect(p.arrangements).toHaveLength(1)
    expect(p.slides[0].actions?.[0]).toMatchObject({ type: 'macro.run', params: { name: 'Songs' } })
  })
  it('maps scale-font-down to autoFit and bold from RTF', () => {
    const t = texts(p.slides[1].elements)[0]
    expect(t.autoFit).toBe(true)
    expect(Number(t.style.fontWeight)).toBeGreaterThanOrEqual(700)
  })
})

describe('PP7 helpers', () => {
  it('hot keys', () => {
    expect(hotKeyOf({ code: 'KEY_CODE_ANSI_T' })).toBe('T')
    expect(hotKeyOf({ code: 'KEY_CODE_F5' })).toBe('F5')
    expect(hotKeyOf({ code: 'KEY_CODE_ANSI_KEYPAD_1' })).toBe('Num1')
    expect(hotKeyOf({})).toBeUndefined()
  })
  it('font names', () => {
    expect(fontFromName('HelveticaNeue-BoldItalic', 'Helvetica Neue')).toEqual({ family: 'Helvetica Neue', weight: 700, italic: true })
    expect(fontFromName('ArialMT', 'Arial')).toEqual({ family: 'Arial', weight: undefined, italic: undefined })
    expect(fontFromName('Montserrat-SemiBold').family).toBe('Montserrat')
    expect(fontFromName('Montserrat-SemiBold').weight).toBe(600)
  })
  it('URLs: macOS file URLs, Windows paths, root-relative', () => {
    expect(parsePP7Url({ absolute_string: 'file:///Users/a/My%20Song.png', local: { root: 'ROOT_SHOW', path: 'Media/My Song.png' } }))
      .toMatchObject({ absolute: '/Users/a/My Song.png', root: 'ROOT_SHOW', relative: 'Media/My Song.png', basename: 'My Song.png' })
    expect(parsePP7Url({ absolute_string: 'C:\\Users\\chris\\avatar.png' })).toMatchObject({ absolute: 'C:\\Users\\chris\\avatar.png', basename: 'avatar.png' })
    expect(parsePP7Url({ absolute_string: 'https://x.org/a.png?x=1', platform: 'PLATFORM_WEB' })).toMatchObject({ web: 'https://x.org/a.png?x=1', basename: 'a.png' })
  })
})
