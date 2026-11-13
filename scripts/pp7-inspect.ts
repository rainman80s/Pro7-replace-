/**
 * ProPresenter → Reach diagnostic CLI (no GUI, writes nothing unless --write is given).
 *
 *   npx tsx scripts/pp7-inspect.ts <file-or-folder> [options]
 *
 *   folder   scan a ProPresenter folder (e.g. ~/Documents/ProPresenter): detected workspace generation
 *            (loose .pro files vs v22 database), file-type census, database probe, then a DRY-RUN import
 *            of everything with the per-file report (what could not be mapped, unknown protobuf fields,
 *            missing media).
 *   file     .pro / .proBundle / .proPlaylist / .pro6 / ChordPro / OpenLyrics / SongSelect …: what it
 *            converts to, slide by slide.
 *
 * Options
 *   --json             print machine-readable JSON instead of text
 *   --out <path>       also save the full JSON report to <path> (send this file back to the Reach team)
 *   --slides           (file mode) print every slide's text
 *   --raw              (file mode, .pro) dump the decoded protobuf as JSON
 *   --write <dir>      really import into the Reach workspace folder <dir> (default: dry run)
 *   --no-db            don't probe database files
 */
import { promises as fs } from 'node:fs'
import { basename, resolve } from 'node:path'
import { scanFolder } from '../src/main/services/importers/pipeline/scan'
import { runImport, itemsForFiles } from '../src/main/services/importers/pipeline/run'
import { DryRunTarget, FolderTarget } from '../src/main/services/importers/pipeline/target'
import { reportToText, scanToText } from '../src/main/services/importers/pipeline/report'
import { convertBytes } from '../src/main/services/importers/pipeline/convert'
import { detectFormat } from '../src/main/services/importers/pipeline/detect'
import { decodePP7, PP7_PROTO_VERSION } from '../src/main/services/importers/pp7/proto'
import { jsonSafe } from '../src/main/services/importers/pp7/context'
import type { TextElement } from '../src/shared/model'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const flag = (n: string): boolean => args.includes(n)
  const opt = (n: string): string | undefined => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
  const target = args.find((a, i) => !a.startsWith('--') && !['--out', '--write'].includes(args[i - 1] ?? ''))
  if (!target || flag('--help') || flag('-h')) {
    console.log((await fs.readFile(__filename, 'utf8')).split('*/')[0].replace(/^\/\*\*?|^ \* ?/gm, ''))
    process.exit(target ? 0 : 1)
  }
  const path = resolve(target)
  const st = await fs.stat(path).catch(() => null)
  if (!st) { console.error(`Not found: ${path}`); process.exit(1) }
  const json = flag('--json')
  const out = opt('--out')
  const write = opt('--write')
  const header = `Reach pp7-inspect — schema ${PP7_PROTO_VERSION} — node ${process.version} — ${process.platform}`

  if (st.isDirectory()) {
    const scan = await scanFolder(path, { probeDatabases: !flag('--no-db') })
    const t = write ? new FolderTarget(resolve(write)) : new DryRunTarget()
    let last = 0
    const report = await runImport(scan, t, { dryRun: !write }, {
      onProgress: (p) => { if (!json && process.stderr.isTTY && Date.now() - last > 250) { last = Date.now(); process.stderr.write(`\r${p.phase} ${p.done}/${p.total} ${(p.current ?? '').slice(-60).padEnd(60)}`) } }
    })
    if (!json && process.stderr.isTTY) process.stderr.write('\r'.padEnd(90) + '\r')
    const payload = { tool: header, scan: { ...scan, items: scan.items.length }, report }
    if (out) await fs.writeFile(out, JSON.stringify({ tool: header, scan, report }, null, 2))
    if (json) console.log(JSON.stringify(payload, null, 2))
    else {
      console.log(header)
      console.log(scanToText(scan))
      console.log(reportToText(report))
      if (out) console.log(`Full JSON report written to ${out}`)
    }
    return
  }

  // single file
  const bytes = await fs.readFile(path)
  const format = detectFormat(path, bytes)
  if (flag('--raw') && format === 'pp7-presentation') { console.log(JSON.stringify(jsonSafe(decodePP7('rv.data.Presentation', bytes)), null, 1)); return }
  if (write) {
    const report = await runImport({ root: path, items: itemsForFiles([path]) }, new FolderTarget(resolve(write)), {})
    console.log(json ? JSON.stringify(report, null, 2) : reportToText(report))
    return
  }
  let conv
  try { conv = convertBytes(path, bytes, { format }) } catch (e) { console.error(`${basename(path)}: ${format}: ${(e as Error).message}`); process.exit(2) }
  if (out) await fs.writeFile(out, JSON.stringify({ tool: header, format, conv: { ...conv, bundleMedia: conv.bundleMedia.map((m) => ({ path: m.path, bytes: m.data.length })) } }, null, 2))
  if (json) { console.log(JSON.stringify({ format, docs: conv.docs.map((d) => ({ ...d, media: d.media.map((m) => m.url) })), bundleMedia: conv.bundleMedia.map((m) => m.path), playlists: conv.playlistDocs.length, warnings: conv.warnings }, null, 2)); return }
  console.log(header)
  console.log(`${basename(path)}: ${format}${conv.warnings.length ? `\n  ! ${conv.warnings.join('\n  ! ')}` : ''}`)
  if (conv.bundleMedia.length) console.log(`  archive media: ${conv.bundleMedia.map((m) => m.path).join(', ')}`)
  if (conv.playlistDocs.length) console.log(`  playlist documents: ${conv.playlistDocs.length}`)
  for (const d of conv.docs) {
    const p = d.presentation
    console.log(`\n"${p.title}" — ${p.kind}, ${p.size.width}×${p.size.height}, ${p.slides.length} slides, ${p.groups.length} groups, ${p.arrangements.length} arrangements${d.entry ? ` (${d.entry})` : ''}`)
    console.log(`  stats: ${JSON.stringify(d.stats)}`)
    const m = p.meta
    const metaLine = ['author', 'artist', 'copyright', 'ccliNumber', 'category', 'key'].filter((k) => m[k]).map((k) => `${k}=${String(m[k])}`).join('  ')
    if (metaLine) console.log(`  meta: ${metaLine}`)
    if (p.groups.length) console.log(`  groups: ${p.groups.map((g) => `${g.name || '(unnamed)'}[${g.slideIds.length}]${g.color ? ` ${g.color}` : ''}`).join(', ')}`)
    for (const a of p.arrangements) console.log(`  arrangement "${a.name}": ${a.groupIds.map((id) => p.groups.find((g) => g.id === id)?.name ?? '?').join(' → ')}`)
    if (d.media.length) console.log(`  media refs: ${d.media.map((r) => `${r.url.basename} (${r.url.root ?? 'abs'})`).join(', ')}`)
    if (Object.keys(d.unmapped).length) console.log(`  not reproduced: ${Object.entries(d.unmapped).map(([k, v]) => `${k}×${v}`).join(', ')}`)
    if (Object.keys(d.unknownFields ?? {}).length) console.log(`  UNKNOWN protobuf fields (newer ProPresenter?): ${Object.entries(d.unknownFields!).map(([k, v]) => `${k}×${v}`).join(', ')}`)
    for (const w of d.warnings) console.log(`  ! ${w}`)
    const unmappedActions = (p.meta.source as { unmapped?: { type: string }[] } | undefined)?.unmapped
    if (unmappedActions?.length) console.log(`  unmapped cue actions: ${unmappedActions.map((u) => u.type).join(', ')}`)
    if (flag('--slides') || p.slides.length <= 12) {
      for (const [i, s] of p.slides.entries()) {
        const g = p.groups.find((x) => x.slideIds.includes(s.id))
        const texts = s.elements.filter((e): e is TextElement => e.type === 'text').map((t) => `${t.role ?? 'text'}${t.dynamic ? '*' : ''}: ${t.paragraphs.map((q) => q.runs.map((r) => r.text).join('')).join(' / ')}`)
        const other = s.elements.filter((e) => e.type !== 'text').map((e) => e.type)
        console.log(`  ${String(i + 1).padStart(3)}. [${g?.name ?? '-'}]${s.label ? ` "${s.label}"` : ''}${s.enabled === false ? ' (disabled)' : ''}${s.hotKey ? ` key=${s.hotKey}` : ''} ${texts.join(' | ')}${other.length ? `  +${other.join(',')}` : ''}${s.actions?.length ? `  actions: ${s.actions.map((a) => a.type).join(', ')}` : ''}`)
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
