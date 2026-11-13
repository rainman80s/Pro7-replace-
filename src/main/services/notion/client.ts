/**
 * Notion public API client (https://developers.notion.com). Internal-integration token (Bearer),
 * Notion-Version pinned, 3 requests/second, cursor pagination, recursive children.
 */
import type { NotionDbInfo, NotionMapping, NotionPageSummary } from '@shared/integrations'
import { HttpClient } from '../integrations/http'

export const NOTION_API = (): string => process.env.REACH_NOTION_API || 'https://api.notion.com/v1'
export const NOTION_VERSION = '2022-06-28'

export interface NRichText { type: string; plain_text: string; href?: string | null; annotations?: { bold?: boolean; italic?: boolean; strikethrough?: boolean; underline?: boolean; code?: boolean; color?: string } }
export interface NBlock { id: string; type: string; has_children?: boolean; archived?: boolean; in_trash?: boolean; [k: string]: unknown; children?: NBlock[] }
interface NList<T> { results: T[]; has_more: boolean; next_cursor: string | null }
export interface NPage { id: string; url?: string; last_edited_time?: string; properties: Record<string, NProp> }
export type NProp = { id?: string; type: string; [k: string]: unknown }

export const richPlain = (rt: NRichText[] | undefined): string => (rt ?? []).map((r) => r.plain_text).join('')

export class NotionClient {
  http: HttpClient
  constructor(token: string | (() => string), opts: { baseUrl?: string; backoff?: number; maxRetryWait?: number } = {}) {
    this.http = new HttpClient({
      name: 'Notion', baseUrl: opts.baseUrl ?? NOTION_API(),
      headers: () => ({ authorization: `Bearer ${typeof token === 'function' ? token() : token}`, 'notion-version': NOTION_VERSION }),
      perSecond: 3, backoff: opts.backoff, maxRetryWait: opts.maxRetryWait
    })
  }

  async me(): Promise<string> {
    const u = await this.http.get<{ name?: string; bot?: { workspace_name?: string } }>('/users/me')
    return u.bot?.workspace_name ?? u.name ?? 'Notion'
  }

  private async paged<T>(fn: (cursor?: string) => Promise<NList<T>>, max = 5000): Promise<T[]> {
    const out: T[] = []
    let cursor: string | undefined
    do {
      const r = await fn(cursor)
      out.push(...r.results)
      cursor = r.has_more && r.next_cursor ? r.next_cursor : undefined
    } while (cursor && out.length < max)
    return out
  }

