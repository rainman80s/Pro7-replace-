/**
 * Thumbnails for the media bin, generated in the renderer (video frame / image → canvas → small JPEG data URL)
 * and cached on the MediaItem (`thumbnail`, plus width/height/duration) so every computer gets them through sync.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { MediaItem } from '@shared/model'
import { mediaUrl } from '@shared/media'
import { api } from '../../app/store'

const THUMB_W = 256
/** At most this many files are decoded/streamed at once (hundreds of large .mov/.mp4 files in parallel time out disks and cloud-synced folders). */
const CONCURRENCY = 3
const RETRY_DELAY_MS = 4000
const inflight = new Set<string>()
/** Items that failed this session after a retry: not probed again until reload (not persisted — the failure may be transient). */
const gaveUp = new Set<string>()
const pending: { item: MediaItem; attempt: number }[] = []
let running = 0

function drawThumb(src: CanvasImageSource, w: number, h: number): string {
  const k = Math.min(1, THUMB_W / w)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * k))
  c.height = Math.max(1, Math.round(h * k))
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.65)
}

/** Resolves with metadata; `permanent` is set when the file itself can't be decoded (as opposed to a timeout / I/O error). */
export function probeMedia(item: MediaItem): Promise<Partial<MediaItem> & { permanent?: boolean }> {
  const url = mediaUrl(item)
  return new Promise((resolve) => {
    const fail = (permanent = false): void => resolve({ permanent })
    if (item.kind === 'image') {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try { resolve({ width: img.naturalWidth, height: img.naturalHeight, thumbnail: drawThumb(img, img.naturalWidth, img.naturalHeight) }) } catch { resolve({ width: img.naturalWidth, height: img.naturalHeight }) }
      }
      img.onerror = () => fail(true)
      img.src = url
    } else if (item.kind === 'video') {
      const v = document.createElement('video')
      v.crossOrigin = 'anonymous'
      v.muted = true
      v.preload = 'metadata'
      const t = setTimeout(() => { v.removeAttribute('src'); v.load(); fail() }, 20000)
      v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 3) }
      v.onseeked = () => {
        clearTimeout(t)
        const meta = { width: v.videoWidth, height: v.videoHeight, duration: isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : undefined }
        try { resolve({ ...meta, thumbnail: drawThumb(v, v.videoWidth, v.videoHeight) }) } catch { resolve(meta) }
        v.removeAttribute('src')
        v.load()
      }
      v.onerror = () => { clearTimeout(t); const code = v.error?.code; v.removeAttribute('src'); v.load(); fail(code === MediaError.MEDIA_ERR_DECODE || code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) }
      v.src = url
    } else {
      const a = document.createElement('audio')
      a.preload = 'metadata'
      a.onloadedmetadata = () => resolve({ duration: isFinite(a.duration) ? Math.round(a.duration * 10) / 10 : undefined })
      a.onerror = () => fail()
      a.src = url
    }
  })
}

const batch = new Map<string, Partial<MediaItem>>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
function flush(): void {
  flushTimer = null
  const items = [...batch].map(([id, meta]) => ({ id, ...meta }))
  batch.clear()
  if (items.length) void api.invoke('media.updateMany', { items }).catch(() => {})
}
function store(id: string, meta: Partial<MediaItem>): void {
  batch.set(id, meta)
  if (batch.size >= 25) flush()
  else flushTimer ??= setTimeout(flush, 1500)
}

function pump(): void {
  while (running < CONCURRENCY && pending.length) {
    const job = pending.shift()!
    running++
    void (async () => {
      const { item } = job
      const { permanent, ...meta } = await probeMedia(item).catch(() => ({ permanent: false } as Partial<MediaItem> & { permanent?: boolean }))
      const ok = item.kind === 'audio' ? meta.duration !== undefined : !!meta.thumbnail
      if (ok) store(item.id, meta)
      else if (permanent || job.attempt >= 1) {
        // '' / 0 marks "tried and can't": persisted only when the file is genuinely undecodable, so a flaky disk doesn't poison the cache.
        if (permanent) store(item.id, item.kind === 'audio' ? { ...meta, duration: 0 } : { ...meta, thumbnail: '' })
        else gaveUp.add(item.id)
        inflight.delete(item.id)
      } else setTimeout(() => { pending.push({ item, attempt: job.attempt + 1 }); pump() }, RETRY_DELAY_MS) // one quiet retry
      if (ok) inflight.delete(item.id)
    })().finally(() => { running--; pump() })
  }
}

/** Generate + store a thumbnail once per item (3 at a time, results batched into few writes). */
export function ensureThumb(item: MediaItem): void {
  const done = item.kind === 'audio' ? item.duration !== undefined : item.thumbnail !== undefined
  if (done || inflight.has(item.id) || gaveUp.has(item.id)) return
  inflight.add(item.id)
  pending.push({ item, attempt: 0 })
  pump()
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
