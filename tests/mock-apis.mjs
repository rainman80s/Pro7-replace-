// Local mock servers shaped like the real public APIs (per their docs), for e2e tests.
// Planning Center Services (JSON:API), Notion v1, the Free Use Bible API (helloao), Figma REST.
import { createServer } from 'node:http'

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

export function pcoState() {
  const t = (d, h) => new Date(Date.UTC(2030, 2, d, h)).toISOString()
  return {
    planUpdated: '2030-03-01T00:00:00Z',
    items: [
      { id: 'i1', type: 'header', title: 'Worship + Welcome', length: 0 },
      { id: 'i2', type: 'item', title: 'Call To Worship', length: 120, notes: [['Person', 'Avery']] },
      { id: 'i3', type: 'song', title: 'Doxology', length: 200, song: { id: 's1', title: 'Doxology', ccli: '' }, arrangement: { id: 'a1', name: 'Hymn', sequence: ['Verse', 'Ending'] }, notes: [['Person', 'Jordan']] },
      { id: 'i4', type: 'song', title: 'River Of Light', length: 300, song: { id: 's2', title: 'River Of Light', ccli: '7654321' }, arrangement: { id: 'a2', name: 'Live', sequence: ['V1', 'C', 'V2', 'C'], lyrics: 'VERSE 1\nLight on the water\nLight on the shore\n\nCHORUS\nRiver of light\nCarry me home\n\nVERSE 2\nMorning is breaking\nNight is no more' } },
      { id: 'i5', type: 'header', title: 'Teaching', length: 0 },
      { id: 'i6', type: 'item', title: 'Announcements', length: 180 },
      { id: 'i7', type: 'item', title: 'Message', length: 1800, notes: [['Person', 'Sam'], ['Sound', 'Lapel']] }
    ],
    times: [{ id: 't1', time_type: 'service', starts_at: t(3, 17), ends_at: t(3, 18) }, { id: 't2', time_type: 'service', starts_at: t(3, 19), ends_at: t(3, 20) }, { id: 't0', time_type: 'rehearsal', starts_at: t(1, 2) }],
    people: [{ id: 'pp1', name: 'Sam Rivers', position: 'Speaker', team: 'tm1', status: 'C' }, { id: 'pp2', name: 'Pat Moss', position: 'Drums', team: 'tm2', status: 'C' }],
    live: { currentItem: 'i1', moves: [] }
  }
}

