/**
 * Best-effort probe of database files found in a ProPresenter 22+ workspace. We do NOT know RV's schema; this
 * only reports what is there (tables, row counts, and whether blobs decode as ProPresenter protobuf messages),
 * so the tech lead's first diagnostic run tells us what we are dealing with. Uses Node's built-in `node:sqlite`
 * when the runtime has it; otherwise reports the header only.
 */
import { promises as fs } from 'node:fs'
import { isPresentationBytes, looksLikeMessage } from '../pp7/proto'

type SqliteDb = { prepare(sql: string): { all(...a: unknown[]): Record<string, unknown>[] }; close(): void }

function openSqlite(path: string): SqliteDb | null {
  try {
    const mod = (process as unknown as { getBuiltinModule?: (n: string) => unknown }).getBuiltinModule?.('node:sqlite') as { DatabaseSync?: new (p: string, o?: unknown) => SqliteDb } | undefined
    if (!mod?.DatabaseSync) return null
    return new mod.DatabaseSync(path, { readOnly: true })
  } catch { return null }
}

const MESSAGE_TYPES = ['rv.data.Presentation', 'rv.data.PlaylistDocument', 'rv.data.Template.Document', 'rv.data.MacrosDocument', 'rv.data.Stage.Document']

/** Returns a one-paragraph description. */
export async function probeDatabase(path: string, kind: string): Promise<string> {
  if (kind !== 'sqlite' && !/\.(sqlite3?|db3?|sqlitedb)$/i.test(path)) return `${kind} store (not inspected)`
  const fh = await fs.open(path, 'r')
  const hdr = Buffer.alloc(16)
  await fh.read(hdr, 0, 16, 0)
  await fh.close()
  if (!hdr.toString('latin1').startsWith('SQLite format 3')) return 'not an SQLite file'
  const db = openSqlite(path)
  if (!db) return 'SQLite database (this runtime cannot open it; run pp7-inspect with Node 22.5+)'
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => String(r.name))
    const parts: string[] = []
    let presBlobs = 0
    for (const t of tables.slice(0, 60)) {
      const q = `"${t.replace(/"/g, '""')}"`
      let rows = 0
      try { rows = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${q}`).all()[0]?.n ?? 0) } catch { /* ignore */ }
      const cols = db.prepare(`PRAGMA table_info(${q})`).all().map((c) => `${c.name}:${c.type}`)
      const hits: Record<string, number> = {}
      try {
        for (const row of db.prepare(`SELECT * FROM ${q} LIMIT 25`).all()) {
          for (const v of Object.values(row)) {
            if (v instanceof Uint8Array && v.length > 8) for (const m of MESSAGE_TYPES) if (looksLikeMessage(m, v)) { hits[m] = (hits[m] ?? 0) + 1; if (m === 'rv.data.Presentation') { if (isPresentationBytes(v)) presBlobs++; else continue } ; break }
          }
        }
      } catch { /* ignore */ }
      const h = Object.entries(hits).map(([m, n]) => `${m.replace('rv.data.', '')}×${n}`).join(',')
      parts.push(`${t}(${rows} rows; ${cols.slice(0, 12).join(' ')}${h ? `; blobs: ${h}` : ''})`)
    }
    return `SQLite: ${tables.length} tables. Presentation blobs: ${presBlobs}. ${parts.join(' | ')}`
  } finally { db.close() }
}

/** Experimental: pull blobs that decode as rv.data.Presentation out of an SQLite file. */
export function extractPresentationBlobs(path: string, limit = 100000): { key: string; bytes: Uint8Array }[] {
  const db = openSqlite(path)
  if (!db) return []
  const out: { key: string; bytes: Uint8Array }[] = []
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => String(r.name))
    for (const t of tables) {
      const q = `"${t.replace(/"/g, '""')}"`
      let i = 0
      for (const row of db.prepare(`SELECT rowid AS __rowid, * FROM ${q}`).all()) {
        for (const [col, v] of Object.entries(row)) {
          if (v instanceof Uint8Array && v.length > 8 && isPresentationBytes(v)) out.push({ key: `${t}/${row.__rowid ?? i}/${col}`, bytes: v })
        }
        i++
        if (out.length >= limit) return out
      }
    }
  } catch { /* ignore */ } finally { db.close() }
  return out
}
