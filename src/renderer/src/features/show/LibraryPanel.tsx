import { useMemo, useState, type ReactNode } from 'react'
import { IconButton, Icon, SearchInput, confirm, dragSource, openContextMenu, toast, Empty } from '@ui/index'
import { api, openPresentation, useApp, useLocked } from '../../app/store'
import { addPresentationToService, goToSlide, selectLibraryItem, useShowUi } from './actions'
import { matchScore } from './logic'
import { LIBRARY_DND } from './ServicePanel'

/** Everything in the library, for pulling up something that isn't in today's service. */
export function LibraryPanel(): ReactNode {
  const library = useApp((s) => s.library)
  const selectedPresentationId = useApp((s) => s.selectedPresentationId)
  const selectedItemId = useApp((s) => s.selectedPlaylistItemId)
  const hasService = useApp((s) => !!s.selectedPlaylistId && s.playlists.some((p) => p.id === s.selectedPlaylistId))
  const locked = useLocked()
  const ui = useShowUi()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('reach.show.library') !== '0' } catch { return true } })
  const toggle = (): void => setOpen((o) => { try { localStorage.setItem('reach.show.library', o ? '0' : '1') } catch { /* ignore */ } return !o })

  const results = useMemo(() => {
    if (!q.trim()) return library
    return library.map((p) => ({ p, score: matchScore(q, p.title, `${p.artist ?? ''} ${p.ccliNumber ?? ''} ${p.excerpt ?? ''}`) }))
      .filter((x) => x.score !== null).sort((a, b) => a.score! - b.score! || a.p.title.localeCompare(b.p.title)).map((x) => x.p)
  }, [q, library])

  const remove = async (id: string, title: string): Promise<void> => {
    if (!(await confirm({ title: `Delete "${title}"?`, message: 'It is removed from the library on every computer that shares this workspace. Services that use it will show it as missing.', confirmLabel: 'Delete from library', danger: true }))) return
    await api.invoke('library.delete', { id }).catch((e) => toast("Couldn't delete it", 'error', String(e)))
  }

  return (
    <section className={`panel lib ${open ? '' : 'collapsed'}`} data-testid="library-panel">
      <header className="lib-head">
        <button type="button" className="panel-toggle panel-title" aria-expanded={open} onClick={toggle}><Icon name="chevronDown" size={12} />Library<span className="faint" style={{ letterSpacing: 0 }}>{library.length}</span></button>
        {!locked && <IconButton icon="plus" size="sm" label="New song from pasted lyrics" data-testid="library-new" onClick={() => ui.set({ newSong: { addToService: false } })} />}
      </header>
      {open && <>
        <div className="lib-search"><SearchInput value={q} onValue={setQ} placeholder="Search songs and slides" data-testid="library-search" /></div>
        <div className="lib-list scroll grow">
          {!results.length && (library.length
            ? <div className="lib-none">Nothing matches “{q}”.</div>
            : <Empty title="Your library is empty" icon="music">{locked ? 'Ask your tech lead to add songs.' : 'Add a song with +, or import from ProPresenter.'}</Empty>)}
          {results.map((p) => (
            <div key={p.id} role="button" tabIndex={0} data-testid="library-item" {...(locked ? {} : dragSource(LIBRARY_DND, p.id))}
              className={`lib-item ${p.id === selectedPresentationId && !selectedItemId ? 'on' : ''}`}
              onClick={() => selectLibraryItem(p.id)}
              onKeyDown={(e) => { if (e.target === e.currentTarget && e.key === 'Enter') { e.preventDefault(); selectLibraryItem(p.id) } }}
              onContextMenu={(e) => openContextMenu(e, [
                { label: 'Show first slide', icon: 'play', onSelect: () => { selectLibraryItem(p.id); void goToSlide(p.id, 0) } },
                !locked && hasService ? { label: 'Add to this service', icon: 'plus', onSelect: () => void addPresentationToService(p.id) } : null,
                locked ? null : { type: 'separator' },
                locked ? null : { label: 'Edit slides', icon: 'edit', onSelect: () => openPresentation(p.id, 'edit') },
                locked ? null : { label: 'Duplicate', icon: 'copy', onSelect: () => void api.invoke('library.duplicate', { id: p.id }).catch((err) => toast("Couldn't duplicate it", 'error', String(err))) },
                locked ? null : { type: 'separator' },
                locked ? null : { label: 'Delete from library…', icon: 'trash', danger: true, onSelect: () => void remove(p.id, p.title) }
              ])}>
              <span className="truncate grow">{p.title}</span>
              <span className="lib-count">{p.slideCount}</span>
              {!locked && hasService && <IconButton className="lib-add" icon="plus" size="sm" label="Add to this service" tabIndex={-1} data-testid="library-add" onClick={(e) => { e.stopPropagation(); void addPresentationToService(p.id) }} />}
            </div>
          ))}
        </div>
      </>}
    </section>
  )
}
