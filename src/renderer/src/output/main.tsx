import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { getApi, onConnection } from '@shared/client'
import type { OutputDescription } from '@shared/api'
import type { LiveState, MediaRef, Slide } from '@shared/model'
import { emptyLiveState } from '@shared/model'
import { ClockSync, cornerPinMatrix3d } from '@shared/outputs'
import { mediaUrl } from '@shared/media'
import { OutputSurface, setClockOffset } from '@shared/render/LiveCanvas'
import { TestPattern } from './TestPattern'
import '../ui/fonts.css'

/**
 * The output page. Runs fullscreen on a local display (Electron window), offscreen for NDI, OR in any
 * browser on the network (TV, Raspberry Pi, phone, OBS) — same code, different transport.
 *
 *   output.html?outputId=<id>                       a configured output (local windows)
 *   output.html?canvasId=<id>[&regionId][&transparent=1]  ad-hoc view of a canvas (OBS browser source / testing)
 *   output.html[?name=Lobby%20Left][&receiverId=lobby-left]  a network receiver: registers itself, waits to be assigned
 *
 * Receivers: auto-reconnect (client.ts), keep the last frame if the host drops, NTP-style clock sync,
 * heartbeat, screen wake lock, tap for fullscreen, preload of the next slide's media.
 */
const api = getApi()
const q = new URLSearchParams(location.search)
const mode: 'output' | 'adhoc' | 'receiver' = q.get('outputId') ? 'output' : q.get('canvasId') ? 'adhoc' : 'receiver'
const transparentParam = q.get('transparent') === '1'
if (transparentParam) {
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
  const root = document.getElementById('root')
  if (root) root.style.background = 'transparent'
}

function receiverId(): string {
  let id = q.get('receiverId')
  if (!id) try { id = localStorage.getItem('reach.receiverId') } catch { /* private mode */ }
  if (!id) id = 'rx-' + Math.random().toString(36).slice(2, 10)
  try { localStorage.setItem('reach.receiverId', id) } catch { /* private mode */ }
  return id
}
const RID = mode === 'receiver' ? receiverId() : ''

function useWindowSize(): { width: number; height: number } {
  const [s, set] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const on = (): void => set({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return s
}

/** NTP-style clock sync over the existing WebSocket. Local windows share the host clock and skip this. */
const clock = new ClockSync(8)
async function probeClock(n = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    const t0 = Date.now()
    try {
      const { t } = await api.invoke('outputs.time')
      clock.add(t0, t, Date.now())
      setClockOffset(clock.offset)
    } catch { return }
  }
}

/** Keep the screen awake (TV browsers, tablets). Re-acquired when the page becomes visible again. */
function useWakeLock(): void {
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }
    if (!nav.wakeLock) return
    let lock: { release(): Promise<void> } | null = null
    const get = (): void => { if (document.visibilityState === 'visible') void nav.wakeLock!.request('screen').then((l) => { lock = l }).catch(() => {}) }
    get()
    document.addEventListener('visibilitychange', get)
    return () => { document.removeEventListener('visibilitychange', get); void lock?.release().catch(() => {}) }
  }, [])
}

/** Decode the next slide's images / start buffering its videos before it goes live. */
function usePreload(live: LiveState): void {
  const cache = useRef(new Map<string, HTMLImageElement | HTMLVideoElement>())
  const next = live.slide?.next?.slide
  useEffect(() => {
    if (!next) return
    const refs: MediaRef[] = []
    const walk = (s: Slide): void => {
      if (s.background?.type === 'media') refs.push(s.background.media)
      for (const v of Object.values(s.variants ?? {})) if (v.background?.type === 'media') refs.push(v.background.media)
      for (const e of [...s.elements, ...Object.values(s.variants ?? {}).flatMap((v) => v.elements)]) if (e.type === 'image' || e.type === 'video') refs.push(e.media)
    }
    walk(next)
    for (const m of refs) {
      const url = mediaUrl(m)
      if (!url || cache.current.has(url)) continue
      if (m.kind === 'video') { const v = document.createElement('video'); v.preload = 'auto'; v.muted = true; v.src = url; cache.current.set(url, v) }
      else if (m.kind === 'image') { const i = new Image(); i.decoding = 'async'; i.src = url; void i.decode?.().catch(() => {}); cache.current.set(url, i) }
    }
    while (cache.current.size > 24) cache.current.delete(cache.current.keys().next().value as string)
  }, [next?.id])
}

