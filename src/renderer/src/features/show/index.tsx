import { useEffect, type ReactNode } from 'react'
import { Icon, overlayOpen } from '@ui/index'
import { defineFeature } from '../../app/feature'
import { useApp } from '../../app/store'
import { advance, clearAll, clearSlide, currentPlaylist, retreat, toggleBlackout, toggleLogo, useShowUi } from './actions'
import { MediaBin, useBinState } from './MediaBin'
import { LibraryPanel } from './LibraryPanel'
import { LivePanel } from './LivePanel'
import { NewSong } from './NewSong'
import { QuickSearch } from './QuickSearch'
import { ServicePanel } from './ServicePanel'
import { SlideGrid } from './SlideGrid'
import './show.css'

/**
 * The operator screen. Three columns, left to right in the order a volunteer thinks:
 *   what's in the service  →  the slides of the thing I picked  →  what the room sees + Next.
 */
function ShowView(): ReactNode {
  const playlists = useApp((s) => s.playlists)
  const selectedPlaylistId = useApp((s) => s.selectedPlaylistId)
  const playlist = playlists.find((p) => p.id === selectedPlaylistId)
  const bin = useBinState()
  return (
    <div className={`show ${bin.open ? 'has-bin' : 'bin-shut'}`} style={{ ['--bin-w' as string]: `${bin.width}px` }} data-testid="show-view">
      <aside className="show-side">
        <ServicePanel />
        <LibraryPanel />
      </aside>
      <SlideGrid playlist={playlist} />
      {bin.open
        ? <MediaBin width={bin.width} onWidth={bin.setWidth} onClose={() => bin.setOpen(false)} />
        : <button type="button" className="bin-rail" data-testid="bin-open" onClick={() => bin.setOpen(true)} aria-label="Show the media bin"><Icon name="chevronLeft" size={14} /><span>Media</span></button>}
      <LivePanel />
    </div>
  )
}

const typing = (e: KeyboardEvent): boolean => !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')

/**
 * Show hotkeys are always on (from any screen), because the operator must be able to advance
 * or clear even if they wandered into Settings mid-song.
 */
function ShowHotkeys(): null {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (typing(e) || overlayOpen() || e.metaKey || e.ctrlKey || e.altKey) return
      // Space is ALWAYS "next" (never "press the focused button") — that is the one promise a volunteer
      // needs to be able to rely on. Enter still activates focused buttons for keyboard users.
      const onButton = !!(e.target as HTMLElement | null)?.closest?.('button, [role="button"], [role="option"], a')
      switch (e.key) {
        case ' ':
          e.preventDefault(); void advance(); break
        case 'ArrowRight': case 'PageDown': case 'ArrowDown':
          if (e.key === 'ArrowDown' && onButton) return
          e.preventDefault(); void advance(); break
        case 'ArrowLeft': case 'PageUp': case 'ArrowUp':
          if (e.key === 'ArrowUp' && onButton) return
          e.preventDefault(); void retreat(); break
        case 'Escape': e.preventDefault(); void clearSlide(); break
        case 'F1': e.preventDefault(); void clearAll(); break
        case 'b': case 'B': if (e.shiftKey) { e.preventDefault(); void toggleBlackout() } break
        case 'l': case 'L': if (e.shiftKey) { e.preventDefault(); void toggleLogo() } break
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  return null
}

export default defineFeature({
  id: 'show',
  views: [{ id: 'show', title: 'Show', order: 10, component: ShowView, shortcut: '⌘1', volunteer: true }],
  background: [ShowHotkeys, QuickSearch, NewSong],
  commands: () => [
    { id: 'show.clearAll', title: 'Clear all screens', keywords: 'panic blank', icon: 'close', run: () => void clearAll() },
    { id: 'show.logo', title: 'Show the logo', keywords: 'brand', icon: 'logo', run: () => void toggleLogo() },
    { id: 'show.black', title: 'Black out the screens', keywords: 'blank dark', icon: 'blackout', run: () => void toggleBlackout() },
    { id: 'show.newSong', title: 'New song from pasted lyrics', keywords: 'create add lyrics', icon: 'music', adminOnly: true, run: () => useShowUi.getState().set({ newSong: { addToService: !!currentPlaylist() } }) },
    { id: 'show.add', title: 'Add to this service…', keywords: 'playlist insert', icon: 'plus', adminOnly: true, run: () => setTimeout(() => useShowUi.getState().openSearch({ kind: 'add' }), 0) }
  ],
  shortcuts: [
    { group: 'Running the service', keys: 'space', label: 'Next slide (moves on to the next item at the end)' },
    { group: 'Running the service', keys: 'right', label: 'Next slide' },
    { group: 'Running the service', keys: 'left', label: 'Back one slide' },
    { group: 'Running the service', keys: 'esc', label: 'Clear the words (slide)' },
    { group: 'Running the service', keys: 'F1', label: 'Clear everything' },
    { group: 'Running the service', keys: 'shift+L', label: 'Show / hide the logo' },
    { group: 'Running the service', keys: 'shift+B', label: 'Black screen on / off' }
  ]
})
