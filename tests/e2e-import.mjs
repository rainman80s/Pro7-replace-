// E2E: run the import wizard against a synthetic ProPresenter folder, open an imported song in the Show screen,
// send a slide live, and screenshot it. Run: npm run build && REACH_PORT=4806 xvfb-run -a node tests/e2e-import.mjs
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright')

const dir = mkdtempSync(join(tmpdir(), 'reach-e2e-import-'))
const pp = join(dir, 'ProPresenter')
execFileSync('npx', ['tsx', 'scripts/make-pp7-fixtures.ts', pp], { stdio: 'inherit' })
const shots = process.env.SHOT_DIR ?? join(dir, 'shots')
mkdirSync(shots, { recursive: true })

const app = await electron.launch({
  executablePath: require('electron'), args: ['.', '--no-sandbox'],
  env: { ...process.env, REACH_USER_DATA: join(dir, 'user'), REACH_WORKSPACE: join(dir, 'ws'), REACH_PORT: process.env.REACH_PORT ?? '4806', REACH_NO_SEED: '1', NODE_OPTIONS: '' }
})
const logs = []
app.process().stdout.on('data', (d) => logs.push(String(d)))
app.process().stderr.on('data', (d) => logs.push(String(d)))
try {
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.waitForSelector('[data-testid="import-open"]', { timeout: 20000 })
  await win.click('[data-testid="import-open"]')
  await win.fill('[data-testid="import-root"]', pp)
  await win.click('[data-testid="import-scan"]')
  await win.waitForSelector('[data-testid="import-review"]', { timeout: 20000 })
  const review = await win.textContent('[data-testid="import-review"]')
  if (!/presentations/.test(review)) throw new Error('review did not show counts')
  await win.screenshot({ path: join(shots, 'import-review.png') })
  await win.click('[data-testid="import-start"]')
  await win.waitForSelector('[data-testid="import-report"]', { timeout: 60000 })
  await win.screenshot({ path: join(shots, 'import-report.png') })
  const lib = await win.evaluate(() => window.reachBridge.invoke('library.list'))
  const titles = lib.map((s) => s.title)
  for (const t of ['Synthetic Song', 'Oceans (Where Feet May Fail) [TRANS]-1', 'Feature Test']) if (!titles.includes(t)) throw new Error(`missing ${t}: ${titles.join(', ')}`)
  const pls = await win.evaluate(() => window.reachBridge.invoke('playlists.list'))
  if (!pls.some((p) => p.name === 'Sunday 2026-11-15')) throw new Error('playlist not imported')
  await win.keyboard.press('Escape')
  // Show screen: open the translated song and send its 2nd slide live
  await win.click('.pl-item:has-text("Oceans")')
  await win.waitForSelector('.slide')
  await win.locator('.slide').nth(1).click()
  await win.waitForSelector('.slide.live')
  const live = await win.evaluate(() => window.reachBridge.invoke('live.get'))
  if (!live.slide || !JSON.stringify(live.slide.slide).includes('You call me out upon the waters')) throw new Error('imported slide not live')
  await win.waitForTimeout(500)
  await win.screenshot({ path: join(shots, 'imported-live.png') })
  // a styled slide from the Windows feature test
  await win.click('.pl-item:has-text("Feature Test")')
  await win.waitForTimeout(600)
  await win.screenshot({ path: join(shots, 'imported-feature-test.png') })
  if (errors.length) throw new Error('renderer errors:\n' + errors.join('\n'))
  console.log('E2E IMPORT OK —', titles.length, 'presentations; screenshots in', shots)
} catch (e) {
  console.error(logs.join('').slice(-4000))
  throw e
} finally {
  await app.close()
}
