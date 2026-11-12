import { useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { getApi, onConnection } from '@shared/client'
import type { OutputDescription } from '@shared/api'
import type { LiveState } from '@shared/model'
import { emptyLiveState } from '@shared/model'
import { OutputSurface } from '@shared/render/LiveCanvas'
import '../ui/fonts.css'

/**
 * The output page. Runs fullscreen on a local display (Electron window) OR in any
 * browser on the network (TV, Raspberry Pi, phone) — same code, different transport.
 *
 *   output.html?outputId=<id>            a configured output
 *   output.html?canvasId=<id>[&regionId] ad-hoc view of a canvas (handy for OBS / testing)
 *   output.html                          a network receiver: registers itself and waits to be assigned
 */
const api = getApi()
const q = new URLSearchParams(location.search)

function receiverId(): string {
  let id = q.get('receiverId') ?? localStorage.getItem('reach.receiverId')
  if (!id) id = 'rx-' + Math.random().toString(36).slice(2, 10)
  try { localStorage.setItem('reach.receiverId', id) } catch { /* private mode */ }
  return id
}

function Output(): ReactNode {
  const [desc, setDesc] = useState<OutputDescription | null>(null)
  const [live, setLive] = useState<LiveState>(emptyLiveState())
  const [connected, setConnected] = useState(true)
  const [identify, setIdentify] = useState(false)

  useEffect(() => {
    const req = { outputId: q.get('outputId') ?? undefined, canvasId: q.get('canvasId') ?? undefined, regionId: q.get('regionId') ?? undefined, receiverId: q.get('outputId') || q.get('canvasId') ? undefined : receiverId() }
    const load = (): void => {
      void api.invoke('outputs.describe', req).then(setDesc).catch(() => {})
      void api.invoke('live.get').then(setLive).catch(() => {})
    }
    load()
    const offs = [
      api.on('live.changed', setLive),
      api.on('outputs.changed', load),
      api.on('workspace.changed', load),
      api.on('workspace.docChanged', load),
      api.on('outputs.identify', (e) => setIdentify(e.on)),
      onConnection((c) => { setConnected(c); if (c) load() })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  if (!desc) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#F4F2EB', font: '500 2.2vw/1.5 system-ui', textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: '4vw', fontFamily: '"Perfectly Nineties", Georgia, serif' }}>Reach</div>
          <div style={{ opacity: 0.6 }}>{connected ? 'This screen is ready. Assign it in Reach Presenter → Displays.' : 'Connecting…'}</div>
          <div style={{ opacity: 0.35, fontSize: '1.4vw', marginTop: '1vw' }}>{receiverId()}</div>
        </div>
      </div>
    )
  }
  const t = desc.output?.transform
  const transform = [t?.flipH ? 'scaleX(-1)' : '', t?.flipV ? 'scaleY(-1)' : '', t?.rotate ? `rotate(${t.rotate}deg)` : ''].join(' ').trim()
  return (
    <div style={{ height: '100%', transform: transform || undefined, filter: t?.brightness != null && t.brightness !== 1 ? `brightness(${t.brightness})` : undefined }}>
      <OutputSurface canvas={desc.canvas} regionId={desc.output?.regionId} live={live} workspace={desc.workspace} stageLayout={desc.stageLayout} fit={t?.fit ?? 'contain'} audio={q.get('audio') === '1'} />
      {identify && (
        <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: desc.canvas.color ?? '#3886CE', color: '#fff', font: '700 6vw/1.2 system-ui', textAlign: 'center' }}>
          <div>{desc.output?.name ?? desc.canvas.name}<div style={{ fontSize: '2.5vw', opacity: 0.8, fontWeight: 500 }}>{desc.canvas.name}{desc.output?.regionId ? ` › ${desc.canvas.regions.find((r) => r.id === desc.output?.regionId)?.name}` : ''}</div></div>
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Output />)
