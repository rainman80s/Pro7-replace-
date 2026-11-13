// Compiles vendor/pp7-proto/autogen-proto/*.proto into one JSON descriptor that is bundled with the app,
// so the packaged app never needs .proto files at runtime.
//   node scripts/build-pp7-descriptor.mjs
import { createRequire } from 'node:module'
import { readdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const pb = require('protobufjs')

const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, '../vendor/pp7-proto/autogen-proto')
const out = join(here, '../src/main/services/importers/pp7/descriptor.json')

const root = new pb.Root()
root.resolvePath = (_origin, target) => {
  const p = join(dir, target)
  return existsSync(p) ? p : null
}
// Analytics / network-API messages are never stored in library files; leaving them out halves the bundle.
const files = readdirSync(dir).filter((f) => f.endsWith('.proto') && !/^(analytics|proApi|userFeedback|feature-flags|proCoreFeatureFlags)/.test(f))
root.loadSync(files, { keepCase: true })
root.resolveAll()
const json = root.toJSON()
delete json.options
// Drop per-field/per-message options (custom options we don't use) to shrink the output.
const strip = (n) => {
  if (!n || typeof n !== 'object') return
  if (n.options) delete n.options
  for (const k of ['nested', 'fields']) if (n[k]) for (const v of Object.values(n[k])) strip(v)
}
strip(json)
const version = readFileSync(join(dir, 'version.txt'), 'utf8').trim()
writeFileSync(out, JSON.stringify({ version, generatedFrom: 'vendor/pp7-proto/autogen-proto', descriptor: json }))
console.log(`wrote ${out} — ${files.length} proto files, version ${version}, ${(JSON.stringify(json).length / 1024).toFixed(0)} KB`)
