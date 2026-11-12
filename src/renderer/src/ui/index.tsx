/**
 * Reach UI kit — the small set of primitives every feature uses, so the whole app
 * looks and behaves consistently. Features should use these (and the CSS variables
 * in tokens.css) rather than inventing their own buttons/inputs/modals.
 */
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { create } from 'zustand'
import './fonts.css'
import './tokens.css'
import './ui.css'

type Variant = 'default' | 'primary' | 'live' | 'danger' | 'ghost'

export function Button({ variant = 'default', size, active, className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm'; active?: boolean }): ReactNode {
  return <button {...p} className={`btn ${variant !== 'default' ? variant : ''} ${size ?? ''} ${active ? 'active' : ''} ${className}`} />
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }): ReactNode {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span style={{ color: 'var(--text-faint)' }}>{hint}</span>}
    </label>
  )
}

export const Input = ({ className = '', ...p }: InputHTMLAttributes<HTMLInputElement>): ReactNode => <input {...p} className={`input ${className}`} />
export const TextArea = ({ className = '', ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactNode => <textarea {...p} className={`textarea ${className}`} />
export const Select = ({ className = '', ...p }: SelectHTMLAttributes<HTMLSelectElement>): ReactNode => <select {...p} className={`select ${className}`} />

export function Panel({ title, actions, children, className = '', style }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; style?: React.CSSProperties }): ReactNode {
  return (
    <section className={`panel ${className}`} style={style}>
      {(title || actions) && (
        <header className="row" style={{ justifyContent: 'space-between', paddingRight: 8 }}>
          <div className="panel-title">{title}</div>
          <div className="row">{actions}</div>
        </header>
      )}
      {children}
    </section>
  )
}

export function Modal({ title, onClose, children, footer, width }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }): ReactNode {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width }}>
        <div className="modal-head">{title}</div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }): ReactNode {
  return (
    <div className="empty">
      <div>
        <div style={{ font: '22px/1.3 var(--font-display)', color: 'var(--text-dim)' }}>{title}</div>
        <div style={{ marginTop: 6 }}>{children}</div>
      </div>
    </div>
  )
}

/* ── toasts ── */
interface Toast { id: number; level: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string }
const useToasts = create<{ toasts: Toast[]; push: (t: Omit<Toast, 'id'>) => void }>((set) => ({
  toasts: [],
  push: (t) => {
    const id = Date.now() + Math.random()
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.level === 'error' ? 8000 : 4000)
  }
}))
export const toast = (title: string, level: Toast['level'] = 'info', detail?: string): void => useToasts.getState().push({ title, level, detail })
export function ToastHost(): ReactNode {
  const toasts = useToasts((s) => s.toasts)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.level}`}>
          <strong>{t.title}</strong>
          {t.detail && <div className="dim">{t.detail}</div>}
        </div>
      ))}
    </div>
  )
}
