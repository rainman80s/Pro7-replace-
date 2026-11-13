/**
 * Media view: the media bin. Click = put it on screen (background / foreground video / audio layer),
 * drag files in from Finder, folders/tags/search, per-item playback defaults, transport for what's playing.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { LiveMedia, MediaItem } from '@shared/model'
import { mediaUrl } from '@shared/media'
import { formatDuration, useNow } from '@shared/render/LiveCanvas'
import { Button, Empty, Input, Select, toast } from '@ui/index'
import { defineFeature } from '../../app/feature'
import { api, useApp } from '../../app/store'
import { importFromDisk } from '../editor/media-pick'
import { MediaThumb } from './thumbs'
import './media.css'

export const MEDIA_MIME = 'application/x-reach-media'
type Layer = 'background' | 'video' | 'audio'
const layerFor = (m: MediaItem): Layer => (m.kind === 'audio' ? 'audio' : m.kind === 'video' && m.behavior === 'foreground' ? 'video' : 'background')

export function playMedia(m: MediaItem): void {
  const layer = layerFor(m)
  void api.invoke('live.setMedia', { layer, media: m, loop: m.loop ?? layer === 'background', muted: layer === 'background', fit: m.fit })
}

async function uploadFiles(files: File[], folder?: string): Promise<number> {
  let n = 0
  const paths = files.map((f) => (f as File & { path?: string }).path).filter((p): p is string => !!p)
  if (paths.length === files.length) return (await api.invoke('media.import', { paths, folder })).length
  for (const f of files) {
    const CH = 4 * 1024 * 1024
    const id = `${Date.now()}-${Math.random()}`
    try {
      for (let off = 0; off < Math.max(f.size, 1); off += CH) {
        const chunk = new Uint8Array(await f.slice(off, off + CH).arrayBuffer())
        await api.invoke('media.upload', { uploadId: id, name: f.name, folder, chunk, done: off + CH >= f.size })
      }
      n++
    } catch (e) {
      toast(`Couldn't import ${f.name}`, 'error', String(e))
    }
  }
  return n
}

function MediaView(): ReactNode {
  const media = useApp((s) => s.media)
  const live = useApp((s) => s.live)
  const [q, setQ] = useState('')
  const [folder, setFolder] = useState<string>('*')
  const [sel, setSel] = useState<string | null>(null)
  const [size, setSize] = useState(Number(localStorage.getItem('reach.media.size') ?? 180))
  const [over, setOver] = useState(false)
  const folders = useMemo(() => [...new Set(media.map((m) => m.folder).filter((f): f is string => !!f))].sort(), [media])
  const needle = q.trim().toLowerCase()
  const items = media.filter((m) =>
    (folder === '*' || (folder === '' ? !m.folder : folder === '#audio' ? m.kind === 'audio' : m.folder === folder)) &&
    (!needle || m.name.toLowerCase().includes(needle) || m.tags?.some((t) => t.toLowerCase().includes(needle))))
  const current = media.find((m) => m.id === sel)
  const onAir = (m: MediaItem): boolean => [live.background, live.video, live.audio].some((l) => l?.media.src === m.src)

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setOver(false)
    const files = [...e.dataTransfer.files]
    if (!files.length) return
    const n = await uploadFiles(files, folder !== '*' && folder !== '' && folder !== '#audio' ? folder : undefined)
    if (n) toast(`Imported ${n} file${n === 1 ? '' : 's'}`, 'success')
  }

  return (
    <div className="mb-root" data-testid="media-view">
      <aside className="mb-side">
        <div className="mb-kicker">Media</div>
        {[['*', 'All media'], ['', 'Unfiled'], ...folders.map((f) => [f, f]), ['#audio', 'Audio']].map(([id, name]) => (
          <button key={id} className={`mb-folder ${folder === id ? 'on' : ''}`} onClick={() => setFolder(id)}>{name}<span className="dim">{id === '*' ? media.length : id === '#audio' ? media.filter((m) => m.kind === 'audio').length : media.filter((m) => (id === '' ? !m.folder : m.folder === id)).length}</span></button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => { const n = prompt('New folder name'); if (n?.trim()) setFolder(n.trim()) }}>+ Folder</Button>
      </aside>
      <section className={`mb-main ${over ? 'over' : ''}`} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }} onDragLeave={() => setOver(false)} onDrop={(e) => void onDrop(e)}>
        <div className="mb-bar">
          <Input placeholder="Search media and tags" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} data-testid="media-search" />
          <div className="grow" />
          <input type="range" min={110} max={320} value={size} onChange={(e) => { setSize(Number(e.target.value)); localStorage.setItem('reach.media.size', e.target.value) }} title="Thumbnail size" />
          <Button variant="primary" data-testid="media-import" onClick={() => void importFromDisk(['image', 'video', 'audio']).then((l) => l.length && toast(`Imported ${l.length}`, 'success'))}>Import…</Button>
        </div>
        {!items.length
          ? <Empty title={media.length ? 'Nothing matches' : 'Your media bin is empty'}>Drag images, videos and songs here from Finder, or press Import.</Empty>
          : (
            <div className="mb-grid scroll" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}>
              {items.map((m) => (
                <div key={m.id} className={`mb-item ${sel === m.id ? 'sel' : ''} ${onAir(m) ? 'live' : ''}`} data-testid="media-item" draggable
                  onDragStart={(e) => { e.dataTransfer.setData(MEDIA_MIME, JSON.stringify(m)); e.dataTransfer.effectAllowed = 'copy' }}
                  onClick={() => { setSel(m.id); playMedia(m) }} title="Click to show · select to edit properties">
                  <MediaThumb item={m} />
                  <div className="mb-name">
                    <span>{m.name}</span>
                    <span className="dim">{m.kind === 'image' ? (m.behavior === 'foreground' ? 'Image' : 'Background') : m.kind === 'video' ? (m.behavior === 'foreground' ? 'Video' : 'Loop') : 'Audio'}{m.duration ? ` · ${formatDuration(m.duration)}` : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        <Transport />
      </section>
      <aside className="mb-props">
        {current ? <Props key={current.id} item={current} folders={folders} onRemoved={() => setSel(null)} /> : <div className="dim" style={{ padding: 16 }}>Click an item to show it on screen. Its settings appear here.</div>}
      </aside>
    </div>
  )
}

function Props({ item, folders, onRemoved }: { item: MediaItem; folders: string[]; onRemoved: () => void }): ReactNode {
  const save = (p: Partial<MediaItem>): void => void api.invoke('media.update', { item: { ...item, ...p } })
  const [name, setName] = useState(item.name)
  const [tags, setTags] = useState((item.tags ?? []).join(', '))
  useEffect(() => { setName(item.name); setTags((item.tags ?? []).join(', ')) }, [item.name, item.tags])
  return (
    <div className="col" style={{ padding: 14, gap: 12 }} data-testid="media-props">
      <div className="mb-preview">
        {item.kind === 'video' ? <video src={mediaUrl(item)} controls muted /> : item.kind === 'audio' ? <audio src={mediaUrl(item)} controls /> : <img src={mediaUrl(item)} alt="" />}
      </div>
      <label className="field"><span>Name</span><Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== item.name && save({ name: name.trim() })} data-testid="media-name" /></label>
      {item.kind !== 'audio' && (
        <label className="field"><span>Plays as</span>
          <Select value={item.behavior ?? 'background'} onChange={(e) => save({ behavior: e.target.value as MediaItem['behavior'] })}>
            <option value="background">Background (behind slides{item.kind === 'video' ? ', keeps looping' : ''})</option>
            <option value="foreground">Foreground {item.kind === 'video' ? 'video (plays once, with sound)' : 'image'}</option>
          </Select>
        </label>
      )}
      {item.kind !== 'image' && <label className="row"><input type="checkbox" checked={item.loop ?? false} onChange={(e) => save({ loop: e.target.checked })} /> Loop</label>}
      {item.kind !== 'audio' && (
        <label className="field"><span>Scaling</span>
          <Select value={item.fit ?? 'cover'} onChange={(e) => save({ fit: e.target.value as MediaItem['fit'] })}>
            <option value="cover">Fill the screen (crop edges)</option><option value="contain">Fit inside (bars)</option><option value="stretch">Stretch</option>
          </Select>
        </label>
      )}
      <label className="field"><span>Folder</span>
        <Input list="mb-folders" defaultValue={item.folder ?? ''} placeholder="None" onBlur={(e) => e.target.value !== (item.folder ?? '') && save({ folder: e.target.value.trim() || undefined })} />
        <datalist id="mb-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
      </label>
      <label className="field"><span>Tags</span><Input value={tags} placeholder="easter, countdown" onChange={(e) => setTags(e.target.value)} onBlur={() => save({ tags: tags.split(',').map((t) => t.trim()).filter(Boolean) })} /></label>
      <div className="dim">{item.width ? `${item.width}×${item.height}` : ''}{item.duration ? ` · ${formatDuration(item.duration)}` : ''}</div>
      <div className="row">
        <Button variant="live" onClick={() => playMedia(item)}>Show now</Button>
        <div className="grow" />
        <Button variant="ghost" onClick={() => { if (confirm(`Remove “${item.name}” from the media bin? (The file stays in the workspace folder.)`)) { void api.invoke('media.remove', { id: item.id }); onRemoved() } }}>Remove</Button>
      </div>
    </div>
  )
}

/** Play/pause/restart/scrub for whatever is on the media layers. */
function Transport(): ReactNode {
  const live = useApp((s) => s.live)
  const rows = (['video', 'background', 'audio'] as Layer[]).filter((l) => live[l])
  const now = useNow(250, rows.length > 0)
  if (!rows.length) return null
  return (
    <div className="mb-transport" data-testid="transport">
      {rows.map((l) => <TransportRow key={l} layer={l} m={live[l]!} now={now} />)}
    </div>
  )
}
function TransportRow({ layer, m, now }: { layer: Layer; m: LiveMedia; now: number }): ReactNode {
  const media = useApp((s) => s.media)
  const dur = m.media.duration ?? media.find((x) => x.src === m.media.src)?.duration
  let pos = (m.offset ?? 0) + (m.playing && m.startedAt ? (now - m.startedAt) / 1000 : 0)
  if (dur) pos = m.loop ? pos % dur : Math.min(pos, dur)
  const t = (action: 'play' | 'pause' | 'restart' | 'seek', time?: number): void => void api.invoke('live.transport', { layer, action, time })
  const label = { background: 'Background', video: 'Video', audio: 'Audio' }[layer]
  return (
    <div className="mb-tr-row">
      <span className="mb-tr-label">{label}</span>
      <span className="mb-tr-name">{m.media.name ?? m.media.src.split('/').pop()}</span>
      {m.media.kind !== 'image' && (
        <>
          <Button size="sm" onClick={() => t(m.playing ? 'pause' : 'play')} data-testid={`tr-${layer}-toggle`}>{m.playing ? 'Pause' : 'Play'}</Button>
          <Button size="sm" variant="ghost" onClick={() => t('restart')}>Restart</Button>
          <span className="dim mb-tr-time">{formatDuration(pos)}</span>
          <input type="range" className="grow" min={0} max={dur || 1} step={0.1} value={dur ? pos : 0} disabled={!dur} onChange={(e) => t('seek', Number(e.target.value))} />
          <span className="dim mb-tr-time">{dur ? formatDuration(dur) : '--:--'}</span>
        </>
      )}
      <Button size="sm" variant="ghost" onClick={() => void api.invoke('live.clear', { layer: layer === 'audio' ? 'audio' : layer })}>Clear</Button>
    </div>
  )
}

export default defineFeature({
  id: 'media',
  views: [{ id: 'media', title: 'Media', order: 30, component: MediaView, shortcut: '⌘3' }]
})
