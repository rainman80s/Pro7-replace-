import { describe, expect, it } from 'vitest'
import { ReceiverRegistry, deviceNameFromUA, type SavedReceiver } from '../src/main/services/outputs/receivers'
import { FramePump, MemorySink, cropEven } from '../src/main/services/outputs/frames'

function store(initial: SavedReceiver[] = []) {
  let data = initial
  let writes = 0
  return { load: () => data, save: (l: SavedReceiver[]) => { data = JSON.parse(JSON.stringify(l)); writes++ }, get data() { return data }, get writes() { return writes } }
}

describe('receiver registry', () => {
  it('registers, names from UA, tracks online/offline and persists', () => {
    let t = 1000
    const s = store()
    const r = new ReceiverRegistry(s, () => t)
    const rec = r.hello('c1', { receiverId: 'rx-1', width: 1920, height: 1080 }, '10.0.0.5', 'Mozilla/5.0 (Linux; Android 9; AFTMM) Silk/1')
    expect(rec.name).toBe('Fire TV')
    expect(r.isOnline('rx-1')).toBe(true)
    expect(s.data[0].width).toBe(1920)
    // second Fire TV gets a unique name
    expect(r.hello('c2', { receiverId: 'rx-2' }, '10.0.0.6', 'AFTMM').name).toBe('Fire TV 2')
    t = 5000
    r.disconnect('c1')
    expect(r.isOnline('rx-1')).toBe(false)
    expect(r.list().find((x) => x.id === 'rx-1')).toMatchObject({ connected: false, lastSeen: 5000 })
    // online ones listed first
    expect(r.list()[0].id).toBe('rx-2')
  })

  it('a rebooted TV comes back as the same receiver with its name', () => {
    const s = store()
    const r1 = new ReceiverRegistry(s)
    r1.hello('c1', { receiverId: 'rx-lobby' }, '10.0.0.9', '')
    r1.rename('rx-lobby', 'Lobby Left')
    r1.disconnect('c1')
    const r2 = new ReceiverRegistry(s) // app restarted
    const again = r2.hello('c9', { receiverId: 'rx-lobby', name: 'Something else' }, '10.0.0.10', '')
    expect(again.name).toBe('Lobby Left') // user rename wins over URL name
    expect(r2.get('rx-lobby')!.address).toBe('10.0.0.10')
  })

  it('heartbeats do not hammer the disk', () => {
    let t = 0
    const s = store()
    const r = new ReceiverRegistry(s, () => t)
    r.hello('c1', { receiverId: 'rx' }, 'a', '')
    const w = s.writes
    for (let i = 0; i < 10; i++) { t += 5000; r.hello('c1', { receiverId: 'rx', rttMs: 3 }, 'a', '') }
    expect(s.writes - w).toBeLessThanOrEqual(1)
  })

  it('forget removes a receiver; two tabs count as two connections', () => {
    const r = new ReceiverRegistry(store())
    r.hello('a', { receiverId: 'x' }, '1', '')
    r.hello('b', { receiverId: 'x' }, '1', '')
    expect(r.list()[0].connections).toBe(2)
    expect(r.clientsOf('x').sort()).toEqual(['a', 'b'])
    expect(r.forget('x')).toBe(true)
    expect(r.list()).toEqual([])
  })

  it('rejects missing ids and names devices sensibly', () => {
    const r = new ReceiverRegistry(store())
    expect(() => r.hello('a', { receiverId: '' }, '1', '')).toThrow()
    expect(deviceNameFromUA('Mozilla/5.0 (X11; Linux armv7l) Chromium')).toBe('Raspberry Pi')
    expect(deviceNameFromUA('Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0)')).toBe('Samsung TV')
    expect(deviceNameFromUA('')).toBe('Network display')
  })
})

describe('frame pump (NDI plumbing with a fake sink)', () => {
  it('crops odd sizes to even', () => {
    const buf = Buffer.alloc(3 * 3 * 4, 1)
    const c = cropEven(buf, 3, 3)
    expect([c.width, c.height, c.data.length]).toEqual([2, 2, 16])
    const same = Buffer.alloc(4 * 2 * 4)
    expect(cropEven(same, 4, 2).data).toBe(same)
  })

  it('sends the newest frame, drops stale ones, never overlaps, keeps alive', async () => {
    let t = 0
    const sink = new MemorySink(5)
    const pump = new FramePump(sink, { name: 'Test', width: 4, height: 2, fps: 30, alpha: false, keepAliveMs: 500 }, () => t)
    await pump.start(false)
    expect(sink.opened?.name).toBe('Test')
    expect(await pump.tick()).toBe(false) // nothing painted yet
    pump.push(4, 2, () => Buffer.alloc(32, 1))
    pump.push(4, 2, () => Buffer.alloc(32, 2)) // replaces the first
    expect(pump.stats.dropped).toBe(1)
    t = 10
    expect(await pump.tick()).toBe(true)
    expect(sink.count).toBe(1)
    expect(sink.frames[0].data[0]).toBe(2)
    t = 20
    expect(await pump.tick()).toBe(false) // nothing new, keep-alive not due
    t = 600
    expect(await pump.tick()).toBe(true) // keep-alive repeat
    expect(pump.stats.repeated).toBe(1)
    await pump.stop()
    expect(sink.closed).toBe(true)
    pump.push(4, 2, () => Buffer.alloc(32))
    expect(await pump.tick()).toBe(false)
  })

  it('back-pressure: a slow sink is never called concurrently', async () => {
    const sink = new MemorySink(1, 30)
    let concurrent = 0
    let max = 0
    const orig = sink.send.bind(sink)
    sink.send = async (f) => { concurrent++; max = Math.max(max, concurrent); await orig(f); concurrent-- }
    const pump = new FramePump(sink, { name: 'Slow', width: 2, height: 2, fps: 60, alpha: true })
    await pump.start(false)
    pump.push(2, 2, () => Buffer.alloc(16))
    const a = pump.tick()
    pump.push(2, 2, () => Buffer.alloc(16))
    const b = pump.tick() // busy → false
    expect(await b).toBe(false)
    await a
    expect(max).toBe(1)
    expect(sink.frames[0].alpha).toBe(true)
    await pump.stop()
  })

  it('records sink errors without throwing', async () => {
    const sink = new MemorySink()
    sink.send = () => { throw new Error('boom') }
    const pump = new FramePump(sink, { name: 'E', width: 2, height: 2, fps: 30, alpha: false })
    await pump.start(false)
    pump.push(2, 2, () => Buffer.alloc(16))
    await pump.tick()
    expect(pump.stats.errors).toBe(1)
    expect(pump.stats.lastError).toBe('boom')
  })
})
