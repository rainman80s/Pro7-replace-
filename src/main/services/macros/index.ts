/**
 * Macros, the action registry and triggers (hot keys, schedule, slide/group label, startup, web hook, timer end).
 * Macros live in the workspace doc `macros` (an array, the format core `live.runMacro` reads),
 * triggers in `triggers`.
 */
import {
  CLEAR_LAYERS, DAY_NAMES, dueSchedules, findMacro, labelTriggers, minuteKey, runActionList, uid,
  type Trigger, type TriggersDoc
} from '@shared/control'
import type { ID, LayerId, Macro, SlideAction } from '@shared/model'
import { groupOfSlide } from '@shared/model'
import { defineService } from '../../core/service'
import { api } from '../../core/api'
import { live } from '../../core/live'
import { library } from '../../core/library'
import {
  DocStore, P, actionTypes, announceRun, currentPresentation, defineAction, describeActionType,
  goToPlaylistItem, liveCursor, selectPlaylist
} from './lib'

export const macrosDoc = new DocStore<Macro[]>('macros', () => [], (v) => (Array.isArray(v) ? v : []))
export const triggersDoc = new DocStore<TriggersDoc>('triggers', () => ({ triggers: [], scheduleEnabled: true }), (d) => ({ scheduleEnabled: true, ...d, triggers: d.triggers ?? [] }))

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Run one action now, through the registry (no delay handling — the runner does that). */
async function runOne(a: SlideAction): Promise<void> {
  await live.runAction({ ...a, delay: undefined })
}

export async function runMacro(key: { id?: unknown; index?: unknown }, source = 'Macro'): Promise<void> {
  const m = findMacro(macrosDoc.current, key)
  if (!m) throw new Error(`Macro not found: ${String(key.id ?? key.index ?? '')}`)
  announceRun(source, m.name)
  await runActionList(m.actions, {
    run: runOne, sleep, macros: () => macrosDoc.current,
    onError: (a, e) => api.emit('ui.notify', { level: 'error', title: `Macro "${m.name}": a step failed`, detail: `${a.type}: ${e instanceof Error ? e.message : String(e)}` })
  }, [m.id])
}

export async function fireTrigger(t: Trigger, source = 'Trigger'): Promise<void> {
  announceRun(source, t.name)
  if (t.action.type === 'macro.run') return runMacro(t.action.params ?? {}, source)
  await live.runAction({ id: t.id, type: t.action.type, params: t.action.params, label: t.name })
}

