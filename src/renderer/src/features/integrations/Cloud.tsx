import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CloudStatus, HistoryEntry } from '@shared/integrations'
import { Button, Input, Modal, Select, toast } from '@ui/index'
import { api, useApp } from '../../app/store'
import { Logo, ago, useAction, useEvent } from './common'

const PROVIDER: Record<string, string> = { icloud: 'iCloud Drive', dropbox: 'Dropbox', gdrive: 'Google Drive', onedrive: 'OneDrive', syncthing: 'Syncthing', network: 'Network drive' }

export function CloudCard(): ReactNode {
  const [st, setSt] = useState<CloudStatus | null>(null)
  const [pin, setPin] = useState('')
  const [url, setUrl] = useState('')
  const [found, setFound] = useState<{ name: string; url: string }[]>([])
  const [info, setInfo] = useState<{ pin?: string }>({})
  const [hist, setHist] = useState(false)
  const a = useAction()
  useEffect(() => { void api.invoke('cloud.status').then(setSt); void api.invoke('local.get', { key: 'remotePin' }).then((p) => setInfo({ pin: String(p ?? '') })) }, [])
  useEvent('cloud.changed', setSt)
  if (!st) return null
  const dot = st.health === 'ok' ? 'ok' : st.health === 'offline' || st.health === 'error' ? 'err' : 'warn'
  const move = (how: 'copy' | 'use'): void => void a.run(async () => {
    const [target] = await api.invoke('system.pickFiles', { title: how === 'copy' ? 'Choose a folder in iCloud Drive / Dropbox / Google Drive / OneDrive' : 'Choose an existing Reach workspace folder', directory: true })
    if (!target) return
    const r = await api.invoke('cloud.moveWorkspace', { target, mode: how })
    toast(`Workspace ${how === 'copy' ? 'copied' : 'switched'}${r.provider ? ` (${PROVIDER[r.provider]})` : ''} — restarting…`, 'success')
  })
  return (
    <div className="ix-card wide" data-testid="cloud-card">
      <div className="ix-card-head">
        <Logo text="☁" color="#3886CE" />
        <div className="grow">
          <div className="ix-title">Cloud workspace — every Reach computer, always up to date</div>
          <span className="ix-status"><span className={`ix-dot ${dot}`} />
            {st.mode === 'host' ? 'Sharing this workspace' : st.mode === 'replica' ? `Synced with ${st.hostUrl}` : st.provider ? `In ${PROVIDER[st.provider]}` : 'On this computer only'}
            {st.message && ` · ${st.message}`}{st.lastSync && ` · ${ago(st.lastSync)}`}{st.pending ? ` · ${st.pending} waiting to sync` : ''}
          </span>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setHist(true)}>Version history</Button>
        {st.mode === 'replica' && <Button size="sm" onClick={() => void a.run(() => api.invoke('cloud.syncNow'))}>Sync now</Button>}
      </div>
      <div className="ix-plan">
        <div className="col">
          <div className="panel-title" style={{ padding: 0 }}>Built-in sync (no account needed)</div>
          {st.mode === 'host' ? (
            <div className="ix-help" data-testid="cloud-hosting">
              Other Reach computers: <b>Integrations → Cloud workspace → Join</b> with<br />
              <span className="ix-mono">{st.hostUrl}</span> and PIN <b className="ix-mono">{info.pin}</b>.<br />
              Keep this computer on (or run a small always-on “Reach Hub”: <span className="ix-mono">REACH_HEADLESS=1 REACH_SYNC_HOST=1</span>).
              <div className="ix-row" style={{ marginTop: 6 }}><Button size="sm" onClick={() => void a.run(() => api.invoke('cloud.host', { enabled: false }))}>Stop sharing</Button></div>
            </div>
          ) : st.mode === 'replica' ? (
            <div className="ix-row"><span className="ix-help grow">This computer keeps a full copy and works offline; changes sync both ways when it can reach the host.</span><Button size="sm" onClick={() => void a.run(() => api.invoke('cloud.leave'))}>Stop syncing</Button></div>
          ) : (
            <>
              <div className="ix-row"><Button size="sm" variant="primary" data-testid="cloud-share" onClick={() => void a.run(() => api.invoke('cloud.host', { enabled: true }))}>Share this computer’s workspace</Button><span className="ix-help">Use the main booth computer.</span></div>
              <div className="ix-row">
                <Input placeholder="http://192.168.1.20:4780" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 2 }} data-testid="cloud-url" />
                <Input placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value)} style={{ width: 90 }} data-testid="cloud-pin" />
                <Button size="sm" disabled={!url || !pin || a.busy} data-testid="cloud-join" onClick={() => void a.run(async () => { if (!confirm('Join this workspace? This computer’s current files are kept in .history and replaced by the shared workspace.')) return; await api.invoke('cloud.join', { url, pin }); toast('Joined — syncing…', 'success') })}>Join</Button>
                <Button size="sm" variant="ghost" onClick={() => void a.run(async () => setFound(await api.invoke('cloud.discover')))}>Find nearby</Button>
              </div>
              {found.map((f) => <div key={f.url} className="ix-row ix-pick" onClick={() => setUrl(f.url)}>{f.name} <span className="ix-mono">{f.url}</span></div>)}
            </>
          )}
        </div>
        <div className="col">
          <div className="panel-title" style={{ padding: 0 }}>Or keep it in a cloud folder</div>
          <div className="ix-help">Put the workspace in iCloud Drive, Dropbox, Google Drive, OneDrive, Syncthing or a NAS. Reach writes files safely, merges “conflicted copies” automatically (newest wins, the other is kept in version history) and warns about files that haven’t finished downloading.<div className="ix-mono" style={{ marginTop: 4 }}>{st.workspacePath}</div></div>
          <div className="ix-row"><Button size="sm" onClick={() => move('copy')}>Move workspace to a folder…</Button><Button size="sm" variant="ghost" onClick={() => move('use')}>Use an existing workspace…</Button></div>
        </div>
      </div>
      {st.peers.length > 1 && (
        <div className="ix-row" data-testid="cloud-peers">{st.peers.map((p) => <span key={p.id} className={`ix-tag ${p.onAir ? 'cfl' : 'add'}`}>{p.name}{p.host ? ' (host)' : ''}{p.onAir ? ' · ON AIR' : ''}{p.editing.length ? ' · editing' : ''}</span>)}</div>
      )}
      {st.placeholders.length > 0 && <div className="ix-warn">Still downloading: {st.placeholders.slice(0, 4).join(', ')}{st.placeholders.length > 4 ? '…' : ''}</div>}
      {st.conflicts.length > 0 && (
        <div className="ix-list">
          {st.conflicts.map((c) => (
            <div key={c.id}><span className="ix-tag cfl">Conflict</span><span className="grow"><b>{c.path}</b> <span className="dim">{c.reason}</span></span><Button size="sm" variant="ghost" onClick={() => void api.invoke('cloud.dismissConflict', { id: c.id })}>OK</Button></div>
          ))}
        </div>
      )}
      {a.error && <div className="ix-err">{a.error}</div>}
      {hist && <HistoryModal onClose={() => setHist(false)} />}
    </div>
  )
}

