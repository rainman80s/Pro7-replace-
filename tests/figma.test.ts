import { describe, expect, it } from 'vitest'
import type { Canvas } from '@shared/model'
import { framesOf, parseFigmaUrl, textOf, type FNode } from '@main/services/figma/client'
import { framesToSlides, variantTarget } from '@main/services/figma/index'

const frame = (id: string, name: string, x: number, y: number, extra: Partial<FNode> = {}): FNode => ({ id, name, type: 'FRAME', absoluteBoundingBox: { x, y, width: 1920, height: 1080 }, children: [{ id: id + 't', name: 'T', type: 'TEXT', characters: `${name} text` }], ...extra })

describe('Figma', () => {
  it('parses links', () => {
    expect(parseFigmaUrl('https://www.figma.com/design/AbCdEf1234567890xyz/Sunday-Slides?node-id=12-34&t=x')).toEqual({ fileKey: 'AbCdEf1234567890xyz', nodeId: '12:34' })
    expect(parseFigmaUrl('https://figma.com/file/AbCdEf1234567890xyz/Name')).toEqual({ fileKey: 'AbCdEf1234567890xyz' })
    expect(parseFigmaUrl('https://www.figma.com/design/AbCdEf1234567890xyz/branch/BrAnCh1234567890/Name')).toEqual({ fileKey: 'BrAnCh1234567890' })
    expect(parseFigmaUrl('https://example.com/design/x')).toBeNull()
  })
  it('lists frames in reading order (rows, then columns), walking sections and skipping hidden', () => {
    const page: FNode = { id: '0:1', name: 'March', type: 'CANVAS', children: [
      frame('1:3', 'B', 2000, 0), frame('1:2', 'A', 0, 10), frame('1:4', 'C', 0, 1200),
      { id: '9:9', name: 'Hidden', type: 'FRAME', visible: false, absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 } },
      { id: '5:0', name: 'LED', type: 'SECTION', absoluteBoundingBox: { x: 0, y: 3000, width: 4000, height: 2000 }, children: [frame('5:1', 'LED Top', 0, 3000)] }
    ] }
    const fr = framesOf(page, 'March')
    expect(fr.map((f) => f.name)).toEqual(['A', 'B', 'C', 'LED Top'])
    expect(fr[3].section).toBe('LED')
    expect(fr[0].hash).not.toBe(framesOf({ ...page, children: [frame('1:2', 'A', 0, 10, { children: [{ id: 'x', name: 'T', type: 'TEXT', characters: 'changed' }] })] }, 'March')[0].hash)
    // Moving a frame on the canvas doesn't count as a content change.
    expect(framesOf({ ...page, children: [frame('1:2', 'A', 500, 10)] }, 'March')[0].hash).toBe(fr[0].hash)
    expect(textOf(page.children![1])).toEqual(['A text'])
  })
  it('smart mode turns canvas/region-named frames into variants of the previous slide', () => {
    const canvases: Canvas[] = [
      { id: 'main', name: 'Main Screen', kind: 'audience', width: 1920, height: 1080, regions: [] },
      { id: 'led', name: 'LED Wall', kind: 'audience', width: 1920, height: 2160, regions: [{ id: 'top', name: 'LED Top', rect: { x: 0, y: 0, w: 1920, h: 1080 } }] }
    ]
    expect(variantTarget('Welcome / LED Top', canvases)).toMatchObject({ canvas: { id: 'led' }, regionId: 'top' })
    expect(variantTarget('Welcome', canvases)).toBeNull()
    const frames = [{ id: '1', name: 'Welcome', width: 1920, height: 1080, page: 'p', hash: 'h1' }, { id: '2', name: 'LED Top', width: 1920, height: 1080, page: 'p', hash: 'h2' }, { id: '3', name: 'Next', width: 1920, height: 1080, page: 'p', hash: 'h3' }]
    const media = Object.fromEntries(frames.map((f) => [f.id, { kind: 'image' as const, src: `workspace:figma/${f.id}.png` }]))
    const gen = framesToSlides(frames, media, { 1: 'Welcome text' }, { smart: true, canvases, size: { width: 1920, height: 1080 } })
    expect(gen.map((g) => g.key)).toEqual(['1+2', '3'])
    expect(gen[0].slide.variants?.led.elements[0]).toMatchObject({ type: 'image', regionId: 'top', frame: { x: 0, y: 0, w: 1920, h: 1080 } })
    expect(gen[0].slide.notes).toBe('Welcome text')
    expect(framesToSlides(frames, media, {}, { smart: false, canvases, size: { width: 1920, height: 1080 } })).toHaveLength(3)
  })
})

describe('OBS websocket auth', () => {
  it('matches the obs-websocket v5 spec example', async () => {
    const { obsAuth } = await import('@main/services/obs/index')
    // base64(sha256(base64(sha256(password + salt)) + challenge))
    const { createHash } = await import('node:crypto')
    const s = createHash('sha256').update('pw' + 'salt').digest('base64')
    expect(obsAuth('pw', 'salt', 'ch')).toBe(createHash('sha256').update(s + 'ch').digest('base64'))
  })
})
