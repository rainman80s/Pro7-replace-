import { useState, type ReactNode } from 'react'
import type { ID, MediaRef, Presentation, Slide, SlideAction } from '@shared/model'
import { uid } from '@shared/control'
import { Button, Input, Modal } from '@ui/index'
import { useApp } from '../../app/store'
import { ActionPicker, ActionSummary, type PickedAction } from '../control/ActionPicker'
import { MediaThumb } from '../media/thumbs'
import { editSlides, setBackground } from './slideOps'

/** Add or remove what a slide does when it goes live: macros, timers, media, messages... */
export function SlideActionsDialog({ presentation, slide, onClose }: { presentation: Presentation; slide: Slide; onClose: () => void }): ReactNode {
  const [actions, setActions] = useState<SlideAction[]>(slide.actions ?? [])
  const [open, setOpen] = useState<number | null>(actions.length ? null : 0)
  const set = (i: number, a: PickedAction): void => setActions(actions.map((x, j) => (j === i ? { ...x, ...a } : x)))
  const add = (): void => { setActions([...actions, { id: uid('a'), type: '' }]); setOpen(actions.length) }
  const save = (): void => {
    const clean = actions.filter((a) => a.type)
    void editSlides(presentation.id, [slide.id], (s) => ({ ...s, actions: clean.length ? clean : undefined }), 'Slide actions saved')
    onClose()
  }
  return (
    <Modal title="Slide actions" width={540} onClose={onClose} data-testid="slide-actions-dialog"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" data-testid="slide-actions-save" onClick={save}>Save</Button></>}>
      <div className="col" style={{ gap: 10 }}>
        <div className="dim">These run when this slide goes on screen.</div>
        {!actions.length && <div className="faint">No actions yet.</div>}
        {actions.map((a, i) => (
          <div key={a.id} className="ctl-step">
            <div className="row">
              <button type="button" className="grow ctl-step-sum" onClick={() => setOpen(open === i ? null : i)}>{a.type ? <ActionSummary action={a} /> : <em>Choose an action…</em>}</button>
              <Button size="sm" variant="ghost" aria-label="Remove action" onClick={() => setActions(actions.filter((_, j) => j !== i))}>Remove</Button>
            </div>
            {open === i && <ActionPicker value={a} onChange={(v) => set(i, v)} showDelay />}
          </div>
        ))}
        <div><Button icon="plus" onClick={add} data-testid="slide-actions-add">Add an action</Button></div>
      </div>
    </Modal>
  )
}

/** Pick an image or video from the media bin as the background of one slide, a group or the whole song. */
export function BackgroundDialog({ presentationId, slideIds, scope, onClose }: { presentationId: ID; slideIds: ID[]; scope: string; onClose: () => void }): ReactNode {
  const media = useApp((s) => s.media)
  const [q, setQ] = useState('')
  const items = media.filter((m) => m.kind !== 'audio' && (!q || m.name.toLowerCase().includes(q.toLowerCase())))
  const choose = (m: MediaRef): void => { void setBackground(presentationId, slideIds, m, scope); onClose() }
  return (
    <Modal title="Set background" width={680} onClose={onClose} data-testid="background-dialog">
      <Input placeholder="Search media" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
      {!items.length && <div className="dim" style={{ padding: 20, textAlign: 'center' }}>Nothing in the media bin yet. Import images or videos in the Media screen.</div>}
      <div className="ed-pick-grid">
        {items.map((m) => (
          <button key={m.id} type="button" className="ed-pick-item" onClick={() => choose(m)}>
            <MediaThumb item={m as never} /><span className="truncate">{m.name}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