function registerCoreActions(): void {
  // Override core's clear so "media" (background + video) works, like ProPresenter's F3.
  defineAction({
    type: 'live.clear', label: 'Clear', category: 'Clear', description: 'Take something off the screens.',
    params: [P.select('layer', 'What to clear', CLEAR_LAYERS, { default: 'all' })]
  }, (p) => {
    const layer = String(p.layer ?? 'all')
    if (layer === 'media') { live.clear('background'); live.clear('video') } else live.clear(layer as LayerId | 'all' | 'audio')
  })
  describeActionType({ type: 'live.next', label: 'Next slide', category: 'Slides', params: [] })
  describeActionType({ type: 'live.prev', label: 'Previous slide', category: 'Slides', params: [] })
  describeActionType({
    type: 'live.flag', label: 'Black screen / logo / freeze', category: 'Clear',
    params: [P.select('flag', 'Which', [{ value: 'blackout', label: 'Black screen' }, { value: 'logo', label: 'Logo' }, { value: 'frozen', label: 'Freeze' }], { default: 'blackout' }), P.bool('value', 'On', { default: true })]
  })
  defineAction({
    type: 'live.toggleFlag', label: 'Toggle black screen / logo / freeze', category: 'Clear',
    params: [P.select('flag', 'Which', [{ value: 'blackout', label: 'Black screen' }, { value: 'logo', label: 'Logo' }, { value: 'frozen', label: 'Freeze' }], { default: 'blackout' })]
  }, (p) => {
    const f = (String(p.flag ?? 'blackout')) as 'blackout' | 'logo' | 'frozen'
    live.mutate((s) => { s[f] = !s[f] })
  })
  describeActionType({
    type: 'live.goToSlide', label: 'Go to a slide in a presentation', category: 'Slides',
    params: [P.text('presentationId', 'Presentation id'), P.num('index', 'Slide position (0 = first)', { default: 0 })]
  })
  describeActionType({
    type: 'media.play', label: 'Play media', category: 'Media',
    params: [P.select('layer', 'Layer', ['background', 'video', 'audio'], { default: 'background' }), { key: 'media', label: 'Media', kind: 'json' }, P.bool('loop', 'Loop', { optional: true })]
  })
  describeActionType({ type: 'stage.message', label: 'Set stage message', category: 'Stage', params: [P.text('text', 'Message')] })

  defineAction({
    type: 'live.slideIndex', label: 'Go to slide number', category: 'Slides', description: 'In the presentation that is live now. 1 = first slide.',
    params: [P.num('index', 'Slide number', { default: 1, min: 1 })]
  }, (p) => {
    const cur = currentPresentation()
    const c = liveCursor()
    if (!cur || !c) throw new Error('Nothing is live yet')
    const i = Math.round(Number(p.index ?? 1)) - 1
    if (i < 0 || i >= cur.slides.length) throw new Error(`There is no slide ${i + 1}`)
    live.goToSlide({ ...c, index: i })
  })
  defineAction({
    type: 'live.group', label: 'Go to song section', category: 'Slides', description: 'Jump to the first slide of a section (e.g. "Chorus") in the live song.',
    params: [P.text('name', 'Section name', { hint: 'e.g. Chorus' })]
  }, (p) => {
    const cur = currentPresentation()
    const c = liveCursor()
    if (!cur || !c) throw new Error('Nothing is live yet')
    const name = String(p.name ?? '').trim().toLowerCase()
    const i = cur.slides.findIndex((s) => groupOfSlide(cur.p, s.id)?.name.toLowerCase() === name)
    if (i < 0) throw new Error(`No section called "${String(p.name)}"`)
    live.goToSlide({ ...c, index: i })
  })
  defineAction({
    type: 'playlist.item', label: 'Service item', category: 'Slides', description: 'Next / previous service item, or item number N (1 = first).',
    params: [P.num('step', 'Step (+1 next, -1 previous)', { optional: true }), P.num('index', 'Or item number', { optional: true, min: 1 })]
  }, (p) => {
    const ok = p.index !== undefined && p.index !== ''
      ? goToPlaylistItem({ index: Math.round(Number(p.index)) - 1 })
      : goToPlaylistItem({ step: Number(p.step ?? 1) || 1 })
    if (!ok) throw new Error('No such service item')
  })
  defineAction({
    type: 'playlist.select', label: 'Choose service', category: 'Slides', description: 'Pick which service (playlist) "Service item" uses. 1 = first.',
    params: [P.text('id', 'Service name or id', { optional: true }), P.num('index', 'Or number', { optional: true, min: 1 })]
  }, (p) => {
    const list = library.listPlaylists()
    const pl = p.id ? list.find((x) => x.id === p.id || x.name.toLowerCase() === String(p.id).toLowerCase()) : list[Math.round(Number(p.index)) - 1]
    if (!pl) throw new Error('Service not found')
    selectPlaylist(pl.id)
  })
  defineAction({
    type: 'media.transport', label: 'Video / audio play-pause', category: 'Media',
    params: [P.select('layer', 'Layer', ['video', 'background', 'audio'], { default: 'video' }), P.select('action', 'Do', ['play', 'pause', 'toggle', 'restart'], { default: 'toggle' })]
  }, (p) => {
    const layer = (String(p.layer ?? 'video')) as 'video' | 'background' | 'audio'
    let action = String(p.action ?? 'toggle')
    if (action === 'toggle') action = live.state[layer]?.playing ? 'pause' : 'play'
    live.transport(layer, action as 'play' | 'pause' | 'restart')
  })
  defineAction({ type: 'macro.run', label: 'Run macro', category: 'Macros', params: [{ key: 'id', label: 'Macro', kind: 'macro' }] }, (p) => runMacro(p))
  defineAction({
    type: 'http.request', label: 'Call a web address', category: 'Network', description: 'Send an HTTP request (e.g. to Companion, a lighting desk or a webhook).',
    params: [P.text('url', 'Address', { hint: 'http://…' }), P.select('method', 'Method', ['GET', 'POST', 'PUT'], { default: 'GET' }), { key: 'body', label: 'Body', kind: 'longtext', optional: true }]
  }, async (p) => {
    const url = String(p.url ?? '')
    if (!/^https?:\/\//i.test(url)) throw new Error('Address must start with http:// or https://')
    const body = p.body ? String(p.body) : undefined
    const r = await fetch(url, {
      method: String(p.method ?? 'GET'), body,
      headers: body && /^\s*[[{]/.test(body) ? { 'content-type': 'application/json' } : undefined,
      signal: AbortSignal.timeout(5000)
    })
    if (!r.ok) throw new Error(`${url} answered ${r.status}`)
  })
}

/* ───────── triggers ───────── */

const fired = new Map<ID, string>()
let lastSlideKey = ''

function onLiveChanged(): void {
  const s = live.state.slide
  const key = s ? `${s.presentationId}/${s.slideId}/${s.index}` : ''
  if (key === lastSlideKey) return
  lastSlideKey = key
  if (!s) return
  const p = s.presentationId ? library.get(s.presentationId) : null
  const group = p ? groupOfSlide(p, s.slideId)?.name : undefined
  for (const t of labelTriggers(triggersDoc.current.triggers, s.slide.label, group)) void fireTrigger(t, 'Slide label').catch(() => {})
}

function scheduleTick(): void {
  const doc = triggersDoc.current
  if (doc.scheduleEnabled === false) return
  const now = Date.now()
  for (const t of dueSchedules(doc.triggers, now, fired)) {
    fired.set(t.id, minuteKey(now))
    void fireTrigger(t, 'Schedule').catch((e) => api.emit('ui.notify', { level: 'error', title: `Scheduled "${t.name}" failed`, detail: String(e) }))
  }
}
export function describeTrigger(t: Trigger): string {
  const w = t.when
  if (w.type === 'hotkey') return `Key ${w.key}`
  if (w.type === 'schedule') return `${w.days.length === 7 ? 'Every day' : w.days.map((d) => DAY_NAMES[d].slice(0, 3)).join(', ')} at ${w.time}`
  if (w.type === 'label') return `Slide ${w.scope === 'group' ? 'section' : 'label'} "${w.match}"`
  if (w.type === 'http') return `Web hook /api/v1/trigger/${w.name}`
  if (w.type === 'timerEnd') return `When timer "${w.timer}" ends`
  return 'When Reach Presenter starts'
}

let interval: NodeJS.Timeout | null = null

export default defineService({
  name: 'macros',
  order: 30,
  async setup() {
    await Promise.all([macrosDoc.get(), triggersDoc.get()])
    registerCoreActions()

    // Our runner: ordered steps, waits for delays, nested macros, loop protection.
    api.handle('live.runMacro', ({ id }) => runMacro({ id }))
    api.handle('actions.types', () => actionTypes(), 'control')

    api.handle('macros.list', () => macrosDoc.get(), 'control')
    api.handle('macros.save', async ({ macro }) => {
      const m: Macro = { actions: [], ...macro, id: macro.id || uid('mac') }
      await macrosDoc.update((list) => {
        const i = list.findIndex((x) => x.id === m.id)
        if (i >= 0) list[i] = m
        else list.push(m)
      })
      return m
    })
    api.handle('macros.remove', async ({ id }) => { await macrosDoc.update((l) => l.filter((m) => m.id !== id)) })
    api.handle('macros.reorder', async ({ ids }) => {
      await macrosDoc.update((l) => [...ids.map((id) => l.find((m) => m.id === id)).filter((m): m is Macro => !!m), ...l.filter((m) => !ids.includes(m.id))])
    })

    api.handle('triggers.list', () => triggersDoc.get(), 'control')
    api.handle('triggers.save', async ({ trigger }) => {
      const t: Trigger = { name: 'Trigger', enabled: true, ...trigger, id: trigger.id || uid('trg') }
      await triggersDoc.update((d) => {
        const i = d.triggers.findIndex((x) => x.id === t.id)
        if (i >= 0) d.triggers[i] = t
        else d.triggers.push(t)
      })
      return t
    })
    api.handle('triggers.remove', async ({ id }) => { await triggersDoc.update((d) => { d.triggers = d.triggers.filter((t) => t.id !== id) }) })
    api.handle('triggers.settings', (patch) => triggersDoc.update((d) => { Object.assign(d, patch) }))
    api.handle('triggers.fire', async ({ id, key, http }) => {
      const list = triggersDoc.current.triggers.filter((t) =>
        id ? t.id === id
          : key ? t.enabled && t.when.type === 'hotkey' && t.when.key.toLowerCase() === key.toLowerCase()
            : http ? t.enabled && t.when.type === 'http' && t.when.name.toLowerCase() === http.toLowerCase() : false)
      for (const t of list) await fireTrigger(t, id ? 'Test' : key ? 'Hot key' : 'Web hook')
      return list.length
    })

    api.on('live.changed', onLiveChanged)
    api.on('timers.ended', (e) => {
      for (const t of triggersDoc.current.triggers) {
        if (t.enabled && t.when.type === 'timerEnd' && (t.when.timer === e.id || t.when.timer.toLowerCase() === e.name.toLowerCase())) void fireTrigger(t, 'Timer').catch(() => {})
      }
    })
    interval = setInterval(scheduleTick, 5000)
    setTimeout(() => {
      for (const t of triggersDoc.current.triggers) if (t.enabled && t.when.type === 'startup') void fireTrigger(t, 'Startup').catch(() => {})
    }, 2000)
  },
  dispose() {
    if (interval) clearInterval(interval)
  }
})
