#!/usr/bin/env node
/**
 * Build the optional DeckLink addon (native/decklink) for THIS project's Electron version.
 *
 *   DECKLINK_SDK_DIR="/path/to/Blackmagic DeckLink SDK 14.x/Mac/include" npm run build:decklink
 *
 * Uses node-gyp (MIT) with Electron's headers, which is what @electron/rebuild does under the hood.
 * The SDK is never copied into the repo. Output: native/decklink/build/Release/reach_decklink.node
 * (picked up in dev, and copied into the packaged app by electron-builder's extraResources).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const fail = (msg) => { console.error(`\n✖ ${msg}\n`); process.exit(1) }

if (process.platform === 'win32') fail('The DeckLink addon is macOS-first; Windows is not implemented yet.')
const sdk = process.env.DECKLINK_SDK_DIR
if (!sdk) fail('Set DECKLINK_SDK_DIR to the SDK’s include folder, e.g.\n  DECKLINK_SDK_DIR="$HOME/Downloads/Blackmagic DeckLink SDK 14.4/Mac/include" npm run build:decklink')
for (const f of ['DeckLinkAPI.h', 'DeckLinkAPIDispatch.cpp', 'DeckLinkAPIVersion.h']) {
  if (!existsSync(join(sdk, f))) fail(`${f} not found in DECKLINK_SDK_DIR (${sdk}).\nPoint it at the SDK’s ${process.platform === 'darwin' ? 'Mac' : 'Linux'}/include folder.`)
}
if (process.platform === 'darwin' && !existsSync('/Library/Frameworks/DeckLinkAPI.framework')) {
  console.warn('⚠ Blackmagic Desktop Video does not seem to be installed (/Library/Frameworks/DeckLinkAPI.framework is missing).\n  The addon will build, but Reach will say “DeckLink driver not installed” until you install it.')
}

// gyp/make can't take spaces ("Blackmagic DeckLink SDK 16.0") or absolute paths in sources (make builds an
// object path like obj.target/reach_decklink//Users/... and fails). Always go through a symlink next to
// binding.gyp and hand gyp the RELATIVE path.
const link = join(root, 'native/decklink/.sdk')
try { rmSync(link, { force: true, recursive: false }) } catch { /* not there */ }
symlinkSync(resolve(sdk), link, 'dir')
const sdkDir = '.sdk'

const electronVersion = JSON.parse(readFileSync(join(root, 'node_modules/electron/package.json'), 'utf8')).version
const arch = process.env.npm_config_arch || process.arch
let gyp
try { gyp = require.resolve('node-gyp/bin/node-gyp.js') } catch { fail('node-gyp is missing: run npm install first.') }

console.log(`Building DeckLink addon for Electron ${electronVersion} (${arch}) against ${sdk}`)
const r = spawnSync(process.execPath, [
  gyp, 'rebuild', `--directory=${join(root, 'native/decklink')}`,
  `--target=${electronVersion}`, `--arch=${arch}`, '--dist-url=https://electronjs.org/headers', '--runtime=electron', '--build-from-source'
], { stdio: 'inherit', env: { ...process.env, DECKLINK_SDK_DIR: sdkDir } })
if (r.status !== 0) fail('Build failed. See docs/decklink.md → “If the build fails”.')

const out = join(root, 'native/decklink/build/Release/reach_decklink.node')
if (!existsSync(out)) fail(`Build finished but ${out} is missing.`)
console.log(`\n✔ Built ${out}\n  Restart Reach (npm run dev) and open Displays → SDI outputs.`)
