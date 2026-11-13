// E2E for the slide editor: text editing, move/resize, undo/redo, per-screen variants on a stacked LED wall,
// apply-to-all, going live with the variant, reflow text mode, themes, media view.
// Run: npm run build && REACH_PORT=4803 xvfb-run -a node tests/e2e-editor.mjs   (SHOT_DIR=… for screenshots)
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright')

const dir = mkdtempSync(join(tmpdir(), 'reach-e2e-editor-'))
const shot = process.env.SHOT_DIR
const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', '--no-sandbox'],
  env: { ...process.env, REACH_USER_DATA: join(dir, 'user'), REACH_WORKSPACE: join(dir, 'ws'), REACH_PORT: process.env.REACH_PORT ?? '4803', NODE_OPTIONS: '' }
})
const logs = []
app.process().stdout.on('data', (d) => logs.push(String(d)))
app.process().stderr.on('data', (d) => logs.push(String(d)))
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m) }
const step = (m) => console.log('·', m)

try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1480, height: 900 })
  const errors = []
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()) })
  const call = (method, payload) => win.evaluate(([m, p]) => window.reachBridge.invoke(m, p), [method, payload])
  const snap = async (name) => { if (shot) await win.screenshot({ path: join(shot, `editor-${name}.png`) }) }
  const text = (s) => s.elements.filter((e) => e.type === 'text').map((e) => e.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n')).join('\n')

  await win.waitForSelector('.pl-item', { timeout: 20000 })
  const lib = await call('library.list')
  const grace = lib.find((p) => p.title === 'Amazing Grace')
  const get = () => call('library.get', { id: grace.id })
  const saved = async (pred, what) => {
    await win.waitForFunction(() => document.querySelector('[data-testid=save-status]')?.textContent === 'Saved', null, { timeout: 10000 })
    for (let i = 0; i < 40; i++) { const p = await get(); if (pred(p)) return p; await win.waitForTimeout(150) }
    throw new Error('not saved: ' + what)
  }

  step('open Amazing Grace in the editor')
  await win.click('.nav-item:has-text("Edit")')
  await win.click('[data-testid=open-doc]')
  await win.click('.ed-open-item:has-text("Amazing Grace")')
  await win.waitForFunction(() => document.querySelector('[data-testid=doc-title]')?.value === 'Amazing Grace')
  await win.waitForSelector('[data-testid=stage]')
  const box = async () => win.locator('[data-testid=stage]').boundingBox()
  let b = await box()
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2

  step('edit text in place')
  await win.mouse.dblclick(cx, cy)
  await win.waitForSelector('[data-text-editor]')
  await win.keyboard.type('Hello Reach')
  await win.keyboard.press('Enter')
  await win.keyboard.type('second line')
  await win.keyboard.press('Escape')
  let p = await saved((p) => text(p.slides[0]) === 'Hello Reach\nsecond line', 'text edit')

  step('move + resize')
  const f0 = p.slides[0].elements[0].frame
  await win.mouse.click(cx, cy)
  await win.mouse.move(cx, cy)
  await win.mouse.down()
  await win.mouse.move(cx + 40, cy + 30, { steps: 6 })
  await win.mouse.up()
  p = await saved((p) => p.slides[0].elements[0].frame.x !== f0.x, 'move')
  const f1 = p.slides[0].elements[0].frame
  const se = await win.locator('[data-handle=se]').boundingBox()
  await win.mouse.move(se.x + se.width / 2, se.y + se.height / 2)
  await win.mouse.down()
  await win.mouse.move(se.x - 60, se.y - 40, { steps: 6 })
  await win.mouse.up()
  p = await saved((p) => p.slides[0].elements[0].frame.w < f1.w, 'resize')
  const f2 = p.slides[0].elements[0].frame
  assert(f2.x === f1.x && f2.y === f1.y, 'resize keeps the top-left corner')
  await snap('1-selected')

  step('undo / redo')
  await win.click('[data-testid=undo]')
  p = await saved((p) => p.slides[0].elements[0].frame.w === f1.w, 'undo resize')
  await win.click('[data-testid=redo]')
  p = await saved((p) => p.slides[0].elements[0].frame.w === f2.w, 'redo resize')
  await win.mouse.click(b.x + 5, b.y + 5) // deselect
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  p = await saved((p) => p.slides[0].elements[0].frame.w === f1.w, 'keyboard undo')

  step('add a stacked LED wall canvas with Top/Bottom regions')
  const ws = await call('workspace.get')
  await call('workspace.update', { canvases: [...ws.canvases, { id: 'wall', name: 'LED Wall', kind: 'audience', width: 1920, height: 2160, color: '#E6A20F',
    regions: [{ id: 'top', name: 'LED Top', rect: { x: 0, y: 0, w: 1920, h: 1080 } }, { id: 'bottom', name: 'LED Bottom', rect: { x: 0, y: 1080, w: 1920, h: 1080 } }] }] })
  await win.click('[data-testid="ctab-LED Wall"]')
  await win.waitForSelector('[data-testid=inherited-banner]')
  await snap('2-inherited')

  step('customize: place the main design into LED Bottom')
  await win.selectOption('[data-testid=place-region]', 'bottom')
  p = await saved((p) => !!p.slides[0].variants?.wall, 'variant')
  const v = p.slides[0].variants.wall.elements[0]
  assert(v.regionId === 'bottom' && v.frame.y >= 1080, 'variant placed in LED Bottom')
  await win.waitForSelector('[data-testid=variant-bar]')
  // select it and add a shape filling LED Top
  await win.selectOption('[data-testid=add-shape]', 'rect')
  await win.click('[data-testid="fill-region-LED Top"]')
  p = await saved((p) => p.slides[0].variants.wall.elements.some((e) => e.type === 'shape' && e.frame.h === 1080 && e.frame.y === 0), 'fill LED Top')
  await snap('3-variant')

  step('apply this layout to all slides')
  await win.click('[data-testid=apply-all]')
  await win.click('[data-testid=confirm]')
  p = await saved((p) => p.slides.every((s) => s.variants?.wall?.elements.length === 2), 'apply all')
  assert(text({ elements: p.slides[2].variants.wall.elements }).includes('grace that taught'), 'other slides keep their own words')

  step('lyrics are single-source: edit main text, variant follows')
  await win.click('[data-testid=ctab-main]')
  await win.locator('[data-testid=film-slide]').nth(1).click()
  b = await box()
  await win.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2)
  await win.waitForSelector('[data-text-editor]')
  await win.keyboard.type('Linked words')
  await win.keyboard.press('Escape')
  p = await saved((p) => text({ elements: p.slides[1].variants.wall.elements }) === 'Linked words', 'linked text')

  step('go live and check the live slide carries the variant')
  await call('live.goToSlide', { presentationId: grace.id, slideId: p.slides[1].id })
  let live = await call('live.get')
  assert(live.slide?.slide.variants?.wall?.elements.length === 2, 'live slide has the LED Wall variant')
  // edit the live slide → "Update live"
  await win.click('[data-testid="ctab-LED Wall"]')
  await win.mouse.dblclick(b.x + b.width / 2, b.y + b.height * 0.75)
  await win.waitForSelector('[data-text-editor]')
  await win.keyboard.type('Updated on air')
  await win.keyboard.press('Escape')
  await saved((p) => text(p.slides[1]) === 'Updated on air', 'edit from LED tab writes through to main text')
  await win.waitForSelector('[data-testid=update-live]:has-text("Update live")')
  live = await call('live.get')
  assert(text(live.slide.slide) === 'Linked words', 'outputs unchanged until Update live')
  await win.click('[data-testid=update-live]')
  await win.waitForFunction(async () => { const l = await window.reachBridge.invoke('live.get'); return l.slide?.slide.elements[0].paragraphs[0].runs[0].text === 'Updated on air' })
  await snap('4-live')

  step('all-screens preview')
  await win.click('[data-testid=all-screens]')
  await win.waitForSelector('[data-testid=allscreens]')
  await snap('5-allscreens')
  await win.click('[data-testid=all-screens]')

  step('reflow text mode')
  await win.click('[data-testid=mode-text]')
  const area = win.locator('[data-testid=reflow-text]')
  const before = await area.inputValue()
  assert(before.startsWith('Verse 1\nHello Reach'), 'reflow shows text with sections')
  await area.fill(before + '\n\nBridge\nA brand new slide\n\nAnd another')
  await area.blur()
  p = await saved((p) => p.slides.length === 8 && p.groups.some((g) => g.name === 'Bridge'), 'reflow add')
  assert(p.slides[6].variants?.wall, 'new reflow slide inherits the layout of its neighbour')
  await snap('6-text')

  step('themes: apply and remove')
  await win.click('[data-testid=mode-design]')
  await win.click('[data-testid=themes]')
  await win.click('[data-testid="theme-Reach · Lyrics lower third"]')
  await win.click('[data-testid=apply-theme-all]')
  p = await saved((p) => p.themeId === 'reach-lower-third', 'theme applied')
  assert(p.slides[0].elements.some((e) => e.fromTheme), 'theme decoration added')
  assert(text({ elements: p.slides[2].elements.filter((e) => !e.fromTheme) }).includes('grace that taught'), 'theme keeps words')
  await win.click('[data-testid=ctab-main]')
  await snap('7-themed')
  await win.click('[data-testid=themes]')
  await win.click('[data-testid=remove-theme]')
  await win.keyboard.press('Escape')
  p = await saved((p) => !p.themeId && !p.slides[0].elements.some((e) => e.fromTheme), 'theme removed')

  step('stage layout editor')
  await win.click('[data-testid=open-doc]')
  await win.click('.ed-seg button:has-text("Stage layouts")')
  await win.click('.ed-pick-item:has-text("Lyrics confidence") button')
  await win.waitForFunction(() => document.querySelector('.ed-kicker')?.textContent === 'Stage layout')
  await win.selectOption('[data-testid=add-token]', 'clock')
  await win.waitForFunction(() => document.querySelector('[data-testid=save-status]')?.textContent === 'Saved')
  const layouts = await call('workspace.readDoc', { name: 'stageLayouts' })
  assert(layouts?.length === 1 && layouts[0].slide.elements.length === 9, 'stage layout saved with new token box')
  await snap('8-stage')

  step('media view')
  await win.click('.nav-item:has-text("Media")')
  await win.waitForSelector('[data-testid=media-view]')
  await snap('9-media')

  if (errors.length) throw new Error('renderer errors:\n' + errors.join('\n'))
  console.log('E2E EDITOR OK')
} catch (e) {
  console.error(logs.slice(-40).join(''))
  throw e
} finally {
  await app.close()
}
