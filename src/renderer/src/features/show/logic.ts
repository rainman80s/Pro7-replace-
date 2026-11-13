/**
 * Pure helpers for the Show screen and service (playlist) management.
 * No React, no API calls — everything here is unit-tested in logic.test.ts.
 */
import type { ID, Playlist, PlaylistItem } from '@shared/model'
import type { PresentationSummary } from '@shared/api'

export type ServiceItem = PlaylistItem
export const newId = (): ID => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

/** What to call a service item, the way a volunteer would say it. */
export function itemTitle(item: ServiceItem, library: Pick<PresentationSummary, 'id' | 'title'>[]): string {
  if (item.type === 'presentation') return item.title || library.find((l) => l.id === item.presentationId)?.title || 'Missing item'
  if (item.type === 'media') return item.title || item.media.name || 'Media'
  return item.title || (item.type === 'header' ? 'Section' : 'To be added')
}

/** Items that can be put on screen (songs, slides, media) — not headers or placeholders. */
export const isPlayable = (item: ServiceItem): item is Extract<ServiceItem, { type: 'presentation' | 'media' }> => item.type === 'presentation' || item.type === 'media'

/** The next (dir=1) or previous (dir=-1) playable item after `itemId`, skipping headers and placeholders. */
export function adjacentPlayable(playlist: Pick<Playlist, 'items'> | undefined | null, itemId: ID | undefined | null, dir: 1 | -1): Extract<ServiceItem, { type: 'presentation' | 'media' }> | null {
  if (!playlist || !itemId) return null
  const i = playlist.items.findIndex((x) => x.id === itemId)
  if (i < 0) return null
  for (let j = i + dir; j >= 0 && j < playlist.items.length; j += dir) {
    const it = playlist.items[j]
    if (isPlayable(it)) return it
  }
  return null
}

/* ───────────── times ───────────── */

/** "9:00", "09:30", "9am", "10:15 PM" → minutes after midnight, or null. */
export function parseClock(text: string | undefined | null): number | null {
  if (!text) return null
  const m = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*([ap])?\.?m?\.?\s*$/i.exec(text)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2] ?? 0)
  const ap = m[3]?.toLowerCase()
  if (h > 23 || min > 59 || (ap && (h < 1 || h > 12))) return null
  if (ap === 'p' && h < 12) h += 12
  if (ap === 'a' && h === 12) h = 0
  return h * 60 + min
}

export function formatClock(minutes: number, hour12 = true): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  const mm = String(m % 60).padStart(2, '0')
  if (!hour12) return `${String(h).padStart(2, '0')}:${mm}`
  return `${h % 12 === 0 ? 12 : h % 12}:${mm}`
}

/** Seconds → "45 sec", "4 min", "4½ min", "1 hr 5 min". */
export function formatLength(seconds: number | undefined | null): string {
  if (!seconds || seconds <= 0) return ''
  if (seconds < 60) return `${Math.round(seconds)} sec`
  const half = Math.round(seconds / 30) / 2
  if (half < 60) return `${Number.isInteger(half) ? half : `${Math.floor(half)}½`} min`
  const mins = Math.round(seconds / 60)
  return `${Math.floor(mins / 60)} hr${mins % 60 ? ` ${mins % 60} min` : ''}`
}

export interface Timeline {
  /** Start time per item id, minutes after midnight. Only present once a header has given a clock time. */
  starts: Record<ID, number>
  /** Sum of every item's length, seconds. */
  total: number
  /** True if any time or length exists — otherwise don't draw a timeline at all. */
  hasTimes: boolean
}

/**
 * Service-order timeline. A header's `time` anchors the clock; every item after it starts when the
 * previous one ends (using `length`). Items without a length take no time.
 */
export function buildTimeline(playlist: Pick<Playlist, 'items'> | undefined | null): Timeline {
  const starts: Record<ID, number> = {}
  let cursor: number | null = null
  let total = 0
  let hasTimes = false
  for (const it of playlist?.items ?? []) {
    if (it.type === 'header') {
      const t = parseClock(it.time)
      if (t !== null) { cursor = t; hasTimes = true }
    }
    if (cursor !== null) starts[it.id] = cursor
    const len = it.length ?? 0
    if (len > 0) { total += len; hasTimes = true; if (cursor !== null) cursor += len / 60 }
  }
  return { starts, total, hasTimes }
}

