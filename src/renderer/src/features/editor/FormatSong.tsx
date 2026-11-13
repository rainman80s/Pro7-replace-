import { useEffect, useState, type ReactNode } from 'react'
import { formatPresentation, DEFAULT_LYRIC_FORMAT_DOC, type LyricFormatDoc } from '@shared/lyric-format'
import { Button, toast } from '@ui/index'
import { api } from '../../app/store'
import { FormatSettingsForm } from '../lyrics/FormatSettings'
import { BulkFormat } from '../lyrics/BulkFormat'
import { commit, getDoc } from './store'

/** "Format song" button + settings popover for Text mode. Undoable (one history step). */
export function FormatSong(): ReactNode {
  const [open, setOpen] = useState(false)
  const [bulk, setBulk] = useState(false)
  const [doc, setDoc] = useState<LyricFormatDoc>(DEFAULT_LYRIC_FORMAT_DOC)
  useEffect(() => { void api.invoke('lyrics.settings').then(setDoc).catch(() => {}) }, [])
  const run = (): void => {
    const cur = getDoc()
    if (!cur) return
    const r = formatPresentation(cur, doc.format)
    if (!r.report.changed) { toast('Already formatted', 'info'); return }
    commit(() => r.presentation, 'Format song')
    const f = r.report.flagged.length
    toast(`Formatted: ${r.report.slidesBefore} → ${r.report.slidesAfter} slides, ${r.report.corrections} correction${r.report.corrections === 1 ? '' : 's'}`, 'success', f ? `${f} line${f === 1 ? '' : 's'} to check: ${r.report.flagged.slice(0, 3).map((x) => `slide ${x.slide}`).join(', ')}` : undefined)
    setOpen(false)
  }
  return (
    <div style={{ position: 'relative' }}>
      <Button size="sm" variant="primary" onClick={run} data-testid="format-song" title="Join broken lines, re-slide, fix capitals">Format song</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-label="Format options" data-testid="format-options">▾</Button>
      {open && (
        <div className="card" style={{ position: 'absolute', right: 0, top: 30, zIndex: 20, width: 330, padding: 12, background: 'var(--bg-raised, var(--bg))', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.35)' }} data-testid="format-popover">
          <FormatSettingsForm value={doc.format} onChange={(format) => setDoc((d) => ({ ...d, format }))} />
          <div className="row" style={{ gap: 6, marginTop: 10 }}>
            <Button size="sm" variant="primary" onClick={run}>Format</Button>
            <Button size="sm" onClick={() => void api.invoke('lyrics.setSettings', { format: doc.format }).then(() => toast('Saved as default', 'success'))}>Save as default</Button>
            <div className="grow" />
            <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setBulk(true) }} data-testid="format-all-open">All songs…</Button>
          </div>
        </div>
      )}
      {bulk && <BulkFormat settings={doc.format} onClose={() => setBulk(false)} />}
    </div>
  )
}
