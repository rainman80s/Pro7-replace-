import { useState, type ReactNode } from 'react'
import type { Playlist, PlaylistItem } from '@shared/model'
import { Badge, Button, ColorInput, Drawer, Empty, Field, Icon, IconButton, Input, Menu, Modal, NumberInput, TextArea, confirm, openContextMenu, toast, useDragReorder, type IconName, type MenuItems } from '@ui/index'
import { api, openPresentation, useApp, useLocked } from '../../app/store'
import { addPresentationToService, removeFromService, savePlaylist, selectItem, startItem, useShowUi } from './actions'
import { buildTimeline, comingSunday, duplicateItem, duplicateService, formatClock, formatLength, formatServiceDate, headerItem, insertItem, itemTitle, moveItemTo, newId, newService, placeholderItem, uniqueName, updateItem } from './logic'

export const LIBRARY_DND = 'application/x-reach-presentation'

const ITEM_ICON: Record<string, IconName> = { song: 'music', sermon: 'note', scripture: 'bible', announcement: 'slides', generic: 'slides', video: 'video', image: 'image', audio: 'audio', placeholder: 'placeholder' }

let lastPointer = { clientX: 0, clientY: 0 }

const byDate = (a: Playlist, b: Playlist): number => (b.date ?? '').localeCompare(a.date ?? '') || a.name.localeCompare(b.name)

