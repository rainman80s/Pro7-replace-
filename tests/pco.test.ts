import { describe, expect, it } from 'vitest'
import type { Playlist } from '@shared/model'
import type { PcoItem, PcoPlan } from '@shared/integrations'
import { pcoSource } from '@shared/integrations'
import { classifyItem, cleanLyrics, desiredItems, expandLabel, matchSong, parseSong, peopleFor, songToText, syncPlaylist, timerSuggestions, titleSimilarity, type SyncOptions } from '@main/services/pco/map'

let n = 0
const newId = (): string => `id${++n}`
const item = (id: string, type: PcoItem['type'], title: string, extra: Partial<PcoItem> = {}): PcoItem => ({ id, sequence: Number(id), type, title, length: 0, notes: [], servicePosition: 'during', ...extra })

/** Synthetic plan shaped like a Reach Sunday (see docs/integrations/reach-data-shapes.md). */
function plan(): PcoPlan {
  return {
    id: 'p1', serviceTypeId: 'st1', title: 'Ephesus / Revelation 2:1-7', seriesTitle: 'Seven Letters', dates: 'March 1, 2026', sortDate: '2026-03-01T17:00:00Z',
    times: [
      { id: 't0', type: 'rehearsal', startsAt: '2026-02-27T02:00:00Z' },
      { id: 't1', type: 'service', startsAt: '2026-03-01T17:00:00Z' },
      { id: 't2', type: 'service', startsAt: '2026-03-01T19:00:00Z' }
    ],
    items: [
      item('1', 'header', 'Pre-Gathering'),
      item('2', 'item', 'Preservice Music', { servicePosition: 'pre', notes: [{ category: 'Sound', content: 'Playlist: upbeat' }] }),
      item('3', 'header', 'Worship + Welcome'),
      item('4', 'item', 'Call To Worship', { length: 120, notes: [{ category: 'Person', content: 'Avery' }] }),
      item('5', 'song', 'Great Is The River', { length: 324, keyName: 'C', song: { id: 's1', title: 'Great Is The River', ccli: '1234567', author: 'A. Writer' }, arrangement: { id: 'a1', name: 'Studio', bpm: 72 }, notes: [{ category: 'Person', content: 'Jordan' }] }),
      item('6', 'song', 'Mountains Bow', { length: 300, keyName: 'G', song: { id: 's2', title: 'Mountains Bow' }, arrangement: { id: 'a2', name: 'Live' } }),
      item('7', 'header', 'Announcements + Story'),
      item('8', 'item', 'Announcements', { length: 180 }),
      item('9', 'header', 'Teaching'),
      item('10', 'item', 'Message', { length: 1800, notes: [{ category: 'Person', content: 'Sam' }, { category: 'Sound', content: 'Lapel' }] }),
      item('11', 'item', 'Benediction', { length: 60 })
    ],
    people: [
      { name: 'Sam Rivers', position: 'Speaker', team: 'Sunday Service Roles', status: 'confirmed' },
      { name: 'Riley Stone', position: 'Announcements', team: 'Sunday Service Roles', status: 'confirmed' },
      { name: 'Casey Hill', position: 'Benediction', team: 'Sunday Service Roles', status: 'unconfirmed' },
      { name: 'Drew Lake', position: 'Benediction', team: 'Sunday Service Roles', status: 'declined' },
      { name: 'Pat Moss', position: 'Drums', team: 'Band', status: 'confirmed' }
    ]
  }
}
const settings = { includePrePost: true, personNoteCategories: ['Person'] }
const library = [
  { id: 'lib-river', title: 'Great is the River', ccliNumber: '1234567', kind: 'song', arrangements: [{ id: 'arr-studio', name: 'studio' }] },
  { id: 'lib-other', title: 'Mountain Song', kind: 'song' }
]
const opts = (over: Partial<SyncOptions> = {}): SyncOptions => ({
  settings, newId, now: '2026-02-25T00:00:00Z',
  resolveSong: (d) => { const m = matchSong(d.item, library); return m.presentationId ? { presentationId: m.presentationId, arrangementId: m.presentationId === 'lib-river' ? 'arr-studio' : undefined } : undefined },
  ...over
})
const titles = (p: Playlist): string[] => p.items.map((i) => ('title' in i ? i.title ?? '' : ''))

