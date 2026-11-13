import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Slide, Theme } from '@shared/model'
import type { Passage, PagingOptions, TranslationInfo, Verse } from '@shared/bible'
import { bookById, formatReference, pageVerses, parseReferences, scriptureSlides, shiftPassage } from '@shared/bible'
import { applyTheme } from '@shared/integrationsTheme'
import { SlideThumb } from '@shared/render/SlideView'
import { Button, Empty, Field, Input, Select, toast } from '@ui/index'
import { defineFeature } from '../../app/feature'
import { api, readDoc, useApp } from '../../app/store'
import './bible.css'

type Lookup = Awaited<ReturnType<typeof api.invoke<'bible.lookup'>>>
const pref = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(`reach.bible.${k}`); return v ? (JSON.parse(v) as T) : d } catch { return d } }
const setPref = (k: string, v: unknown): void => { try { localStorage.setItem(`reach.bible.${k}`, JSON.stringify(v)) } catch { /* ignore */ } }

function BibleView(): ReactNode {
  const { workspace, playlists, selectedPlaylistId, live, setView } = useApp()
  const size = workspace?.defaultSize ?? { width: 1920, height: 1080 }
  const [q, setQ] = useState(() => pref('q', 'John 3:16-18'))
  const [translations, setTranslations] = useState<TranslationInfo[]>([])
  const [tid, setTid] = useState<string>(() => pref('t', ''))
  const [par, setPar] = useState<string>(() => pref('par', ''))
  const [paging, setPaging] = useState<PagingOptions>(() => pref('paging', { mode: 'fit', versesPerSlide: 1, maxChars: 260 }))
  const [numbers, setNumbers] = useState(() => pref('numbers', true))
  const [refMode, setRefMode] = useState<'each' | 'last'>(() => pref('refMode', 'each'))
  const [themes, setThemes] = useState<Theme[]>([])
  const [themeId, setThemeId] = useState(() => pref('theme', ''))
  const [res, setRes] = useState<Lookup | null>(null)
  const [search, setSearch] = useState<Verse[]>([])
  const [busy, setBusy] = useState(false)
  const [plId, setPlId] = useState(selectedPlaylistId ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  const loadT = async (): Promise<void> => {
    const ts = await api.invoke('bible.translations').catch(() => [])
    setTranslations(ts)
    if (!tid && ts[0]) setTid((await api.invoke('bible.status').catch(() => null))?.settings.defaultTranslation ?? ts[0].id)
  }
  useEffect(() => { void loadT(); void readDoc<Theme[] | null>('themes', []).then((t) => setThemes(Array.isArray(t) ? t : [])); inputRef.current?.focus() }, [])
  useEffect(() => api.on('bible.changed', () => void loadT()), [])
  useEffect(() => { setPref('q', q); setPref('t', tid); setPref('par', par); setPref('paging', paging); setPref('numbers', numbers); setPref('refMode', refMode); setPref('theme', themeId) }, [q, tid, par, paging, numbers, refMode, themeId])

  const passages = useMemo(() => parseReferences(q), [q])
  const isRef = passages.length > 0
  useEffect(() => {
    if (!translations.length) return
    const t = setTimeout(() => {
      if (isRef) {
        setBusy(true); setSearch([])
        void api.invoke('bible.lookup', { passages, translation: tid || undefined, parallel: par ? [par] : [] }).then(setRes).catch((e) => setRes({ results: [], warnings: [String(e)] })).finally(() => setBusy(false))
      } else if (q.trim().length > 2) {
        setRes(null)
        void api.invoke('bible.search', { q, translation: tid || undefined }).then((r) => setSearch(r.verses)).catch(() => setSearch([]))
      } else { setRes(null); setSearch([]) }
    }, 220)
    return () => clearTimeout(t)
  }, [q, tid, par, translations.length, JSON.stringify(passages)])

  const theme = themes.find((t) => t.id === themeId) ?? null
  const slides: Slide[] = useMemo(() => {
    if (!res) return []
    const out: Slide[] = []
    for (const r of res.results) {
      const pages = pageVerses(r.verses, par && r.parallel[0] ? { ...paging, mode: 'verses', versesPerSlide: 1 } : paging)
      const parallel = r.parallel[0] ? { label: r.parallel[0].translation.abbreviation, pages: pages.map((pg) => pg.verses.flatMap((v) => r.parallel[0].verses.filter((x) => x.chapter === v.chapter && x.verse === v.verse))) } : undefined
      const copyright = [r.copyright, r.parallel[0]?.copyright].filter(Boolean).join('  ·  ') || undefined
      out.push(...scriptureSlides(pages, r.passage, { size, showVerseNumbers: numbers, reference: refMode, translationLabel: r.translation.abbreviation, copyright }, parallel))
    }
    return theme ? out.map((s) => applyTheme(s, theme, 'scripture')) : out
  }, [res, paging, numbers, refMode, theme, size.width, size.height])

  const title = res?.results.map((r) => `${r.reference} (${r.translation.abbreviation})`).join('; ') ?? ''
  const show = (s: Slide): void => void api.invoke('live.showSlide', { slide: s, size, title })
  const step = (dir: 1 | -1): void => {
    const r = res?.results[0]
    if (!r) return
    const next = shiftPassage(r.passage, dir, (book, ch) => (r.passage.book === book && ch === r.passage.endChapter ? (r.verses.at(-1)?.verse ?? 30) : 200))
    if (next) setQ(formatReference(next))
  }
  const save = (toPlaylist: boolean): void => void (async () => {
    if (!slides.length) return
    const p = await api.invoke('bible.save', { title, slides, playlistId: toPlaylist ? plId || undefined : undefined, themeId: themeId || undefined, copyright: res?.results[0]?.copyright })
    toast(toPlaylist ? 'Added to the service' : 'Saved to the library', 'success', p.title)
  })()
  const liveId = live.slide?.presentationId === '' ? live.slide?.slideId : undefined

  if (!translations.length) {
    return (
      <Empty title="No Bibles yet">
        <div className="col" style={{ alignItems: 'center' }}>
          <span>Download a free translation (BSB, WEB, KJV…) — it’s stored in the workspace and works offline.</span>
          <Button variant="primary" onClick={() => setView('integrations')}>Set up Bibles</Button>
        </div>
      </Empty>
    )
  }
  return (
    <div className="bv" data-testid="bible-view">
      <aside className="bv-side">
        <input ref={inputRef} className="input bv-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="jn 3 16-18 · Ps 23 · or search words" data-testid="bible-q"
          onKeyDown={(e) => { if (e.key === 'Enter' && slides[0]) show(slides[0]) }} />
        <div className="bv-hint">{isRef ? <>Showing <b>{passages.map((p) => formatReference(p)).join('; ')}</b> — press Enter to put it on screen.</> : q.trim().length > 2 ? `Searching for “${q.trim()}”…` : 'Type a reference like “jn 3 16” or “1 cor 13:4-7”.'}</div>
        <div className="ix-row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Field label="Translation"><Select value={tid} onChange={(e) => setTid(e.target.value)} data-testid="bible-t">{translations.map((t) => <option key={t.id} value={t.id}>{t.abbreviation}{t.offline ? '' : ' (online)'}</option>)}</Select></Field>
          <Field label="Side by side"><Select value={par} onChange={(e) => setPar(e.target.value)}><option value="">—</option>{translations.filter((t) => t.id !== tid).map((t) => <option key={t.id} value={t.id}>{t.abbreviation}</option>)}</Select></Field>
          <Field label="Per slide"><Select value={paging.mode === 'fit' ? `fit:${paging.maxChars}` : `v:${paging.versesPerSlide}`} onChange={(e) => { const [m, n] = e.target.value.split(':'); setPaging(m === 'fit' ? { ...paging, mode: 'fit', maxChars: Number(n) } : { ...paging, mode: 'verses', versesPerSlide: Number(n) }) }}>
            <option value="fit:180">Fit — short</option><option value="fit:260">Fit — medium</option><option value="fit:380">Fit — long</option>
            <option value="v:1">1 verse</option><option value="v:2">2 verses</option><option value="v:3">3 verses</option>
          </Select></Field>
        </div>
        <div className="ix-row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
          <label><input type="checkbox" checked={numbers} onChange={(e) => setNumbers(e.target.checked)} /> Verse numbers</label>
          <label><input type="checkbox" checked={refMode === 'last'} onChange={(e) => setRefMode(e.target.checked ? 'last' : 'each')} /> Reference on last slide only</label>
        </div>
        {themes.length > 0 && <Field label="Look"><Select value={themeId} onChange={(e) => setThemeId(e.target.value)}><option value="">Reach default</option>{themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>}
        {res?.warnings.map((w, i) => <div key={i} className="ix-warn" style={{ color: 'var(--mustard)', fontSize: 12 }}>⚠ {w}</div>)}
        {res?.results.map((r) => (
          <div key={r.reference} className="bv-verses">
            <div style={{ color: 'var(--text)', marginBottom: 4 }}><b>{r.reference}</b> · {r.translation.name}{r.fromCache ? ' (cached)' : ''}</div>
            {r.verses.map((v) => <span key={`${v.chapter}:${v.verse}`}><sup>{v.verse}</sup>{v.text} </span>)}
          </div>
        ))}
        {search.length > 0 && (
          <div className="col" style={{ gap: 2 }}>
            {search.map((v) => {
              const ref = `${bookById(v.book)?.name} ${v.chapter}:${v.verse}`
              return <div key={ref} className="bv-result" onClick={() => setQ(ref)}><b>{ref}</b> {v.text}</div>
            })}
          </div>
        )}
      </aside>
      <section className="bv-main">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button size="sm" disabled={!res?.results.length} onClick={() => step(-1)}>‹ Previous</Button>
          <Button size="sm" disabled={!res?.results.length} onClick={() => step(1)}>Next ›</Button>
          <div className="grow" style={{ flex: 1 }} />
          <Select value={plId} onChange={(e) => setPlId(e.target.value)}>{playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Button size="sm" disabled={!slides.length || !plId} onClick={() => save(true)} data-testid="bible-add">Add to service</Button>
          <Button size="sm" disabled={!slides.length} onClick={() => save(false)}>Save to library</Button>
          <Button size="sm" variant="live" disabled={!slides.length} onClick={() => slides[0] && show(slides[0])} data-testid="bible-live">Show now</Button>
        </div>
        {busy && !slides.length && <div className="dim">Looking it up…</div>}
        <div className="bv-grid">
          {slides.map((s, i) => (
            <div key={s.id + i} className={`bv-slide ${liveId === s.id ? 'live' : ''}`} onClick={() => show(s)} data-testid="bible-slide">
              <SlideThumb elements={s.elements} background={s.background} size={size} />
              <span className="lbl">{i + 1} · {s.label}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export default defineFeature({ id: 'bible', views: [{ id: 'bible', title: 'Bible', order: 40, component: BibleView }] })
export type { Passage }
