/**
 * Write a synthetic ProPresenter folder (vendored samples + protobuf-encoded test song + media + config + a
 * ZIP64-bug bundle) for manual testing and tests/e2e-import.mjs.
 *   npx tsx scripts/make-pp7-fixtures.ts <out-dir>
 */
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildFakeProPresenterFolder } from '../tests/import/synthetic'

const out = resolve(process.argv[2] ?? 'tests/fixtures/ProPresenter')
mkdirSync(out, { recursive: true })
buildFakeProPresenterFolder(out, join(__dirname, '../vendor/pp7-samples'))
console.log(out)
