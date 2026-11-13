// E2E for the Show screen: the volunteer flow and service (playlist) editing.
// Run: npm run build && REACH_PORT=4803 xvfb-run -a node tests/e2e-show.mjs
// Set SHOT_DIR=<dir> to save screenshots at 1440x900 and 1100x700.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright')
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'reach-e2e-show-'))
const shot = process.env.SHOT_DIR
const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', '--no-sandbox'],
  env: { ...process.env, REACH_USER_DATA: join(dir, 'user'), REACH_WORKSPACE: join(dir, 'ws'), REACH_PORT: process.env.REACH_PORT ?? '4803', NODE_OPTIONS: '' }
})
const logs = []
app.process().stdout.on('data', (d) => logs.push(String(d)))
app.process().stderr.on('data', (d) => logs.push(String(d)))

const step = (name) => console.log('·', name)
const tid = (id) => `[data-testid="${id}"]`
let win
const live = () => win.evaluate(() => window.reachBridge.invoke('live.get'))
const waitLive = (fn, arg) => win.waitForFunction(async ([src, a]) => (0, eval)(src)(await window.reachBridge.invoke('live.get'), a), [fn.toString(), arg], { timeout: 8000 })
const playlist = () => win.evaluate(async () => (await window.reachBridge.invoke('playlists.list'))[0])
const resize = async (w, h) => {
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(w, h) }, [w, h])
  await win.waitForTimeout(350)
}
const snap = async (name) => {
  if (!shot) return
  // Hide transient toasts and let animations settle so the picture shows the screen itself.
  await win.addStyleTag({ content: '.toasts{display:none!important}' }).then((h) => h.evaluate((el) => el.setAttribute('data-snap', '')))
  await win.mouse.move(2, 880)
  await win.waitForTimeout(600)
  await win.screenshot({ path: join(shot, name) })
  await win.evaluate(() => document.querySelectorAll('style[data-snap]').forEach((el) => el.remove()))
}