function Output(): ReactNode {
  const [desc, setDesc] = useState<OutputDescription | null>(null)
  const [live, setLive] = useState<LiveState>(emptyLiveState())
  const [connected, setConnected] = useState(true)
  const [identify, setIdentify] = useState(false)
  const [identifyOne, setIdentifyOne] = useState<string | null>(null)
  const [name, setName] = useState(q.get('name') ?? '')
  const size = useWindowSize()
  const liveRev = useRef(0)
  useWakeLock()
  usePreload(live)

  useEffect(() => {
    const req = { outputId: q.get('outputId') ?? undefined, canvasId: q.get('canvasId') ?? undefined, regionId: q.get('regionId') ?? undefined, receiverId: RID || undefined }
    const load = (): void => {
      // Only replace what we show when the host answers: if it is unreachable, the last frame stays up.
      void api.invoke('outputs.describe', req).then((d) => setDesc(d)).catch(() => {})
      void api.invoke('live.get').then((l) => { liveRev.current = l.rev; setLive(l) }).catch(() => {})
    }
    const hello = (): void => {
      if (mode !== 'receiver') return
      void api.invoke('receivers.hello', {
        receiverId: RID, name: q.get('name') ?? undefined, width: Math.round(window.innerWidth * devicePixelRatio), height: Math.round(window.innerHeight * devicePixelRatio),
        pixelRatio: devicePixelRatio, role: 'receiver', rttMs: Math.round(clock.rtt), clockOffsetMs: Math.round(clock.offset), rev: liveRev.current
      }).then((r) => setName(r.name)).catch(() => {})
    }
    load()
    const offs = [
      api.on('live.changed', (l) => { liveRev.current = l.rev; setLive(l) }),
      api.on('outputs.changed', load),
      api.on('workspace.changed', load),
      api.on('workspace.docChanged', load),
      api.on('outputs.safeModeChanged', load),
      api.on('outputs.identify', (e) => setIdentify(e.on)),
      api.on('outputs.identifyOne', (e) => setIdentifyOne(e.on ? e.id : null)),
      onConnection((c) => {
        setConnected(c)
        if (c) { load(); hello(); if (api.transport === 'ws') void probeClock(5) }
      })
    ]
    const timers: number[] = []
    if (api.transport === 'ws') {
      timers.push(window.setInterval(() => void probeClock(1), 15_000))
      if (mode === 'receiver') timers.push(window.setInterval(hello, 5_000))
      const onResize = (): void => hello()
      window.addEventListener('resize', onResize)
      offs.push(() => window.removeEventListener('resize', onResize))
    }
    return () => { offs.forEach((off) => off()); timers.forEach((t) => clearInterval(t)) }
  }, [])

  // Tap / click anywhere → fullscreen (TV browsers, tablets). Never in the desktop app's own windows.
  useEffect(() => {
    if (api.transport !== 'ws') return
    const go = (): void => { if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {}) }
    window.addEventListener('click', go)
    window.addEventListener('touchend', go)
    return () => { window.removeEventListener('click', go); window.removeEventListener('touchend', go) }
  }, [])

  const t = desc?.output?.transform
  const outerStyle = useMemo((): CSSProperties => {
    const parts: string[] = []
    const pin = t?.cornerPin ? cornerPinMatrix3d(size.width, size.height, t.cornerPin) : null
    if (pin) parts.push(pin)
    const over = Math.max(0, Math.min(0.2, t?.overscan ?? 0))
    if (over) parts.push(`translate(${size.width * over}px, ${size.height * over}px) scale(${1 - 2 * over})`)
    return {
      position: 'absolute', left: 0, top: 0, width: size.width, height: size.height, transformOrigin: '0 0',
      transform: parts.join(' ') || undefined,
      filter: t?.brightness != null && t.brightness !== 1 ? `brightness(${t.brightness})` : undefined
    }
  }, [t?.cornerPin, t?.overscan, t?.brightness, size.width, size.height])

  const showIdentity = identify || (!!identifyOne && (identifyOne === desc?.output?.id || identifyOne === RID))
  const overlay = showIdentity && (
    <div data-identify style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: (desc?.canvas?.color ?? '#3886CE') + 'ee', color: '#fff', font: '700 6vw/1.2 system-ui', textAlign: 'center', zIndex: 10 }}>
      <div>
        {desc?.output?.name ?? name ?? 'Network display'}
        <div style={{ fontSize: '2.5vw', opacity: 0.85, fontWeight: 500 }}>
          {desc?.canvas ? `${desc.canvas.name}${desc.output?.regionId ? ` › ${desc.canvas.regions.find((r) => r.id === desc.output?.regionId)?.name ?? ''}` : ''}` : 'Not assigned yet'}
        </div>
        <div style={{ fontSize: '1.6vw', opacity: 0.7, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{Math.round(size.width * devicePixelRatio)} × {Math.round(size.height * devicePixelRatio)} px</div>
      </div>
    </div>
  )

  if (!desc || !desc.canvas) {
    return (
      <div data-waiting style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#F4F2EB', font: '500 2.2vw/1.5 system-ui', textAlign: 'center', cursor: 'default' }}>
        <div>
          <div style={{ fontSize: '4vw', fontFamily: '"Perfectly Nineties", Georgia, serif' }}>Reach</div>
          <div style={{ fontSize: '3vw', fontWeight: 700 }}>{name || desc?.receiver?.name || ''}</div>
          <div style={{ opacity: 0.7 }}>{connected ? 'This screen is ready. In Reach Presenter, open Displays and choose what it shows.' : 'Connecting to Reach Presenter…'}</div>
          <div style={{ opacity: 0.4, fontSize: '1.4vw', marginTop: '1vw' }}>{RID}</div>
        </div>
        {overlay}
      </div>
    )
  }

  const rot = t?.rotate ?? 0
  const sideways = rot === 90 || rot === 270
  const innerStyle: CSSProperties = {
    position: 'absolute', left: '50%', top: '50%', width: sideways ? size.height : size.width, height: sideways ? size.width : size.height,
    transform: `translate(-50%, -50%) rotate(${rot}deg) scale(${t?.flipH ? -1 : 1}, ${t?.flipV ? -1 : 1})`
  }
  const inner = { width: innerStyle.width as number, height: innerStyle.height as number }
  const transparent = transparentParam || !!desc.output?.transparent
  const pattern = desc.output?.testPattern
  return (
    <div style={{ height: '100%', position: 'relative', overflow: 'hidden', background: transparent ? 'transparent' : '#000' }} data-output={desc.output?.id ?? ''} data-rev={live.rev}>
      <div style={outerStyle}>
        <div style={innerStyle}>
          {desc.enabled === false ? null : pattern
            ? <TestPattern pattern={pattern} canvas={desc.canvas} crop={desc.crop} title={desc.output?.name ?? desc.canvas.name} width={inner.width} height={inner.height} />
            : <OutputSurface canvas={desc.canvas} crop={desc.crop} regionId={desc.output?.regionId} live={live} workspace={desc.workspace} stageLayout={desc.stageLayout} fit={t?.fit ?? 'contain'} audio={desc.audio || q.get('audio') === '1'} transparent={transparent} />}
        </div>
      </div>
      {overlay}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Output />)
