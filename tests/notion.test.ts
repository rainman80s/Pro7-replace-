import { describe, expect, it } from 'vitest'
import { blocksToSpecs, runsText, specToDraft, type SlideSpec } from '@main/services/notion/blocks'
import { fillScripture, specToSlides } from '@main/services/notion/layout'
import { autoDetect, pageMatches, summarize, type NPage } from '@main/services/notion/client'
import { syncDocSlides, renderHash } from '@main/services/integrations/docsync'
import { slideText, type Presentation, type TextElement } from '@shared/model'
import { b, bullet, divider, h1, h2, h3, highlightsPage, image, numbered, p, quote, reset, sermonPage, toggle } from './fixtures/notion'

let k = 0
const newId = (): string => `s${++k}`
const opts = { mode: 'auto' as const, maxChars: 340, defaultTranslation: 'CSB' }
const body = (s: SlideSpec): string[] => s.body.map(runsText)

describe('Notion sermon page → slides (Reach template)', () => {
  const { specs, mode, warnings } = blocksToSpecs(sermonPage(), opts)
  it('uses divider mode and skips the synced boilerplate + child pages', () => {
    expect(mode).toBe('dividers')
    expect(specs.map((s) => specToDraft(s).label)).not.toContain('Reflection Comments')
    expect(specs.map((s) => specToDraft(s).label)).not.toContain('Sermon Slide Requests')
    expect(warnings).toEqual([])
  })
  it('produces one slide per divider segment, in order, skipping empty ones', () => {
    expect(specs.map((s) => s.kind)).toEqual(['title', 'scripture', 'points', 'points', 'quote', 'image', 'scripture', 'scripture', 'title', 'text'])
  })
  it('keeps pasted scripture text with its reference, and the responsive reading', () => {
    const s = specs[1]
    expect(s.reference).toBe('Hosea 6:1-3 (ESV)')
    expect(body(s)[0]).toMatch(/^“1 Come, let us return/)
    expect(body(s).slice(1)).toEqual(['Leader: This is the Word of the Lord!', 'Church: Thanks be to God!'])
  })
  it('H2 + H2s and H2 + H3s become a title with points', () => {
    expect(runsText(specs[2].title!)).toBe('LOOK UP')
    expect(body(specs[2])).toEqual(['LOOK IN', 'LOOK OUT'])
    expect(runsText(specs[3].title!)).toBe('WHAT IS THIS LETTER?')
    expect(body(specs[3])).toEqual(['1. A LETTER', '2. A PROMISE'])
  })
  it('detects a quote with attribution', () => {
    expect(specs[4].kind).toBe('quote')
    expect(specs[4].attribution).toBe('Example Author')
  })
  it('a reference on its own is filled from the Bible with the default translation', () => {
    expect(specs[6].fill).toEqual([{ book: 'ACT', chapter: 16, verse: 14, endChapter: 16, endVerse: 14, translation: 'CSB' }])
  })
  it('several reference + text pairs stay on one slide with reference lines inline', () => {
    const s = specs[7]
    expect(s.reference).toBeUndefined()
    expect(s.body.filter((x) => x[0].ref).map(runsText)).toEqual(['Hebrews 12:29 (ESV)', 'Malachi 3:2–3 (ESV)'])
    expect(s.body[1].find((r) => r.bold)?.text).toBe('consuming fire')
  })
  it('toggle "Notes" becomes speaker notes', () => {
    expect(specs[9].notes).toEqual(['Pause here and let it land.'])
  })
  it('keys are block ids and stable between runs', () => {
    const again = blocksToSpecs(sermonPage(), opts).specs
    expect(again.map((s) => [s.key, s.srcHash])).toEqual(specs.map((s) => [s.key, s.srcHash]))
  })
  it('editing one block only changes that slide’s hash', () => {
    const page = sermonPage()
    const idx = page.findIndex((x) => x.type === 'heading_1' && JSON.stringify(x).includes('SEE THE RIVER'))
    ;(page[idx].heading_1 as { rich_text: { plain_text: string }[] }).rich_text[0].plain_text = '1. SEE THE OCEAN'
    const next = blocksToSpecs(page, opts).specs
    const changed = next.filter((s, i) => s.srcHash !== specs[i].srcHash)
    expect(changed.map((s) => runsText(s.title ?? []))).toEqual(['1. SEE THE OCEAN'])
  })
})

