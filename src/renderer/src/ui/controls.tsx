import { forwardRef, useId, useState, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Icon, type IconName } from './icons'
import { Logo } from './Logo'
import { Tooltip } from './overlays'

type Variant = 'default' | 'primary' | 'live' | 'danger' | 'ghost'
type Size = 'sm' | 'md' | 'lg'
const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ')

/* ───────────── buttons ───────────── */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** Toggle-style "pressed" look (Lakeside). */
  active?: boolean
  /** Leading icon from the Reach icon set. */
  icon?: IconName
  /** Full width. */
  block?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'default', size, active, icon, block, className = '', children, type = 'button', ...p }, ref) {
  return (
    <button ref={ref} type={type} {...p} aria-pressed={active === undefined ? p['aria-pressed'] : active}
      className={cx('btn', variant !== 'default' && variant, size && size !== 'md' && size, active && 'active', block && 'block', className)}>
      {icon && <Icon name={icon} size={size === 'lg' ? 18 : size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  )
})

/** A square button with only an icon. `label` is required: it is the tooltip and the screen-reader name. */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'children' | 'icon'> & { icon: IconName; label: string; shortcut?: string; tooltip?: boolean }>(
  function IconButton({ icon, label, shortcut, tooltip = true, variant = 'ghost', size, active, className = '', type = 'button', ...p }, ref) {
    const btn = (
      <button ref={ref} type={type} {...p} aria-label={label} aria-pressed={active}
        className={cx('btn icon-only', variant !== 'default' && variant, size && size !== 'md' && size, active && 'active', className)}>
        <Icon name={icon} size={size === 'lg' ? 20 : size === 'sm' ? 14 : 16} />
      </button>
    )
    return tooltip ? <Tooltip label={label} shortcut={shortcut}>{btn}</Tooltip> : btn
  }
)

/* ───────────── form ───────────── */

/**
 * Label + control (+ hint / error). `inline` puts the control on the right of the label — use it
 * for toggles and short selects in settings rows.
 */
export function Field({ label, children, hint, error, inline, className = '', style }: { label: ReactNode; children: ReactNode; hint?: ReactNode; error?: ReactNode; inline?: boolean; className?: string; style?: CSSProperties }): ReactNode {
  if (inline) {
    return (
      <label className={cx('field inline', className)} style={style}>
        <span className="field-text">
          <span className="field-label" style={{ color: 'var(--text)', fontSize: 13 }}>{label}</span>
          {hint && <span className="field-hint">{hint}</span>}
          {error && <span className="field-error" role="alert">{error}</span>}
        </span>
        {children}
      </label>
    )
  }
  return (
    <label className={cx('field', className)} style={style}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error" role="alert">{error}</span>}
    </label>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = '', ...p }, ref) {
  return <input ref={ref} {...p} className={`input ${className}`} />
})
export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className = '', ...p }, ref) {
  return <textarea ref={ref} {...p} className={`textarea ${className}`} />
})
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className = '', ...p }, ref) {
  return <select ref={ref} {...p} className={`select ${className}`} />
})

/** Text input with a search glyph and a clear button. `onValue` gives you the string directly. */
export const SearchInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'value'> & { value: string; onValue?: (v: string) => void }>(
  function SearchInput({ value, onValue, onChange, className = '', style, placeholder = 'Search', ...p }, ref) {
    return (
      <div className={`search ${className}`} style={style}>
        <Icon name="search" size={14} />
        <input ref={ref} type="text" className="input" value={value} placeholder={placeholder} spellCheck={false} {...p}
          onChange={(e) => { onChange?.(e); onValue?.(e.target.value) }}
          onKeyDown={(e) => { p.onKeyDown?.(e); if (e.key === 'Escape' && value) { e.stopPropagation(); onValue?.('') } }} />
        {value && <button type="button" className="search-clear" aria-label="Clear search" tabIndex={-1} onClick={() => onValue?.('')}><Icon name="close" size={12} /></button>}
      </div>
    )
  }
)

