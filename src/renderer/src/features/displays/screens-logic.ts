/** Pure helpers for the Screen Configuration view (unit-tested in tests/placement.test.ts). */
import type { Canvas, ID, Output, Rect, Size } from '@shared/model'
import type { DisplayInfo, ReceiverInfo } from '@shared/api'
import type { DeckLinkDevice } from '@shared/decklink'
import { evenSize, isGroup, sourceRect } from '@shared/outputs'
import { defaultPlacement } from '@shared/placement'

export interface Sel { canvasId: ID; regionId?: ID }
export type ScreenMode = 'single' | 'grouped' | 'wall'

export const selEq = (a: Sel, b: Sel): boolean => a.canvasId === b.canvasId && (a.regionId ?? '') === (b.regionId ?? '')
export const sameSel = (o: Output, s: Sel): boolean => selEq(o, s)

/** Outputs that show exactly this screen/region (not group rows). */
export const outputsFor = (outputs: Output[], s: Sel): Output[] => outputs.filter((o) => !isGroup(o) && sameSel(o, s))
export const groupFor = (outputs: Output[], s: Sel): Output | undefined => outputs.find((o) => isGroup(o) && sameSel(o, s))

export function modeOf(outputs: Output[], s: Sel): ScreenMode {
  const g = groupFor(outputs, s)
  if (g?.groupLayout?.mode === 'wall') return 'wall'
  return g || outputsFor(outputs, s).length > 1 ? 'grouped' : 'single'
}

export const sourceSize = (canvas: Canvas | undefined, regionId?: ID): Size | undefined => {
  const r = sourceRect(canvas, regionId)
  return r ? { width: r.w, height: r.h } : undefined
}

/** The destination frame an output sends to (undefined = unknown, e.g. a TV that hasn't reported yet). */
export function destSizeOf(o: Output | undefined, displays: DisplayInfo[], receivers: ReceiverInfo[], ports: DeckLinkDevice[], src?: Size): Size | undefined {
  const t = o?.target
  if (!t) return undefined
  if (t.type === 'display') { const d = displays.find((x) => x.key === t.displayKey); return d ? (d.nativeSize ?? { width: d.bounds.width, height: d.bounds.height }) : undefined }
  if (t.type === 'network') { const r = receivers.find((x) => x.id === t.receiverId); return r?.width && r?.height ? { width: r.width, height: r.height } : undefined }
  if (t.type === 'decklink') { const m = ports.find((p) => p.key === t.device)?.modes.find((x) => x.id === t.mode); return m ? { width: m.width, height: m.height } : undefined }
  if (t.type === 'ndi') return src ? evenSize(src) : undefined
  return src
}

/** ProPresenter default: a screen smaller than its destination is placed Custom at 0,0 pixel for pixel; otherwise Fit. */
export function initialPlacement(src: Size | undefined, dest: Size | undefined): Rect | undefined {
  if (!src || !dest) return undefined
  if (src.width >= dest.width && src.height >= dest.height) return undefined
  return defaultPlacement(src, dest)
}
