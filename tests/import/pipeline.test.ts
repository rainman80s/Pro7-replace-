import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, beforeAll } from 'vitest'
import type { Playlist, Presentation, TextElement } from '@shared/model'
import { plainText } from '@shared/model'
import { scanFolder } from '@main/services/importers/pipeline/scan'
import { runImport, itemsForFiles } from '@main/services/importers/pipeline/run'
import { FolderTarget, DryRunTarget } from '@main/services/importers/pipeline/target'
import { readZip } from '@main/services/importers/util/zip'
import { convertPP7Presentation } from '@main/services/importers/pp7/presentation'
import { reportToText } from '@main/services/importers/pipeline/report'
import { buildFakeProPresenterFolder, syntheticPresentation, zip64WithPPBug, PNG_1PX, SYN } from './synthetic'

const SAMPLES = join(__dirname, '../../vendor/pp7-samples')

describe('synthetic .pro (encoded with the vendored protos)', () => {
  const r = convertPP7Presentation(syntheticPresentation())
  const p = r.presentation
  it('maps cues to namespaced actions and preserves unknown ones', () => {
    const [s1, s2, s3] = p.slides
    expect(s1.actions!.map((a) => a.type)).toEqual(['media.play', 'timer.restart', 'midi.send'])
    expect(s1.actions![0].params).toMatchObject({ layer: 'background', loop: true, fit: 'cover', media: { kind: 'video' } })
    expect(s1.actions![1].params).toMatchObject({ name: 'Sermon', kind: 'countdown', duration: 1800 })
    expect(s1.actions![2].params).toMatchObject({ type: 'noteOn', channel: 2, note: 60, velocity: 100, device: 'Lighting desk' })
    expect(s2.enabled).toBe(false)
    expect(s2.actions!.map((a) => a.type)).toEqual(['live.clear', 'stage.setLayout', 'capture.control'])
    expect(s3.actions!.map((a) => a.type)).toEqual(['macro.run', 'media.play'])
    expect(s3.actions![1].params).toMatchObject({ layer: 'audio', volume: 0.5 })
    expect(s3.autoAdvance).toBe(8)
    expect((p.meta.source as unknown as { unmapped: { type: string }[] }).unmapped.map((u) => u.type)).toEqual(['ACTION_TYPE_SOCIAL_MEDIA'])
    expect(r.unknownFields).toEqual({ 'rv.data.Presentation#99': 1 })
  })
  it('keeps arrangement repeats, the selected arrangement, hot keys and CCLI', () => {
    expect(p.arrangements[0].groupIds).toHaveLength(5)
    expect(p.activeArrangementId).toBe(p.arrangements[0].id)
    expect(p.slides[0].hotKey).toBe('1')
    expect(p.meta).toMatchObject({ ccliNumber: '7654321', author: 'A. Writer', key: 'G', copyright: '© 2024 Test Music' })
  })
  it('converts dynamic text, gradients, rounded shapes, translation roles', () => {
    const s4 = p.slides[3]
    const dyn = s4.elements.filter((e): e is TextElement => e.type === 'text' && !!e.dynamic).map(plainText)
    expect(dyn.sort()).toEqual(['Time: {clock}', '{timer:Sermon}'])
    const grad = p.slides[2].elements.find((e) => e.name === 'Gradient')!
    expect(grad).toMatchObject({ type: 'shape', cornerRadius: 45, fill: { type: 'gradient', stops: [{ at: 0 }, { at: 1 }] } })
    const roles = p.slides[0].elements.filter((e): e is TextElement => e.type === 'text').map((t) => t.role)
    expect(roles.sort()).toEqual(['lyrics', 'translation'])
    const lyr = p.slides[0].elements.find((e): e is TextElement => e.type === 'text' && e.role === 'lyrics')!
    expect(lyr).toMatchObject({ verticalAlign: 'bottom', autoFit: true, style: { fontFamily: 'Helvetica Neue', fontWeight: 700, color: '#FFCC00', fontSize: 42 } })
  })
})