describe('plan → playlist', () => {
  it('maps headers, songs, typed placeholders, lengths, notes and people', () => {
    const { playlist, changes } = syncPlaylist(null, plan(), opts())
    expect(changes).toEqual([])
    expect(playlist.name).toBe('March 1, 2026 — Ephesus / Revelation 2:1-7')
    expect(playlist.date).toMatch(/^2026-03-01|^2026-02-28|^2026-03-02/)
    expect(playlist.items.map((i) => i.type)).toEqual(['header', 'placeholder', 'header', 'placeholder', 'presentation', 'placeholder', 'header', 'placeholder', 'header', 'placeholder', 'placeholder'])
    const song = playlist.items[4]
    expect(song).toMatchObject({ type: 'presentation', presentationId: 'lib-river', arrangementId: 'arr-studio', length: 324, people: ['Jordan'], notes: 'Key C · Studio arrangement · 72 bpm' })
    expect(playlist.items[5]).toMatchObject({ type: 'placeholder', title: 'Mountains Bow', hint: 'Song — not in the library yet' })
    expect(playlist.items[9]).toMatchObject({ type: 'placeholder', title: 'Message', hint: 'Sermon slides — fill from Notion', length: 1800, people: ['Sam'], notes: 'Sound: Lapel' })
    // No Person note → falls back to the matching team position; declined people are skipped.
    expect(playlist.items[7]).toMatchObject({ title: 'Announcements', people: ['Riley Stone'] })
    expect(playlist.items[10]).toMatchObject({ title: 'Benediction', people: ['Casey Hill'] })
    const src = pcoSource(playlist)!
    expect(src.ref).toBe('p1')
    expect(src.roles).toEqual({ Speaker: ['Sam Rivers'], Announcements: ['Riley Stone'], Benediction: ['Casey Hill'] })
    expect(Object.keys(src.origins)).toHaveLength(11)
    expect(src.origins[playlist.items[9].id]).toMatchObject({ pcoItemId: '10', kind: 'sermon' })
  })

  it('can hide pre/post-service items', () => {
    const d = desiredItems(plan(), { ...settings, includePrePost: false })
    expect(d.map((x) => x.item.title)).not.toContain('Preservice Music')
  })

  it('classifies items by title', () => {
    const k = (t: string, type: PcoItem['type'] = 'item') => classifyItem(item('1', type, t))
    expect(k('Message')).toBe('sermon')
    expect(k('Sermon: Hope')).toBe('sermon')
    expect(k('Announcements')).toBe('announcements')
    expect(k('Sunday Highlights')).toBe('announcements')
    expect(k('Leadership Announcement')).toBe('generic')
    expect(k('Baptism Video')).toBe('media')
    expect(k('Call To Worship')).toBe('scripture')
    expect(k('Greeting')).toBe('generic')
    expect(k('Anything', 'song')).toBe('song')
  })

  it('splits multi-person notes', () => {
    const it2 = item('1', 'item', 'Welcome', { notes: [{ category: 'person', content: 'Avery & Jordan, Sam' }] })
    expect(peopleFor(it2, 'generic', { people: [] }, ['Person'])).toEqual(['Avery', 'Jordan', 'Sam'])
  })
})

