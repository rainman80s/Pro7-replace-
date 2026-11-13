/**
 * HTTP API routers. Pure (no Electron / Node HTTP) so they are unit-tested with a fake `call`.
 *
 *   /api/v1/...   Reach Presenter's own REST API          (docs/control/api.md)
 *   /v1/..., /version  ProPresenter-compatible subset     (verified against openapi.propresenter.com)
 */
import { findByIdOrName, formatHms, liveSummary, timerValue, type MessagesDoc, type PropsDoc, type TimersDoc } from '../../../shared/control'
import type { LiveState, Macro, TimerState } from '../../../shared/model'

export interface RestDeps {
  /** Call an RPC method with full rights (route auth has already been checked). */
  call(method: string, payload?: unknown): Promise<unknown>
  /** Call an RPC method with network-client rights ('local' methods are refused). */
  rpc(method: string, payload?: unknown): Promise<unknown>
  live(): LiveState
  info: { version: string; platform: string; osVersion: string; host: string }
  now?(): number
}

export interface RestRequest { method: string; path: string; query: URLSearchParams; body: unknown }
export interface RestResponse { status: number; body?: unknown }

const ok = (body?: unknown): RestResponse => (body === undefined ? { status: 204 } : { status: 200, body })
const notFound = (what = 'Not found'): RestResponse => ({ status: 404, body: { error: what } })
const bad = (what: string): RestResponse => ({ status: 400, body: { error: what } })

type Route = { method: string | string[]; pattern: string; fn: (p: Record<string, string>, req: RestRequest, d: RestDeps) => Promise<RestResponse> | RestResponse }

function compile(pattern: string): RegExp {
  return new RegExp('^' + pattern.replace(/\{(\w+)\}/g, '(?<$1>[^/]+)') + '/?$')
}

function router(routes: Route[]): (req: RestRequest, d: RestDeps) => Promise<RestResponse | null> {
  const compiled = routes.map((r) => ({ ...r, rx: compile(r.pattern), methods: Array.isArray(r.method) ? r.method : [r.method] }))
  return async (req, d) => {
    let pathMatched = false
    for (const r of compiled) {
      const m = r.rx.exec(req.path)
      if (!m) continue
      pathMatched = true
      if (!r.methods.includes(req.method)) continue
      const params = Object.fromEntries(Object.entries(m.groups ?? {}).map(([k, v]) => [k, decodeURIComponent(v)]))
      try {
        return await r.fn(params, req, d)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { status: /not found|no such|does not exist/i.test(msg) ? 404 : /authori[sz]ed|only available/i.test(msg) ? 403 : 400, body: { error: msg } }
      }
    }
    return pathMatched ? { status: 405, body: { error: 'Method not allowed' } } : null
  }
}

const runAction = (d: RestDeps, type: string, params: Record<string, unknown> = {}): Promise<unknown> => d.call('live.runAction', { type, params })
const GP = ['GET', 'POST']
const obj = (b: unknown): Record<string, unknown> => (b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {})

/* ───────────────────────────── Reach REST API ───────────────────────────── */

