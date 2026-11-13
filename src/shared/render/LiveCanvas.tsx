import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Canvas, LayerId, LiveMedia, LiveSlide, LiveState, Rect, Region, Slide, StageLayout, TimerState, Transition, WorkspaceConfig } from '../model'
import { resolveSlideForCanvas, slideText } from '../model'
import { mediaUrl } from '../media'
import { driftCorrection, mediaPosition } from '../outputs'
import { Fit, SlideView, type Tokens } from './SlideView'

/* ───────── time helpers shared by outputs, stage screens and the operator UI ───────── */

/**
 * Network receivers estimate how far their clock is from the host's (NTP-style, see @shared/outputs ClockSync)
 * and set it here, so video positions (`LiveMedia.startedAt`) and timers agree on every screen.
 */
let clockOffsetMs = 0
export function setClockOffset(ms: number): void { clockOffsetMs = Number.isFinite(ms) ? ms : 0 }
export function serverNow(): number { return Date.now() + clockOffsetMs }

export function timerSeconds(t: TimerState, now = serverNow()): number {
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
  const [now, setNow] = useState(serverNow())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(serverNow()), intervalMs)
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

/* ───────── media with cross-output sync ───────── */

/**
 * Keeps a <video>/<audio> where the live state says it should be (`startedAt` + `offset`, on the host clock):
 * small drift is corrected by nudging playbackRate (invisible), large drift by seeking. `frozen` pauses it.
 */
export function useSyncedMedia(ref: { current: HTMLMediaElement | null }, m: LiveMedia | null, frozen = false): void {
  useEffect(() => {
    const v = ref.current
    if (!v || !m) return
    const sync = (): void => {
      if (frozen) { if (!v.paused) v.pause(); return }
      const want = mediaPosition(m, serverNow(), v.duration)
      if (!m.playing) {
        if (!v.paused) v.pause()
        if (Math.abs(v.currentTime - want) > 0.05) v.currentTime = want
        return
      }
      const dur = v.duration
      // Near a loop point the native loop is in charge; don't fight it.
      const nearWrap = m.loop && dur && isFinite(dur) && (want < 0.3 || dur - want < 0.3)
      const c = driftCorrection(v.currentTime, want)
      if (c.seek != null && !nearWrap) v.currentTime = c.seek
      v.playbackRate = nearWrap ? 1 : c.rate
      if (v.paused && !(v.ended && !m.loop)) void v.play().catch(() => {})
    }
    sync()
    v.addEventListener('loadedmetadata', sync)
    v.addEventListener('canplay', sync)
    const t = setInterval(sync, 500)
    return () => { v.removeEventListener('loadedmetadata', sync); v.removeEventListener('canplay', sync); clearInterval(t) }
  }, [m?.media.src, m?.playing, m?.startedAt, m?.offset, m?.loop, frozen])
}

function MediaLayer({ m, muted, frozen }: { m: LiveMedia; muted: boolean; frozen: boolean }): ReactNode {
  const ref = useRef<HTMLVideoElement>(null)
  useSyncedMedia(ref, m.media.kind === 'video' ? m : null, frozen)
  useEffect(() => { if (ref.current) ref.current.volume = Math.max(0, Math.min(1, m.volume ?? 1)) }, [m.volume])
  const style: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: m.fit === 'stretch' ? 'fill' : (m.fit ?? 'cover') }
  if (m.media.kind === 'image') return <img src={mediaUrl(m.media)} style={style} alt="" decoding="async" />
  if (m.media.kind === 'audio') return null
  // Non-looping videos hold their last frame when they end (no flash to black).
  return <video ref={ref} src={mediaUrl(m.media)} style={style} loop={m.loop} muted={muted || m.muted} playsInline preload="auto" disablePictureInPicture />
}

/** Plays audio-only media (and the sound of a video) without drawing anything. */
function SoundOnly({ m, frozen, withVideo }: { m: LiveMedia; frozen: boolean; withVideo?: boolean }): ReactNode {
  const ref = useRef<HTMLMediaElement | null>(null)
  useSyncedMedia(ref, m, frozen)
  useEffect(() => { if (ref.current) ref.current.volume = Math.max(0, Math.min(1, m.volume ?? 1)) }, [m.volume])
  if (withVideo) return <video ref={(el) => { ref.current = el }} src={mediaUrl(m.media)} loop={m.loop} muted={m.muted} playsInline preload="auto" style={{ display: 'none' }} />
  return <audio ref={(el) => { ref.current = el }} src={mediaUrl(m.media)} loop={m.loop} muted={m.muted} preload="auto" />
}