/* ───────────── editing a service ───────────── */

const touch = <T extends Playlist>(p: T, items: PlaylistItem[]): T => ({ ...p, items })

export function insertItem(p: Playlist, item: PlaylistItem, index?: number): Playlist {
  const items = [...p.items]
  items.splice(index === undefined ? items.length : Math.max(0, Math.min(items.length, index)), 0, item)
  return touch(p, items)
}
export const removeItem = (p: Playlist, id: ID): Playlist => touch(p, p.items.filter((x) => x.id !== id))
export const updateItem = (p: Playlist, id: ID, patch: Partial<PlaylistItem>): Playlist =>
  touch(p, p.items.map((x) => (x.id === id ? ({ ...x, ...patch } as PlaylistItem) : x)))
export function moveItemTo(p: Playlist, from: number, to: number): Playlist {
  const items = [...p.items]
  if (from < 0 || from >= items.length) return p
  const [it] = items.splice(from, 1)
  items.splice(Math.max(0, Math.min(items.length, to)), 0, it)
  return touch(p, items)
}
export function duplicateItem(p: Playlist, id: ID): Playlist {
  const i = p.items.findIndex((x) => x.id === id)
  return i < 0 ? p : insertItem(p, { ...p.items[i], id: newId() }, i + 1)
}

export const presentationItem = (presentationId: ID): PlaylistItem => ({ id: newId(), type: 'presentation', presentationId })
export const headerItem = (title: string): PlaylistItem => ({ id: newId(), type: 'header', title })
export const placeholderItem = (title: string, hint?: string): PlaylistItem => ({ id: newId(), type: 'placeholder', title, hint })

/** ISO date (yyyy-mm-dd) of the coming Sunday — today if today is Sunday. */
export function comingSunday(from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "Sunday 15 November" from an ISO date; '' if it can't be read. */
export function formatServiceDate(iso: string | undefined | null, locale?: string): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
}

export function newService(name: string, date?: string): Playlist {
  return { id: newId(), name: name.trim() || 'New service', date, items: [], updatedAt: '' }
}

/** A copy for next week: same order, fresh ids, no link to where the original was imported from. */
export function duplicateService(p: Playlist, name?: string, date?: string): Playlist {
  return { ...p, id: newId(), name: name ?? `${p.name} copy`, date: date ?? p.date, source: undefined, items: p.items.map((x) => ({ ...x, id: newId() })), updatedAt: '' }
}

/** Pick a name that isn't taken: "Sunday", "Sunday 2", "Sunday 3"… */
export function uniqueName(base: string, taken: string[]): string {
  const set = new Set(taken.map((t) => t.trim().toLowerCase()))
  if (!set.has(base.trim().toLowerCase())) return base
  for (let n = 2; ; n++) if (!set.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`
}

/* ───────────── lyrics ───────────── */

const SECTION = /^\s*\[?\s*(verse|chorus|pre[- ]?chorus|bridge|tag|intro|outro|ending|interlude|refrain|instrumental|turnaround|vamp|coda|hook)\b[\s\dA-Za-z]{0,6}\]?\s*:?\s*$/i

/** How pasted lyrics will be split — mirrors `library.create` (blank line = new slide, "Verse 1"/"Chorus" lines = section names). */
export function previewLyrics(text: string): { slides: number; sections: string[] } {
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  const sections: string[] = []
  let slides = 0
  for (const b of blocks) {
    const lines = b.split('\n')
    if (SECTION.test(lines[0])) {
      sections.push(lines[0].replace(/[[\]:]/g, '').trim())
      if (lines.length > 1) slides++
    } else slides++
  }
  return { slides, sections }
}

/* ───────────── search ───────────── */

/** Case/punctuation-insensitive "all words appear" match, with a score (lower = better), or null. */
export function matchScore(query: string, title: string, extra = ''): number | null {
  const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const q = norm(query)
  if (!q) return 0
  const t = norm(title), x = norm(extra)
  if (t === q) return 0
  if (t.startsWith(q)) return 1
  if (t.includes(q)) return 2
  const words = q.split(' ')
  if (words.every((w) => t.includes(w))) return 3
  if (x.includes(q)) return 4
  if (words.every((w) => t.includes(w) || x.includes(w))) return 5
  return null
}