export const reachApi = router([
  { method: 'GET', pattern: '/api/v1/status', fn: (_p, _r, d) => {
    const l = d.live()
    return ok({ ...liveSummary(l), timers: l.timers.map((t) => ({ id: t.id, name: t.name, running: t.running, time: formatHms(timerValue(t, d.now?.())) })),
      messages: l.messages, stageMessage: l.stageMessage, props: l.props.map((p) => p.id), blackout: l.blackout, audio: l.audio?.media.name ?? null })
  } },
  { method: 'GET', pattern: '/api/v1/live', fn: (_p, _r, d) => ok(d.live()) },
  { method: 'GET', pattern: '/api/v1/actions', fn: async (_p, _r, d) => ok(await d.call('actions.types')) },
  { method: GP, pattern: '/api/v1/next', fn: async (_p, _r, d) => { await d.call('live.next'); return ok() } },
  { method: GP, pattern: '/api/v1/prev', fn: async (_p, _r, d) => { await d.call('live.prev'); return ok() } },
  { method: GP, pattern: '/api/v1/clear/{layer}', fn: async (p, _r, d) => { await runAction(d, 'live.clear', { layer: p.layer }); return ok() } },
  { method: GP, pattern: '/api/v1/blackout/{state}', fn: async (p, _r, d) => {
    if (p.state === 'toggle') await runAction(d, 'live.toggleFlag', { flag: 'blackout' })
    else await d.call('live.setFlag', { flag: 'blackout', value: p.state === 'on' })
    return ok()
  } },
  { method: GP, pattern: '/api/v1/slide/{number}', fn: async (p, _r, d) => { await runAction(d, 'live.slideIndex', { index: Number(p.number) }); return ok() } },
  { method: GP, pattern: '/api/v1/section/{name}', fn: async (p, _r, d) => { await runAction(d, 'live.group', { name: p.name }); return ok() } },
  { method: GP, pattern: '/api/v1/item/{which}', fn: async (p, _r, d) => {
    await runAction(d, 'playlist.item', p.which === 'next' ? { step: 1 } : p.which === 'prev' ? { step: -1 } : { index: Number(p.which) })
    return ok()
  } },
  { method: GP, pattern: '/api/v1/macro/{id}', fn: async (p, _r, d) => { await d.call('live.runMacro', { id: p.id }); return ok() } },
  { method: 'POST', pattern: '/api/v1/action', fn: async (_p, r, d) => {
    const b = obj(r.body)
    if (typeof b.type !== 'string') return bad('Send {"type": "...", "params": {...}}')
    await runAction(d, b.type, obj(b.params))
    return ok()
  } },
  { method: GP, pattern: '/api/v1/timer/{id}/{op}', fn: async (p, r, d) => {
    const t = findByIdOrName(d.live().timers, p.id)
    if (!t) return notFound('Timer not found')
    const ops = ['start', 'stop', 'reset', 'restart', 'adjust', 'set']
    if (!ops.includes(p.op)) return notFound()
    const b = { ...Object.fromEntries(r.query), ...obj(r.body) }
    await d.call('timers.control', { id: t.id, action: p.op, seconds: b.seconds !== undefined ? Number(b.seconds) : undefined, duration: b.duration !== undefined ? Number(b.duration) : undefined, target: b.target as string | undefined })
    return ok()
  } },
  { method: GP, pattern: '/api/v1/countdown/{id}', fn: async (p, r, d) => {
    const t = findByIdOrName(d.live().timers, p.id)
    if (!t) return notFound('Timer not found')
    await d.call('timers.showCountdown', { id: t.id, heading: (obj(r.body).heading ?? r.query.get('heading') ?? undefined) as string | undefined })
    return ok()
  } },
  { method: GP, pattern: '/api/v1/message/{id}/show', fn: async (p, r, d) => {
    const b = obj(r.body)
    const values = { ...Object.fromEntries([...r.query].filter(([k]) => k !== 'seconds' && k !== 'token')), ...obj(b.values) }
    await d.call('messages.show', { id: p.id, values, seconds: b.seconds ?? (r.query.get('seconds') ? Number(r.query.get('seconds')) : undefined) })
    return ok()
  } },
  { method: GP, pattern: '/api/v1/message/{id}/hide', fn: async (p, _r, d) => { await d.call('messages.hide', { id: p.id }); return ok() } },
  { method: GP, pattern: '/api/v1/messages/hide', fn: async (_p, _r, d) => { await d.call('messages.hide', {}); return ok() } },
  { method: ['POST', 'PUT'], pattern: '/api/v1/stage-message', fn: async (_p, r, d) => {
    const b = typeof r.body === 'string' ? { text: r.body } : obj(r.body)
    await d.call('messages.stage', { text: String(b.text ?? ''), flash: !!b.flash })
    return ok()
  } },
  { method: ['DELETE'], pattern: '/api/v1/stage-message', fn: async (_p, _r, d) => { await d.call('messages.stage', { text: '' }); return ok() } },
  { method: GP, pattern: '/api/v1/prop/{id}/{op}', fn: async (p, _r, d) => {
    const props = (await d.call('props.list')) as PropsDoc
    const def = findByIdOrName(props.props, p.id)
    if (!def) return notFound('Prop not found')
    await d.call('props.toggle', { id: def.id, on: p.op === 'on' ? true : p.op === 'off' ? false : undefined })
    return ok()
  } },
  { method: GP, pattern: '/api/v1/trigger/{name}', fn: async (p, _r, d) => {
    const n = (await d.call('triggers.fire', { http: p.name })) as number
    return n ? ok({ fired: n }) : notFound(`No web-hook trigger called "${p.name}"`)
  } },
  { method: 'POST', pattern: '/api/v1/rpc/{method}', fn: async (p, r, d) => ok({ result: (await d.rpc(p.method, r.body ?? undefined)) ?? null }) },
  { method: 'GET', pattern: '/api/v1/{list}', fn: async (p, _r, d) => {
    const m: Record<string, string> = { timers: 'timers.list', macros: 'macros.list', messages: 'messages.list', props: 'props.list', audio: 'audio.list', playlists: 'playlists.list', triggers: 'triggers.list' }
    if (!m[p.list]) return notFound()
    return ok(await d.call(m[p.list]))
  } }
])

