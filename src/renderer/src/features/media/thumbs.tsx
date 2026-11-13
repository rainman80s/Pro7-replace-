/**
 * Thumbnails for the media bin, generated in the renderer (video frame / image → canvas → small JPEG data URL)
 * and cached on the MediaItem (`thumbnail`, plus width/height/duration) so every computer gets them through sync.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { MediaItem } from '@shared/model'
import { mediaUrl } from '@shared/media'
import { api } from '../../app/store'

const THUMB_W = 320
const inflight = new Map<string, Promise<void>>()
let queue = Promise.resolve()

function drawThumb(src: CanvasImageSource, w: number, h: number): string {
  const k = Math.min(1, THUMB_W / w)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * k))
  c.height = Math.max(1, Math.round(h * k))
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.72)
}

export function probeMedia(item: MediaItem): Promise<Partial<MediaItem>> {
  const url = mediaUrl(item)
  return new Promise((resolve) => {
    const fail = (): void => resolve({})
    if (item.kind === 'image') {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try { resolve({ width: img.naturalWidth, height: img.naturalHeight, thumbnail: drawThumb(img, img.naturalWidth, img.naturalHeight) }) } catch { resolve({ width: img.naturalWidth, height: img.naturalHeight }) }
      }
      img.onerror = fail
      img.src = url
    } else if (item.kind === 'video') {
      const v = document.createElement('video')
      v.crossOrigin = 'anonymous'
      v.muted = true
      v.preload = 'auto'
      const t = setTimeout(fail, 15000)
      v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 3) }
      v.onseeked = () => {
        clearTimeout(t)
        const meta = { width: v.videoWidth, height: v.videoHeight, duration: isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : undefined }
        try { resolve({ ...meta, thumbnail: drawThumb(v, v.videoWidth, v.videoHeight) }) } catch { resolve(meta) }
        v.removeAttribute('src')
        v.load()
      }
      v.onerror = () => { clearTimeout(t); fail() }
      v.src = url
    } else {
      const a = document.createElement('audio')
      a.preload = 'metadata'
      a.onloadedmetadata = () => resolve({ duration: isFinite(a.duration) ? Math.round(a.duration * 10) / 10 : undefined })
      a.onerror = fail
      a.src = url
    }
  })
}

/** Generate + store a thumbnail once per item (serialised so a big import doesn't decode 50 videos at once). */
export function ensureThumb(item: MediaItem): void {
  const done = item.kind === 'audio' ? item.duration !== undefined : item.thumbnail !== undefined
  if (done || inflight.has(item.id)) return
  const p = (queue = queue.then(async () => {
    const meta = await probeMedia(item)
    // '' marks "tried and failed" so a broken file isn't probed forever.
    if (item.kind !== 'audio' && !meta.thumbnail) meta.thumbnail = ''
    if (item.kind === 'audio' && meta.duration === undefined) meta.duration = 0
    const fresh = (await api.invoke('media.list')).find((m) => m.id === item.id)
    if (fresh) await api.invoke('media.update', { item: { ...fresh, ...meta } })
  }).catch(() => {}))
  inflight.set(item.id, p)
}

export function MediaThumb({ item, className }: { item: MediaItem; className?: string }): ReactNode {
  const [failed, setFailed] = useState(false)
  useEffect(() => ensureThumb(item), [item])
  if (item.kind === 'audio') return <div className={`media-thumb audio ${className ?? ''}`}><AudioGlyph /></div>
  if (item.thumbnail) return <div className={`media-thumb ${className ?? ''}`}><img src={item.thumbnail} alt="" draggable={false} /></div>
  if (item.kind === 'image' && !failed) return <div className={`media-thumb ${className ?? ''}`}><img src={mediaUrl(item)} alt="" draggable={false} onError={() => setFailed(true)} loading="lazy" /></div>
  return <div className={`media-thumb ${className ?? ''}`}><span className="dim">{item.kind === 'video' ? 'Video' : 'Missing'}</span></div>
}

function AudioGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 48 48" width="38" height="38" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <path d="M18 34V12l20-4v22" /><circle cx="13" cy="34" r="5" /><circle cx="33" cy="30" r="5" />
    </svg>
  )
}
