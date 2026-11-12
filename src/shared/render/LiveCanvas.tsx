import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Canvas, LayerId, LiveMedia, LiveSlide, LiveState, Region, StageLayout, TimerState, WorkspaceConfig } from '../model'
import { resolveSlideForCanvas, slideText } from '../model'
import { mediaUrl } from '../media'
import { Fit, SlideView, type Tokens } from './SlideView'

/* ───────── time helpers shared by outputs, stage screens and the operator UI ───────── */

export function timerSeconds(t: TimerState, now = Date.now()): number {
  if (t.kind === 'countdownTo' && t.target) {
    const [h, m] = t.target.split(':').map(Number)
    const d = new Date(now)
    d.setHours(h, m ?? 0, 0, 0)
    return (d.getTime() - now) / 1000
  }
  const run = (t.accumulated ?? 0) + (t.running && t.startedAt ? (now - t.startedAt) / 1000 : 0)
  return t.kind === 'elapsed' ? run : (t.duration ?? 0) - run
}

export function formatDuration(sec: number): string {
  const neg = sec < 0
  const s = Math.abs(Math.ceil(neg ? sec - 0 : sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return `${neg ? '-' : ''}${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${ss}`
}

export function useNow(intervalMs = 250, active = true): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs, active])
  return now
}

/** Tokens available to dynamic text ({clock}, {current.text}, {timer:Name}...). */
export function liveTokens(live: LiveState, now: number): Tokens {
  const d = new Date(now)
  const t: Tokens = {
    clock: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    'clock.seconds': d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }),
    date: d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }),
    'current.text': live.slide ? slideText(live.slide.slide) : '',
    'current.notes': live.slide?.slide.notes ?? '',
    'current.label': live.slide?.slide.label ?? '',
    'current.title': live.slide?.presentationTitle ?? '',
    'next.text': live.slide?.next ? slideText(live.slide.next.slide) : '',
    'next.label': live.slide?.next?.slide.label ?? '',
    stageMessage: live.stageMessage ?? '',
    message: live.messages.map((m) => m.text).join('  •  ')
  }
  for (const tm of live.timers) {
    const v = formatDuration(timerSeconds(tm, now))
    t[`timer:${tm.id}`] = v
    t[`timer:${tm.name}`] = v
  }
  if (live.timers[0]) t.timer = formatDuration(timerSeconds(live.timers[0], now))
  return t
}

/* ───────── media layer with cross-output sync ───────── */

function MediaLayer({ m, muted }: { m: LiveMedia; muted: boolean }): ReactNode {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    const sync = (): void => {
      const target = (m.offset ?? 0) + (m.playing && m.startedAt ? (Date.now() - m.startedAt) / 1000 : 0)
      const dur = v.duration
      const want = m.loop && dur && isFinite(dur) ? target % dur : dur && isFinite(dur) ? Math.min(target, dur) : target
      if (Math.abs(v.currentTime - want) > 0.35) v.currentTime = want
      if (m.playing && v.paused) void v.play().catch(() => {})
      if (!m.playing && !v.paused) v.pause()
    }
    sync()
    v.addEventListener('loadedmetadata', sync)
    const t = setInterval(sync, 2000)
    return () => { v.removeEventListener('loadedmetadata', sync); clearInterval(t) }
  }, [m.media.src, m.playing, m.startedAt, m.offset, m.loop])
  const style: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: m.fit === 'stretch' ? 'fill' : (m.fit ?? 'cover') }
  if (m.media.kind === 'image') return <img src={mediaUrl(m.media)} style={style} alt="" />
  if (m.media.kind === 'audio') return null
  return <video ref={ref} src={mediaUrl(m.media)} style={style} loop={m.loop} muted={muted || m.muted} playsInline />
}

/** Cross-fades between successive children identified by `id`. */
function Crossfade({ id, duration = 0.3, children }: { id: string; duration?: number; children: ReactNode }): ReactNode {
  const [items, setItems] = useState<{ id: string; node: ReactNode; leaving?: boolean }[]>([{ id, node: children }])
  const latest = useRef(children)
  latest.current = children
  useEffect(() => {
    setItems((prev) => {
      if (prev[prev.length - 1]?.id === id) return prev
      return [...prev.filter((p) => !p.leaving).map((p) => ({ ...p, leaving: true })), { id, node: latest.current }]
    })
    const t = setTimeout(() => setItems((prev) => prev.filter((p) => !p.leaving || p.id === id)), duration * 1000 + 50)
    return () => clearTimeout(t)
  }, [id, duration])
  return (
    <>
      {items.map((it) => (
        <div
          key={it.id}
          style={{ position: 'absolute', inset: 0, opacity: it.leaving ? 0 : 1, transition: duration ? `opacity ${duration}s ease` : undefined, animation: !it.leaving && duration ? `reach-fade-in ${duration}s ease` : undefined }}
        >
          {it.id === id ? children : it.node}
        </div>
      ))}
    </>
  )
}