describe('tolerant ZIP reader', () => {
  it('opens ProPresenter-style ZIP64 archives with the 98-byte offset bug', () => {
    const z = zip64WithPPBug([{ name: 'a.pro', data: Buffer.from('hello') }, { name: '/Users/x/Media/p.png', data: PNG_1PX }])
    const r = readZip(z)
    expect(r.entries.map((e) => e.name)).toEqual(['a.pro', '/Users/x/Media/p.png'])
    expect(Buffer.from(r.entries[0].read()).toString()).toBe('hello')
    expect(r.notes.join(' ')).toMatch(/repaired ZIP64/)
  })
  it('reads the real exported bundle + playlists', () => {
    for (const f of ['bussnet_pp-export.probundle', 'exports/TestBild.probundle', 'exports/TestPlaylist.proplaylist', 'exports/EmptyPlaylist.proplaylist']) {
      const r = readZip(readFileSync(join(SAMPLES, f)))
      expect(r.entries.length).toBeGreaterThan(0)
      for (const e of r.entries) expect(e.read().length).toBe(e.size)
    }
  })
  it('falls back to local headers when the central directory is gone', () => {
    const z = zip64WithPPBug([{ name: 'x.txt', data: Buffer.from('abc') }])
    const r = readZip(z.subarray(0, 30 + 5 + 3))
    expect(r.entries.map((e) => e.name)).toEqual(['x.txt'])
  })
})