/**
 * Program audio for the operator window when it is the chosen audio place ("audio plays from: operator").
 * Outputs play it themselves when they are the chosen one (LiveCanvas `audio`). Never both.
 */
export function ProgramAudio({ live }: { live: LiveState }): ReactNode {
  return (
    <div style={{ display: 'none' }} data-program-audio>
      {live.video && live.video.media.kind === 'video' && !live.cleared.video && <SoundOnly key={'v' + live.video.media.src} m={live.video} frozen={live.frozen} withVideo />}
      {live.audio && <SoundOnly key={'a' + live.audio.media.src} m={live.audio} frozen={live.frozen} />}
    </div>
  )
}

/* ───────── transitions ───────── */

const DEFAULT_SLIDE_TRANSITION: Transition = { type: 'dissolve', duration: 0.3 }
const KEYFRAMES = `
@keyframes rp-in-fade{from{opacity:0}to{opacity:1}}
@keyframes rp-out-fade{from{opacity:1}to{opacity:0}}
@keyframes rp-in-zoom{from{opacity:0;transform:scale(1.08)}to{opacity:1;transform:none}}
@keyframes rp-out-zoom{from{opacity:1;transform:none}to{opacity:0;transform:scale(.94)}}
@keyframes rp-in-left{from{transform:translateX(100%)}to{transform:none}}
@keyframes rp-in-right{from{transform:translateX(-100%)}to{transform:none}}
@keyframes rp-in-up{from{transform:translateY(100%)}to{transform:none}}
@keyframes rp-in-down{from{transform:translateY(-100%)}to{transform:none}}
@keyframes rp-out-left{from{transform:none}to{transform:translateX(-100%)}}
@keyframes rp-out-right{from{transform:none}to{transform:translateX(100%)}}
@keyframes rp-out-up{from{transform:none}to{transform:translateY(-100%)}}
@keyframes rp-out-down{from{transform:none}to{transform:translateY(100%)}}
@keyframes rp-hold{from{opacity:1}to{opacity:1}}
`

/** CSS animation for the entering / leaving item of a transition. Exported for tests. */
export function transitionAnimation(t: Transition | undefined, phase: 'in' | 'out'): string | undefined {
  if (!t || t.type === 'cut' || !t.duration) return undefined
  const d = Math.max(0.05, t.duration)
  const dir = t.direction ?? 'left'
  switch (t.type) {
    // Fade = through black: the old one fades out in the first half, the new one in during the second.
    case 'fade': return phase === 'out' ? `rp-out-fade ${d / 2}s ease-in forwards` : `rp-in-fade ${d / 2}s ease-out ${d / 2}s both`
    case 'dissolve': return phase === 'out' ? `rp-out-fade ${d}s linear forwards` : `rp-in-fade ${d}s linear both`
    case 'zoom': return phase === 'out' ? `rp-out-zoom ${d}s ease forwards` : `rp-in-zoom ${d}s ease both`
    case 'push': return `rp-${phase}-${dir} ${d}s cubic-bezier(.45,0,.2,1) both`
    case 'slide': return phase === 'out' ? `rp-hold ${d}s linear forwards` : `rp-in-${dir} ${d}s cubic-bezier(.45,0,.2,1) both`
  }
  return undefined
}

/** Keeps the outgoing item on screen while the incoming one transitions in. Items are identified by `id`. */
function TransitionStack({ id, transition, children }: { id: string; transition?: Transition; children: ReactNode }): ReactNode {
  const [items, setItems] = useState<{ id: string; node: ReactNode; leaving?: boolean; t?: Transition }[]>([{ id, node: children }])
  const latest = useRef(children)
  latest.current = children
  const tKey = transition ? `${transition.type}:${transition.duration}:${transition.direction ?? ''}` : ''
  useEffect(() => {
    setItems((prev) => {
      if (prev[prev.length - 1]?.id === id) return prev
      if (!transitionAnimation(transition, 'in')) return [{ id, node: latest.current }]
      return [...prev.filter((p) => !p.leaving).map((p) => ({ ...p, leaving: true, t: transition })), { id, node: latest.current, t: transition }].slice(-3)
    })
    const ms = (transition?.duration ?? 0) * 1000 + 80
    const timer = setTimeout(() => setItems((prev) => prev.filter((p) => !p.leaving)), ms)
    return () => clearTimeout(timer)
  }, [id, tKey])
  return (
    <>
      {items.map((it) => (
        <div key={it.id} data-layer-item={it.leaving ? 'leaving' : 'current'}
          style={{ position: 'absolute', inset: 0, animation: transitionAnimation(it.t, it.leaving ? 'out' : 'in'), zIndex: it.leaving && it.t?.type !== 'slide' ? 0 : 1, willChange: it.t ? 'transform, opacity' : undefined }}>
          {it.id === id && !it.leaving ? children : it.node}
        </div>
      ))}
    </>
  )
}