function pco(state, req, res, url) {
  const p = url.pathname.replace(/^\/services\/v2/, '')
  if (!/^Basic /.test(req.headers.authorization ?? '')) return json(res, 401, { errors: [{ title: 'Unauthorized' }] })
  if (p === '' || p === '/') return json(res, 200, { data: { type: 'Organization', id: '1', attributes: { name: 'Test Church' } } })
  if (p === '/service_types') return json(res, 200, { data: [{ type: 'ServiceType', id: 'st1', attributes: { name: '*Sunday Gatherings', sequence: 0, archived_at: null } }, { type: 'ServiceType', id: 'st2', attributes: { name: 'Youth', sequence: 1, archived_at: null } }], meta: {} })
  const plan = { type: 'Plan', id: 'pl1', attributes: { title: 'Rivers / Psalm 46', series_title: 'Rivers', dates: 'March 3, 2030', sort_date: state.times[0].starts_at, updated_at: state.planUpdated, items_count: state.items.length }, relationships: { plan_times: { data: state.times.map((x) => ({ type: 'PlanTime', id: x.id })) } }, links: { html: 'https://services.example.test/plans/pl1' } }
  const time = (x) => ({ type: 'PlanTime', id: x.id, attributes: { time_type: x.time_type, starts_at: x.starts_at, ends_at: x.ends_at ?? null, name: null } })
  if (p === '/service_types/st1/plans') return json(res, 200, { data: [plan], included: state.times.map(time), meta: { total_count: 1 } })
  if (p === '/service_types/st1/plans/pl1') return json(res, 200, { data: plan })
  if (p === '/service_types/st1/plans/pl1/plan_times') return json(res, 200, { data: state.times.map(time), meta: {} })
  if (p === '/service_types/st1/plans/pl1/items') {
    // Paginate 4 per page to exercise meta.next.offset.
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const page = state.items.slice(offset, offset + 4)
    const included = []
    const data = page.map((it, i) => {
      const notes = (it.notes ?? []).map(([c, v], k) => { const nid = `${it.id}n${k}`; included.push({ type: 'ItemNote', id: nid, attributes: { category_name: c, content: v } }); return { type: 'ItemNote', id: nid } })
      if (it.song) included.push({ type: 'Song', id: it.song.id, attributes: { title: it.song.title, ccli_number: it.song.ccli || null, author: 'Test Author', copyright: 'Public Domain' } })
      if (it.arrangement) included.push({ type: 'Arrangement', id: it.arrangement.id, attributes: { name: it.arrangement.name, bpm: 70, meter: '4/4', length: it.length, sequence: it.arrangement.sequence } })
      return { type: 'Item', id: it.id, attributes: { title: it.title, item_type: it.type, length: it.length, sequence: offset + i + 1, service_position: 'during', description: null, html_details: null, key_name: it.song ? 'C' : null, custom_arrangement_sequence: null },
        relationships: { song: { data: it.song ? { type: 'Song', id: it.song.id } : null }, arrangement: { data: it.arrangement ? { type: 'Arrangement', id: it.arrangement.id } : null }, key: { data: null }, item_notes: { data: notes } } }
    })
    return json(res, 200, { data, included, meta: { total_count: state.items.length, ...(offset + 4 < state.items.length ? { next: { offset: offset + 4 } } : {}) } })
  }
  if (p === '/service_types/st1/plans/pl1/team_members') return json(res, 200, { data: state.people.map((x) => ({ type: 'PlanPerson', id: x.id, attributes: { name: x.name, team_position_name: x.position, status: x.status }, relationships: { team: { data: { type: 'Team', id: x.team } } } })), included: [{ type: 'Team', id: 'tm1', attributes: { name: 'Sunday Service Roles' } }, { type: 'Team', id: 'tm2', attributes: { name: 'Band' } }], meta: {} })
  const arr = /^\/songs\/(\w+)\/arrangements\/(\w+)(\/sections)?$/.exec(p)
  if (arr) {
    const it = state.items.find((x) => x.arrangement?.id === arr[2])
    if (arr[3]) return json(res, 404, { errors: [] })
    return json(res, 200, { data: { type: 'Arrangement', id: arr[2], attributes: { name: it?.arrangement.name, lyrics: it?.arrangement.lyrics ?? null, sequence: it?.arrangement.sequence ?? [] } } })
  }
  if (p === '/service_types/st1/plans/pl1/live') return json(res, 200, { data: { type: 'Live', id: 'pl1' }, included: [{ type: 'ItemTime', id: 'it1', relationships: { item: { data: { type: 'Item', id: state.live.currentItem } } } }] })
  const lv = /^\/service_types\/st1\/plans\/pl1\/live\/(go_to_next_item|go_to_previous_item)$/.exec(p)
  if (lv && req.method === 'POST') {
    const ids = state.items.map((x) => x.id)
    const i = ids.indexOf(state.live.currentItem)
    state.live.currentItem = ids[Math.max(0, Math.min(ids.length - 1, i + (lv[1] === 'go_to_next_item' ? 1 : -1)))]
    state.live.moves.push(lv[1])
    return json(res, 200, { data: {} })
  }
  return json(res, 404, { errors: [{ title: 'Not found ' + p }] })
}

