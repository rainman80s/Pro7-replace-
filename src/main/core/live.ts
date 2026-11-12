import type { ID, LayerId, LiveMedia, LiveSlide, LiveState, Macro, Presentation, SlideAction, TimerState } from '@shared/model'
import { emptyLiveState, orderedSlides } from '@shared/model'
import { api } from './api'
import { library } from './library'
import { workspace } from './workspace'

export type ActionHandler = (params: Record<string, unknown>, action: SlideAction) => void | Promise<void>

/**
 * The live engine: one authoritative LiveState. Every change bumps `rev` and
 * broadcasts `live.changed`; outputs are pure functions of this state.
 */
class Live {
  state: LiveState = emptyLiveState()
  private actionHandlers = new Map<string, ActionHandler>()
  private autoAdvanceTimer: NodeJS.Timeout | null = null
  /** Context for next/prev. */
  private cursor: { presentationId: ID; arrangementId?: ID; playlistId?: ID; playlistItemId?: ID } | null = null

  private commit(): LiveState {
    this.state = { ...this.state, rev: this.state.rev + 1 }
    api.emit('live.changed', this.state)
    return this.state
  }

  /** Apply a change to the live state and broadcast it. */
  mutate(fn: (s: LiveState) => void): LiveState {
    fn(this.state)
    return this.commit()
  }

  /** Register a handler for a SlideAction/macro action type, e.g. actions 'midi.send'. */
  registerAction(type: string, handler: ActionHandler): void {
    this.actionHandlers.set(type, handler)
  }

  actionTypes(): string[] {
    return [...this.actionHandlers.keys()].sort()
  }

  async runAction(action: SlideAction): Promise<void> {
    const h = this.actionHandlers.get(action.type)
    if (!h) return void console.warn('[live] no handler for action', action.type)
    const run = async (): Promise<void> => {
      try {
        await h(action.params ?? {}, action)
      } catch (e) {
        api.emit('ui.notify', { level: 'error', title: `Action failed: ${action.label ?? action.type}`, detail: String(e) })
      }
    }
    if (action.delay) setTimeout(run, action.delay * 1000)
    else await run()
  }

  async runMacro(id: ID): Promise<void> {
    const macros = await workspace.readDoc<Macro[]>('macros', [])
    const m = macros.find((x) => x.id === id || x.name === id)
    if (!m) throw new Error('Macro not found')
    for (const a of m.actions) await this.runAction(a)
  }

  goToSlide(req: { presentationId: ID; slideId?: ID; index?: number; playlistId?: ID; playlistItemId?: ID; arrangementId?: ID }): LiveState {
    const p = library.get(req.presentationId)
    if (!p) throw new Error('Presentation not found')
    const slides = orderedSlides(p, req.arrangementId)
    let index = req.index ?? (req.slideId ? slides.findIndex((s) => s.id === req.slideId) : 0)
    // A slide that's disabled / not in the arrangement can still be clicked.
    let slide = slides[index]
    if (!slide && req.slideId) {
      slide = p.slides.find((s) => s.id === req.slideId)!
      index = -1
    }
    if (!slide) throw new Error('Slide not found')
    this.cursor = { presentationId: p.id, arrangementId: req.arrangementId, playlistId: req.playlistId, playlistItemId: req.playlistItemId }
    const next = index >= 0 && slides[index + 1] ? { slide: slides[index + 1], index: index + 1 } : null
    const ls: LiveSlide = {
      presentationId: p.id, presentationTitle: p.title, slideId: slide.id, index, slide, size: p.size, build: 0, next,
      playlistId: req.playlistId, playlistItemId: req.playlistItemId, transition: slide.transition
    }
    const isAnnouncement = p.kind === 'announcement'
    this.mutate((s) => {
      if (isAnnouncement) { s.announcement = ls; delete s.cleared.announcement }
      else { s.slide = ls; delete s.cleared.slide }
    })
    for (const a of slide.actions ?? []) void this.runAction(a)
    this.scheduleAutoAdvance(slide.autoAdvance, p)
    return this.state
  }