const SlideLayer = memo(function SlideLayer({ ls, canvas, tokens }: { ls: LiveSlide; canvas: Canvas; tokens: Tokens }): ReactNode {
  const r = resolveSlideForCanvas(ls.slide, ls.size, canvas)
  return (
    <Fit size={r.size}>
      <SlideView elements={r.elements} background={r.background} size={r.size} tokens={tokens} build={ls.build} />
    </Fit>
  )
}, (a, b) => a.ls === b.ls && a.canvas === b.canvas && (a.tokens === b.tokens || !hasDynamic(a.ls.slide) || JSON.stringify(a.tokens) === JSON.stringify(b.tokens)))

const hasDynamic = (s: Slide): boolean => s.elements.some((e) => e.type === 'text' && e.dynamic) || Object.values(s.variants ?? {}).some((v) => v.elements.some((e) => e.type === 'text' && e.dynamic))

/** Does anything on screen need the clock to tick (dynamic text, timers, a stage screen)? */
function needsClock(live: LiveState, canvas: Canvas): boolean {
  if (canvas.kind === 'stage') return true
  if (live.slide && hasDynamic(live.slide.slide)) return true
  if (live.announcement && hasDynamic(live.announcement.slide)) return true
  if (live.props.some((p) => hasDynamic(p.slide))) return true
  return live.messages.some((m) => m.text.includes('{'))
}

export interface LiveCanvasProps {
  canvas: Canvas
  live: LiveState
  workspace?: WorkspaceConfig
  stageLayout?: StageLayout | null
  /** Outputs are muted unless they are the designated audio output (exactly one place plays program audio). */
  audio?: boolean
  /** Draw region guides (operator previews). */
  showRegions?: boolean
  /** No black backdrop and no background layer (OBS browser source / NDI with alpha). */
  transparent?: boolean
}

