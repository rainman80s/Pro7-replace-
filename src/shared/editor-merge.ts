/**
 * Three-way merge used when a presentation changes on disk (another computer, cloud sync, an importer)
 * while it is open with unsaved edits in the editor. Slide-level granularity:
 * whichever side changed a slide wins; if both changed the same slide it is a conflict and "mine" is kept.
 */
import type { Presentation, Slide } from './model'
import { sameJson } from './editor-util'

export interface MergeResult {
  merged: Presentation
  /** Slide ids both sides edited (mine kept). */
  conflicts: string[]
  /** True if anything from "theirs" was taken. */
  tookTheirs: boolean
}

export function mergePresentation(base: Presentation, mine: Presentation, theirs: Presentation): MergeResult {
  const conflicts: string[] = []
  let tookTheirs = false
  const b = new Map(base.slides.map((s) => [s.id, s]))
  const t = new Map(theirs.slides.map((s) => [s.id, s]))
  const m = new Map(mine.slides.map((s) => [s.id, s]))

  const mineOrderChanged = mine.slides.map((s) => s.id).join() !== base.slides.map((s) => s.id).join()
  const theirOrderChanged = theirs.slides.map((s) => s.id).join() !== base.slides.map((s) => s.id).join()
  // Start from whichever side restructured the deck (mine wins if both did).
  const order = mineOrderChanged || !theirOrderChanged ? mine.slides.map((s) => s.id) : theirs.slides.map((s) => s.id)
  if (!mineOrderChanged && theirOrderChanged) tookTheirs = true

  const slides: Slide[] = []
  for (const id of order) {
    const bs = b.get(id)
    const ms = m.get(id)
    const ts = t.get(id)
    if (ms && ts) {
      const mineChanged = !bs || !sameJson(ms, bs)
      const theirsChanged = !bs || !sameJson(ts, bs)
      if (mineChanged && theirsChanged && !sameJson(ms, ts)) { conflicts.push(id); slides.push(ms) }
      else if (theirsChanged && !mineChanged) { tookTheirs = true; slides.push(ts) }
      else slides.push(ms)
    } else if (ms) {
      // Deleted by them: keep it only if I added or edited it.
      if (!bs || !sameJson(ms, bs)) slides.push(ms)
      else tookTheirs = true
    } else if (ts) {
      // Deleted by me (in base) → stays deleted unless they edited it; new from them → take.
      if (!bs || !sameJson(ts, bs)) { tookTheirs = true; slides.push(ts) }
    }
  }
  // Slides they added that my order doesn't know about go to the end.
  if (mineOrderChanged || !theirOrderChanged) {
    for (const s of theirs.slides) if (!b.has(s.id) && !m.has(s.id)) { slides.push(s); tookTheirs = true }
  }

  const pick = <K extends keyof Presentation>(k: K): Presentation[K] => {
    if (!sameJson(mine[k], base[k])) return mine[k]
    if (!sameJson(theirs[k], base[k])) { tookTheirs = true; return theirs[k] }
    return mine[k]
  }
  const ids = new Set(slides.map((s) => s.id))
  const merged: Presentation = {
    ...mine,
    title: pick('title'), kind: pick('kind'), size: pick('size'), themeId: pick('themeId'), meta: pick('meta'),
    groups: pick('groups').map((g) => ({ ...g, slideIds: g.slideIds.filter((id) => ids.has(id)) })),
    arrangements: pick('arrangements'), activeArrangementId: pick('activeArrangementId'),
    slides, updatedAt: theirs.updatedAt
  }
  return { merged, conflicts, tookTheirs }
}