describe('other conventions', () => {
  it('headings mode: every H1/H2 starts a slide; bullets are points; comments → notes; "one at a time" → builds', () => {
    reset()
    const blocks = [h1('Big Idea'), p('Rivers move.'), h2('Three things'), bullet('One'), bullet('Two', [bullet('Two-a')]), numbered('Three'), image('pic.png', 'A river'), h2('After')]
    const comments = { [blocks[3].id]: ['one at a time'] }
    const { specs, mode } = blocksToSpecs(blocks, { ...opts, comments })
    expect(mode).toBe('headings')
    expect(specs.map((s) => s.kind)).toEqual(['point', 'points', 'image', 'title'])
    expect(body(specs[1])).toEqual(['• One', '• Two', '   – Two-a', 'Three'])
    expect(specs[1].notes).toEqual(['one at a time'])
    expect(specs[1].reveal).toBe(true)
    expect(specs[2].image).toMatchObject({ name: 'pic.png', caption: 'A river' })
    const slides = specToSlides(specs[1], { newId })
    expect(slides[0].elements.filter((e) => e.type === 'text' && (e as TextElement).buildIn).length).toBe(4)
  })
  it('[slide] / --- paragraphs act as dividers; quote blocks are quote slides', () => {
    reset()
    const { specs } = blocksToSpecs([p('First'), p('[slide]'), quote('A quote block here'), p('— Someone'), p('---'), p('Third')], opts)
    expect(specs.map((s) => s.kind)).toEqual(['text', 'quote', 'text'])
    expect(specs[1].attribution).toBe('Someone')
  })
  it('other toggles are hidden notes; "Slides" toggles are content', () => {
    reset()
    const { specs } = blocksToSpecs([h1('Point'), toggle('Background reading', [p('Hidden detail')]), divider(), toggle('Slides', [h1('Inside')])], opts)
    expect(specs.map((s) => runsText(s.title ?? []))).toEqual(['Point', 'Inside'])
    expect(specs[0].notes).toEqual(['Background reading', 'Hidden detail'])
  })
  it('splits long pasted scripture across slides, repeating the reference', () => {
    reset()
    const long = Array.from({ length: 14 }, (_, i) => `${i + 1} This is sentence number ${i + 1} of a long passage.`).join(' ')
    const { specs } = blocksToSpecs([p('Romans 8:1-14 (ESV)'), p(long)], { ...opts, maxChars: 200 })
    expect(specs.length).toBeGreaterThan(2)
    expect(specs.every((s) => s.kind === 'scripture' && s.reference === 'Romans 8:1-14 (ESV)')).toBe(true)
    expect(specs.map((s) => body(s).join(' ')).join(' ').replace(/\s+/g, ' ')).toBe(long)
    expect(new Set(specs.map((s) => s.key)).size).toBe(specs.length)
  })
  it('bold in scripture becomes underline (Reach convention), bold elsewhere stays bold', () => {
    reset()
    const { specs } = blocksToSpecs([p('John 3:16 (ESV)'), p('For God so ', b('loved'), ' the world'), divider(), p('Plain ', b('bold'))], opts)
    const s1 = specToSlides(specs[0], { newId, emphasis: 'underline' })[0]
    const runs = (s1.elements[0] as TextElement).paragraphs[0].runs
    expect(runs.find((r) => r.text === 'loved')?.style).toEqual({ underline: true })
    expect(slideText(s1, 'reference')).toBe('John 3:16 (ESV)')
    const s2 = specToSlides(specs[1], { newId, emphasis: 'underline' })[0]
    expect((s2.elements[0] as TextElement).paragraphs[0].runs[1].style).toEqual({ fontWeight: 700 })
  })
})

