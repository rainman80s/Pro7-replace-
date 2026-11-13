import { createHash } from 'node:crypto'
import type { Arrangement, Presentation, Slide, SlideAction, SlideGroup, TextElement } from '@shared/model'
import { DEFAULT_SIZE } from '@shared/model'
import { newImportId, parseSectionHeading } from '@shared/import-lyrics'
import { cssColor, decodePP7, idFromUuid, unknownFieldCensus, uuidOf, type PB } from './proto'
import { ConvertContext, jsonSafe } from './context'
import { convertAction, splitDisabled } from './actions'
import { convertBaseSlide, convertFill, convertTransition, transitionInfo, type ImportedElement } from './elements'
import { parseRtf } from '../rtf/rtf'
import { parsePP7Url } from './url'

export type ImportedSlide = Slide & { ext?: Record<string, unknown> }
export type ImportedGroup = SlideGroup & { ext?: Record<string, unknown> }

export interface PP7ConvertResult {
  presentation: Presentation
  ctx: ConvertContext
  /** Fields present in the file that the vendored schema doesn't know (newer ProPresenter). */
  unknownFields: Record<string, number>
  info: { uuid: string; platform?: string; appVersion?: string; slides: number; groups: number; arrangements: number; textElements: number }
}

export interface PP7ConvertOptions {
  /** Original file path, stored in meta.source.ref and used as a title fallback. */
  sourcePath?: string
  /** Library folder name (becomes meta.category when the file has none). */
  library?: string
  newId?: () => string
  /** Skip the unknown-field census (faster for bulk scans that don't need it). */
  skipCensus?: boolean
}

/** KEY_CODE_ANSI_G → "G", KEY_CODE_F5 → "F5", KEY_CODE_ANSI_KEYPAD_1 → "Num1". */
export function hotKeyOf(h: PB | undefined): string | undefined {
  const code: string | undefined = h?.code
  if (!code || code === 'KEY_CODE_UNKNOWN') return undefined
  let k = code.replace(/^KEY_CODE_/, '')
  if (k.startsWith('ANSI_KEYPAD_')) return 'Num' + titleCase(k.slice('ANSI_KEYPAD_'.length))
  k = k.replace(/^ANSI_/, '')
  const sym: Record<string, string> = {
    EQUAL: '=', MINUS: '-', RIGHT_BRACKET: ']', LEFT_BRACKET: '[', QUOTE: "'", SEMICOLON: ';', BACKSLASH: '\\', COMMA: ',', SLASH: '/',
    PERIOD: '.', GRAVE: '`', SPACE: 'Space', RETURN: 'Enter', TAB: 'Tab', DELETE: 'Backspace', ESCAPE: 'Escape',
    LEFT_ARROW: 'ArrowLeft', RIGHT_ARROW: 'ArrowRight', UP_ARROW: 'ArrowUp', DOWN_ARROW: 'ArrowDown'
  }
  if (sym[k]) return sym[k]
  if (/^[A-Z0-9]$/.test(k) || /^F\d{1,2}$/.test(k)) return k
  return titleCase(k)
}
const titleCase = (s: string): string => s.toLowerCase().replace(/(^|_)([a-z0-9])/g, (_m, _a, c: string) => c.toUpperCase())

const tsToIso = (t: PB | undefined): string | undefined => (t?.seconds > 0 ? new Date(t.seconds * 1000).toISOString() : undefined)

export function appVersionOf(info: PB | undefined): string | undefined {
  const v = info?.application_version
  if (!v) return undefined
  return [v.major_version ?? 0, v.minor_version ?? 0, v.patch_version ?? 0].join('.').replace(/(\.0)+$/, '') + (v.build ? ` (${v.build})` : '')
}

/** Notes are stored as RTF. */
function notesText(notes: PB | undefined): string | undefined {
  if (!notes?.rtf_data?.length) return undefined
  try {
    const t = parseRtf(notes.rtf_data).plain.trim()
    return t || undefined
  } catch { return undefined }
}

