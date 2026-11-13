import { describe, expect, it } from 'vitest'
import type { Canvas, Output } from '@shared/model'
import { planOutputs, type PlanDisplay } from '../src/main/services/outputs/plan'

const wall: Canvas = { id: 'wall', name: 'LED Wall', kind: 'audience', width: 1920, height: 2160, regions: [{ id: 'top', name: 'LED Top', rect: { x: 0, y: 0, w: 1920, h: 1080 } }, { id: 'bot', name: 'LED Bottom', rect: { x: 0, y: 1080, w: 1920, h: 1080 } }] }
const op: PlanDisplay = { key: 'lap', label: 'Built-in', bounds: { x: 0, y: 0, width: 1512, height: 982 }, size: { width: 3024, height: 1964 }, connected: true, operator: true }
const tvA: PlanDisplay = { key: 'tvA', label: 'SAMSUNG', bounds: { x: 1512, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 }, connected: true, operator: false }
const o = (id: string, p: Partial<Output>): Output => ({ id, name: id, canvasId: 'wall', target: { type: 'window' }, enabled: true, ...p })
const base = { canvases: [wall], receivers: [], safeMode: false, ndiAvailable: false, now: 1_000_000 }

describe('output planning', () => {
  it('opens a fullscreen window on a connected external display', () => {
    const p = planOutputs({ ...base, outputs: [o('a', { regionId: 'top', target: { type: 'display', displayKey: 'tvA' } })], displays: [op, tvA] })
    expect(p.windows).toEqual([{ outputId: 'a', kind: 'display', displayKey: 'tvA', bounds: tvA.bounds }])
    expect(p.health[0]).toMatchObject({ status: 'live', message: 'Showing LED Wall › LED Top.' })
  })
  it('never covers the operator screen unless explicitly allowed', () => {
    const outputs = [o('a', { target: { type: 'display', displayKey: 'lap' } })]
    const p = planOutputs({ ...base, outputs, displays: [op] })
    expect(p.windows).toEqual([])
    expect(p.health[0].status).toBe('blocked')
    const p2 = planOutputs({ ...base, outputs: [{ ...outputs[0], allowOperatorScreen: true }], displays: [op] })
    expect(p2.windows).toHaveLength(1)
  })
  it('unplugged displays are "missing", not reassigned', () => {
    const p = planOutputs({ ...base, outputs: [o('a', { target: { type: 'display', displayKey: 'tvA' } })], displays: [op, { ...tvA, connected: false, lastSeen: 1_000_000 - 120_000 }] })
    expect(p.windows).toEqual([])
    expect(p.health[0].status).toBe('missing')
    expect(p.health[0].message).toContain('2 min ago')
  })
  it('one display shows one output', () => {
    const t = { type: 'display' as const, displayKey: 'tvA' }
    const p = planOutputs({ ...base, outputs: [o('a', { target: t }), o('b', { target: t })], displays: [op, tvA] })
    expect(p.windows).toHaveLength(1)
    expect(p.health[1].status).toBe('blocked')
  })
  it('safe mode hides everything; NDI without runtime is unavailable', () => {
    const outputs = [o('a', { target: { type: 'window' } }), o('n', { target: { type: 'ndi', name: 'Reach' } })]
    expect(planOutputs({ ...base, outputs, displays: [], safeMode: true }).windows).toEqual([])
    const p = planOutputs({ ...base, outputs, displays: [] })
    expect(p.health.find((h) => h.outputId === 'n')!.status).toBe('unavailable')
    const p2 = planOutputs({ ...base, outputs, displays: [], ndiAvailable: true })
    expect(p2.windows.find((w) => w.outputId === 'n')).toMatchObject({ kind: 'capture', size: { width: 1920, height: 2160 } })
  })
  it('groups summarise their members and offline receivers', () => {
    const outputs = [o('r1', { target: { type: 'network', receiverId: 'x' } }), o('r2', { target: { type: 'network', receiverId: 'y' } }), o('g', { target: { type: 'group', outputIds: ['r1', 'r2'] }, regionId: 'bot' })]
    const p = planOutputs({ ...base, outputs, displays: [], receivers: [{ id: 'x', name: 'Lobby 1', connected: true, lastSeen: 0 }, { id: 'y', name: 'Lobby 2', connected: false, lastSeen: 0 }] })
    const g = p.health.find((h) => h.outputId === 'g')!
    expect(g.status).toBe('offline')
    expect(g.message).toContain('1 of 2')
    expect(p.health.find((h) => h.outputId === 'r1')!.message).toBe('Showing LED Wall › LED Bottom.')
  })
})
