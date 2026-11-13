import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { IntegrationStatus, PcoPlanSummary, PcoServiceType, PcoSettings, PlanChange, PlanPullPreview, SongDecision } from '@shared/integrations'
import { Button, Field, Input, Modal, Select, toast } from '@ui/index'
import { api, useApp } from '../../app/store'
import { Logo, StatusLine, errText, fmtLen, openUrl, useAction, useEvent } from './common'

type PcoStatus = IntegrationStatus & { settings: PcoSettings }

export function PcoCard(): ReactNode {
  const [st, setSt] = useState<PcoStatus | null>(null)
  const [types, setTypes] = useState<PcoServiceType[]>([])
  const [plans, setPlans] = useState<PcoPlanSummary[]>([])
  const [appId, setAppId] = useState('')
  const [secret, setSecret] = useState('')
  const [pull, setPull] = useState<PcoPlanSummary | null>(null)
  const a = useAction()
  const playlists = useApp((s) => s.playlists)
  const load = async (): Promise<void> => { setSt(await api.invoke('pco.status')) }
  useEffect(() => { void load() }, [])
  useEvent('pco.statusChanged', () => void load())
  const typeId = st?.settings.serviceTypeId
  useEffect(() => {
    if (!st?.connected) return
    void a.run(async () => setTypes(await api.invoke('pco.serviceTypes')))
  }, [st?.connected])
  useEffect(() => {
    if (!st?.connected || !typeId) return
    void a.run(async () => setPlans(await api.invoke('pco.plans', { serviceTypeId: typeId })))
  }, [st?.connected, typeId])

  const connect = (): void => void a.run(async () => { await api.invoke('pco.connect', { appId, secret }); setAppId(''); setSecret(''); toast('Planning Center connected', 'success'); await load() })
  const pulledIds = new Set(playlists.map((p) => (p.source?.type === 'pco' ? p.source.ref : '')))

  return (
    <div className="ix-card wide" data-testid="pco-card">
      <div className="ix-card-head">
        <Logo text="PC" color="#2266CC" />
        <div className="grow">
          <div className="ix-title">Planning Center Services</div>
          <StatusLine s={st} />
        </div>
        {st?.connected && <Button size="sm" variant="ghost" onClick={() => void a.run(async () => { await api.invoke('pco.disconnect'); await load() })}>Disconnect</Button>}
      </div>
      {st && !st.connected && (
        <>
          <div className="ix-help">
            Pull this Sunday’s order of service — songs, lengths, who’s speaking and service times — straight from Planning Center.
            <ol>
              <li>Open <a onClick={() => openUrl('https://api.planningcenteronline.com/oauth/applications')}>api.planningcenteronline.com/oauth/applications</a> (sign in as someone who can see Services).</li>
              <li>Under <b>Personal Access Tokens</b>, click <b>Create one now</b>, name it “Reach Presenter”.</li>
              <li>Copy the <b>Application ID</b> and <b>Secret</b> here. They stay on this computer (encrypted).</li>
            </ol>
          </div>
          <div className="ix-row">
            <Input placeholder="Application ID" value={appId} onChange={(e) => setAppId(e.target.value)} style={{ flex: 1 }} data-testid="pco-appid" />
            <Input placeholder="Secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} style={{ flex: 1 }} data-testid="pco-secret" />
            <Button variant="primary" disabled={!appId || !secret || a.busy} onClick={connect} data-testid="pco-connect">{a.busy ? 'Checking…' : 'Connect'}</Button>
          </div>
        </>
      )}
      {st?.connected && (
        <>
          <div className="ix-row">
            <Field label="Service type">
              <Select value={typeId ?? ''} onChange={(e) => void api.invoke('pco.setSettings', { serviceTypeId: e.target.value }).then(load)} data-testid="pco-type">
                {!typeId && <option value="">Choose…</option>}
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
            <Field label="Check for changes">
              <Select value={String(st.settings.autoRefreshMinutes)} onChange={(e) => void api.invoke('pco.setSettings', { autoRefreshMinutes: Number(e.target.value) }).then(load)}>
                <option value="0">Only when I ask</option><option value="5">Every 5 minutes</option><option value="15">Every 15 minutes</option><option value="60">Every hour</option>
              </Select>
            </Field>
            <Field label="Pre/post-service items">
              <Select value={st.settings.includePrePost ? '1' : '0'} onChange={(e) => void api.invoke('pco.setSettings', { includePrePost: e.target.value === '1' }).then(load)}>
                <option value="1">Include</option><option value="0">Leave out</option>
              </Select>
            </Field>
            <label className="ix-row ix-help" title="Advances Planning Center Services LIVE when you move to the next item here. This writes to Planning Center.">
              <input type="checkbox" checked={st.settings.liveFollow} onChange={(e) => void api.invoke('pco.setSettings', { liveFollow: e.target.checked }).then(load)} /> Drive PCO Live
            </label>
          </div>
          {a.error && <div className="ix-err">{a.error}</div>}
          <div className="ix-list" data-testid="pco-plans">
            {!plans.length && <div className="dim">{a.busy ? 'Loading plans…' : 'No upcoming plans in this service type.'}</div>}
            {plans.map((p, i) => (
              <div key={p.id}>
                <div className="grow">
                  <strong>{p.dates}</strong>{p.title && <span> — {p.title}</span>}
                  <div className="dim" style={{ fontSize: 12 }}>{[p.seriesTitle, p.times.filter((t) => t.type === 'service').map((t) => new Date(t.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })).join(' & ')].filter(Boolean).join(' · ')}</div>
                </div>
                {pulledIds.has(p.id) && <span className="ix-tag add">In the app</span>}
                <Button size="sm" variant={i === 0 ? 'primary' : 'default'} onClick={() => setPull(p)} data-testid={`pco-pull-${i}`}>{pulledIds.has(p.id) ? 'Update' : i === 0 ? 'Pull this Sunday' : 'Pull'}</Button>
              </div>
            ))}
          </div>
        </>
      )}
      {pull && <PlanPullModal serviceTypeId={pull.serviceTypeId} planId={pull.id} onClose={() => setPull(null)} />}
    </div>
  )
}

