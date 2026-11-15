/**
 * Frame composition + video delay for capture sinks — PURE (Buffers and numbers only), unit-tested in tests/placement.test.ts.
 */
import type { Rect } from '@shared/model'

/**
 * Put a BGRA picture into a larger (or smaller) frame at `at` (top-left, destination pixels). Everything outside the
 * picture is zero (black, and transparent = key 0). Clips to the frame; the picture is never scaled here.
 */
export function composeFrame(src: Buffer, sw: number, sh: number, dw: number, dh: number, at: { x: number; y: number }): Buffer {
  const out = Buffer.alloc(dw * dh * 4)
  const x0 = Math.max(0, at.x), y0 = Math.max(0, at.y)
  const x1 = Math.min(dw, at.x + sw), y1 = Math.min(dh, at.y + sh)
  if (x1 <= x0 || y1 <= y0) return out
  const bytes = (x1 - x0) * 4
  for (let y = y0; y < y1; y++) {
    const s = ((y - at.y) * sw + (x0 - at.x)) * 4
    src.copy(out, (y * dw + x0) * 4, s, s + bytes)
  }
  return out
}

/** Where the picture goes in an SDI frame: the custom placement, else top-left / centred. */
export function pictureOrigin(frame: { width: number; height: number }, mode: { width: number; height: number }, placement?: Rect, align: 'top-left' | 'center' = 'top-left'): { x: number; y: number } {
  if (placement) return { x: placement.x, y: placement.y }
  if (align === 'center') return { x: Math.round((mode.width - frame.width) / 2), y: Math.round((mode.height - frame.height) / 2) }
  return { x: 0, y: 0 }
}

/**
 * Delays a stream of items by a number of milliseconds (frames × frame interval). push() stores; due() returns the newest
 * item whose time has come (older due ones are dropped — a card only shows the latest) or undefined.
 */
export class DelayLine<T> {
  private q: { due: number; item: T }[] = []
  push(item: T, now: number, delayMs: number): void { this.q.push({ due: now + Math.max(0, delayMs), item }) }
  due(now: number): T | undefined {
    let out: T | undefined
    while (this.q.length && this.q[0].due <= now) out = this.q.shift()!.item
    return out
  }
  get pending(): number { return this.q.length }
  clear(): void { this.q = [] }
}