/* ── Notion ── */
const rt = (text, a = {}) => [{ type: 'text', plain_text: text, text: { content: text }, annotations: { bold: false, italic: false, underline: false, strikethrough: false, code: false, color: 'default', ...a } }]
export function notionState(base) {
  let n = 0
  const B = (type, v, children) => ({ object: 'block', id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, type, has_children: !!children, [type]: v, _children: children })
  const sermon = [
    B('synced_block', { synced_from: null }, [B('heading_1', { rich_text: rt('Sermon Slide Requests') })]),
    B('heading_1', { rich_text: rt('Rivers of Mercy') }),
    B('divider', {}),
    B('paragraph', { rich_text: rt('Psalm 46:4 (BSB)') }),
    B('divider', {}),
    B('heading_2', { rich_text: rt('THREE RIVERS') }),
    B('heading_3', { rich_text: rt('1. THE RIVER OF GRACE') }),
    B('heading_3', { rich_text: rt('2. THE RIVER OF PEACE') }),
    B('divider', {}),
    B('image', { type: 'file', file: { url: `${base}/files/river.png?X-Amz-Expires=3600`, expiry_time: '2030-01-01T00:00:00Z' }, caption: [] })
  ]
  const highlights = [
    B('heading_1', { rich_text: rt('Slide 1') }),
    B('image', { type: 'file', file: { url: `${base}/files/brunch.png`, expiry_time: '2030-01-01T00:00:00Z' }, caption: [] }),
    B('bulleted_list_item', { rich_text: rt('HEADING: Family Brunch', { bold: true }) }),
    B('bulleted_list_item', { rich_text: rt('DETAILS:', { bold: true }) }, [B('bulleted_list_item', { rich_text: rt('Saturday at 10') })]),
    B('divider', {}),
    B('paragraph', { rich_text: rt('FAMILY BRUNCH', { bold: true }) }),
    B('paragraph', { rich_text: rt('Mention the sign-up link.') })
  ]
  return {
    pages: {
      'page-sermon': { id: 'page-sermon', url: 'https://notion.example.test/sermon', last_edited_time: '2030-03-01T00:00:00Z', properties: { 'Text and Passage Description': { type: 'title', title: rt('Rivers / Psalm 46') }, Date: { type: 'date', date: { start: '2030-03-03' } }, Speaker: { type: 'people', people: [{ name: 'Sam Rivers' }] }, Type: { type: 'multi_select', multi_select: [{ name: 'Sunday Service' }] } }, blocks: sermon },
      'page-hl': { id: 'page-hl', url: 'https://notion.example.test/hl', last_edited_time: '2030-03-01T00:00:00Z', properties: { Name: { type: 'title', title: rt('Sunday Highlights') }, Date: { type: 'date', date: { start: '2030-03-03' } }, Status: { type: 'status', status: { name: 'Posted/Scheduled' } } }, blocks: highlights }
    },
    dbs: [
      { object: 'database', id: 'db-services', title: rt('Services'), properties: { 'Text and Passage Description': { type: 'title' }, Date: { type: 'date' }, Speaker: { type: 'people' }, Type: { type: 'multi_select', multi_select: { options: [{ name: 'Sunday Service' }] } } } },
      { object: 'database', id: 'db-comms', title: rt('Comms Channels'), properties: { Name: { type: 'title' }, Date: { type: 'date' }, Status: { type: 'status', status: { options: [{ name: 'Posted/Scheduled' }, { name: 'Scrapped/Missed' }] } } } }
    ],
    comments: {}
  }
}
async function body(req) { const c = []; for await (const x of req) c.push(x); return c.length ? JSON.parse(Buffer.concat(c).toString()) : {} }
async function notion(state, req, res, url) {
  const p = url.pathname.replace(/^\/v1/, '')
  if (!/^Bearer /.test(req.headers.authorization ?? '') || !req.headers['notion-version']) return json(res, 401, { object: 'error', code: 'unauthorized' })
  if (p === '/users/me') return json(res, 200, { object: 'user', type: 'bot', bot: { workspace_name: 'Test Workspace' } })
  if (p === '/search') return json(res, 200, { object: 'list', results: state.dbs, has_more: false, next_cursor: null })
  const q = /^\/databases\/([\w-]+)\/query$/.exec(p)
  if (q) {
    const b = await body(req)
    const want = b.filter?.date?.equals ?? b.filter?.and?.find((x) => x.date?.equals)?.date.equals
    const pages = Object.values(state.pages).filter((pg) => (q[1] === 'db-services' ? pg.id === 'page-sermon' : pg.id === 'page-hl')).filter((pg) => !want || pg.properties.Date.date.start === want)
    return json(res, 200, { object: 'list', results: pages.map(({ blocks, ...x }) => x), has_more: false, next_cursor: null })
  }
  const pg = /^\/pages\/([\w-]+)$/.exec(p)
  if (pg) { const x = state.pages[pg[1]]; if (!x) return json(res, 404, {}); const { blocks, ...rest } = x; return json(res, 200, rest) }
  const ch = /^\/blocks\/([\w-]+)\/children$/.exec(p)
  if (ch) {
    const find = (list) => { for (const b of list) { if (b.id === ch[1]) return b._children; const r = b._children && find(b._children); if (r) return r } }
    const kids = state.pages[ch[1]]?.blocks ?? find(Object.values(state.pages).flatMap((x) => x.blocks)) ?? []
    // Two per page to exercise cursors.
    const start = Number(url.searchParams.get('start_cursor') ?? 0)
    const slice = kids.slice(start, start + 2).map(({ _children, ...b }) => b)
    return json(res, 200, { object: 'list', results: slice, has_more: start + 2 < kids.length, next_cursor: start + 2 < kids.length ? String(start + 2) : null })
  }
  if (p === '/comments') return json(res, 200, { object: 'list', results: (state.comments[url.searchParams.get('block_id')] ?? []).map((t) => ({ rich_text: rt(t), parent: { block_id: url.searchParams.get('block_id') } })), has_more: false, next_cursor: null })
  return json(res, 404, { object: 'error' })
}