describe('announcements page → loop', () => {
  const { specs, mode } = blocksToSpecs(highlightsPage(), opts)
  it('one slide per "Slide N" with HEADING/DETAILS and image background', () => {
    expect(mode).toBe('announcement')
    expect(specs).toHaveLength(2)
    expect(runsText(specs[0].title!)).toBe('Annual Report')
    expect(body(specs[0])).toEqual(['Read the stories of what God is doing', 'Pick one up in the lobby'])
    expect(specs[0].image?.name).toBe('IMG_0001.heic')
  })
  it('talking points after the divider go to the matching slide’s notes', () => {
    expect(specs[0].notes).toEqual(['• First one in a few years', '• Stories are the story'])
    expect(specs[1].notes).toEqual(['Volunteers needed to bring food.'])
  })
  it('lays out with auto-advance and the image as background', () => {
    const media = { [specs[1].image!.blockId]: { kind: 'image' as const, src: 'workspace:notion/x.jpg' } }
    const [s] = specToSlides(specs[1], { newId, media, autoAdvance: 8 })
    expect(s.autoAdvance).toBe(8)
    expect(s.background).toMatchObject({ type: 'media', fit: 'cover' })
    expect(slideText(s, 'title')).toBe('Family Brunch')
  })
})

describe('scripture fill', () => {
  it('builds scripture slides from the Bible lookup, with a placeholder when offline', async () => {
    reset()
    const { specs } = blocksToSpecs([p('Acts 16:14-15')], opts)
    const ok = await fillScripture(specs[0], async () => [{ verses: [{ book: 'ACT', chapter: 16, verse: 14, text: 'One who heard us.' }, { book: 'ACT', chapter: 16, verse: 15, text: 'And when she was baptized.' }], translation: 'BSB' }], { newId, maxChars: 300 })
    expect(ok.slides).toHaveLength(1)
    expect(slideText(ok.slides[0], 'reference')).toBe('Acts 16:14–15 (BSB)')
    const off = await fillScripture(specs[0], async () => { throw new Error('offline') }, { newId, maxChars: 300 })
    expect(off.slides).toHaveLength(1)
    expect(off.warnings.join(' ')).toMatch(/offline/)
  })
})

describe('Notion database mapping', () => {
  const dbs = [
    { id: 'db-svc', title: 'Services', properties: [{ name: 'Text and Passage Description', type: 'title' }, { name: 'Date', type: 'date' }, { name: 'Speaker', type: 'people' }, { name: 'Type', type: 'multi_select', options: ['Sunday Service', 'Worship Night'] }, { name: 'Series (Project Database)', type: 'relation' }] },
    { id: 'db-comms', title: 'Comms Channels', properties: [{ name: 'Name', type: 'title' }, { name: 'Date', type: 'date' }, { name: 'Status', type: 'status', options: ['Planning', 'Posted/Scheduled', 'Scrapped/Missed'] }, { name: 'Channel', type: 'multi_select', options: ['Email', 'Sunday Highlight'] }] },
    { id: 'db-other', title: 'Meetings', properties: [{ name: 'Name', type: 'title' }] }
  ]
  it('auto-detects Reach’s databases and properties', () => {
    const d = autoDetect(dbs)
    expect(d.sermons).toEqual({ databaseId: 'db-svc', title: 'Text and Passage Description', date: 'Date', speaker: 'Speaker', status: undefined, series: 'Series (Project Database)', filterProp: 'Type', filterValue: 'Sunday Service' })
    expect(d.announcements).toMatchObject({ databaseId: 'db-comms', date: 'Date', status: 'Status', titleContains: 'Highlight', excludeStatus: ['Scrapped/Missed'] })
  })
  it('filters and summarises pages', () => {
    const page: NPage = { id: 'pg', properties: {
      Name: { type: 'title', title: [{ type: 'text', plain_text: 'Sunday Highlights' }] },
      Date: { type: 'date', date: { start: '2026-03-01' } },
      Status: { type: 'status', status: { name: 'Posted/Scheduled' } }
    } }
    const m = autoDetect(dbs).announcements!
    expect(pageMatches(page, m)).toBe(true)
    expect(pageMatches({ ...page, properties: { ...page.properties, Status: { type: 'status', status: { name: 'Scrapped/Missed' } } } }, m)).toBe(false)
    expect(summarize(page, m)).toMatchObject({ title: 'Sunday Highlights', date: '2026-03-01', status: 'Posted/Scheduled' })
  })
})