/** Left column: the order of service. Volunteers pick items here; the tech lead builds it here. */
export function ServicePanel(): ReactNode {
  const playlists = useApp((s) => s.playlists)
  const library = useApp((s) => s.library)
  const media = useApp((s) => s.media)
  const live = useApp((s) => s.live)
  const selectedPlaylistId = useApp((s) => s.selectedPlaylistId)
  const selectedItemId = useApp((s) => s.selectedPlaylistItemId)
  const select = useApp((s) => s.select)
  const locked = useLocked()
  const ui = useShowUi()
  const [serviceForm, setServiceForm] = useState<{ mode: 'new' | 'edit' | 'duplicate'; name: string; date: string } | null>(null)

  const playlist = playlists.find((p) => p.id === selectedPlaylistId)
  const timeline = buildTimeline(playlist)
  const liveItemId = live.slide?.playlistId === playlist?.id ? live.slide?.playlistItemId : undefined

  const dnd = useDragReorder({
    count: playlist?.items.length ?? 0,
    disabled: locked || !playlist,
    onReorder: (from, to) => { if (playlist) void savePlaylist(moveItemTo(playlist, from, to)) },
    acceptType: locked ? undefined : LIBRARY_DND,
    onInsert: (presentationId, index) => void addPresentationToService(presentationId, index)
  })

  const add = (item: PlaylistItem, index?: number): void => {
    if (!playlist) return
    void savePlaylist(insertItem(playlist, item, index))
    if (item.type !== 'presentation') ui.set({ detailsItemId: item.id })
  }

  const addMenu = (index?: number): MenuItems => [
    { label: 'Song or slides from the library…', icon: 'search', onSelect: () => ui.openSearch({ kind: 'add', index }), testId: 'add-from-library' },
    { label: 'New song from pasted lyrics…', icon: 'music', onSelect: () => ui.set({ newSong: { addToService: true } }), testId: 'add-new-song' },
    { type: 'separator' },
    { label: 'Section header', icon: 'header', onSelect: () => add(headerItem('New section'), index), testId: 'add-header' },
    { label: 'Placeholder (to fill in later)', icon: 'placeholder', onSelect: () => add(placeholderItem('To be added'), index), testId: 'add-placeholder' },
    media.length ? { type: 'separator' } : null,
    media.length ? { type: 'heading', label: 'Media' } : null,
    ...media.slice(0, 8).map((m) => ({ label: m.name, icon: (m.kind === 'video' ? 'video' : m.kind === 'audio' ? 'audio' : 'image') as IconName, onSelect: () => add({ id: newId(), type: 'media', media: { id: m.id, kind: m.kind, src: m.src, name: m.name, duration: m.duration }, title: m.name, length: m.duration ? Math.round(m.duration) : undefined }, index) }))
  ]

  const itemMenu = (item: PlaylistItem, index: number): MenuItems => {
    if (!playlist) return []
    const playable = item.type === 'presentation' || item.type === 'media'
    return [
      playable ? { label: item.type === 'media' ? 'Play on the screens' : 'Show first slide', icon: 'play', onSelect: () => void startItem(item, playlist.id) } : null,
      !locked && item.type === 'presentation' ? { label: 'Edit slides', icon: 'edit', onSelect: () => openPresentation(item.presentationId, 'edit') } : null,
      !locked && item.type === 'placeholder' ? { label: 'Choose from the library…', icon: 'search', onSelect: () => ui.openSearch({ kind: 'replace', itemId: item.id }) } : null,
      { type: 'separator' },
      locked ? null : { label: 'Notes, people and length…', icon: 'note', onSelect: () => ui.set({ detailsItemId: item.id }), testId: 'item-details' },
      locked ? null : { label: 'Add below', icon: 'plus', onSelect: () => openContextMenuLater(addMenu(index + 1)) },
      locked ? null : { label: 'Duplicate', icon: 'copy', onSelect: () => void savePlaylist(duplicateItem(playlist, item.id)) },
      locked ? null : { type: 'separator' },
      locked ? null : { label: 'Move up', icon: 'arrowUp', disabled: index === 0, onSelect: () => void savePlaylist(moveItemTo(playlist, index, index - 1)), testId: 'item-move-up' },
      locked ? null : { label: 'Move down', icon: 'arrowDown', disabled: index === playlist.items.length - 1, onSelect: () => void savePlaylist(moveItemTo(playlist, index, index + 1)), testId: 'item-move-down' },
      locked ? null : { type: 'separator' },
      locked ? null : { label: 'Remove from service', icon: 'trash', danger: true, onSelect: () => void removeFromService(playlist, item.id), testId: 'item-remove' }
    ]
  }

  // A menu opened from inside another menu needs the first to finish closing.
  const openContextMenuLater = (items: MenuItems): void => { const at = lastPointer; setTimeout(() => openContextMenu({ ...at, preventDefault() {} }, items), 0) }

  const serviceMenu = (): MenuItems => [
    { type: 'heading', label: 'Services' },
    ...[...playlists].sort(byDate).map((p) => ({ label: <span>{p.name}{p.date && <span className="dim"> · {formatServiceDate(p.date).replace(/^\w+ /, '')}</span>}</span>, checked: p.id === selectedPlaylistId, onSelect: () => select({ selectedPlaylistId: p.id, selectedPlaylistItemId: null }) })),
    locked ? null : { type: 'separator' },
    locked ? null : { label: 'New service…', icon: 'plus', onSelect: () => { const date = comingSunday(); setServiceForm({ mode: 'new', date, name: uniqueName(formatServiceDate(date) || 'New service', playlists.map((p) => p.name)) }) }, testId: 'service-new' },
    locked || !playlist ? null : { label: 'Rename or change date…', icon: 'rename', onSelect: () => setServiceForm({ mode: 'edit', name: playlist.name, date: playlist.date ?? '' }), testId: 'service-rename' },
    locked || !playlist ? null : { label: 'Duplicate (reuse this order)…', icon: 'copy', onSelect: () => setServiceForm({ mode: 'duplicate', name: uniqueName(`${playlist.name} copy`, playlists.map((p) => p.name)), date: playlist.date ?? '' }), testId: 'service-duplicate' },
    locked || !playlist ? null : { type: 'separator' },
    locked || !playlist ? null : { label: 'Delete this service…', icon: 'trash', danger: true, onSelect: () => void deleteService(playlist), testId: 'service-delete' }
  ]

  const deleteService = async (p: Playlist): Promise<void> => {
    const ok = await confirm({ title: `Delete "${p.name}"?`, message: 'This removes the order of service. The songs and slides stay in your library.', confirmLabel: 'Delete service', danger: true })
    if (!ok) return
    await api.invoke('playlists.delete', { id: p.id }).catch((e) => toast("Couldn't delete the service", 'error', String(e)))
    const rest = useApp.getState().playlists.filter((x) => x.id !== p.id).sort(byDate)
    useApp.setState({ playlists: rest })
    select({ selectedPlaylistId: rest[0]?.id ?? null, selectedPlaylistItemId: null })
  }

  const submitService = async (): Promise<void> => {
    if (!serviceForm) return
    const name = serviceForm.name.trim() || 'New service'
    const date = serviceForm.date || undefined
    const next = serviceForm.mode === 'new' ? { ...newService(name, date) }
      : serviceForm.mode === 'duplicate' && playlist ? duplicateService(playlist, name, date)
      : playlist ? { ...playlist, name, date } : null
    setServiceForm(null)
    if (!next) return
    await savePlaylist(next)
    select({ selectedPlaylistId: next.id, ...(serviceForm.mode === 'edit' ? {} : { selectedPlaylistItemId: null }) })
  }

  return (
    <section className="panel svc" data-testid="service-panel" onPointerDownCapture={(e) => { lastPointer = { clientX: e.clientX, clientY: e.clientY } }}>
      <header className="svc-head">
        <Menu items={serviceMenu} trigger={
          <button type="button" className="svc-picker" data-testid="service-picker">
            <span className="t-label">Service</span>
            <span className="svc-name"><span className="truncate">{playlist?.name ?? 'No service yet'}</span><Icon name="chevronDown" size={14} /></span>
            {playlist?.date && <span className="t-meta truncate">{formatServiceDate(playlist.date)}{timeline.total ? ` · ${formatLength(timeline.total)} planned` : ''}</span>}
            {playlist && !playlist.date && timeline.total > 0 && <span className="t-meta">{formatLength(timeline.total)} planned</span>}
          </button>
        } />
        {!locked && playlist && <Menu align="end" items={() => addMenu()} trigger={<IconButton icon="plus" label="Add to this service" variant="default" data-testid="service-add" />} />}
      </header>

      <div className="svc-list scroll grow" {...dnd.containerProps}>
        {!playlist ? (
          <Empty title="No service yet" icon="calendar" action={locked ? undefined : <Button variant="primary" icon="plus" onClick={() => { const date = comingSunday(); setServiceForm({ mode: 'new', date, name: formatServiceDate(date) || 'New service' }) }}>Create a service</Button>}>
            {locked ? 'Ask your tech lead to set up this week’s service.' : 'A service is the list of songs and slides for one gathering, in order.'}
          </Empty>
        ) : !playlist.items.length ? (
          <Empty title="Nothing in this service yet" icon="list" action={locked ? undefined : <Menu items={() => addMenu()} trigger={<Button variant="primary" icon="plus">Add the first item</Button>} />}>
            {locked ? 'Ask your tech lead to add this week’s songs.' : 'Add songs and slides in the order they happen. You can drag to reorder.'}
          </Empty>
        ) : playlist.items.map((it, i) => {
          const title = itemTitle(it, library)
          const start = timeline.starts[it.id]
          const reorder = dnd.itemProps(i)
          if (it.type === 'header') {
            return (
              <div key={it.id} {...reorder} className={`svc-header ${reorder.className}`} data-testid="service-header" style={{ ['--tint' as string]: it.color }}
                onDoubleClick={() => !locked && ui.set({ detailsItemId: it.id })} onContextMenu={(e) => openContextMenu(e, itemMenu(it, i))}>
                <span className="svc-header-title truncate">{title}</span>
                {it.time && <span className="svc-time">{it.time}</span>}
              </div>
            )
          }
          const summary = it.type === 'presentation' ? library.find((l) => l.id === it.presentationId) : undefined
          const missing = it.type === 'presentation' && !summary
          const icon: IconName = it.type === 'media' ? ITEM_ICON[it.media.kind] : it.type === 'placeholder' ? 'placeholder' : ITEM_ICON[summary?.kind ?? 'generic']
          const sub = [it.type === 'placeholder' ? it.hint : undefined, 'people' in it && it.people?.length ? it.people.join(', ') : undefined, formatLength(it.length), 'notes' in it ? it.notes : undefined].filter(Boolean).join(' · ')
          const isLive = it.id === liveItemId
          return (
            <div key={it.id} {...reorder} role="button" tabIndex={0} data-testid="service-item" data-item-type={it.type} aria-current={it.id === selectedItemId || undefined}
              className={`svc-item ${reorder.className} ${it.id === selectedItemId ? 'on' : ''} ${isLive ? 'is-live' : ''} ${it.type === 'placeholder' ? 'is-placeholder' : ''} ${missing ? 'is-missing' : ''}`}
              onClick={() => selectItem(it)} onDoubleClick={() => { if (!locked && it.type !== 'presentation') ui.set({ detailsItemId: it.id }) }}
              onKeyDown={(e) => { if (e.target === e.currentTarget && e.key === 'Enter') { e.preventDefault(); selectItem(it) } }}
              onContextMenu={(e) => openContextMenu(e, itemMenu(it, i))}>
              <span className="svc-icon"><Icon name={missing ? 'warning' : icon} size={15} /></span>
              <span className="svc-main">
                <span className="svc-title truncate">{title}</span>
                {(sub || missing) && <span className="svc-sub truncate">{missing ? 'Not in the library any more' : sub}</span>}
              </span>
              {isLive ? <Badge tone="live">Live</Badge> : start !== undefined ? <span className="svc-time">{formatClock(start)}</span> : null}
              {!locked && <IconButton className="svc-more" icon="more" size="sm" label="More" tooltip={false} tabIndex={-1} onClick={(e) => { e.stopPropagation(); openContextMenu(e, itemMenu(it, i)) }} />}
            </div>
          )
        })}
      </div>

      {serviceForm && (
        <Modal title={serviceForm.mode === 'new' ? 'New service' : serviceForm.mode === 'duplicate' ? 'Duplicate service' : 'Service details'} width={420} onClose={() => setServiceForm(null)} data-testid="service-form"
          footer={<><Button onClick={() => setServiceForm(null)}>Cancel</Button><Button variant="primary" data-testid="service-form-save" onClick={() => void submitService()}>{serviceForm.mode === 'new' ? 'Create service' : serviceForm.mode === 'duplicate' ? 'Duplicate' : 'Save'}</Button></>}>
          <div className="col" style={{ gap: 14 }}>
            <Field label="Name"><Input data-testid="service-form-name" value={serviceForm.name} onFocus={(e) => e.target.select()} onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void submitService() }} /></Field>
            <Field label="Date" hint="Optional. Services are listed newest first."><Input type="date" value={serviceForm.date} onChange={(e) => setServiceForm({ ...serviceForm, date: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
      {ui.detailsItemId && playlist && <ItemDetails playlist={playlist} itemId={ui.detailsItemId} onClose={() => ui.set({ detailsItemId: null })} />}
    </section>
  )
}

/** Side drawer for the facts about one line of the service: what it's called, who leads it, how long it runs. */
function ItemDetails({ playlist, itemId, onClose }: { playlist: Playlist; itemId: string; onClose: () => void }): ReactNode {
  const library = useApp((s) => s.library)
  const item = playlist.items.find((x) => x.id === itemId)
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({ ...item }))
  const [people, setPeople] = useState(() => (item && 'people' in item ? (item.people ?? []).join(', ') : ''))
  if (!item) return null
  const set = (patch: Record<string, unknown>): void => setDraft((d) => ({ ...d, ...patch }))
  const str = (k: string): string => (draft[k] as string | undefined) ?? ''
  const save = (): void => {
    const clean = { ...draft }
    for (const k of ['title', 'notes', 'hint', 'time', 'color']) if (typeof clean[k] === 'string' && !(clean[k] as string).trim()) clean[k] = item.type === 'presentation' || k !== 'title' ? undefined : item.type === 'header' ? 'Section' : 'To be added'
    if (!clean.length) clean.length = undefined
    if (item.type === 'presentation') { const list = people.split(',').map((x) => x.trim()).filter(Boolean); clean.people = list.length ? list : undefined }
    void savePlaylist(updateItem(playlist, item.id, clean as Partial<PlaylistItem>))
    onClose()
  }
  const kind = item.type === 'header' ? 'Section header' : item.type === 'placeholder' ? 'Placeholder' : item.type === 'media' ? 'Media' : 'Service item'
  return (
    <Drawer title={kind} onClose={onClose} data-testid="item-details-drawer" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" data-testid="item-details-save" onClick={save}>Save</Button></>}>
      <div className="col" style={{ gap: 16 }}>
        <Field label={item.type === 'presentation' ? 'Name in this service' : 'Name'} hint={item.type === 'presentation' ? `Leave empty to use "${library.find((l) => l.id === item.presentationId)?.title ?? 'the library name'}".` : undefined}>
          <Input data-testid="item-details-title" value={str('title')} placeholder={item.type === 'presentation' ? library.find((l) => l.id === item.presentationId)?.title : undefined} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        {item.type === 'header' && <>
          <Field label="Start time" hint="For example 9:00 or 10:30am. Items below get their times from this."><Input className="mono" value={str('time')} placeholder="9:00" onChange={(e) => set({ time: e.target.value })} /></Field>
          <Field label="Colour"><ColorInput value={str('color') || '#B3B0A7'} onChange={(color) => set({ color })} swatches={['#B3B0A7', '#F4F2EB', '#3886CE', '#E6A20F', '#5FAE8F', '#D8523F']} /></Field>
        </>}
        {item.type === 'placeholder' && <Field label="What goes here" hint="A reminder for whoever is preparing the service."><Input value={str('hint')} placeholder="e.g. Sermon slides from Notion" onChange={(e) => set({ hint: e.target.value })} /></Field>}
        {item.type === 'presentation' && <Field label="People" hint="Who is leading or speaking. Separate names with commas.">
          <Input value={people} placeholder="e.g. Sam, Priya" onChange={(e) => setPeople(e.target.value)} />
        </Field>}
        <Field label="Length" hint="Used for the running times in the service order.">
          <NumberInput value={Math.round((((draft.length as number | undefined) ?? 0) / 60) * 2) / 2} min={0} max={600} step={0.5} suffix="min" style={{ width: 130 }} onChange={(n) => set({ length: Math.round(n * 60) })} />
        </Field>
        {item.type !== 'media' && <Field label="Notes" hint="Shown under the item in the service list."><TextArea rows={3} value={str('notes')} onChange={(e) => set({ notes: e.target.value })} /></Field>}
      </div>
    </Drawer>
  )
}