function SlideLayer({ ls, canvas, tokens }: { ls: LiveSlide; canvas: Canvas; tokens: Tokens }): ReactNode {
  const r = resolveSlideForCanvas(ls.slide, ls.size, canvas)
  return (
    <Fit size={r.size}>
      <SlideView elements={r.elements} background={r.background} size={r.size} tokens={tokens} build={ls.build} />
    </Fit>
  )
}

export interface LiveCanvasProps {
  canvas: Canvas
  live: LiveState
  workspace?: WorkspaceConfig
  stageLayout?: StageLayout | null
  /** Outputs are muted unless they are the designated audio output. */
  audio?: boolean
  /** Draw region guides (operator previews). */
  showRegions?: boolean
}

/** The full layer stack for one canvas at its native pixel size. */
export function LiveCanvas({ canvas, live, workspace, stageLayout, audio, showRegions }: LiveCanvasProps): ReactNode {
  const dynamic = canvas.kind === 'stage' || live.timers.some((t) => t.running) || true
  const now = useNow(250, dynamic)
  const tokens = liveTokens(live, now)
  const on = (l: LayerId): boolean => canvas.layers?.[l] !== false && !live.cleared[l]
  const full: CSSProperties = { position: 'absolute', inset: 0 }

  let content: ReactNode
  if (canvas.kind === 'stage') {
    content = stageLayout
      ? <Fit size={stageLayout.size}><SlideView elements={stageLayout.slide.elements} background={stageLayout.slide.background} size={stageLayout.size} tokens={tokens} /></Fit>
      : <DefaultStage live={live} tokens={tokens} canvas={canvas} />
  } else {
    const fade = live.slide?.transition?.type === 'cut' ? 0 : (live.slide?.transition?.duration ?? 0.3)
    content = (
      <>
        {on('background') && live.background && <Crossfade id={live.background.media.src} duration={0.6}><MediaLayer m={live.background} muted /></Crossfade>}
        {on('video') && live.video && <div style={full}><MediaLayer m={live.video} muted={!audio} /></div>}
        {on('slide') && (
          <Crossfade id={live.slide ? `${live.slide.presentationId}:${live.slide.slideId}:${live.slide.index}` : 'none'} duration={fade}>
            {live.slide ? <SlideLayer ls={live.slide} canvas={canvas} tokens={tokens} /> : null}
          </Crossfade>
        )}
        {on('announcement') && live.announcement && <div style={full}><SlideLayer ls={live.announcement} canvas={canvas} tokens={tokens} /></div>}
        {on('props') && live.props.map((p) => (
          <div key={p.id} style={full}><Fit size={p.size}><SlideView elements={p.slide.elements} background={p.slide.background} size={p.size} tokens={tokens} /></Fit></div>
        ))}
        {on('message') && live.messages.map((m) => (
          <div key={m.id} style={{ ...full, display: 'flex', justifyContent: 'center', alignItems: m.position === 'top' ? 'flex-start' : m.position === 'center' ? 'center' : 'flex-end', padding: canvas.height * 0.05 }}>
            <div style={{ background: 'rgba(0,0,0,.78)', color: '#fff', padding: `${canvas.height * 0.018}px ${canvas.height * 0.035}px`, borderRadius: canvas.height * 0.012, fontSize: canvas.height * 0.042, fontWeight: 600, fontFamily: '"Reach Sans", "Inter", sans-serif', ...(m.style as CSSProperties) }}>
              {m.text.replace(/\{([^{}]+)\}/g, (x, k: string) => tokens[k.trim()] ?? x)}
            </div>
          </div>
        ))}
        {on('mask') && live.mask && <img src={mediaUrl(live.mask)} style={{ ...full, width: '100%', height: '100%', objectFit: 'fill' }} alt="" />}
        {live.logo && workspace?.logo && <div style={{ ...full, background: '#000' }}><img src={mediaUrl(workspace.logo)} style={{ ...full, width: '100%', height: '100%', objectFit: 'contain' }} alt="" /></div>}
        {live.blackout && <div style={{ ...full, background: '#000' }} />}
      </>
    )
  }

  return (
    <div style={{ position: 'relative', width: canvas.width, height: canvas.height, background: '#000', overflow: 'hidden' }}>
      <style>{'@keyframes reach-fade-in{from{opacity:0}to{opacity:1}}'}</style>
      {content}
      {showRegions && canvas.regions.map((r) => <RegionGuide key={r.id} region={r} />)}
    </div>
  )
}

