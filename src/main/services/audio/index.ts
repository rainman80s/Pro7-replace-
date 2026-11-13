/**
 * Audio bin: playlists of music (pre-service, walk-in) on the `audio` layer, with fade in/out and volume.
 * Playback itself is done by the designated audio output (displays feature) from LiveState.audio.
 * Track end: a timer here when the track's duration is known, otherwise the operator window
 * measures it and calls `audio.ended`.
 */
import { fadeVolume, nextTrackIndex, uid, type AudioDoc, type AudioPlaylist, type AudioStatus } from '@shared/control'
import type { ID } from '@shared/model'
import { defineService } from '../../core/service'
import { api } from '../../core/api'
import { live } from '../../core/live'
import { DocStore, P, defineAction, pick } from '../macros/lib'

export const audioDoc = new DocStore<AudioDoc>('audio', () => ({ playlists: [] }), (d) => ({ ...d, playlists: d.playlists ?? [] }))

const status: AudioStatus = { playlistId: null, selectedId: null, index: -1, trackName: '', playing: false, volume: 1 }
let endTimer: NodeJS.Timeout | null = null
let fadeTimer: NodeJS.Timeout | null = null
let currentSrc = ''

const emit = (): AudioStatus => { api.emit('audio.status', { ...status }); return { ...status } }
const playlist = (id?: ID | null): AudioPlaylist | undefined => audioDoc.current.playlists.find((p) => p.id === id)

function stopTimers(): void {
  if (endTimer) clearTimeout(endTimer)
  if (fadeTimer) clearInterval(fadeTimer)
  endTimer = fadeTimer = null
}

function fade(from: number, to: number, seconds: number, done?: () => void): void {
  if (fadeTimer) clearInterval(fadeTimer)
  fadeTimer = null
  if (!seconds || seconds <= 0) {
    live.mutate((s) => { if (s.audio) s.audio = { ...s.audio, volume: to } })
    return done?.()
  }
  const start = Date.now()
  fadeTimer = setInterval(() => {
    const t = (Date.now() - start) / 1000
    const v = fadeVolume(from, to, t, seconds)
    live.mutate((s) => { if (s.audio) s.audio = { ...s.audio, volume: v } })
    if (t >= seconds) { clearInterval(fadeTimer!); fadeTimer = null; done?.() }
  }, 150)
}

export function playTrack(playlistId: ID, index = 0): AudioStatus {
  const pl = playlist(playlistId)
  if (!pl) throw new Error('Audio playlist not found')
  const track = pl.tracks[index]
  if (!track) throw new Error('That track does not exist')
  stopTimers()
  const vol = pl.volume ?? 1
  status.playlistId = pl.id
  status.selectedId = pl.id
  status.index = index
  status.trackName = track.name ?? track.src.split('/').pop() ?? 'Track'
  status.playing = true
  status.volume = vol
  currentSrc = track.src
  live.setMedia('audio', { media: track, playing: true, loop: pl.mode === 'loop' && pl.tracks.length === 1, volume: pl.fadeIn ? 0 : vol })
  if (pl.fadeIn) fade(0, vol, pl.fadeIn)
  if (track.duration && track.duration > 0) endTimer = setTimeout(() => void trackEnded(track.src), track.duration * 1000 + 250)
  return emit()
}

export function trackEnded(src?: string): void {
  if (!status.playing || (src && src !== currentSrc)) return
  const pl = playlist(status.playlistId)
  const next = pl ? nextTrackIndex(pl, status.index, 1) : null
  if (pl && next !== null) playTrack(pl.id, next)
  else stopAudio(false)
}

export function stopAudio(withFade = true): AudioStatus {
  const pl = playlist(status.playlistId)
  stopTimers()
  const finish = (): void => {
    status.playing = false
    currentSrc = ''
    live.clear('audio')
    emit()
  }
  if (withFade && pl?.fadeOut && live.state.audio) fade(live.state.audio.volume ?? status.volume, 0, pl.fadeOut, finish)
  else finish()
  return { ...status }
}

