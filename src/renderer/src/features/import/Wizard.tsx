import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ImportCategory, ImportOptions, ImportProgress, ImportReport, ImportScan } from '@shared/import'
import '@shared/import'
import { Button, Field, Input, Select, TextArea, toast } from '@ui/index'
import { api } from '../../app/store'

const CATEGORIES: [ImportCategory, string][] = [
  ['presentations', 'Songs & presentations'], ['playlists', 'Playlists'], ['media', 'Copy media into Reach'], ['themes', 'Themes'],
  ['macros', 'Macros'], ['props', 'Props'], ['stageLayouts', 'Stage layouts'], ['timers', 'Timers'], ['messages', 'Messages'],
  ['canvases', 'Screens (as suggestions)'], ['devices', 'MIDI / devices summary']
]

type Step = 'source' | 'scanning' | 'review' | 'running' | 'report'

export function ImportWizard({ onClose }: { onClose?: () => void }): ReactNode {
  const [step, setStep] = useState<Step>('source')
  const [tab, setTab] = useState<'propresenter' | 'files' | 'paste'>('propresenter')
  const [guesses, setGuesses] = useState<{ path: string; label: string; exists: boolean }[]>([])
  const [root, setRoot] = useState('')
  const [scan, setScan] = useState<ImportScan | null>(null)
  const [error, setError] = useState('')
  const [include, setInclude] = useState<Partial<Record<ImportCategory, boolean>>>({})
  const [libs, setLibs] = useState<string[] | null>(null)
  const [conflict, setConflict] = useState<NonNullable<ImportOptions['onConflict']>>('skip')
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [jobId, setJobId] = useState('')
  const [report, setReport] = useState<ImportReport | null>(null)

  useEffect(() => { void api.invoke('import.guessFolders').then(setGuesses).catch(() => {}) }, [])
  useEffect(() => {
    const off1 = api.on('import.progress', (p) => { if (!jobId || p.jobId === jobId) setProgress(p) })
    const off2 = api.on('import.done', async (d) => {
      if (jobId && d.jobId !== jobId) return
      if (d.error) { setError(d.error); setStep('review'); return }
      setReport(await api.invoke('import.report', { id: d.reportId }))
      setStep('report')
    })
    return () => { off1(); off2() }
  }, [jobId])

  const doScan = async (path: string): Promise<void> => {
    setRoot(path); setError(''); setStep('scanning')
    try {
      const s = await api.invoke('import.scan', { root: path })
      setScan(s); setLibs(null); setStep('review')
    } catch (e) { setError(String((e as Error).message ?? e)); setStep('source') }
  }
  const pickFolder = async (): Promise<void> => {
    const [p] = await api.invoke('system.pickFiles', { title: 'Choose your ProPresenter folder', directory: true })
    if (p) await doScan(p)
  }
  const start = async (dryRun: boolean): Promise<void> => {
    setError(''); setProgress(null); setStep('running')
    const options: ImportOptions = { include, onConflict: conflict, dryRun, libraries: libs ?? undefined }
    const { jobId: id } = await api.invoke('import.start', { root, options })
    setJobId(id)
  }

  return (
    <div className="col" style={{ gap: 14, minWidth: 640 }} data-testid="import-wizard">
      {step === 'source' && (
        <>
          <div className="row" style={{ gap: 6 }}>
            <Button active={tab === 'propresenter'} onClick={() => setTab('propresenter')}>ProPresenter library</Button>
            <Button active={tab === 'files'} onClick={() => setTab('files')}>Files</Button>
            <Button active={tab === 'paste'} onClick={() => setTab('paste')}>Paste lyrics</Button>
          </div>
          {tab === 'propresenter' && (
            <div className="col" style={{ gap: 10 }}>
              <div className="imp-advice">Point Reach at the folder that holds your ProPresenter <b>Libraries</b>, <b>Playlists</b> and <b>Media</b> (usually <i>Documents/ProPresenter</i>). Reach scans first and shows what it found — nothing is changed in ProPresenter, and nothing is imported until you say so.</div>
              {guesses.filter((g) => g.exists).map((g) => <Button key={g.path} variant="primary" onClick={() => void doScan(g.path)}>Scan {g.label}</Button>)}
              {!guesses.some((g) => g.exists) && <div className="dim">No ProPresenter folder found in the usual places on this computer.</div>}
              <div className="row" style={{ gap: 8 }}>
                <Input placeholder="…or type a folder path" value={root} onChange={(e) => setRoot(e.target.value)} style={{ flex: 1 }} data-testid="import-root" />
                <Button onClick={() => root && void doScan(root)} disabled={!root} data-testid="import-scan">Scan</Button>
                <Button onClick={() => void pickFolder()}>Choose folder…</Button>
              </div>
            </div>
          )}
          {tab === 'files' && <FilesTab onDone={onClose} />}
          {tab === 'paste' && <PasteTab onDone={onClose} />}
          {error && <div className="imp-advice warn">{error}</div>}
        </>
      )}
      {step === 'scanning' && <div className="col" style={{ gap: 8 }}><div>Scanning {root}…</div><div className="imp-bar"><div style={{ width: '35%' }} /></div></div>}
      {step === 'review' && scan && <Review scan={scan} include={include} setInclude={setInclude} libs={libs} setLibs={setLibs} conflict={conflict} setConflict={setConflict} onBack={() => setStep('source')} onStart={start} error={error} />}
      {step === 'running' && (
        <div className="col" style={{ gap: 10 }} data-testid="import-running">
          <div>{progress ? `${labelOf(progress.phase)} — ${progress.done} of ${progress.total}` : 'Starting…'}</div>
          <div className="imp-bar"><div style={{ width: `${progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 5}%` }} /></div>
          <div className="dim" style={{ fontSize: 12, minHeight: 16 }}>{progress?.current}</div>
          <div className="row"><div className="grow" /><Button variant="danger" onClick={() => void api.invoke('import.cancel', { jobId })}>Stop</Button></div>
        </div>
      )}
      {step === 'report' && report && <ReportView report={report} onAgain={() => setStep('review')} onClose={onClose} />}
    </div>
  )
}

