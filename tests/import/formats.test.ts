import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { plainText, type TextElement } from '@shared/model'
import { importLyricsText, parseSectionHeading, lyricsTextOf } from '@shared/import-lyrics'
import { importChordPro, importOpenLyrics, importOpenSong, importSongSelectText, importSongSelectUsr } from '@main/services/importers/text/lyrics'
import { convertPro6 } from '@main/services/importers/pp6/pro6'
import { detectFormat } from '@main/services/importers/pipeline/detect'
import { convertPptx } from '@main/services/importers/office/pptx'
import { writeZip } from '@main/services/importers/util/zip'
import { buildReachBundle, encodeProLyrics, openLyricsExport, songCsv } from '@main/services/exporters/formats'
import { importReachBundle } from '@main/services/exporters/bundle-import'
import { convertPP7Presentation } from '@main/services/importers/pp7/presentation'
import { FolderTarget } from '@main/services/importers/pipeline/target'

const S = join(__dirname, '../../vendor/pp7-samples')
const texts = (s: { elements: { type: string }[] }) => s.elements.filter((e): e is TextElement => e.type === 'text').map(plainText)

describe('shared lyrics helper', () => {
  it('section headings', () => {
    expect(parseSectionHeading('Verse 1')).toBe('Verse 1')
    expect(parseSectionHeading('[Chorus]')).toBe('Chorus')
    expect(parseSectionHeading('CHORUS 2:')).toBe('Chorus 2')
    expect(parseSectionHeading('Pre-Chorus')).toBe('Pre-Chorus')
    expect(parseSectionHeading('Bridge (x2)')).toBe('Bridge (x2)')
    expect(parseSectionHeading('V1')).toBe('Verse 1')
    expect(parseSectionHeading('C')).toBeNull()
    expect(parseSectionHeading('Chorus of angels sing')).toBeNull()
  })
  it('importLyricsText builds groups, slides, arrangement from a sequence', () => {
    const p = importLyricsText('Test', 'Intro line\n\nVerse 1\nA\nB\n\nC\n\nChorus\nD', { author: 'X', ccliNumber: '1', sequence: ['Verse 1', 'Chorus', 'Chorus'] })
    expect(p.slides.map((s) => texts(s)[0])).toEqual(['Intro line', 'A\nB', 'C', 'D'])
    expect(p.groups.map((g) => [g.name, g.slideIds.length])).toEqual([['Verse 1', 2], ['Chorus', 1]])
    expect(p.arrangements[0].groupIds).toHaveLength(3)
    expect(p.meta).toMatchObject({ author: 'X', ccliNumber: '1' })
    expect(lyricsTextOf(p)).toContain('Verse 1\nA\nB')
  })
})

describe('CCLI SongSelect', () => {
  it('.txt', () => {
    const r = importSongSelectText(`Way Maker\n\nVerse 1\nYou are here moving in our midst\nI worship You\n\nChorus 1\nWay maker miracle worker\n\nCCLI Song # 7115744\nOsinachi Kalu Okoro Egbu\n© 2016 Integrity Music Europe\nFor use solely with the SongSelect® Terms of Use.  All rights reserved. www.ccli.com\nCCLI License # 1234567\n`)
    const p = r.presentation
    expect(p.title).toBe('Way Maker')
    expect(p.groups.map((g) => g.name)).toEqual(['Verse 1', 'Chorus 1'])
    expect(p.meta).toMatchObject({ ccliNumber: '7115744', ccliLicense: '1234567', author: 'Osinachi Kalu Okoro Egbu', copyright: '© 2016 Integrity Music Europe' })
  })
  it('.usr', () => {
    const r = importSongSelectUsr('[File]\nType=SongSelect Import File\nVersion=3.0\n[S A22025]\nTitle=Amazing Grace\nAuthor=John Newton | Edwin Excell\nCopyright=Public Domain\nThemes=Grace/tSalvation\nKeys=G\nFields=Verse 1/tVerse 2\nWords=Amazing grace how sweet the sound/nThat saved a wretch like me/n/nI once was lost/tTwas grace that taught/nMy heart to fear')
    const p = r.presentation
    expect(p.title).toBe('Amazing Grace')
    expect(p.meta).toMatchObject({ ccliNumber: '22025', author: 'John Newton, Edwin Excell', key: 'G' })
    expect(p.groups.map((g) => [g.name, g.slideIds.length])).toEqual([['Verse 1', 2], ['Verse 2', 1]])
  })
})