  private scheduleAutoAdvance(seconds: number | undefined, p: Presentation): void {
    if (this.autoAdvanceTimer) clearTimeout(this.autoAdvanceTimer)
    this.autoAdvanceTimer = null
    if (!seconds || seconds <= 0) return
    this.autoAdvanceTimer = setTimeout(() => {
      const layer = p.kind === 'announcement' ? this.state.announcement : this.state.slide
      if (layer?.presentationId !== p.id) return
      const slides = orderedSlides(p, this.cursor?.arrangementId)
      const nextIndex = (layer.index + 1) % slides.length
      this.goToSlide({ ...this.cursor!, presentationId: p.id, index: nextIndex })
    }, seconds * 1000)
  }

  step(delta: 1 | -1): LiveState {
    const cur = this.state.slide
    if (!cur || !this.cursor) return this.state
    const p = library.get(cur.presentationId)
    if (!p) return this.state
    // Builds first.
    const maxBuild = Math.max(0, ...cur.slide.elements.map((e) => e.buildIn ?? 0))
    if (delta === 1 && (cur.build ?? 0) < maxBuild) {
      return this.mutate((s) => { s.slide = { ...cur, build: (cur.build ?? 0) + 1 } })
    }
    const slides = orderedSlides(p, this.cursor.arrangementId)
    const index = cur.index + delta
    if (index < 0) return this.state
    if (index >= slides.length) {
      // End of this item: hand off to the playlist feature if someone listens.
      this.onEndOfPresentation?.(this.cursor)
      return this.state
    }
    return this.goToSlide({ ...this.cursor, index })
  }

  /** Set by the playlist/show feature to continue into the next playlist item. */
  onEndOfPresentation?: (cursor: NonNullable<Live['cursor']>) => void

  setMedia(layer: 'background' | 'video' | 'audio', media: LiveMedia | null): LiveState {
    return this.mutate((s) => {
      s[layer] = media ? { ...media, playing: media.playing ?? true, startedAt: Date.now(), offset: media.offset ?? 0 } : null
      if (layer !== 'audio') delete s.cleared[layer]
    })
  }

  transport(layer: 'background' | 'video' | 'audio', action: 'play' | 'pause' | 'restart' | 'seek', time?: number): LiveState {
    return this.mutate((s) => {
      const m = s[layer]
      if (!m) return
      const now = Date.now()
      const pos = m.playing && m.startedAt ? (m.offset ?? 0) + (now - m.startedAt) / 1000 : (m.offset ?? 0)
      if (action === 'pause') s[layer] = { ...m, playing: false, offset: pos, startedAt: now }
      if (action === 'play') s[layer] = { ...m, playing: true, offset: pos, startedAt: now }
      if (action === 'restart') s[layer] = { ...m, playing: true, offset: 0, startedAt: now }
      if (action === 'seek') s[layer] = { ...m, offset: time ?? 0, startedAt: now }
    })
  }

  clear(layer: LayerId | 'all' | 'audio'): LiveState {
    return this.mutate((s) => {
      const clearOne = (l: LayerId | 'audio'): void => {
        if (l === 'slide') s.slide = null
        else if (l === 'announcement') s.announcement = null
        else if (l === 'background') s.background = null
        else if (l === 'video') s.video = null
        else if (l === 'audio') s.audio = null
        else if (l === 'props') s.props = []
        else if (l === 'message') s.messages = []
        else if (l === 'mask') s.mask = null
      }
      if (layer === 'all') {
        // "Clear all" leaves announcements and the mask alone by design, like ProPresenter.
        for (const l of ['slide', 'background', 'video', 'audio', 'props', 'message'] as const) clearOne(l)
        s.blackout = false
        s.logo = false
      } else clearOne(layer)
    })
  }

