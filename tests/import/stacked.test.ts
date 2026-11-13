import { describe, expect, it } from 'vitest'
import type { SuggestedCanvas } from '@shared/import'
import { deckLinkCardOf, suggestCanvases, suggestStackedCanvases } from '../../src/main/services/importers/pp7/config'
import { ConvertContext } from '../../src/main/services/importers/pp7/context'

/** A ProPresenter 7 screen with one output on a given device (shape of the decoded Workspace protobuf). */
const screen = (name: string, w: number, h: number, device?: { name: string; model?: string; mode?: string }, stage = false): Record<string, unknown> => ({
  uuid: { string: `uuid-${name}` }, name, screen_type: stage ? 'SCREEN_TYPE_STAGE' : 'SCREEN_TYPE_AUDIENCE',
  arrangement_single: { screens: [{ name, bounds: { origin: { x: 0, y: 0 }, size: { width: w, height: h } }, output_display: device ? { name: device.name, model: device.model, mode: device.mode ? { name: device.mode } : undefined } : undefined }] }
})

describe('stacked LED wall suggestion (ProPresenter import)', () => {
  it('suggests "LED Wall (stacked)" for the church’s two Duo 2 outputs, recommended, with Top/Bottom regions', () => {
    const doc = {
      pro_screens: [
        screen('LED WALL', 1920, 880, { name: 'DeckLink Duo (1)', model: 'DeckLink Duo 2', mode: '1080p 29.97' }),
        screen('Key', 1920, 1080, { name: 'DeckLink Duo (2)', model: 'DeckLink Duo 2', mode: '1080p 29.97' }),
        screen('LED LYRICS', 1920, 320, { name: 'DeckLink Duo (3)', model: 'DeckLink Duo 2', mode: '1080p 29.97' }),
        screen('Stage Display', 1920, 1080, { name: 'DeckLink Mini Monitor 4K', mode: '1080p 60' }, true)
      ]
    }
    const { canvases } = suggestCanvases(doc, new ConvertContext(() => 'x'))
    expect(canvases.map((c) => c.name)).toEqual(['LED WALL', 'Key', 'LED LYRICS', 'Stage Display', 'LED Wall (stacked)'])
    const stacked = canvases.at(-1)!
    expect(stacked).toMatchObject({
      kind: 'audience', width: 1920, height: 1200, recommended: true,
      regions: [{ name: 'Top', rect: { x: 0, y: 0, w: 1920, h: 880 } }, { name: 'Bottom', rect: { x: 0, y: 880, w: 1920, h: 320 } }]
    })
    expect(stacked.note).toContain('same SDI card')
    // Key is on the same card and the same width, but it is a full 1080 frame (its own picture), so it is never stacked.
    expect(canvases.filter((c) => c.recommended)).toHaveLength(1)
  })
  it('does not stack screens on different cards, different widths, or non-DeckLink displays', () => {
    const c = (name: string, w: number, h: number, device: string): SuggestedCanvas => ({ name, kind: 'audience', width: w, height: h, regions: [], from: name, devices: [device] })
    expect(suggestStackedCanvases([c('A', 1920, 880, 'DeckLink Duo (1) · DeckLink Duo 2'), c('B', 1920, 320, 'DeckLink Quad (1) · DeckLink Quad 2')])).toEqual([])
    expect(suggestStackedCanvases([c('A', 1920, 880, 'DeckLink Duo (1) · DeckLink Duo 2'), c('B', 1280, 320, 'DeckLink Duo (3) · DeckLink Duo 2')])).toEqual([])
    expect(suggestStackedCanvases([c('A', 1920, 880, 'DELL U2720Q'), c('B', 1920, 320, 'DELL U2720Q')])).toEqual([])
    expect(suggestStackedCanvases([c('A', 1920, 1080, 'DeckLink Duo (1) · DeckLink Duo 2'), c('B', 1920, 1080, 'DeckLink Duo (2) · DeckLink Duo 2')])).toEqual([])
    // Port order decides top/bottom even when listed the other way round.
    const s = suggestStackedCanvases([c('Lyrics', 1920, 320, 'DeckLink Duo (3) · DeckLink Duo 2'), c('Wall', 1920, 880, 'DeckLink Duo (1) · DeckLink Duo 2')])
    expect(s[0]).toMatchObject({ name: 'Wall (stacked)', height: 1200 })
    expect(s[0].regions[1].rect).toEqual({ x: 0, y: 880, w: 1920, h: 320 })
  })
  it('reads card and port from ProPresenter device strings', () => {
    expect(deckLinkCardOf('DeckLink Duo (3) · DeckLink Duo 2 · 1080p 29.97')).toEqual({ card: 'decklink duo|decklink duo 2', port: 3 })
    expect(deckLinkCardOf('UltraStudio Mini Monitor')).toEqual({ card: 'ultrastudio mini monitor', port: undefined })
    expect(deckLinkCardOf('not configured')).toBeUndefined()
  })
})