export function skip(delta = 1): AudioStatus {
  const pl = playlist(status.playlistId ?? status.selectedId)
  if (!pl) throw new Error('No audio playlist is playing')
  const i = nextTrackIndex({ ...pl, mode: pl.mode === 'stop' ? 'next' : pl.mode }, status.index, delta)
  if (i === null) return stopAudio()
  const go = (): void => void playTrack(pl.id, i)
  if (pl.fadeOut && status.playing && live.state.audio) fade(live.state.audio.volume ?? status.volume, 0, Math.min(pl.fadeOut, 2), go)
  else go()
  return { ...status }
}

export default defineService({
  name: 'audio',
  order: 50,
  async setup() {
    await audioDoc.get()
    // Someone pressed Clear All / Clear Audio, or replaced the audio: we are no longer in charge.
    api.on('live.changed', (s) => {
      if (status.playing && (!s.audio || s.audio.media.src !== currentSrc) && !fadeTimer) {
        stopTimers()
        status.playing = false
        currentSrc = ''
        emit()
      }
    })

    api.handle('audio.list', () => audioDoc.get(), 'control')
    api.handle('audio.save', async ({ playlist: p }) => {
      const pl: AudioPlaylist = { tracks: [], mode: 'next', volume: 1, fadeIn: 2, fadeOut: 3, ...p, id: p.id || uid('aud') }
      await audioDoc.update((d) => {
        const i = d.playlists.findIndex((x) => x.id === pl.id)
        if (i >= 0) d.playlists[i] = pl
        else d.playlists.push(pl)
      })
      return pl
    })
    api.handle('audio.remove', async ({ id }) => {
      if (status.playlistId === id) stopAudio(false)
      await audioDoc.update((d) => { d.playlists = d.playlists.filter((p) => p.id !== id) })
    })
    api.handle('audio.play', ({ playlistId, index }) => playTrack(playlistId, index ?? 0))
    api.handle('audio.stop', (req) => stopAudio(req?.fade !== false))
    api.handle('audio.pause', () => {
      if (!live.state.audio) return { ...status }
      const playing = live.state.audio.playing
      live.transport('audio', playing ? 'pause' : 'play')
      status.playing = !playing
      if (playing) { if (endTimer) clearTimeout(endTimer); endTimer = null }
      return emit()
    })
    api.handle('audio.skip', (req) => skip(req?.delta ?? 1))
    api.handle('audio.volume', ({ volume }) => {
      status.volume = Math.max(0, Math.min(1, volume))
      live.mutate((s) => { if (s.audio) s.audio = { ...s.audio, volume: status.volume } })
      return emit()
    })
    api.handle('audio.status', () => ({ ...status }), 'control')
    api.handle('audio.ended', (req) => trackEnded(req?.src))

    const plParam = { key: 'id', label: 'Audio playlist', kind: 'audioPlaylist' as const, optional: true }
    defineAction({
      type: 'audio.playlist', label: 'Play audio playlist', category: 'Media', description: 'Start background music. Track 1 = first.',
      params: [plParam, P.num('index', 'Or playlist number', { optional: true, min: 1 }), P.num('track', 'Track number', { optional: true, min: 1 }), P.bool('play', 'Start playing', { default: true })]
    }, (p) => {
      const pl = (p.id || p.index ? pick(audioDoc.current.playlists, p) : undefined) ?? playlist(status.selectedId) ?? audioDoc.current.playlists[0]
      if (!pl) throw new Error('No audio playlist')
      status.selectedId = pl.id
      if (p.play === false) return void emit()
      playTrack(pl.id, p.track ? Math.round(Number(p.track)) - 1 : 0)
    })
    defineAction({ type: 'audio.stop', label: 'Stop music (fade out)', category: 'Media', params: [P.bool('fade', 'Fade out', { default: true })] }, (p) => void stopAudio(p.fade !== false))
    defineAction({ type: 'audio.next', label: 'Next / previous track', category: 'Media', params: [P.num('delta', 'Step', { default: 1 })] }, (p) => void skip(Number(p.delta ?? 1) || 1))
  },
  dispose() { stopTimers() }
})