/* ───────────────────────────── ProPresenter-compatible subset ───────────────────────────── */

const ppId = (x: { id: string; name: string }, index: number): { uuid: string; name: string; index: number } => ({ uuid: x.id, name: x.name, index })

function ppTimerState(t: TimerState, now?: number): string {
  const v = timerValue(t, now)
  if (t.kind === 'elapsed') return t.running ? 'running' : 'stopped'
  if (v < 0) return t.running || t.kind === 'countdownTo' ? 'overrunning' : 'overran'
  if (v <= 0) return 'complete'
  return t.running || t.kind === 'countdownTo' ? 'running' : 'stopped'
}

function ppTimerConfig(t: TimerState, i: number): Record<string, unknown> {
  const base = { id: ppId(t, i), allows_overrun: !!t.overrun }
  if (t.kind === 'countdownTo' && t.target) {
    const [h, m] = t.target.split(':').map(Number)
    return { ...base, count_down_to_time: { time_of_day: (h || 0) * 3600 + (m || 0) * 60, period: '24_hour' } }
  }
  if (t.kind === 'elapsed') return { ...base, elapsed: { start_time: 0, end_time: null } }
  return { ...base, countdown: { duration: Math.round(t.duration ?? 0) } }
}

const slideStatus = (l: LiveState, which: 'current' | 'next'): { text: string; notes: string; uuid: string } => {
  const s = which === 'current' ? l.slide?.slide : l.slide?.next?.slide
  const sum = liveSummary(l)
  return { text: which === 'current' ? sum.current : sum.next, notes: s?.notes ?? '', uuid: s?.id ?? '' }
}

/** ProPresenter layer names → ours. */
export const PP_LAYERS: Record<string, string | null> = {
  audio: 'audio', props: 'props', messages: 'message', announcements: 'announcement', slide: 'slide', media: 'media', video_input: null
}

async function timerOp(d: RestDeps, t: TimerState, op: string): Promise<void> {
  if (!['start', 'stop', 'reset'].includes(op)) throw new Error('Unknown timer operation (start, stop or reset)')
  await d.call('timers.control', { id: t.id, action: op })
}

