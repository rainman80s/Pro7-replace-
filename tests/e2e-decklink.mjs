// End-to-end test for DeckLink SDI outputs with a FAKE native module (REACH_FAKE_DECKLINK=1): no card needed.
// Run: npm run build && REACH_PORT=4891 xvfb-run -a -s "-screen 0 2200x1300x24" node tests/e2e-decklink.mjs   (SHOT_DIR=… saves screenshots)
// Covers: ports listed as destinations, the church routing (stacked LED wall top/bottom, keyed Key, stage at 60p),
// offscreen capture feeding the card, keyed output rendering transparent, the Displays UI (port cards, settings).
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright')

const dir = mkdtempSync(join(tmpdir(), 'reach-e2e-decklink-'))
const shot = process.env.SHOT_DIR
const env = { ...process.env, REACH_USER_DATA: join(dir, 'user'), REACH_WORKSPACE: join(dir, 'ws'), REACH_PORT: process.env.REACH_PORT ?? '4891', REACH_FAKE_DECKLINK: '1', REACH_NO_MDNS: '1', NODE_OPTIONS: '' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let step = ''
const check = (cond, msg) => { if (!cond) throw new Error(`[${step}] ${msg}`); console.log('  ✓', msg) }

const app = await electron.launch({ executablePath: require('electron'), args: ['.', '--no-sandbox'], env })
const logs = []
app.process().stdout.on('data', (d) => logs.push(String(d)))
app.process().stderr.on('data', (d) => logs.push(String(d)))
try {
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (e) => errors.push(String(e)))
  const inv = (m, p) => win.evaluate(([m, p]) => window.reachBridge.invoke(m, p), [m, p])
  const until = async (fn, msg, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return; await sleep(200) } throw new Error(`[${step}] timed out: ${msg}`) }
  await win.waitForSelector('[data-testid="service-item"]', { timeout: 20000 })

  step = 'ports'
  const ports = await inv('decklink.devices', { refresh: true })
  check(ports.length === 5 && ports[1].key === 'DeckLink Duo 2 · port 2', 'five SDI ports listed with stable names')
  check((await inv('decklink.status')).available, 'status: ready')

  step = 'church routing'
  const ws = await inv('workspace.get')
  await inv('workspace.update', { canvases: [...ws.canvases,
    { id: 'led', name: 'LED Wall (stacked)', kind: 'audience', width: 1920, height: 1200, color: '#4fa88b', regions: [{ id: 'top', name: 'Top', rect: { x: 0, y: 0, w: 1920, h: 880 } }, { id: 'bot', name: 'Bottom', rect: { x: 0, y: 880, w: 1920, h: 320 } }] },
    { id: 'key', name: 'Key', kind: 'audience', width: 1920, height: 1080, regions: [] }] })
  const dl = (device, mode, keying = 'none') => ({ type: 'decklink', device, mode, keying })
  await inv('outputs.save', { output: { id: 'wall', name: 'LED WALL', canvasId: 'led', regionId: 'top', target: dl('DeckLink Duo 2 · port 1', 'Hp29'), enabled: true } })
  await inv('outputs.save', { output: { id: 'keyo', name: 'Key', canvasId: 'key', target: dl('DeckLink Duo 2 · port 2', 'Hp29', 'external'), enabled: true } })
  await inv('outputs.save', { output: { id: 'lyr', name: 'LED LYRICS', canvasId: 'led', regionId: 'bot', target: dl('DeckLink Duo 2 · port 3', 'Hp29'), enabled: true } })
  await inv('outputs.save', { output: { id: 'stage', name: 'Stage Display', canvasId: 'main', target: dl('DeckLink Mini Monitor 4K · port 1', 'Hp60'), enabled: true } })
  await until(async () => (await inv('outputs.health')).filter((h) => ['wall', 'keyo', 'lyr', 'stage'].includes(h.outputId)).every((h) => h.status === 'live'), 'all four SDI outputs live')
  check(true, 'all four SDI outputs live')
  await until(async () => (await inv('decklink.status')).outputs.every((o) => o.fresh > 0 && !o.problem), 'frames reach every port')
  const st = await inv('decklink.status')
  check(st.outputs.length === 4, `frames reach every port (${st.outputs.map((o) => `${o.name}: ${o.fresh}`).join(', ')})`)
  const caps = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.webContents.isOffscreen()).map((w) => [w.getContentSize(), w.webContents.getURL()]))
  check(caps.some(([s, u]) => s[0] === 1920 && s[1] === 880 && u.includes('outputId=wall')), 'LED WALL renders offscreen at its region size (1920×880)')
  check(caps.some(([s, u]) => s[1] === 320 && u.includes('outputId=lyr')), 'LED LYRICS renders at 1920×320')
  check(caps.some(([, u]) => u.includes('outputId=keyo') && u.includes('transparent=1')), 'the keyed output renders transparent (alpha → key)')

  step = 'ui'
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('reach:goto', { detail: 'displays' })))
  await win.locator('text=Displays').first().click().catch(() => {})
  await win.waitForSelector('[data-decklink-panel]', { timeout: 10000 })
  check(await win.locator('[data-decklink]').count() === 5, 'each SDI port is a destination card')
  await win.locator('[data-decklink="DeckLink Duo 2 · port 2"]').click()
  await win.waitForSelector('[data-decklink-settings]')
  check(await win.locator('[data-decklink-keying]').inputValue() === 'external', 'settings show fill + key')
  if (shot) await win.screenshot({ path: join(shot, 'decklink-displays.png') })
  await win.locator('[data-decklink-mode]').selectOption('Hp59')
  await until(async () => (await inv('outputs.list')).find((o) => o.id === 'keyo').target.mode === 'Hp59', 'mode change saved')
  check(true, 'changing the video format from the UI saves it')
  check(!errors.length, `no page errors ${errors.join(' | ')}`)
  console.log('\nDeckLink e2e passed')
} catch (e) {
  console.error(String(e), '\n--- app log ---\n', logs.join('').slice(-3000))
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
