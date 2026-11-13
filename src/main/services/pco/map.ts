/**
 * Planning Center plan → Playlist mapping, song matching and the three-way re-sync.
 * Pure functions (no Electron, no network) — see tests/pco.test.ts.
 *
 * Re-sync model: every imported item remembers the PCO-derived values it was created with
 * (`origin.base`). On re-pull, for each field:   remote changed & local untouched → update;
 * remote changed & local edited → CONFLICT (keep the local edit unless the operator says otherwise);
 * local-only items stay where they are; items the operator removed stay removed.
 */
import type { ID, Playlist, PlaylistItem } from '@shared/model'
import type {
  ItemBase, ItemOrigin, PcoItem, PcoItemKind, PcoPerson, PcoPlan, PcoPlaylistSource, PcoSettings, PlanChange, SongMatch
} from '@shared/integrations'
import { pcoSource } from '@shared/integrations'

export interface LibrarySong { id: ID; title: string; ccliNumber?: string; kind?: string; arrangements?: { id: ID; name: string }[] }

/* ───────────── classification ───────────── */

export function classifyItem(item: PcoItem): PcoItemKind {
  if (item.type === 'header') return 'header'
  if (item.type === 'song') return 'song'
  const t = item.title.toLowerCase()
  if (/\b(message|sermon|teaching|homily|preach)/.test(t)) return 'sermon'
  if (/\b(announcements?|highlights?|news)\b/.test(t) && !/leadership/.test(t)) return 'announcements'
  if (item.type === 'media' || /\b(video|bumper|countdown|recap|trailer)\b/.test(t)) return 'media'
  if (/\b(scripture|reading|call to worship|benediction|psalm|liturgy|creed|confession)\b/.test(t)) return 'scripture'
  return 'generic'
}

const HINTS: Record<PcoItemKind, string> = {
  header: '', song: 'Song — not in the library yet', sermon: 'Sermon slides — fill from Notion',
  announcements: 'Announcements — fill from Notion', media: 'Video / media — drop a file here',
  scripture: 'Scripture / reading — add from the Bible tab', generic: 'No slides needed (or add your own)'
}

const norm = (s: string): string => s.toLowerCase().replace(/&/g, ' and ').replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim()

/** Who leads this item: the "Person" note first (Reach's convention), else the matching team position. */
export function peopleFor(item: PcoItem, kind: PcoItemKind, plan: Pick<PcoPlan, 'people'>, cats: string[]): string[] | undefined {
  const lc = cats.map((c) => c.toLowerCase())
  const fromNotes = item.notes.filter((n) => lc.includes(n.category.toLowerCase())).flatMap((n) => n.content.split(/\s*(?:,|&|\+|\/|\band\b)\s*/)).map((s) => s.trim()).filter(Boolean)
  if (fromNotes.length) return [...new Set(fromNotes)]
  if (kind === 'header' || kind === 'song') return undefined
  const active = plan.people.filter((p) => p.status !== 'declined')
  const title = norm(item.title)
  const wanted = kind === 'sermon' ? ['speaker', 'preacher', 'teaching'] : kind === 'announcements' ? ['announcements', 'host'] : []
  const hit = active.filter((p) => {
    const pos = norm(p.position)
    if (!pos) return false
    if (wanted.some((w) => pos.includes(w))) return kind !== 'announcements' || pos.includes('announcement') || !active.some((q) => norm(q.position).includes('announcement'))
    return pos.length > 3 && (title === pos || title.includes(pos) || pos.includes(title))
  })
  return hit.length ? [...new Set(hit.map((p) => p.name))] : undefined
}

/** Plan-level roles shown at the top of the service ("Speaker: …"). */
export function planRoles(people: PcoPerson[]): Record<string, string[]> {
  const KEY = /(speaker|preach|host|worship leader|announcement|benediction|call to worship|prayer|music director|media ops|slides|propresenter|presenter|lyrics)/i
  const roles: Record<string, string[]> = {}
  for (const p of people) {
    if (p.status === 'declined' || !KEY.test(p.position)) continue
    ;(roles[p.position] ??= []).includes(p.name) || roles[p.position].push(p.name)
  }
  return roles
}