export const compatApi = router([
  { method: 'GET', pattern: '/version', fn: (_p, _r, d) => ok({ name: 'Reach Presenter', platform: d.info.platform, os_version: d.info.osVersion, host_description: d.info.host, api_version: 'v1' }) },
  { method: 'GET', pattern: '/v1/status/slide', fn: (_p, _r, d) => { const l = d.live(); return ok({ current: slideStatus(l, 'current'), next: slideStatus(l, 'next') }) } },
  { method: 'GET', pattern: '/v1/status/layers', fn: (_p, _r, d) => {
    const l = d.live()
    return ok({ video_input: false, media: !!(l.background || l.video), slide: !!l.slide, announcements: !!l.announcement, props: l.props.length > 0, messages: l.messages.length > 0, audio: !!l.audio })
  } },
  { method: 'GET', pattern: '/v1/presentation/slide_index', fn: (_p, _r, d) => {
    const s = d.live().slide
    return ok({ presentation_index: s && s.index >= 0 ? { index: s.index, presentation_id: { uuid: s.presentationId, name: s.presentationTitle ?? '', index: 0 } } : null })
  } },
  { method: 'GET', pattern: '/v1/trigger/next', fn: async (_p, _r, d) => { await d.call('live.next'); return ok() } },
  { method: 'GET', pattern: '/v1/trigger/previous', fn: async (_p, _r, d) => { await d.call('live.prev'); return ok() } },
  { method: 'GET', pattern: '/v1/presentation/{which}/next/trigger', fn: async (p, _r, d) => { if (!['active', 'focused'].includes(p.which)) return notFound(); await d.call('live.next'); return ok() } },
  { method: 'GET', pattern: '/v1/presentation/{which}/previous/trigger', fn: async (p, _r, d) => { if (!['active', 'focused'].includes(p.which)) return notFound(); await d.call('live.prev'); return ok() } },
  { method: 'GET', pattern: '/v1/presentation/{which}/trigger', fn: async (p, _r, d) => { if (!['active', 'focused'].includes(p.which)) return notFound(); await runAction(d, 'live.slideIndex', { index: 1 }); return ok() } },
  { method: 'GET', pattern: '/v1/presentation/{which}/group/{group}/trigger', fn: async (p, _r, d) => { if (!['active', 'focused'].includes(p.which)) return notFound(); await runAction(d, 'live.group', { name: p.group }); return ok() } },
  { method: 'GET', pattern: '/v1/presentation/{which}/{index}/trigger', fn: async (p, _r, d) => {
    if (!['active', 'focused'].includes(p.which) || !/^\d+$/.test(p.index)) return notFound()
    await runAction(d, 'live.slideIndex', { index: Number(p.index) + 1 })
    return ok()
  } },
  { method: 'GET', pattern: '/v1/playlist/{which}/next/trigger', fn: async (p, _r, d) => { if (p.which !== 'focused') return notFound(); await runAction(d, 'playlist.item', { step: 1 }); return ok() } },
  { method: 'GET', pattern: '/v1/playlist/{which}/previous/trigger', fn: async (p, _r, d) => { if (p.which !== 'focused') return notFound(); await runAction(d, 'playlist.item', { step: -1 }); return ok() } },
  { method: 'GET', pattern: '/v1/playlist/focused/{index}/trigger', fn: async (p, _r, d) => { await runAction(d, 'playlist.item', { index: Number(p.index) + 1 }); return ok() } },
  { method: 'GET', pattern: '/v1/playlist/active/presentation/{index}/trigger', fn: async (p, _r, d) => { await runAction(d, 'playlist.item', { index: Number(p.index) + 1 }); return ok() } },
  { method: 'GET', pattern: '/v1/clear/layer/{layer}', fn: async (p, _r, d) => {
    if (!(p.layer in PP_LAYERS)) return bad('Unknown layer')
    const ours = PP_LAYERS[p.layer]
    if (ours) await runAction(d, 'live.clear', { layer: ours })
    return ok()
  } },
  { method: 'GET', pattern: '/v1/trigger/audio/next', fn: async (_p, _r, d) => { await d.call('audio.skip', { delta: 1 }); return ok() } },
  { method: 'GET', pattern: '/v1/trigger/audio/previous', fn: async (_p, _r, d) => { await d.call('audio.skip', { delta: -1 }); return ok() } },
  // Timers
  { method: 'GET', pattern: '/v1/timers', fn: (_p, _r, d) => ok(d.live().timers.map(ppTimerConfig)) },
  { method: 'GET', pattern: '/v1/timers/current', fn: (_p, _r, d) => ok(d.live().timers.map((t, i) => ({ id: ppId(t, i), time: formatHms(timerValue(t, d.now?.())), state: ppTimerState(t, d.now?.()) }))) },
  { method: 'GET', pattern: '/v1/timers/{op}', fn: async (p, _r, d) => {
    if (!['start', 'stop', 'reset'].includes(p.op)) return notFound()
    for (const t of d.live().timers) await timerOp(d, t, p.op)
    return ok()
  } },
  { method: 'GET', pattern: '/v1/timer/system_time', fn: (_p, _r, d) => ok(Math.floor((d.now?.() ?? Date.now()) / 1000)) },
  { method: 'GET', pattern: '/v1/timer/{id}', fn: (p, _r, d) => {
    const l = d.live().timers
    const t = findByIdOrName(l, p.id)
    return t ? ok(ppTimerConfig(t, l.indexOf(t))) : notFound('Timer not found')
  } },
  { method: 'GET', pattern: '/v1/timer/{id}/increment/{time}', fn: async (p, _r, d) => {
    const t = findByIdOrName(d.live().timers, p.id)
    if (!t) return notFound('Timer not found')
    await d.call('timers.control', { id: t.id, action: 'adjust', seconds: Number(p.time) })
    return ok()
  } },
  { method: 'GET', pattern: '/v1/timer/{id}/{op}', fn: async (p, _r, d) => {
    const t = findByIdOrName(d.live().timers, p.id)
    if (!t) return notFound('Timer not found')
    await timerOp(d, t, p.op)
    return ok()
  } },
  // Macros
  { method: 'GET', pattern: '/v1/macros', fn: async (_p, _r, d) => {
    const list = (await d.call('macros.list')) as Macro[]
    return ok(list.map((m, i) => ({ id: ppId(m, i), color: hexToPP(m.color) })))
  } },
  { method: 'GET', pattern: '/v1/macro/{id}/trigger', fn: async (p, _r, d) => {
    const m = findByIdOrName((await d.call('macros.list')) as Macro[], p.id)
    if (!m) return notFound('Macro not found')
    await d.call('live.runMacro', { id: m.id })
    return ok()
  } },
  // Props
  { method: 'GET', pattern: '/v1/props', fn: async (_p, _r, d) => {
    const doc = (await d.call('props.list')) as PropsDoc
    const on = new Set(d.live().props.map((p) => p.id))
    return ok(doc.props.map((p, i) => ({ id: ppId(p, i), is_active: on.has(p.id), auto_clear_enabled: !!p.autoClear, auto_clear_duration: p.autoClear ?? 0 })))
  } },
  { method: 'GET', pattern: '/v1/prop/{id}/{op}', fn: async (p, _r, d) => {
    if (p.op !== 'trigger' && p.op !== 'clear') return notFound()
    const def = findByIdOrName(((await d.call('props.list')) as PropsDoc).props, p.id)
    if (!def) return notFound('Prop not found')
    await d.call('props.toggle', { id: def.id, on: p.op === 'trigger' })
    return ok()
  } },
  // Messages
  { method: 'GET', pattern: '/v1/messages', fn: async (_p, _r, d) => {
    const doc = (await d.call('messages.list')) as MessagesDoc
    const on = new Set(d.live().messages.map((m) => m.id))
    return ok(doc.messages.map((m, i) => ({ id: ppId(m, i), message: m.text, tokens: [], theme: { uuid: '', name: '', index: 0 }, visible_on_network: true, is_active: on.has(m.id) })))
  } },
  { method: 'POST', pattern: '/v1/message/{id}/trigger', fn: async (p, r, d) => {
    const m = findByIdOrName(((await d.call('messages.list')) as MessagesDoc).messages, p.id)
    if (!m) return notFound('Message not found')
    const values: Record<string, unknown> = {}
    if (Array.isArray(r.body)) for (const t of r.body as { name?: string; text?: { text?: string } }[]) if (t?.name && t.text?.text !== undefined) values[t.name] = t.text.text
    await d.call('messages.show', { id: m.id, values })
    return ok()
  } },
  { method: 'GET', pattern: '/v1/message/{id}/clear', fn: async (p, _r, d) => {
    const m = findByIdOrName(((await d.call('messages.list')) as MessagesDoc).messages, p.id)
    if (!m) return notFound('Message not found')
    await d.call('messages.hide', { id: m.id })
    return ok()
  } },
  // Stage message
  { method: 'GET', pattern: '/v1/stage/message', fn: (_p, _r, d) => ok(d.live().stageMessage ?? '') },
  { method: 'PUT', pattern: '/v1/stage/message', fn: async (_p, r, d) => { await d.call('messages.stage', { text: typeof r.body === 'string' ? r.body : String(r.body ?? '') }); return ok() } },
  { method: 'DELETE', pattern: '/v1/stage/message', fn: async (_p, _r, d) => { await d.call('messages.stage', { text: '' }); return ok() } }
])

