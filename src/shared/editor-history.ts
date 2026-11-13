/**
 * Undo/redo history as plain data (immutable snapshots; presentations share untouched slides structurally).
 * Consecutive changes with the same `key` inside `window` ms collapse into one undo step
 * (typing, dragging a slider, nudging with arrows).
 */
export interface History<T> {
  past: { state: T; label: string }[]
  present: T
  future: { state: T; label: string }[]
  /** Label/key/time of the change that produced `present`. */
  label: string
  key?: string
  at: number
}

export const HISTORY_LIMIT = 200
export const COALESCE_MS = 900

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], label: '', at: 0 }
}

export function pushHistory<T>(h: History<T>, next: T, label: string, key?: string, now = Date.now(), window = COALESCE_MS): History<T> {
  if (next === h.present) return h
  if (key && key === h.key && now - h.at <= window && h.past.length) {
    // Same gesture: replace the present, keep the undo point.
    return { ...h, present: next, future: [], label, at: now }
  }
  const past = [...h.past, { state: h.present, label }]
  if (past.length > HISTORY_LIMIT) past.shift()
  return { past, present: next, future: [], label, key, at: now }
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1]
  if (!prev) return h
  return { past: h.past.slice(0, -1), present: prev.state, future: [{ state: h.present, label: prev.label }, ...h.future], label: '', key: undefined, at: 0 }
}

export function redo<T>(h: History<T>): History<T> {
  const next = h.future[0]
  if (!next) return h
  return { past: [...h.past, { state: h.present, label: next.label }], present: next.state, future: h.future.slice(1), label: '', key: undefined, at: 0 }
}

export const canUndo = <T,>(h: History<T>): boolean => h.past.length > 0
export const canRedo = <T,>(h: History<T>): boolean => h.future.length > 0
export const undoLabel = <T,>(h: History<T>): string => h.past[h.past.length - 1]?.label ?? ''
export const redoLabel = <T,>(h: History<T>): string => h.future[0]?.label ?? ''
