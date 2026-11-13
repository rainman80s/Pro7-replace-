// End-to-end test of the show-control area: timers, messages, macros, ProPresenter-compatible REST, phone remote.
// Run: REACH_PORT=4805 xvfb-run -a node tests/e2e-control.mjs   (after `npm run build`; SHOT_DIR=dir saves screenshots)
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { _electron: electron, chromium } = require('playwright')
import { mkdtempSync } from 'node:fs'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'reach-ctl-'))
const shot = process.env.SHOT_DIR
const port = process.env.REACH_PORT ?? '4805'
const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', '--no-sandbox'],
  env: { ...process.env, REACH_USER_DATA: join(dir, 'user'), REACH_WORKSPACE: join(dir, 'ws'), REACH_PORT: port, NODE_OPTIONS: '' }
})
const logs = []
app.process().stdout.on('data', (d) => logs.push(String(d)))
app.process().stderr.on('data', (d) => logs.push(String(d)))
const check = (c, m) => { if (!c) throw new Error('FAILED: ' + m) }
let browser
try {
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (e) => errors.push(String(e)))
  const rpc = (m, p) => win.evaluate(([m, p]) => window.reachBridge.invoke(m, p), [m, p])
  await win.waitForSelector('.pl-item', { timeout: 20000 })
  await win.click('.pl-item:has-text("Amazing Grace")')
  await win.waitForSelector('.slide')
  await win.locator('.slide').first().click()
  await win.waitForSelector('.slide.live')

  // Timer: create, start, appears running in live.get and in the panel.
  const timer = await rpc('timers.save', { timer: { name: 'Sermon', kind: 'countdown', duration: 1800, warnAt: 300 } })
  await rpc('timers.control', { id: timer.id, action: 'start' })
  let live = await rpc('live.get')
  const t = live.timers.find((x) => x.id === timer.id)
  check(t && t.running, 'timer should be running in live.get')
  await win.waitForSelector(`[data-testid="timer-${timer.id}"]`)
  // Message
  const msg = await rpc('messages.save', { message: { name: 'Welcome', text: 'Welcome, {name}!' } })
  await rpc('messages.show', { id: msg.id, values: { name: 'Sam' } })
  live = await rpc('live.get')
  check(live.messages.length === 1, 'message should be showing')
  await win.waitForSelector('.ctl-msg')
  await rpc('messages.hide', { id: msg.id })
  check((await rpc('live.get')).messages.length === 0, 'message should hide')
  // Macro: clear everything then start a second timer
  const t2 = await rpc('timers.save', { timer: { name: 'Break', kind: 'elapsed' } })
  const macro = await rpc('macros.save', { macro: { name: 'Go', color: '#3886ce', actions: [{ id: 'a1', type: 'timer.start', params: { id: t2.id } }, { id: 'a2', type: 'stage.message', params: { text: 'Macro ran' } }] } })
  await win.waitForSelector('.ctl-macro:has-text("Go")')
  await win.click('.ctl-macro:has-text("Go")')
  await win.waitForFunction(async () => (await window.reachBridge.invoke('live.get')).stageMessage === 'Macro ran', null, { timeout: 8000 })
  check((await rpc('live.get')).timers.find((x) => x.id === t2.id)?.running, 'macro should start the timer')

  // ProPresenter-compatible REST: advance a slide.
  const before = (await rpc('live.get')).slide.index
  let r = await fetch(`http://127.0.0.1:${port}/v1/trigger/next`)
  check(r.ok, 'compat next should succeed: ' + r.status)
  check((await rpc('live.get')).slide.index === before + 1, 'REST next advanced the slide')
  r = await fetch(`http://127.0.0.1:${port}/v1/status/slide`)
  check((await r.json()).current.text.length > 0, 'status/slide returns text')

  if (shot) {
    await win.evaluate(() => document.querySelector('.show-panels, .show')?.scrollTo?.(0, 0))
    await win.setViewportSize({ width: 1500, height: 1000 }).catch(() => {})
    await win.screenshot({ path: join(shot, 'control-panels.png') })
  }

  // Phone remote in a plain browser, over the LAN address so the PIN is required.
  const info = await rpc('system.info')
  const settings = await rpc('remote.settings')
  const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address
  const host = lan ?? '127.0.0.1'
  browser = await chromium.launch({ args: ['--no-sandbox', '--proxy-server=direct://', '--proxy-bypass-list=*'] })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const perrs = []
  page.on('pageerror', (e) => perrs.push(String(e))); page.on('console', (m) => console.log('[remote]', m.text()))
  await page.goto(`http://${host}:${info.serverPort}/remote`)
  if (lan) {
    await page.waitForSelector('input[name=pin]', { timeout: 10000 }).catch(async (e) => { await page.screenshot({ path: '/tmp/claude-0/shots/dbg.png' }); console.error(await page.textContent('body')); throw e })
    await page.fill('input[name=pin]', '000000')
    await page.click('button[type=submit]')
    await page.waitForURL(/token=000000/)
    await page.waitForSelector('.rm-err', { timeout: 10000 })
    await page.fill('input[name=pin]', settings.pin)
    await page.click('button[type=submit]')
  }
  await page.waitForSelector('[data-testid=rm-next-btn]', { timeout: 15000 }).catch(async (e) => { await page.screenshot({ path: '/tmp/claude-0/shots/dbg.png' }); console.error(page.url(), (await page.textContent('body')).slice(0, 300)); throw e })
  const cur = (await rpc('live.get')).slide.index
  await page.click('[data-testid=rm-next-btn]')
  await page.waitForFunction(() => true)
  await win.waitForFunction(async (c) => (await window.reachBridge.invoke('live.get')).slide?.index === c + 1, cur, { timeout: 8000 })
  check((await page.textContent('[data-testid=rm-current]')).trim().length > 0, 'remote shows current slide text')
  if (shot) await page.screenshot({ path: join(shot, 'remote.png') })
  if (perrs.length) throw new Error('remote errors: ' + perrs.join('\n'))
  if (errors.length) throw new Error('renderer errors:\n' + errors.join('\n'))
  console.log('CONTROL E2E OK — remote via', host, lan ? '(PIN gate exercised)' : '(loopback, PIN gate skipped)')
} catch (e) {
  console.error(logs.join('').slice(-3000))
  throw e
} finally {
  await browser?.close()
  await app.close()
}
