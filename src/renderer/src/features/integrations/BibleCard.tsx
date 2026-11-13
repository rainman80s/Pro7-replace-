import { useEffect, useState, type ReactNode } from 'react'
import { Button, Input, Select, toast } from '@ui/index'
import { api } from '../../app/store'
import { Logo, StatusLine, openUrl, useAction, useEvent } from './common'

type BStatus = Awaited<ReturnType<typeof api.invoke<'bible.status'>>>
type Cat = Awaited<ReturnType<typeof api.invoke<'bible.catalog'>>>

const KEY_HELP: Record<string, ReactNode> = {
  apibible: <>Free key at <a onClick={() => openUrl('https://scripture.api.bible')}>scripture.api.bible</a> (American Bible Society) — many translations; each shows its copyright line.</>,
  esv: <>Free church key at <a onClick={() => openUrl('https://api.esv.org/account/create-application/')}>api.esv.org</a> (Crossway).</>
}

export function BibleCard(): ReactNode {
  const [st, setSt] = useState<BStatus | null>(null)
  const [cat, setCat] = useState<Cat>([])
  const [all, setAll] = useState(false)
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [cloud, setCloud] = useState<Cat>([])
  const [downloading, setDownloading] = useState<Record<string, string>>({})
  const a = useAction()
  const load = async (): Promise<void> => {
    setSt(await api.invoke('bible.status'))
    setCat(await api.invoke('bible.catalog', { provider: 'offline', all }).catch(() => cat))
  }
  useEffect(() => { void load() }, [all])
  useEvent('bible.changed', () => void load(), [all])
  useEvent('bible.progress', ({ id, state, message }) => setDownloading((d) => { const n = { ...d }; if (state === 'downloading') n[id] = 'Downloading…'; else delete n[id]; if (state === 'error') toast('Bible download failed', 'error', message); return n }))
  const translations = st ? [...cat.filter((c) => c.installed), ...st.settings.cloud.map((c) => ({ id: c.id, abbreviation: c.abbreviation, name: c.name }))] : []

  return (
    <div className="ix-card" data-testid="bible-card">
      <div className="ix-card-head">
        <Logo text="B" color="#8a5a2b" />
        <div className="grow">
          <div className="ix-title">Bibles</div>
          <StatusLine s={st} okText="Ready" offText="No Bibles downloaded yet" />
        </div>
      </div>
      <div className="ix-help">Free public-domain Bibles live in the workspace, so every Reach computer has them — and they work offline on Sunday.</div>
      <div className="ix-list">
        {cat.slice(0, all ? 200 : 8).map((c) => (
          <div key={c.id}>
            <strong style={{ width: 64 }}>{c.abbreviation}</strong>
            <span className="grow">{c.name}<span className="dim" style={{ fontSize: 11 }}>{c.license ? ` · ${c.license}` : ''}</span></span>
            {c.installed ? <Button size="sm" variant="ghost" onClick={() => void api.invoke('bible.remove', { id: c.id })}>Remove</Button>
              : <Button size="sm" disabled={!!downloading[c.id]} data-testid={`bible-dl-${c.abbreviation}`} onClick={() => void a.run(() => api.invoke('bible.download', { id: c.id, abbreviation: c.abbreviation }))}>{downloading[c.id] ?? 'Download'}</Button>}
          </div>
        ))}
      </div>
      <div className="ix-row"><Button size="sm" variant="ghost" onClick={() => setAll(!all)}>{all ? 'Fewer' : 'More public-domain translations & languages…'}</Button></div>
      {translations.length > 0 && st && (
        <div className="ix-row ix-help">Default translation
          <Select value={st.settings.defaultTranslation ?? translations[0]?.id} onChange={(e) => void api.invoke('bible.setDefault', { id: e.target.value })}>{translations.map((t) => <option key={t.id} value={t.id}>{t.abbreviation} — {t.name}</option>)}</Select>
        </div>
      )}
      <details>
        <summary>NIV, ESV, CSB, NLT… (licensed — bring your own key)</summary>
        <div className="col" style={{ marginTop: 8 }}>
          {st?.providers.map((p) => (
            <div key={p.id} className="col" style={{ gap: 4 }}>
              <div className="ix-row"><strong className="grow">{p.name}</strong>{p.hasKey && <span className="ix-tag add">Key saved</span>}</div>
              <div className="ix-help">{KEY_HELP[p.id]} {p.note}</div>
              <div className="ix-row">
                <Input type="password" placeholder={p.hasKey ? '•••••••• (saved)' : 'API key'} value={keys[p.id] ?? ''} onChange={(e) => setKeys({ ...keys, [p.id]: e.target.value })} style={{ flex: 1 }} />
                <Button size="sm" disabled={!keys[p.id] || a.busy} onClick={() => void a.run(async () => { await api.invoke('bible.setKey', { provider: p.id, key: keys[p.id] }); setKeys({ ...keys, [p.id]: '' }); toast(`${p.name} key saved`, 'success') })}>Save</Button>
                {p.hasKey && <Button size="sm" variant="ghost" onClick={() => void api.invoke('bible.setKey', { provider: p.id, key: null })}>Remove</Button>}
                {p.hasKey && p.id === 'apibible' && <Button size="sm" onClick={() => void a.run(async () => setCloud(await api.invoke('bible.catalog', { provider: 'apibible' })))}>Choose translations</Button>}
              </div>
            </div>
          ))}
          {cloud.length > 0 && (
            <div className="ix-list" style={{ maxHeight: 240, overflow: 'auto' }}>
              {cloud.map((c) => (
                <label key={c.id} className="ix-pick">
                  <input type="checkbox" checked={c.installed} onChange={(e) => void api.invoke('bible.enableCloud', { translation: { id: c.id, name: c.name, abbreviation: c.abbreviation, provider: 'apibible', offline: false, copyright: c.license }, enabled: e.target.checked }).then(async () => setCloud(await api.invoke('bible.catalog', { provider: 'apibible' })))} />
                  <strong style={{ width: 70 }}>{c.abbreviation}</strong><span className="grow">{c.name}</span>
                </label>
              ))}
            </div>
          )}
          <div className="ix-help">YouVersion and Bible Gateway don’t offer a public API for presentation use, so they aren’t included. CSB/NIV/NLT are available through API.Bible where the publisher has licensed them.</div>
        </div>
      </details>
      {a.error && <div className="ix-err">{a.error}</div>}
    </div>
  )
}
