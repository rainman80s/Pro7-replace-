/** Factories for new slide elements with volunteer-friendly defaults. */
import type { LiveElement, MediaRef, ShapeElement, Size, SlideElement, TextElement } from '@shared/model'
import { uid } from '@shared/editor-util'

export function textElement(size: Size, opts: Partial<TextElement> = {}): TextElement {
  const w = Math.round(size.width * 0.6)
  const h = Math.round(size.height * 0.22)
  return {
    id: uid(), type: 'text', name: 'Text', role: 'body',
    frame: { x: Math.round((size.width - w) / 2), y: Math.round((size.height - h) / 2), w, h },
    paragraphs: [{ runs: [{ text: 'Double-click to edit' }] }],
    style: { fontFamily: 'Reach Sans', fontSize: Math.round(size.height * 0.06), fontWeight: 600, color: '#FFFFFF', lineHeight: 1.2 },
    align: 'center', verticalAlign: 'middle', autoFit: true, ...opts
  }
}

export function shapeElement(size: Size, shape: ShapeElement['shape']): ShapeElement {
  const s = Math.round(Math.min(size.width, size.height) * 0.3)
  const base = { id: uid(), type: 'shape' as const, shape, name: { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', polygon: 'Triangle' }[shape] }
  if (shape === 'line') return { ...base, frame: { x: Math.round(size.width * 0.3), y: Math.round(size.height / 2 - 10), w: Math.round(size.width * 0.4), h: 20 }, stroke: { color: '#E6A20F', width: 6 } }
  const frame = { x: Math.round((size.width - s) / 2), y: Math.round((size.height - s) / 2), w: s, h: s }
  if (shape === 'polygon') return { ...base, frame, points: [[0.5, 0], [1, 1], [0, 1]], fill: { type: 'color', color: '#3886CE' } }
  return { ...base, frame, fill: { type: 'color', color: shape === 'rect' ? '#3886CE' : '#E6A20F' } }
}

/** Image/video element; `at` = drop point (centre). Full-screen media becomes a background-sized element. */
export function mediaElement(media: MediaRef, size: Size, at?: [number, number]): SlideElement {
  const mw = media.width ?? 1600
  const mh = media.height ?? 900
  const k = Math.min((size.width * (at ? 0.5 : 1)) / mw, (size.height * (at ? 0.5 : 1)) / mh)
  const w = Math.round(mw * k)
  const h = Math.round(mh * k)
  const cx = at?.[0] ?? size.width / 2
  const cy = at?.[1] ?? size.height / 2
  const frame = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h }
  const ref: MediaRef = { id: media.id, kind: media.kind, src: media.src, name: media.name, width: media.width, height: media.height, duration: media.duration }
  if (media.kind === 'video') return { id: uid(), type: 'video', name: media.name ?? 'Video', media: ref, frame, fit: 'cover', loop: true, muted: true }
  return { id: uid(), type: 'image', name: media.name ?? 'Image', media: ref, frame, fit: 'contain' }
}

export function liveElement(size: Size, kind: LiveElement['source']['kind'] = 'camera'): LiveElement {
  const w = Math.round(size.width * 0.4)
  const h = Math.round((w * 9) / 16)
  return { id: uid(), type: 'live', name: kind === 'web' ? 'Web page' : 'Camera', source: { kind, ref: '' }, frame: { x: Math.round((size.width - w) / 2), y: Math.round((size.height - h) / 2), w, h }, fit: 'cover' }
}

/** A {token} text box for stage layouts. */
export function tokenElement(size: Size, token: string, label: string): TextElement {
  return textElement(size, { name: label, role: undefined, dynamic: true, paragraphs: [{ runs: [{ text: `{${token}}` }] }], align: 'left' })
}