describe('ChordPro / OpenLyrics / OpenSong', () => {
  it('ChordPro strips chords, keeps sections and metadata', () => {
    const r = importChordPro('{title: Holy}\n{artist: Someone}\n{ccli: 123}\n{key: D}\n{start_of_verse}\n[D]Holy [G]holy\n[A]Lord God\n{end_of_verse}\n\n{soc}\n[G]Glory\n{eoc}\n# comment')
    expect(r.chords).toBe(4)
    expect(r.presentation.title).toBe('Holy')
    expect(r.presentation.groups.map((g) => g.name)).toEqual(['Verse 1', 'Chorus'])
    expect(texts(r.presentation.slides[0])[0]).toBe('Holy holy\nLord God')
    expect(r.presentation.meta).toMatchObject({ artist: 'Someone', ccliNumber: '123', key: 'D' })
  })
  it('.pro extension is detected by content (ChordPro text vs ProPresenter binary)', () => {
    expect(detectFormat('x.pro', Buffer.from('{title: X}\n[C]la'))).toBe('chordpro')
    expect(detectFormat('x.pro', readFileSync(join(S, 'bussnet_test-translated.pro')))).toBe('pp7-presentation')
    expect(detectFormat('x.probundle', readFileSync(join(S, 'bussnet_pp-export.probundle')))).toBe('pp7-bundle')
    expect(detectFormat('x.pro6', readFileSync(join(S, 'legacy/v6 - Amazing Grace.pro6')))).toBe('pp6-presentation')
  })
  it('OpenLyrics with verseOrder and chords', () => {
    const r = importOpenLyrics(`<?xml version="1.0"?><song xmlns="http://openlyrics.info/namespace/2009/song" version="0.8"><properties><titles><title>Test Song</title></titles><authors><author>A</author><author>B</author></authors><ccliNo>999</ccliNo><verseOrder>v1 c v1</verseOrder></properties><lyrics><verse name="v1"><lines>Line <chord name="G"/>one<br/>Line two</lines></verse><verse name="c"><lines>Chorus</lines></verse></lyrics></song>`)
    expect(r.presentation.groups.map((g) => g.name)).toEqual(['Verse 1', 'Chorus'])
    expect(texts(r.presentation.slides[0])[0]).toBe('Line one\nLine two')
    expect(r.presentation.arrangements[0].groupIds).toHaveLength(3)
    expect(r.presentation.meta).toMatchObject({ author: 'A, B', ccliNumber: '999' })
  })
  it('OpenSong', () => {
    const r = importOpenSong('<song><title>OS</title><author>Z</author><lyrics>[V1]\n.G    C\n Hello world\n Second\n||\n Next slide\n[C]\n Chorus here</lyrics><presentation>V1 C V1</presentation></song>')
    expect(r.presentation.groups.map((g) => [g.name, g.slideIds.length])).toEqual([['Verse 1', 2], ['Chorus', 1]])
    expect(texts(r.presentation.slides[0])[0]).toBe('Hello world\nSecond')
  })
})

describe('ProPresenter 4–6', () => {
  it('.pro6 groups, arrangement, base64 text', () => {
    const r = convertPro6(readFileSync(join(S, 'legacy/v6 - Amazing Grace.pro6'), 'utf8'))
    const p = r.presentation
    expect(p.size).toEqual({ width: 1920, height: 1080 })
    expect(p.groups.map((g) => g.name)).toEqual(['Blank', 'Verse 1', 'Verse 2', 'Verse 3', 'Verse 4'])
    expect(p.groups[1].color).toBe('#0000FF')
    expect(p.arrangements[0]).toMatchObject({ name: 'Worship' })
    expect(texts(p.slides[1])[0]).toBe('Amazing grace how sweet the sound\nThat saved a wretch like me')
    expect(p.meta.artist).toBe('John Newton')
  })
  it('.pro6 feature test: element order, rotation direction, background, media cue', () => {
    const p = convertPro6(readFileSync(join(S, 'legacy/v6 - Feature Test.pro6'), 'utf8')).presentation
    const s = p.slides.find((x) => x.label === 'Spoken Word')!
    expect(s.elements.map((e) => [e.name, e.rotation])).toEqual([['first box', 354], ['2nd box', 14]]) // matches the PP7 conversion of the same document
    expect(p.slides.find((x) => x.actions?.length)!.actions![0]).toMatchObject({ type: 'media.play', params: { media: { name: 'ImageSample1' } } })
  })
  it('.pro5 arrangement and .pro4 label-based groups', () => {
    const p5 = convertPro6(readFileSync(join(S, 'legacy/v5 - Be Near.pro5'), 'utf8')).presentation
    expect(p5.arrangements[0].groupIds.length).toBe(14)
    const p4 = convertPro6(readFileSync(join(S, 'legacy/v4 - Be Near.pro4'), 'utf8')).presentation
    expect(p4.groups.map((g) => g.name)).toContain('Chorus 1')
    expect(texts(p4.slides[1])[0]).toMatch(/^Be near O God/)
  })
})

