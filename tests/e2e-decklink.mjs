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
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('reach:displays-tab', { detail: 'routing' }))) // advanced routing lives under "Network & advanced"
  await win.waitForSelector('[data-decklink-panel]', { timeout: 10000 })
  check(await win.locator('[data-decklink]').count() === 5, 'each SDI port is a destination card')
  await win.locator('[data-decklink="DeckLink Duo 2 · port 2"]').click()
  await win.waitForSelector('[data-decklink-settings]')
  check(await win.locator('[data-decklink-keying]').inputValue() === 'external', 'settings show fill + key')
  if (shot) await win.screenshot({ path: join(shot, 'decklink-displays.png') })
  await win.locator('[data-decklink-mode]').selectOption('Hp59')
  await until(async () => (await inv('outputs.list')).find((o) => o.id === 'keyo').target.mode === 'Hp59', 'mode change saved')
  check(true, 'changing the video format from the UI saves it')
  step = 'screen configuration'
  // The new screen-centric window: a 1920x880 screen routed to a DeckLink port in 1080p29.97 with Custom placement 0,0,1920,880.
  await inv('workspace.update', { canvases: [...(await inv('workspace.get')).canvases, { id: 'ledwall', name: 'LED WALL 880', kind: 'audience', width: 1920, height: 880, regions: [] }] })
  await win.locator('[data-page="screens"]').click()
  await win.waitForSelector('[data-screen="ledwall:"]')
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => !x.webContents.isOffscreen() && x.isVisible()); w?.setContentSize(1440, 900) })
  await win.locator('[data-screen="ledwall:"]').click()
  await win.waitForSelector('[data-screen-editor="ledwall:"]')
  await win.locator('[data-output-menu]').click()
  await win.waitForSelector('[data-output-menu-list]')
  await win.locator('[data-menu-item="decklink:DeckLink Duo 2 · port 4"]').click()
  await win.locator('[data-menu-item="decklink:DeckLink Duo 2 · port 4:Hp29"]').click()
  await until(async () => (await inv('outputs.list')).some((o) => o.canvasId === 'ledwall' && o.target.type === 'decklink'), 'output created from the menu')
  const led = (await inv('outputs.list')).find((o) => o.canvasId === 'ledwall')
  check(led.target.mode === 'Hp29' && JSON.stringify(led.placement) === JSON.stringify({ x: 0, y: 0, w: 1920, h: 880 }), 'new SDI output defaults to Custom 0,0,1920,880 in 1080p29.97')
  await win.waitForSelector('[data-placement]')
  check(await win.locator('[data-output-target]').inputValue() === 'custom', 'Output Target shows Custom')
  await inv('outputs.testPattern', { id: led.id, pattern: 'bars' })
  await until(async () => (await inv('outputs.health')).find((h) => h.outputId === led.id)?.status === 'live', 'LED WALL 880 live')
  const probe = async () => app.evaluate(() => {
    const h = globalThis.__reachFakeDeckLink.handles.filter((x) => x.opts.displayName === 'DeckLink Duo (4)').at(-1)
    if (!h?.lastFrame) return null
    const w = h.lastSize.width, ht = h.lastSize.height, f = h.lastFrame
    const px = (x, y) => [f[(y * w + x) * 4], f[(y * w + x) * 4 + 1], f[(y * w + x) * 4 + 2]]
    const sum = (y) => { let s = 0; for (let x = 0; x < w; x += 40) { const p = px(x, y); s += p[0] + p[1] + p[2] } return s }
    return { w, ht, top: sum(100) + sum(400) + sum(870), bottom: sum(890) + sum(1000) + sum(1079) }
  })
  await until(async () => (await probe())?.top > 0, 'composed frame reaches the card')
  const fr = await probe()
  check(fr.w === 1920 && fr.ht === 1080 && fr.top > 0 && fr.bottom === 0, `composed 1920x1080 frame: content in the top 880 rows, black below (top ${fr.top}, bottom ${fr.bottom})`)
  await win.locator('[data-output-target]').selectOption('fit')
  await until(async () => JSON.stringify((await inv('outputs.list')).find((o) => o.id === led.id).placement) === JSON.stringify({ x: 0, y: 100, w: 1920, h: 880 }), 'fit placement saved')
  check(true, 'Fit (scale) centres the picture in the SDI frame')
  await win.locator('[data-output-target]').selectOption('custom')
  await win.locator('[data-output-menu]').click()
  await win.waitForSelector('[data-output-menu-list]')
  if (shot) await win.screenshot({ path: join(shot, 'screen-config.png') })
  check(!errors.length, `no page errors ${errors.join(' | ')}`)
  console.log('\nDeckLink e2e passed')
} catch (e) {
  console.error(String(e), '\n--- app log ---\n', logs.join('').slice(-3000))
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
