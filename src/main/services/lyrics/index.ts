/**
 * Lyric formatting service.
 *   library.formatSong  { id, settings?, dryRun? }          format one song (layout + worship-lyric corrector)
 *   library.formatSongs { ids?, settings?, dryRun? }        bulk: preview (dryRun) then apply to the accepted ids
 *   lyrics.settings / lyrics.setSettings                    workspace doc `lyricFormat`
 * Other import paths (ProPresenter import, Planning Center, pasted lyrics) can call `autoCorrectImported(p)`.
 */
import type { ID, Presentation } from '@shared/model'
import {
  correctPresentation, formatPresentation, resolveLyricFormat, DEFAULT_LYRIC_FORMAT_DOC,
  type FlaggedLine, type FormatReport, type LyricFormatDoc, type LyricFormatSettings
} from '@shared/lyric-format'
import { library } from '../../core/library'
import { workspace } from '../../core/workspace'
import { defineService } from '../../core/service'

export interface FormatSongResult extends FormatReport {
  id: ID
  title: string
  /** True when the formatted song was written to the library (false for dry runs / no-ops). */
  applied: boolean
}

declare module '@shared/api' {
  interface ApiMethods {
    'library.formatSong': { req: { id: ID; settings?: Partial<LyricFormatSettings>; dryRun?: boolean }; res: FormatSongResult }
    'library.formatSongs': { req: { ids?: ID[]; settings?: Partial<LyricFormatSettings>; dryRun?: boolean }; res: { results: FormatSongResult[] } }
    'lyrics.settings': { req: void; res: LyricFormatDoc }
    'lyrics.setSettings': { req: Partial<LyricFormatDoc>; res: LyricFormatDoc }
  }
}

export async function lyricSettings(): Promise<LyricFormatDoc> {
  const doc = await workspace.readDoc<Partial<LyricFormatDoc> | null>('lyricFormat', null)
  return { format: resolveLyricFormat(doc), autoCorrectImported: doc?.autoCorrectImported ?? DEFAULT_LYRIC_FORMAT_DOC.autoCorrectImported }
}

/**
 * Hook for import paths: run the worship-lyric corrector over a song that just arrived (ProPresenter import,
 * Planning Center, pasted lyrics) if the "Auto-correct imported songs" setting is on. Returns the same object when
 * the setting is off or nothing needed fixing; the caller saves it.
 */
export async function autoCorrectImported(p: Presentation): Promise<Presentation> {
  const s = await lyricSettings()
  if (!s.autoCorrectImported || (p.kind && p.kind !== 'song')) return p
  return correctPresentation(p, s.format.corrector).presentation
}

async function formatOne(id: ID, override: Partial<LyricFormatSettings> | undefined, dryRun: boolean, base: LyricFormatSettings): Promise<FormatSongResult | null> {
  const p = library.get(id)
  if (!p) return null
  const r = formatPresentation(p, { ...base, ...override })
  let applied = false
  if (!dryRun && r.report.changed) { await library.save(r.presentation); applied = true }
  return { id, title: p.title, applied, ...r.report }
}

export type { FlaggedLine }

export default defineService({
  name: 'lyrics',
  setup(ctx) {
    ctx.api.handle('lyrics.settings', () => lyricSettings())
    ctx.api.handle('lyrics.setSettings', async (patch) => {
      const cur = await lyricSettings()
      const next: LyricFormatDoc = { format: { ...cur.format, ...(patch.format ?? {}) }, autoCorrectImported: patch.autoCorrectImported ?? cur.autoCorrectImported }
      await workspace.writeDoc('lyricFormat', next)
      return next
    }, 'local')
    ctx.api.handle('library.formatSong', async ({ id, settings, dryRun }) => {
      const r = await formatOne(id, settings, !!dryRun, (await lyricSettings()).format)
      if (!r) throw new Error('Song not found')
      return r
    })
    ctx.api.handle('library.formatSongs', async ({ ids, settings, dryRun }) => {
      const base = (await lyricSettings()).format
      const targets = ids ?? library.summaries().filter((s) => s.kind === 'song').map((s) => s.id)
      const results: FormatSongResult[] = []
      let n = 0
      for (const id of targets) {
        const r = await formatOne(id, settings, !!dryRun, base).catch(() => null)
        if (r) results.push(r)
        if (++n % 20 === 0) await new Promise((res) => setImmediate(res)) // keep the app responsive on big libraries
      }
      return { results: dryRun ? results.filter((r) => r.changed) : results }
    })
  }
})
