import { describe, expect, it } from 'vitest'
import { compatApi, reachApi, type RestDeps } from '../src/main/services/remote/rest'
import { decodeOsc, encodeOsc, oscToAction } from '../src/main/services/remote/osc'
import { emptyLiveState, type LiveState } from '../src/shared/model'

function deps(): RestDeps & { calls: [string, unknown][] } {
  const live: LiveState = emptyLiveState()
  live.timers = [
    { id: 'svc', name: 'Service starts', kind: 'countdown', duration: 300, running: false, accumulated: 0 },
    { id: 'ser', name: 'Sermon', kind: 'countdown', duration: 60, running: true, startedAt: 1000, accumulated: 0, overrun: true }
  ]
  live.slide = {
    presentationId: 'p1', presentationTitle: 'Amazing Grace', slideId: 's1', index: 1, size: { width: 1920, height: 1080 },
    slide: { id: 's1', notes: 'Quiet', elements: [{ id: 'e', type: 'text', frame: { x: 0, y: 0, w: 1, h: 1 }, style: {}, paragraphs: [{ runs: [{ text: 'Amazing grace' }] }] }] },
    next: { index: 2, slide: { id: 's2', elements: [{ id: 'e2', type: 'text', frame: { x: 0, y: 0, w: 1, h: 1 }, style: {}, paragraphs: [{ runs: [{ text: 'That saved' }] }] }] } }
  }
  live.stageMessage = 'Wrap up'
  const calls: [string, unknown][] = []
  const lists: Record<string, unknown> = {
    'macros.list': [{ id: 'm1', name: 'Pre-service', color: '#3886CE', actions: [] }],
    'props.list': { props: [{ id: 'logo', name: 'Logo', slide: { id: 'x', elements: [] }, size: { width: 1, height: 1 } }], masks: [] },
    'messages.list': { messages: [{ id: 'nursery', name: 'Nursery call', text: 'Parent of {number}' }], stagePresets: [] },
    'triggers.fire': 1,
    'timers.list': { timers: [] }
  }
  return {
    calls, live: () => live, now: () => 31_000,
    info: { version: '0.1.0', platform: 'mac', osVersion: '25', host: 'booth' },
    call: async (m, p) => { calls.push([m, p]); return lists[m] },
    rpc: async (m, p) => { calls.push(['rpc:' + m, p]); return 'ok' }
  }
}
const req = (method: string, path: string, body?: unknown, q = '') => ({ method, path, query: new URLSearchParams(q), body })

describe('ProPresenter-compatible API', () => {
  it('/version and /v1/status/slide', async () => {
    const d = deps()
    expect((await compatApi(req('GET', '/version'), d))?.body).toMatchObject({ name: 'Reach Presenter', api_version: 'v1' })
    expect((await compatApi(req('GET', '/v1/status/slide'), d))?.body).toEqual({
      current: { text: 'Amazing grace', notes: 'Quiet', uuid: 's1' }, next: { text: 'That saved', notes: '', uuid: 's2' }
    })
  })
  it('next / previous / index triggers', async () => {
    const d = deps()
    expect((await compatApi(req('GET', '/v1/presentation/active/next/trigger'), d))?.status).toBe(204)
    await compatApi(req('GET', '/v1/trigger/previous'), d)
    await compatApi(req('GET', '/v1/presentation/active/3/trigger'), d)
    await compatApi(req('GET', '/v1/presentation/focused/group/Chorus/trigger'), d)
    expect(d.calls).toEqual([
      ['live.next', undefined], ['live.prev', undefined],
      ['live.runAction', { type: 'live.slideIndex', params: { index: 4 } }],
      ['live.runAction', { type: 'live.group', params: { name: 'Chorus' } }]
    ])
  })
  it('clear layers with ProPresenter names', async () => {
    const d = deps()
    await compatApi(req('GET', '/v1/clear/layer/messages'), d)
    await compatApi(req('GET', '/v1/clear/layer/media'), d)
    expect((await compatApi(req('GET', '/v1/clear/layer/video_input'), d))?.status).toBe(204)
    expect((await compatApi(req('GET', '/v1/clear/layer/bogus'), d))?.status).toBe(400)
    expect(d.calls.map((c) => (c[1] as { params: { layer: string } }).params.layer)).toEqual(['message', 'media'])
  })
  it('timers: list, current, operations by name / index / id', async () => {
    const d = deps()
    expect((await compatApi(req('GET', '/v1/timers'), d))?.body).toEqual([
      { id: { uuid: 'svc', name: 'Service starts', index: 0 }, allows_overrun: false, countdown: { duration: 300 } },
      { id: { uuid: 'ser', name: 'Sermon', index: 1 }, allows_overrun: true, countdown: { duration: 60 } }
    ])
    expect((await compatApi(req('GET', '/v1/timers/current'), d))?.body).toEqual([
      { id: { uuid: 'svc', name: 'Service starts', index: 0 }, time: '00:05:00', state: 'stopped' },
      { id: { uuid: 'ser', name: 'Sermon', index: 1 }, time: '00:00:30', state: 'running' }
    ])
    await compatApi(req('GET', '/v1/timer/Sermon/stop'), d)
    await compatApi(req('GET', '/v1/timer/0/start'), d)
    await compatApi(req('GET', '/v1/timer/ser/increment/15'), d)
    expect(d.calls).toEqual([
      ['timers.control', { id: 'ser', action: 'stop' }], ['timers.control', { id: 'svc', action: 'start' }],
      ['timers.control', { id: 'ser', action: 'adjust', seconds: 15 }]
    ])
    expect((await compatApi(req('GET', '/v1/timer/nope/start'), d))?.status).toBe(404)
    expect((await compatApi(req('GET', '/v1/timer/system_time'), d))?.body).toBe(31)
  })
  it('macros, props, messages, stage message', async () => {
    const d = deps()
    expect((await compatApi(req('GET', '/v1/macros'), d))?.body).toEqual([{ id: { uuid: 'm1', name: 'Pre-service', index: 0 }, color: { red: 0.22, green: 0.525, blue: 0.808, alpha: 1 } }])
    await compatApi(req('GET', '/v1/macro/Pre-service/trigger'), d)
    await compatApi(req('GET', '/v1/prop/0/trigger'), d)
    await compatApi(req('POST', '/v1/message/Nursery call/trigger', [{ name: 'number', text: { text: '42' } }]), d)
    await compatApi(req('PUT', '/v1/stage/message', 'Five minutes'), d)
    expect((await compatApi(req('GET', '/v1/stage/message'), d))?.body).toBe('Wrap up')
    const acts = d.calls.filter((c) => !c[0].endsWith('.list'))
    expect(acts).toEqual([
      ['live.runMacro', { id: 'm1' }], ['props.toggle', { id: 'logo', on: true }],
      ['messages.show', { id: 'nursery', values: { number: '42' } }], ['messages.stage', { text: 'Five minutes' }]
    ])
  })
  it('unknown path → null (falls through), wrong method → 405', async () => {
    expect(await compatApi(req('GET', '/v1/looks'), deps())).toBeNull()
    expect((await compatApi(req('POST', '/v1/trigger/next'), deps()))?.status).toBe(405)
  })
})