const clamp = (n: number, min?: number, max?: number): number => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))

/** Numeric field with steppers. Always calls onChange with a valid, clamped number. */
export function NumberInput({ value, onChange, min, max, step = 1, suffix, disabled, style, className = '', 'aria-label': ariaLabel }: {
  value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string; disabled?: boolean; style?: CSSProperties; className?: string; 'aria-label'?: string
}): ReactNode {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (raw: string): void => {
    const n = Number(raw)
    if (raw.trim() !== '' && Number.isFinite(n)) onChange(clamp(n, min, max))
    setDraft(null)
  }
  const bump = (d: number): void => onChange(clamp(Math.round((value + d) / step) * step, min, max))
  return (
    <span className={`number ${className}`} style={style}>
      <input type="text" inputMode="decimal" aria-label={ariaLabel} disabled={disabled} value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)} onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
          if (e.key === 'ArrowUp') { e.preventDefault(); bump(e.shiftKey ? step * 10 : step) }
          if (e.key === 'ArrowDown') { e.preventDefault(); bump(e.shiftKey ? -step * 10 : -step) }
        }} />
      {suffix && <span className="number-suffix">{suffix}</span>}
      <button type="button" tabIndex={-1} aria-label="Decrease" disabled={disabled} onClick={() => bump(-step)}><Icon name="minus" size={11} /></button>
      <button type="button" tabIndex={-1} aria-label="Increase" disabled={disabled} onClick={() => bump(step)}><Icon name="plus" size={11} /></button>
    </span>
  )
}

export function Slider({ value, onChange, min = 0, max = 100, step = 1, showValue, format, disabled, style, className = '', 'aria-label': ariaLabel }: {
  value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; showValue?: boolean; format?: (n: number) => string; disabled?: boolean; style?: CSSProperties; className?: string; 'aria-label'?: string
}): ReactNode {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
  return (
    <span className={`slider ${className}`} style={style}>
      <input type="range" aria-label={ariaLabel} min={min} max={max} step={step} value={value} disabled={disabled}
        style={{ ['--fill' as string]: `${pct}%` }} onChange={(e) => onChange(Number(e.target.value))} />
      {showValue && <span className="slider-value">{format ? format(value) : value}</span>}
    </span>
  )
}

/** On/off switch. Pass `label` for a clickable caption, or wrap it in <Field inline>. */
export function Toggle({ checked, onChange, label, disabled, className = '', ...rest }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; className?: string; 'aria-label'?: string; 'data-testid'?: string }): ReactNode {
  const input = (
    <>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={rest['aria-label']} data-testid={rest['data-testid']} />
      <span className="toggle-track" />
    </>
  )
  // Inside a <Field inline> the Field is already the <label>.
  return label ? <label className={`toggle ${className}`}>{input}<span>{label}</span></label> : <span className={`toggle ${className}`}>{input}</span>
}

export const BRAND_SWATCHES = ['#F4F2EB', '#FFFFFF', '#292929', '#3886CE', '#E6A20F', '#000000']

/** Colour well + hex field + optional quick swatches (defaults to the Reach palette). */
export function ColorInput({ value, onChange, swatches = BRAND_SWATCHES, disabled, 'aria-label': ariaLabel }: { value: string; onChange: (hex: string) => void; swatches?: string[] | false; disabled?: boolean; 'aria-label'?: string }): ReactNode {
  const [draft, setDraft] = useState<string | null>(null)
  const hex6 = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'
  const commit = (raw: string): void => {
    const v = raw.trim().startsWith('#') ? raw.trim() : `#${raw.trim()}`
    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) onChange(v)
    setDraft(null)
  }
  return (
    <span className="color">
      <input type="color" aria-label={ariaLabel ?? 'Pick colour'} value={hex6} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      <input type="text" aria-label="Hex colour" value={draft ?? value} disabled={disabled} spellCheck={false}
        onChange={(e) => setDraft(e.target.value)} onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value) }} />
      {swatches && (
        <span className="color-swatches">
          {swatches.map((s) => <button key={s} type="button" tabIndex={-1} aria-label={`Use ${s}`} style={{ background: s }} disabled={disabled} onClick={() => onChange(s)} />)}
        </span>
      )}
    </span>
  )
}