try {
  win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await resize(1440, 900)
  await win.waitForSelector(tid('service-item'), { timeout: 20000 })

  /* ── Volunteer flow ── */
  step('nothing is live at start')
  if ((await win.textContent(tid('live-status'))).trim() !== 'Nothing on screen') throw new Error('expected an empty live state')

  step('select a service item — this must NOT put anything on screen')
  await win.click(`${tid('service-item')}:has-text("Doxology")`)
  await win.waitForSelector(`${tid('grid-title')}:has-text("Doxology")`)
  if ((await live()).slide) throw new Error('selecting an item should not go live')

  step('Start with the big button → first slide goes live')
  await win.click(tid('go-next'))
  await waitLive((l) => l.slide?.index === 0)
  await win.waitForSelector(`${tid('slide')}.live`)
  if (!(await win.textContent(tid('live-status'))).includes('On screen now')) throw new Error('live status did not update')

  step('Space advances through the item')
  await win.keyboard.press('Space')
  await waitLive((l) => l.slide?.index === 1)
  await win.keyboard.press('ArrowRight')
  await waitLive((l) => l.slide?.index === 2)
  const doxCount = await win.locator(tid('slide')).count()
  for (let i = 3; i < doxCount; i++) { await win.keyboard.press('Space'); await waitLive((l, n) => l.slide?.index === n, i) }

  step('Next on the last slide continues into the next service item (header & placeholder skipped)')
  const before = await live()
  await win.keyboard.press('Space')
  const pl = await playlist()
  const doxIdx = pl.items.findIndex((x) => x.id === before.slide.playlistItemId)
  const expected = pl.items.slice(doxIdx + 1).find((x) => x.type === 'presentation' || x.type === 'media')
  if (expected) {
    await waitLive((l, id) => l.slide?.playlistItemId === id && l.slide.index === 0, expected.id)
    await win.waitForSelector(`${tid('service-item')}.on.is-live`)
  } else {
    // Doxology is the last song in the seed — Next shows a toast and stays put.
    await win.waitForSelector('.toast:has-text("last slide")')
    if ((await live()).slide?.index !== before.slide.index) throw new Error('should stay on the last slide')
  }

  step('Back from the first slide of an item returns to the previous item’s last slide')
  await win.click(`${tid('service-item')}:has-text("Amazing Grace")`)
  await win.click(`${tid('slide')} >> nth=0`)
  await waitLive((l) => l.slide?.index === 0 && l.slide.presentationTitle === 'Amazing Grace')
  await win.click(tid('go-prev'))
  await waitLive((l) => l.slide?.presentationTitle === 'Welcome')

  step('auto-continue forwards from Amazing Grace into Doxology')
  await win.click(`${tid('service-item')}:has-text("Amazing Grace")`)
  const graceCount = await win.locator(tid('slide')).count()
  await win.click(`${tid('slide')} >> nth=${graceCount - 1}`)
  await waitLive((l, n) => l.slide?.index === n, graceCount - 1)
  await snap('show-live-1440.png')
  await win.click(tid('go-next'))
  await waitLive((l) => l.slide?.presentationTitle === 'Doxology' && l.slide.index === 0)

  step('Esc clears the slide; Clear all clears everything')
  await win.keyboard.press('Escape')
  await waitLive((l) => !l.slide)
  await win.click(`${tid('slide')} >> nth=0`)
  await waitLive((l) => !!l.slide)
  await win.click(tid('clear-all'))
  await waitLive((l) => !l.slide && !l.background && !l.video)
  await win.waitForSelector(`${tid('clear-all')}:disabled`)

  step('Logo button shows the Reach logo screen')
  await win.click(tid('toggle-logo'))
  await waitLive((l) => l.logo)
  const ws = await win.evaluate(() => window.reachBridge.invoke('workspace.get'))
  if (!ws.logo?.src?.startsWith('data:image/svg+xml')) throw new Error('default logo was not set')
  await win.click(tid('toggle-logo'))
  await waitLive((l) => !l.logo)

  /* ── Quick search ── */
  step('⌘K finds a song by a lyric and shows it')
  await win.keyboard.press('Control+k')
  await win.waitForSelector(tid('quick-search'))
  await win.fill(tid('quick-search-input'), 'praise him all creatures')
  await win.waitForSelector(`${tid('quick-search-row')}:has-text("Doxology")`)
  await win.keyboard.press('Enter')
  await waitLive((l) => l.slide?.presentationTitle === 'Doxology')
  await win.keyboard.press('Escape')
  await waitLive((l) => !l.slide)

  /* ── Service editing ── */
  step('create a new service')
  await win.click(tid('service-picker'))
  await win.click(tid('service-new'))
  await win.fill(tid('service-form-name'), 'Evening Service')
  await win.click(tid('service-form-save'))
  await win.waitForSelector(`${tid('service-picker')}:has-text("Evening Service")`)

  step('add from the library (+ button on a library row)')
  for (const title of ['Welcome', 'Amazing Grace', 'Doxology']) {
    await win.hover(`${tid('library-item')}:has-text("${title}")`)
    await win.click(`${tid('library-item')}:has-text("${title}") ${tid('library-add')}`)
    await win.waitForSelector(`${tid('service-item')}:has-text("${title}")`)
  }

  step('add a header and a placeholder via the + menu')
  await win.click(tid('service-add'))
  await win.click(tid('add-header'))
  await win.waitForSelector(tid('item-details-drawer'))
  await win.fill(tid('item-details-title'), 'Worship')
  await win.click(tid('item-details-save'))
  await win.waitForSelector(`${tid('service-header')}:has-text("Worship")`)
  await win.click(tid('service-add'))
  await win.click(tid('add-placeholder'))
  await win.click(tid('item-details-save'))
  await win.waitForSelector(`${tid('service-item')}[data-item-type="placeholder"]`)

  step('reorder: drag the header to the top')
  const header = win.locator(tid('service-header')).first()
  await header.dragTo(win.locator(tid('service-item')).first(), { targetPosition: { x: 20, y: 4 } })
  await win.waitForFunction(async () => {
    const pls = await window.reachBridge.invoke('playlists.list')
    return pls.find((p) => p.name === 'Evening Service')?.items[0]?.type === 'header'
  }, null, { timeout: 5000 })

  step('reorder: Move down from the context menu')
  await win.click(`${tid('service-item')}:has-text("Doxology")`, { button: 'right' })
  await win.click(tid('item-move-down'))
  await win.waitForFunction(async () => {
    const p = (await window.reachBridge.invoke('playlists.list')).find((x) => x.name === 'Evening Service')
    return p.items[p.items.length - 1].type === 'presentation'
  }, null, { timeout: 5000 })

  step('remove an item, then undo')
  await win.click(`${tid('service-item')}:has-text("Welcome")`, { button: 'right' })
  await win.click(tid('item-remove'))
  await win.waitForSelector(`${tid('service-item')}:has-text("Welcome")`, { state: 'detached' })
  await win.click('.toast-action:has-text("Undo")')
  await win.waitForSelector(`${tid('service-item')}:has-text("Welcome")`)

  step('quick-create a song from pasted lyrics, straight into the service')
  await win.click(tid('service-add'))
  await win.click(tid('add-new-song'))
  await win.fill(tid('new-song-title'), 'Test Song')
  await win.fill(tid('new-song-text'), 'Verse 1\nLine one\nLine two\n\nLine three\n\nChorus\nSing it loud')
  await win.click(tid('new-song-create'))
  await win.waitForSelector(`${tid('service-item')}:has-text("Test Song")`)
  await win.waitForFunction(() => document.querySelectorAll('[data-testid="slide"]').length === 3)
  await snap('service-editing-1440.png')

  step('duplicate and rename the service')
  await win.click(tid('service-picker'))
  await win.click(tid('service-duplicate'))
  await win.fill(tid('service-form-name'), 'Evening Service (next week)')
  await win.click(tid('service-form-save'))
  await win.waitForSelector(`${tid('service-picker')}:has-text("next week")`)
  const copies = await win.evaluate(async () => (await window.reachBridge.invoke('playlists.list')).filter((p) => p.name.startsWith('Evening Service')))
  if (copies.length !== 2 || copies[0].items.length !== copies[1].items.length) throw new Error('duplicate failed')

  step('delete the copy (with confirmation)')
  await win.click(tid('service-picker'))
  await win.click(tid('service-delete'))
  await win.click(tid('dialog-ok'))
  await win.waitForFunction(async () => (await window.reachBridge.invoke('playlists.list')).filter((p) => p.name.startsWith('Evening Service')).length === 1)

  /* ── Volunteer mode ── */
  step('Volunteer mode hides editing; only Show stays in the nav')
  await win.click(tid('lock-toggle'))
  await win.waitForSelector(`${tid('nav-settings')}`, { state: 'detached' })
  if (await win.locator(tid('service-add')).count()) throw new Error('add button should be hidden in volunteer mode')
  if (await win.locator(tid('edit-presentation')).count()) throw new Error('edit should be hidden in volunteer mode')
  await win.click(`${tid('service-item')}:has-text("Test Song")`, { button: 'right' })
  if (await win.locator(tid('item-remove')).count()) throw new Error('remove should be hidden in volunteer mode')
  await win.keyboard.press('Escape')
  await snap('volunteer-1440.png')
  await win.click(tid('lock-toggle'))
  await win.waitForSelector(tid('nav-settings'))

  step('Settings shows general sections and the remote address')
  await win.click(tid('nav-settings'))
  await win.waitForSelector(tid('settings-view'))
  await win.waitForFunction(() => document.querySelector('[data-testid="remote-url"]')?.value.startsWith('http'))

  step('welcome guide opens from Settings and can be skipped')
  await win.click('button:has-text("Show again")')
  await win.waitForSelector(tid('welcome'))
  await snap('welcome-1440.png')
  await win.click(tid('welcome-next'))
  await win.click(tid('welcome-skip'))
  await win.waitForSelector(tid('welcome'), { state: 'detached' })

  step('about box (logo) from the wordmark')
  await win.click('.brand')
  await win.waitForSelector(tid('about'))
  await snap('about-1440.png')
  await win.keyboard.press('Escape')
  await win.waitForSelector(tid('about'), { state: 'detached' })

  step('shortcuts overlay')
  await win.click(tid('nav-show'))
  await win.keyboard.press('?')
  await win.waitForSelector(tid('shortcuts'))
  await snap('shortcuts-1440.png')
  await win.keyboard.press('Escape')
  await win.waitForSelector(tid('shortcuts'), { state: 'detached' })

  if (shot) {
    await win.click(`${tid('service-item')}:has-text("Amazing Grace")`)
    await win.click(`${tid('slide')} >> nth=2`)
    await win.mouse.move(5, 5)
    await win.waitForTimeout(400)
    await resize(1100, 700)
    await snap('show-live-1100.png')
    await resize(1440, 900)
  }

  if (errors.length) throw new Error('renderer errors:\n' + errors.join('\n'))
  console.log('E2E SHOW OK')
} catch (e) {
  console.error(logs.join('').slice(-4000))
  if (win && shot) await win.screenshot({ path: join(shot, 'failure.png') }).catch(() => {})
  throw e
} finally {
  await app.close()
}
