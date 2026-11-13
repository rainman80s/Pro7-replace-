import { describe, expect, it } from 'vitest'
import {
  dueSchedules, fadeVolume, fillMessage, findByIdOrName, formatHms, formatTimer, keyName, labelTriggers, messageFields,
  nextTrackIndex, parseDuration, runActionList, timerLevel, timerValue, type Trigger
} from '../src/shared/control'
import type { Macro, SlideAction, TimerState } from '../src/shared/model'

const T0 = new Date(2026, 10, 15, 8, 50, 0).getTime() // Sunday 15 Nov 2026 08:50 local

describe('timers', () => {
  const cd: TimerState = { id: 'a', name: 'Sermon', kind: 'countdown', duration: 300, running: true, startedAt: T0, accumulated: 0 }
  it('counts down, overruns, pauses', () => {
    expect(timerValue(cd, T0 + 1000)).toBe(299)
    expect(timerValue(cd, T0 + 310_000)).toBe(-10)
    expect(timerValue({ ...cd, running: false, accumulated: 100 }, T0 + 999_999)).toBe(200)
  })
  it('counts up and to a time of day', () => {
    expect(timerValue({ ...cd, kind: 'elapsed', accumulated: 5 }, T0 + 10_000)).toBe(15)
    expect(timerValue({ ...cd, kind: 'countdownTo', target: '08:55' }, T0)).toBe(300)
  })
  it('formats', () => {
    expect(formatTimer(299.2)).toBe('5:00')
    expect(formatTimer(3725)).toBe('1:02:05')
    expect(formatTimer(-15)).toBe('-0:15')
    expect(formatHms(61)).toBe('00:01:01')
    expect(formatHms(-2)).toBe('-00:00:02')
  })
  it('parses what volunteers type', () => {
    expect(parseDuration('5')).toBe(300)
    expect(parseDuration('5:30')).toBe(330)
    expect(parseDuration('1:00:00')).toBe(3600)
    expect(parseDuration('90s')).toBe(90)
    expect(parseDuration('abc')).toBeNull()
  })
  it('colours', () => {
    expect(timerLevel({ kind: 'countdown', warnAt: 60 }, cd, T0)).toBe('ok')
    expect(timerLevel({ kind: 'countdown', warnAt: 60 }, cd, T0 + 250_000)).toBe('warn')
    expect(timerLevel({ kind: 'countdown', warnAt: 60 }, cd, T0 + 301_000)).toBe('danger')
    expect(timerLevel(undefined, { ...cd, running: false }, T0)).toBe('idle')
  })
  it('finds by id, name or index', () => {
    const l = [cd, { ...cd, id: 'b', name: 'Walk in' }]
    expect(findByIdOrName(l, 'b')?.id).toBe('b')
    expect(findByIdOrName(l, 'walk IN')?.id).toBe('b')
    expect(findByIdOrName(l, '1')?.id).toBe('b')
  })
})

describe('message tokens', () => {
  const text = 'Parent of child {number}, please come to {room} — starts in {timer:Service starts} at {clock}'
  it('lists fill-in fields but not live tokens', () => {
    expect(messageFields(text)).toEqual(['number', 'room'])
  })
  it('fills values and leaves live tokens', () => {
    expect(fillMessage(text, { Number: 42, room: 'the nursery' })).toBe('Parent of child 42, please come to the nursery — starts in {timer:Service starts} at {clock}')
  })
})

describe('macro runner', () => {
  const macros: Macro[] = [
    { id: 'pre', name: 'Pre-service', actions: [{ id: '1', type: 'a' }, { id: '2', type: 'macro.run', params: { id: 'Lights' } }, { id: '3', type: 'b', delay: 2 }] },
    { id: 'lights', name: 'Lights', actions: [{ id: '4', type: 'c' }] },
    { id: 'loop', name: 'Loop', actions: [{ id: '5', type: 'macro.run', params: { id: 'loop' } }, { id: '6', type: 'd' }] }
  ]
  it('runs in order, waits for delays, runs nested macros', async () => {
    const ran: string[] = []
    const slept: number[] = []
    const n = await runActionList(macros[0].actions, { run: (a: SlideAction) => void ran.push(a.type), sleep: async (ms) => void slept.push(ms), macros: () => macros })
    expect(ran).toEqual(['a', 'c', 'b'])
    expect(slept).toEqual([2000])
    expect(n).toBe(3)
  })
  it('refuses to loop and keeps going after a failure', async () => {
    const ran: string[] = []
    const errors: string[] = []
    await runActionList(macros[2].actions, { run: (a) => void ran.push(a.type), sleep: async () => {}, macros: () => macros, onError: (_a, e) => void errors.push(String(e)) }, ['loop'])
    expect(ran).toEqual(['d'])
    expect(errors[0]).toMatch(/can't run itself/)
  })
  it('macro by 1-based index', async () => {
    const ran: string[] = []
    await runActionList([{ id: 'x', type: 'macro.run', params: { index: 2 } }], { run: (a) => void ran.push(a.type), sleep: async () => {}, macros: () => macros })
    expect(ran).toEqual(['c'])
  })
})

describe('triggers', () => {
  const t = (when: Trigger['when']): Trigger => ({ id: Math.random().toString(), name: 'x', enabled: true, when, action: { type: 'macro.run' } })
  it('schedule fires once per minute on the right day', () => {
    const sunday = t({ type: 'schedule', days: [0], time: '8:55' })
    const monday = t({ type: 'schedule', days: [1], time: '08:55' })
    const fired = new Map<string, string>()
    const at = T0 + 5 * 60_000 + 10_000
    expect(dueSchedules([sunday, monday], at, fired)).toEqual([sunday])
    fired.set(sunday.id, '2026-11-15T08:55')
    expect(dueSchedules([sunday], at + 20_000, fired)).toEqual([])
  })
  it('slide / group label match with wildcards', () => {
    const chorus = t({ type: 'label', match: 'Chorus*', scope: 'group' })
    expect(labelTriggers([chorus], 'Line 1', 'Chorus 2')).toEqual([chorus])
    expect(labelTriggers([chorus], 'Chorus', 'Verse 1')).toEqual([])
  })
  it('names keys the same on every platform', () => {
    expect(keyName({ key: 'b' })).toBe('B')
    expect(keyName({ key: ' ' })).toBe('Space')
    expect(keyName({ key: 'F9', shiftKey: true })).toBe('Shift+F9')
    expect(keyName({ key: 'm', metaKey: true })).toBe('Ctrl+M')
  })
})

describe('audio bin', () => {
  it('next track', () => {
    const pl = { tracks: [{ kind: 'audio' as const, src: 'a' }, { kind: 'audio' as const, src: 'b' }], mode: 'next' as const }
    expect(nextTrackIndex(pl, 0)).toBe(1)
    expect(nextTrackIndex(pl, 1)).toBeNull()
    expect(nextTrackIndex({ ...pl, mode: 'loop' }, 1)).toBe(0)
    expect(nextTrackIndex({ ...pl, mode: 'stop' }, 0)).toBeNull()
  })
  it('fades', () => {
    expect(fadeVolume(0, 1, 1, 2)).toBe(0.5)
    expect(fadeVolume(1, 0, 5, 2)).toBe(0)
  })
})
