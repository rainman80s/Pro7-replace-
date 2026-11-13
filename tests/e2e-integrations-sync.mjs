// Part 2 of e2e-integrations: two app instances sharing one workspace over the built-in sync.
import { join } from 'node:path'
export async function run({ A, launch, waitFor, basePort, shot, step }) {
  step('Cloud workspace: alpha shares, bravo joins with URL + PIN')
  await A.win.click('.nav-item:has-text("Integrations")')
  await A.win.click('[data-testid=cloud-share]')
  await A.win.waitForSelector('[data-testid=cloud-hosting]')
  const pin = await A.inv('local.get', { key: 'remotePin' })
  const B = await launch('bravo', basePort + 1)
  B.win.on('dialog', (d) => void d.accept())
  await B.win.click('.nav-item:has-text("Integrations")')
  await B.win.fill('[data-testid=cloud-url]', `http://127.0.0.1:${basePort}`)
  await B.win.fill('[data-testid=cloud-pin]', String(pin))
  await B.win.click('[data-testid=cloud-join]')
  const aPl = (await A.inv('playlists.list')).find((p) => p.source?.type === 'pco')
  await waitFor(async () => (await B.inv('playlists.list')).some((p) => p.id === aPl.id), 30000, 'bravo receives the service plan')
  const sermonId = aPl.items.find((i) => i.title === 'Message').presentationId
  await waitFor(async () => (await B.inv('library.get', { id: sermonId }))?.slides.length === 4, 20000, 'bravo receives the sermon')
  const media = await waitFor(async () => (await B.inv('media.list')).find((m) => m.src.startsWith('workspace:notion/')), 20000, 'bravo receives Notion media')
  await waitFor(async () => (await B.inv('bible.translations')).length > 0, 20000, 'bravo has the synced Bible')
  console.log('   bravo has', (await B.inv('library.list')).length, 'presentations and media', media.src)

  step('Edit on bravo → appears on alpha; presence shows who is on air')
  const p = await B.inv('library.get', { id: sermonId })
  p.title = 'Rivers (edited on bravo)'
  await B.inv('library.save', { presentation: p })
  await waitFor(async () => (await A.inv('library.get', { id: sermonId }))?.title === 'Rivers (edited on bravo)', 20000, 'edit reaches alpha')
  await A.inv('live.goToSlide', { presentationId: sermonId, index: 0 })
  const peers = await waitFor(async () => { const s = await B.inv('cloud.status'); return s.peers.length >= 2 && s.peers.some((x) => x.name === 'alpha' && x.onAir) ? s.peers : null }, 25000, 'presence')
  console.log('   peers:', peers.map((x) => `${x.name}${x.onAir ? '(on air)' : ''}`).join(', '))

  step('Version history: restore the pre-edit title on alpha')
  const hist = await A.inv('history.list', { presentationId: sermonId })
  if (!hist.length) throw new Error('no history')
  if (shot) { await B.win.click('.nav-item:has-text("Integrations")'); await B.win.waitForSelector('[data-testid=cloud-peers]'); await B.win.locator('[data-testid=cloud-card]').scrollIntoViewIfNeeded(); await B.win.screenshot({ path: join(shot, 'cloud-replica.png') }) }
  await B.app.close()
}
