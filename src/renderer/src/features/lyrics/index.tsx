/** Settings → Lyrics: defaults for "Format song", auto-correct for imported songs, and "Format all songs…". */
import { useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_LYRIC_FORMAT_DOC, type LyricFormatDoc } from '@shared/lyric-format'
import { Button, Toggle } from '@ui/index'
import { defineFeature } from '../../app/feature'
import { api } from '../../app/store'
import { BulkFormat } from './BulkFormat'
import { FormatSettingsForm } from './FormatSettings'

function LyricsSettings(): ReactNode {
  const [doc, setDoc] = useState<LyricFormatDoc>(DEFAULT_LYRIC_FORMAT_DOC)
  const [bulk, setBulk] = useState(false)
  useEffect(() => { void api.invoke('lyrics.settings').then(setDoc).catch(() => {}) }, [])
  const save = (patch: Partial<LyricFormatDoc>): void => {
    const next = { ...doc, ...patch }
    setDoc(next)
    void api.invoke('lyrics.setSettings', patch).catch(() => {})
  }
  return (
    <div className="col" style={{ gap: 14 }} data-testid="settings-lyrics-body">
      <Toggle checked={doc.autoCorrectImported} onChange={(v) => save({ autoCorrectImported: v })} label="Auto-correct imported songs (ProPresenter, Planning Center, pasted lyrics)" data-testid="auto-correct" />
      <div>
        <div className="dim" style={{ marginBottom: 6 }}>Defaults for “Format song” (shared by every computer using this workspace)</div>
        <FormatSettingsForm value={doc.format} onChange={(format) => save({ format })} />
      </div>
      <div className="row"><Button onClick={() => setBulk(true)} data-testid="format-all">Format all songs…</Button><span className="dim" style={{ marginLeft: 10 }}>Shows what would change first.</span></div>
      {bulk && <BulkFormat settings={doc.format} onClose={() => setBulk(false)} />}
    </div>
  )
}

export default defineFeature({ id: 'lyrics', settings: [{ id: 'lyrics', title: 'Lyrics', order: 45, component: LyricsSettings }] })