/* ── Bible (helloao) ── */
function helloao(req, res, url) {
  if (url.pathname === '/api/available_translations.json') return json(res, 200, { translations: [{ id: 'BSB', name: 'Berean Standard Bible', englishName: 'Berean Standard Bible', language: 'eng', license: { publicDomain: true } }] })
  if (url.pathname === '/api/BSB/complete.json') {
    const ch = (number, verses) => ({ chapter: { number, content: verses.map((t, i) => ({ type: 'verse', number: i + 1, content: [t] })) } })
    const v = (b, c, n) => Array.from({ length: n }, (_, i) => `Test text of ${b} ${c}:${i + 1}.`)
    return json(res, 200, { translation: { id: 'BSB', name: 'Berean Standard Bible', shortName: 'BSB', language: 'eng', license: { publicDomain: true } },
      books: [{ id: 'PSA', chapters: Array.from({ length: 46 }, (_, i) => ch(i + 1, v('Psalm', i + 1, 11))) }, { id: 'JHN', chapters: [ch(1, v('John', 1, 51)), ch(2, v('John', 2, 25)), ch(3, v('John', 3, 36))] }] })
  }
  return json(res, 404, {})
}

/* ── Figma ── */
export function figmaState() {
  return {
    version: '100',
    frames: [{ id: '1:2', name: 'Welcome', w: 1920, h: 1080 }, { id: '1:3', name: 'Series Title', w: 1920, h: 1080 }, { id: '1:4', name: 'LED Top', w: 1920, h: 1080 }],
    renders: {}
  }
}
function figma(state, base, req, res, url) {
  if (!req.headers['x-figma-token']) return json(res, 403, { status: 403, err: 'Invalid token' })
  if (url.pathname === '/v1/me') return json(res, 200, { handle: 'tester', email: 'x@example.test' })
  const f = /^\/v1\/files\/(\w+)$/.exec(url.pathname)
  if (f) return json(res, 200, { name: 'Sunday Slides', version: state.version, lastModified: '2030-03-01T00:00:00Z', document: { id: '0:0', type: 'DOCUMENT', children: [{ id: '0:1', type: 'CANVAS', name: 'March 3', children: state.frames.map((x) => ({ id: x.id, type: 'FRAME', name: x.name, absoluteBoundingBox: { x: 0, y: 0, width: x.w, height: x.h }, children: [{ id: x.id + 't', type: 'TEXT', name: 'Title', characters: x.name + (state.edits?.[x.id] ?? '') }] })) }] } })
  const im = /^\/v1\/images\/(\w+)$/.exec(url.pathname)
  if (im) { const ids = url.searchParams.get('ids').split(','); return json(res, 200, { err: null, images: Object.fromEntries(ids.map((id) => [id, `${base}/files/figma-${id.replace(':', '-')}.png`])) }) }
  return json(res, 404, { status: 404, err: 'Not found' })
}

export async function startMocks() {
  const state = { pco: pcoState(), figma: figmaState(), hits: [] }
  let base = ''
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    state.hits.push(`${req.method} ${url.pathname}`)
    try {
      if (url.pathname.startsWith('/files/')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG) }
      if (url.pathname.startsWith('/services/v2')) return pco(state.pco, req, res, url)
      if (url.pathname.startsWith('/v1/') && req.headers['notion-version']) return await notion(state.notion, req, res, url)
      if (url.pathname.startsWith('/v1/')) return figma(state.figma, base, req, res, url)
      if (url.pathname.startsWith('/api/')) return helloao(req, res, url)
      json(res, 404, {})
    } catch (e) { json(res, 500, { error: String(e) }) }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
  state.notion = notionState(base)
  return {
    state, base, close: () => server.close(),
    env: { REACH_PCO_API: base, REACH_NOTION_API: `${base}/v1`, REACH_HELLOAO_API: `${base}/api`, REACH_FIGMA_API: `${base}/v1` }
  }
}