export function HistoryModal({ onClose, presentationId }: { onClose: () => void; presentationId?: string }): ReactNode {
  const library = useApp((s) => s.library)
  const sel = useApp((s) => s.selectedPresentationId)
  const [id, setId] = useState(presentationId ?? sel ?? library[0]?.id ?? '')
  const [list, setList] = useState<HistoryEntry[]>([])
  const a = useAction()
  useEffect(() => { if (id) void a.run(async () => setList(await api.invoke('history.list', { presentationId: id }))) }, [id])
  return (
    <Modal title="Version history" onClose={onClose} width={640} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="col">
        <Select value={id} onChange={(e) => setId(e.target.value)}>{library.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select>
        <div className="ix-list">
          {!list.length && <div className="dim">No earlier versions yet. Versions are kept automatically as you edit (and whenever another computer replaces a file).</div>}
          {list.map((e) => (
            <div key={e.id}>
              <span className="grow">{new Date(e.at).toLocaleString()} <span className="dim">· {e.title ?? ''}{e.slideCount !== undefined ? ` · ${e.slideCount} slides` : ''}{e.reason && e.reason !== 'edit' ? ` · ${e.reason}` : ''}</span></span>
              <Button size="sm" onClick={() => void a.run(async () => { await api.invoke('history.restore', { presentationId: id, id: e.id }); toast('Restored — the version you replaced is in history too', 'success'); setList(await api.invoke('history.list', { presentationId: id })) })}>Restore</Button>
            </div>
          ))}
        </div>
        {a.error && <div className="ix-err">{a.error}</div>}
      </div>
    </Modal>
  )
}

/** Background: tell other computers what's open in the editor, and warn if someone else is editing it too. */
export function EditingGuard(): ReactNode {
  const view = useApp((s) => s.view)
  const sel = useApp((s) => s.selectedPresentationId)
  const warned = useRef('')
  useEffect(() => {
    const ids = /edit/i.test(view) && sel ? [sel] : []
    const t = setInterval(() => {
      void api.invoke('cloud.setEditing', { ids }).then((others) => {
        const key = others.map((o) => o.id).join(',') + sel
        if (others.length && warned.current !== key) {
          warned.current = key
          toast(`${others.map((o) => o.name).join(', ')} ${others.length > 1 ? 'are' : 'is'} editing this too`, 'warning', 'Changes sync, but the last save wins — coordinate before editing the same slides.')
        }
      }).catch(() => {})
    }, 5000)
    return () => clearInterval(t)
  }, [view, sel])
  return null
}
