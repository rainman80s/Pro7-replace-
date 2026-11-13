import type { ReactNode } from 'react'
import type { Output } from '@shared/model'
import { KEYING_LABELS, deckLinkModeLabel, sortDeckLinkModes, type DeckLinkAlign, type DeckLinkKeying } from '@shared/decklink'
import { resolveOutputs } from '@shared/outputs'
import { Field, Select } from '@ui/index'
import { useApp } from '../../app/store'
import { saveOutput, useCanvases, useDisplays } from './state'

type DeckLinkTarget = Extract<Output['target'], { type: 'decklink' }>

/** SDI port settings for one DeckLink output: port, video mode, keying, where a smaller picture sits. */
export function DeckLinkSettings({ output }: { output: Output & { target: DeckLinkTarget } }): ReactNode {
  const { ports } = useDisplays()
  const outputs = useApp((s) => s.outputs)
  const canvases = useCanvases()
  const t = output.target
  const port = ports.find((p) => p.key === t.device)
  const modes = sortDeckLinkModes(port?.modes ?? [])
  const mode = modes.find((m) => m.id === t.mode)
  const keying = t.keying ?? 'none'
  const setTarget = (patch: Partial<DeckLinkTarget>): void => void saveOutput({ ...output, target: { ...t, ...patch } })
  const taken = new Set(outputs.filter((o) => o.id !== output.id && o.target.type === 'decklink').map((o) => (o.target as DeckLinkTarget).device))
  const crop = resolveOutputs(outputs, canvases).get(output.id)?.crop
  const fitsInside = !!(crop && mode && crop.w <= mode.width && crop.h <= mode.height)

  return (
    <div className="dsp-section" data-decklink-settings>
      <div className="dsp-sub">SDI</div>
      <div className="dsp-form">
        <Field label="SDI port">
          <Select value={t.device} onChange={(e) => setTarget({ device: e.target.value })} aria-label="SDI port" data-decklink-port>
            {!port && <option value={t.device}>{t.device} (not connected)</option>}
            {ports.map((p) => <option key={p.key} value={p.key} disabled={taken.has(p.key)}>{p.key}{p.connected ? '' : ' (not connected)'}{taken.has(p.key) ? ' — in use' : ''}</option>)}
          </Select>
        </Field>
        <Field label="Video format" hint="Must match what the LED processor, switcher or monitor expects (e.g. 1080p29.97).">
          <Select value={t.mode} onChange={(e) => setTarget({ mode: e.target.value })} aria-label="Video format" data-decklink-mode>
            {!mode && <option value={t.mode}>{t.mode}</option>}
            {modes.map((m) => <option key={m.id} value={m.id}>{deckLinkModeLabel(m)}{m.width !== 1920 || m.height !== 1080 ? ` (${m.width}×${m.height})` : ''}</option>)}
          </Select>
        </Field>
        <Field label="Keying" hint={keying === 'external' ? 'Sends the picture (fill) on this port and its shape (key) on the paired port, for the video switcher’s keyer. The background is transparent.' : undefined}>
          <Select value={keying} onChange={(e) => setTarget({ keying: e.target.value as DeckLinkKeying })} aria-label="Keying" data-decklink-keying>
            {(Object.keys(KEYING_LABELS) as DeckLinkKeying[]).map((k) => (
              <option key={k} value={k} disabled={k !== 'none' && !!port && (k === 'external' ? port.externalKeying === false : port.internalKeying === false)}>{KEYING_LABELS[k]}</option>
            ))}
          </Select>
        </Field>
        {keying !== 'none' && (
          <Field label={`Key strength ${Math.round(((t.keyLevel ?? 255) / 255) * 100)}%`}>
            <input type="range" min={0} max={255} step={1} value={t.keyLevel ?? 255} onChange={(e) => setTarget({ keyLevel: Number(e.target.value) })} aria-label="Key strength" />
          </Field>
        )}
        <Field label="Position" hint={fitsInside && crop && mode && (crop.w !== mode.width || crop.h !== mode.height) ? `The ${crop.w}×${crop.h} picture sits inside the ${mode.width}×${mode.height} SDI frame pixel for pixel; the rest is black.` : 'Pictures bigger than the SDI frame are scaled down to fit.'}>
          <Select value={output.decklinkAlign ?? 'top-left'} onChange={(e) => void saveOutput({ ...output, decklinkAlign: e.target.value as DeckLinkAlign })} aria-label="Position in the SDI frame">
            <option value="top-left">Top-left (what LED processors expect)</option>
            <option value="center">Centred</option>
          </Select>
        </Field>
      </div>
    </div>
  )
}
