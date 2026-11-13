import type { SlideAction } from '@shared/model'
import { idFromUuid, uuidOf, type PB } from './proto'
import type { ConvertContext } from './context'
import { jsonSafe } from './context'
import { convertMedia, transitionInfo } from './elements'
import { parsePP7Url } from './url'
import { round3 } from './text'

/** rv.data.CollectionElementType → { id, name, collection } */
export function identOf(c: PB | undefined): { id?: string; name?: string; collection?: string } {
  if (!c) return {}
  const id = idFromUuid(c.parameter_uuid, () => '')
  return { id: id || undefined, name: c.parameter_name || undefined, collection: c.parent_collection?.parameter_name || undefined }
}

const CLEAR_LAYERS: Record<string, string> = {
  CLEAR_TARGET_LAYER_ALL: 'all', CLEAR_TARGET_LAYER_AUDIO: 'audio', CLEAR_TARGET_LAYER_BACKGROUND: 'background',
  CLEAR_TARGET_LAYER_LIVE_VIDEO: 'video', CLEAR_TARGET_LAYER_PROP: 'props', CLEAR_TARGET_LAYER_SLIDE: 'slide',
  CLEAR_TARGET_LAYER_LOGO: 'logo', CLEAR_TARGET_LAYER_MESSAGES: 'message', CLEAR_TARGET_LAYER_AUDIO_EFFECTS: 'audioEffects'
}
export const clearLayerName = (l: string | undefined): string => CLEAR_LAYERS[l ?? 'CLEAR_TARGET_LAYER_ALL'] ?? 'all'

export function timerConfig(cfg: PB | undefined): Record<string, unknown> {
  if (!cfg) return {}
  const out: Record<string, unknown> = {}
  if (cfg.countdown) { out.kind = 'countdown'; out.duration = cfg.countdown.duration ?? 0 }
  else if (cfg.countdown_to_time) {
    out.kind = 'countdownTo'
    let secs = cfg.countdown_to_time.time_of_day ?? 0
    if (cfg.countdown_to_time.period === 'TIME_PERIOD_PM' && secs < 12 * 3600) secs += 12 * 3600
    const h = Math.floor(secs / 3600) % 24
    const m = Math.floor((secs % 3600) / 60)
    out.target = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  } else if (cfg.elapsed_time) {
    out.kind = 'elapsed'
    if (cfg.elapsed_time.start_time) out.startAt = cfg.elapsed_time.start_time
    if (cfg.elapsed_time.has_end_time) out.endAt = cfg.elapsed_time.end_time ?? 0
  }
  if (cfg.allows_overrun) out.overrun = true
  return out
}

/**
 * A non-slide rv.data.Action (cue action / macro action) → a namespaced Reach SlideAction.
 * Returns null (after recording it in ctx.unmappedActions) for action types we have no equivalent for.
 */
