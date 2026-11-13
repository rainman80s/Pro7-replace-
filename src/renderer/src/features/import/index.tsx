import { useEffect, useState, type ReactNode } from 'react'
import { Button, Modal, Panel, toast } from '@ui/index'
import '@shared/import'
import { defineFeature } from '../../app/feature'
import { api, openPresentation } from '../../app/store'
import { ImportWizard } from './Wizard'
import './import.css'

/** Opens the wizard from anywhere: window.dispatchEvent(new Event('reach:open-import')). */
function ImportButton(): ReactNode {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const on = (): void => setOpen(true)
    window.addEventListener('reach:open-import', on)
    return () => window.removeEventListener('reach:open-import', on)
  }, [])
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)} title="Import songs, ProPresenter libraries and files" data-testid="import-open">Import</Button>
      {open && <Modal title="Import" onClose={() => setOpen(false)} width={760}><ImportWizard onClose={() => setOpen(false)} /></Modal>}
    </>
  )
}

function ImportSettings(): ReactNode {
  const [reports, setReports] = useState<{ id: string; root: string; startedAt: string; totals: Record<string, number> }[]>([])
  useEffect(() => { void api.invoke('import.reports').then(setReports).catch(() => {}) }, [])
  const exportAll = async (format: 'csv' | 'reachbundle'): Promise<void> => {
    const path = await api.invoke('system.pickSave', { title: format === 'csv' ? 'Song list for CCLI reporting' : 'Reach bundle', defaultPath: format === 'csv' ? 'Reach songs.csv' : 'Reach library.reachbundle' })
    if (!path) return
    const presentationIds = format === 'csv' ? undefined : (await api.invoke('library.list')).map((s) => s.id)
    const r = await api.invoke('export.run', { format, path, presentationIds })
    toast('Exported', 'success', `${(r.bytes / 1024).toFixed(0)} KB${r.warnings.length ? ` — ${r.warnings.join('; ')}` : ''}`)
  }
  return (
    <div className="col" style={{ gap: 14 }}>
      <Panel title="Import from ProPresenter and other apps">
        <div style={{ padding: 12 }}><ImportWizard /></div>
      </Panel>
      <Panel title="Export">
        <div className="row" style={{ padding: 12, gap: 8 }}>
          <Button onClick={() => void exportAll('csv')}>Song list (CSV with CCLI numbers)…</Button>
          <Button onClick={() => void exportAll('reachbundle')}>Whole library as .reachbundle…</Button>
        </div>
      </Panel>
      {reports.length > 0 && (
        <Panel title="Previous imports">
          <div className="imp-list" style={{ margin: 12 }}>{reports.map((r) => <div key={r.id}>{new Date(r.startedAt).toLocaleString()} — {r.root} — {r.totals.imported + r.totals.updated + r.totals.partial} imported, {r.totals.failed} failed</div>)}</div>
        </Panel>
      )}
    </div>
  )
}

const ACCEPT = /\.(pro|probundle|proplaylist|pro[456]|reach|reachbundle|cho|chopro|chordpro|xml|usr|txt|rtf|pptx|png|jpe?g|gif|webp|mp4|mov|m4v|mp3|wav|m4a)$/i

/** Drag any supported file onto the window to import it. */
function DropImport(): ReactNode {
  const [over, setOver] = useState(false)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
    const enter = (e: DragEvent): void => { if (!hasFiles(e)) return; depth++; setOver(true) }
    const leave = (e: DragEvent): void => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setOver(false) }
    const overH = (e: DragEvent): void => { if (hasFiles(e)) e.preventDefault() }
    const drop = async (e: DragEvent): Promise<void> => {
      if (!hasFiles(e)) return
      // Let views that handle their own drops (media bin, editor) keep them.
      if ((e.target as HTMLElement | null)?.closest?.('[data-drop-target]')) { depth = 0; setOver(false); return }
      e.preventDefault()
      depth = 0
      setOver(false)
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => ACCEPT.test(f.name))
      if (!files.length) { toast('Nothing to import', 'warning', 'Drop .pro, .proBundle, .reachbundle, lyrics, PowerPoint or image files'); return }
      let ok = 0
      let lastId = ''
      for (const f of files) {
        try {
          const buf = new Uint8Array(await f.arrayBuffer())
          let bin = ''
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
          const r = await api.invoke('import.data', { name: f.name, base64: btoa(bin) })
          ok += r.reports.filter((x) => x.status !== 'failed').length
          lastId = r.presentationIds[r.presentationIds.length - 1] ?? lastId
          for (const bad of r.reports.filter((x) => x.status === 'failed')) toast(`Could not import ${f.name}`, 'error', bad.error)
        } catch (err) { toast(`Could not import ${f.name}`, 'error', String(err)) }
      }
      if (ok) { toast(`Imported ${ok} item${ok === 1 ? '' : 's'}`, 'success'); if (lastId) openPresentation(lastId) }
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overH)
    window.addEventListener('drop', drop)
    const off = api.on('import.opened', (r) => { const id = r.presentationIds[0]; if (id) openPresentation(id) })
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('dragover', overH); window.removeEventListener('drop', drop); off() }
  }, [])
  return over ? <div className="imp-drop">Drop to import</div> : null
}

export default defineFeature({
  id: 'import',
  toolbar: [{ id: 'import', order: 40, component: ImportButton }],
  settings: [{ id: 'import', title: 'Import & export', order: 70, component: ImportSettings }],
  background: [DropImport]
})