const SONG_GROUP = /^(verse|chorus|bridge|pre-?chorus|refrain|tag|intro|outro|ending|interlude|vamp|strophe|vers|refrain)\b/i

/** Decode a `.pro` file (rv.data.Presentation) and convert it. Throws only if the bytes are not a Presentation at all. */
export function convertPP7Presentation(bytes: Uint8Array, opts: PP7ConvertOptions = {}): PP7ConvertResult {
  const doc: PB = decodePP7('rv.data.Presentation', bytes)
  const result = convertDecodedPresentation(doc, opts)
  if (!opts.skipCensus) result.unknownFields = unknownFieldCensus('rv.data.Presentation', bytes)
  const src = result.presentation.meta.source as Record<string, unknown>
  src.hash = createHash('sha1').update(bytes).digest('hex')
  return result
}

export function convertDecodedPresentation(doc: PB, opts: PP7ConvertOptions = {}): PP7ConvertResult {
  const ctx = new ConvertContext(opts.newId ?? newImportId)
  const uuid = uuidOf(doc.uuid)
  const fileTitle = opts.sourcePath ? opts.sourcePath.split(/[\\/]/).pop()!.replace(/\.pro$/i, '') : ''
  const title = (doc.name || fileTitle || doc.ccli?.song_title || 'Untitled').trim()

  /* ── slides (cues) ── */
  const cues: PB[] = doc.cues ?? []
  const anyCueEnabledFlag = cues.some((c) => c.isEnabled !== undefined)
  const slideByUuid = new Map<string, ImportedSlide>()
  const allSlides: ImportedSlide[] = []
  const usedIds = new Set<string>()
  let size: { width: number; height: number } | undefined
  let textElements = 0
  const sizes = new Map<string, number>()
  const presBg = doc.background?.is_enabled ? convertFill({ ...doc.background, enable: true }, ctx, 'presentation background').fill : undefined

  cues.forEach((cue, ci) => {
    const where = `slide ${ci + 1}`
    let id = idFromUuid(cue.uuid, ctx.newId)
    if (usedIds.has(id)) id = ctx.newId()
    usedIds.add(id)
    const slide: ImportedSlide = { id, elements: [] }
    const ext: Record<string, unknown> = {}
    const actions: SlideAction[] = []
    let sawSlide = false
    for (const a of (cue.actions ?? []) as PB[]) {
      try {
        if (a.type === 'ACTION_TYPE_PRESENTATION_SLIDE' || (a.slide?.presentation && !a.type)) {
          if (sawSlide) { ctx.warn(`${where}: more than one slide action in a cue; kept the first`); continue }
          sawSlide = true
          const ps: PB = a.slide?.presentation ?? {}
          const conv = convertBaseSlide(ps.base_slide, ctx, where)
          slide.elements = conv.elements
          if (conv.background) slide.background = conv.background
          else if (presBg) slide.background = presBg
          if (conv.size) {
            const k = `${conv.size.width}x${conv.size.height}`
            sizes.set(k, (sizes.get(k) ?? 0) + 1)
            ext.size = conv.size
          }
          const label = a.label?.text || a.name
          if (label) slide.label = label
          const labelColor = cssColor(a.label?.color)
          if (labelColor && a.label?.text) ext.labelColor = labelColor
          const notes = notesText(ps.notes)
          if (notes) slide.notes = notes
          const tr = convertTransition(ps.transition, ctx)
          if (tr) { slide.transition = tr; ext.transition = transitionInfo(ps.transition) }
          const chart = parsePP7Url(ps.chord_chart)
          if (chart?.absolute || chart?.relative) { ext.chordChart = chart.relative ?? chart.absolute; ctx.note('slide.chordChart') }
          if (a.isEnabled === false || (a.isEnabled === undefined && anyCueEnabledFlag && cue.isEnabled === undefined)) { /* handled by cue flag below */ }
          if (a.delay_time > 0) ext.delay = a.delay_time
        } else if (a.type === 'ACTION_TYPE_PROP_SLIDE' && a.slide?.prop) {
          const conv = convertBaseSlide(a.slide.prop.base_slide, ctx, where)
          slide.elements = conv.elements
          sawSlide = true
        } else {
          const act = convertAction(a, ctx, where, id)
          if (act) actions.push(act)
        }
      } catch (e) {
        ctx.warn(`${where}: an action could not be converted (${(e as Error).message})`)
      }
    }
    if (!sawSlide && !actions.length) ctx.warn(`${where}: cue has no slide content`)
    const split = splitDisabled(actions)
    if (split.active.length) slide.actions = split.active
    if (split.disabled.length) { ext.disabledActions = split.disabled; ctx.note('action.disabled', split.disabled.length) }
    if (cue.name && !slide.label) slide.label = cue.name
    if (anyCueEnabledFlag && !cue.isEnabled) slide.enabled = false
    const hk = hotKeyOf(cue.hot_key)
    if (hk) slide.hotKey = hk
    // auto-advance: "go to next after N seconds"
    if (cue.completion_action_type === 'COMPLETION_ACTION_TYPE_AFTER_TIME' && cue.completion_time > 0 &&
        (cue.completion_target_type === 'COMPLETION_TARGET_TYPE_NEXT' || cue.completion_target_type === undefined)) {
      if (cue.completion_target_type === 'COMPLETION_TARGET_TYPE_NEXT') slide.autoAdvance = cue.completion_time
    }
    if (cue.completion_target_type && cue.completion_target_type !== 'COMPLETION_TARGET_TYPE_NONE') {
      ext.completion = { target: String(cue.completion_target_type).replace('COMPLETION_TARGET_TYPE_', '').toLowerCase(), after: String(cue.completion_action_type ?? 'COMPLETION_ACTION_TYPE_FIRST').replace('COMPLETION_ACTION_TYPE_', '').toLowerCase(), time: cue.completion_time || undefined, targetId: idFromUuid(cue.completion_target_uuid, () => '') || undefined }
      if (!slide.autoAdvance) ctx.note(`cue.completion.${(ext.completion as { target: string }).target}`)
    }
    if (cue.trigger_time?.time > 0) { ext.timecode = cue.trigger_time.time; ctx.note('cue.timecodeTrigger') }
    if (Object.keys(ext).length) slide.ext = ext
    textElements += slide.elements.filter((e) => e.type === 'text').length
    allSlides.push(slide)
    slideByUuid.set(uuidOf(cue.uuid).toLowerCase(), slide)
  })

  // presentation size = the most common slide size
  let bestN = 0
  for (const [k, n] of sizes) if (n > bestN) { bestN = n; const [w, h] = k.split('x').map(Number); size = { width: w, height: h } }
  if (sizes.size > 1) ctx.warn(`slides use ${sizes.size} different sizes (${[...sizes.keys()].join(', ')}); the presentation uses ${size!.width}x${size!.height}`)
  for (const s of allSlides) {
    const es = s.ext?.size as { width: number; height: number } | undefined
    if (es && size && es.width === size.width && es.height === size.height) { delete s.ext!.size; if (!Object.keys(s.ext!).length) delete s.ext }
  }

  /* ── groups ── */
  const groups: ImportedGroup[] = []
  const groupByUuid = new Map<string, ImportedGroup>()
  const ordered: ImportedSlide[] = []
  const placed = new Set<ImportedSlide>()
  for (const cg of (doc.cue_groups ?? []) as PB[]) {
    const g: PB = cg.group ?? {}
    let gid = idFromUuid(g.uuid, ctx.newId)
    if (groups.some((x) => x.id === gid)) gid = ctx.newId()
    const members: ImportedSlide[] = []
    for (const u of (cg.cue_identifiers ?? []) as PB[]) {
      const s = slideByUuid.get(uuidOf(u).toLowerCase())
      if (!s) { ctx.warn(`group "${g.name ?? ''}" references a missing slide ${uuidOf(u)}`); continue }
      if (placed.has(s)) { ctx.note('group.sharedSlide'); continue }
      placed.add(s)
      members.push(s)
    }
    ordered.push(...members)
    const group: ImportedGroup = { id: gid, name: g.name ?? '', slideIds: members.map((s) => s.id) }
    const color = cssColor(g.color)
    if (color) group.color = color
    const gext: Record<string, unknown> = {}
    const ghk = hotKeyOf(g.hotKey)
    if (ghk) gext.hotKey = ghk
    if (g.application_group_name) gext.globalGroup = { id: idFromUuid(g.application_group_identifier, () => '') || undefined, name: g.application_group_name }
    if (Object.keys(gext).length) group.ext = gext
    groupByUuid.set(uuidOf(g.uuid).toLowerCase(), group)
    // An unnamed group is ProPresenter's way of holding "ungrouped" slides: keep the slides, skip the group unless referenced.
    groups.push(group)
  }
  for (const s of allSlides) if (!placed.has(s)) ordered.push(s)

  /* ── arrangements ── */
  const arrangements: Arrangement[] = []
  for (const a of (doc.arrangements ?? []) as PB[]) {
    const ids: string[] = []
    for (const u of (a.group_identifiers ?? []) as PB[]) {
      const g = groupByUuid.get(uuidOf(u).toLowerCase())
      if (g) ids.push(g.id)
      else ctx.warn(`arrangement "${a.name ?? ''}" references a missing group ${uuidOf(u)}`)
    }
    arrangements.push({ id: idFromUuid(a.uuid, ctx.newId), name: a.name || 'Arrangement', groupIds: ids })
  }
  const referenced = new Set(arrangements.flatMap((a) => a.groupIds))
  // Drop unnamed, unreferenced groups (their slides stay, ungrouped) — they add nothing for the operator.
  const keptGroups = groups.filter((g) => g.name.trim() || referenced.has(g.id))
  const selected = groupByUuid.size ? idFromUuid(doc.selected_arrangement, () => '') : ''
  const activeArrangementId = arrangements.find((a) => a.id === selected)?.id

  /* ── roles: first text box = main text, second = translation (ProPresenter's convention) ── */
  const ccli: PB = doc.ccli ?? {}
  const looksLikeSong = !!(ccli.song_number || ccli.song_title || ccli.author) || keptGroups.some((g) => SONG_GROUP.test(g.name) || parseSectionHeading(g.name))
  const kind: Presentation['kind'] = doc.bible_reference?.book_name ? 'scripture'
    : doc.content_destination === 'CONTENT_DESTINATION_ANNOUNCEMENTS' ? 'announcement'
    : looksLikeSong ? 'song' : 'generic'
  const mainRole = kind === 'song' ? 'lyrics' : 'body'
  for (const s of ordered) assignRoles(s.elements as ImportedElement[], mainRole)

  /* ── metadata ── */
  const meta: Presentation['meta'] = {}
  if (ccli.author) meta.author = ccli.author
  if (ccli.artist_credits) meta.artist = ccli.artist_credits
  if (ccli.publisher) meta.publisher = ccli.publisher
  if (ccli.copyright_year || ccli.publisher) {
    const pub = String(ccli.publisher ?? '').trim()
    const yearInPub = ccli.copyright_year && pub.includes(String(ccli.copyright_year))
    meta.copyright = yearInPub ? `© ${pub.replace(/^©\s*/, '')}` : [ccli.copyright_year ? `© ${ccli.copyright_year}` : '', pub].filter(Boolean).join(' ')
  }
  if (ccli.song_number) meta.ccliNumber = String(ccli.song_number)
  if (ccli.song_title && ccli.song_title !== title) meta.songTitle = ccli.song_title
  if (ccli.album) meta.album = ccli.album
  if (ccli.copyright_year) meta.copyrightYear = ccli.copyright_year
  if (ccli.display !== undefined) meta.ccliDisplay = !!ccli.display
  if (doc.category) meta.category = doc.category
  else if (opts.library) meta.category = opts.library
  if (doc.notes) meta.notes = doc.notes
  const key = doc.music?.user_music_key || doc.music?.original_music_key || doc.music_key
  if (key) meta.key = key
  if (doc.bible_reference?.book_name) meta.bibleReference = jsonSafe(doc.bible_reference)
  const tr = convertTransition(doc.transition, ctx)
  if (tr) meta.transition = tr

  const source: Record<string, unknown> = {
    type: 'propresenter7', ref: opts.sourcePath, uuid: uuid || undefined, importedAt: new Date().toISOString(),
    app: appVersionOf(doc.application_info), platform: doc.application_info?.platform ? String(doc.application_info.platform).replace('PLATFORM_', '').toLowerCase() : undefined,
    library: opts.library, lastUsed: tsToIso(doc.last_date_used), modified: tsToIso(doc.last_modified_date)
  }
  if (doc.transition) source.transition = transitionInfo(doc.transition)
  if (doc.timeline && ((doc.timeline.cues?.length ?? 0) + (doc.timeline.cues_v2?.length ?? 0) > 0 || doc.timeline.audio_action)) {
    source.timeline = jsonSafe({ duration: doc.timeline.duration, loop: doc.timeline.loop, cues: doc.timeline.cues_v2?.length ? doc.timeline.cues_v2 : doc.timeline.cues })
    ctx.note('presentation.timeline')
  }
  if (doc.slide_show_duration > 0) { source.slideShowDuration = doc.slide_show_duration; for (const s of ordered) if (!s.autoAdvance) s.autoAdvance = doc.slide_show_duration }
  if (doc.multi_tracks_licensing) { source.multiTracks = jsonSafe({ song: doc.multi_tracks_licensing.song_identifier, subscription: doc.multi_tracks_licensing.subscription }); ctx.note('presentation.multiTracksLicensing') }
  const chart = parsePP7Url(doc.chord_chart)
  if (chart?.absolute || chart?.relative) source.chordChart = chart.relative ?? chart.absolute
  if (ctx.unmappedActions.length) source.unmapped = ctx.unmappedActions
  for (const k of Object.keys(source)) if (source[k] === undefined) delete source[k]
  meta.source = source as Presentation['meta']['source']

  const now = new Date().toISOString()
  const presentation: Presentation = {
    id: idFromUuid(uuid, ctx.newId), title, kind, size: size ?? { ...DEFAULT_SIZE },
    slides: ordered, groups: keptGroups, arrangements, activeArrangementId, meta,
    createdAt: tsToIso(doc.last_modified_date) ?? now, updatedAt: now
  }
  return {
    presentation, ctx, unknownFields: {},
    info: {
      uuid, platform: source.platform as string | undefined, appVersion: source.app as string | undefined,
      slides: ordered.length, groups: keptGroups.length, arrangements: arrangements.length, textElements
    }
  }
}

/** Assign semantic roles to a slide's text boxes (in ProPresenter's front-first order = reverse of our array). */
export function assignRoles(elements: ImportedElement[], mainRole: string): void {
  const texts = elements.filter((e): e is TextElement & ImportedElement => e.type === 'text' && !e.dynamic).reverse()
  const withText = texts.filter((t) => t.paragraphs.some((p) => p.runs.some((r) => r.text.trim())))
  const pool = withText.length ? withText : texts.slice(0, 1)
  let mainTaken = pool.some((t) => t.role === mainRole)
  let translationTaken = pool.some((t) => t.role === 'translation')
  for (const t of pool) {
    if (t.role) continue
    if (!mainTaken) { t.role = mainRole; mainTaken = true }
    else if (!translationTaken && mainRole === 'lyrics' && withText.length) { t.role = 'translation'; translationTaken = true }
  }
}

/** Stable fingerprint of the user-visible content; lets re-import tell "untouched since import" from "edited in Reach". */
export function contentFingerprint(p: Presentation): string {
  const h = createHash('sha1')
  h.update(JSON.stringify([p.title, p.slides, p.groups, p.arrangements, p.size]))
  return h.digest('hex')
}
