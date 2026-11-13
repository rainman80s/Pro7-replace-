/** Small inspector controls (numbers, colours, fills, segmented buttons). */
import { useEffect, useState, type ReactNode } from 'react'
import type { Fill, MediaRef } from '@shared/model'
import { mediaUrl } from '@shared/media'
import { Button, Input, Select } from '@ui/index'
import { pickMedia } from './media-pick'

export function Num({ value, onChange, min, max, step = 1, suffix, title, width = 64, testid }: { value: number | undefined; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string; title?: string; width?: number; testid?: string }): ReactNode {
  const [text, setText] = useState(value === undefined ? '' : String(round(value)))
  useEffect(() => setText(value === undefined ? '' : String(round(value))), [value])
  const commit = (s: string): void => {
    const n = Number(s)
    if (s.trim() === '' || !isFinite(n)) return setText(value === undefined ? '' : String(round(value)))
    onChange(clamp(n, min, max))
  }
  return (
    <label className="ed-num" title={title} style={{ width }}>
      {title && <span className="ed-num-label">{title.length <= 2 ? title : ''}</span>}
      <input
        className="input" data-testid={testid} type="text" inputMode="decimal" value={text}
        onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const k = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)
            onChange(clamp(round((value ?? 0) + k), min, max))
          }
        }}
      />
      {suffix && <span className="ed-num-suffix">{suffix}</span>}
    </label>
  )
}
const round = (n: number): number => Math.round(n * 100) / 100
const clamp = (n: number, min?: number, max?: number): number => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))

