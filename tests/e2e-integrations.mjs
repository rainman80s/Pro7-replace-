// E2E for integrations against local mock API servers (no real accounts).
// Run: npm run build && xvfb-run -a node tests/e2e-integrations.mjs   (SHOT_DIR=… to save screenshots)
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMocks } from './mock-apis.mjs'
const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright')

const shot = process.env.SHOT_DIR
if (shot) mkdirSync(shot, { recursive: true })
const mocks = await startMocks()
const dir = mkdtempSync(join(tmpdir(), 'reach-e2e-int-'))
const basePort = Number(process.env.REACH_PORT ?? 4806)
const step = (s) => console.log('·', s)
const launched = []

async function launch(name, port, extraEnv = {}) {
  const app = await electron.launch({
    executablePath: require('electron'), args: ['.', '--no-sandbox'],
    env: { ...process.env, ...mocks.env, REACH_USER_DATA: join(dir, name, 'user'), REACH_WORKSPACE: join(dir, name, 'ws'), REACH_PORT: String(port), NODE_OPTIONS: '', REACH_MACHINE_NAME: name, ...extraEnv }
  })
  const logs = []
  app.process().stdout.on('data', (d) => logs.push(String(d)))
  app.process().stderr.on('data', (d) => logs.push(String(d)))
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()) })
  await win.waitForSelector('.nav-item', { timeout: 20000 })
  const inv = (method, payload) => win.evaluate(([m, p]) => window.reachBridge.invoke(m, p), [method, payload])
  const ctx = { app, win, logs, errors, inv, name }
  launched.push(ctx)
  return ctx
}
const waitFor = async (fn, ms = 15000, what = 'condition') => {
  const t0 = Date.now()
  for (;;) {
    const v = await fn().catch(() => null)
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what)
    await new Promise((r) => setTimeout(r, 200))
  }
}