function notesFor(item: PcoItem, cats: string[]): string | undefined {
  const lc = cats.map((c) => c.toLowerCase())
  const lines: string[] = []
  if (item.type === 'song') {
    const bits = [item.keyName && `Key ${item.keyName}`, item.arrangement?.name && `${item.arrangement.name} arrangement`, item.arrangement?.bpm && `${item.arrangement.bpm} bpm`].filter(Boolean)
    if (bits.length) lines.push(bits.join(' · '))
  }
  if (item.description) lines.push(item.description)
  if (item.details) lines.push(item.details)
  for (const n of item.notes) if (!lc.includes(n.category.toLowerCase())) lines.push(n.category ? `${n.category}: ${n.content}` : n.content)
  return lines.length ? lines.join('\n') : undefined
}

export interface DesiredItem { item: PcoItem; kind: PcoItemKind; base: ItemBase }

export function desiredItems(plan: PcoPlan, settings: Pick<PcoSettings, 'includePrePost' | 'personNoteCategories'>): DesiredItem[] {
  const out: DesiredItem[] = []
  for (const item of plan.items) {
    if (!settings.includePrePost && item.servicePosition && item.servicePosition !== 'during' && item.type !== 'header') continue
    if (!item.title && item.type !== 'song') continue
    const kind = classifyItem(item)
    const base: ItemBase = { title: item.title || item.song?.title || 'Untitled' }
    if (item.length) base.length = item.length
    const notes = notesFor(item, settings.personNoteCategories)
    if (notes) base.notes = notes
    const people = peopleFor(item, kind, plan, settings.personNoteCategories)
    if (people) base.people = people
    if (item.song) base.songKey = `${item.song.id}:${item.arrangement?.id ?? ''}`
    out.push({ item, kind, base })
  }
  // Drop headers that ended up with nothing under them (e.g. pre-service hidden).
  return out.filter((d, i) => d.kind !== 'header' || (out[i + 1] && out[i + 1].kind !== 'header') || settings.includePrePost)
}

