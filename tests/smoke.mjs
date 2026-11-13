// End-to-end smoke test: boots the built app under Electron, drives the UI, checks an output renders.
// Run: xvfb-run -a node tests/smoke.mjs   (after `npm run build`)
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright')
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'reach-smoke-'))
const shot = process.env.SHOT_DIR
const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', '--no-sandbox'],
  env: { ...process.env, REACH_USER_DATA: join(dir, 'user'), REACH_WORKSPACE: join(dir, 'ws'), REACH_PORT: process.env.REACH_PORT ?? '4791', NODE_OPTIONS: '' }
})
const logs = []
app.process().stdout.on('data', (d) => logs.push(String(d)))
app.process().stderr.on('data', (d) => logs.push(String(d)))
try {
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await win.waitForSelector('[data-testid="service-item"]', { timeout: 20000 }).catch(async (e) => { console.error('ERRORS', errors, (await win.content()).slice(0, 1500)); throw e })
  await win.click('[data-testid="service-item"]:has-text("Amazing Grace")')
  await win.waitForSelector('[data-testid="slide"]')
  await win.locator('[data-testid="slide"]').nth(1).click()
  await win.waitForSelector('[data-testid="slide"].live')
  const live = await win.evaluate(() => window.reachBridge.invoke('live.get'))
  if (live.slide?.index !== 1) throw new Error('slide did not go live')
  await win.keyboard.press('ArrowRight')
  await win.waitForFunction(async () => (await window.reachBridge.invoke('live.get')).slide?.index === 2)
  // Open a floating output window and check it renders the live text.
  await win.evaluate(() => window.reachBridge.invoke('outputs.save', { output: { id: 'smoke', name: 'Smoke', canvasId: 'main', target: { type: 'window' }, enabled: true } }))
  const out = await app.waitForEvent('window')
  await out.waitForFunction(() => document.body.innerText.includes('grace that taught'), null, { timeout: 15000 })
  // Network receiver path: the same output page over HTTP + WebSocket.
  const info = await win.evaluate(() => window.reachBridge.invoke('system.info'))
  const res = await fetch(`http://127.0.0.1:${info.serverPort}/output.html`)
  if (!res.ok) throw new Error('server did not serve output.html')
  if (shot) { await win.screenshot({ path: join(shot, 'operator.png') }); await out.screenshot({ path: join(shot, 'output.png') }) }
  if (errors.length) throw new Error('renderer errors:\n' + errors.join('\n'))
  console.log('SMOKE OK — port', info.serverPort)
} catch (e) {
  console.error(logs.join(''))
  throw e
} finally {
  await app.close()
}