describe('whole-library migration', () => {
  let pp: string
  let ws: string
  let first: Awaited<ReturnType<typeof runImport>>
  beforeAll(async () => {
    pp = mkdtempSync(join(tmpdir(), 'pp-'))
    ws = mkdtempSync(join(tmpdir(), 'reach-ws-'))
    buildFakeProPresenterFolder(pp, SAMPLES)
    const scan = await scanFolder(pp)
    first = await runImport(scan, new FolderTarget(ws))
  })
  it('scans: generation, libraries, census', async () => {
    const scan = await scanFolder(pp)
    expect(scan.generation).toBe('pp7-files')
    expect(scan.libraries.map((l) => l.name)).toEqual(['Bundles', 'Default', 'Hymns'].filter((n) => n !== 'Bundles').concat([]).sort())
    expect(scan.census.find((c) => c.ext === '.pro')?.count).toBe(8)
    expect(scan.counts.configs).toBe(14)
  })
  it('imports presentations, media, playlists, docs and reports problems', async () => {
    expect(first.totals.failed).toBe(0)
    const target = new FolderTarget(ws)
    const list = await target.listPresentations()
    expect(list.length).toBe(9) // 8 .pro + 1 bundle
    const syn = list.find((p) => p.title === 'Synthetic Song')!
    const bg = syn.slides[0].actions![0].params!.media as { src: string }
    expect(bg.src).toBe('workspace:ProPresenter/Backgrounds/waves.mp4')
    expect(existsSync(join(ws, 'media/ProPresenter/Backgrounds/waves.mp4'))).toBe(true)
    const feature = list.find((p) => p.title === 'Feature Test')!
    expect(JSON.stringify(feature)).toContain('workspace:ProPresenter/Images/avatar.png') // found by file name
    expect(first.media.missing.some((m) => m.includes('Clouds.jpg'))).toBe(true)
    const bundled = list.find((p) => (p.meta.source as { ref: string }).ref.includes('Bundle Export.probundle'))!
    expect(JSON.stringify(bundled)).toContain('workspace:ProPresenter/test-background.png')
    const pls: Playlist[] = await target.listPlaylists()
    const sunday = pls.find((p) => p.name === 'Sunday 2026-11-15')!
    expect(sunday.folder).toBe('2026')
    expect(sunday.date).toBe('2026-11-15')
    expect(sunday.items.map((i) => i.type)).toEqual(['header', 'presentation', 'placeholder', 'placeholder'])
    expect(sunday.items[1]).toMatchObject({ presentationId: syn.id, arrangementId: 'eeeeeeee000000000000000000000002' })
    expect(first.playlists[0].unresolved).toEqual(['Missing Song'])
    for (const d of ['macros', 'stageLayouts', 'themes', 'pp7-screens', 'pp7-devices']) expect(existsSync(join(ws, 'docs', `${d}.json`))).toBe(true)
    const timers = JSON.parse(readFileSync(join(ws, 'docs/timers.json'), 'utf8'))
    expect(timers.timers.find((t: { name: string }) => t.name === 'Gottesdienst (10:02)')).toMatchObject({ kind: 'countdownTo', target: '10:02' })
    const stage = JSON.parse(readFileSync(join(ws, 'docs/stageLayouts.json'), 'utf8'))
    expect(JSON.stringify(stage)).toContain('{timer:Predigt Countdown}')
    expect(JSON.stringify(stage)).toContain('{next.text}')
    expect(first.suggestedCanvases.length).toBe(5)
    expect(first.unknownFields['rv.data.Presentation#99']).toBe(1)
    expect(reportToText(first)).toMatch(/Missing media/)
  })
  it('re-import is idempotent; edited presentations are kept unless overwrite is chosen', async () => {
    const target = new FolderTarget(ws)
    const again = await runImport(await scanFolder(pp), target)
    const pres = again.files.filter((f) => f.presentationId)
    expect(pres.map((f) => f.status)).toEqual(Array(9).fill('unchanged'))
    expect((await target.listPresentations()).length).toBe(9)
    // user edits the synthetic song in Reach
    const syn = (await target.listPresentations()).find((p) => p.title === 'Synthetic Song')!
    syn.title = 'Synthetic Song (edited)'
    await target.savePresentations([syn])
    writeFileSync(join(pp, 'Libraries/Default/Synthetic Song.pro'), Buffer.concat([syntheticPresentation(), Buffer.from([0xa0, 0x06, 0x02])])) // ProPresenter side changed too
    const third = await runImport(await scanFolder(pp), target)
    const f = third.files.find((x) => x.title === 'Synthetic Song')!
    expect(f.status).toBe('skipped')
    expect((await target.getPresentation(syn.id))!.title).toBe('Synthetic Song (edited)')
    const forced = await runImport(await scanFolder(pp), target, { onConflict: 'overwrite' })
    expect(forced.files.find((x) => x.title === 'Synthetic Song')!.status).toBe('updated')
    expect((await target.getPresentation(syn.id))!.title).toBe('Synthetic Song')
  })
  it('dry run writes nothing', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'reach-dry-'))
    const r = await runImport(await scanFolder(pp), new FolderTarget(empty), { dryRun: true })
    expect(r.totals.imported + r.totals.partial).toBeGreaterThan(5)
    expect(existsSync(join(empty, 'library'))).toBe(false)
  })
  it('single-file import detects formats by content (incl. .pro ChordPro)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'files-'))
    writeFileSync(join(dir, 'song.pro'), '{title: Chord Song}\n{start_of_chorus}\n[G]Hallelujah [C]praise\n{end_of_chorus}\n')
    const t = new DryRunTarget()
    const r = await runImport({ root: dir, items: itemsForFiles([join(dir, 'song.pro'), join(SAMPLES, 'bussnet_test-translated.pro'), join(SAMPLES, 'legacy/v6 - Amazing Grace.pro6'), join(SAMPLES, 'exports/TestPlaylist.proplaylist')]) }, t)
    expect(r.files.map((f) => f.format)).toEqual(['chordpro', 'pp7-presentation', 'pp6-presentation', 'pp7-playlist', 'pp7-playlist'])
    const titles = [...t.presentations.values()].map((p: Presentation) => p.title)
    expect(titles).toContain('Chord Song')
    expect(t.playlists[0].items.filter((i) => i.type === 'presentation')).toHaveLength(2)
  })
})
