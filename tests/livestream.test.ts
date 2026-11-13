import { describe, expect, it } from 'vitest'
import { CANVAS_PRESETS, canvasFromPreset, LIVESTREAM_THEME_ID } from '../src/shared/outputs'
import { allThemes, resolveSlideWithCanvasTheme } from '../src/shared/themes'
import type { Slide } from '../src/shared/model'

describe('Livestream (16:9) preset', () => {
  const preset = CANVAS_PRESETS.find((p) => p.id === 'livestream')!
  const canvas = canvasFromPreset(preset, 'live', () => 'r', undefined, '#fff')
  it('is a 1920x1080 audience canvas with no background layer and the livestream theme', () => {
    expect(canvas).toMatchObject({ width: 1920, height: 1080, kind: 'audience', themeId: LIVESTREAM_THEME_ID })
    expect(canvas.layers?.background).toBe(false)
  })
  it('restyles an LED-wall (1920x880) lyric slide into a 16:9 lower third without a per-slide variant', () => {
    const slide: Slide = { id: 's', elements: [{ id: 'e', type: 'text', role: 'lyrics', frame: { x: 0, y: 0, w: 1920, h: 880 }, style: { fontSize: 100 }, paragraphs: [{ runs: [{ text: 'Amazing grace' }] }] } as never] }
    const r = resolveSlideWithCanvasTheme(slide, { width: 1920, height: 880 }, canvas, allThemes(null))
    expect(r?.size).toEqual({ width: 1920, height: 1080 })
    const lyric = r!.elements.find((e) => e.type === 'text')!
    expect(lyric.frame.y).toBeGreaterThan(700)
    expect(r!.background).toBeUndefined()
  })
})