  timer(action: 'upsert' | 'start' | 'stop' | 'reset' | 'remove', t?: Partial<TimerState> & { id: ID }): LiveState {
    return this.mutate((s) => {
      if (!t) return
      const i = s.timers.findIndex((x) => x.id === t.id)
      const cur = i >= 0 ? s.timers[i] : undefined
      const now = Date.now()
      if (action === 'remove') { s.timers = s.timers.filter((x) => x.id !== t.id); return }
      let next: TimerState = { name: 'Timer', kind: 'countdown', duration: 300, running: false, accumulated: 0, ...cur, ...t }
      if (action === 'start' && !next.running) next = { ...next, running: true, startedAt: now }
      if (action === 'stop' && next.running) {
        next = { ...next, running: false, accumulated: (next.accumulated ?? 0) + (now - (next.startedAt ?? now)) / 1000, startedAt: undefined }
      }
      if (action === 'reset') next = { ...next, accumulated: 0, startedAt: next.running ? now : undefined }
      s.timers = i >= 0 ? s.timers.map((x, j) => (j === i ? next : x)) : [...s.timers, next]
    })
  }
}

export const live = new Live()

export function registerLiveApi(): void {
  api.handle('live.get', () => live.state, 'public')
  api.handle('live.goToSlide', (req) => live.goToSlide(req))
  api.handle('live.showSlide', ({ slide, size, title, layer, transition }) =>
    live.mutate((s) => {
      const ls: LiveSlide = {
        presentationId: '', presentationTitle: title, slideId: slide.id, index: -1, slide,
        size: size ?? workspace.config.defaultSize, build: 0, next: null, transition: transition ?? slide.transition
      }
      if (layer === 'announcement') { s.announcement = ls } else { s.slide = ls }
    })
  )
  api.handle('live.next', () => live.step(1))
  api.handle('live.prev', () => live.step(-1))
  api.handle('live.setMedia', ({ layer, media, loop, muted, volume, fit }) =>
    live.setMedia(layer, media ? { media, loop: loop ?? (layer === 'background'), muted: muted ?? (layer === 'background'), volume, fit, playing: true } : null)
  )
  api.handle('live.transport', ({ layer, action, time }) => live.transport(layer, action, time))
  api.handle('live.clear', ({ layer }) => live.clear(layer))
  api.handle('live.setFlag', ({ flag, value }) => live.mutate((s) => { s[flag] = value }))
  api.handle('live.setProp', ({ id, slide, size }) =>
    live.mutate((s) => {
      s.props = s.props.filter((p) => p.id !== id)
      if (slide) s.props = [...s.props, { id, slide, size: size ?? workspace.config.defaultSize }]
    })
  )
  api.handle('live.setMessage', ({ message, id }) =>
    live.mutate((s) => {
      const mid = message?.id ?? id
      s.messages = s.messages.filter((m) => m.id !== mid)
      if (message) s.messages = [...s.messages, message]
    })
  )
  api.handle('live.setMask', ({ media }) => live.mutate((s) => { s.mask = media }))
  api.handle('live.setStageMessage', ({ text }) => live.mutate((s) => { s.stageMessage = text }))
  api.handle('live.timer', ({ action, timer }) => live.timer(action, timer))
  api.handle('live.runAction', ({ type, params }) => live.runAction({ id: 'adhoc', type, params }))
  api.handle('live.runMacro', ({ id }) => live.runMacro(id))

  // Built-in action types usable from slides and macros.
  live.registerAction('live.clear', (p) => void live.clear((p.layer as LayerId | 'all') ?? 'all'))
  live.registerAction('live.next', () => void live.step(1))
  live.registerAction('live.prev', () => void live.step(-1))
  live.registerAction('live.goToSlide', (p) => void live.goToSlide(p as never))
  live.registerAction('live.flag', (p) => void live.mutate((s) => { s[p.flag as 'blackout' | 'logo' | 'frozen'] = !!p.value }))
  live.registerAction('media.play', (p) => void live.setMedia((p.layer as 'background' | 'video' | 'audio') ?? 'background', { media: p.media as LiveMedia['media'], loop: p.loop as boolean | undefined, muted: p.muted as boolean | undefined, playing: true }))
  live.registerAction('timer.start', (p) => void live.timer('start', p as never))
  live.registerAction('timer.stop', (p) => void live.timer('stop', p as never))
  live.registerAction('timer.reset', (p) => void live.timer('reset', p as never))
  live.registerAction('stage.message', (p) => void live.mutate((s) => { s.stageMessage = String(p.text ?? '') }))
  live.registerAction('macro.run', (p) => live.runMacro(String(p.id)))
}
