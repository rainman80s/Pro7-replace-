import { useEffect, useState, type ReactNode } from 'react'
import type { SystemInfo } from '@shared/api'
import { Kbd, Logo, Modal } from '@ui/index'
import { allShortcuts } from './registry'
import { api, useApp } from './store'

const APP_SHORTCUTS = [
  { group: 'Anywhere', keys: 'mod+K', label: 'Find a song, slide or action' },
  { group: 'Anywhere', keys: 'mod+1', label: 'Go to Show (⌘2, ⌘3… for the other screens)' },
  { group: 'Anywhere', keys: '?', label: 'This list' }
]

/** "?" — every keyboard shortcut in one place. Features add theirs via defineFeature({ shortcuts }). */
export function ShortcutsOverlay(): ReactNode {
  const open = useApp((s) => s.overlay === 'shortcuts')
  const setOverlay = useApp((s) => s.setOverlay)
  if (!open) return null
  const all = [...allShortcuts(), ...APP_SHORTCUTS]
  const groups = [...new Set(all.map((s) => s.group))]
  return (
    <Modal title="Keyboard shortcuts" onClose={() => setOverlay(null)} width={640} data-testid="shortcuts">
      <div className="shortcuts">
        {groups.map((g) => (
          <section key={g}>
            <h4 className="t-label">{g}</h4>
            {all.filter((s) => s.group === g).map((s) => (
              <div key={s.keys + s.label} className="shortcut-row"><span>{s.label}</span><Kbd keys={s.keys} /></div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  )
}

export function AboutOverlay(): ReactNode {
  const open = useApp((s) => s.overlay === 'about')
  const setOverlay = useApp((s) => s.setOverlay)
  const [info, setInfo] = useState<SystemInfo | null>(null)
  useEffect(() => { if (open) void api.invoke('system.info').then(setInfo).catch(() => {}) }, [open])
  if (!open) return null
  return (
    <Modal title="" onClose={() => setOverlay(null)} width={420} className="about" data-testid="about">
      <div className="about-body">
        <div className="about-mark"><Logo variant="combo" height={92} clear /></div>
        <div className="t-label" style={{ color: 'var(--charcoal)' }}>Presenter</div>
        <div className="t-meta about-meta">
          Version {info?.version ?? '…'}{info ? ` · ${info.platform}` : ''}<br />
          {info?.workspacePath}
        </div>
        <p className="about-line">Made for the volunteers who run the screens at Reach Church.</p>
      </div>
    </Modal>
  )
}