const labelOf = (p: ImportProgress['phase']): string => ({ scan: 'Scanning', presentations: 'Converting presentations', media: 'Copying media', playlists: 'Building playlists', config: 'Themes & settings', finish: 'Finishing' })[p]

function Stat({ n, label }: { n: number | string; label: string }): ReactNode {
  return <div className="imp-stat"><b>{n}</b><span>{label}</span></div>
}

function Review(p: {
  scan: ImportScan; include: Partial<Record<ImportCategory, boolean>>; setInclude(v: Partial<Record<ImportCategory, boolean>>): void
  libs: string[] | null; setLibs(v: string[] | null): void; conflict: NonNullable<ImportOptions['onConflict']>; setConflict(v: NonNullable<ImportOptions['onConflict']>): void
  onBack(): void; onStart(dry: boolean): void; error: string
}): ReactNode {
  const { scan } = p
  const v22 = scan.generation === 'pp22-database' || scan.generation === 'mixed'
  const libSel = p.libs ?? scan.libraries.map((l) => l.name)
  const nothing = !scan.counts.presentations && !scan.counts.playlists && !scan.counts.legacy && !scan.counts.configs
  return (
    <div className="col" style={{ gap: 12 }} data-testid="import-review">
      <div className="dim" style={{ fontSize: 12 }}>{scan.root}</div>
      {scan.advice.map((a, i) => <div key={i} className={`imp-advice ${v22 || nothing ? 'warn' : ''}`}>{a}</div>)}
      <div className="imp-grid">
        <Stat n={scan.counts.presentations} label="presentations" />
        <Stat n={scan.counts.playlists} label="playlist files" />
        <Stat n={scan.counts.media} label="media files" />
        <Stat n={scan.counts.themes} label="themes" />
        <Stat n={scan.counts.configs} label="settings files" />
        {scan.counts.legacy > 0 && <Stat n={scan.counts.legacy} label="ProPresenter 4–6 files" />}
      </div>
      {scan.libraries.length > 1 && (
        <Field label="Libraries">
          <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
            {scan.libraries.map((l) => (
              <label key={l.name} className="imp-check"><input type="checkbox" checked={libSel.includes(l.name)} onChange={(e) => p.setLibs(e.target.checked ? [...libSel, l.name] : libSel.filter((x) => x !== l.name))} />{l.name} <span className="dim">({l.count})</span></label>
            ))}
          </div>
        </Field>
      )}
      <Field label="What to bring over">
        <div style={{ columns: 2 }}>
          {CATEGORIES.map(([k, label]) => <label key={k} className="imp-check"><input type="checkbox" checked={p.include[k] !== false} onChange={(e) => p.setInclude({ ...p.include, [k]: e.target.checked })} />{label}</label>)}
        </div>
      </Field>
      <Field label="If a song was already imported and then edited in Reach" hint="Re-running an import is safe: unchanged songs are left alone.">
        <Select value={p.conflict} onChange={(e) => p.setConflict(e.target.value as typeof p.conflict)}>
          <option value="skip">Keep my Reach edits (recommended)</option>
          <option value="overwrite">Replace with the ProPresenter version</option>
          <option value="duplicate">Keep both</option>
        </Select>
      </Field>
      <details><summary className="dim" style={{ cursor: 'pointer' }}>File types found ({scan.scannedFiles} files)</summary>
        <div className="imp-mono" style={{ marginTop: 6 }}>{scan.census.slice(0, 25).map((c) => `${c.ext.padEnd(14)} ${String(c.count).padStart(6)}   ${c.examples[0] ?? ''}`).join('\n')}</div>
        {scan.databases.length > 0 && <div className="imp-mono" style={{ marginTop: 6 }}>{scan.databases.map((d) => `${d.kind}: ${d.path}\n  ${d.detail ?? ''}`).join('\n')}</div>}
      </details>
      {p.error && <div className="imp-advice warn">{p.error}</div>}
      <div className="row" style={{ gap: 8 }}>
        <Button onClick={p.onBack}>Back</Button>
        <div className="grow" />
        <Button onClick={() => p.onStart(true)} disabled={nothing} title="Convert everything and show the report without saving anything">Dry run</Button>
        <Button variant="primary" onClick={() => p.onStart(false)} disabled={nothing} data-testid="import-start">Import</Button>
      </div>
    </div>
  )
}

