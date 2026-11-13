/**
 * Renders the app icon from the extracted Window R artwork.
 *   xvfb-run -a npx electron scripts/make-icons.cjs --no-sandbox   (then: python3 scripts/pack-icons.py)
 * Colour rule from the brand guide: Paper on Charcoal (never Lakeside/Mustard on Charcoal).
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

const src = readFileSync(join(__dirname, '../src/renderer/src/ui/logo-paths.ts'), 'utf8')
const m = /LOGO_ICON = \{ viewBox: '([^']+)', d: '([^']+)'/.exec(src)
const [, , w, h] = m[1].split(' ').map(Number)

function svg(size, { macPadding }) {
  // macOS icon grid: 824px rounded square centred in 1024 with a soft shadow. Windows/Linux: full bleed rounded square.
  const inset = macPadding ? size * (100 / 1024) : 0
  const box = size - inset * 2
  const radius = box * 0.225
  const rh = box * 0.46
  const scale = rh / h
  const x = (size - w * scale) / 2
  const y = (size - rh) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#333230"/><stop offset="1" stop-color="#242423"/></linearGradient>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="${size * 0.012}" stdDeviation="${size * 0.014}" flood-color="#000" flood-opacity="${macPadding ? 0.35 : 0}"/></filter>
  </defs>
  <rect x="${inset}" y="${inset}" width="${box}" height="${box}" rx="${radius}" fill="url(#g)" filter="url(#s)"/>
  <rect x="${inset + 0.5}" y="${inset + 0.5}" width="${box - 1}" height="${box - 1}" rx="${radius}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="${size / 512}"/>
  <path fill="#F4F2EB" transform="translate(${x} ${y}) scale(${scale})" d="${m[2]}"/>
</svg>`
}

app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const out = join(__dirname, '../resources')
  const jobs = [['icon.png', 1024, true], ['icon-square.png', 1024, false]]
  for (const [name, size, macPadding] of jobs) {
    const win = new BrowserWindow({ width: size, height: size, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } })
    const markup = svg(size, { macPadding })
    writeFileSync(join(out, name.replace('.png', '.svg')), markup)
    const page = join(tmpdir(), `reach-icon-${size}-${macPadding ? 'mac' : 'sq'}.html`)
    writeFileSync(page, `<html><body style="margin:0;background:transparent">${markup}</body></html>`)
    await win.loadFile(page)
    await new Promise((r) => setTimeout(r, 300))
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
    writeFileSync(join(out, name), img.resize({ width: size, height: size }).toPNG())
    win.destroy()
  }
  app.quit()
})