/* ───────────── choosing ───────────── */

export interface TabDef<T extends string = string> { id: T; label: ReactNode; icon?: IconName; badge?: ReactNode }

export function Tabs<T extends string>({ tabs, value, onChange, className = '', style }: { tabs: TabDef<T>[]; value: T; onChange: (id: T) => void; className?: string; style?: CSSProperties }): ReactNode {
  return (
    <div className={`tabs ${className}`} role="tablist" style={style}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
        const i = tabs.findIndex((t) => t.id === value)
        const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]
        if (n) { e.preventDefault(); e.stopPropagation(); onChange(n.id) }
      }}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1} className={cx('tab', t.id === value && 'on')} onClick={() => onChange(t.id)}>
          {t.icon && <Icon name={t.icon} size={14} />}
          {t.label}
          {t.badge != null && <span className="badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  )
}

export function SegmentedControl<T extends string | number>({ options, value, onChange, size, 'aria-label': ariaLabel, className = '' }: {
  options: { value: T; label: ReactNode; icon?: IconName; title?: string }[]; value: T; onChange: (v: T) => void; size?: 'sm'; 'aria-label'?: string; className?: string
}): ReactNode {
  return (
    <div className={cx('segmented', size, className)} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} title={o.title} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={14} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ───────────── surfaces ───────────── */

/**
 * A titled card. Pass `collapsible` (and a stable `id` to remember the state per computer)
 * for panels the operator may want out of the way.
 */
export function Panel({ title, actions, children, className = '', style, collapsible, defaultCollapsed, id, 'data-testid': testId }: {
  title?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; style?: CSSProperties
  collapsible?: boolean; defaultCollapsed?: boolean; id?: string; 'data-testid'?: string
}): ReactNode {
  const key = id ? `reach.panel.${id}` : null
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (!collapsible) return false
    try { const v = key && localStorage.getItem(key); if (v != null) return v === '1' } catch { /* private mode */ }
    return !!defaultCollapsed
  })
  const toggle = (): void => {
    setCollapsed((c) => { try { if (key) localStorage.setItem(key, c ? '0' : '1') } catch { /* ignore */ } return !c })
  }
  const bodyId = useId()
  return (
    <section className={cx('panel', collapsed && 'collapsed', className)} style={style} data-testid={testId}>
      {(title || actions) && (
        <header className="row" style={{ justifyContent: 'space-between' }}>
          <div className="panel-title grow">
            {collapsible
              ? <button type="button" className="panel-toggle" aria-expanded={!collapsed} aria-controls={bodyId} onClick={toggle}><Icon name="chevronDown" size={12} />{title}</button>
              : title}
          </div>
          <div className="row" style={{ gap: 4 }}>{actions}</div>
        </header>
      )}
      {!collapsed && (collapsible ? <div id={bodyId}>{children}</div> : children)}
    </section>
  )
}

export function List({ children, className = '', style, ...rest }: { children: ReactNode; className?: string; style?: CSSProperties; 'aria-label'?: string }): ReactNode {
  return <div role="list" className={`list ${className}`} style={style} {...rest}>{children}</div>
}