function ReportView({ report, onAgain, onClose }: { report: ImportReport; onAgain(): void; onClose?: () => void }): ReactNode {
  const t = report.totals
  const [canvases, setCanvases] = useState<string[]>(() => report.suggestedCanvases.filter((c) => c.recommended && !c.exists).map((c) => c.name))
  const problems = useMemo(() => report.files.filter((f) => f.status === 'failed' || f.status === 'partial' || f.status === 'skipped'), [report])
  const unmapped = Object.entries(report.unmapped).sort((a, b) => b[1] - a[1])
  const saveText = async (): Promise<void> => {
    const path = await api.invoke('system.pickSave', { title: 'Save import report', defaultPath: `ProPresenter import ${report.id}.txt`, filters: [{ name: 'Text', extensions: ['txt'] }] })
    if (path) { await api.invoke('export.reportText', { id: report.id, path }); toast('Report saved', 'success') }
  }
  const create = async (): Promise<void> => {
    const r = await api.invoke('import.createCanvases', { reportId: report.id, names: canvases })
    toast(r.created.length ? `Created ${r.created.join(', ')}` : 'Nothing created (names already exist)', 'success')
  }
  return (
    <div className="col" style={{ gap: 12 }} data-testid="import-report">
      <div className="imp-advice">{report.dryRun ? 'Dry run — nothing was saved. ' : ''}{report.cancelled ? 'Stopped early. ' : ''}Finished {new Date(report.finishedAt ?? report.startedAt).toLocaleTimeString()}.</div>
      <div className="imp-grid">
        <Stat n={t.imported + t.updated} label="imported / updated" />
        <Stat n={t.partial} label="with warnings" />
        <Stat n={t.unchanged + t.skipped} label="unchanged / kept" />
        <Stat n={t.failed} label="failed" />
        <Stat n={report.media.copied} label="media copied" />
        <Stat n={report.media.missing.length} label="media missing" />
        <Stat n={report.playlists.length} label="playlists" />
      </div>
      {report.suggestedCanvases.length > 0 && !report.dryRun && (
        <details open><summary style={{ cursor: 'pointer' }}>ProPresenter screens → Reach canvases</summary>
          <div className="dim" style={{ margin: '6px 0', fontSize: 12 }}>Reach doesn't change your screens automatically. Tick the ones you want as canvases, then route them on the Displays page.</div>
          {report.suggestedCanvases.map((c, i) => (
            <label key={i} className="imp-check"><input type="checkbox" disabled={c.exists} checked={canvases.includes(c.name)} onChange={(e) => setCanvases(e.target.checked ? [...canvases, c.name] : canvases.filter((n) => n !== c.name))} />
              <b>{c.name}</b>{c.recommended && <span className="imp-tag imported" style={{ marginLeft: 6 }}>Recommended</span>} <span className="dim">{c.kind}, {c.width}×{c.height}{c.regions.length ? `, ${c.regions.length} outputs` : ''}{c.exists ? ' — already exists' : ''}{c.note ? ` — ${c.note}` : ''}</span></label>
          ))}
          <Button size="sm" disabled={!canvases.length} onClick={() => void create()}>Create selected canvases</Button>
        </details>
      )}
      {unmapped.length > 0 && <details><summary style={{ cursor: 'pointer' }}>ProPresenter features not reproduced ({unmapped.length})</summary><div className="imp-mono">{unmapped.map(([k, v]) => `${String(v).padStart(5)}  ${k}`).join('\n')}</div></details>}
      {report.media.missing.length > 0 && <details><summary style={{ cursor: 'pointer' }}>Missing media ({report.media.missing.length})</summary><div className="imp-list">{report.media.missing.slice(0, 300).map((m) => <div key={m}>{m}</div>)}</div></details>}
      {problems.length > 0 && (
        <details open={problems.some((f) => f.status === 'failed')}><summary style={{ cursor: 'pointer' }}>Files to check ({problems.length})</summary>
          <div className="imp-list">{problems.slice(0, 500).map((f, i) => (
            <div key={i}><span className={`imp-tag ${f.status}`}>{f.status}</span> {f.title ?? f.rel}{f.error ? ` — ${f.error}` : ''}{f.warnings[0] ? <span className="dim"> — {f.warnings[0]}</span> : null}{f.missingMedia?.length ? <span className="dim"> — {f.missingMedia.length} media missing</span> : null}</div>
          ))}</div>
        </details>
      )}
      <div className="row" style={{ gap: 8 }}>
        <Button onClick={onAgain}>{report.dryRun ? 'Back to options' : 'Import again'}</Button>
        <Button onClick={() => void saveText()}>Save report…</Button>
        <div className="grow" />
        {onClose && <Button variant="primary" onClick={onClose}>Done</Button>}
      </div>
    </div>
  )
}

