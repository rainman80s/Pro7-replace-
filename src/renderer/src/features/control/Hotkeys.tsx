import { useEffect, useState, type ReactNode } from 'react'
import { keyName, type ShortcutBinding } from '@shared/control'
import { Button, Modal, toast } from '@ui/index'
import { api, useApp } from '../../app/store'
import { ActionPicker, ActionSummary } from './ActionPicker'
import { attempt, useRpc } from './hooks'

const typing = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  return !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)
}

/** Always-mounted: turns key presses into the shortcuts, automations and clicker keys set up in Settings. */
export function HotkeysHost(): ReactNode {
  useEffect(() => {
    let doc: Awaited<ReturnType<typeof api.invoke<'hotkeys.get'>>> | null = null
    const load = (): void => { void api.invoke('hotkeys.get').then((d) => { doc = d }).catch(() => {}) }
    load()
    const off = api.on('workspace.docChanged', ({ name }) => { if (name === 'hotkeys') load() })
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.repeat || typing(e.target) || document.querySelector('.modal')) return
      const key = keyName(e)
      if (!key) return
      const hit = doc?.bindings.find((b) => b.key.toLowerCase() === key.toLowerCase())
      if (hit) { e.preventDefault(); void api.invoke('live.runAction', hit.action).catch(() => {}); return }
      if (doc?.clicker !== false && (key === 'PageUp')) { e.preventDefault(); void api.invoke('live.prev'); return }
      if (doc?.clicker !== false && (key === 'B' || key === '.')) { e.preventDefault(); void api.invoke('live.setFlag', { flag: 'blackout', value: !useApp.getState().live.blackout }); return }
      void api.invoke('triggers.fire', { key }).then(async (n) => {
        if (n > 0 || doc?.slideHotKeys === false || key.length !== 1) return
        const cur = useApp.getState().live.slide
        if (!cur) return
        const p = await api.invoke('library.get', { id: cur.presentationId })
        const s = p?.slides.find((x) => x.hotKey?.toLowerCase() === key.toLowerCase())
        if (p && s) void api.invoke('live.goToSlide', { presentationId: p.id, slideId: s.id, playlistId: cur.playlistId, playlistItemId: cur.playlistItemId })
      }).catch(() => {})
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); off() }
  }, [])
  return null
}

function BindingEditor({ initial, onSave, onClose }: { initial: Partial<ShortcutBinding>; onSave: (b: ShortcutBinding) => void; onClose: () => void }): ReactNode {
  const [b, setB] = useState<Partial<ShortcutBinding>>(initial)
  const [capturing, setCapturing] = useState(false)
  useEffect(() => {
    if (!capturing) return
    const h = (e: KeyboardEvent): void => { const k = keyName(e); if (!k) return; e.preventDefault(); e.stopPropagation(); setB((x) => ({ ...x, key: k })); setCapturing(false) }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [capturing])
  return (
    <Modal title="Keyboard shortcut" onClose={onClose} width={480}
      footer={<><div className="grow" /><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => { if (!b.key || !b.action?.type) return toast('Pick a key and an action', 'warning'); onSave({ key: b.key, label: b.label || b.action.type, action: b.action }) }}>Save</Button></>}>
      <div className="col">
        <div className="row">
          <Button active={capturing} onClick={() => setCapturing(true)}>{capturing ? 'Press a key…' : b.key ? `Key: ${b.key}` : 'Choose a key'}</Button>
        </div>
        <ActionPicker value={b.action ?? null} onChange={(a) => setB({ ...b, action: { type: a.type, params: a.params } })} />
      </div>
    </Modal>
  )
}

export function HotkeysSettings(): ReactNode {
  const [doc] = useRpc('hotkeys.get', 'hotkeys')
  const [edit, setEdit] = useState<{ index: number; b: Partial<ShortcutBinding> } | null>(null)
  const set = (patch: Parameters<typeof api.invoke<'hotkeys.set'>>[1]): void => void attempt(api.invoke('hotkeys.set', patch), toast)
  if (!doc) return null
  const save = (b: ShortcutBinding): void => {
    const list = [...doc.bindings]
    if (edit && edit.index >= 0) list[edit.index] = b; else list.push(b)
    set({ bindings: list }); setEdit(null)
  }
  return (
    <div className="ctl-settings col">
      <p className="dim">Press a key anywhere in the app to run something. Keys typed into a text box are never used.</p>
      <label className="row"><input type="checkbox" checked={doc.clicker !== false} onChange={(e) => set({ clicker: e.target.checked })} /> Slide clicker works (Page Up = back, B or . = black screen)</label>
      <label className="row"><input type="checkbox" checked={doc.slideHotKeys !== false} onChange={(e) => set({ slideHotKeys: e.target.checked })} /> A slide’s own hot key jumps to that slide</label>
      <div className="ctl-table">
        {doc.bindings.map((b, i) => (
          <div key={i} className="ctl-tr">
            <span className="ctl-key">{b.key}</span>
            <span className="grow">{b.label} <span className="dim">→ <ActionSummary action={b.action} /></span></span>
            <Button size="sm" variant="ghost" onClick={() => setEdit({ index: i, b })}>Edit</Button>
            <Button size="sm" variant="ghost" onClick={() => set({ bindings: doc.bindings.filter((_, j) => j !== i) })}>✕</Button>
          </div>
        ))}
      </div>
      <div className="row">
        <Button onClick={() => setEdit({ index: -1, b: {} })}>+ New shortcut</Button>
      </div>
      {edit && <BindingEditor initial={edit.b} onSave={save} onClose={() => setEdit(null)} />}
    </div>
  )
}
