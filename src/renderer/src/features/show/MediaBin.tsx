import { useMemo, useState, type ReactNode } from 'react'
import type { MediaItem } from '@shared/model'
import { Icon, SearchInput, Select } from '@ui/index'
import { useApp } from '../../app/store'
import { playMedia } from '../media'
import { MediaThumb } from '../media/thumbs'

export const MEDIA_MIME = 'application/x-reach-media'
const num = (k: string, d: number): number => { try { return Number(localStorage.getItem(k)) || d } catch { return d } }
const flag = (k: string, d: boolean): boolean => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1' } catch { return d } }
const store = (k: string, v: string): void => { try { localStorage.setItem(k, v) } catch { /* private window */ } }

/** Persisted open/closed + width of the docked bin. */
export function useBinState(): { open: boolean; width: number; setOpen(o: boolean): void; setWidth(w: number): void } {
  const [open, o] = useState(() => flag('reach.bin.open', true))
  const [width, w] = useState(() => Math.min(480, Math.max(200, num('reach.bin.width', 260))))
  return {
    open, width,
    setOpen: (v) => { o(v); store('reach.bin.open', v ? '1' : '0') },
    setWidth: (v) => { const c = Math.min(480, Math.max(200, Math.round(v))); w(c); store('reach.bin.width', String(c)) }
  }
}

/** The media bin, docked next to the slides. Click = on screen as background; drag onto slides, groups or the title. */
export function MediaBin({ width, onWidth, onClose }: { width: number; onWidth(w: number): void; onClose(): void }): ReactNode {
  const media = useApp((s) => s.media)
  const live = useApp((s) => s.live)
  const [q, setQ] = useState('')
  const [folder, setFolder] = useState('*')
  const folders = useMemo(() => [...new Set(media.map((m) => m.folder).filter((f): f is string => !!f))].sort(), [media])
  const needle = q.trim().toLowerCase()
  const items = media.filter((m) => m.kind !== 'audio' && (folder === '*' || (folder === '' ? !m.folder : m.folder === folder)) && (!needle || m.name.toLowerCase().includes(needle) || m.tags?.some((t) => t.toLowerCase().includes(needle))))
  const onAir = (m: MediaItem): boolean => [live.background, live.video].some((l) => l?.media.src === m.src)

  const startResize = (e: React.PointerEvent): void => {
    e.preventDefault()
    const x0 = e.clientX, w0 = width
    const move = (ev: PointerEvent): void => onWidth(w0 + (x0 - ev.clientX))
    const up = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <aside className="bin panel" data-testid="media-bin">
      <div className="bin-resize" onPointerDown={startResize} role="separator" aria-orientation="vertical" aria-label="Resize the media bin" />
      <header className="bin-head">
        <span className="t-label">Media</span>
        <div className="grow" />
        <button type="button" className="bin-x" aria-label="Hide the media bin" onClick={onClose}><Icon name="chevronRight" size={14} /></button>
      </header>
      <div className="bin-tools">
        <SearchInput placeholder="Search media" value={q} onChange={(e) => setQ(e.target.value)} data-testid="bin-search" />
        {folders.length > 0 && (
          <Select value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Folder">
            <option value="*">All media</option><option value="">Unfiled</option>
            {folders.map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
        )}
      </div>
      <div className="bin-grid scroll grow">
        {items.map((m) => (
          <div key={m.id} className={`bin-item ${onAir(m) ? 'live' : ''}`} data-testid="bin-item" draggable title={`${m.name} — click to show, drag onto a slide`}
            onDragStart={(e) => { e.dataTransfer.setData(MEDIA_MIME, JSON.stringify(m)); e.dataTransfer.effectAllowed = 'copy' }}
            onClick={() => playMedia(m)}>
            <MediaThumb item={m} />
            <span className="bin-name truncate">{m.name}</span>
          </div>
        ))}
        {!items.length && <div className="bin-none">{media.length ? 'Nothing matches.' : 'The media bin is empty. Import images and videos in the Media screen.'}</div>}
      </div>
      <footer className="bin-foot t-meta">Drag onto a slide, a section name or the title</footer>
    </aside>
  )
}