function FilesTab({ onDone }: { onDone?: () => void }): ReactNode {
  const [busy, setBusy] = useState(false)
  const pick = async (dir: boolean): Promise<void> => {
    const paths = await api.invoke('system.pickFiles', {
      title: 'Import files', multi: true, directory: dir,
      filters: dir ? undefined : [{ name: 'Presentations & lyrics', extensions: ['pro', 'probundle', 'proplaylist', 'pro6', 'pro5', 'pro4', 'reach', 'reachbundle', 'cho', 'chopro', 'chordpro', 'xml', 'usr', 'txt', 'rtf', 'pptx', 'png', 'jpg', 'jpeg'] }, { name: 'All files', extensions: ['*'] }]
    })
    if (!paths.length) return
    setBusy(true)
    try {
      const r = await api.invoke('import.files', { paths })
      const ok = r.reports.filter((x) => x.status !== 'failed').length
      const bad = r.reports.filter((x) => x.status === 'failed')
      toast(`Imported ${ok} item${ok === 1 ? '' : 's'}`, bad.length ? 'warning' : 'success', bad.map((b) => `${b.path.split(/[\\/]/).pop()}: ${b.error}`).join('\n') || undefined)
      if (ok) onDone?.()
    } finally { setBusy(false) }
  }
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="imp-advice">ProPresenter 7 <b>.pro</b>, <b>.proBundle</b>, <b>.proPlaylist</b>; ProPresenter 4–6; Reach <b>.reach</b> / <b>.reachbundle</b>; ChordPro, OpenLyrics, OpenSong, CCLI SongSelect (.txt/.usr), plain text, PowerPoint (.pptx, as editable text) and images (one slide each). You can also drag files onto the window.</div>
      <div className="row" style={{ gap: 8 }}>
        <Button variant="primary" disabled={busy} onClick={() => void pick(false)}>Choose files…</Button>
        <Button disabled={busy} onClick={() => void pick(true)}>Choose a folder of images…</Button>
      </div>
      <div className="dim" style={{ fontSize: 12 }}>PDF or "PowerPoint as pictures": export the pages as PNG/JPEG (Preview, Keynote, PowerPoint or LibreOffice can do this) and import the folder of images.</div>
    </div>
  )
}

function PasteTab({ onDone }: { onDone?: () => void }): ReactNode {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [author, setAuthor] = useState('')
  const [ccli, setCcli] = useState('')
  const save = async (): Promise<void> => {
    await api.invoke('import.text', { title: title || text.split('\n')[0] || 'Untitled', text, meta: { author: author || undefined, ccliNumber: ccli || undefined } })
    toast('Song created', 'success')
    onDone?.()
  }
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8 }}>
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Author"><Input value={author} onChange={(e) => setAuthor(e.target.value)} /></Field>
        <Field label="CCLI #"><Input value={ccli} onChange={(e) => setCcli(e.target.value)} style={{ width: 110 }} /></Field>
      </div>
      <Field label="Lyrics" hint="A blank line starts a new slide. A line like “Verse 1” or “[Chorus]” starts a section.">
        <TextArea rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Verse 1\nAmazing grace how sweet the sound\nThat saved a wretch like me\n\nChorus\n…'} />
      </Field>
      <div className="row"><div className="grow" /><Button variant="primary" disabled={!text.trim()} onClick={() => void save()}>Create song</Button></div>
    </div>
  )
}