/* ───────────── song matching ───────────── */

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  const t = ` ${s} `
  for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) ?? 0) + 1)
  return m
}
/** Dice coefficient on character bigrams of the normalised titles (0..1). */
export function titleSimilarity(a: string, b: string): number {
  const x = norm(a), y = norm(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const A = bigrams(x), B = bigrams(y)
  let overlap = 0, total = 0
  for (const [k, n] of A) { overlap += Math.min(n, B.get(k) ?? 0); total += n }
  for (const n of B.values()) total += n
  return (2 * overlap) / total
}

export function matchSong(item: PcoItem, library: LibrarySong[], links: Record<string, ID> = {}): SongMatch {
  const song = item.song ?? { id: `title:${norm(item.title)}`, title: item.title }
  const res: SongMatch = { pcoItemId: item.id, song, arrangement: item.arrangement, candidates: [] }
  const use = (p: LibrarySong, confidence: SongMatch['confidence']): SongMatch => ({ ...res, presentationId: p.id, presentationTitle: p.title, confidence })
  const linked = links[song.id] && library.find((p) => p.id === links[song.id])
  if (linked) return use(linked, 'linked')
  const ccli = song.ccli?.replace(/\D/g, '')
  if (ccli) {
    const hit = library.find((p) => String(p.ccliNumber ?? '').replace(/\D/g, '') === ccli)
    if (hit) return use(hit, 'ccli')
  }
  const scored = library.map((p) => ({ p, score: titleSimilarity(song.title, p.title) + (p.kind === 'song' ? 0.02 : 0) })).filter((x) => x.score > 0.45).sort((a, b) => b.score - a.score)
  res.candidates = scored.slice(0, 5).map((x) => ({ id: x.p.id, title: x.p.title, score: Math.min(1, Math.round(x.score * 100) / 100) }))
  const best = scored[0]
  if (best && best.score >= 1) return { ...use(best.p, 'title'), candidates: res.candidates }
  // Fuzzy only when clearly ahead of the runner-up, so "Holy Forever" never silently becomes "Holy Spirit".
  if (best && best.score >= 0.86 && (!scored[1] || best.score - scored[1].score > 0.08)) return { ...use(best.p, 'fuzzy'), candidates: res.candidates }
  return res
}

/* ───────────── three-way sync ───────────── */

const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const FIELDS = ['title', 'length', 'notes', 'people'] as const
type Field = (typeof FIELDS)[number]
const getField = (it: PlaylistItem, f: Field): unknown => (it as unknown as Record<string, unknown>)[f]
const setField = (it: PlaylistItem, f: Field, v: unknown): void => {
  if (f === 'people' && it.type !== 'presentation' && it.type !== 'placeholder') return
  if (f === 'notes' && it.type === 'media') return
  if (v === undefined) delete (it as unknown as Record<string, unknown>)[f]
  else (it as unknown as Record<string, unknown>)[f] = v
}
const fmtLen = (s?: number): string => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : 'none')
const describe = (f: Field, from: unknown, to: unknown): string =>
  f === 'length' ? `length ${fmtLen(from as number)} → ${fmtLen(to as number)}`
  : f === 'people' ? `who: ${((from as string[]) ?? []).join(', ') || '—'} → ${((to as string[]) ?? []).join(', ') || '—'}`
  : f === 'title' ? `renamed “${from ?? ''}” → “${to ?? ''}”`
  : 'notes changed'

export interface SyncOptions {
  settings: Pick<PcoSettings, 'includePrePost' | 'personNoteCategories'>
  /** PCO item id → presentation (and arrangement) to link; undefined = placeholder. */
  resolveSong: (d: DesiredItem) => { presentationId: ID; arrangementId?: ID } | undefined
  /** changeId → decision. Missing = the change's default. */
  decisions?: Record<string, 'accept' | 'reject'>
  newId: () => ID
  now?: string
}

export interface SyncResult { playlist: Playlist; changes: PlanChange[]; applied: number }

function makeItem(d: DesiredItem, id: ID, opts: SyncOptions): PlaylistItem {
  const { base, kind } = d
  if (kind === 'header') return { id, type: 'header', title: base.title, ...(base.length ? { length: base.length } : {}), ...(base.notes ? { notes: base.notes } : {}) }
  const common = { ...(base.length ? { length: base.length } : {}), ...(base.notes ? { notes: base.notes } : {}), ...(base.people ? { people: base.people } : {}) }
  if (kind === 'song') {
    const hit = opts.resolveSong(d)
    if (hit) return { id, type: 'presentation', presentationId: hit.presentationId, title: base.title, ...(hit.arrangementId ? { arrangementId: hit.arrangementId } : {}), ...common }
  }
  return { id, type: 'placeholder', title: base.title, hint: HINTS[kind], ...common }
}

function originOf(d: DesiredItem): ItemOrigin {
  const o: ItemOrigin = { pcoItemId: d.item.id, kind: d.kind, base: d.base }
  if (d.item.song) { o.songId = d.item.song.id; if (d.item.song.ccli) o.ccli = d.item.song.ccli }
  if (d.item.arrangement) o.arrangementId = d.item.arrangement.id
  if (d.item.keyName) o.key = d.item.keyName
  if (d.item.servicePosition) o.position = d.item.servicePosition
  return o
}

export function planDate(plan: Pick<PcoPlan, 'sortDate' | 'times'>): string | undefined {
  const first = plan.times.find((t) => t.type === 'service')?.startsAt ?? plan.sortDate
  if (!first) return undefined
  const d = new Date(first)
  if (isNaN(d.getTime())) return undefined
  // Local calendar date of the first service.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function planName(plan: Pick<PcoPlan, 'title' | 'dates' | 'seriesTitle'>): string {
  return [plan.dates, plan.title].filter(Boolean).join(' — ') || plan.seriesTitle || 'Service plan'
}

