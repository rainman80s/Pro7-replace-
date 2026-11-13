/** "Choose an image/video" dialog backed by the media bin (with import from disk). */
import { useState, type ReactNode } from 'react'
import { create } from 'zustand'
import type { MediaItem, MediaRef } from '@shared/model'
import { Button, Input, Modal } from '@ui/index'
import { api, useApp } from '../../app/store'
import { MediaThumb } from '../media/thumbs'
import { MEDIA_EXTENSIONS } from '@shared/media'

const usePick = create<{ kinds: MediaRef['kind'][] | null; resolve: ((m: MediaRef | null) => void) | null }>(() => ({ kinds: null, resolve: null }))

export function pickMedia(kinds: MediaRef['kind'][]): Promise<MediaRef | null> {
  return new Promise((resolve) => {
    usePick.getState().resolve?.(null)
    usePick.setState({ kinds, resolve })
  })
}

export async function importFromDisk(kinds: MediaRef['kind'][]): Promise<MediaItem[]> {
  const ext = kinds.flatMap((k) => (k === 'image' ? MEDIA_EXTENSIONS.IMAGE : k === 'video' ? MEDIA_EXTENSIONS.VIDEO : MEDIA_EXTENSIONS.AUDIO))
  const paths = await api.invoke('system.pickFiles', { title: 'Import media', multi: true, filters: [{ name: 'Media', extensions: ext }] })
  if (!paths.length) return []
  return api.invoke('media.import', { paths })
}

export function MediaPicker(): ReactNode {
  const { kinds, resolve } = usePick()
  const media = useApp((s) => s.media)
  const [q, setQ] = useState('')
  if (!kinds || !resolve) return null
  const done = (m: MediaRef | null): void => { usePick.setState({ kinds: null, resolve: null }); resolve(m) }
  const items = media.filter((m) => kinds.includes(m.kind) && (!q || m.name.toLowerCase().includes(q.toLowerCase())))
  return (
    <Modal title="Choose media" onClose={() => done(null)} width={760}
      footer={<><Button onClick={() => void importFromDisk(kinds).then((list) => list[0] && done(list[0]))}>Import from computer…</Button><div className="grow" /><Button onClick={() => done(null)}>Cancel</Button></>}>
      <Input placeholder="Search media" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
      {!items.length && <div className="dim" style={{ padding: 20, textAlign: 'center' }}>Nothing in the media bin yet — import something.</div>}
      <div className="ed-pick-grid">
        {items.map((m) => (
          <button key={m.id} className="ed-pick-item" onClick={() => done(m)}>
            <MediaThumb item={m} />
            <span>{m.name}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