describe('Reach REST API', () => {
  it('status, next, slide, clear, macro, action, rpc', async () => {
    const d = deps()
    expect((await reachApi(req('GET', '/api/v1/status'), d))?.body).toMatchObject({ title: 'Amazing Grace', current: 'Amazing grace', stageMessage: 'Wrap up' })
    for (const [m, p] of [['POST', '/api/v1/next'], ['GET', '/api/v1/prev'], ['POST', '/api/v1/slide/3'], ['POST', '/api/v1/clear/slide'], ['POST', '/api/v1/macro/m1'], ['POST', '/api/v1/item/next']]) {
      expect((await reachApi(req(m, p), d))?.status).toBe(204)
    }
    await reachApi(req('POST', '/api/v1/action', { type: 'timer.start', params: { id: 'Sermon' } }), d)
    expect((await reachApi(req('POST', '/api/v1/rpc/live.get'), d))?.body).toEqual({ result: 'ok' })
    expect(d.calls.map((c) => c[0])).toEqual(['live.next', 'live.prev', 'live.runAction', 'live.runAction', 'live.runMacro', 'live.runAction', 'live.runAction', 'rpc:live.get'])
    expect((await reachApi(req('POST', '/api/v1/action', {}), d))?.status).toBe(400)
  })
  it('timers, messages with query values, web-hook triggers', async () => {
    const d = deps()
    await reachApi(req('POST', '/api/v1/timer/Sermon/adjust', undefined, 'seconds=-60'), d)
    await reachApi(req('GET', '/api/v1/message/nursery/show', undefined, 'number=12&seconds=30&token=1234'), d)
    expect((await reachApi(req('POST', '/api/v1/trigger/doors-open'), d))?.body).toEqual({ fired: 1 })
    expect(d.calls.slice(0, 2)).toEqual([
      ['timers.control', { id: 'ser', action: 'adjust', seconds: -60, duration: undefined, target: undefined }],
      ['messages.show', { id: 'nursery', values: { number: '12' }, seconds: 30 }]
    ])
    expect((await reachApi(req('GET', '/api/v1/timers'), d))?.status).toBe(200)
  })
})

describe('OSC', () => {
  it('round-trips and maps addresses', () => {
    const [m] = decodeOsc(encodeOsc('/reach/slide', [4]))
    expect(m).toEqual({ address: '/reach/slide', args: [4] })
    expect(oscToAction(m)).toEqual({ type: 'live.slideIndex', params: { index: 4 } })
    expect(oscToAction(decodeOsc(encodeOsc('/reach/macro', ['Pre-service']))[0])).toEqual({ macro: 'Pre-service' })
    expect(oscToAction(decodeOsc(encodeOsc('/reach/timer/Sermon/stop'))[0])).toEqual({ type: 'timer.stop', params: { id: 'Sermon' } })
    expect(oscToAction(decodeOsc(encodeOsc('/other/next'))[0])).toBeNull()
    expect(decodeOsc(encodeOsc('/x', [1.5, 'hi']))[0].args).toEqual([1.5, 'hi'])
  })
})