/**
 * Create (existing = null) or update a playlist from a plan. Never mutates `existing`.
 * With no `decisions`, every change takes its default: safe updates are applied, conflicts keep the local edit.
 */
export function syncPlaylist(existing: Playlist | null, plan: PcoPlan, opts: SyncOptions): SyncResult {
  const now = opts.now ?? new Date().toISOString()
  const desired = desiredItems(plan, opts.settings)
  const old = pcoSource(existing)
  const changes: PlanChange[] = []
  const decide = (c: PlanChange): boolean => { changes.push(c); return (opts.decisions?.[c.id] ?? c.default) === 'accept' }

  const oldItems = new Map((existing?.items ?? []).map((i) => [i.id, i]))
  const byPco = new Map<string, { localId: ID; origin: ItemOrigin }>()
  for (const [localId, origin] of Object.entries(old?.origins ?? {})) byPco.set(origin.pcoItemId, { localId, origin })

  const origins: Record<ID, ItemOrigin> = {}
  /** pcoItemId → resulting local item (only for items present in the result). */
  const resultByPco = new Map<string, PlaylistItem>()
  const first = !existing || !old

  for (const d of desired) {
    const prev = byPco.get(d.item.id)
    if (!prev) {
      const add = first || decide({ id: `add:${d.item.id}`, type: 'added', title: d.base.title, detail: d.kind === 'header' ? 'New section' : `New ${d.kind === 'generic' ? 'item' : d.kind}${d.base.people ? ` — ${d.base.people.join(', ')}` : ''}`, default: 'accept' })
      if (add) {
        const it = makeItem(d, opts.newId(), opts)
        origins[it.id] = originOf(d)
        resultByPco.set(d.item.id, it)
      }
      continue
    }
    const local = oldItems.get(prev.localId)
    if (!local) { origins[prev.localId] = { ...originOf(d) }; continue } // removed locally on purpose — stays removed
    let it: PlaylistItem = { ...local }
    const base: ItemBase = { ...prev.origin.base }
    const safe: Field[] = [], clash: Field[] = []
    for (const f of FIELDS) {
      if (eq(d.base[f], base[f])) continue
      const lv = getField(local, f)
      if (eq(lv, d.base[f])) { base[f] = d.base[f] as never; continue }
      if (eq(lv, base[f]) || (f === 'title' && lv === undefined)) safe.push(f)
      else clash.push(f)
    }
    if (safe.length) {
      const ok = decide({ id: `upd:${d.item.id}`, type: 'updated', title: d.base.title, detail: safe.map((f) => describe(f, base[f], d.base[f])).join('; '), default: 'accept' })
      if (ok) for (const f of safe) { setField(it, f, d.base[f]); if (d.base[f] === undefined) delete base[f]; else base[f] = d.base[f] as never }
    }
    if (clash.length) {
      const take = decide({ id: `cfl:${d.item.id}`, type: 'conflict', title: d.base.title, detail: `Changed here AND in Planning Center (${clash.map((f) => describe(f, getField(local, f), d.base[f])).join('; ')}). Keeping your version unless you accept.`, default: 'reject' })
      for (const f of clash) { if (take) setField(it, f, d.base[f]); if (d.base[f] === undefined) delete base[f]; else base[f] = d.base[f] as never }
    }
    if (d.base.songKey !== base.songKey) {
      const songChanged = d.item.song?.id !== prev.origin.songId
      const ok = decide({ id: `song:${d.item.id}`, type: 'song', title: d.base.title, detail: songChanged ? 'A different song is now in this slot' : `Arrangement changed${d.item.arrangement?.name ? ` to “${d.item.arrangement.name}”` : ''}`, default: 'accept' })
      if (ok) {
        const fresh = makeItem(d, it.id, opts)
        if (songChanged) it = fresh
        else if (it.type === 'presentation' && fresh.type === 'presentation') it = { ...it, arrangementId: fresh.arrangementId }
        base.songKey = d.base.songKey
      }
    } else if (d.kind === 'song' && it.type === 'placeholder') {
      // A song that was a placeholder may be matchable now (imported since the last pull).
      const fresh = makeItem(d, it.id, opts)
      if (fresh.type === 'presentation') it = { ...fresh, ...(it.notes !== undefined ? { notes: it.notes } : {}), ...(it.people ? { people: it.people } : {}), ...(it.length ? { length: it.length } : {}), title: it.title }
    }
    origins[it.id] = { ...originOf(d), base, ...(base.songKey !== d.base.songKey ? { songId: prev.origin.songId, arrangementId: prev.origin.arrangementId } : {}) }
    resultByPco.set(d.item.id, it)
  }

  // Items Planning Center no longer has.
  const desiredIds = new Set(desired.map((d) => d.item.id))
  const keptRemoved: { localId: ID; origin: ItemOrigin; item: PlaylistItem }[] = []
  for (const [pcoId, prev] of byPco) {
    if (desiredIds.has(pcoId)) continue
    const local = oldItems.get(prev.localId)
    if (!local) continue
    const gone = decide({ id: `del:${pcoId}`, type: 'removed', title: getField(local, 'title') as string ?? prev.origin.base.title, detail: 'Removed from the plan in Planning Center', default: 'accept' })
    if (!gone) { keptRemoved.push({ localId: prev.localId, origin: prev.origin, item: local }); origins[prev.localId] = prev.origin }
  }

  // Order. Remote order unless the operator re-ordered locally and Planning Center didn't.
  const remoteOrder = desired.map((d) => d.item.id)
  const localOrder = (existing?.items ?? []).map((i) => old?.origins[i.id]?.pcoItemId).filter((x): x is string => !!x)
  const present = (ids: string[]): string[] => ids.filter((id) => resultByPco.has(id) && byPco.has(id) && oldItems.has(byPco.get(id)!.localId))
  const baseSeq = present(old?.baseOrder ?? []), remoteSeq = present(remoteOrder), localSeq = present(localOrder)
  const remoteMoved = !eq([...remoteSeq].sort(), [...baseSeq].sort()) ? !eq(remoteSeq, localSeq) : !eq(remoteSeq, baseSeq)
  const localMoved = !eq(localSeq, baseSeq.filter((id) => localSeq.includes(id)))
  let useRemoteOrder = true
  if (!first && !eq(remoteSeq, localSeq)) {
    if (!remoteMoved) useRemoteOrder = false // only the operator re-ordered: keep it silently
    else useRemoteOrder = decide(localMoved
      ? { id: 'order', type: 'conflict', title: 'Order of service', detail: 'The order changed here AND in Planning Center. Keeping your order unless you accept.', default: 'reject' }
      : { id: 'order', type: 'moved', title: 'Order of service', detail: 'Items were re-ordered in Planning Center', default: 'accept' })
  }
  let orderIds: string[]
  if (useRemoteOrder) orderIds = remoteOrder.filter((id) => resultByPco.has(id))
  else {
    orderIds = localSeq.slice()
    for (let i = 0; i < remoteOrder.length; i++) {
      const id = remoteOrder[i]
      if (!resultByPco.has(id) || orderIds.includes(id)) continue
      let at = 0
      for (let j = i - 1; j >= 0; j--) { const k = orderIds.indexOf(remoteOrder[j]); if (k >= 0) { at = k + 1; break } }
      orderIds.splice(at, 0, id)
    }
  }
  const items: PlaylistItem[] = orderIds.map((id) => resultByPco.get(id)!)
  // Local-only items (and remote-removed items the operator chose to keep) go back after the neighbour they followed.
  const inResult = new Set(items.map((i) => i.id))
  const extras = (existing?.items ?? []).filter((i) => !inResult.has(i.id) && (!old?.origins[i.id] || keptRemoved.some((k) => k.localId === i.id)))
  const oldSeq = existing?.items ?? []
  for (const extra of extras) {
    let at = 0
    for (let j = oldSeq.findIndex((i) => i.id === extra.id) - 1; j >= 0; j--) {
      const k = items.findIndex((i) => i.id === oldSeq[j].id)
      if (k >= 0) { at = k + 1; break }
    }
    items.splice(at, 0, extra)
  }

  const applied = changes.filter((c) => (opts.decisions?.[c.id] ?? c.default) === 'accept').length
  const source: PcoPlaylistSource = {
    ...(old ?? {}), type: 'pco', ref: plan.id, serviceTypeId: plan.serviceTypeId, syncedAt: now, planUpdatedAt: plan.updatedAt,
    title: plan.title, seriesTitle: plan.seriesTitle, url: plan.url, times: plan.times, roles: planRoles(plan.people), origins, baseOrder: remoteOrder
  }
  const playlist: Playlist = {
    ...(existing ?? { id: opts.newId(), updatedAt: now }),
    name: existing && !first && existing.name !== planName({ title: old?.title, dates: plan.dates, seriesTitle: old?.seriesTitle }) ? existing.name : planName(plan),
    date: planDate(plan) ?? existing?.date,
    items, source: source as unknown as Playlist['source'], updatedAt: existing?.updatedAt ?? now
  }
  return { playlist, changes, applied }
}

