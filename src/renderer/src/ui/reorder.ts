import { useRef, useState, type DragEvent } from 'react'

/**
 * Drag-to-reorder for any vertical (or wrapping) list, using native HTML drag & drop.
 *
 *   const dnd = useDragReorder({ count: items.length, onReorder: (from, to) => save(moveItem(items, from, to)) })
 *   {items.map((it, i) => <div key={it.id} {...dnd.itemProps(i)}>…</div>)}
 *
 * `to` is the index the dragged item should END UP at (use `moveItem`).
 * To accept things dragged in from elsewhere (e.g. a library row), pass `acceptType` + `onInsert`;
 * the source sets `e.dataTransfer.setData(acceptType, payload)` (see `dragSource`).
 */
export function useDragReorder(opts: {
  count: number
  onReorder: (from: number, to: number) => void
  disabled?: boolean
  /** 'y' (default) splits rows top/bottom; 'x' splits left/right for grids. */
  axis?: 'x' | 'y'
  acceptType?: string
  onInsert?: (payload: string, index: number) => void
}): {
  itemProps: (index: number) => { draggable: boolean; className: string; onDragStart: (e: DragEvent) => void; onDragOver: (e: DragEvent) => void; onDragLeave: (e: DragEvent) => void; onDrop: (e: DragEvent) => void; onDragEnd: () => void }
  /** Put on the list container so drops in empty space append. */
  containerProps: { onDragOver: (e: DragEvent) => void; onDrop: (e: DragEvent) => void }
  dragging: number | null
} {
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<{ index: number; after: boolean } | null>(null)
  const from = useRef<number | null>(null)
  const TYPE = 'application/x-reach-reorder'
  const accepts = (e: DragEvent): 'reorder' | 'insert' | null =>
    from.current !== null && e.dataTransfer.types.includes(TYPE) ? 'reorder' : opts.acceptType && e.dataTransfer.types.includes(opts.acceptType) ? 'insert' : null
  const reset = (): void => { from.current = null; setDragging(null); setOver(null) }
  const finish = (e: DragEvent, slot: number): void => {
    const kind = accepts(e)
    if (!kind) return
    e.preventDefault()
    e.stopPropagation()
    if (kind === 'insert') opts.onInsert?.(e.dataTransfer.getData(opts.acceptType!), slot)
    else {
      const f = from.current!
      const to = slot > f ? slot - 1 : slot
      if (to !== f) opts.onReorder(f, to)
    }
    reset()
  }
  return {
    dragging,
    itemProps: (index) => ({
      draggable: !opts.disabled,
      className: `reorder-item${dragging === index ? ' dragging' : ''}${over?.index === index ? (over.after ? ' drop-after' : ' drop-before') : ''}`,
      onDragStart: (e) => {
        if (opts.disabled) return
        from.current = index
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData(TYPE, String(index))
        // Let the browser snapshot the row before we dim it.
        requestAnimationFrame(() => setDragging(index))
      },
      onDragOver: (e) => {
        if (!accepts(e)) return
        e.preventDefault()
        e.stopPropagation()
        const r = e.currentTarget.getBoundingClientRect()
        const after = opts.axis === 'x' ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2
        if (over?.index !== index || over.after !== after) setOver({ index, after })
      },
      onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o?.index === index ? null : o)) },
      onDrop: (e) => finish(e, over?.index === index && over.after ? index + 1 : index),
      onDragEnd: reset
    }),
    containerProps: {
      onDragOver: (e) => { if (accepts(e)) e.preventDefault() },
      onDrop: (e) => finish(e, opts.count)
    }
  }
}

/** Props for something that can be dragged INTO a reorderable list. */
export function dragSource(type: string, payload: string): { draggable: true; onDragStart: (e: DragEvent) => void } {
  return { draggable: true, onDragStart: (e) => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData(type, payload) } }
}

/** Returns a copy of `list` with the item at `from` moved so it ends up at index `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list]
  if (from < 0 || from >= out.length) return out
  const [it] = out.splice(from, 1)
  out.splice(Math.max(0, Math.min(out.length, to)), 0, it)
  return out
}