try {
  const A = await launch('alpha', basePort)
  const { win, inv } = A

  step('Planning Center: connect from the Integrations hub')
  await win.click('.nav-item:has-text("Integrations")')
  await win.fill('[data-testid=pco-appid]', 'test-app')
  await win.fill('[data-testid=pco-secret]', 'test-secret')
  await win.click('[data-testid=pco-connect]')
  await win.waitForSelector('[data-testid=pco-pull-0]', { timeout: 15000 })
  if (shot) await win.screenshot({ path: join(shot, 'integrations-hub.png') })

  step('Pull this Sunday → review screen')
  await win.click('[data-testid=pco-pull-0]')
  await win.waitForSelector('[data-testid=pco-review]')
  await win.waitForSelector('[data-testid=pco-songs] >> text=River Of Light')
  if (shot) await win.screenshot({ path: join(shot, 'plan-pull-review.png') })
  await win.click('[data-testid=pco-apply]')
  const pl = await waitFor(async () => (await inv('playlists.list')).find((p) => p.source?.type === 'pco'), 15000, 'pulled playlist')
  const titles = pl.items.map((i) => `${i.type}:${i.title}`)
  console.log('  ', titles.join(' | '))
  if (pl.items.length !== 7) throw new Error('expected 7 items')
  const doxo = pl.items.find((i) => i.title === 'Doxology')
  if (doxo.type !== 'presentation') throw new Error('Doxology should match the seeded library song')
  const river = pl.items.find((i) => i.title === 'River Of Light')
  if (river.type !== 'presentation') throw new Error('River Of Light should be imported from PCO lyrics')
  const riverP = await inv('library.get', { id: river.presentationId })
  const arr = riverP.arrangements.find((a) => a.id === riverP.activeArrangementId)
  const order = arr.groupIds.map((g) => riverP.groups.find((x) => x.id === g).name)
  if (order.join(',') !== 'Verse 1,Chorus,Verse 2,Chorus') throw new Error('arrangement order wrong: ' + order)
  const msg = pl.items.find((i) => i.title === 'Message')
  if (msg.type !== 'placeholder' || msg.people?.[0] !== 'Sam') throw new Error('Message placeholder/people wrong')
  const timers = await inv('workspace.readDoc', { name: 'timers' })
  if (!timers?.length) throw new Error('countdown timers not suggested/created')

  step('Plan changes in Planning Center → re-sync shows the diff, keeps local edits')
  mocks.state.pco.items.find((i) => i.id === 'i7').length = 2100
  mocks.state.pco.items.push({ id: 'i8', type: 'item', title: 'Benediction', length: 60 })
  mocks.state.pco.planUpdated = '2030-03-02T00:00:00Z'
  const local = { ...pl, items: pl.items.map((i) => (i.title === 'Call To Worship' ? { ...i, notes: 'Operator: start the pad' } : i)) }
  await inv('playlists.save', { playlist: local })
  const check = await inv('pco.check', { playlistId: pl.id })
  console.log('   changes:', check.changes.map((c) => `${c.type}:${c.title}`).join(', '))
  if (check.changes.length !== 2) throw new Error('expected 2 remote changes')
  await inv('pco.pull', { serviceTypeId: 'st1', planId: 'pl1' })
  const pl2 = await inv('playlists.get', { id: pl.id })
  if (pl2.items.find((i) => i.title === 'Message').length !== 2100) throw new Error('length not updated')
  if (pl2.items.find((i) => i.title === 'Call To Worship').notes !== 'Operator: start the pad') throw new Error('local edit lost')
  if (!pl2.items.some((i) => i.title === 'Benediction')) throw new Error('new item missing')

  step('Bibles: download the free BSB into the workspace')
  await win.click('.nav-item:has-text("Integrations")')
  await win.click('[data-testid=bible-dl-BSB]')
  await waitFor(async () => (await inv('bible.translations')).length > 0, 20000, 'BSB download')
  if (!existsSync(join(dir, 'alpha', 'ws', 'bibles', 'BSB.json'))) throw new Error('bible not in workspace')

  step('Notion: connect, auto-detect databases, fill the sermon + announcements')
  await win.click('.nav-item:has-text("Integrations")')
  await win.fill('[data-testid=notion-token]', 'secret_test')
  await win.click('[data-testid=notion-connect]')
  await win.waitForSelector('[data-testid=notion-pages] >> text=Rivers / Psalm 46', { timeout: 15000 })
  const ns = await inv('notion.status')
  if (ns.settings.sermons?.databaseId !== 'db-services' || ns.settings.announcements?.databaseId !== 'db-comms') throw new Error('auto-detect failed ' + JSON.stringify(ns.settings))
  await win.click('[data-testid=notion-pages] >> button:has-text("Preview")')
  await win.waitForSelector('[data-testid=notion-review] .ix-draft')
  if (shot) await win.screenshot({ path: join(shot, 'notion-preview.png') })
  await win.click('[data-testid=notion-apply]')
  const filled = await waitFor(async () => { const p = await inv('playlists.get', { id: pl.id }); const m = p.items.find((i) => i.title === 'Message'); return m.type === 'presentation' ? m : null }, 20000, 'sermon placeholder filled')
  const sermon = await inv('library.get', { id: filled.presentationId })
  console.log('   sermon slides:', sermon.slides.map((s) => s.label).join(' | '))
  if (sermon.slides.length !== 4) throw new Error('expected 4 sermon slides')
  const scripture = sermon.slides[1].elements.map((e) => e.paragraphs?.map((p) => p.runs.map((r) => r.text).join('')).join(' ')).join(' ')
  if (!/Test text of Psalm 46:4/.test(scripture)) throw new Error('scripture not auto-filled from the Bible: ' + scripture)
  if (sermon.slides[3].elements[0].type !== 'image' || !sermon.slides[3].elements[0].media.src.startsWith('workspace:notion/')) throw new Error('image not downloaded into workspace')
  // Re-sync is a no-op until Notion changes; then only the changed slide updates.
  mocks.state.notion.pages['page-sermon'].blocks[1].heading_1.rich_text[0].plain_text = 'Rivers of Grace'
  const pv = await inv('notion.preview', { which: 'sermons', pageIds: ['page-sermon'] })
  const ch = pv.changes.filter((c) => c.type !== 'same')
  if (ch.length !== 1 || ch[0].type !== 'changed') throw new Error('expected 1 changed slide: ' + JSON.stringify(ch))
  const ann = await inv('notion.import', { which: 'announcements', pageIds: ['page-hl'] })
  if (ann.presentation.kind !== 'announcement' || ann.presentation.slides[0].autoAdvance !== 10 || !/sign-up/.test(ann.presentation.slides[0].notes ?? '')) throw new Error('announcements loop wrong')
  if (ann.attached?.playlistId !== pl.id) throw new Error('announcements not attached to the plan')

  step('Bible view: type a reference, send it live')
  await win.click('.nav-item:has-text("Bible")')
  await win.fill('[data-testid=bible-q]', 'jn 3 16-18')
  await win.waitForSelector('[data-testid=bible-slide]')
  await win.waitForFunction(() => document.querySelector('[data-testid=bible-view]')?.textContent?.includes('Test text of John 3:16'))
  if (shot) await win.screenshot({ path: join(shot, 'bible-view.png') })
  await win.click('[data-testid=bible-live]')
  const live = await waitFor(async () => { const l = await inv('live.get'); return l.slide?.presentationTitle?.includes('John 3:16') ? l : null }, 8000, 'bible live')
  console.log('   live:', live.slide.presentationTitle)

  step('Show screen sync panel')
  await win.click('.nav-item:has-text("Show")')
  if (shot) await win.screenshot({ path: join(shot, 'show-with-plan.png') })

  globalThis.__A = A
  if (process.env.E2E_PART !== '1') {
    const extra = await import('./e2e-integrations-sync.mjs').catch((e) => { if (e.code === 'ERR_MODULE_NOT_FOUND') return null; throw e })
    if (extra) await extra.run({ A, launch, waitFor, mocks, dir, basePort, shot, step })
  }

  for (const c of launched) if (c.errors.length) throw new Error(`${c.name} renderer errors:\n` + c.errors.join('\n'))
  console.log('E2E INTEGRATIONS OK')
} catch (e) {
  for (const c of launched) console.error(`--- ${c.name} logs ---\n` + c.logs.join('').slice(-6000))
  throw e
} finally {
  for (const c of launched) await c.app.close().catch(() => {})
  mocks.close()
}