function hexToPP(hex?: string): { red: number; green: number; blue: number; alpha: number } {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex ?? '')
  const c = (s?: string): number => (s ? Math.round((parseInt(s, 16) / 255) * 1000) / 1000 : 0.5)
  return { red: c(m?.[1]), green: c(m?.[2]), blue: c(m?.[3]), alpha: 1 }
}

/** Every route the ProPresenter shim answers — printed in docs/control/api.md and checked by tests. */
export const COMPAT_ROUTES = [
  'GET /version', 'GET /v1/status/slide', 'GET /v1/status/layers', 'GET /v1/presentation/slide_index',
  'GET /v1/trigger/next', 'GET /v1/trigger/previous',
  'GET /v1/presentation/{active|focused}/next/trigger', 'GET /v1/presentation/{active|focused}/previous/trigger',
  'GET /v1/presentation/{active|focused}/trigger', 'GET /v1/presentation/{active|focused}/{index}/trigger',
  'GET /v1/presentation/{active|focused}/group/{group_id}/trigger',
  'GET /v1/playlist/focused/next/trigger', 'GET /v1/playlist/focused/previous/trigger', 'GET /v1/playlist/focused/{index}/trigger',
  'GET /v1/playlist/active/presentation/{index}/trigger',
  'GET /v1/clear/layer/{layer}', 'GET /v1/trigger/audio/next', 'GET /v1/trigger/audio/previous',
  'GET /v1/timers', 'GET /v1/timers/current', 'GET /v1/timers/{start|stop|reset}', 'GET /v1/timer/system_time', 'GET /v1/timer/{id}',
  'GET /v1/timer/{id}/{start|stop|reset}', 'GET /v1/timer/{id}/increment/{time}',
  'GET /v1/macros', 'GET /v1/macro/{id}/trigger', 'GET /v1/props', 'GET /v1/prop/{id}/trigger', 'GET /v1/prop/{id}/clear',
  'GET /v1/messages', 'POST /v1/message/{id}/trigger', 'GET /v1/message/{id}/clear',
  'GET /v1/stage/message', 'PUT /v1/stage/message', 'DELETE /v1/stage/message'
]

export type { TimersDoc }
