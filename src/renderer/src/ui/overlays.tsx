import { cloneElement, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { create } from 'zustand'
import { Icon, type IconName } from './icons'

/**
 * The UI scale setting applies CSS `zoom` to <html>. Pointer and getBoundingClientRect() values are
 * in visual pixels, while `position: fixed` offsets are in zoomed CSS pixels — divide by this.
 */
export const uiZoom = (): number => (typeof document === 'undefined' ? 1 : Number(document.documentElement.style.zoom) || 1)

/* ───────────── focus helpers ───────────── */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Keeps Tab inside `ref`, focuses the first control, restores focus on close. */
function useFocusTrap(ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const previous = document.activeElement as HTMLElement | null
    const auto = el.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ?? el.querySelector<HTMLElement>('.modal-body input, .modal-body textarea, .drawer-body input') ?? el.querySelector<HTMLElement>(FOCUSABLE)
    ;(auto ?? el).focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null)
      if (!items.length) return
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    el.addEventListener('keydown', onKey)
    return () => { el.removeEventListener('keydown', onKey); previous?.focus?.({ preventScroll: true }) }
  }, [ref])
}

/** Open overlays, innermost last, so Escape only closes the top one. */
const stack: object[] = []
function useEscape(onClose: () => void): void {
  const cb = useRef(onClose)
  cb.current = onClose
  useEffect(() => {
    const token = {}
    stack.push(token)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || stack[stack.length - 1] !== token) return
      e.preventDefault()
      e.stopImmediatePropagation()
      cb.current()
    }
    // Capture phase: an open overlay always wins over global hotkeys (Esc = clear slide).
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); stack.splice(stack.indexOf(token), 1) }
  }, [])
}
/** True while any modal/drawer/menu is open — global hotkeys should stand down. */
export const overlayOpen = (): boolean => stack.length > 0

/* ───────────── Modal & Drawer ───────────── */

export function Modal({ title, onClose, children, footer, width, className = '', 'data-testid': testId }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number; className?: string; 'data-testid'?: string }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  useEscape(onClose)
  useFocusTrap(ref)
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} className={`modal ${className}`} style={{ width }} role="dialog" aria-modal="true" tabIndex={-1} data-testid={testId}>
        <div className="modal-head">
          <span>{title}</span>
          <button type="button" className="btn ghost icon-only sm" aria-label="Close" onClick={onClose}><Icon name="close" size={14} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

/** A panel that slides in from the side — for secondary detail that shouldn't cover the show. */
export function Drawer({ title, onClose, children, footer, width, side = 'right', 'data-testid': testId }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number; side?: 'left' | 'right'; 'data-testid'?: string }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  useEscape(onClose)
  useFocusTrap(ref)
  return createPortal(
    <>
      <div className="drawer-backdrop" onMouseDown={onClose} />
      <aside ref={ref} className={`drawer ${side === 'left' ? 'left' : ''}`} style={{ width }} role="dialog" aria-modal="true" tabIndex={-1} data-testid={testId}>
        <div className="drawer-head">
          <span>{title}</span>
          <button type="button" className="btn ghost icon-only sm" aria-label="Close" onClick={onClose}><Icon name="close" size={14} /></button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </>,
    document.body
  )
}

/* ───────────── Tooltip ───────────── */

/** Wrap ONE element. Shows after a short hover or on keyboard focus. */
export function Tooltip({ label, shortcut, children, side = 'bottom' }: { label: ReactNode; shortcut?: string; children: ReactElement; side?: 'top' | 'bottom' }): ReactNode {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = (el: HTMLElement, delay: number): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const r = el.getBoundingClientRect()
      const z = uiZoom()
      setPos({ x: (r.left + r.width / 2) / z, y: (side === 'top' ? r.top - 8 : r.bottom + 8) / z })
    }, delay)
  }
  const hide = (): void => { if (timer.current) clearTimeout(timer.current); setPos(null) }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const child = children as ReactElement<Record<string, unknown>>
  const chain = (name: string, fn: (e: { currentTarget: HTMLElement }) => void) => (e: { currentTarget: HTMLElement }) => { (child.props[name] as ((ev: unknown) => void) | undefined)?.(e); fn(e) }
  return (
    <>
      {cloneElement(child, {
        onMouseEnter: chain('onMouseEnter', (e) => show(e.currentTarget, 450)),
        onMouseLeave: chain('onMouseLeave', hide),
        onMouseDown: chain('onMouseDown', hide),
        onFocus: chain('onFocus', (e) => { if (e.currentTarget.matches(':focus-visible')) show(e.currentTarget, 100) }),
        onBlur: chain('onBlur', hide)
      })}
      {pos && createPortal(
        <div role="tooltip" className="tooltip" style={{ left: Math.max(8, Math.min(window.innerWidth / uiZoom() - 8, pos.x)), top: pos.y, transform: `translate(-50%, ${side === 'top' ? '-100%' : '0'})` }}>
          {label}{shortcut && <kbd className="kbd">{shortcut}</kbd>}
        </div>,
        document.body
      )}
    </>
  )
}