export function convertAction(a: PB, ctx: ConvertContext, where: string, slideId?: string): SlideAction | null {
  const id = idFromUuid(a.uuid, ctx.newId)
  const base: SlideAction = { id, type: '' }
  if (a.name) base.label = a.name
  else if (a.label?.text) base.label = a.label.text
  if (a.delay_time > 0) base.delay = round3(a.delay_time)
  const done = (type: string, params: Record<string, unknown>): SlideAction => {
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') clean[k] = v
    if (!a.isEnabled) clean.disabled = true // callers move disabled actions aside (see splitDisabled)
    return { ...base, type, params: clean }
  }
  const type: string = a.type ?? 'ACTION_TYPE_UNKNOWN'
  switch (type) {
    case 'ACTION_TYPE_MEDIA': case 'ACTION_TYPE_FOREGROUND_MEDIA': case 'ACTION_TYPE_BACKGROUND_MEDIA': {
      const m: PB = a.media ?? {}
      const media = convertMedia(m.element, ctx, where)
      if (!media) break
      if (media.kind === 'live') return done('media.play', { layer: 'video', live: jsonSafe(media.props) })
      if (media.kind === 'web') return done('media.play', { layer: 'video', web: media.ref.src })
      const isAudio = media.ref.kind === 'audio' || !!m.audio
      const layer = isAudio ? 'audio' : type === 'ACTION_TYPE_FOREGROUND_MEDIA' || m.layer_type === 'LAYER_TYPE_FOREGROUND' ? 'video' : 'background'
      const tr = media.props.transport ?? {}
      const behavior = m.video?.playback_behavior ?? m.audio?.playback_behavior ?? tr.playback_behavior
      const params: Record<string, unknown> = { layer, media: media.ref, fit: media.fit }
      if (media.ref.kind !== 'image') {
        params.loop = behavior === 'PLAYBACK_BEHAVIOR_LOOP' || behavior === 'PLAYBACK_BEHAVIOR_LOOP_FOR_COUNT' || behavior === 'PLAYBACK_BEHAVIOR_LOOP_FOR_TIME'
        if (tr.in_point > 0) params.inPoint = round3(tr.in_point)
        if (tr.out_point > 0) params.outPoint = round3(tr.out_point)
        if (tr.play_rate && tr.play_rate !== 1) params.rate = tr.play_rate
        const vol = media.props.audio?.volume
        if (vol !== undefined && vol !== 1) params.volume = round3(vol)
        const end = m.video?.end_behavior ?? media.props.video?.end_behavior
        if (end && end !== 'END_BEHAVIOR_STOP') params.endBehavior = String(end).replace('END_BEHAVIOR_', '').toLowerCase()
      }
      const t = transitionInfo(m.transition)
      if (t) params.transition = t
      if (m.effects?.length) { params.effects = (m.effects as PB[]).map((e) => e.name).filter(Boolean); ctx.note('media.effects') }
      if (m.markers?.length) ctx.note('media.playbackMarkers')
      return done('media.play', params)
    }
    case 'ACTION_TYPE_MACRO': return done('macro.run', identOf(a.macro?.identification))
    case 'ACTION_TYPE_TIMER': {
      const t: PB = a.timer ?? {}
      const kinds: Record<string, string> = {
        ACTION_START: 'timer.start', ACTION_STOP: 'timer.stop', ACTION_RESET: 'timer.reset', ACTION_RESET_AND_START: 'timer.restart',
        ACTION_STOP_AND_RESET: 'timer.reset', ACTION_INCREMENT: 'timer.increment'
      }
      const at = t.action_type ?? 'ACTION_START'
      const ident = identOf(t.timer_identification)
      return done(kinds[at] ?? 'timer.start', {
        timerId: ident.id, name: ident.name, ...timerConfig(t.timer_configuration),
        stop: at === 'ACTION_STOP_AND_RESET' ? true : undefined, amount: at === 'ACTION_INCREMENT' ? t.increment_amount ?? 0 : undefined
      })
    }
    case 'ACTION_TYPE_CLEAR': return done('live.clear', { layer: clearLayerName(a.clear?.target_layer), announcements: a.clear?.content_destination === 'CONTENT_DESTINATION_ANNOUNCEMENTS' || undefined })
    case 'ACTION_TYPE_CLEAR_GROUP': return done('live.clearGroup', identOf(a.clear_group?.identification))
    case 'ACTION_TYPE_STAGE_LAYOUT': {
      const s: PB = a.stage ?? {}
      const assignments = (s.stage_screen_assignments ?? []).map((x: PB) => ({ screen: identOf(x.screen), layout: identOf(x.layout) }))
      const first = assignments[0]?.layout ?? {}
      return done('stage.setLayout', { layoutId: first.id, name: first.name, assignments: assignments.length > 1 ? assignments : undefined })
    }
    case 'ACTION_TYPE_PROP': {
      const p: PB = a.prop ?? {}
      return done(p.clear ? 'props.clear' : 'props.show', { ...identOf(p.identification), autoClear: p.trigger?.auto_clear_enabled ? p.trigger.auto_clear_duration ?? true : undefined })
    }
    case 'ACTION_TYPE_MESSAGE': {
      const m: PB = a.message ?? {}
      return done('message.show', { ...identOf(m.message_identificaton), values: m.content?.length ? jsonSafe(m.content) : undefined })
    }
    case 'ACTION_TYPE_COMMUNICATION': {
      const c: PB = a.communication ?? {}
      const device = identOf(c.device_identification)
      if (c.midi_command) {
        const mc = c.midi_command
        return done('midi.send', {
          type: mc.state === 'STATE_OFF' ? 'noteOff' : 'noteOn', channel: mc.channel ?? 0, note: mc.note ?? 0, velocity: mc.intensity ?? 0,
          deviceId: device.id, device: device.name
        })
      }
      const commands = (c.commands ?? []).map((x: PB) => ({ name: x.name, value: x.value, values: x.possible_values?.length ? x.possible_values : undefined }))
      const vendor = c.global_cache_command ? { globalCache: jsonSafe(c.global_cache_command) } : c.gvg100_command ? { gvg100: jsonSafe(c.gvg100_command) } : c.sony_BVS_command ? { sonyBVS: jsonSafe(c.sony_BVS_command) } : {}
      return done('device.send', { deviceId: device.id, device: device.name, format: c.format, description: c.description, commands: commands.length ? commands : undefined, ...vendor })
    }
    case 'ACTION_TYPE_AUDIENCE_LOOK': return done('look.set', identOf(a.audience_look?.identification))
    case 'ACTION_TYPE_MASK': return done('mask.set', identOf(a.mask?.identification))
    case 'ACTION_TYPE_MULTISCREEN': return done('multiscreen.set', identOf(a.multi_screen?.identification))
    case 'ACTION_TYPE_PRESENTATION_DOCUMENT': return done('presentation.open', { ...identOf(a.presentation_document?.identification), arrangementId: idFromUuid(a.presentation_document?.selected_arrangement, () => '') })
    case 'ACTION_TYPE_EXTERNAL_PRESENTATION': return done('presentation.openExternal', { path: parsePP7Url(a.external_presentation?.url)?.absolute })
    case 'ACTION_TYPE_AUDIO_INPUT': return done('audio.input', { index: a.audio_input?.index ?? 0, volume: a.audio_input?.override_volume ? a.audio_input.volume : undefined, mode: a.audio_input?.override_mode ? a.audio_input.behavior_mode : undefined })
    case 'ACTION_TYPE_SLIDE_DESTINATION': return done('slide.destination', { target: String(a.slide_destination?.slide_target ?? '').replace('SLIDE_TARGET_', '').toLowerCase() })
    case 'ACTION_TYPE_CAPTURE': return done('capture.control', { capture: jsonSafe(a.capture) })
    case 'ACTION_TYPE_AUDIO_BIN_PLAYLIST': case 'ACTION_TYPE_MEDIA_BIN_PLAYLIST': case 'ACTION_TYPE_LIBRARY_PLAYLIST': {
      const p: PB = a.playlist_item ?? {}
      return done('playlist.trigger', {
        bin: type === 'ACTION_TYPE_AUDIO_BIN_PLAYLIST' ? 'audio' : type === 'ACTION_TYPE_MEDIA_BIN_PLAYLIST' ? 'media' : 'library',
        playlistId: idFromUuid(p.playlist_uuid, () => ''), playlist: p.playlist_name, itemId: idFromUuid(p.item_uuid, () => ''), item: p.item_name
      })
    }
    default:
      if (a.transport_control) {
        const tc = a.transport_control
        return done('media.transport', { action: tc.play ? 'play' : tc.pause ? 'pause' : 'seek', time: tc.jumpToTime?.time })
      }
  }
  ctx.note(`action.${type.replace('ACTION_TYPE_', '').toLowerCase()}`)
  ctx.unmappedActions.push({ slideId, type, name: a.name || uuidOf(a.uuid) || undefined, data: jsonSafe(a) })
  return null
}

/** Disabled cue actions must not fire; keep them out of `actions` but preserve them for the editor. */
export function splitDisabled(actions: SlideAction[]): { active: SlideAction[]; disabled: SlideAction[] } {
  const active: SlideAction[] = []
  const disabled: SlideAction[] = []
  for (const a of actions) {
    if (a.params?.disabled) { const { disabled: _d, ...rest } = a.params; disabled.push({ ...a, params: rest }) } else active.push(a)
  }
  return { active, disabled }
}
