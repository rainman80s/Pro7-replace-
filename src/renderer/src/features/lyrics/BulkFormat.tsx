import { useEffect, useState, type ReactNode } from 'react'
import type { LyricFormatSettings } from '@shared/lyric-format'
import { Button, Modal, toast } from '@ui/index'
import { api } from '../../app/store'

type Row = Awaited<ReturnType<typeof api.invoke<'library.formatSongs'>>>['results'][number]

/** "Format all songs…": dry-run preview with per-song counts; tick the songs to write, then apply. */
export function BulkFormat({ settings, onClose }: { settings: LyricFormatSettings; onClose: () => void }): ReactNode {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void api.invoke('library.formatSongs', { settings, dryRun: true }).then((r) => { setRows(r.results); setPicked(new Set(r.results.map((x) => x.id))) }).catch((e) => { toast('Could not preview', 'error', String(e)); onClose() })
  }, [])
  const flagged = (rows ?? []).reduce((n, r) => n + r.flagged.length, 0)
  const apply = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await api.invoke('library.formatSongs', { ids: [...picked], settings })
      toast(`Formatted ${r.results.filter((x) => x.applied).length} songs`, 'success')
      onClose()
    } catch (e) { toast('Format failed', 'error', String(e)); setBusy(false) }
  }
  return (
    <Modal title="Format all songs" onClose={onClose} width={720} data-testid="bulk-format"
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy || !picked.size} onClick={() => void apply()} data-testid="bulk-apply">Format {picked.size} song{picked.size === 1 ? '' : 's'}</Button>
      </>}>
      {!rows ? <div className="dim">Checking your songs…</div> : (
        <div className="col" style={{ gap: 8 }}>
          <div data-testid="bulk-summary"><b>{rows.length}</b> song{rows.length === 1 ? '' : 's'} would change{flagged ? `, ${flagged} line${flagged === 1 ? '' : 's'} flagged for you to check (He/Spirit/Name… capitals are never guessed)` : ''}. Nothing is written until you press Format.</div>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" onClick={() => setPicked(new Set(rows.map((r) => r.id)))}>Select all</Button>
            <Button size="sm" onClick={() => setPicked(new Set())}>Select none</Button>
          </div>
          <div className="scroll" style={{ maxHeight: 380 }}>
            {rows.map((r) => (
              <label key={r.id} className="row" style={{ gap: 10, padding: '5px 2px', borderBottom: '1px solid var(--border-soft)', alignItems: 'flex-start' }}>
                <input type="checkbox" checked={picked.has(r.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n })} />
                <span className="grow">
                  <b>{r.title}</b>
                  <span className="dim"> · {r.slidesBefore} → {r.slidesAfter} slides · {r.corrections} correction{r.corrections === 1 ? '' : 's'}{r.flagged.length ? ` · ${r.flagged.length} flagged` : ''}</span>
                  {r.flagged.slice(0, 2).map((f, i) => <div key={i} className="dim" style={{ fontSize: 12 }}>Slide {f.slide}: “{f.text}” — {f.flags.join(', ')}</div>)}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}
