/** Sections (groups) and arrangements: rename/recolour sections, build the order the band plays them in. */
import { useState, type ReactNode } from 'react'
import type { Arrangement, ID, SlideGroup } from '@shared/model'
import { GROUP_PALETTE, groupColor } from '@shared/editor-reflow'
import { uid } from '@shared/editor-util'
import { Button, Input, Select } from '@ui/index'
import { commit, useDoc, useEditor } from './store'

export function ArrangeMode(): ReactNode {
  const doc = useDoc()
  const slideIds = useEditor((s) => s.slideIds)
  const [arrId, setArrId] = useState<ID | null>(null)
  if (!doc) return null
  const arr = doc.arrangements.find((a) => a.id === (arrId ?? doc.activeArrangementId)) ?? doc.arrangements[0]
  const upGroup = (id: ID, p: Partial<SlideGroup>, label: string): void => commit((d) => ({ ...d, groups: d.groups.map((g) => (g.id === id ? { ...g, ...p } : g)) }), label, `group:${id}:${Object.keys(p).join()}`)
  const upArr = (a: Arrangement, label: string): void => commit((d) => ({ ...d, arrangements: d.arrangements.map((x) => (x.id === a.id ? a : x)) }), label)
  const newGroupFromSelection = (): void => {
    const name = `Section ${doc.groups.length + 1}`
    const g: SlideGroup = { id: uid(), name, color: GROUP_PALETTE[doc.groups.length % GROUP_PALETTE.length], slideIds: doc.slides.filter((s) => slideIds.includes(s.id)).map((s) => s.id) }
    commit((d) => ({ ...d, groups: [...d.groups.map((x) => ({ ...x, slideIds: x.slideIds.filter((i) => !g.slideIds.includes(i)) })), g] }), 'New section')
  }
  const newArrangement = (): void => {
    const a: Arrangement = { id: uid(), name: doc.arrangements.length ? `Arrangement ${doc.arrangements.length + 1}` : 'Default', groupIds: doc.groups.map((g) => g.id) }
    commit((d) => ({ ...d, arrangements: [...d.arrangements, a], activeArrangementId: d.activeArrangementId ?? a.id }), 'New arrangement')
    setArrId(a.id)
  }
  return (
    <div className="ed-arrange scroll" data-testid="arrange">
      <section>
        <h3>Sections</h3>
        <p className="dim">Sections group slides (Verse 1, Chorus…). Select slides on the left and press “New section from selected”.</p>
        <div className="col" style={{ gap: 6 }}>
          {doc.groups.map((g) => (
            <div key={g.id} className="ed-arr-group" style={{ ['--group' as string]: g.color ?? '#555' }}>
              <input type="color" value={g.color ?? '#7a7a7a'} onChange={(e) => upGroup(g.id, { color: e.target.value }, 'Section colour')} />
              <Input defaultValue={g.name} key={g.name} onBlur={(e) => e.target.value && e.target.value !== g.name && upGroup(g.id, { name: e.target.value, color: g.color ?? groupColor(e.target.value) }, 'Rename section')} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
              <span className="dim">{g.slideIds.length} slide{g.slideIds.length === 1 ? '' : 's'}</span>
              <div className="grow" />
              {arr && <Button size="sm" onClick={() => upArr({ ...arr, groupIds: [...arr.groupIds, g.id] }, 'Add to arrangement')}>Add to order →</Button>}
              <Button size="sm" variant="ghost" title="Delete section (slides are kept)" onClick={() => commit((d) => ({ ...d, groups: d.groups.filter((x) => x.id !== g.id), arrangements: d.arrangements.map((a) => ({ ...a, groupIds: a.groupIds.filter((i) => i !== g.id) })) }), 'Delete section')}>×</Button>
            </div>
          ))}
        </div>
        <Button style={{ marginTop: 8 }} onClick={newGroupFromSelection} disabled={!slideIds.length}>New section from selected slides</Button>
      </section>
      <section>
        <h3>Arrangement <span className="dim" style={{ fontSize: 13 }}>— the order sections are played</span></h3>
        <div className="row" style={{ marginBottom: 8 }}>
          {doc.arrangements.length > 0 && (
            <Select value={arr?.id ?? ''} onChange={(e) => setArrId(e.target.value)}>
              {doc.arrangements.map((a) => <option key={a.id} value={a.id}>{a.name}{a.id === doc.activeArrangementId ? ' (in use)' : ''}</option>)}
            </Select>
          )}
          <Button onClick={newArrangement}>+ New arrangement</Button>
          {arr && arr.id !== doc.activeArrangementId && <Button variant="primary" onClick={() => commit((d) => ({ ...d, activeArrangementId: arr.id }), 'Use arrangement')}>Use this one</Button>}
          {doc.activeArrangementId && <Button variant="ghost" onClick={() => commit((d) => ({ ...d, activeArrangementId: undefined }), 'Play slides in order')}>Play slides in document order</Button>}
        </div>
        {!arr && <p className="dim">No arrangement: slides play top to bottom. Create one to repeat choruses or reorder sections.</p>}
        {arr && (
          <>
            <Input defaultValue={arr.name} key={arr.id + arr.name} onBlur={(e) => e.target.value && e.target.value !== arr.name && upArr({ ...arr, name: e.target.value }, 'Rename arrangement')} style={{ marginBottom: 8 }} />
            <ArrangementChips arr={arr} groups={doc.groups} onChange={(a) => upArr(a, 'Edit arrangement')} />
            <div className="row" style={{ marginTop: 10 }}>
              <Button size="sm" variant="ghost" onClick={() => upArr({ ...arr, groupIds: [] }, 'Clear arrangement')}>Clear</Button>
              <Button size="sm" variant="ghost" onClick={() => commit((d) => ({ ...d, arrangements: d.arrangements.filter((x) => x.id !== arr.id), activeArrangementId: d.activeArrangementId === arr.id ? undefined : d.activeArrangementId }), 'Delete arrangement')}>Delete arrangement</Button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function ArrangementChips({ arr, groups, onChange }: { arr: Arrangement; groups: SlideGroup[]; onChange: (a: Arrangement) => void }): ReactNode {
  const [drag, setDrag] = useState<number | null>(null)
  return (
    <div className="ed-chips" data-testid="arrangement">
      {arr.groupIds.map((gid, i) => {
        const g = groups.find((x) => x.id === gid)
        if (!g) return null
        return (
          <span key={i} className="ed-chip" style={{ ['--group' as string]: g.color ?? '#555' }} draggable
            onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (drag === null || drag === i) return; const ids = [...arr.groupIds]; const [m] = ids.splice(drag, 1); ids.splice(i, 0, m); onChange({ ...arr, groupIds: ids }); setDrag(null) }}>
            {g.name}
            <button onClick={() => onChange({ ...arr, groupIds: arr.groupIds.filter((_, j) => j !== i) })} title="Remove">×</button>
          </span>
        )
      })}
      {!arr.groupIds.length && <span className="dim">Empty — add sections with “Add to order →”.</span>}
    </div>
  )
}