const TAG: Record<PlanChange['type'], [string, string]> = { added: ['add', 'New'], removed: ['del', 'Removed'], updated: ['upd', 'Changed'], moved: ['upd', 'Moved'], conflict: ['cfl', 'Both changed'], song: ['upd', 'Song'] }

/** Review screen for pulling / re-pulling a plan: changes with accept/keep, song matches, timers. */
export function PlanPullModal({ serviceTypeId, planId, playlistId, onClose }: { serviceTypeId?: string; planId?: string; playlistId?: string; onClose: () => void }): ReactNode {
  const [pv, setPv] = useState<PlanPullPreview | null>(null)
  const [decisions, setDecisions] = useState<Record<string, 'accept' | 'reject'>>({})
  const [songs, setSongs] = useState<Record<string, SongDecision>>({})
  const [timers, setTimers] = useState<string[]>([])
  const a = useAction()
  const library = useApp((s) => s.library)
  const select = useApp((s) => s.select)
  const setView = useApp((s) => s.setView)
  useEffect(() => {
    void a.run(async () => {
      const r = playlistId ? await api.invoke('pco.check', { playlistId }) : await api.invoke('pco.preview', { serviceTypeId: serviceTypeId!, planId: planId! })
      setPv(r)
      setTimers(r.timerSuggestions.filter((t) => !t.exists).map((t) => t.id))
      const init: Record<string, SongDecision> = {}
      for (const s of r.songs) if (!s.presentationId) init[s.pcoItemId] = s.candidates[0] && s.candidates[0].score > 0.7 ? { action: 'use', presentationId: s.candidates[0].id } : s.arrangement ? { action: 'import' } : { action: 'placeholder' }
      setSongs(init)
    })
  }, [])
  const unmatched = pv?.songs.filter((s) => !s.presentationId) ?? []
  const effective = (c: PlanChange): 'accept' | 'reject' => decisions[c.id] ?? c.default
  const counts = useMemo(() => pv?.changes.length ?? 0, [pv])
  const go = (): void => void a.run(async () => {
    const r = await api.invoke('pco.pull', { serviceTypeId: pv!.plan.serviceTypeId, planId: pv!.plan.id, decisions, songs, timers })
    toast(pv!.playlistExists ? `Updated from Planning Center (${r.applied} change${r.applied === 1 ? '' : 's'})` : 'Service plan pulled from Planning Center', 'success', r.playlist.name)
    select({ selectedPlaylistId: r.playlist.id })
    onClose()
    if (!playlistId) setView('show')
  })

  return (
    <Modal title={pv ? `${pv.playlistExists ? 'Update' : 'Pull'} “${[pv.plan.dates, pv.plan.title].filter(Boolean).join(' — ')}”` : 'Planning Center'} onClose={onClose} width={980}
      footer={<>
        {a.error && <span className="ix-err grow">{a.error}</span>}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!pv || a.busy} onClick={go} data-testid="pco-apply">{a.busy ? 'Working…' : pv?.playlistExists ? (counts ? `Apply ${pv.changes.filter((c) => effective(c) === 'accept').length} change(s)` : 'Nothing to update') : `Create service plan (${pv?.itemCount ?? 0} items)`}</Button>
      </>}>
      {!pv && <div className="dim">{a.busy ? 'Reading the plan from Planning Center…' : a.error}</div>}
      {pv && (
        <div className="col" style={{ gap: 14 }} data-testid="pco-review">
          {Object.keys(pv.roles).length > 0 && (
            <div className="ix-row ix-help">{Object.entries(pv.roles).map(([r, names]) => <span key={r}><b>{r}:</b> {names.join(', ')}</span>)}</div>
          )}
          {pv.playlistExists && (
            <div className="col">
              <div className="panel-title" style={{ padding: 0 }}>{pv.changes.length ? `${pv.changes.length} change${pv.changes.length > 1 ? 's' : ''} from Planning Center` : 'Up to date — nothing changed in Planning Center'}</div>
              {pv.changes.length > 0 && (
                <div className="ix-list">
                  {pv.changes.map((c) => (
                    <div key={c.id}>
                      <span className={`ix-tag ${TAG[c.type][0]}`}>{TAG[c.type][1]}</span>
                      <div className="grow"><strong>{c.title}</strong> <span className="dim">— {c.detail}</span></div>
                      <Select value={effective(c)} onChange={(e) => setDecisions({ ...decisions, [c.id]: e.target.value as 'accept' | 'reject' })}>
                        <option value="accept">{c.type === 'conflict' ? 'Use Planning Center' : 'Accept'}</option>
                        <option value="reject">{c.type === 'conflict' ? 'Keep mine' : 'Skip'}</option>
                      </Select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="ix-plan">
          <div className="col">
            <div className="panel-title" style={{ padding: 0 }}>Order of service</div>
            <div className="ix-list" style={{ maxHeight: 420, overflow: 'auto' }} data-testid="pco-items">
              {pv.items.map((it) => it.kind === 'header'
                ? <div key={it.id} className="ix-plan-item hdr"><span /><span>{it.title}</span><span /></div>
                : (
                  <div key={it.id} className="ix-plan-item">
                    <span className="ix-mono">{fmtLen(it.length)}</span>
                    <span>{it.title}{it.key && <span className="dim"> · {it.key}</span>}{it.people && <span className="dim"> — {it.people.join(', ')}</span>}{it.position && it.position !== 'during' && <span className="dim"> ({it.position}-service)</span>}</span>
                    <span className={`ix-tag ${it.kind === 'song' ? 'add' : ''}`}>{KIND[it.kind]}</span>
                  </div>
                ))}
            </div>
          </div>
          <div className="col" style={{ gap: 14 }}>
          <div className="col">
            <div className="panel-title" style={{ padding: 0 }}>Songs</div>
            <div className="ix-list" data-testid="pco-songs">
              {pv.songs.map((s) => (
                <div key={s.pcoItemId}>
                  <div className="grow">
                    <strong>{s.song.title}</strong>
                    <span className="dim">{[s.song.author, s.song.ccli && `CCLI ${s.song.ccli}`, s.arrangement?.name].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>
                  </div>
                  {s.presentationId ? (
                    <span className="ix-tag add" title={`Matched by ${s.confidence}`}>✓ {s.presentationTitle}</span>
                  ) : (
                    <Select value={songs[s.pcoItemId]?.action === 'use' ? `use:${(songs[s.pcoItemId] as { presentationId: string }).presentationId}` : songs[s.pcoItemId]?.action ?? 'placeholder'}
                      onChange={(e) => { const v = e.target.value; setSongs({ ...songs, [s.pcoItemId]: v.startsWith('use:') ? { action: 'use', presentationId: v.slice(4) } : { action: v as 'import' | 'placeholder' } }) }}>
                      {s.arrangement && <option value="import">Import lyrics from Planning Center</option>}
                      <option value="placeholder">Leave a placeholder</option>
                      {s.candidates.map((c) => <option key={c.id} value={`use:${c.id}`}>Use “{c.title}” ({Math.round(c.score * 100)}%)</option>)}
                      <optgroup label="All songs">
                        {library.filter((l) => l.kind === 'song' && !s.candidates.some((c) => c.id === l.id)).map((l) => <option key={l.id} value={`use:${l.id}`}>{l.title}</option>)}
                      </optgroup>
                    </Select>
                  )}
                </div>
              ))}
              {!pv.songs.length && <div className="dim">No songs in this plan.</div>}
            </div>
            {unmatched.length > 0 && <div className="ix-help">{unmatched.length} song{unmatched.length > 1 ? 's' : ''} not in the library yet. Importing uses the lyrics and section order from the arrangement in Planning Center; CCLI SongSelect files can be imported later and will be matched by CCLI number.</div>}
          </div>
          {pv.timerSuggestions.length > 0 && (
            <div className="col">
              <div className="panel-title" style={{ padding: 0 }}>Countdowns</div>
              <div className="ix-row">
                {pv.timerSuggestions.map((t) => (
                  <label key={t.id} className="ix-row">
                    <input type="checkbox" disabled={t.exists} checked={t.exists || timers.includes(t.id)} onChange={(e) => setTimers(e.target.checked ? [...timers, t.id] : timers.filter((x) => x !== t.id))} />
                    {t.name}{t.exists && <span className="dim"> (already set up)</span>}
                  </label>
                ))}
              </div>
            </div>
          )}
          </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

const KIND: Record<string, string> = { song: 'Song', sermon: 'Sermon', announcements: 'Announcements', media: 'Media', scripture: 'Scripture', generic: 'Item', header: '' }

/** Panel on the Show screen: Planning Center changes waiting + quick fill from Notion. */
export function ServiceSyncPanel(): ReactNode {
  const pid = useApp((s) => s.selectedPlaylistId)
  const pl = useApp((s) => s.playlists.find((p) => p.id === pid))
  const [pending, setPending] = useState<Record<string, PlanChange[]>>({})
  const [review, setReview] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void api.invoke('pco.pending').then(setPending).catch(() => {}) }, [pid])
  useEvent('pco.changes', ({ playlistId, changes }) => setPending((p) => ({ ...p, [playlistId]: changes })))
  if (!pl) return null
  const fromPco = pl.source?.type === 'pco'
  const n = pending[pl.id]?.length ?? 0
  const placeholders = pl.items.filter((i) => i.type === 'placeholder')
  const fillNotion = async (): Promise<void> => {
    setBusy(true)
    try {
      const f = await api.invoke('notion.forPlaylist', { playlistId: pl.id })
      let done = 0
      if (f.sermons[0]) { await api.invoke('notion.import', { which: 'sermons', pageIds: [f.sermons[0].id], playlistId: pl.id }); done++ }
      if (f.announcements.length) { await api.invoke('notion.import', { which: 'announcements', pageIds: f.announcements.map((x) => x.id), playlistId: pl.id }); done++ }
      toast(done ? 'Filled from Notion' : `Nothing in Notion for ${f.date ?? 'this date'}`, done ? 'success' : 'warning')
    } catch (e) { toast('Notion', 'error', errText(e)) } finally { setBusy(false) }
  }
  return (
    <div className="col" style={{ padding: 10, gap: 8 }} data-testid="sync-panel">
      {fromPco && (
        <div className="ix-row">
          <span className="grow" style={{ fontSize: 12 }}>{n ? <b style={{ color: 'var(--mustard)' }}>{n} change{n > 1 ? 's' : ''} from Planning Center</b> : <span className="dim">Planning Center: up to date{pl.source?.syncedAt ? ` (${fmtAgo(String(pl.source.syncedAt))})` : ''}</span>}</span>
          <Button size="sm" variant={n ? 'primary' : 'default'} onClick={() => setReview(true)}>{n ? 'Review' : 'Check now'}</Button>
        </div>
      )}
      {placeholders.length > 0 && (
        <div className="ix-row">
          <span className="grow dim" style={{ fontSize: 12 }}>{placeholders.length} slot{placeholders.length > 1 ? 's' : ''} waiting for slides</span>
          <Button size="sm" disabled={busy} onClick={() => void fillNotion()}>{busy ? 'Filling…' : 'Fill from Notion'}</Button>
        </div>
      )}
      {review && <PlanPullModal playlistId={pl.id} onClose={() => { setReview(false); void api.invoke('pco.pending').then(setPending) }} />}
    </div>
  )
}
const fmtAgo = (iso: string): string => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString() }

export { fmtLen }
