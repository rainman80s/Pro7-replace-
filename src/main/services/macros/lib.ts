/**
 * Helpers shared by the show-control services: cached workspace docs and the action registry
 * (action handlers + the parameter schemas UIs use to render forms).
 */
import type { ActionTypeInfo, ParamSpec } from '@shared/control'
import type { ID, Presentation } from '@shared/model'
import { orderedSlides } from '@shared/model'
import { api } from '../../core/api'
import { live, type ActionHandler } from '../../core/live'
import { library } from '../../core/library'
import { workspace } from '../../core/workspace'

/** A workspace JSON doc kept in memory and refreshed when it changes on disk (sync, another computer). */
export class DocStore<T> {
  private cache: T | null = null
  private listeners = new Set<(v: T) => void>()
  constructor(readonly name: string, private fallback: () => T, private normalize: (v: T) => T = (v) => v) {
    api.on('workspace.docChanged', (e) => {
      if (e.name !== this.name) return
      void this.load().then((v) => this.listeners.forEach((l) => l(v)))
    })
  }
  async load(): Promise<T> {
    const raw = await workspace.readDoc<T | null>(this.name, null)
    this.cache = this.normalize(raw ?? this.fallback())
    return this.cache
  }
  async get(): Promise<T> {
    return this.cache ?? this.load()
  }
  /** Last loaded value (call `get()` once at startup first). */
  get current(): T {
    return this.cache ?? this.fallback()
  }
  async set(value: T): Promise<T> {
    this.cache = this.normalize(value)
    await workspace.writeDoc(this.name, this.cache)
    return this.cache
  }
  async update(fn: (v: T) => T | void): Promise<T> {
    const cur = structuredClone(await this.get())
    return this.set((fn(cur) as T | undefined) ?? cur)
  }
  onChange(cb: (v: T) => void): void {
    this.listeners.add(cb)
  }
}

const infos = new Map<string, ActionTypeInfo>()

/** Register an action handler together with its description + parameter schema. */
export function defineAction(info: Omit<ActionTypeInfo, 'available'>, handler: ActionHandler): void {
  infos.set(info.type, info)
  live.registerAction(info.type, handler)
}

/** Describe an action type that some other module registers (core built-ins). */
export function describeActionType(info: Omit<ActionTypeInfo, 'available'>): void {
  infos.set(info.type, info)
}

export function actionTypes(): ActionTypeInfo[] {
  const registered = new Set(live.actionTypes())
  const out: ActionTypeInfo[] = [...infos.values()].map((i) => ({ ...i, available: registered.has(i.type) }))
  // Anything registered by another feature without a schema still shows up, with a raw JSON editor.
  for (const type of registered) {
    if (!infos.has(type)) out.push({ type, label: type, category: 'Other', params: [{ key: '$json', label: 'Parameters (JSON)', kind: 'json', optional: true }], available: true })
  }
  const order = ['Slides', 'Clear', 'Timers', 'Messages', 'Props', 'Stage', 'Media', 'Macros', 'MIDI', 'Network', 'Other']
  return out.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.label.localeCompare(b.label))
}

export const P = {
  text: (key: string, label: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ key, label, kind: 'text', ...extra }),
  num: (key: string, label: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ key, label, kind: 'number', ...extra }),
  bool: (key: string, label: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ key, label, kind: 'boolean', ...extra }),
  select: (key: string, label: string, options: (string | { value: string | number; label: string })[], extra: Partial<ParamSpec> = {}): ParamSpec =>
    ({ key, label, kind: 'select', options: options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)), ...extra })
}

/** Pick an item by `id` (id or name) or by 1-based `index` — the two ways actions refer to things. */
export function pick<T extends { id: ID; name: string }>(list: T[], params: Record<string, unknown>, idKey = 'id'): T | undefined {
  const key = params[idKey]
  if (key !== undefined && key !== null && key !== '') {
    const k = String(key)
    return list.find((x) => x.id === k) ?? list.find((x) => x.name.toLowerCase() === k.toLowerCase())
  }
  const i = Number(params.index)
  return Number.isFinite(i) && i >= 1 ? list[Math.round(i) - 1] : undefined
}

/** Where next/prev currently operates (the engine keeps this private; we only read it). */
export function liveCursor(): { presentationId: ID; arrangementId?: ID; playlistId?: ID; playlistItemId?: ID } | null {
  const c = (live as unknown as { cursor: { presentationId: ID; arrangementId?: ID; playlistId?: ID; playlistItemId?: ID } | null }).cursor
  if (c) return c
  const s = live.state.slide
  return s?.presentationId ? { presentationId: s.presentationId, playlistId: s.playlistId, playlistItemId: s.playlistItemId } : null
}

export function currentPresentation(): { p: Presentation; slides: ReturnType<typeof orderedSlides> } | null {
  const c = liveCursor()
  const p = c ? library.get(c.presentationId) : null
  return p ? { p, slides: orderedSlides(p, c!.arrangementId) } : null
}

/** The playlist navigation acts on: the one that is live, else the first. */
export function activePlaylist(preferId?: ID): ReturnType<typeof library.getPlaylist> {
  const id = preferId ?? selectedPlaylistId ?? live.state.slide?.playlistId
  return (id ? library.getPlaylist(id) : null) ?? library.listPlaylists()[0] ?? null
}

let selectedPlaylistId: ID | undefined
export const selectPlaylist = (id: ID | undefined): void => { selectedPlaylistId = id }

/** Go to a playlist item by 0-based position among the non-header items, or step ±1 from the live one. */
export function goToPlaylistItem(opts: { index?: number; step?: number; playlistId?: ID }): boolean {
  const pl = activePlaylist(opts.playlistId)
  if (!pl) return false
  const items = pl.items.filter((i) => i.type === 'presentation')
  let i = opts.index ?? -1
  if (opts.step) {
    const cur = items.findIndex((x) => x.id === live.state.slide?.playlistItemId)
    i = cur + opts.step
    if (cur < 0) i = opts.step > 0 ? 0 : -1
  }
  const item = items[i]
  if (!item || item.type !== 'presentation') return false
  live.goToSlide({ presentationId: item.presentationId, index: 0, playlistId: pl.id, playlistItemId: item.id, arrangementId: item.arrangementId })
  return true
}

/** Let other parts of the app see what a trigger/MIDI note just did. */
export function announceRun(source: string, label: string): void {
  api.emit('control.ran', { source, label, at: Date.now() })
}