  /** Databases shared with the integration. */
  async databases(): Promise<NotionDbInfo[]> {
    const res = await this.paged<{ id: string; url?: string; title?: NRichText[]; properties?: Record<string, NProp & { select?: { options?: { name: string }[] }; multi_select?: { options?: { name: string }[] }; status?: { options?: { name: string }[] } }> }>((cursor) =>
      this.http.request('/search', { method: 'POST', body: { filter: { property: 'object', value: 'database' }, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) } }), 500)
    return res.map((d) => ({
      id: d.id, url: d.url, title: richPlain(d.title) || 'Untitled database',
      properties: Object.entries(d.properties ?? {}).map(([name, p]) => ({ name, type: p.type, options: (p.select ?? p.multi_select ?? p.status)?.options?.map((o) => o.name) }))
    }))
  }

  async database(id: string): Promise<NotionDbInfo> {
    const d = await this.http.get<{ id: string; url?: string; title?: NRichText[]; properties?: Record<string, NProp> }>(`/databases/${id}`)
    return { id: d.id, url: d.url, title: richPlain(d.title), properties: Object.entries(d.properties ?? {}).map(([name, p]) => ({ name, type: p.type })) }
  }

  async query(m: NotionMapping, opts: { date?: string; from?: string; to?: string; limit?: number } = {}): Promise<NPage[]> {
    const and: unknown[] = []
    if (m.date && opts.date) and.push({ property: m.date, date: { equals: opts.date } })
    if (m.date && opts.from) and.push({ property: m.date, date: { on_or_after: opts.from } })
    if (m.date && opts.to) and.push({ property: m.date, date: { on_or_before: opts.to } })
    const body: Record<string, unknown> = { page_size: Math.min(100, opts.limit ?? 100) }
    if (and.length) body.filter = and.length === 1 ? and[0] : { and }
    if (m.date) body.sorts = [{ property: m.date, direction: opts.date || opts.from ? 'ascending' : 'descending' }]
    return this.paged<NPage>((cursor) => this.http.request(`/databases/${m.databaseId}/query`, { method: 'POST', body: { ...body, ...(cursor ? { start_cursor: cursor } : {}) } }), opts.limit ?? 200)
  }

  async page(id: string): Promise<NPage> {
    return this.http.get<NPage>(`/pages/${id}`)
  }

  /** All blocks of a page, children nested (depth-limited). Synced-block references resolve to their original. */
  async blocks(id: string, depth = 0): Promise<NBlock[]> {
    const list = await this.paged<NBlock>((cursor) => this.http.get(`/blocks/${id}/children`, { page_size: 100, start_cursor: cursor }))
    const out: NBlock[] = []
    for (const b of list) {
      if (b.archived || b.in_trash) continue
      if (b.has_children && depth < 6 && b.type !== 'child_page' && b.type !== 'child_database') {
        const synced = b.type === 'synced_block' ? (b.synced_block as { synced_from?: { block_id?: string } | null })?.synced_from?.block_id : undefined
        try { b.children = await this.blocks(synced ?? b.id, depth + 1) } catch { b.children = [] } // original not shared with us
      }
      out.push(b)
    }
    return out
  }

  async comments(blockId: string): Promise<{ text: string; blockId: string }[]> {
    const list = await this.paged<{ rich_text: NRichText[]; parent?: { block_id?: string; page_id?: string } }>((cursor) => this.http.get('/comments', { block_id: blockId, page_size: 100, start_cursor: cursor }, { retries: 1 }), 500)
    return list.map((c) => ({ text: richPlain(c.rich_text).trim(), blockId: c.parent?.block_id ?? blockId })).filter((c) => c.text)
  }
}

/* ───────────── properties ───────────── */

export function propText(p: NProp | undefined): string | undefined {
  if (!p) return undefined
  switch (p.type) {
    case 'title': case 'rich_text': return richPlain(p[p.type] as NRichText[]).trim() || undefined
    case 'select': case 'status': return (p[p.type] as { name?: string } | null)?.name
    case 'multi_select': return ((p.multi_select as { name: string }[]) ?? []).map((o) => o.name).join(', ') || undefined
    case 'date': return (p.date as { start?: string } | null)?.start
    case 'people': return ((p.people as { name?: string }[]) ?? []).map((u) => u.name).filter(Boolean).join(', ') || undefined
    case 'number': return p.number == null ? undefined : String(p.number)
    case 'url': case 'email': case 'phone_number': return (p[p.type] as string | null) ?? undefined
    case 'checkbox': return p.checkbox ? 'Yes' : 'No'
    case 'formula': { const f = p.formula as { type: string; [k: string]: unknown }; return f ? String(f[f.type] ?? '') || undefined : undefined }
    case 'rollup': { const r = p.rollup as { type: string; array?: NProp[]; number?: number }; return r?.type === 'array' ? r.array?.map(propText).filter(Boolean).join(', ') : r?.number != null ? String(r.number) : undefined }
    case 'relation': return undefined
    default: return undefined
  }
}
export const propList = (p: NProp | undefined): string[] => {
  if (!p) return []
  if (p.type === 'multi_select') return ((p.multi_select as { name: string }[]) ?? []).map((o) => o.name)
  if (p.type === 'people') return ((p.people as { name?: string }[]) ?? []).map((u) => u.name ?? '').filter(Boolean)
  const t = propText(p)
  return t ? [t] : []
}

export function titleProp(page: NPage): string {
  const t = Object.values(page.properties).find((p) => p.type === 'title')
  return propText(t) ?? 'Untitled'
}

