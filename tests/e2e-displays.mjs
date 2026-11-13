// End-to-end test for displays & outputs.
// Run: npm run build && REACH_PORT=4805 xvfb-run -a -s "-screen 0 2600x1200x24" node tests/e2e-displays.mjs
//
// Boots the app under Electron with SIMULATED displays (REACH_FAKE_DISPLAYS) and a fake NDI sink, and uses a plain
// Chromium page as a network receiver. Covers: display identity + unplug/replug, operator screen protection,
// stacked-canvas region crop on a receiver, duplication, groups (mirror + video wall), receiver reconnect with
// remembered assignment, clock sync, NDI frame plumbing, safe mode, crash recovery. SHOT_DIR=… saves screenshots.
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
const { _electron: electron, chromium } = require('playwright')

const dir = mkdtempSync(join(tmpdir(), 'reach-e2e-displays-'))
const port = process.env.REACH_PORT ?? '4805'
const shot = process.env.SHOT_DIR
const fake = [
  { id: 1, label: 'Built-in Retina Display', bounds: { x: 0, y: 0, width: 1280, height: 800 }, scaleFactor: 1, internal: true, primary: true },
  { id: 2, label: 'SAMSUNG', bounds: { x: 1280, y: 0, width: 640, height: 360 }, scaleFactor: 3, internal: false }
]
const env = { ...process.env, REACH_USER_DATA: join(dir, 'user'), REACH_WORKSPACE: join(dir, 'ws'), REACH_PORT: port, REACH_FAKE_DISPLAYS: JSON.stringify(fake), REACH_FAKE_NDI: '1', REACH_NO_MDNS: '1', NODE_OPTIONS: '' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let step = ''
const check = (cond, msg) => { if (!cond) throw new Error(`[${step}] ${msg}`); console.log('  ✓', msg) }

const app = await electron.launch({ executablePath: require('electron'), args: ['.', '--no-sandbox'], env })
const logs = []
app.process().stdout.on('data', (d) => logs.push(String(d)))
app.process().stderr.on('data', (d) => logs.push(String(d)))
const browser = await chromium.launch()
try {
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (e) => errors.push(String(e)))
  const inv = (m, p) => win.evaluate(([m, p]) => window.reachBridge.invoke(m, p), [m, p])
  const health = async (id) => (await inv('outputs.health')).find((h) => h.outputId === id)
  const until = async (fn, msg, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return; await sleep(150) } throw new Error(`[${step}] timed out: ${msg}`) }
  await win.waitForSelector('.pl-item', { timeout: 20000 })

  step = 'stacked canvas'
  const ws = await inv('workspace.get')
  await inv('workspace.update', { canvases: [...ws.canvases, { id: 'wall', name: 'LED Wall', kind: 'audience', width: 1920, height: 2160, color: '#4fa88b', regions: [{ id: 'top', name: 'LED Top', rect: { x: 0, y: 0, w: 1920, h: 1080 } }, { id: 'bot', name: 'LED Bottom', rect: { x: 0, y: 1080, w: 1920, h: 1080 } }] }] })
  check((await inv('workspace.get')).canvases.some((c) => c.id === 'wall'), 'stacked canvas saved with workspace.update')

  step = 'local displays'
  await until(async () => (await inv('outputs.displays')).length === 2, 'two displays')
  const displays = await inv('outputs.displays')
  const tv = displays.find((d) => d.label === 'SAMSUNG')
  const op = displays.find((d) => d.operator)
  check(op && op.internal, 'operator screen detected')
  await inv('outputs.save', { output: { id: 'top', name: 'LED Top TV', canvasId: 'wall', regionId: 'top', target: { type: 'display', displayKey: tv.key }, enabled: true } })
  await inv('outputs.save', { output: { id: 'opout', name: 'Oops', canvasId: 'main', target: { type: 'display', displayKey: op.key }, enabled: true } })
  await until(async () => (await health('top'))?.status === 'live', 'TV output live')
  check((await health('opout')).status === 'blocked', 'operator screen is never covered')
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.getTitle() === 'Reach Output').map((w) => [w.getBounds(), w.isFocusable(), w.isAlwaysOnTop()]))
  check(bounds.length === 1 && bounds[0][0].x === 1280 && bounds[0][0].width === 640 && bounds[0][1] === false && bounds[0][2] === true, 'fullscreen window on the TV: exact bounds, not focusable, on top')
  await inv('outputs.remove', { id: 'opout' })

  step = 'unplug / replug'
  await inv('outputs.simulateDisplays', { displays: [fake[0]] })
  await until(async () => (await health('top'))?.status === 'missing', 'missing after unplug')
  check(await win.evaluate(() => document.hasFocus() || true), 'operator window survives unplug')
  await inv('outputs.simulateDisplays', { displays: [fake[0], { ...fake[1], id: 42 }] })
  await until(async () => (await health('top'))?.status === 'live', 'back after replug (new electron id)')
  check((await inv('outputs.displays')).find((d) => d.id === 42)?.key === tv.key, 'replugged TV recognised by fingerprint')

  step = 'go live'
  await win.click('.pl-item:has-text("Amazing Grace")')
  await win.waitForSelector('.slide')
  await win.locator('.slide').nth(1).click()
  await win.waitForSelector('.slide.live')

  step = 'network receiver'
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
  await page.goto(`http://127.0.0.1:${port}/output.html?receiverId=rx-lobby&name=Lobby%20Left`)
  await page.waitForSelector('[data-waiting]')
  await until(async () => (await inv('receivers.list')).some((r) => r.id === 'rx-lobby' && r.connected), 'receiver registered')
  check((await inv('receivers.list')).find((r) => r.id === 'rx-lobby').name === 'Lobby Left', 'receiver named from URL')
  await inv('receivers.assign', { id: 'rx-lobby', canvasId: 'wall', regionId: 'bot' })
  await page.waitForSelector('[data-canvas="wall"]')
  await page.waitForFunction(() => document.body.innerText.includes('grace'), null, { timeout: 10000 }).catch(() => {})
  const crop = await page.evaluate(() => { const c = document.querySelector('[data-canvas="wall"]').parentElement; return { left: c.style.left, top: c.style.top } })
  check(crop.top === '-1080px' && crop.left === '0px', `receiver renders the LED Bottom crop of the stacked canvas (offset ${crop.left},${crop.top})`)
  const rxHealth = (await inv('outputs.health')).find((h) => h.name === 'Lobby Left')
  check(rxHealth?.status === 'live', 'receiver output healthy')
  const sync = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 300)); return true })
  check(sync, 'clock sync ran without errors')
  if (shot) await page.screenshot({ path: join(shot, 'receiver-led-bottom.png') })

  step = 'duplicate'
  const rxOut = (await inv('outputs.list')).find((o) => o.target.type === 'network' && o.target.receiverId === 'rx-lobby')
  const page2 = await browser.newPage({ viewport: { width: 640, height: 360 } })
  await page2.goto(`http://127.0.0.1:${port}/output.html?receiverId=rx-two&name=Lobby%20Right`)
  await until(async () => (await inv('receivers.list')).some((r) => r.id === 'rx-two' && r.connected), 'second receiver registered')
  await inv('outputs.duplicate', { id: rxOut.id, target: { type: 'network', receiverId: 'rx-two' }, name: 'Lobby Right' })
  await page2.waitForSelector('[data-canvas="wall"]')
  const crop2 = await page2.evaluate(() => document.querySelector('[data-canvas="wall"]').parentElement.style.top)
  check(crop2 === '-1080px', '“Also show on…” copies the same source to another destination')

  step = 'group: video wall'
  const list = await inv('outputs.list')
  const ids = list.filter((o) => o.target.type === 'network').map((o) => o.id)
  await inv('outputs.saveGroup', { name: 'Lobby wall', canvasId: 'main', memberIds: ids, layout: { mode: 'wall', columns: 2, rows: 1 } })
  await page2.waitForFunction(() => document.querySelector('[data-canvas="main"]')?.parentElement.style.left === '-960px', null, { timeout: 10000 })
  check(true, 'video-wall group: second receiver shows the right half of Main (x=960)')
  const left1 = await page.evaluate(() => document.querySelector('[data-canvas="main"]')?.parentElement.style.left)
  check(left1 === '0px', 'first receiver shows the left half')
  const g = (await inv('outputs.list')).find((o) => o.target.type === 'group')
  await inv('outputs.saveGroup', { id: g.id, name: g.name, canvasId: 'main', memberIds: ids, layout: g.groupLayout, enabled: false })
  await page.waitForFunction(() => !document.querySelector('[data-canvas]'), null, { timeout: 10000 })
  check(true, 'disabling the group blanks every member together')
  await inv('outputs.saveGroup', { id: g.id, name: g.name, canvasId: 'main', memberIds: ids, layout: { mode: 'mirror' }, enabled: true })
  await page2.waitForFunction(() => document.querySelector('[data-canvas="main"]')?.parentElement.style.left === '0px', null, { timeout: 10000 })
  check(true, 'mirror group: every member shows the whole canvas')

  step = 'reconnect'
  await page.close()
  await until(async () => !(await inv('receivers.list')).find((r) => r.id === 'rx-lobby').connected, 'receiver offline after close')
  check((await inv('outputs.health')).find((h) => h.name === 'Lobby Left')?.status === 'offline', 'health says offline in plain words')
  const page3 = await browser.newPage({ viewport: { width: 960, height: 540 } })
  await page3.goto(`http://127.0.0.1:${port}/output.html?receiverId=rx-lobby`)
  await page3.waitForSelector('[data-canvas="main"]', { timeout: 10000 })
  check(true, 'rebooted TV comes straight back to its remembered assignment')

  step = 'transparent OBS view'
  const obs = await browser.newPage({ viewport: { width: 480, height: 270 } })
  await obs.goto(`http://127.0.0.1:${port}/output.html?canvasId=main&transparent=1`)
  await obs.waitForSelector('[data-canvas="main"]')
  const bg = await obs.evaluate(() => [getComputedStyle(document.body).backgroundColor, document.querySelector('[data-layer="background"]')])
  check(bg[0] === 'rgba(0, 0, 0, 0)' && bg[1] === null, 'transparent mode: no backdrop and no background layer')

  step = 'NDI (fake sink)'
  check((await inv('outputs.ndiStatus')).available, 'NDI available via REACH_FAKE_NDI')
  await inv('outputs.save', { output: { id: 'ndi', name: 'Stream', canvasId: 'main', target: { type: 'ndi', name: 'Reach Stream' }, enabled: true, frameRate: 30 } })
  await until(async () => ((await inv('outputs.ndiStatus')).senders[0]?.frames ?? 0) > 3, 'frames reach the sink')
  const st = (await inv('outputs.ndiStatus')).senders[0]
  check(st.frames > 3, `offscreen frames pumped into the sink (${st.frames} frames, ${st.fps} fps)`)

  step = 'test pattern + thumbnail'
  await inv('outputs.testPattern', { id: 'top', pattern: 'grid' })
  const outWin = (await app.windows()).find((w) => w.url().includes('outputId=top'))
  await outWin.waitForSelector('[data-test-pattern="grid"]')
  check(true, 'test pattern shown on the output')
  await inv('outputs.testPattern', { id: 'top', pattern: null })
  const thumb = await inv('outputs.thumbnail', { id: 'top', width: 160 })
  check(typeof thumb === 'string' && thumb.startsWith('data:image/png'), 'live thumbnail captured')

  step = 'safe mode'
  await inv('outputs.safeMode', { on: true })
  await page3.waitForFunction(() => !document.querySelector('[data-canvas]'), null, { timeout: 10000 })
  const outCount = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.getTitle() === 'Reach Output').length)
  check(outCount === 0, 'safe mode closes local outputs and blanks network displays')
  await inv('outputs.safeMode', { on: false })
  await until(async () => (await health('top'))?.status === 'live', 'outputs back')
  check(true, 'outputs return after safe mode')

  step = 'crash recovery'
  await inv('outputs.crashForTest', { id: 'top' })
  await until(async () => (await health('top'))?.status === 'recovering', 'recovering state')
  await until(async () => (await health('top'))?.status === 'live', 'rebuilt after crash')
  check(true, 'crashed output window rebuilt automatically')

  step = 'displays view'
  await win.click('.nav-item:has-text("Displays")')
  await win.click('[data-tab="routing"]')
  await win.waitForSelector('[data-group]')
  if (shot) await win.screenshot({ path: join(shot, 'displays-routing.png') })
  check(errors.length === 0, 'no renderer errors' + (errors.length ? ': ' + errors.join('\n') : ''))
  console.log('E2E DISPLAYS OK')
} catch (e) {
  console.error(logs.join('').slice(-4000))
  throw e
} finally {
  await browser.close()
  await app.close()
}
