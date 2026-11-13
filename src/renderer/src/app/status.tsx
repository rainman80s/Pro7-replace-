import type { ReactNode } from 'react'
import { Dot, Icon, Tooltip, type IconName } from '@ui/index'

/**
 * One indicator in the status strip at the bottom of the window. Features contribute these
 * through `defineFeature({ statusItems: [{ id, order, component }] })`.
 *
 *   <StatusItem tone="ok" icon="cloud" label="Synced" detail="Last synced 2 minutes ago" onClick={openSyncSettings} />
 *
 * Tones: 'ok' (quiet green dot), 'warn', 'danger', 'idle' (grey), 'busy' (working).
 * Stay quiet when healthy. Never use Mustard here for anything other than a warning.
 */
export function StatusItem({ tone = 'idle', icon, label, detail, onClick, testId }: {
  tone?: 'ok' | 'warn' | 'danger' | 'idle' | 'busy'
  icon?: IconName
  label: ReactNode
  /** Longer explanation shown on hover. Say what to do, not just what is wrong. */
  detail?: ReactNode
  onClick?: () => void
  testId?: string
}): ReactNode {
  const body = (
    <button type="button" className={`status-item ${tone}`} onClick={onClick} disabled={!onClick} data-testid={testId}>
      {icon ? <Icon name={icon} size={13} /> : <Dot tone={tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : tone === 'danger' ? 'danger' : tone === 'busy' ? 'accent' : 'default'} />}
      <span>{label}</span>
    </button>
  )
  return detail ? <Tooltip label={detail} side="top">{body}</Tooltip> : body
}