describe('PowerPoint', () => {
  it('extracts text boxes, sizes and notes from a minimal .pptx', () => {
    const x = (s: string) => Buffer.from(s)
    const pptx = writeZip({
      'ppt/presentation.xml': x('<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>'),
      'ppt/_rels/presentation.xml.rels': x('<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/></Relationships>'),
      'ppt/slides/slide1.xml': x('<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="9144000" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="4400" b="1"><a:solidFill><a:srgbClr val="ff0000"/></a:solidFill></a:rPr><a:t>Welcome</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'),
      'ppt/slides/_rels/slide1.xml.rels': x('<Relationships><Relationship Id="rId9" Target="../notesSlides/notesSlide1.xml"/></Relationships>'),
      'ppt/notesSlides/notesSlide1.xml': x('<p:notes xmlns:p="p" xmlns:a="a"><a:t>Say hello</a:t></p:notes>')
    })
    const r = convertPptx(pptx)
    expect(r.presentation.size).toEqual({ width: 1280, height: 720 })
    const t = r.presentation.slides[0].elements[0] as TextElement
    expect(t).toMatchObject({ role: 'title', align: 'center', frame: { x: 96, y: 96, w: 960, h: 96 } })
    expect(t.paragraphs[0].runs[0]).toMatchObject({ text: 'Welcome', style: { fontSize: 59, fontWeight: 700, color: '#FF0000' } })
    expect(r.presentation.slides[0].notes).toBe('Say hello')
  })
})

describe('exports', () => {
  const p = convertPP7Presentation(readFileSync(join(S, 'bussnet_test-translated.pro'))).presentation
  it('experimental lyrics-only .pro round-trips through our decoder', () => {
    const back = convertPP7Presentation(encodeProLyrics(p)).presentation
    expect(back.title).toBe(p.title)
    expect(back.slides.length).toBe(p.slides.length)
    expect(back.groups.map((g) => g.name)).toEqual(p.groups.map((g) => g.name))
    expect(back.arrangements.map((a) => [a.name, a.groupIds.length])).toEqual(p.arrangements.map((a) => [a.name, a.groupIds.length]))
    expect(texts(back.slides[1])[0]).toBe(texts(p.slides[1]).find((t) => t.startsWith('You call'))!)
    expect(back.meta.ccliNumber).toBe('6428767')
  })
  it('CSV song list escapes and guards against formula injection', () => {
    const csv = songCsv([{ ...p, title: '=HYPERLINK("x")' }])
    expect(csv.split('\r\n')[0]).toMatch(/^Title,CCLI Song Number/)
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv).toContain('6428767')
  })
  it('OpenLyrics export re-imports', () => {
    const r = importOpenLyrics(openLyricsExport(p))
    expect(r.presentation.title).toBe(p.title)
    expect(r.presentation.groups.length).toBeGreaterThan(3)
  })
  it('.reachbundle export → import into another workspace, with media', async () => {
    const pres = { ...p, slides: [{ ...p.slides[0], background: { type: 'media' as const, media: { kind: 'image' as const, src: 'workspace:ProPresenter/bg.png' } } }, ...p.slides.slice(1)] }
    const b = buildReachBundle({ presentations: [pres], playlists: [{ id: 'pl1', name: 'Sunday', items: [{ id: 'i1', type: 'presentation', presentationId: pres.id }], updatedAt: '' }], readMedia: (src) => (src.endsWith('bg.png') ? Buffer.from('PNGDATA') : null) })
    expect(b.manifest.media).toHaveLength(1)
    const ws = mkdtempSync(join(tmpdir(), 'reach-b-'))
    const t = new FolderTarget(ws)
    const r = await importReachBundle(b.bytes, t, 'x.reachbundle')
    expect(r.presentationIds).toEqual([pres.id])
    expect(readFileSync(join(ws, 'media/ProPresenter/bg.png'), 'utf8')).toBe('PNGDATA')
    expect((await t.getPresentation(pres.id))!.title).toBe(p.title)
    expect((await t.listPlaylists())[0].name).toBe('Sunday')
    const again = await importReachBundle(b.bytes, t, 'x.reachbundle')
    expect(again.reports[0].status).toBe('unchanged')
  })
})
