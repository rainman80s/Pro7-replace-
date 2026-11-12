/**
 * Timers & clocks. Definitions are saved in the workspace doc `timers`; what is actually
 * running lives in `LiveState.timers` so every screen (and {timer:Name} tokens) agree.
 */
import {
  SERVICE_ITEM_TIMER_ID, countdownSlide, defaultTimers, findByIdOrName, timerExpired, timerStateFromDef, timerValue, uid,
  type TimerDef, type TimersDoc
} from '@shared/control'
import type { ID, LiveState, TimerState } from '@shared/model'
import { defineService } from '../../core/service'
import { api } from '../../core/api'
import { live } from '../../core/live'
import { library } from '../../core/library'
import { workspace } from '../../core/workspace'
import { DocStore, P, defineAction, pick } from '../macros/lib'

export const timersDoc = new DocStore<TimersDoc>('timers', defaultTimers, (d) => ({ serviceItemTimer: true, ...d, timers: d.timers ?? [] }))

const liveTimer = (id: ID): TimerState | undefined => live.state.timers.find((t) => t.id === id)
const setTimers = (fn: (list: TimerState[]) => TimerState[]): LiveState => live.mutate((s) => { s.timers = fn(s.timers) })
const patch = (id: ID, p: Partial<TimerState>): LiveState => setTimers((l) => l.map((t) => (t.id === id ? { ...t, ...p } : t)))

/** Make LiveState.timers match the saved definitions, keeping whatever is running. */
function syncLive(doc: TimersDoc): void {
  const ids = new Set(doc.timers.map((t) => t.id))
  const prev = new Map(live.state.timers.map((t) => [t.id, t]))
  const next = [
    ...doc.timers.map((d) => {
      const p = prev.get(d.id)
      // A countdown-to-time that was frozen at zero goes back to tracking the clock when edited.
      return timerStateFromDef(d, p && p.kind === d.kind ? p : undefined)
    }),
    // Timers we don't own (service-item timer, ad-hoc ones made by other features) are left alone.
    ...live.state.timers.filter((t) => !ids.has(t.id) && (t.id === SERVICE_ITEM_TIMER_ID || !prev.get(t.id) || !ownedIds.has(t.id)))
  ]
  ownedIds = ids
  if (JSON.stringify(next) !== JSON.stringify(live.state.timers)) setTimers(() => next)
}
let ownedIds = new Set<ID>()

export function resolveTimer(key: unknown): TimerState | undefined {
  return findByIdOrName(live.state.timers, key)
}

export function controlTimer(id: ID, action: 'start' | 'stop' | 'reset' | 'restart' | 'adjust' | 'set', opts: { seconds?: number; duration?: number; target?: string } = {}): LiveState {
  const t = liveTimer(id)
  if (!t) throw new Error('Timer not found')
  const def = timersDoc.current.timers.find((d) => d.id === id)
  const now = Date.now()
  ended.delete(id)
  // A countdown-to-time frozen at zero: any control puts it back on the clock.
  const base: Partial<TimerState> = def && def.kind !== t.kind ? { kind: def.kind, duration: def.duration, target: def.target } : {}
  switch (action) {
    case 'start':
      // Starting a finished countdown starts it over — that's what the operator means.
      if (t.kind === 'countdown' && !t.running && timerValue(t, now) <= 0) return patch(id, { ...base, running: true, startedAt: now, accumulated: 0 })
      return t.running && !base.kind ? live.state : patch(id, { ...base, running: true, startedAt: now })
    case 'stop':
      if (t.kind === 'countdownTo') return live.state
      return t.running ? patch(id, { running: false, startedAt: undefined, accumulated: (t.accumulated ?? 0) + (now - (t.startedAt ?? now)) / 1000 }) : live.state
    case 'reset':
      return patch(id, { ...base, duration: def?.duration ?? t.duration, target: def?.target ?? t.target, accumulated: 0, running: (def?.kind ?? t.kind) === 'countdownTo', startedAt: undefined })
    case 'restart':
      return patch(id, { ...base, duration: def?.duration ?? t.duration, target: def?.target ?? t.target, accumulated: 0, running: true, startedAt: now })
    case 'adjust': {
      const s = opts.seconds ?? 60
      if (t.kind === 'elapsed') return patch(id, { accumulated: Math.max(-(t.running && t.startedAt ? (now - t.startedAt) / 1000 : 0), (t.accumulated ?? 0) + s) })
      if (t.kind === 'countdownTo' && t.target) {
        const [h, m] = t.target.split(':').map(Number)
        const total = (((h * 60 + m + Math.round(s / 60)) % 1440) + 1440) % 1440
        return patch(id, { target: `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` })
      }
      // Never let "-1 min" push a countdown below zero remaining.
      const remaining = timerValue(t, now)
      return patch(id, { duration: (t.duration ?? 0) + Math.max(s, -Math.max(0, remaining)) })
    }
    case 'set': {
      if (opts.target) return patch(id, { kind: 'countdownTo', target: opts.target, running: true, accumulated: 0, startedAt: undefined })
      return patch(id, { kind: t.kind === 'elapsed' ? 'elapsed' : 'countdown', duration: opts.duration ?? opts.seconds ?? t.duration, accumulated: 0, running: true, startedAt: now })
    }
  }
}

const ended = new Set<ID>()

/** Runs a few times a second: stops countdowns that may not overrun and announces timers reaching zero. */
function tick(): void {
  const now = Date.now()
  for (const t of live.state.timers) {
    if (!timerExpired(t, now)) { if (t.kind !== 'elapsed' && timerValue(t, now) > 0) ended.delete(t.id); continue }
    if (!ended.has(t.id)) {
      ended.add(t.id)
      api.emit('timers.ended', { id: t.id, name: t.name })
    }
    if (t.overrun) continue
    if (t.kind === 'countdown' && t.running) patch(t.id, { running: false, startedAt: undefined, accumulated: t.duration ?? 0 })
    // Freeze a countdown-to-time at 0:00 instead of showing "-0:01" (until it is reset or edited).
    else if (t.kind === 'countdownTo') patch(t.id, { kind: 'countdown', duration: 0, accumulated: 0, running: false, startedAt: undefined })
  }
}

