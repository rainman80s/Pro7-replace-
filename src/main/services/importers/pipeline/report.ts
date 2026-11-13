import type { ImportReport, ImportScan } from '@shared/import'

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`

/** Human-readable migration report (saved next to the JSON report, exportable, pasteable into an email). */
export function reportToText(r: ImportReport): string {
  const L: string[] = []
  L.push(`Reach Presenter — ProPresenter import report`)
  L.push(`Source: ${r.root}`)
  if (r.generation) L.push(`Workspace type: ${r.generation}`)
  L.push(`Started ${r.startedAt}${r.finishedAt ? `, finished ${r.finishedAt}` : ''}${r.dryRun ? '  (DRY RUN — nothing was written)' : ''}${r.cancelled ? '  (CANCELLED)' : ''}`)
  L.push('')
  const t = r.totals
  L.push(`Files: ${t.imported} imported, ${t.updated} updated, ${t.partial} imported with problems, ${t.unchanged} unchanged, ${t.skipped} skipped, ${t.failed} failed`)
  L.push(`Media: ${r.media.copied} copied (${(r.media.bytes / 1e6).toFixed(1)} MB), ${r.media.linked} linked, ${r.media.missing.length} missing`)
  for (const [k, v] of Object.entries(r.docs)) L.push(`${k}: ${v.added} added, ${v.updated} updated${v.skipped ? `, ${v.skipped} kept (edited in Reach)` : ''}`)
  if (r.playlists.length) L.push(`Playlists: ${r.playlists.length} (${r.playlists.reduce((n, p) => n + p.unresolved.length, 0)} items could not be matched)`)
  if (r.notes.length) { L.push(''); L.push('Notes:'); for (const n of r.notes) L.push(`  • ${n}`) }
  if (r.suggestedCanvases.length) {
    L.push(''); L.push('ProPresenter screens → suggested Reach canvases (not created automatically):')
    for (const c of r.suggestedCanvases) L.push(`  • ${c.name} — ${c.kind}, ${c.width}×${c.height}${c.regions.length ? `, regions: ${c.regions.map((x) => x.name).join(', ')}` : ''}; device: ${c.devices.join(', ') || 'none'}${c.exists ? ' (a canvas with this name already exists)' : ''}`)
  }
  const unm = Object.entries(r.unmapped).sort((a, b) => b[1] - a[1])
  if (unm.length) { L.push(''); L.push('ProPresenter features Reach does not reproduce yet (count):'); for (const [k, v] of unm) L.push(`  ${String(v).padStart(5)}  ${k}`) }
  const unk = Object.entries(r.unknownFields).sort((a, b) => b[1] - a[1])
  if (unk.length) { L.push(''); L.push('Unknown protobuf fields (written by a newer ProPresenter than our schema):'); for (const [k, v] of unk) L.push(`  ${String(v).padStart(5)}  ${k}`) }
  if (r.media.missing.length) { L.push(''); L.push(`Missing media (${r.media.missing.length}):`); for (const m of r.media.missing.slice(0, 500)) L.push(`  - ${m}`) }
  const problems = r.files.filter((f) => f.status === 'failed' || f.status === 'partial' || f.status === 'skipped' || f.warnings.length)
  if (problems.length) {
    L.push(''); L.push('Per-file details:')
    for (const f of problems) {
      L.push(`  [${f.status}] ${f.rel ?? f.path}${f.title ? ` — "${f.title}"` : ''}`)
      if (f.error) L.push(`      error: ${f.error}`)
      for (const w of f.warnings.slice(0, 12)) L.push(`      ! ${w}`)
      if (f.missingMedia?.length) L.push(`      missing media: ${f.missingMedia.slice(0, 8).join(', ')}${f.missingMedia.length > 8 ? '…' : ''}`)
    }
  }
  for (const p of r.playlists.filter((x) => x.unresolved.length)) L.push(`  playlist "${p.name}": not found → ${p.unresolved.join(', ')}`)
  return L.join('\n') + '\n'
}

export function scanToText(s: ImportScan): string {
  const L: string[] = []
  L.push(`ProPresenter folder: ${s.root}`)
  L.push(`Detected workspace generation: ${s.generation}`)
  for (const a of s.advice) L.push(`  ${a}`)
  if (s.workspaces.length > 1) { L.push('Workspaces:'); for (const w of s.workspaces) L.push(`  - ${w.name}`) }
  const c = s.counts
  L.push(`Presentations: ${c.presentations}  Playlists: ${c.playlists}  Themes: ${c.themes}  Config files: ${c.configs}  Media: ${c.media}  ProPresenter 4-6: ${c.legacy}  Other: ${c.other}`)
  if (s.libraries.length) L.push(`Libraries: ${s.libraries.map((l) => `${l.name} (${l.count})`).join(', ')}`)
  L.push(`File-type census (${plural(s.scannedFiles, 'file')}${s.truncated ? ', truncated' : ''}, ${s.durationMs} ms):`)
  for (const e of s.census.slice(0, 40)) L.push(`  ${e.ext.padEnd(14)} ${String(e.count).padStart(7)}  ${(e.bytes / 1e6).toFixed(1).padStart(9)} MB   e.g. ${e.examples.join(', ')}`)
  if (s.databases.length) { L.push('Database-like files:'); for (const d of s.databases) L.push(`  - ${d.path} [${d.kind}, ${(d.size / 1e6).toFixed(1)} MB] ${d.detail ?? ''}`) }
  return L.join('\n') + '\n'
}
