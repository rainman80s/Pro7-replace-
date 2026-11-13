/**
 * Planning Center Services API client (JSON:API 1.0, https://developer.planning.center/docs/#/apps/services).
 * Auth today: Personal Access Token (application id + secret, HTTP Basic). The auth is a small
 * strategy object so OAuth 2 (PKCE) can be added without touching callers — see docs/integrations/planning-center.md.
 */
import type { PcoArrangement, PcoItem, PcoPerson, PcoPlan, PcoPlanSummary, PcoServiceType, PcoTime } from '@shared/integrations'
import { HttpClient } from '../integrations/http'

export type PcoAuth =
  | { type: 'pat'; appId: string; secret: string }
  | { type: 'oauth'; accessToken: string; refreshToken?: string; expiresAt?: number }

export const PCO_API = (): string => process.env.REACH_PCO_API || 'https://api.planningcenteronline.com'

interface JResource { type: string; id: string; attributes?: Record<string, unknown>; relationships?: Record<string, { data: null | { type: string; id: string } | { type: string; id: string }[] }>; links?: Record<string, string> }
interface JDoc { data: JResource | JResource[]; included?: JResource[]; links?: { next?: string }; meta?: { total_count?: number; next?: { offset: number } } }

export function authHeader(auth: PcoAuth): Record<string, string> {
  return auth.type === 'pat'
    ? { authorization: 'Basic ' + Buffer.from(`${auth.appId}:${auth.secret}`).toString('base64') }
    : { authorization: `Bearer ${auth.accessToken}` }
}

const str = (v: unknown): string | undefined => (v === null || v === undefined || v === '' ? undefined : String(v))

export function htmlToText(html: string | undefined): string | undefined {
  if (!html) return undefined
  const t = html
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return t || undefined
}

function toTime(r: JResource): PcoTime {
  const a = r.attributes ?? {}
  return { id: r.id, type: (a.time_type as PcoTime['type']) ?? 'other', name: str(a.name), startsAt: String(a.starts_at ?? ''), endsAt: str(a.ends_at) }
}

const seqList = (v: unknown): string[] | undefined => (Array.isArray(v) && v.length ? v.map(String) : undefined)

export class PcoClient {
  http: HttpClient
  constructor(auth: PcoAuth | (() => PcoAuth), opts: { baseUrl?: string; backoff?: number; maxRetryWait?: number } = {}) {
    this.http = new HttpClient({
      name: 'Planning Center',
      baseUrl: (opts.baseUrl ?? PCO_API()) + '/services/v2',
      headers: () => authHeader(typeof auth === 'function' ? auth() : auth),
      // PCO allows 100 requests / 20 s per user; stay well under and honour Retry-After on 429.
      perSecond: 4, backoff: opts.backoff, maxRetryWait: opts.maxRetryWait
    })
  }

  /** Follows JSON:API pagination (links.next / meta.next.offset) and merges `included`. */
  private async all(path: string, query: Record<string, string | number | undefined>, max = 2000): Promise<{ data: JResource[]; included: Map<string, JResource> }> {
    const data: JResource[] = []
    const included = new Map<string, JResource>()
    let offset = 0
    for (;;) {
      const doc = await this.http.get<JDoc>(path, { per_page: 100, ...query, offset: offset || undefined })
      const page = Array.isArray(doc.data) ? doc.data : [doc.data]
      data.push(...page)
      for (const inc of doc.included ?? []) included.set(`${inc.type}:${inc.id}`, inc)
      const next = doc.meta?.next?.offset
      if (!next || !page.length || data.length >= max) break
      offset = next
    }
    return { data, included }
  }

  async organization(): Promise<string> {
    const doc = await this.http.get<JDoc>('')
    const d = Array.isArray(doc.data) ? doc.data[0] : doc.data
    return String(d?.attributes?.name ?? 'Planning Center')
  }

  async serviceTypes(): Promise<PcoServiceType[]> {
    const { data } = await this.all('/service_types', { order: 'sequence' })
    return data
      .filter((r) => !r.attributes?.archived_at && !r.attributes?.deleted_at)
      .map((r) => ({ id: r.id, name: String(r.attributes?.name ?? ''), sequence: Number(r.attributes?.sequence ?? 0) }))
  }

  private toPlan(r: JResource, serviceTypeId: string, included: Map<string, JResource>): PcoPlanSummary {
    const a = r.attributes ?? {}
    const rel = r.relationships?.plan_times?.data
    const times = (Array.isArray(rel) ? rel : []).map((x) => included.get(`PlanTime:${x.id}`)).filter((x): x is JResource => !!x).map(toTime)
      .sort((x, y) => x.startsAt.localeCompare(y.startsAt))
    return {
      id: r.id, serviceTypeId, title: str(a.title), seriesTitle: str(a.series_title), dates: String(a.dates ?? a.short_dates ?? ''),
      sortDate: String(a.sort_date ?? ''), updatedAt: str(a.updated_at), itemsCount: a.items_count as number | undefined,
      url: str(a.planning_center_url) ?? r.links?.html ?? `https://services.planningcenteronline.com/plans/${r.id}`, times
    }
  }

  async plans(serviceTypeId: string, filter: 'future' | 'past' = 'future', count = 8): Promise<PcoPlanSummary[]> {
    const doc = await this.http.get<JDoc>(`/service_types/${serviceTypeId}/plans`, {
      filter, order: filter === 'future' ? 'sort_date' : '-sort_date', per_page: count, include: 'plan_times'
    })
    const included = new Map((doc.included ?? []).map((i) => [`${i.type}:${i.id}`, i]))
    return (Array.isArray(doc.data) ? doc.data : [doc.data]).map((r) => this.toPlan(r, serviceTypeId, included))
  }