/** Start an "Item" countdown from the planned length of the service item that just went live. */
let lastItem: ID | undefined
function serviceItemTimer(s: LiveState): void {
  const itemId = s.slide?.playlistItemId
  if (itemId === lastItem) return
  lastItem = itemId
  if (!timersDoc.current.serviceItemTimer || !itemId || !s.slide?.playlistId) return
  const item = library.getPlaylist(s.slide.playlistId)?.items.find((i) => i.id === itemId)
  const length = item && 'length' in item ? item.length : undefined
  if (!length) return
  const name = 'Item'
  ended.delete(SERVICE_ITEM_TIMER_ID)
  setTimers((l) => [
    ...l.filter((t) => t.id !== SERVICE_ITEM_TIMER_ID),
    { id: SERVICE_ITEM_TIMER_ID, name, kind: 'countdown', duration: length, overrun: true, running: true, startedAt: Date.now(), accumulated: 0 }
  ])
}

let interval: NodeJS.Timeout | null = null

export default defineService({
  name: 'timers',
  order: 40,
  async setup() {
    syncLive(await timersDoc.get())
    timersDoc.onChange(syncLive)
    interval = setInterval(tick, 200)
    api.on('live.changed', serviceItemTimer)

    api.handle('timers.list', () => timersDoc.get(), 'public')
    api.handle('timers.save', async ({ timer }) => {
      const def: TimerDef = { kind: 'countdown', duration: 300, ...timer, id: timer.id || uid('tm') }
      if (def.kind === 'countdownTo' && !def.target) def.target = '09:00'
      const doc = await timersDoc.update((d) => {
        const i = d.timers.findIndex((t) => t.id === def.id)
        if (i >= 0) d.timers[i] = def
        else d.timers.push(def)
      })
      syncLive(doc)
      return def
    })
    api.handle('timers.remove', async ({ id }) => {
      syncLive(await timersDoc.update((d) => { d.timers = d.timers.filter((t) => t.id !== id) }))
    })
    api.handle('timers.settings', async (patchDoc) => timersDoc.update((d) => { Object.assign(d, patchDoc) }))
    api.handle('timers.control', ({ id, action, ...opts }) => controlTimer(id, action, opts))
    api.handle('timers.showCountdown', ({ id, heading, start }) => {
      const t = liveTimer(id)
      if (!t) throw new Error('Timer not found')
      if (start !== false && t.kind !== 'countdownTo' && !t.running) controlTimer(id, timerValue(t) <= 0 ? 'restart' : 'start')
      const size = workspace.config.defaultSize
      return live.mutate((s) => {
        const slide = countdownSlide(t.name, heading ?? `${t.name} in`, size)
        s.slide = { presentationId: '', presentationTitle: `${t.name} countdown`, slideId: slide.id, index: -1, slide, size, build: 0, next: null }
        delete s.cleared.slide
      })
    })

    const timerParam = { key: 'id', label: 'Timer', kind: 'timer' as const }
    const act = (action: 'start' | 'stop' | 'reset' | 'restart') => (p: Record<string, unknown>): void => {
      const t = pick(live.state.timers, p)
      if (!t) throw new Error(`Timer not found: ${String(p.id ?? p.index ?? '')}`)
      controlTimer(t.id, action)
    }
    defineAction({ type: 'timer.start', label: 'Start timer', category: 'Timers', params: [timerParam] }, act('start'))
    defineAction({ type: 'timer.stop', label: 'Stop timer', category: 'Timers', params: [timerParam] }, act('stop'))
    defineAction({ type: 'timer.reset', label: 'Reset timer', category: 'Timers', params: [timerParam] }, act('reset'))
    defineAction({ type: 'timer.restart', label: 'Restart timer from the top', category: 'Timers', params: [timerParam] }, act('restart'))
    defineAction({
      type: 'timer.set', label: 'Set timer and start', category: 'Timers', description: 'Give a timer a new length (or a clock time to count down to) and start it.',
      params: [timerParam, { key: 'duration', label: 'Length', kind: 'duration', optional: true }, P.text('target', 'Or count down to (HH:MM)', { optional: true })]
    }, (p) => {
      const t = pick(live.state.timers, p)
      if (!t) throw new Error('Timer not found')
      controlTimer(t.id, 'set', { duration: p.duration === undefined || p.duration === '' ? undefined : Number(p.duration), target: p.target ? String(p.target) : undefined })
    })
    defineAction({
      type: 'timer.adjust', label: 'Add / remove time', category: 'Timers',
      params: [timerParam, P.num('seconds', 'Seconds (negative removes)', { default: 60 })]
    }, (p) => {
      const t = pick(live.state.timers, p)
      if (!t) throw new Error('Timer not found')
      controlTimer(t.id, 'adjust', { seconds: Number(p.seconds ?? 60) })
    })
    defineAction({
      type: 'timer.showCountdown', label: 'Show countdown full screen', category: 'Timers',
      params: [timerParam, P.text('heading', 'Heading', { optional: true, hint: 'e.g. Service starts in' })]
    }, async (p) => {
      const t = pick(live.state.timers, p)
      if (!t) throw new Error('Timer not found')
      await api.invoke('timers.showCountdown', { id: t.id, heading: p.heading ? String(p.heading) : undefined })
    })
  },
  dispose() {
    if (interval) clearInterval(interval)
  }
})
