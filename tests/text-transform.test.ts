import { describe, expect, it } from 'vitest'
import { transformParagraphs } from '@shared/render/SlideView'

const paras = [{ runs: [{ text: 'Amazing grace' }] }, { runs: [{ text: 'how sweet the sound' }] }]
describe('ProPresenter text transforms', () => {
  it('single line joins lines with the delimiter', () => {
    const out = transformParagraphs(paras, 'single_line', ' / ')
    expect(out).toHaveLength(1)
    expect(out[0].runs.map((r) => r.text).join('')).toBe('Amazing grace / how sweet the sound')
  })
  it('one word per line splits words', () => {
    expect(transformParagraphs(paras, 'one_word_per_line')).toHaveLength(6)
  })
  it('no transform leaves text alone', () => {
    expect(transformParagraphs(paras, undefined)).toBe(paras)
  })
})
