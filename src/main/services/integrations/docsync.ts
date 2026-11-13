/**
 * Re-sync for presentations generated from an outside document (Notion page, Figma page).
 *
 * Each generated slide has a stable `key` (source block / frame id) and a `srcHash` (hash of its source
 * content). We store, per key, the slide id we produced and a hash of the slide *as we rendered it*.
 * On re-sync:
 *   - source unchanged                  → keep the existing slide exactly (operator restyles survive)
 *   - source changed, slide untouched   → replace it
 *   - source changed, slide restyled    → CONFLICT (default: keep the operator's slide)
 *   - source gone                       → remove (or conflict if restyled)
 *   - new source slide                  → add
 * Local-only slides (not from the document) are kept after the slide they followed.
 */
import type { ID, Presentation, Slide } from '@shared/model'
import type { DocSlideChange } from '@shared/integrations'
import { hashOf } from './http'

export interface DocSlideRecord { slideId: ID; srcHash: string; renderHash: string }
export interface DocSource { type: string; ref: string; syncedAt: string; slides: Record<string, DocSlideRecord>; order: string[]; [k: string]: unknown }

export interface GeneratedSlide { key: string; srcHash: string; slide: Slide; label?: string }

/** Hash of what the operator sees — ids, notes and enabled are excluded so only real edits count. */
export function renderHash(s: Slide): string {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip)
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) if (k !== 'id' && x !== undefined) o[k] = strip(x)
      return o
    }
    return v
  }
  return hashOf(strip({ elements: s.elements, background: s.background, variants: s.variants, autoAdvance: s.autoAdvance, actions: s.actions?.length ?? 0 }))
}

export function docSource(p: Presentation | null | undefined, type: string): DocSource | null {
  const s = p?.meta.source
  return s && s.type === type && typeof s.slides === 'object' ? (s as unknown as DocSource) : null
}

export interface DocSyncResult { slides: Slide[]; source: DocSource; changes: DocSlideChange[] }

export function syncDocSlides(existing: Presentation | null, type: string, ref: string, gen: GeneratedSlide[], opts: { decisions?: Record<string, 'accept' | 'reject'>; now?: string; extra?: Record<string, unknown> } = {}): DocSyncResult {
  const old = docSource(existing, type)
  const oldSlides = new Map((existing?.slides ?? []).map((s) => [s.id, s]))
  const changes: DocSlideChange[] = []
  const records: Record<string, DocSlideRecord> = {}
  const out: Slide[] = []
  const accept = (c: DocSlideChange, def: 'accept' | 'reject'): boolean => {
    changes.push(c)
    return (opts.decisions?.[c.key] ?? def) === 'accept'
  }
  const seen = new Set<string>()
  for (const g of gen) {
    if (seen.has(g.key)) continue
    seen.add(g.key)
    const rec = old?.slides[g.key]
    const cur = rec && oldSlides.get(rec.slideId)
    if (!rec) {
      if (!old || accept({ key: g.key, type: 'added', label: g.label ?? 'New slide' }, 'accept')) {
        out.push(g.slide)
        records[g.key] = { slideId: g.slide.id, srcHash: g.srcHash, renderHash: renderHash(g.slide) }
      }
      continue
    }
    if (!cur) {
      // The operator deleted this slide. Unchanged upstream → it stays deleted.
      if (rec.srcHash === g.srcHash) { records[g.key] = rec; continue }
      if (accept({ key: g.key, type: 'added', label: g.label ?? 'Slide', detail: 'Changed in the source (you had deleted this slide)' }, 'accept')) {
        out.push(g.slide)
        records[g.key] = { slideId: g.slide.id, srcHash: g.srcHash, renderHash: renderHash(g.slide) }
      } else records[g.key] = { ...rec, srcHash: g.srcHash }
      continue
    }
    const edited = renderHash(cur) !== rec.renderHash
    if (rec.srcHash === g.srcHash) {
      out.push(cur)
      records[g.key] = rec
      changes.push({ key: g.key, type: 'same', label: g.label ?? cur.label ?? '', slideId: cur.id })
      continue
    }
    if (!edited) {
      const take = accept({ key: g.key, type: 'changed', label: g.label ?? 'Slide', slideId: cur.id }, 'accept')
      const s = take ? { ...g.slide, id: cur.id, notes: g.slide.notes ?? cur.notes } : cur
      out.push(s)
      records[g.key] = take ? { slideId: s.id, srcHash: g.srcHash, renderHash: renderHash(s) } : rec
    } else {
      const take = accept({ key: g.key, type: 'conflict', label: g.label ?? 'Slide', slideId: cur.id, detail: 'Changed in the source, but this slide was restyled here. Keeping your version unless you accept.' }, 'reject')
      const s = take ? { ...g.slide, id: cur.id } : { ...cur, notes: g.slide.notes ?? cur.notes }
      out.push(s)
      // Rejected: remember the new source hash so we don't ask again until it changes once more.
      records[g.key] = take ? { slideId: s.id, srcHash: g.srcHash, renderHash: renderHash(s) } : { ...rec, srcHash: g.srcHash }
    }
  }
  if (old) {
    for (const [key, rec] of Object.entries(old.slides)) {
      if (seen.has(key)) continue
      const cur = oldSlides.get(rec.slideId)
      if (!cur) continue
      const edited = renderHash(cur) !== rec.renderHash
      const remove = accept({ key, type: edited ? 'conflict' : 'removed', label: cur.label ?? 'Slide', slideId: cur.id, detail: edited ? 'Removed from the source, but restyled here. Keeping it unless you accept.' : 'Removed from the source' }, edited ? 'reject' : 'accept')
      if (!remove) { records[key] = rec; out.push(cur) }
    }
    // Local-only slides go back after their previous neighbour.
    const fromDoc = new Set(Object.values(old.slides).map((r) => r.slideId))
    const prevOrder = existing?.slides ?? []
    for (let i = 0; i < prevOrder.length; i++) {
      const s = prevOrder[i]
      if (fromDoc.has(s.id) || out.some((o) => o.id === s.id)) continue
      let at = 0
      for (let j = i - 1; j >= 0; j--) { const k = out.findIndex((o) => o.id === prevOrder[j].id); if (k >= 0) { at = k + 1; break } }
      out.splice(at, 0, s)
    }
  }
  return {
    slides: out,
    changes,
    source: { ...(old ?? {}), ...(opts.extra ?? {}), type, ref, syncedAt: opts.now ?? new Date().toISOString(), slides: records, order: gen.map((g) => g.key) }
  }
}

/** Keep groups/arrangements consistent after slides were added/removed. */
export function tidyPresentation(p: Presentation): Presentation {
  const ids = new Set(p.slides.map((s) => s.id))
  const groups = p.groups.map((g) => ({ ...g, slideIds: g.slideIds.filter((id) => ids.has(id)) })).filter((g) => g.slideIds.length)
  const gids = new Set(groups.map((g) => g.id))
  return { ...p, groups, arrangements: p.arrangements.map((a) => ({ ...a, groupIds: a.groupIds.filter((id) => gids.has(id)) })) }
}
