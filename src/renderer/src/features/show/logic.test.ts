import { describe, expect, it } from 'vitest'
import type { Playlist } from '@shared/model'
import { adjacentPlayable, buildTimeline, comingSunday, duplicateItem, duplicateService, formatClock, formatLength, insertItem, itemTitle, matchScore, moveItemTo, parseClock, previewLyrics, removeItem, uniqueName, updateItem } from './logic'

const pl = (): Playlist => ({
  id: 'p', name: 'Sunday', updatedAt: '',
  items: [
    { id: 'h1', type: 'header', title: 'Pre-Service', time: '9:00' },
    { id: 'a', type: 'presentation', presentationId: 'welcome', length: 300 },
    { id: 'h2', type: 'header', title: 'Worship' },
    { id: 'b', type: 'presentation', presentationId: 'grace', length: 240 },
    { id: 'ph', type: 'placeholder', title: 'Sermon' },
    { id: 'c', type: 'presentation', presentationId: 'dox', title: 'Closing song' }
  ]
})

describe('service navigation', () => {
  it('finds the next playable item, skipping headers and placeholders', () => {
    expect(adjacentPlayable(pl(), 'a', 1)?.id).toBe('b')
    expect(adjacentPlayable(pl(), 'b', 1)?.id).toBe('c')
    expect(adjacentPlayable(pl(), 'c', 1)).toBeNull()
  })
  it('finds the previous playable item', () => {
    expect(adjacentPlayable(pl(), 'c', -1)?.id).toBe('b')
    expect(adjacentPlayable(pl(), 'a', -1)).toBeNull()
  })
  it('copes with missing ids', () => {
    expect(adjacentPlayable(pl(), 'nope', 1)).toBeNull()
    expect(adjacentPlayable(null, 'a', 1)).toBeNull()
  })
  it('names items the way a person would', () => {
    const lib = [{ id: 'grace', title: 'Amazing Grace' }]
    expect(itemTitle(pl().items[3], lib)).toBe('Amazing Grace')
    expect(itemTitle(pl().items[5], lib)).toBe('Closing song')
    expect(itemTitle({ id: 'x', type: 'presentation', presentationId: 'gone' }, lib)).toBe('Missing item')
  })
})

describe('times', () => {
  it('parses clock times', () => {
    expect(parseClock('9:00')).toBe(540)
    expect(parseClock('09:30')).toBe(570)
    expect(parseClock('9am')).toBe(540)
    expect(parseClock('10:15 PM')).toBe(22 * 60 + 15)
    expect(parseClock('12am')).toBe(0)
    expect(parseClock('soon')).toBeNull()
    expect(parseClock('25:00')).toBeNull()
  })
  it('formats clock times and lengths', () => {
    expect(formatClock(540)).toBe('9:00')
    expect(formatClock(13 * 60 + 5)).toBe('1:05')
    expect(formatClock(13 * 60 + 5, false)).toBe('13:05')
    expect(formatLength(45)).toBe('45 sec')
    expect(formatLength(240)).toBe('4 min')
    expect(formatLength(270)).toBe('4½ min')
    expect(formatLength(3900)).toBe('1 hr 5 min')
    expect(formatLength(0)).toBe('')
  })
  it('builds a running timeline from a header time and item lengths', () => {
    const t = buildTimeline(pl())
    expect(t.hasTimes).toBe(true)
    expect(t.starts.a).toBe(540)
    expect(t.starts.b).toBe(545)
    expect(t.starts.c).toBe(549)
    expect(t.total).toBe(540)
  })
  it('draws no timeline when nothing has a time', () => {
    const t = buildTimeline({ items: [{ id: 'a', type: 'presentation', presentationId: 'x' }] })
    expect(t.hasTimes).toBe(false)
    expect(t.starts).toEqual({})
  })
})

describe('editing a service', () => {
  it('inserts, moves, updates, duplicates and removes without mutating', () => {
    const p = pl()
    const added = insertItem(p, { id: 'n', type: 'header', title: 'New' }, 1)
    expect(added.items[1].id).toBe('n')
    expect(p.items).toHaveLength(6)
    expect(moveItemTo(p, 0, 2).items.map((x) => x.id).slice(0, 3)).toEqual(['a', 'h2', 'h1'])
    expect(updateItem(p, 'b', { notes: 'Key of G' }).items[3]).toMatchObject({ notes: 'Key of G', presentationId: 'grace' })
    const dup = duplicateItem(p, 'b')
    expect(dup.items).toHaveLength(7)
    expect(dup.items[4]).toMatchObject({ presentationId: 'grace' })
    expect(dup.items[4].id).not.toBe('b')
    expect(removeItem(p, 'b').items.find((x) => x.id === 'b')).toBeUndefined()
  })
  it('duplicates a service with fresh ids and no import link', () => {
    const src = { ...pl(), source: { type: 'pco', ref: '1' } }
    const d = duplicateService(src, 'Next Sunday')
    expect(d.id).not.toBe(src.id)
    expect(d.name).toBe('Next Sunday')
    expect(d.source).toBeUndefined()
    expect(d.items.map((x) => x.id)).not.toEqual(src.items.map((x) => x.id))
    expect(d.items).toHaveLength(src.items.length)
  })
  it('finds a free name', () => {
    expect(uniqueName('Sunday', [])).toBe('Sunday')
    expect(uniqueName('Sunday', ['sunday', 'Sunday 2'])).toBe('Sunday 3')
  })
  it('finds the coming Sunday', () => {
    expect(comingSunday(new Date(2026, 10, 12))).toBe('2026-11-15')
    expect(comingSunday(new Date(2026, 10, 15))).toBe('2026-11-15')
  })
})

describe('lyrics preview', () => {
  it('counts slides and recognises section headings', () => {
    const r = previewLyrics('Verse 1\nAmazing grace\nHow sweet\n\nI once was lost\n\nChorus\nMy chains are gone\n\n[Bridge]\n\nThe earth shall soon')
    expect(r.sections).toEqual(['Verse 1', 'Chorus', 'Bridge'])
    expect(r.slides).toBe(4)
  })
  it('handles empty text', () => {
    expect(previewLyrics('  \n\n ')).toEqual({ slides: 0, sections: [] })
  })
})

describe('search matching', () => {
  it('ranks exact, prefix, contains, words, then lyrics', () => {
    expect(matchScore('amazing grace', 'Amazing Grace')).toBe(0)
    expect(matchScore('amaz', 'Amazing Grace')).toBe(1)
    expect(matchScore('grace', 'Amazing Grace')).toBe(2)
    expect(matchScore('grace amazing', 'Amazing Grace')).toBe(3)
    expect(matchScore('sweet the sound', 'Amazing Grace', 'Amazing grace how sweet the sound')).toBe(4)
    expect(matchScore('zebra', 'Amazing Grace', 'how sweet')).toBeNull()
  })
  it('ignores punctuation and accents', () => {
    expect(matchScore('twas grace', "'Twas Grace")).toBe(0)
    expect(matchScore('senor', 'Señor')).toBe(0)
  })
})