/* ───────────── Menus ───────────── */

export type MenuItem =
  | { type?: 'item'; label: ReactNode; icon?: IconName; onSelect: () => void; danger?: boolean; disabled?: boolean; shortcut?: string; checked?: boolean; testId?: string }
  | { type: 'separator' }
  | { type: 'heading'; label: ReactNode }
/** `false`/`null`/`undefined` entries are skipped so you can write `locked ? null : {...}`. */
export type MenuItems = (MenuItem | false | null | undefined)[]

interface OpenMenu { x: number; y: number; items: MenuItem[]; anchor?: DOMRect; alignEnd?: boolean; minWidth?: number }
const useMenu = create<{ menu: OpenMenu | null }>(() => ({ menu: null }))
const closeMenu = (): void => useMenu.setState({ menu: null })

function clean(items: MenuItems): MenuItem[] {
  const out = items.filter(Boolean) as MenuItem[]
  // No leading/trailing/double separators.
  return out.filter((it, i) => it.type !== 'separator' || (i > 0 && i < out.length - 1 && out[i - 1].type !== 'separator'))
}

/** Open a menu at the pointer: `onContextMenu={(e) => openContextMenu(e, [...])}`. */
export function openContextMenu(e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation?(): void }, items: MenuItems): void {
  e.preventDefault()
  e.stopPropagation?.()
  const list = clean(items)
  if (!list.length) return
  ensureHost()
  const z = uiZoom()
  useMenu.setState({ menu: { x: e.clientX / z, y: e.clientY / z, items: list } })
}

/** Open a menu attached to an element (dropdown). */
export function openMenuAt(el: Element, items: MenuItems, opts?: { align?: 'start' | 'end' }): void {
  const z = uiZoom()
  const b = el.getBoundingClientRect()
  const r = new DOMRect(b.x / z, b.y / z, b.width / z, b.height / z)
  const list = clean(items)
  if (!list.length) return
  ensureHost()
  const end = opts?.align === 'end'
  useMenu.setState({ menu: { x: end ? r.right : r.left, y: r.bottom + 4, items: list, anchor: r, alignEnd: end, minWidth: end ? undefined : r.width } })
}

/**
 * Dropdown menu. `trigger` is ONE button-like element; it gets onClick + aria attributes.
 *   <Menu trigger={<IconButton icon="more" label="More" />} items={[{ label: 'Rename', onSelect }]} />
 */
export function Menu({ trigger, items, align = 'start' }: { trigger: ReactElement; items: MenuItems | (() => MenuItems); align?: 'start' | 'end' }): ReactNode {
  const child = trigger as ReactElement<Record<string, unknown>>
  return cloneElement(child, {
    'aria-haspopup': 'menu',
    onClick: (e: ReactMouseEvent<HTMLElement>) => {
      (child.props.onClick as ((ev: unknown) => void) | undefined)?.(e)
      e.stopPropagation()
      openMenuAt(e.currentTarget, typeof items === 'function' ? items() : items, { align })
    }
  })
}

function MenuHost(): ReactNode {
  const menu = useMenu((s) => s.menu)
  return menu ? <MenuPopup key={`${menu.x},${menu.y}`} menu={menu} /> : null
}