describe('document re-sync', () => {
  const gen = (key: string, text: string) => ({ key, srcHash: text, slide: { id: newId(), label: text, elements: [{ id: newId(), type: 'text' as const, frame: { x: 0, y: 0, w: 1, h: 1 }, style: {}, paragraphs: [{ runs: [{ text }] }] }] } })
  const pres = (slides: Presentation['slides'], source: unknown): Presentation => ({ id: 'p', title: 't', size: { width: 1920, height: 1080 }, slides, groups: [], arrangements: [], meta: { source: source as never }, createdAt: '', updatedAt: '' })

  it('adds, updates untouched slides, keeps restyled ones on conflict, removes deleted', () => {
    const first = syncDocSlides(null, 'notion', 'page', [gen('a', 'A'), gen('b', 'B'), gen('c', 'C')])
    expect(first.changes.filter((c) => c.type !== 'same')).toEqual([])
    const p = pres(first.slides, first.source)
    // operator restyles slide b, adds a local slide after a
    const restyled = { ...p.slides[1], elements: [{ ...(p.slides[1].elements[0] as TextElement), style: { color: 'red' } }] }
    expect(renderHash(restyled)).not.toBe(renderHash(p.slides[1]))
    const local = { id: 'local', elements: [] }
    const edited = pres([p.slides[0], local, restyled, p.slides[2]], first.source)
    const r = syncDocSlides(edited, 'notion', 'page', [gen('a', 'A2'), gen('b', 'B2'), gen('d', 'D')])
    const byKey = Object.fromEntries(r.changes.map((c) => [c.key, c.type]))
    expect(byKey).toEqual({ a: 'changed', b: 'conflict', d: 'added', c: 'removed' })
    expect(r.slides.map((s) => s.label ?? s.id)).toEqual(['A2', 'local', 'B', 'D'])
    expect(r.slides[0].id).toBe(p.slides[0].id) // id kept → live/playlist references survive
    // accepting the conflict takes the new text
    const r2 = syncDocSlides(edited, 'notion', 'page', [gen('a', 'A2'), gen('b', 'B2')], { decisions: { b: 'accept' } })
    expect(r2.slides.find((s) => s.id === restyled.id)?.label).toBe('B2')
    // rejected conflict is not asked again until the source changes again
    const after = pres(r.slides, r.source)
    const r3 = syncDocSlides(after, 'notion', 'page', [gen('a', 'A2'), gen('b', 'B2'), gen('d', 'D')])
    expect(r3.changes.filter((c) => c.type !== 'same')).toEqual([])
  })
  it('a slide the operator deleted stays deleted unless its source changes', () => {
    const first = syncDocSlides(null, 'notion', 'page', [gen('a', 'A'), gen('b', 'B')])
    const p = pres([first.slides[0]], first.source)
    expect(syncDocSlides(p, 'notion', 'page', [gen('a', 'A'), gen('b', 'B')]).slides).toHaveLength(1)
    const changed = syncDocSlides(p, 'notion', 'page', [gen('a', 'A'), gen('b', 'B!')])
    expect(changed.slides).toHaveLength(2)
  })
})
