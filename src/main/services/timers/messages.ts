/**
 * Messages (nursery call, car park…) and the stage message. Templates live in workspace doc `messages`;
 * what is showing lives in LiveState.messages / LiveState.stageMessage.
 */
import { defaultMessages, fillMessage, uid, type MessageTemplate, type MessagesDoc } from '@shared/control'
import type { ID, LiveMessage, LiveState } from '@shared/model'
import { api } from '../../core/api'
import { live } from '../../core/live'
import { DocStore, P, defineAction, pick } from '../macros/lib'

export const messagesDoc = new DocStore<MessagesDoc>('messages', defaultMessages, (d) => ({ ...d, stagePresets: d.stagePresets ?? [], messages: d.messages ?? [] }))

const hideTimers = new Map<ID, NodeJS.Timeout>()
let flashTimer: NodeJS.Timeout | null = null

export function showMessage(req: { id?: ID; text?: string; values?: Record<string, unknown>; seconds?: number; position?: MessageTemplate['position'] }): LiveState {
  const tpl = req.id ? pick(messagesDoc.current.messages, { id: req.id }) : undefined
  if (req.id && !tpl && req.text === undefined) throw new Error(`Message not found: ${req.id}`)
  const text = fillMessage(req.text ?? tpl?.text ?? '', req.values)
  if (!text) throw new Error('The message is empty')
  const msg: LiveMessage = { id: tpl?.id ?? req.id ?? uid('msg'), text, position: req.position ?? tpl?.position ?? 'bottom', style: tpl?.style }
  const st = live.mutate((s) => {
    s.messages = [...s.messages.filter((m) => m.id !== msg.id), msg]
    delete s.cleared.message
  })
  clearTimeout(hideTimers.get(msg.id))
  hideTimers.delete(msg.id)
  const secs = req.seconds ?? tpl?.autoHide
  if (secs && secs > 0) hideTimers.set(msg.id, setTimeout(() => { hideTimers.delete(msg.id); hideMessage(msg.id) }, secs * 1000))
  return st
}

export function hideMessage(id?: ID): LiveState {
  if (id) { clearTimeout(hideTimers.get(id)); hideTimers.delete(id) } else { hideTimers.forEach(clearTimeout); hideTimers.clear() }
  return live.mutate((s) => { s.messages = id ? s.messages.filter((m) => m.id !== id) : [] })
}

/** Set the stage (confidence monitor) message; `flash` blinks it a few times so the speaker notices. */
export function stageMessage(text: string, flash = false): LiveState {
  if (flashTimer) clearInterval(flashTimer)
  flashTimer = null
  const st = live.mutate((s) => { s.stageMessage = text })
  if (flash && text) {
    let n = 0
    flashTimer = setInterval(() => {
      n++
      live.mutate((s) => { s.stageMessage = n % 2 ? '' : text })
      if (n >= 6) { clearInterval(flashTimer!); flashTimer = null; live.mutate((s) => { s.stageMessage = text }) }
    }, 450)
  }
  return st
}

export async function setupMessages(): Promise<void> {
  await messagesDoc.get()
  api.handle('messages.list', () => messagesDoc.get(), 'control')
  api.handle('messages.save', async ({ message }) => {
    const m: MessageTemplate = { position: 'bottom', ...message, id: message.id || uid('msg') }
    await messagesDoc.update((d) => {
      const i = d.messages.findIndex((x) => x.id === m.id)
      if (i >= 0) d.messages[i] = m
      else d.messages.push(m)
    })
    return m
  })
  api.handle('messages.remove', async ({ id }) => { await messagesDoc.update((d) => { d.messages = d.messages.filter((m) => m.id !== id) }) })
  api.handle('messages.show', (req) => showMessage(req))
  api.handle('messages.hide', ({ id } = {}) => hideMessage(id))
  api.handle('messages.stage', ({ text, flash }) => stageMessage(text, flash))
  api.handle('messages.stagePresets', ({ presets }) => messagesDoc.update((d) => { d.stagePresets = presets }))

  const msgParam = { key: 'id', label: 'Message', kind: 'message' as const }
  defineAction({
    type: 'message.show', label: 'Show message', category: 'Messages',
    params: [msgParam, { key: 'values', label: 'Fill-in values', kind: 'json', optional: true, hint: '{"number": "42"}' }, P.num('seconds', 'Hide after (seconds)', { optional: true })]
  }, (p) => {
    const m = pick(messagesDoc.current.messages, p)
    if (!m) throw new Error('Message not found')
    showMessage({ id: m.id, values: (p.values ?? {}) as Record<string, unknown>, seconds: p.seconds === undefined || p.seconds === '' ? undefined : Number(p.seconds) })
  })
  defineAction({ type: 'message.hide', label: 'Hide message', category: 'Messages', params: [{ ...msgParam, optional: true, hint: 'Empty = hide all' }] }, (p) => {
    const m = p.id || p.index ? pick(messagesDoc.current.messages, p) : undefined
    hideMessage(m?.id ?? (p.id ? String(p.id) : undefined))
  })
  defineAction({
    type: 'stage.flash', label: 'Stage message (with flash)', category: 'Stage',
    params: [P.text('text', 'Message'), P.bool('flash', 'Flash it', { default: true })]
  }, (p) => void stageMessage(String(p.text ?? ''), p.flash !== false))
}