export function RegionGuide({ region, color = 'rgba(56,134,206,.9)' }: { region: Region; color?: string }): ReactNode {
  return (
    <div style={{ position: 'absolute', left: region.rect.x, top: region.rect.y, width: region.rect.w, height: region.rect.h, outline: `3px dashed ${color}`, outlineOffset: -2, pointerEvents: 'none' }}>
      <span style={{ position: 'absolute', left: 8, top: 6, background: color, color: '#fff', font: '600 22px/1.3 system-ui', padding: '2px 10px', borderRadius: 4 }}>{region.name}</span>
    </div>
  )
}

/** Built-in confidence monitor used when no custom stage layout exists. */
function DefaultStage({ live, tokens, canvas }: { live: LiveState; tokens: Tokens; canvas: Canvas }): ReactNode {
  const u = canvas.height / 100
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000', color: '#fff', fontFamily: '"Reach Sans", "Inter", system-ui, sans-serif', display: 'grid', gridTemplateRows: 'auto 1fr auto auto', padding: 3 * u, gap: 2 * u }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 5 * u, fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ fontWeight: 700 }}>{tokens.clock}</span>
        <span style={{ opacity: 0.6, fontSize: 3 * u }}>{tokens['current.title']}{tokens['current.label'] ? ` — ${tokens['current.label']}` : ''}</span>
        <span style={{ display: 'flex', gap: 4 * u }}>
          {live.timers.map((t) => {
            const s = timerSeconds(t)
            return <span key={t.id} style={{ color: s < 0 ? '#ff5a4f' : s < 60 && t.kind !== 'elapsed' ? '#E6A20F' : '#fff' }}><small style={{ fontSize: 2.2 * u, opacity: 0.6, marginRight: u }}>{t.name}</small>{tokens[`timer:${t.id}`]}</span>
          })}
        </span>
      </div>
      <div style={{ fontSize: 8.5 * u, fontWeight: 700, lineHeight: 1.15, whiteSpace: 'pre-wrap', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>{tokens['current.text']}</div>
      <div style={{ fontSize: 5 * u, lineHeight: 1.15, whiteSpace: 'pre-wrap', color: '#9a9a9a', borderTop: `${u * 0.2}px solid #333`, paddingTop: 2 * u, minHeight: 14 * u, overflow: 'hidden' }}>
        <div style={{ fontSize: 2 * u, letterSpacing: '.15em', textTransform: 'uppercase', color: '#E6A20F', marginBottom: u }}>Next</div>
        {tokens['next.text']}
      </div>
      {live.stageMessage ? <div style={{ background: '#E6A20F', color: '#1b1b1b', fontSize: 5 * u, fontWeight: 700, padding: `${1.5 * u}px ${3 * u}px`, borderRadius: u, textAlign: 'center' }}>{live.stageMessage}</div> : <div />}
    </div>
  )
}

/**
 * What a physical output shows: the canvas (or one region of it) scaled to fill the window.
 */
export function OutputSurface({ regionId, fit = 'contain', ...props }: LiveCanvasProps & { regionId?: string; fit?: 'contain' | 'cover' | 'stretch' }): ReactNode {
  const region = regionId ? props.canvas.regions.find((r) => r.id === regionId) : undefined
  const size = region ? { width: region.rect.w, height: region.rect.h } : { width: props.canvas.width, height: props.canvas.height }
  return (
    <Fit size={size} fit={fit} style={{ background: '#000' }}>
      <div style={{ position: 'absolute', left: region ? -region.rect.x : 0, top: region ? -region.rect.y : 0 }}>
        <LiveCanvas {...props} />
      </div>
    </Fit>
  )
}