  async plan(serviceTypeId: string, planId: string): Promise<PcoPlan> {
    const base = `/service_types/${serviceTypeId}/plans/${planId}`
    const [doc, itemsRes, peopleRes, timesRes] = await Promise.all([
      this.http.get<JDoc>(base),
      this.all(`${base}/items`, { include: 'song,arrangement,key,item_notes' }),
      this.all(`${base}/team_members`, { include: 'team' }),
      this.all(`${base}/plan_times`, {})
    ])
    const summary = this.toPlan(doc.data as JResource, serviceTypeId, new Map())
    summary.times = timesRes.data.map(toTime).sort((x, y) => x.startsAt.localeCompare(y.startsAt))
    const inc = itemsRes.included
    const one = (r: JResource, name: string, type: string): JResource | undefined => {
      const d = r.relationships?.[name]?.data
      return d && !Array.isArray(d) ? inc.get(`${type}:${d.id}`) : undefined
    }
    const items: PcoItem[] = itemsRes.data.map((r) => {
      const a = r.attributes ?? {}
      const song = one(r, 'song', 'Song')
      const arr = one(r, 'arrangement', 'Arrangement')
      const key = one(r, 'key', 'Key')
      const notesRel = r.relationships?.item_notes?.data
      const notes = (Array.isArray(notesRel) ? notesRel : []).map((n) => inc.get(`ItemNote:${n.id}`)).filter((x): x is JResource => !!x)
        .map((n) => ({ category: String(n.attributes?.category_name ?? ''), content: String(n.attributes?.content ?? '').trim() })).filter((n) => n.content)
      const type = String(a.item_type ?? 'item') as PcoItem['type']
      return {
        id: r.id, sequence: Number(a.sequence ?? 0), type: (['header', 'song', 'media'].includes(type) ? type : 'item') as PcoItem['type'],
        title: String(a.title ?? '').trim(), length: Number(a.length ?? 0), description: str(a.description), details: htmlToText(str(a.html_details)),
        servicePosition: str(a.service_position) as PcoItem['servicePosition'],
        keyName: str(a.key_name) ?? str(key?.attributes?.starting_key), notes,
        song: song ? { id: song.id, title: String(song.attributes?.title ?? a.title ?? ''), author: str(song.attributes?.author), ccli: str(song.attributes?.ccli_number), copyright: str(song.attributes?.copyright)?.trim() } : undefined,
        arrangement: arr ? { id: arr.id, name: str(arr.attributes?.name), bpm: arr.attributes?.bpm as number | undefined, meter: str(arr.attributes?.meter), length: arr.attributes?.length as number | undefined, sequence: seqList(arr.attributes?.sequence) } : undefined,
        customSequence: seqList(a.custom_arrangement_sequence)
      }
    }).sort((x, y) => x.sequence - y.sequence)
    const STATUS: Record<string, PcoPerson['status']> = { C: 'confirmed', U: 'unconfirmed', D: 'declined', confirmed: 'confirmed', unconfirmed: 'unconfirmed', declined: 'declined' }
    const people: PcoPerson[] = peopleRes.data.map((r) => {
      const team = r.relationships?.team?.data
      const t = team && !Array.isArray(team) ? peopleRes.included.get(`Team:${team.id}`) : undefined
      return {
        name: String(r.attributes?.name ?? '').trim(), position: String(r.attributes?.team_position_name ?? '').trim(),
        team: String(t?.attributes?.name ?? ''), status: STATUS[String(r.attributes?.status ?? 'U')] ?? 'unconfirmed'
      }
    }).filter((p) => p.name)
    return { ...summary, items, people }
  }

  /** Lyrics + section sequence for importing a song that isn't in the library yet. */
  async arrangement(songId: string, arrangementId: string): Promise<PcoArrangement & { lyrics?: string; sections?: { label: string; lyrics: string }[] }> {
    const doc = await this.http.get<JDoc>(`/songs/${songId}/arrangements/${arrangementId}`)
    const r = doc.data as JResource
    const a = r.attributes ?? {}
    let sections: { label: string; lyrics: string }[] | undefined
    try {
      const s = await this.http.get<JDoc>(`/songs/${songId}/arrangements/${arrangementId}/sections`, undefined, { retries: 1 })
      const raw = (Array.isArray(s.data) ? s.data[0] : s.data)?.attributes?.sections
      if (Array.isArray(raw)) sections = raw.map((x: { label?: string; lyrics?: string }) => ({ label: String(x.label ?? ''), lyrics: String(x.lyrics ?? '') })).filter((x) => x.lyrics.trim())
    } catch { /* sections endpoint is optional — fall back to parsing `lyrics` */ }
    return { id: r.id, name: str(a.name), bpm: a.bpm as number | undefined, meter: str(a.meter), length: a.length as number | undefined, sequence: seqList(a.sequence), lyrics: str(a.lyrics) ?? str(a.chord_chart), sections }
  }

  /** PCO Services Live. These POSTs change the Live session for everyone watching it. */
  async live(serviceTypeId: string, planId: string, action: 'go_to_next_item' | 'go_to_previous_item' | 'toggle_control'): Promise<void> {
    await this.http.request(`/service_types/${serviceTypeId}/plans/${planId}/live/${action}`, { method: 'POST', retries: 0 })
  }

  /** Which item PCO Live is currently on (null if Live hasn't started). */
  async liveCurrentItemId(serviceTypeId: string, planId: string): Promise<string | null> {
    const doc = await this.http.get<JDoc>(`/service_types/${serviceTypeId}/plans/${planId}/live`, { include: 'current_item_time' }, { retries: 0 })
    const cur = (doc.included ?? []).find((i) => i.type === 'ItemTime')
    const d = cur?.relationships?.item?.data
    return d && !Array.isArray(d) ? d.id : null
  }
}
