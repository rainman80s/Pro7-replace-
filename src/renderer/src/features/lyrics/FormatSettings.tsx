import type { ReactNode } from 'react'
import type { LyricFormatSettings } from '@shared/lyric-format'
import { Select, Toggle } from '@ui/index'
import { Num } from '../editor/controls'

/** The "Format song" options, shared by the editor popover and the Settings section. */
export function FormatSettingsForm({ value, onChange }: { value: LyricFormatSettings; onChange: (v: LyricFormatSettings) => void }): ReactNode {
  const set = (patch: Partial<LyricFormatSettings>): void => onChange({ ...value, ...patch })
  return (
    <div className="col" style={{ gap: 8 }} data-testid="format-settings">
      <label className="row" style={{ gap: 8 }}><span className="grow">Lines per slide</span><Num value={value.linesPerSlide} min={1} max={8} width={54} testid="fmt-lines" onChange={(v) => set({ linesPerSlide: Math.round(v) })} /></label>
      <label className="row" style={{ gap: 8 }}><span className="grow">Max characters per line</span><Num value={value.maxLineChars} min={15} max={120} width={54} testid="fmt-chars" onChange={(v) => set({ maxLineChars: Math.round(v) })} /></label>
      <Toggle checked={value.mergeShortLines} onChange={(v) => set({ mergeShortLines: v })} label="Join lines that were broken mid-phrase" />
      <Toggle checked={value.keepSections} onChange={(v) => set({ keepSections: v })} label="Keep sections (Verse, Chorus…)" />
      <Toggle checked={value.stripTrailingPunctuation} onChange={(v) => set({ stripTrailingPunctuation: v })} label="Remove trailing punctuation (, ; : .)" />
      <label className="row" style={{ gap: 8 }}>
        <span className="grow">Capitals</span>
        <Select value={value.caseMode} onChange={(e) => set({ caseMode: e.target.value as LyricFormatSettings['caseMode'] })}>
          <option value="keep">Keep as typed</option>
          <option value="sentence">Fix ALL CAPS / Title Case</option>
        </Select>
      </label>
      <Toggle checked={value.correct} onChange={(v) => set({ correct: v })} label="Correct lyrics (God/Lord capitals, typos, curly quotes)" data-testid="fmt-correct" />
    </div>
  )
}