function MenuPopup({ menu }: { menu: OpenMenu }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ left: menu.x, top: menu.y, visibility: 'hidden', minWidth: menu.minWidth })
  useEscape(closeMenu)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const z = uiZoom()
    const r = { width: el.offsetWidth, height: el.offsetHeight }
    const vw = window.innerWidth / z, vh = window.innerHeight / z
    let left = menu.alignEnd ? menu.x - r.width : menu.x
    let top = menu.y
    if (left + r.width > vw - 8) left = vw - r.width - 8
    if (top + r.height > vh - 8) top = menu.anchor ? Math.max(8, menu.anchor.top - r.height - 4) : Math.max(8, vh - r.height - 8)
    setStyle({ left: Math.max(8, left), top, minWidth: menu.minWidth })
    const previous = document.activeElement as HTMLElement | null
    el.querySelector<HTMLElement>('.menu-item:not(:disabled)')?.focus({ preventScroll: true })
    return () => previous?.focus?.({ preventScroll: true })
  }, [menu])
  useEffect(() => {
    const away = (e: Event): void => { if (!ref.current?.contains(e.target as Node)) closeMenu() }
    window.addEventListener('mousedown', away, true)
    window.addEventListener('blur', closeMenu)
    window.addEventListener('resize', closeMenu)
    return () => { window.removeEventListener('mousedown', away, true); window.removeEventListener('blur', closeMenu); window.removeEventListener('resize', closeMenu) }
  }, [])
  const move = (dir: 1 | -1): void => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('.menu-item:not(:disabled)') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    items[(i + dir + items.length) % items.length]?.focus()
  }
  return createPortal(
    <div ref={ref} className="menu" role="menu" style={style} onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); move(1) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); move(-1) }
        else if (e.key === 'Tab') { e.preventDefault(); closeMenu() }
        else if (e.key !== 'Escape') e.stopPropagation()
      }}>
      {menu.items.map((it, i) =>
        it.type === 'separator' ? <div key={i} className="menu-sep" role="separator" />
        : it.type === 'heading' ? <div key={i} className="menu-heading">{it.label}</div>
        : (
          <button key={i} type="button" role="menuitem" className={`menu-item ${it.danger ? 'danger' : ''}`} disabled={it.disabled} data-testid={it.testId}
            onClick={() => { closeMenu(); it.onSelect() }}>
            {it.checked !== undefined ? <Icon name="check" size={14} style={{ opacity: it.checked ? 1 : 0 }} /> : it.icon ? <Icon name={it.icon} size={14} /> : null}
            <span className="menu-label">{it.label}</span>
            {it.shortcut && <kbd className="kbd">{it.shortcut}</kbd>}
          </button>
        )
      )}
    </div>,
    document.body
  )
}

/* ───────────── Toasts ───────────── */

export type ToastLevel = 'info' | 'success' | 'warning' | 'error'
interface Toast { id: number; level: ToastLevel; title: string; detail?: string; action?: { label: string; onClick: () => void } }
const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }))
const dismissToast = (id: number): void => useToasts.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }))

/**
 * Non-blocking message, bottom right.
 *   toast('Saved')
 *   toast('Could not import', 'error', err.message)
 *   toast('Removed "Doxology"', 'info', undefined, { label: 'Undo', onClick: restore })
 */
export function toast(title: string, level: ToastLevel = 'info', detail?: string, action?: Toast['action']): void {
  const id = Date.now() + Math.random()
  // Identical messages don't pile up.
  useToasts.setState((s) => ({ toasts: [...s.toasts.filter((t) => !(t.title === title && t.detail === detail))
    .slice(-2), { id, level, title, detail, action }] }))
  setTimeout(() => dismissToast(id), action ? 7000 : level === 'error' ? 8000 : 4000)
}