describe('re-sync (three-way)', () => {
  const first = (): Playlist => syncPlaylist(null, plan(), opts()).playlist

  it('reports nothing when nothing changed', () => {
    const r = syncPlaylist(first(), plan(), opts())
    expect(r.changes).toEqual([])
  })

  it('applies remote edits, additions and removals without touching local-only items', () => {
    const pl = first()
    // Operator adds their own item after the Message and edits nothing else.
    pl.items.splice(10, 0, { id: 'mine', type: 'presentation', presentationId: 'lib-other', title: 'Baptism slides' })
    const next = plan()
    next.items.find((i) => i.id === '10')!.length = 2100 // sermon got longer
    next.items.find((i) => i.id === '10')!.notes[0].content = 'Taylor' // different speaker
    next.items = next.items.filter((i) => i.id !== '8') // announcements cut
    next.items.push(item('12', 'song', 'Great Is The River', { song: { id: 's1', title: 'Great Is The River', ccli: '1234567' }, arrangement: { id: 'a1', name: 'Studio' } }))
    const r = syncPlaylist(pl, next, opts())
    expect(r.changes.map((c) => c.type).sort()).toEqual(['added', 'removed', 'updated'])
    expect(r.changes.find((c) => c.type === 'updated')!.detail).toContain('30:00 → 35:00')
    expect(titles(r.playlist)).toEqual(['Pre-Gathering', 'Preservice Music', 'Worship + Welcome', 'Call To Worship', 'Great Is The River', 'Mountains Bow', 'Announcements + Story', 'Teaching', 'Message', 'Baptism slides', 'Benediction', 'Great Is The River'])
    expect(r.playlist.items[8]).toMatchObject({ length: 2100, people: ['Taylor'] })
    expect(pl.items[9]).toMatchObject({ length: 1800 }) // input not mutated
    // …and a second sync is quiet.
    expect(syncPlaylist(r.playlist, next, opts()).changes).toEqual([])
  })

  it('keeps local edits on conflict unless the operator accepts', () => {
    const pl = first()
    const msg = pl.items[9] as Extract<Playlist['items'][number], { type: 'placeholder' }>
    msg.title = 'Message — Ephesus'
    msg.notes = 'Sound: Lapel\nSlides ready'
    const next = plan()
    next.items.find((i) => i.id === '10')!.title = 'Sermon'
    const r = syncPlaylist(pl, next, opts())
    expect(r.changes).toHaveLength(1)
    expect(r.changes[0]).toMatchObject({ type: 'conflict', default: 'reject', id: 'cfl:10' })
    expect(r.playlist.items[9]).toMatchObject({ title: 'Message — Ephesus', notes: 'Sound: Lapel\nSlides ready' })
    // Conflict is remembered as seen: not reported again.
    expect(syncPlaylist(r.playlist, next, opts()).changes).toEqual([])
    const taken = syncPlaylist(pl, next, opts({ decisions: { 'cfl:10': 'accept' } }))
    expect(taken.playlist.items[9]).toMatchObject({ title: 'Sermon', notes: 'Sound: Lapel\nSlides ready' })
  })

  it('keeps a filled placeholder (sermon linked to a presentation) through re-syncs', () => {
    const pl = first()
    const id = pl.items[9].id
    pl.items[9] = { id, type: 'presentation', presentationId: 'sermon-pres', title: 'Message', length: 1800, people: ['Sam'], notes: 'Sound: Lapel' }
    const next = plan()
    next.items.find((i) => i.id === '10')!.length = 2000
    const r = syncPlaylist(pl, next, opts())
    expect(r.playlist.items[9]).toMatchObject({ type: 'presentation', presentationId: 'sermon-pres', length: 2000 })
  })

  it('does not resurrect items the operator removed, and rejected changes come back next time', () => {
    const pl = first()
    pl.items = pl.items.filter((i) => !('title' in i && i.title === 'Preservice Music'))
    const next = plan()
    next.items.push(item('13', 'item', 'Communion', { length: 300 }))
    const r = syncPlaylist(pl, next, opts({ decisions: { 'add:13': 'reject' } }))
    expect(titles(r.playlist)).not.toContain('Preservice Music')
    expect(titles(r.playlist)).not.toContain('Communion')
    const again = syncPlaylist(r.playlist, next, opts())
    expect(again.changes.map((c) => c.id)).toEqual(['add:13'])
    expect(titles(again.playlist)).toContain('Communion')
    expect(titles(again.playlist)).not.toContain('Preservice Music')
  })

  it('follows a remote re-order, but keeps a local-only re-order', () => {
    const pl = first()
    const next = plan()
    const [a] = next.items.splice(7, 1) // move Announcements to the end
    next.items.push(a)
    const r = syncPlaylist(pl, next, opts())
    expect(r.changes).toEqual([expect.objectContaining({ id: 'order', type: 'moved' })])
    expect(titles(r.playlist).at(-1)).toBe('Announcements')

    const local = first()
    const [b] = local.items.splice(5, 1) // operator moves a song up
    local.items.splice(4, 0, b)
    const r2 = syncPlaylist(local, plan(), opts())
    expect(r2.changes).toEqual([])
    expect(titles(r2.playlist).slice(4, 6)).toEqual(['Mountains Bow', 'Great Is The River'])
    // both moved → conflict, local order kept by default
    const r3 = syncPlaylist(local, next, opts())
    expect(r3.changes).toEqual([expect.objectContaining({ id: 'order', type: 'conflict', default: 'reject' })])
    expect(titles(r3.playlist).slice(4, 6)).toEqual(['Mountains Bow', 'Great Is The River'])
  })

  it('swaps the linked presentation when the song in a slot changes', () => {
    const pl = first()
    const next = plan()
    Object.assign(next.items.find((i) => i.id === '5')!, { title: 'New Song', song: { id: 's9', title: 'New Song' }, arrangement: { id: 'a9' } })
    const r = syncPlaylist(pl, next, opts())
    expect(r.changes.map((c) => c.type)).toContain('song')
    expect(r.playlist.items[4]).toMatchObject({ type: 'placeholder', title: 'New Song' })
  })

  it('upgrades a song placeholder once the song is in the library', () => {
    const pl = first()
    const withSong = opts({ resolveSong: (d) => (d.item.song?.id === 's2' ? { presentationId: 'lib-new' } : d.item.song?.id === 's1' ? { presentationId: 'lib-river', arrangementId: 'arr-studio' } : undefined) })
    const r = syncPlaylist(pl, plan(), withSong)
    expect(r.playlist.items[5]).toMatchObject({ type: 'presentation', presentationId: 'lib-new' })
  })
})

