import { useEffect, useState, type ReactNode } from 'react'
import type { Playlist, PlaylistItem } from '@shared/model'
import { Button, toast } from '@ui/index'
import { api, useApp } from '../../app/store'

type Which = 'sermons' | 'announcements'
type Placeholder = Extract<PlaylistItem, { type: 'placeholder' }>

/** Which Notion page types make sense for a placeholder, judging by its name and hint. */
export function notionKinds(it: Placeholder): Which[] {
  const text = `${it.title} ${it.hint ?? ''}`
  const out: Which[] = []
  if (/announce|highlight/i.test(text)) out.push('announcements')
  if (/sermon|message|teaching/i.test(text)) out.push('sermons')
  if (!out.length && /notion/i.test(text)) out.push('announcements', 'sermons')
  return out
}

/** "Pull from Notion" / "Pull sermon slides": fetch THIS service date's page and fill the placeholder. */
export function NotionPull({ playlist, item }: { playlist: Playlist; item: Placeholder }): ReactNode {
  const kinds = notionKinds(item)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<Which | null>(null)
  const setView = useApp((s) => s.setView)
  useEffect(() => {
    if (!kinds.length) return
    void api.invoke('notion.status').then((s) => setConnected(s.connected), () => setConnected(false))
  }, [kinds.length])
  if (!kinds.length) return null

  const pull = async (which: Which): Promise<void> => {
    setBusy(which)
    try {
      const found = await api.invoke('notion.forPlaylist', { playlistId: playlist.id })
      const pages = which === 'sermons' ? found.sermons : found.announcements
      if (!pages.length) {
        toast(`No Notion page found for ${found.date ?? 'this date'}`, 'warning', `Check that the ${which === 'sermons' ? 'sermon' : 'announcements'} page for this Sunday exists and is shared with the integration.`)
        return
      }
      const r = await api.invoke('notion.import', { which, pageIds: which === 'announcements' ? pages.map((p) => p.id) : [pages[0].id], playlistId: playlist.id, itemId: item.id })
      useApp.setState((s) => ({ presentations: { ...s.presentations, [r.presentation.id]: r.presentation } }))
      useApp.getState().select({ selectedPlaylistItemId: r.attached?.itemId ?? item.id, selectedPresentationId: r.presentation.id })
      toast(`${item.title} filled from Notion`, 'success', r.warnings[0])
    } catch (e) {
      toast("Couldn't pull from Notion", 'error', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (connected === false) {
    return <p className="notion-hint" data-testid="notion-hint">Notion isn't connected yet. <button type="button" className="link" onClick={() => setView('integrations')}>Connect it in Integrations</button> to pull this in.</p>
  }
  return (
    <>
      {kinds.map((k) => (
        <Button key={k} icon="download" disabled={busy !== null || connected === null} data-testid={`notion-pull-${k}`} onClick={() => void pull(k)}>
          {busy === k ? 'Pulling…' : k === 'sermons' ? 'Pull sermon slides' : 'Pull from Notion'}
        </Button>
      ))}
    </>
  )
}