export function summarize(page: NPage, m: NotionMapping): NotionPageSummary {
  const pr = page.properties
  return {
    id: page.id, url: page.url, lastEdited: page.last_edited_time,
    title: (m.title && propText(pr[m.title])) || titleProp(page),
    date: m.date ? propText(pr[m.date])?.slice(0, 10) : undefined,
    speaker: m.speaker ? propList(pr[m.speaker]) : undefined,
    status: m.status ? propText(pr[m.status]) : undefined,
    series: m.series ? propText(pr[m.series]) : undefined
  }
}

export function pageMatches(page: NPage, m: NotionMapping): boolean {
  if (m.filterProp && m.filterValue) {
    const vals = propList(page.properties[m.filterProp]).map((v) => v.trim().toLowerCase())
    if (!vals.includes(m.filterValue.trim().toLowerCase())) return false
  }
  if (m.titleContains && !titleProp(page).toLowerCase().includes(m.titleContains.toLowerCase())) return false
  if (m.excludeStatus?.length && m.status) {
    const st = propText(page.properties[m.status])?.toLowerCase()
    if (st && m.excludeStatus.some((x) => x.toLowerCase() === st)) return false
  }
  return true
}

/** Guess which databases/properties are sermons vs announcements (tuned on Reach's real workspace, works generically). */
export function autoDetect(dbs: NotionDbInfo[]): { sermons?: NotionMapping; announcements?: NotionMapping } {
  const prop = (db: NotionDbInfo, types: string[], re?: RegExp): string | undefined => {
    const ps = db.properties.filter((p) => types.includes(p.type))
    return (re ? ps.find((p) => re.test(p.name)) : undefined)?.name ?? (re && types.length > 1 ? undefined : ps[0]?.name)
  }
  const mapping = (db: NotionDbInfo): NotionMapping => ({
    databaseId: db.id,
    title: prop(db, ['title']),
    date: prop(db, ['date'], /^(date|service date|sunday|event\/comm date)$/i) ?? prop(db, ['date']),
    speaker: prop(db, ['people', 'rich_text', 'select'], /speaker|preacher|pastor|teacher/i),
    status: prop(db, ['status', 'select'], /status|stage/i),
    series: prop(db, ['relation', 'select', 'rich_text'], /series/i)
  })
  const score = (db: NotionDbInfo, re: RegExp): number => (re.test(db.title) ? 10 : 0) + (db.properties.some((p) => p.type === 'date') ? 3 : 0) + (db.properties.some((p) => /speaker/i.test(p.name)) ? 1 : 0)
  const ranked = (re: RegExp): NotionDbInfo[] => dbs.filter((d) => re.test(d.title)).sort((a, b) => score(b, re) - score(a, re))
  const sermonDb = ranked(/sermon|message|preach|^services?$|teaching/i)[0]
  const annDb = ranked(/announce|highlight|comms|bulletin|news/i).find((d) => d.id !== sermonDb?.id)
  const out: { sermons?: NotionMapping; announcements?: NotionMapping } = {}
  if (sermonDb) {
    out.sermons = mapping(sermonDb)
    const type = sermonDb.properties.find((p) => /^type$/i.test(p.name) && p.options?.some((o) => /sunday/i.test(o)))
    if (type) { out.sermons.filterProp = type.name; out.sermons.filterValue = type.options!.find((o) => /sunday/i.test(o)) }
  }
  if (annDb) {
    out.announcements = mapping(annDb)
    const ch = annDb.properties.find((p) => /channel/i.test(p.name) && p.options?.some((o) => /sunday highlight|slide|screen/i.test(o)))
    if (/comms/i.test(annDb.title)) out.announcements.titleContains = 'Highlight'
    else if (ch) { out.announcements.filterProp = ch.name; out.announcements.filterValue = ch.options!.find((o) => /sunday highlight|slide|screen/i.test(o)) }
    const st = annDb.properties.find((p) => p.name === out.announcements!.status)
    const dead = st?.options?.filter((o) => /scrap|cancel|missed|archiv/i.test(o))
    if (dead?.length) out.announcements.excludeStatus = dead
  }
  return out
}
