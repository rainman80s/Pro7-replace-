import { useEffect, useState, type ReactNode } from 'react'
import type { AudioPlaylist, AudioStatus } from '@shared/control'
import { Button, Field, Input, Modal, Select, toast } from '@ui/index'
import { api, useLive } from '../../app/store'
import { attempt, useRpc } from './hooks'

function PlaylistEditor({ pl, onClose }: { pl: Partial<AudioPlaylist>; onClose: () => void }): ReactNode {
  const [p, setP] = useState<Partial<AudioPlaylist>>({ mode: 'next', volume: 1, fadeIn: 2, fadeOut: 3, tracks: [], ...pl })
  const add = async (): Promise<void> => {
    if (!window.reachBridge) return toast('Add music on the main computer', 'warning')
    const paths = await api.invoke('system.pickFiles', { title: 'Choose music', multi: true, filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'] }] })
    if (!paths.length) return
    const items = await api.invoke('media.import', { paths, folder: 'Audio' })
    setP({ ...p, tracks: [...(p.tracks ?? []), ...items.map((i) => ({ kind: 'audio' as const, src: i.src, name: i.name, duration: i.duration, id: i.id }))] })
  }
  const save = async (): Promise<void> => {
    if (!p.name?.trim()) return toast('Name the playlist', 'warning')
    await attempt(api.invoke('audio.save', { playlist: p as AudioPlaylist }), toast)
    onClose()
  }
  return (
    <Modal title={pl.id ? 'Edit music playlist' : 'New music playlist'} onClose={onClose} width={500}
      footer={<>
        {pl.id && <Button variant="danger" onClick={async () => { if (confirm('Delete this playlist?')) { await api.invoke('audio.remove', { id: pl.id! }); onClose() } }}>Delete</Button>}
        <div className="grow" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save</Button>
      </>}>
      <div className="col">
        <Field label="Name"><Input autoFocus value={p.name ?? ''} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="e.g. Walk-in music" /></Field>
        <div className="ctl-table">
          {p.tracks?.map((t, i) => (
            <div key={i} className="ctl-tr"><span className="dim">{i + 1}</span><span className="grow">{t.name ?? t.src}</span>
              <Button size="sm" variant="ghost" onClick={() => setP({ ...p, tracks: p.tracks!.filter((_, j) => j !== i) })}>✕</Button></div>
          ))}
        </div>
        <div><Button onClick={() => void add()}>+ Add music…</Button></div>
        <div className="row">
          <Field label="When a song ends"><Select value={p.mode} onChange={(e) => setP({ ...p, mode: e.target.value as AudioPlaylist['mode'] })}>
            <option value="next">Play the next one</option><option value="loop">Play the next, loop at the end</option><option value="stop">Stop</option>
          </Select></Field>
          <label className="row"><input type="checkbox" checked={!!p.shuffle} onChange={(e) => setP({ ...p, shuffle: e.target.checked })} /> Shuffle</label>
        </div>
        <div className="row">
          <Field label="Fade in (s)"><Input type="number" min={0} value={p.fadeIn ?? 0} onChange={(e) => setP({ ...p, fadeIn: Number(e.target.value) })} /></Field>
          <Field label="Fade out (s)"><Input type="number" min={0} value={p.fadeOut ?? 0} onChange={(e) => setP({ ...p, fadeOut: Number(e.target.value) })} /></Field>
        </div>
      </div>
    </Modal>
  )
}

export function AudioPanel(): ReactNode {
  const live = useLive()
  const [doc] = useRpc('audio.list', 'audio')
  const [status, setStatus] = useState<AudioStatus | null>(null)
  const [sel, setSel] = useState('')
  const [edit, setEdit] = useState<Partial<AudioPlaylist> | null>(null)
  useEffect(() => {
    void api.invoke('audio.status').then(setStatus).catch(() => {})
    return api.on('audio.status', setStatus)
  }, [])
  const pl = doc?.playlists.find((p) => p.id === (sel || status?.playlistId)) ?? doc?.playlists[0]
  const playing = !!status?.playing && !!live.audio
  return (
    <div className="ctl-panel">
      {doc && !doc.playlists.length ? <div className="ctl-empty">Add a playlist of walk-in music. It fades in and out and moves to the next song by itself.</div> : (
        <>
          <div className="row">
            <Select className="grow" value={pl?.id ?? ''} onChange={(e) => setSel(e.target.value)}>{doc?.playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            <Button size="sm" variant="ghost" onClick={() => pl && setEdit(pl)}>Edit</Button>
          </div>
          <div className="ctl-now">{playing ? <>▶ <b>{status?.trackName}</b></> : <span className="dim">Music is off</span>}</div>
          <div className="row">
            {playing ? <Button size="sm" variant="danger" onClick={() => void api.invoke('audio.stop', { fade: true })}>Fade out</Button>
              : <Button size="sm" variant="primary" disabled={!pl?.tracks.length} onClick={() => pl && void attempt(api.invoke('audio.play', { playlistId: pl.id }), toast)}>Play</Button>}
            <Button size="sm" disabled={!playing} onClick={() => void api.invoke('audio.skip', { delta: 1 })}>Next ⏭</Button>
            <input className="grow" type="range" min={0} max={1} step={0.05} value={live.audio?.volume ?? status?.volume ?? 1} aria-label="Volume"
              onChange={(e) => void api.invoke('audio.volume', { volume: Number(e.target.value) })} />
          </div>
        </>
      )}
      <div className="row ctl-foot"><Button size="sm" variant="ghost" onClick={() => setEdit({})}>+ New playlist</Button></div>
      {edit && <PlaylistEditor pl={edit} onClose={() => setEdit(null)} />}
    </div>
  )
}
