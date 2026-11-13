import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon, Kbd, Modal, toast, type IconName } from '@ui/index'
import type { QuickSearchResult } from '../../app/feature'
import { allCommands, allSearchProviders } from '../../app/registry'
import { useApp } from '../../app/store'
import { addPresentationToService, currentPlaylist, goToSlide, savePlaylist, selectItem, selectLibraryItem, useShowUi } from './actions'
import { matchScore, updateItem } from './logic'

interface Row extends QuickSearchResult { section: string }

/**
 * ⌘K: find anything and act on it without leaving the keyboard.
 *   Enter       = the first action (Show now / Add to service / Run)
 *   ⌘/Ctrl+Enter = the second action
 */
export function QuickSearch(): ReactNode {
  const open = useApp((s) => s.overlay === 'search')
  const setOverlay = useApp((s) => s.setOverlay)
  if (!open) return null
  return <QuickSearchDialog onClose={() => { setOverlay(null); useShowUi.setState({ searchMode: { kind: 'open' } }) }} />
}

function QuickSearchDialog({ onClose }: { onClose: () => void }): ReactNode {
  const library = useApp((s) => s.library)
  const playlists = useApp((s) => s.playlists)
  const locked = useApp((s) => s.locked)
  const mode = useShowUi((s) => s.searchMode)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [extra, setExtra] = useState<Row[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const playlist = currentPlaylist()

  const run = (fn: () => unknown): void => { onClose(); void Promise.resolve(fn()).catch((e) => toast('That did not work', 'error', String(e))) }

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const songs = library
      .map((p) => ({ p, score: matchScore(q, p.title, `${p.artist ?? ''} ${p.ccliNumber ?? ''} ${p.excerpt ?? ''}`) }))
      .filter((x) => x.score !== null)
      .sort((a, b) => a.score! - b.score! || a.p.title.localeCompare(b.p.title))
      .slice(0, q ? 12 : 8)
    for (const { p } of songs) {
      const inService = playlist?.items.find((it) => it.type === 'presentation' && it.presentationId === p.id)
      const actions: Row['actions'] = []
      if (mode.kind === 'add' && playlist) actions.push({ label: 'Add to service', run: () => addPresentationToService(p.id, mode.index) })
      else if (mode.kind === 'replace' && playlist) actions.push({ label: 'Use here', run: () => void savePlaylist(updateItem(playlist, mode.itemId, { type: 'presentation', presentationId: p.id, title: undefined, hint: undefined } as never)) })
      else {
        actions.push({ label: 'Show now', run: () => { if (inService) selectItem(inService); else selectLibraryItem(p.id); return goToSlide(p.id, 0, inService ? { playlistId: playlist?.id, itemId: inService.id } : undefined) } })
        if (!locked && playlist && !inService) actions.push({ label: 'Add to service', run: () => addPresentationToService(p.id) })
        else actions.push({ label: 'Open', run: () => (inService ? selectItem(inService) : selectLibraryItem(p.id)) })
      }
      out.push({ section: 'Songs and slides', id: `p:${p.id}`, title: p.title, subtitle: [p.artist, `${p.slideCount} slides`, inService ? 'in this service' : null].filter(Boolean).join(' · '), icon: p.kind === 'song' ? 'music' : 'slides', actions })
    }
    if (mode.kind === 'open') {
      for (const pl of playlists) {
        if (q && matchScore(q, pl.name) === null) continue
        if (!q && pl.id === playlist?.id) continue
        out.push({ section: 'Services', id: `s:${pl.id}`, title: pl.name, subtitle: `${pl.items.filter((x) => x.type !== 'header').length} items`, icon: 'calendar', actions: [{ label: 'Open', run: () => useApp.getState().select({ selectedPlaylistId: pl.id, selectedPlaylistItemId: null, selectedPresentationId: null }) }] })
      }
      if (q && !locked) {
        out.push({ section: 'Create', id: 'new-song', title: `New song “${q}”…`, subtitle: 'Paste the lyrics on the next step', icon: 'plus', actions: [{ label: 'Create', run: () => useShowUi.getState().set({ newSong: { addToService: !!playlist } }) }] })
      }
      for (const c of allCommands()) {
        if (c.adminOnly && locked) continue
        if (q ? matchScore(q, c.title, c.keywords) === null : true) continue
        out.push({ section: 'Actions', id: `c:${c.id}`, title: c.title, icon: c.icon, actions: [{ label: 'Run', run: c.run }] })
      }
      for (const v of BUILTIN_VIEWS) if (q && matchScore(q, v.title, v.keywords) !== null && (!locked || v.volunteer)) out.push({ section: 'Go to', id: `v:${v.id}`, title: v.title, icon: v.icon, actions: [{ label: 'Go', run: () => useApp.getState().setView(v.id) }] })
    }
    return [...out, ...extra]
  }, [q, library, playlists, playlist, mode, locked, extra])

  // Other features' providers (Bible, media, Planning Center…), debounced.
  useEffect(() => {
    if (mode.kind !== 'open' || !q.trim()) { setExtra([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      const results: Row[] = []
      for (const p of allSearchProviders()) {
        try { for (const r of (await p.search(q)).slice(0, 6)) results.push({ ...r, section: p.title }) } catch { /* one broken provider shouldn't break search */ }
      }
      if (!cancelled) setExtra(results)
    }, 150)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, mode.kind])

  useEffect(() => setActive(0), [q])
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' }) }, [active])

  const title = mode.kind === 'add' ? `Add to ${playlist?.name ?? 'the service'}` : mode.kind === 'replace' ? 'Choose what goes here' : 'Find'
  let lastSection = ''
  return (
    <Modal title={title} onClose={onClose} width={620} className="qs" data-testid="quick-search">
      <div className="qs-input">
        <Icon name="search" size={18} />
        <input autoFocus data-autofocus="" data-testid="quick-search-input" value={q} placeholder="Type a song title, a lyric line or a CCLI number" spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(rows.length - 1, a + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
            else if (e.key === 'Enter' && rows[active]) {
              e.preventDefault()
              const a = rows[active].actions[(e.metaKey || e.ctrlKey) && rows[active].actions[1] ? 1 : 0]
              if (a) run(a.run)
            }
          }} />
      </div>
      <div className="qs-list scroll" ref={listRef} role="listbox">
        {!rows.length && <div className="qs-none">{q ? `Nothing found for “${q}”.` : 'Your library is empty.'}</div>}
        {rows.map((r, i) => {
          const head = r.section !== lastSection ? <div className="qs-section">{r.section}</div> : null
          lastSection = r.section
          return (
            <div key={r.id}>
              {head}
              <div role="option" aria-selected={i === active} data-row={i} data-testid="quick-search-row" className={`qs-row ${i === active ? 'on' : ''}`}
                onMouseMove={() => i !== active && setActive(i)} onClick={() => r.actions[0] && run(r.actions[0].run)}>
                <Icon name={(r.icon ?? 'slides') as IconName} size={16} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="truncate">{r.title}</div>
                  {r.subtitle && <div className="t-meta truncate">{r.subtitle}</div>}
                </div>
                {r.actions.map((a, j) => (
                  <button key={a.label} type="button" className={`btn sm ${j === 0 ? (i === active ? 'primary' : '') : 'ghost'}`} data-testid={`qs-action-${a.label.toLowerCase().replace(/\s+/g, '-')}`}
                    onClick={(e) => { e.stopPropagation(); run(a.run) }}>
                    {a.label}{i === active && <kbd className="kbd">{j === 0 ? '↵' : `${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}↵`}</kbd>}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <div className="qs-foot t-meta"><span><Kbd>↑</Kbd><Kbd>↓</Kbd> choose</span><span><Kbd>↵</Kbd> {rows[active]?.actions[0]?.label.toLowerCase() ?? 'open'}</span><span><Kbd>Esc</Kbd> close</span></div>
    </Modal>
  )
}

const BUILTIN_VIEWS: { id: string; title: string; icon: string; keywords?: string; volunteer?: boolean }[] = [
  { id: 'show', title: 'Show', icon: 'show', keywords: 'present live operate', volunteer: true },
  { id: 'edit', title: 'Edit slides', icon: 'edit', keywords: 'editor' },
  { id: 'media', title: 'Media', icon: 'media', keywords: 'video images backgrounds' },
  { id: 'bible', title: 'Bible', icon: 'bible', keywords: 'scripture verse' },
  { id: 'displays', title: 'Displays', icon: 'displays', keywords: 'screens outputs projector tv' },
  { id: 'integrations', title: 'Integrations', icon: 'integrations', keywords: 'planning center notion figma sync' },
  { id: 'settings', title: 'Settings', icon: 'settings', keywords: 'preferences pin' }
]