/** The full layer stack for one canvas at its native pixel size. */
export function LiveCanvas({ canvas, live: incoming, workspace, stageLayout, audio, showRegions, transparent }: LiveCanvasProps): ReactNode {
  // Freeze: keep showing the last picture from before `frozen` went on (videos pause), until it is released.
  const held = useRef<LiveState>(incoming)
  if (!incoming.frozen) held.current = incoming
  const live = incoming.frozen ? { ...held.current, frozen: true, blackout: incoming.blackout, logo: incoming.logo } : incoming
  const frozen = incoming.frozen
  const now = useNow(canvas.kind === 'stage' ? 250 : 1000, needsClock(live, canvas) && !frozen)
  const tokens = liveTokens(live, now)
  const on = (l: LayerId): boolean => canvas.layers?.[l] !== false && !live.cleared[l] && !(transparent && l === 'background')
  const full: CSSProperties = { position: 'absolute', inset: 0 }

  let content: ReactNode
  if (canvas.kind === 'stage') {
    content = stageLayout
      ? <Fit size={stageLayout.size}><SlideView elements={stageLayout.slide.elements} background={stageLayout.slide.background} size={stageLayout.size} tokens={tokens} /></Fit>
      : <DefaultStage live={live} tokens={tokens} canvas={canvas} />
  } else {
    const slideT = live.slide?.transition ?? live.slide?.slide.transition ?? DEFAULT_SLIDE_TRANSITION
    content = (
      <>
        {on('background') && (
          <div style={full} data-layer="background">
            <TransitionStack id={live.background?.media.src ?? 'none'} transition={live.background?.transition ?? { type: 'dissolve', duration: 0.6 }}>
              {live.background ? <MediaLayer m={live.background} muted frozen={frozen} /> : null}
            </TransitionStack>
          </div>
        )}
        {on('video') && (
          <div style={full} data-layer="video">
            <TransitionStack id={live.video ? `${live.video.media.src}@${live.video.startedAt ?? 0}` : 'none'} transition={live.video?.transition ?? { type: 'dissolve', duration: 0.25 }}>
              {live.video ? <MediaLayer m={live.video} muted={!audio} frozen={frozen} /> : null}
            </TransitionStack>
          </div>
        )}
        {on('slide') && (
          <div style={full} data-layer="slide">
            <TransitionStack id={live.slide ? `${live.slide.presentationId}:${live.slide.slideId}:${live.slide.index}` : 'none'} transition={slideT}>
              {live.slide ? <SlideLayer ls={live.slide} canvas={canvas} tokens={tokens} /> : null}
            </TransitionStack>
          </div>
        )}
        {on('announcement') && (
          <div style={full} data-layer="announcement">
            <TransitionStack id={live.announcement ? `${live.announcement.presentationId}:${live.announcement.slideId}:${live.announcement.index}` : 'none'} transition={live.announcement?.transition ?? DEFAULT_SLIDE_TRANSITION}>
              {live.announcement ? <SlideLayer ls={live.announcement} canvas={canvas} tokens={tokens} /> : null}
            </TransitionStack>
          </div>
        )}
        {on('props') && live.props.map((p) => (
          <div key={p.id} style={{ ...full, animation: 'rp-in-fade .3s both' }} data-layer="props"><Fit size={p.size}><SlideView elements={p.slide.elements} background={p.slide.background} size={p.size} tokens={tokens} /></Fit></div>
        ))}
        {on('message') && live.messages.map((m) => (
          <div key={m.id} data-layer="message" style={{ ...full, display: 'flex', justifyContent: 'center', alignItems: m.position === 'top' ? 'flex-start' : m.position === 'center' ? 'center' : 'flex-end', padding: canvas.height * 0.05, animation: 'rp-in-fade .3s both' }}>
            <div style={{ background: 'rgba(0,0,0,.78)', color: '#fff', padding: `${canvas.height * 0.018}px ${canvas.height * 0.035}px`, borderRadius: canvas.height * 0.012, fontSize: canvas.height * 0.042, fontWeight: 600, fontFamily: '"Reach Sans", "Inter", sans-serif', ...(m.style as CSSProperties) }}>
              {m.text.replace(/\{([^{}]+)\}/g, (x, k: string) => tokens[k.trim()] ?? x)}
            </div>
          </div>
        ))}
        {on('mask') && live.mask && <img src={mediaUrl(live.mask)} style={{ ...full, width: '100%', height: '100%', objectFit: 'fill' }} alt="" data-layer="mask" />}
        {audio && live.audio && <SoundOnly key={live.audio.media.src} m={live.audio} frozen={frozen} />}
      </>
    )
  }

  return (
    <div style={{ position: 'relative', width: canvas.width, height: canvas.height, background: transparent ? 'transparent' : '#000', overflow: 'hidden', contain: 'strict' }} data-canvas={canvas.id} data-frozen={frozen || undefined}>
      <style>{KEYFRAMES}</style>
      {content}
      {/* Logo and blackout fade quickly rather than snapping. */}
      <div style={{ ...full, background: '#000', opacity: live.logo && workspace?.logo ? 1 : 0, transition: 'opacity .35s ease', pointerEvents: 'none' }} data-logo={live.logo || undefined}>
        {live.logo && workspace?.logo && <img src={mediaUrl(workspace.logo)} style={{ ...full, width: '100%', height: '100%', objectFit: 'contain' }} alt="" />}
      </div>
      <div style={{ ...full, background: '#000', opacity: live.blackout ? 1 : 0, transition: 'opacity .35s ease', pointerEvents: 'none' }} data-blackout={live.blackout || undefined} />
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
 * What a physical output shows: the canvas (or one region / video-wall cell of it) scaled into the window.
 * `crop` (canvas pixels) wins over `regionId`.
 */
export function OutputSurface({ regionId, crop, fit = 'contain', ...props }: LiveCanvasProps & { regionId?: string; crop?: Rect; fit?: 'contain' | 'cover' | 'stretch' }): ReactNode {
  const region = regionId ? props.canvas.regions.find((r) => r.id === regionId) : undefined
  const src: Rect = crop ?? region?.rect ?? { x: 0, y: 0, w: props.canvas.width, h: props.canvas.height }
  return (
    <Fit size={{ width: src.w, height: src.h }} fit={fit} style={{ background: props.transparent ? 'transparent' : '#000' }}>
      <div style={{ position: 'absolute', left: -src.x, top: -src.y }}>
        <LiveCanvas {...props} />
      </div>
    </Fit>
  )
}