const TOAST_ICON: Record<ToastLevel, IconName> = { info: 'info', success: 'success', warning: 'warning', error: 'error' }
export function ToastHost(): ReactNode {
  const toasts = useToasts((s) => s.toasts)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.level}`} role={t.level === 'error' ? 'alert' : 'status'}>
          <Icon name={TOAST_ICON[t.level]} size={16} />
          <div className="grow">
            <strong>{t.title}</strong>
            {t.detail && <div className="toast-detail">{t.detail}</div>}
          </div>
          {t.action && <button type="button" className="toast-action" onClick={() => { t.action!.onClick(); dismissToast(t.id) }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  )
}

/* ───────────── confirm() / promptText() ───────────── */

interface DialogReq {
  id: number
  kind: 'confirm' | 'prompt'
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /* prompt only */
  label?: string
  initial?: string
  placeholder?: string
  password?: boolean
  multiline?: boolean
  validate?: (v: string) => string | null | undefined
  resolve: (v: boolean | string | null) => void
}
let dialogSeq = 0
const useDialog = create<{ queue: DialogReq[] }>(() => ({ queue: [] }))

/**
 * Ask before doing something that can't be undone. Resolves true/false.
 *   if (await confirm({ title: 'Delete "Sunday 9am"?', message: 'This removes the service order, not the songs.', confirmLabel: 'Delete', danger: true })) …
 */
export function confirm(opts: { title: string; message?: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean }): Promise<boolean> {
  ensureHost()
  return new Promise((resolve) => useDialog.setState((s) => ({ queue: [...s.queue, { id: ++dialogSeq, kind: 'confirm', ...opts, resolve: (v) => resolve(v === true) }] })))
}

/** Ask for one line (or a block) of text. Resolves the string, or null if cancelled. */
export function promptText(opts: { title: string; message?: ReactNode; label?: string; initial?: string; placeholder?: string; confirmLabel?: string; password?: boolean; multiline?: boolean; validate?: (v: string) => string | null | undefined }): Promise<string | null> {
  ensureHost()
  return new Promise((resolve) => useDialog.setState((s) => ({ queue: [...s.queue, { id: ++dialogSeq, kind: 'prompt', ...opts, resolve: (v) => resolve(typeof v === 'string' ? v : null) }] })))
}

function DialogHost(): ReactNode {
  const req = useDialog((s) => s.queue[0])
  return req ? <DialogView key={req.id} req={req} /> : null
}

function DialogView({ req }: { req: DialogReq }): ReactNode {
  const [value, setValue] = useState(req.initial ?? '')
  const [error, setError] = useState<string | null>(null)
  const done = (v: boolean | string | null): void => { useDialog.setState((s) => ({ queue: s.queue.slice(1) })); req.resolve(v) }
  const ok = (): void => {
    if (req.kind === 'confirm') return done(true)
    const err = req.validate?.(value)
    if (err) return setError(err)
    done(value)
  }
  return (
    <Modal title={req.title} onClose={() => done(req.kind === 'confirm' ? false : null)} width={440} data-testid="dialog"
      footer={<>
        <button type="button" className="btn" onClick={() => done(req.kind === 'confirm' ? false : null)}>{req.cancelLabel ?? 'Cancel'}</button>
        <button type="button" className={`btn ${req.danger ? 'danger solid' : 'primary'}`} data-testid="dialog-ok" data-autofocus={req.kind === 'confirm' ? '' : undefined} onClick={ok}>{req.confirmLabel ?? 'OK'}</button>
      </>}>
      {req.message && <div className="dim" style={{ lineHeight: 1.55, marginBottom: req.kind === 'prompt' ? 12 : 0 }}>{req.message}</div>}
      {req.kind === 'prompt' && (
        <label className="field">
          {req.label && <span className="field-label">{req.label}</span>}
          {req.multiline
            ? <textarea className="textarea" rows={8} value={value} placeholder={req.placeholder} data-autofocus="" onChange={(e) => { setValue(e.target.value); setError(null) }} />
            : <input className="input" type={req.password ? 'password' : 'text'} value={value} placeholder={req.placeholder} data-autofocus="" data-testid="dialog-input"
                onFocus={(e) => e.target.select()} onChange={(e) => { setValue(e.target.value); setError(null) }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ok() } }} />}
          {error && <span className="field-error" role="alert">{error}</span>}
        </label>
      )}
    </Modal>
  )
}

/* ───────────── host ───────────── */

let hostMounted = false
/**
 * Mount once near the root of a page: renders toasts, confirm/prompt dialogs and menus.
 * (If a page forgets, menus and dialogs mount their own host on first use; toasts need this.)
 */
export function UIHost(): ReactNode {
  useEffect(() => { hostMounted = true; return () => { hostMounted = false } }, [])
  return <><ToastHost /><DialogHost /><MenuHost /></>
}

let fallbackRoot = false
function ensureHost(): void {
  if (hostMounted || fallbackRoot || typeof document === 'undefined') return
  fallbackRoot = true
  const el = document.createElement('div')
  document.body.appendChild(el)
  createRoot(el).render(<><DialogHost /><MenuHost /></>)
}