/** Hex/rgba colour with a swatch picker and an alpha slider. */
export function Color({ value, onChange, testid }: { value: string | undefined; onChange: (v: string) => void; testid?: string }): ReactNode {
  const { hex, alpha } = parseColor(value ?? '#ffffff')
  return (
    <div className="ed-color">
      <input type="color" value={hex} data-testid={testid} onChange={(e) => onChange(toColor(e.target.value, alpha))} />
      <input className="input" value={value ?? ''} placeholder="#FFFFFF" onChange={(e) => onChange(e.target.value)} style={{ width: 92 }} />
      <input type="range" min={0} max={1} step={0.05} value={alpha} title={`Opacity ${Math.round(alpha * 100)}%`} onChange={(e) => onChange(toColor(hex, Number(e.target.value)))} style={{ width: 56 }} />
    </div>
  )
}
export function parseColor(c: string): { hex: string; alpha: number } {
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(c.trim())
  if (m) return { hex: '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join(''), alpha: m[4] === undefined ? 1 : Number(m[4]) }
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c.trim())
  if (h) {
    let s = h[1]
    if (s.length === 3) s = s.split('').map((x) => x + x).join('')
    return { hex: '#' + s.slice(0, 6).toLowerCase(), alpha: s.length === 8 ? parseInt(s.slice(6), 16) / 255 : 1 }
  }
  return { hex: '#ffffff', alpha: 1 }
}
export function toColor(hex: string, alpha: number): string {
  if (alpha >= 1) return hex.toUpperCase()
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(alpha * 100) / 100})`
}

export function Seg<T extends string>({ value, options, onChange }: { value: T | undefined; options: { v: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void }): ReactNode {
  return (
    <div className="ed-seg">
      {options.map((o) => (
        <button key={o.v} type="button" className={value === o.v ? 'on' : ''} title={o.title} onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="ed-row">
      <span className="ed-row-label">{label}</span>
      <div className="ed-row-body">{children}</div>
    </div>
  )
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }): ReactNode {
  return (
    <section className="ed-section">
      <header><span>{title}</span>{actions}</header>
      {children}
    </section>
  )
}

/** Fill editor: none / colour / gradient / media. */
export function FillEditor({ fill, onChange, allowNone = true }: { fill: Fill | undefined; onChange: (f: Fill | undefined) => void; allowNone?: boolean }): ReactNode {
  const type = fill?.type ?? 'none'
  const set = (t: string): void => {
    if (t === 'none') return onChange(undefined)
    if (t === 'color') return onChange({ type: 'color', color: fill?.type === 'gradient' ? fill.stops[0].color : '#3886CE' })
    if (t === 'gradient') {
      const c = fill?.type === 'color' ? fill.color : '#292929'
      return onChange({ type: 'gradient', angle: 180, stops: [{ color: c, at: 0 }, { color: '#000000', at: 1 }] })
    }
    void pickMedia(['image', 'video']).then((m) => { if (m) onChange({ type: 'media', media: m, fit: 'cover' }) })
  }
  return (
    <div className="col" style={{ gap: 6 }}>
      <Select value={type} onChange={(e) => set(e.target.value)} data-testid="fill-type">
        {allowNone && <option value="none">None</option>}
        <option value="color">Colour</option>
        <option value="gradient">Gradient</option>
        <option value="media">Image / video…</option>
      </Select>
      {fill?.type === 'color' && <Color value={fill.color} onChange={(color) => onChange({ type: 'color', color })} />}
      {fill?.type === 'gradient' && (
        <div className="col" style={{ gap: 4 }}>
          <div className="ed-grad-preview" style={{ background: `linear-gradient(90deg, ${[...fill.stops].sort((a, b) => a.at - b.at).map((s) => `${s.color} ${s.at * 100}%`).join(',')})` }} />
          {fill.stops.map((s, i) => (
            <div key={i} className="row" style={{ gap: 4 }}>
              <Color value={s.color} onChange={(color) => onChange({ ...fill, stops: fill.stops.map((x, j) => (j === i ? { ...x, color } : x)) })} />
              <Num value={Math.round(s.at * 100)} min={0} max={100} suffix="%" width={58} onChange={(v) => onChange({ ...fill, stops: fill.stops.map((x, j) => (j === i ? { ...x, at: v / 100 } : x)) })} />
              {fill.stops.length > 2 && <Button size="sm" variant="ghost" onClick={() => onChange({ ...fill, stops: fill.stops.filter((_, j) => j !== i) })}>×</Button>}
            </div>
          ))}
          <div className="row">
            <Num value={fill.angle} min={0} max={360} suffix="°" title="Angle" width={70} onChange={(angle) => onChange({ ...fill, angle })} />
            <Button size="sm" onClick={() => onChange({ ...fill, stops: [...fill.stops, { color: '#FFFFFF', at: 0.5 }] })}>+ Stop</Button>
          </div>
        </div>
      )}
      {fill?.type === 'media' && (
        <div className="col" style={{ gap: 4 }}>
          <MediaChip media={fill.media} onReplace={(m) => onChange({ ...fill, media: m })} />
          <Seg value={fill.fit ?? 'cover'} options={[{ v: 'cover', label: 'Fill' }, { v: 'contain', label: 'Fit' }, { v: 'stretch', label: 'Stretch' }]} onChange={(fit) => onChange({ ...fill, fit })} />
        </div>
      )}
    </div>
  )
}

export function MediaChip({ media, onReplace }: { media: MediaRef; onReplace: (m: MediaRef) => void }): ReactNode {
  return (
    <div className="ed-media-chip">
      {media.kind === 'image' ? <img src={mediaUrl(media)} alt="" /> : media.kind === 'video' ? <video src={`${mediaUrl(media)}#t=0.1`} muted preload="metadata" /> : <span />}
      <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{media.name ?? media.src.split('/').pop()}</span>
      <Button size="sm" onClick={() => void pickMedia([media.kind]).then((m) => m && onReplace(m))}>Replace…</Button>
    </div>
  )
}

export function TextInput({ value, onChange, placeholder, testid }: { value: string; onChange: (v: string) => void; placeholder?: string; testid?: string }): ReactNode {
  const [t, setT] = useState(value)
  useEffect(() => setT(value), [value])
  return <Input value={t} placeholder={placeholder} data-testid={testid} onChange={(e) => setT(e.target.value)} onBlur={() => t !== value && onChange(t)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
}
