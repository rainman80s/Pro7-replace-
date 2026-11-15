import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DisplayInfo, ReceiverInfo } from '@shared/api'
import type { Output } from '@shared/model'
import { deckLinkModeLabel, sortDeckLinkModes, type DeckLinkDevice } from '@shared/decklink'

export type Target = Output['target']
export interface Choice { target: Target; label: string }

/** Tiny picture of how this computer's displays are arranged, with one highlighted (ProPresenter's System menu). */
export function Arrangement({ displays, highlight }: { displays: DisplayInfo[]; highlight: string }): ReactNode {
  const list = displays.filter((d) => d.connected !== false)
  if (!list.length) return null
  const x0 = Math.min(...list.map((d) => d.bounds.x)), y0 = Math.min(...list.map((d) => d.bounds.y))
  const x1 = Math.max(...list.map((d) => d.bounds.x + d.bounds.width)), y1 = Math.max(...list.map((d) => d.bounds.y + d.bounds.height))
  const w = x1 - x0, h = y1 - y0
  const pad = Math.max(w, h) * 0.04
  return (
    <svg className="scr-arr" viewBox={`${-pad} ${-pad} ${w + 2 * pad} ${h + 2 * pad}`} aria-hidden>
      {list.map((d) => (
        <rect key={d.key} x={d.bounds.x - x0} y={d.bounds.y - y0} width={d.bounds.width} height={d.bounds.height} rx={w * 0.01}
          className={d.key === highlight ? 'hi' : ''} />
      ))}
    </svg>
  )
}

const dispSize = (d: DisplayInfo): string => `${d.nativeSize?.width ?? d.bounds.width}x${d.nativeSize?.height ?? d.bounds.height}`

/** The grouped Output menu: System · Blackmagic · NDI · Network displays · Window · Placeholder. */
export function OutputMenu(p: {
  output?: Output
  displays: DisplayInfo[]
  ports: DeckLinkDevice[]
  receivers: ReceiverInfo[]
  /** Which destinations other outputs already use: key → that output's name. */
  taken: Map<string, string>
  label: string
  onPick: (c: Choice) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [port, setPort] = useState<string | null>(null)
  const [up, setUp] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent): void => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key, true) }
  }, [open])
  const pick = (c: Choice): void => { setOpen(false); p.onPick(c) }
  const t = p.output?.target
  const usedBy = (k: string): ReactNode => {
    const n = p.taken.get(k)
    return n ? <span className="scr-menu-note">in use by {n}</span> : null
  }
  return (
    <div className="scr-menu-wrap" ref={ref}>
      <button type="button" className="scr-menu-btn" onClick={(e) => { setUp(window.innerHeight - e.currentTarget.getBoundingClientRect().bottom < 380); setOpen((v) => !v) }} aria-haspopup="listbox" aria-expanded={open} data-output-menu>
        <span className="grow">{p.label}</span><span aria-hidden>▾</span>
      </button>
      {open && (
        <div className={`scr-menu ${up ? 'up' : ''}`} role="listbox" data-output-menu-list>
          <div className="scr-menu-h">System</div>
          {p.displays.filter((d) => d.connected !== false).map((d) => (
            <button key={d.key} type="button" className={`scr-menu-item ${t?.type === 'display' && t.displayKey === d.key ? 'on' : ''}`} data-menu-item={`display:${d.key}`}
              onClick={() => pick({ target: { type: 'display', displayKey: d.key }, label: d.customName || d.label })}>
              <Arrangement displays={p.displays} highlight={d.key} />
              <span className="grow"><b>{d.customName || d.label}</b> <span className="dim">({dispSize(d)})</span>{d.operator ? <span className="scr-menu-note">your screen</span> : null}{usedBy(`display:${d.key}`)}</span>
            </button>
          ))}
          {!p.displays.length && <div className="scr-menu-empty">No displays found.</div>}

          <div className="scr-menu-h">Blackmagic</div>
          {p.ports.map((d) => {
            const modes = sortDeckLinkModes(d.modes)
            const on = t?.type === 'decklink' && t.device === d.key
            return (
              <div key={d.key}>
                <button type="button" className={`scr-menu-item ${on ? 'on' : ''}`} data-menu-item={`decklink:${d.key}`} onClick={() => setPort(port === d.key ? null : d.key)} aria-expanded={port === d.key}>
                  <span className="grow"><b>{d.displayName}</b>{!d.connected && <span className="scr-menu-note">not connected</span>}{usedBy(`decklink:${d.key}`)}</span><span aria-hidden>{port === d.key ? '▾' : '▸'}</span>
                </button>
                {port === d.key && (
                  <div className="scr-submenu">
                    {modes.map((m) => (
                      <button key={m.id} type="button" className={`scr-menu-item sub ${on && t.type === 'decklink' && t.mode === m.id ? 'on' : ''}`} data-menu-item={`decklink:${d.key}:${m.id}`}
                        onClick={() => pick({ target: { type: 'decklink', device: d.key, mode: m.id, keying: on && t.type === 'decklink' ? t.keying : 'none' }, label: d.displayName })}>
                        {deckLinkModeLabel(m)}<span className="dim"> ({m.width}x{m.height})</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {!p.ports.length && <div className="scr-menu-empty">No Blackmagic card found on this computer.</div>}

          <div className="scr-menu-h">NDI</div>
          <button type="button" className={`scr-menu-item ${t?.type === 'ndi' ? 'on' : ''}`} data-menu-item="ndi" onClick={() => pick({ target: { type: 'ndi', name: t?.type === 'ndi' ? t.name : '' }, label: 'NDI' })}>
            <span className="grow">{t?.type === 'ndi' ? `NDI “${t.name}”` : 'New NDI'}</span>
          </button>

          <div className="scr-menu-h">Network displays</div>
          {p.receivers.map((r) => (
            <button key={r.id} type="button" className={`scr-menu-item ${t?.type === 'network' && t.receiverId === r.id ? 'on' : ''}`} data-menu-item={`network:${r.id}`}
              onClick={() => pick({ target: { type: 'network', receiverId: r.id }, label: r.name })}>
              <span className="grow"><b>{r.name}</b> <span className="dim">{r.width && r.height ? `(${r.width}x${r.height}) ` : ''}{r.connected ? '' : 'offline'}</span>{usedBy(`network:${r.id}`)}</span>
            </button>
          ))}
          {!p.receivers.length && <div className="scr-menu-empty">No TVs or browsers have connected yet. See “Network &amp; advanced”.</div>}

          <div className="scr-menu-h">Window</div>
          <button type="button" className={`scr-menu-item ${t?.type === 'window' ? 'on' : ''}`} data-menu-item="window" onClick={() => pick({ target: { type: 'window' }, label: 'Window' })}><span className="grow">Window on this computer</span></button>

          <div className="scr-menu-h">Placeholder</div>
          <button type="button" className={`scr-menu-item ${t?.type === 'placeholder' ? 'on' : ''}`} data-menu-item="placeholder" onClick={() => pick({ target: { type: 'placeholder' }, label: 'Placeholder' })}>
            <span className="grow">New Placeholder <span className="dim">(not connected yet)</span></span>
          </button>
        </div>
      )}
    </div>
  )
}