/* ───────────── timers ───────────── */

export interface TimerDoc { id: string; name: string; kind: 'countdown' | 'countdownTo' | 'elapsed'; target?: string; duration?: number; running?: boolean; source?: string }

/** "Service starts 10:00" suggestions from the plan's service times (distinct local clock times). */
export function timerSuggestions(plan: Pick<PcoPlan, 'times' | 'id'>, existing: TimerDoc[] = []): { id: string; name: string; target: string; exists: boolean }[] {
  const seen = new Set<string>()
  const out: { id: string; name: string; target: string; exists: boolean }[] = []
  for (const t of plan.times) {
    if (t.type !== 'service') continue
    const d = new Date(t.startsAt)
    if (isNaN(d.getTime())) continue
    const target = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    if (seen.has(target)) continue
    seen.add(target)
    const h = d.getHours() % 12 || 12
    const nice = `${h}:${String(d.getMinutes()).padStart(2, '0')}`
    const id = `pco-service-${target.replace(':', '')}`
    out.push({ id, name: `${t.name ? t.name : 'Service'} starts ${nice}`, target, exists: existing.some((e) => e.id === id || (e.kind === 'countdownTo' && e.target === target)) })
  }
  return out
}

/* ───────────── lyrics → presentation text ───────────── */

const SECTION = /^\s*\[?\s*((?:verse|chorus|bridge|pre[- ]?chorus|intro|outro|tag|ending|interlude|refrain|vamp|turnaround|instrumental|misc)\s*\d*[a-z]?)\s*\]?\s*:?\s*$/i
const CHORD_LINE = /^\s*(?:[A-G][#b]?(?:maj|min|m|sus|dim|aug|add)?\d*(?:\/[A-G][#b]?)?\s+)*[A-G][#b]?(?:maj|min|m|sus|dim|aug|add)?\d*(?:\/[A-G][#b]?)?\s*$/

/** PCO short labels → full names: "V1" → "Verse 1", "C" → "Chorus", "PC" → "Pre-Chorus". */
export function expandLabel(label: string): string {
  const m = /^\s*(pc|prechorus|pre-chorus|v|c|b|i|o|t|e|inst|int|r)\s*(\d*)\s*$/i.exec(label)
  if (!m) return label.trim().toLowerCase().replace(/\s+/g, ' ').replace(/(^|\s|-)\w/g, (c) => c.toUpperCase())
  const map: Record<string, string> = { v: 'Verse', c: 'Chorus', b: 'Bridge', pc: 'Pre-Chorus', prechorus: 'Pre-Chorus', 'pre-chorus': 'Pre-Chorus', i: 'Intro', o: 'Outro', t: 'Tag', e: 'Ending', inst: 'Instrumental', int: 'Interlude', r: 'Refrain' }
  return `${map[m[1].toLowerCase()]}${m[2] ? ' ' + m[2] : ''}`
}

/** Strip chords ("[G]", chord-only lines) and PCO directives from a chord chart, leaving lyrics. */
export function cleanLyrics(text: string): string {
  return text.replace(/\r/g, '').split('\n')
    .filter((l) => !/^\s*(COLUMN_BREAK|PAGE_BREAK|TRANSPOSE KEY.*|CCLI.*|©.*)\s*$/i.test(l))
    .map((l) => l.replace(/\[[^\]\n]{1,12}\]/g, (m) => (SECTION.test(m) ? m : '')).replace(/\{[^}]*\}/g, '').replace(/[ \t]+$/g, ''))
    .filter((l) => !(l.trim() && CHORD_LINE.test(l)))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export interface SongSections { sections: { label: string; lines: string[] }[]; sequence: string[] }

/** Split PCO lyrics into labelled sections; `sequence` is the arrangement order (falls back to document order). */
export function parseSong(src: { lyrics?: string; sections?: { label: string; lyrics: string }[]; sequence?: string[] }): SongSections {
  let sections: { label: string; lines: string[] }[] = []
  if (src.sections?.length) {
    sections = src.sections.map((s) => ({ label: expandLabel(s.label), lines: cleanLyrics(s.lyrics).split('\n') }))
  } else {
    let cur: { label: string; lines: string[] } | null = null
    for (const line of cleanLyrics(src.lyrics ?? '').split('\n')) {
      const m = SECTION.exec(line)
      if (m) { cur = { label: expandLabel(m[1]), lines: [] }; sections.push(cur); continue }
      if (!cur) { if (!line.trim()) continue; cur = { label: 'Verse 1', lines: [] }; sections.push(cur) }
      cur.lines.push(line)
    }
  }
  // Merge duplicate labels (first definition wins), trim blank edges.
  const seen = new Map<string, { label: string; lines: string[] }>()
  for (const s of sections) {
    while (s.lines.length && !s.lines[0].trim()) s.lines.shift()
    while (s.lines.length && !s.lines[s.lines.length - 1].trim()) s.lines.pop()
    if (s.lines.length && !seen.has(s.label.toLowerCase())) seen.set(s.label.toLowerCase(), s)
  }
  sections = [...seen.values()]
  const sequence = (src.sequence ?? []).map(expandLabel).filter((l) => seen.has(l.toLowerCase())).map((l) => seen.get(l.toLowerCase())!.label)
  return { sections, sequence: sequence.length ? sequence : sections.map((s) => s.label) }
}

/** Text in the "blank line = new slide, heading line = new group" format `library.create` understands. */
export function songToText(song: SongSections, linesPerSlide = 4): string {
  const out: string[] = []
  for (const s of song.sections) {
    const slides: string[][] = []
    let cur: string[] = []
    for (const line of s.lines) {
      if (!line.trim()) { if (cur.length) slides.push(cur); cur = []; continue }
      cur.push(line.trim())
      if (cur.length >= linesPerSlide) { slides.push(cur); cur = [] }
    }
    if (cur.length) slides.push(cur)
    // Avoid a lonely one-line last slide when the section splits unevenly (5 lines → 3 + 2).
    for (let i = 1; i < slides.length; i++) if (slides[i].length === 1 && slides[i - 1].length > 2) slides[i].unshift(slides[i - 1].pop()!)
    slides.forEach((sl, i) => out.push((i === 0 ? s.label + '\n' : '') + sl.join('\n')))
  }
  return out.join('\n\n')
}
