import { useEffect, useState, type ReactNode } from 'react'
import type { DocSlideChange, IntegrationStatus, NotionDbInfo, NotionMapping, NotionPageSummary, NotionSettings, SlideDraft } from '@shared/integrations'
import type { Theme } from '@shared/model'
import { Button, Field, Input, Modal, Select, toast } from '@ui/index'
import { api, readDoc, useApp } from '../../app/store'
import { Logo, StatusLine, openUrl, useAction, useEvent } from './common'

type Which = 'sermons' | 'announcements'
type NStatus = IntegrationStatus & { settings: NotionSettings }

export function NotionCard(): ReactNode {
  const [st, setSt] = useState<NStatus | null>(null)
  const [dbs, setDbs] = useState<NotionDbInfo[]>([])
  const [token, setToken] = useState('')
  const [which, setWhich] = useState<Which>('sermons')
  const [pages, setPages] = useState<NotionPageSummary[]>([])
  const [open, setOpen] = useState<{ which: Which; ids: string[] } | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  const a = useAction()
  const load = async (): Promise<void> => { setSt(await api.invoke('notion.status')) }
  useEffect(() => { void load() }, [])
  useEvent('notion.statusChanged', () => void load())
  useEffect(() => { if (st?.connected) void a.run(async () => setDbs(await api.invoke('notion.databases'))) }, [st?.connected])
  const mapping = st?.settings[which]
  useEffect(() => {
    if (!st?.connected || !mapping) { setPages([]); return }
    void a.run(async () => setPages(await api.invoke('notion.pages', { which, upcoming: true })))
  }, [st?.connected, which, mapping?.databaseId, mapping?.filterValue, mapping?.titleContains])
  const dbName = (id?: string): string => dbs.find((d) => d.id === id)?.title ?? (id ? 'Database' : 'Not chosen')

  return (
    <div className="ix-card wide" data-testid="notion-card">
      <div className="ix-card-head">
        <Logo text="N" color="#111" />
        <div className="grow">
          <div className="ix-title">Notion — sermons & announcements</div>
          <StatusLine s={st} />
        </div>
        {st?.connected && <Button size="sm" variant="ghost" onClick={() => setMapOpen(true)}>Databases & rules</Button>}
        {st?.connected && <Button size="sm" variant="ghost" onClick={() => void a.run(async () => { await api.invoke('notion.disconnect'); await load() })}>Disconnect</Button>}
      </div>
      {st && !st.connected && (
        <>
          <div className="ix-help">
            Turn the pastor’s Notion page into sermon slides, and the weekly highlights into an announcements loop.
            <ol>
              <li>Go to <a onClick={() => openUrl('https://www.notion.so/profile/integrations')}>notion.so/profile/integrations</a> → <b>New integration</b> → name it “Reach Presenter”, type <b>Internal</b>. Capabilities: <b>Read content</b> and <b>Read comments</b> (comments become operator notes).</li>
              <li>Copy the <b>Internal Integration Secret</b> and paste it here.</li>
              <li>In Notion, open the <b>Services</b> database (sermons) and the announcements database → <b>•••</b> → <b>Connections</b> → add “Reach Presenter”.</li>
            </ol>
          </div>
          <div className="ix-row">
            <Input placeholder="ntn_… or secret_…" type="password" value={token} onChange={(e) => setToken(e.target.value)} style={{ flex: 1 }} data-testid="notion-token" />
            <Button variant="primary" disabled={!token || a.busy} data-testid="notion-connect" onClick={() => void a.run(async () => { await api.invoke('notion.connect', { token }); setToken(''); toast('Notion connected', 'success'); await load() })}>{a.busy ? 'Checking…' : 'Connect'}</Button>
          </div>
        </>
      )}
      {st?.connected && (
        <>
          <div className="ix-row">
            <Button size="sm" active={which === 'sermons'} onClick={() => setWhich('sermons')}>Sermons · {dbName(st.settings.sermons?.databaseId)}</Button>
            <Button size="sm" active={which === 'announcements'} onClick={() => setWhich('announcements')}>Announcements · {dbName(st.settings.announcements?.databaseId)}</Button>
          </div>
          {!mapping && <div className="ix-warn">Choose the {which} database under “Databases & rules” (share it with the integration first).</div>}
          {a.error && <div className="ix-err">{a.error}</div>}
          {mapping && (
            <div className="ix-list" data-testid="notion-pages">
              {!pages.length && <div className="dim">{a.busy ? 'Loading…' : 'No upcoming pages found.'}</div>}
              {pages.map((p) => (
                <div key={p.id}>
                  <div className="grow">
                    <strong>{p.title}</strong>
                    <div className="dim" style={{ fontSize: 12 }}>{[p.date, p.speaker?.join(', '), p.series, p.status].filter(Boolean).join(' · ')}</div>
                  </div>
                  <Button size="sm" onClick={() => setOpen({ which, ids: [p.id] })}>Preview</Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {open && <NotionImportModal which={open.which} pageIds={open.ids} onClose={() => setOpen(null)} />}
      {mapOpen && st && <MappingModal dbs={dbs} settings={st.settings} onClose={() => { setMapOpen(false); void load() }} />}
    </div>
  )
}

function MappingModal({ dbs, settings, onClose }: { dbs: NotionDbInfo[]; settings: NotionSettings; onClose: () => void }): ReactNode {
  const [s, setS] = useState(settings)
  const save = async (): Promise<void> => { await api.invoke('notion.setSettings', s); onClose() }
  const editor = (which: Which, label: string): ReactNode => {
    const m = s[which]
    const db = dbs.find((d) => d.id === m?.databaseId)
    const set = (patch: Partial<NotionMapping>): void => setS({ ...s, [which]: { ...(m ?? { databaseId: '' }), ...patch } })
    const props = (types: string[]): ReactNode[] => (db?.properties ?? []).filter((p) => types.includes(p.type)).map((p) => <option key={p.name} value={p.name}>{p.name}</option>)
    return (
      <div className="col">
        <div className="panel-title" style={{ padding: 0 }}>{label}</div>
        <div className="ix-row">
          <Field label="Database"><Select value={m?.databaseId ?? ''} onChange={(e) => set({ databaseId: e.target.value })}><option value="">—</option>{dbs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</Select></Field>
          <Field label="Date"><Select value={m?.date ?? ''} onChange={(e) => set({ date: e.target.value || undefined })}><option value="">—</option>{props(['date'])}</Select></Field>
          <Field label="Speaker"><Select value={m?.speaker ?? ''} onChange={(e) => set({ speaker: e.target.value || undefined })}><option value="">—</option>{props(['people', 'rich_text', 'select', 'multi_select'])}</Select></Field>
          <Field label="Status"><Select value={m?.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}><option value="">—</option>{props(['status', 'select'])}</Select></Field>
          <Field label="Series"><Select value={m?.series ?? ''} onChange={(e) => set({ series: e.target.value || undefined })}><option value="">—</option>{props(['relation', 'select', 'rich_text', 'multi_select'])}</Select></Field>
        </div>
        <div className="ix-row">
          <Field label="Only if property…"><Select value={m?.filterProp ?? ''} onChange={(e) => set({ filterProp: e.target.value || undefined })}><option value="">(any)</option>{props(['select', 'multi_select', 'status'])}</Select></Field>
          <Field label="…contains"><Select value={m?.filterValue ?? ''} onChange={(e) => set({ filterValue: e.target.value || undefined })}><option value="">—</option>{db?.properties.find((p) => p.name === m?.filterProp)?.options?.map((o) => <option key={o}>{o}</option>)}</Select></Field>
          <Field label="Title contains"><Input value={m?.titleContains ?? ''} onChange={(e) => set({ titleContains: e.target.value || undefined })} placeholder="e.g. Highlight" /></Field>
        </div>
      </div>
    )
  }
  return (
    <Modal title="Notion databases & slide rules" onClose={onClose} width={880} footer={<><Button onClick={() => void api.invoke('notion.autoDetect').then((x) => setS(x))}>Auto-detect</Button><div className="grow" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save</Button></>}>
      <div className="col" style={{ gap: 16 }}>
        {editor('sermons', 'Sermons')}
        {editor('announcements', 'Announcements')}
        <div className="ix-row">
          <Field label="Slides are separated by"><Select value={s.slideMode} onChange={(e) => setS({ ...s, slideMode: e.target.value as NotionSettings['slideMode'] })}><option value="auto">Automatic</option><option value="dividers">Divider lines</option><option value="headings">Headings</option></Select></Field>
          <Field label="Scripture without a translation is"><Input value={s.defaultTranslation} onChange={(e) => setS({ ...s, defaultTranslation: e.target.value.toUpperCase() })} style={{ width: 80 }} /></Field>
          <Field label="Fill missing verses from"><Input value={s.fillTranslation} onChange={(e) => setS({ ...s, fillTranslation: e.target.value.toUpperCase() })} style={{ width: 80 }} /></Field>
          <Field label="Bold in scripture shows as"><Select value={s.emphasis} onChange={(e) => setS({ ...s, emphasis: e.target.value as 'underline' | 'bold' })}><option value="underline">Underline</option><option value="bold">Bold</option></Select></Field>
          <Field label="Announcement seconds"><Input type="number" value={s.announcementSeconds} onChange={(e) => setS({ ...s, announcementSeconds: Number(e.target.value) || 10 })} style={{ width: 70 }} /></Field>
          <label className="ix-row ix-help"><input type="checkbox" checked={s.readComments} onChange={(e) => setS({ ...s, readComments: e.target.checked })} /> Comments → operator notes</label>
        </div>
      </div>
    </Modal>
  )
}

const CHG: Record<DocSlideChange['type'], [string, string]> = { added: ['add', 'New'], removed: ['del', 'Removed'], changed: ['upd', 'Updated'], conflict: ['cfl', 'You restyled it'], same: ['', ''] }

export function NotionImportModal({ which, pageIds, onClose }: { which: Which; pageIds: string[]; onClose: () => void }): ReactNode {
  const [pv, setPv] = useState<Awaited<ReturnType<typeof api.invoke<'notion.preview'>>> | null>(null)
  const [decisions, setDecisions] = useState<Record<string, 'accept' | 'reject'>>({})
  const [themes, setThemes] = useState<Theme[]>([])
  const [themeId, setThemeId] = useState('')
  const [progress, setProgress] = useState('')
  const a = useAction()
  const { select, setView } = useApp()
  useEvent('notion.progress', ({ message }) => setProgress(message))
  useEffect(() => {
    void a.run(async () => setPv(await api.invoke('notion.preview', { which, pageIds })))
    void readDoc<Theme[] | null>('themes', []).then((t) => setThemes(Array.isArray(t) ? t : []))
  }, [])
  const changes = (pv?.changes ?? []).filter((c) => c.type !== 'same')
  const go = (): void => void a.run(async () => {
    const r = await api.invoke('notion.import', { which, pageIds, decisions, themeId: themeId || undefined })
    toast(pv?.presentationId ? 'Updated from Notion' : 'Imported from Notion', 'success', r.attached ? `Added to “${r.attached.playlistName}”` : r.presentation.title)
    for (const w of r.warnings.slice(0, 3)) toast(w, 'warning')
    if (r.attached) select({ selectedPlaylistId: r.attached.playlistId, selectedPlaylistItemId: r.attached.itemId, selectedPresentationId: r.presentation.id })
    else select({ selectedPresentationId: r.presentation.id })
    onClose()
    setView('show')
  })
  return (
    <Modal title={pv ? `${pv.pages[0]?.title ?? 'Notion page'}${pv.pages[0]?.date ? ` · ${pv.pages[0].date}` : ''}` : 'Reading Notion…'} onClose={onClose} width={1040}
      footer={<>
        {a.error && <span className="ix-err grow">{a.error}</span>}
        {!a.error && <span className="dim grow">{a.busy ? progress : pv?.target ? `Will go into “${pv.target.playlistName}”` : pv ? 'No service plan for this date — it will be saved to the library.' : ''}</span>}
        {themes.length > 0 && <Select value={themeId} onChange={(e) => setThemeId(e.target.value)}><option value="">Default look</option>{themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!pv || a.busy} onClick={go} data-testid="notion-apply">{a.busy && pv ? 'Importing…' : pv?.presentationId ? `Update (${changes.length} change${changes.length === 1 ? '' : 's'})` : `Import ${pv?.drafts.length ?? 0} slides`}</Button>
      </>}>
      {!pv && <div className="dim">{a.busy ? progress || 'Reading the page…' : a.error}</div>}
      {pv && (
        <div className="col" style={{ gap: 12 }} data-testid="notion-review">
          {pv.warnings.map((w, i) => <div key={i} className="ix-warn">⚠ {w}</div>)}
          {pv.presentationId && (
            <div className="ix-list">
              {!changes.length && <div className="dim">No changes since the last import.</div>}
              {changes.map((c) => (
                <div key={c.key}>
                  <span className={`ix-tag ${CHG[c.type][0]}`}>{CHG[c.type][1]}</span>
                  <div className="grow"><strong>{c.label || 'Slide'}</strong>{c.detail && <span className="dim"> — {c.detail}</span>}</div>
                  <Select value={decisions[c.key] ?? (c.type === 'conflict' ? 'reject' : 'accept')} onChange={(e) => setDecisions({ ...decisions, [c.key]: e.target.value as 'accept' | 'reject' })}>
                    <option value="accept">{c.type === 'conflict' ? 'Use Notion' : 'Accept'}</option><option value="reject">{c.type === 'conflict' ? 'Keep mine' : 'Skip'}</option>
                  </Select>
                </div>
              ))}
            </div>
          )}
          <div className="ix-drafts">{pv.drafts.map((d, i) => <Draft key={d.key} d={d} n={i + 1} />)}</div>
        </div>
      )}
    </Modal>
  )
}

function Draft({ d, n }: { d: SlideDraft; n: number }): ReactNode {
  return (
    <div className="ix-draft" title={d.notes ? `Notes: ${d.notes}` : undefined}>
      <span className="k">{d.kind}</span>
      <span>{d.text.slice(0, 220)}</span>
      <span className="n">{n}{d.notes ? ' · notes' : ''}{d.warnings ? ' · ⚠' : ''}</span>
    </div>
  )
}
