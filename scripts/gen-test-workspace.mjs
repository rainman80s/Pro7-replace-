// Generate a realistic test workspace (NOT committed data).
//   node scripts/gen-test-workspace.mjs <dir> [presentations=1000] [videos=0]
// Presentations look like imported ProPresenter songs (10-16 slides, 3 canvases of variants, ~25KB each).
// Videos (optional) are tiny ffmpeg-generated mp4s, padded to look large-ish, in <dir>/media.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const [dir, n = '1000', v = '0'] = process.argv.slice(2)
if (!dir) { console.error('usage: gen-test-workspace.mjs <dir> [n] [videos]'); process.exit(1) }
const id = () => randomBytes(8).toString('hex')
const words = 'grace love mercy king heaven glory Jesus light holy name worship river cross lamb fire spirit praise sing hope freedom victory'.split(' ')
let seed = 7
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
const pick = () => words[Math.floor(rnd() * words.length)]
const line = () => Array.from({ length: 4 + Math.floor(rnd() * 5) }, pick).join(' ')
const el = (text) => ({
  id: id(), type: 'text', role: 'lyrics', name: 'Lyrics',
  frame: { x: 153, y: 108, w: 1612, h: 864 },
  paragraphs: text.split('\n').map((t) => ({ runs: [{ text: t, style: { fontFamily: 'Reach Sans', fontSize: 92 } }] })),
  align: 'center', verticalAlign: 'middle', autoFit: true,
  style: { fontFamily: 'Reach Sans', fontSize: 92, fontWeight: 600, color: '#FFFFFF', lineHeight: 1.2 }
})
for (const d of ['library', 'playlists', 'media', 'docs']) mkdirSync(join(dir, d), { recursive: true })
writeFileSync(join(dir, 'workspace.json'), JSON.stringify({ version: 1, name: 'Bench', defaultSize: { width: 1920, height: 1080 }, canvases: [
  { id: 'main', name: 'Main', kind: 'audience', width: 1920, height: 1080, regions: [] },
  { id: 'stage', name: 'Stage', kind: 'stage', width: 1920, height: 1080, regions: [] }] }))
for (let i = 0; i < +n; i++) {
  const slides = [], groups = []
  for (let g = 0; g < 4 + Math.floor(rnd() * 3); g++) {
    const gid = id(); const ids = []
    for (let k = 0; k < 2 + Math.floor(rnd() * 2); k++) {
      const s = { id: id(), elements: [el([line(), line(), line()].join('\n'))], variants: { stage: { elements: [el(line())] } } }
      slides.push(s); ids.push(s.id)
    }
    groups.push({ id: gid, name: g % 2 ? 'Chorus' : `Verse ${g / 2 + 1}`, color: '#3886CE', slideIds: ids })
  }
  const pid = id(), now = new Date().toISOString()
  writeFileSync(join(dir, 'library', `${pid}.reach`), JSON.stringify({ id: pid, title: `Song ${String(i).padStart(4, '0')} ${pick()} ${pick()}`, kind: 'song', size: { width: 1920, height: 1080 }, slides, groups, arrangements: [], meta: { artist: 'Test', ccliNumber: String(1000000 + i) }, createdAt: now, updatedAt: now }, null, 2))
}
const items = []
for (let i = 0; i < +v; i++) {
  const name = `clip-${String(i).padStart(4, '0')}.mp4`, p = join(dir, 'media', name)
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=size=640x360:rate=24:duration=2`, '-pix_fmt', 'yuv420p', p])
  if (r.status) { console.error('ffmpeg failed'); process.exit(1) }
  items.push({ id: id(), kind: 'video', src: 'workspace:' + name, name: name.replace('.mp4', ''), behavior: 'background', loop: true, addedAt: new Date().toISOString() })
}
if (items.length) writeFileSync(join(dir, 'media', 'index.json'), JSON.stringify(items))
console.log(`generated ${n} presentations, ${v} videos in ${dir}`)
