/**
 * Props: persistent overlays (logo bug, lower third) saved in workspace doc `props` as slides and toggled
 * onto LiveState.props. Masks: images offered for the mask layer.
 */
import { uid, type PropDef, type PropsDoc } from '@shared/control'
import type { ID, LiveState } from '@shared/model'
import { api } from '../../core/api'
import { live } from '../../core/live'
import { DocStore, P, defineAction, pick } from '../macros/lib'

export const propsDoc = new DocStore<PropsDoc>('props', () => ({ props: [], masks: [] }), (d) => ({ ...d, masks: d.masks ?? [], props: d.props ?? [] }))

const clearTimers = new Map<ID, NodeJS.Timeout>()

export function toggleProp(id: ID, on?: boolean, solo?: boolean): LiveState {
  const def = propsDoc.current.props.find((p) => p.id === id)
  const isOn = live.state.props.some((p) => p.id === id)
  const want = on ?? !isOn
  clearTimeout(clearTimers.get(id))
  clearTimers.delete(id)
  if (!want) return live.mutate((s) => { s.props = s.props.filter((p) => p.id !== id) })
  if (!def) throw new Error('Prop not found')
  const st = live.mutate((s) => {
    s.props = [...s.props.filter((p) => p.id !== id && !solo), { id, slide: def.slide, size: def.size }]
    delete s.cleared.props
  })
  if (def.autoClear && def.autoClear > 0) clearTimers.set(id, setTimeout(() => { clearTimers.delete(id); toggleProp(id, false) }, def.autoClear * 1000))
  return st
}

export async function setupProps(): Promise<void> {
  await propsDoc.get()
  api.handle('props.list', () => propsDoc.get(), 'control')
  api.handle('props.save', async ({ prop }) => {
    const p: PropDef = { ...prop, id: prop.id || uid('prop') }
    await propsDoc.update((d) => {
      const i = d.props.findIndex((x) => x.id === p.id)
      if (i >= 0) d.props[i] = p
      else d.props.push(p)
    })
    // Keep a prop that is on screen up to date.
    if (live.state.props.some((x) => x.id === p.id)) live.mutate((s) => { s.props = s.props.map((x) => (x.id === p.id ? { id: p.id, slide: p.slide, size: p.size } : x)) })
    return p
  })
  api.handle('props.remove', async ({ id }) => {
    toggleProp(id, false)
    await propsDoc.update((d) => { d.props = d.props.filter((p) => p.id !== id) })
  })
  api.handle('props.toggle', ({ id, on, solo }) => toggleProp(id, on, solo))
  api.handle('props.masks', ({ masks }) => propsDoc.update((d) => { d.masks = masks }))

  const propParam = { key: 'id', label: 'Prop', kind: 'prop' as const }
  defineAction({
    type: 'prop.toggle', label: 'Prop on / off', category: 'Props', description: 'Show or hide an overlay such as the logo or a lower third.',
    params: [propParam, P.select('mode', 'Do', [{ value: 'toggle', label: 'Toggle' }, { value: 'on', label: 'Show' }, { value: 'off', label: 'Hide' }], { default: 'toggle' })]
  }, (p) => {
    const def = pick(propsDoc.current.props, p)
    if (!def) throw new Error('Prop not found')
    toggleProp(def.id, p.mode === 'on' ? true : p.mode === 'off' ? false : undefined)
  })
  defineAction({
    type: 'mask.set', label: 'Mask on / off', category: 'Props',
    params: [P.num('index', 'Mask number (empty = remove mask)', { optional: true, min: 1 })]
  }, (p) => {
    const m = p.index ? propsDoc.current.masks[Math.round(Number(p.index)) - 1] : null
    live.mutate((s) => { s.mask = m ?? null })
  })
}
