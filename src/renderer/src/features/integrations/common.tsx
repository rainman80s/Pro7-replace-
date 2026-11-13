import { useEffect, useState, type ReactNode } from 'react'
import type { IntegrationStatus } from '@shared/integrations'
import { api } from '../../app/store'

export function StatusLine({ s, okText }: { s?: IntegrationStatus | null; okText?: string }): ReactNode {
  if (!s) return <span className="ix-status"><span className="ix-dot" /> Checking…</span>
  const cls = s.error ? 'err' : s.connected ? 'ok' : ''
  return (
    <span className="ix-status">
      <span className={`ix-dot ${cls}`} />
      {s.error ? s.error : s.connected ? `${okText ?? 'Connected'}${s.account ? ` — ${s.account}` : ''}` : 'Not connected'}
      {s.lastSync && !s.error && <span> · last sync {ago(s.lastSync)}</span>}
    </span>
  )
}

export function ago(iso: string): string {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000)
  if (!isFinite(s)) return ''
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString()
}

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Run an async action with busy + error state. */
export function useAction(): { busy: boolean; error: string; run: <T>(fn: () => Promise<T>) => Promise<T | undefined>; setError: (e: string) => void } {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return {
    busy, error, setError,
    async run(fn) {
      setBusy(true); setError('')
      try { return await fn() } catch (e) { setError(errText(e)); return undefined } finally { setBusy(false) }
    }
  }
}

export function useEvent<K extends Parameters<typeof api.on>[0]>(event: K, cb: Parameters<typeof api.on<K>>[1], deps: unknown[] = []): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => api.on(event, cb), deps)
}

export const fmtLen = (s?: number): string => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '')

export function Logo({ text, color }: { text: string; color: string }): ReactNode {
  return <div className="ix-logo" style={{ background: color }}>{text}</div>
}

export const openUrl = (url: string): void => { window.open(url, '_blank') }