/** One row: [leading] title / subtitle [trailing]. `selected` = Lakeside, `live` = Mustard marker. */
export function ListItem({ title, subtitle, leading, trailing, selected, live, disabled, onClick, onDoubleClick, onContextMenu, className = '', children, ...rest }: {
  title?: ReactNode; subtitle?: ReactNode; leading?: ReactNode; trailing?: ReactNode; selected?: boolean; live?: boolean; disabled?: boolean
  onClick?: (e: React.MouseEvent) => void; onDoubleClick?: (e: React.MouseEvent) => void; onContextMenu?: (e: React.MouseEvent) => void; className?: string; children?: ReactNode; 'data-testid'?: string
}): ReactNode {
  return (
    <div role="listitem" tabIndex={disabled ? -1 : 0} aria-current={selected || undefined} data-testid={rest['data-testid']}
      className={cx('list-item', selected && 'on', live && 'is-live', disabled && 'disabled', className)}
      onClick={disabled ? undefined : onClick} onDoubleClick={disabled ? undefined : onDoubleClick} onContextMenu={onContextMenu}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter') && !disabled) { e.preventDefault(); onClick?.(e as unknown as React.MouseEvent) } }}>
      {leading != null && <span className="list-lead">{leading}</span>}
      <span className="list-main">
        {title != null && <span className="list-title">{title}</span>}
        {subtitle != null && <span className="list-sub">{subtitle}</span>}
        {children}
      </span>
      {trailing != null && <span className="list-trail">{trailing}</span>}
    </div>
  )
}

export function Badge({ tone = 'default', children, className = '', title }: { tone?: 'default' | 'live' | 'accent' | 'ok' | 'warn' | 'danger' | 'outline'; children: ReactNode; className?: string; title?: string }): ReactNode {
  return <span className={cx('badge', tone !== 'default' && tone, className)} title={title}>{children}</span>
}

/** Status dot. `live` (Mustard) is reserved for "on screen now". */
export function Dot({ tone = 'default' }: { tone?: 'default' | 'live' | 'ok' | 'warn' | 'danger' | 'accent' }): ReactNode {
  return <span className={cx('dot', tone !== 'default' && tone)} />
}

/** Keyboard key. <Kbd>Space</Kbd> or <Kbd keys="mod+K" /> ("mod" renders ⌘ on Mac, Ctrl elsewhere). */
export function Kbd({ children, keys }: { children?: ReactNode; keys?: string }): ReactNode {
  if (!keys) return <kbd className="kbd">{children}</kbd>
  return <span className="kbd-group">{formatKeys(keys).map((k, i) => <kbd key={i} className="kbd">{k}</kbd>)}</span>
}

export const isMac = (): boolean => (typeof window !== 'undefined' && (window as { reachBridge?: { platform?: string } }).reachBridge?.platform === 'darwin') || (typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform))
const KEY_GLYPHS: Record<string, string> = { left: '←', right: '→', up: '↑', down: '↓', enter: '↵', esc: 'Esc', space: 'Space', shift: '⇧', backspace: '⌫', tab: 'Tab' }
export function formatKeys(keys: string): string[] {
  return keys.split('+').map((k) => {
    const l = k.trim().toLowerCase()
    if (l === 'mod') return isMac() ? '⌘' : 'Ctrl'
    if (l === 'alt') return isMac() ? '⌥' : 'Alt'
    return KEY_GLYPHS[l] ?? (k.length === 1 ? k.toUpperCase() : k)
  })
}

export function Spinner({ size = 16, label = 'Loading' }: { size?: number; label?: string }): ReactNode {
  return <span className="spinner" role="status" aria-label={label} style={{ width: size, height: size }} />
}

/**
 * Friendly "nothing here yet" state. `logo` shows a quiet Window R above the title — use it for
 * a screen's main empty state only, not inside small panels.
 */
export function Empty({ title, children, icon, logo, action, className = '' }: { title: string; children?: ReactNode; icon?: IconName; logo?: boolean; action?: ReactNode; className?: string }): ReactNode {
  return (
    <div className={`empty ${className}`}>
      <div className="empty-inner">
        {logo ? <Logo variant="icon" height={44} className="empty-mark" /> : icon ? <Icon name={icon} size={30} className="empty-mark" /> : null}
        <div className="empty-title">{title}</div>
        {children && <div className="empty-body">{children}</div>}
        {action && <div className="empty-actions">{action}</div>}
      </div>
    </div>
  )
}
