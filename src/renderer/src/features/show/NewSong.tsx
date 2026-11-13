import { useState, type ReactNode } from 'react'
import { Button, Field, Input, Modal, SegmentedControl, TextArea, toast } from '@ui/index'
import type { Presentation } from '@shared/model'
import { api, useApp } from '../../app/store'
import { currentPlaylist, savePlaylist, selectItem, selectLibraryItem, useShowUi } from './actions'
import { insertItem, presentationItem, previewLyrics } from './logic'

/** Quick-create: paste lyrics, get a song. Blank line = new slide; "Verse 1" / "Chorus" lines name the sections. */
export function NewSong(): ReactNode {
  const req = useShowUi((s) => s.newSong)
  if (!req) return null
  return <NewSongDialog addToService={req.addToService} onClose={() => useShowUi.getState().set({ newSong: null })} />
}

function NewSongDialog({ addToService, onClose }: { addToService: boolean; onClose: () => void }): ReactNode {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [kind, setKind] = useState<NonNullable<Presentation['kind']>>('song')
  const [busy, setBusy] = useState(false)
  const playlist = currentPlaylist()
  const preview = previewLyrics(text)

  const create = async (): Promise<void> => {
    const name = title.trim() || text.trim().split('\n').find((l) => l.trim() && !/^(verse|chorus|bridge)/i.test(l))?.trim().slice(0, 60) || 'Untitled'
    setBusy(true)
    try {
      const p = await api.invoke('library.create', { title: name, kind, text })
      useApp.setState((s) => ({ presentations: { ...s.presentations, [p.id]: p } }))
      if (addToService && playlist) {
        const item = presentationItem(p.id)
        await savePlaylist(insertItem(playlist, item))
        selectItem(item)
      } else selectLibraryItem(p.id)
      toast(`Created "${p.title}"`, 'success', `${p.slides.length} slide${p.slides.length === 1 ? '' : 's'}${addToService && playlist ? ` · added to ${playlist.name}` : ''}`)
      onClose()
    } catch (e) {
      toast("Couldn't create it", 'error', String(e))
      setBusy(false)
    }
  }

  return (
    <Modal title="New from pasted text" onClose={onClose} width={640} data-testid="new-song"
      footer={<>
        <span className="t-meta grow">{preview.slides ? `${preview.slides} slide${preview.slides === 1 ? '' : 's'}${preview.sections.length ? ` · ${preview.sections.join(', ')}` : ''}` : 'Paste the words to see how they will be split'}</span>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" data-testid="new-song-create" disabled={busy || (!title.trim() && !text.trim())} onClick={() => void create()}>{addToService && playlist ? 'Create and add to service' : 'Create'}</Button>
      </>}>
      <div className="col" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <Field label="Title" className="grow"><Input data-testid="new-song-title" value={title} placeholder="e.g. Amazing Grace" onChange={(e) => setTitle(e.target.value)} /></Field>
          <SegmentedControl aria-label="Kind" value={kind} onChange={setKind} options={[{ value: 'song', label: 'Song' }, { value: 'generic', label: 'Slides' }, { value: 'announcement', label: 'Announcement' }]} />
        </div>
        <Field label="Words" hint={<>Leave a blank line between slides. A line on its own like <em>Verse 1</em>, <em>Chorus</em> or <em>Bridge</em> names the section that follows.</>}>
          <TextArea data-testid="new-song-text" rows={14} value={text} spellCheck={false} style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
            placeholder={'Verse 1\nAmazing grace how sweet the sound\nThat saved a wretch like me\n\nI once was lost but now am found\nWas blind but now I see\n\nChorus\n…'}
            onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