describe('song matching', () => {
  const song = (title: string, ccli?: string): PcoItem => item('1', 'song', title, { song: { id: 'x', title, ccli } })
  it('prefers remembered links, then CCLI, then exact title, then confident fuzzy', () => {
    expect(matchSong(song('Whatever', '1234567'), library)).toMatchObject({ presentationId: 'lib-river', confidence: 'ccli' })
    expect(matchSong(song('Whatever'), library, { x: 'lib-other' })).toMatchObject({ presentationId: 'lib-other', confidence: 'linked' })
    expect(matchSong(song('GREAT IS THE RIVER (Live)'), library)).toMatchObject({ presentationId: 'lib-river', confidence: 'title' })
    expect(matchSong(song('Great Is The Rivers'), library)).toMatchObject({ presentationId: 'lib-river', confidence: 'fuzzy' })
  })
  it('does not guess between look-alikes', () => {
    const lib = [{ id: 'a', title: 'Holy Forever' }, { id: 'b', title: 'Holy Spirit' }]
    const m = matchSong(song('Holy Is The Lord'), lib)
    expect(m.presentationId).toBeUndefined()
    expect(titleSimilarity('Holy Forever', 'Holy Spirit')).toBeLessThan(0.86)
  })
})

describe('lyrics import', () => {
  it('strips chords and builds sections in arrangement order', () => {
    const lyrics = 'VERSE 1\n[G]Line one of the [D]verse\nLine two\nLine three\nLine four\nLine five\n\nCHORUS\n G   D   Em\nSing it out\nSing again\n\nCOLUMN_BREAK\nBRIDGE\nBridge line'
    expect(cleanLyrics('[G]Hello [D/F#]there\n G  C\nWorld')).toBe('Hello there\nWorld')
    const song = parseSong({ lyrics, sequence: ['V1', 'C', 'B', 'C', 'Verse 9'] })
    expect(song.sections.map((s) => s.label)).toEqual(['Verse 1', 'Chorus', 'Bridge'])
    expect(song.sequence).toEqual(['Verse 1', 'Chorus', 'Bridge', 'Chorus'])
    const text = songToText(song)
    expect(text.split('\n\n')).toEqual(['Verse 1\nLine one of the verse\nLine two\nLine three', 'Line four\nLine five', 'Chorus\nSing it out\nSing again', 'Bridge\nBridge line'])
  })
  it('expands short labels', () => {
    expect(['v2', 'PC', 'c', 'Bridge 2', 'pre-chorus'].map(expandLabel)).toEqual(['Verse 2', 'Pre-Chorus', 'Chorus', 'Bridge 2', 'Pre-Chorus'])
  })
})

describe('timers', () => {
  it('suggests one countdown per distinct service time', () => {
    const s = timerSuggestions(plan())
    expect(s).toHaveLength(2)
    expect(s[0].name).toMatch(/^Service starts \d{1,2}:00$/)
    expect(timerSuggestions(plan(), [{ id: s[0].id, name: 'x', kind: 'countdownTo', target: s[0].target }])[0].exists).toBe(true)
  })
})
