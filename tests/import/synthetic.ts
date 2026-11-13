/**
 * Synthetic ProPresenter fixtures, built by ENCODING messages with the vendored schema, so tests cover cue
 * types, arrangements, media references and data links the five real sample files don't have.
 * Also used by scripts/make-pp7-fixtures.ts to write a fake ProPresenter folder for the e2e test.
 */
import { crc32 } from 'node:zlib'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { encodePP7 } from '../../src/main/services/importers/pp7/proto'
import { readZip } from '../../src/main/services/importers/util/zip'

const U = (s: string): { string: string } => ({ string: s })
const rgba = (r: number, g: number, b: number, a = 1) => ({ red: r, green: g, blue: b, alpha: a })
const rtfMac = (text: string, size = 84) => Buffer.from(`{\\rtf1\\ansi\\ansicpg1252\\cocoartf2761\n\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f0\\fnil\\fcharset0 HelveticaNeue-Bold;}\n{\\colortbl;\\red255\\green255\\blue255;\\red255\\green200\\blue0;}\n{\\*\\expandedcolortbl;;\\cssrgb\\c100000\\c80000\\c0;}\n\\pard\\pardeftab1680\\pardirnatural\\qc\\partightenfactor0\n\n\\f0\\b\\fs${size} \\cf2 ${text.replace(/\n/g, '\\\n')}}`, 'latin1')

export const SYN = {
  uuid: '11111111-2222-3333-4444-555555555555',
  verse: 'aaaaaaaa-0000-0000-0000-000000000001',
  chorus: 'aaaaaaaa-0000-0000-0000-000000000002',
  slides: ['bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000004']
}

function textElement(uuid: string, name: string, text: string, y: number, extra: Record<string, unknown> = {}) {
  return {
    element: {
      uuid: U(uuid), name, bounds: { origin: { x: 160, y }, size: { width: 1600, height: 300 } }, opacity: 1,
      fill: { color: rgba(0, 0, 0, 0.5), enable: true },
      text: { rtf_data: rtfMac(text), vertical_alignment: 'VERTICAL_ALIGNMENT_BOTTOM', scale_behavior: 'SCALE_BEHAVIOR_SCALE_FONT_DOWN', attributes: { font: { name: 'HelveticaNeue-Bold', size: 42, family: 'Helvetica Neue' }, text_solid_fill: rgba(1, 0.8, 0) } }
    },
    info: 3,
    ...extra
  }
}

const slideCue = (uuid: string, elements: unknown[], extra: Record<string, unknown> = {}, actions: unknown[] = []) => ({
  uuid: U(uuid), isEnabled: true, ...extra,
  actions: [
    { uuid: U(uuid.replace('bbbb', 'cccc')), isEnabled: true, type: 'ACTION_TYPE_PRESENTATION_SLIDE', label: { text: (extra as { label?: string }).label ?? '' }, slide: { presentation: { base_slide: { elements, size: { width: 1920, height: 1080 }, uuid: U(uuid.replace('bbbb', 'dddd')) }, notes: { rtf_data: Buffer.from('{\\rtf1\\ansi Speaker note}') } } } },
    ...actions
  ]
})

const mediaUrl = (abs: string, rel: string) => ({ absolute_string: abs, platform: 'PLATFORM_MACOS', local: { root: 'ROOT_SHOW', path: rel } })

export function syntheticPresentation(): Uint8Array {
  const doc = {
    application_info: { platform: 'PLATFORM_MACOS', application: 'APPLICATION_PROPRESENTER', application_version: { major_version: 21, minor_version: 2 } },
    uuid: U(SYN.uuid), name: 'Synthetic Song', category: 'Song',
    ccli: { author: 'A. Writer', song_title: 'Synthetic Song', publisher: 'Test Music', copyright_year: 2024, song_number: 7654321, display: true },
    selected_arrangement: U('eeeeeeee-0000-0000-0000-000000000001'),
    arrangements: [
      { uuid: U('eeeeeeee-0000-0000-0000-000000000001'), name: 'Sunday', group_identifiers: [U(SYN.verse), U(SYN.chorus), U(SYN.verse), U(SYN.chorus), U(SYN.chorus)] },
      { uuid: U('eeeeeeee-0000-0000-0000-000000000002'), name: 'Short', group_identifiers: [U(SYN.chorus)] }
    ],
    cue_groups: [
      { group: { uuid: U(SYN.verse), name: 'Verse 1', color: rgba(0, 0.47, 0.8), hotKey: { code: 'KEY_CODE_ANSI_V' } }, cue_identifiers: [U(SYN.slides[0]), U(SYN.slides[1])] },
      { group: { uuid: U(SYN.chorus), name: 'Chorus', color: rgba(0.8, 0, 0.3) }, cue_identifiers: [U(SYN.slides[2]), U(SYN.slides[3])] }
    ],
    cues: [
      slideCue(SYN.slides[0], [textElement('f0000000-0000-0000-0000-000000000001', 'Lyrics', 'First line\nSecond line', 700), textElement('f0000000-0000-0000-0000-000000000002', 'Translation', 'Erste Zeile', 1000)], { hot_key: { code: 'KEY_CODE_ANSI_1' } }, [
        { uuid: U('a0000000-0000-0000-0000-000000000001'), isEnabled: true, type: 'ACTION_TYPE_MEDIA', name: 'Waves', media: { layer_type: 'LAYER_TYPE_BACKGROUND', element: { uuid: U('a1000000-0000-0000-0000-000000000001'), url: mediaUrl('file:///Users/someone/Documents/ProPresenter/Media/Backgrounds/waves.mp4', 'Media/Backgrounds/waves.mp4'), video: { drawing: { scale_behavior: 'SCALE_BEHAVIOR_FILL', natural_size: { width: 1920, height: 1080 } }, transport: { playback_behavior: 'PLAYBACK_BEHAVIOR_LOOP' } }, metadata: { duration: 30 } }, video: { playback_behavior: 'PLAYBACK_BEHAVIOR_LOOP' } } },
        { uuid: U('a0000000-0000-0000-0000-000000000002'), isEnabled: true, type: 'ACTION_TYPE_TIMER', timer: { action_type: 'ACTION_RESET_AND_START', timer_identification: { parameter_uuid: U('7171a171-0000-0000-0000-000000000001'), parameter_name: 'Sermon' }, timer_configuration: { countdown: { duration: 1800 } } } },
        { uuid: U('a0000000-0000-0000-0000-000000000003'), isEnabled: true, type: 'ACTION_TYPE_COMMUNICATION', communication: { device_identification: { parameter_uuid: U('d1d1d1d1-0000-0000-0000-000000000001'), parameter_name: 'Lighting desk' }, midi_command: { state: 'STATE_ON', channel: 2, note: 60, intensity: 100 } } }
      ]),
      slideCue(SYN.slides[1], [textElement('f0000000-0000-0000-0000-000000000003', 'Lyrics', 'Third line', 700, { data_links: [] })], { isEnabled: false }, [
        { uuid: U('a0000000-0000-0000-0000-000000000004'), isEnabled: true, type: 'ACTION_TYPE_CLEAR', clear: { target_layer: 'CLEAR_TARGET_LAYER_PROP' } },
        { uuid: U('a0000000-0000-0000-0000-000000000005'), isEnabled: true, type: 'ACTION_TYPE_STAGE_LAYOUT', stage: { stage_screen_assignments: [{ screen: { parameter_name: 'Stage 1' }, layout: { parameter_uuid: U('5ea6e000-0000-0000-0000-000000000001'), parameter_name: 'Lyrics + Clock' } }] } },
        { uuid: U('a0000000-0000-0000-0000-000000000006'), isEnabled: true, type: 'ACTION_TYPE_CAPTURE' },
        { uuid: U('a0000000-0000-0000-0000-000000000007'), isEnabled: true, type: 'ACTION_TYPE_SOCIAL_MEDIA' }
      ]),
      slideCue(SYN.slides[2], [
        { element: { uuid: U('f0000000-0000-0000-0000-000000000004'), name: 'Bg image', bounds: { size: { width: 1920, height: 1080 } }, opacity: 1, fill: { enable: true, media: { uuid: U('a1000000-0000-0000-0000-000000000002'), url: mediaUrl('file:///Volumes/Old/Images/cross.jpg', 'Media/Images/cross.jpg'), image: { drawing: { scale_behavior: 'SCALE_BEHAVIOR_FILL' } } } } } },
        { element: { uuid: U('f0000000-0000-0000-0000-000000000005'), name: 'Gradient', bounds: { origin: { x: 0, y: 900 }, size: { width: 1920, height: 180 } }, opacity: 0.8, path: { shape: { type: 'TYPE_ROUNDED_RECTANGLE', rounded_rectangle: { roundness: 0.5 } } }, fill: { enable: true, gradient: { type: 'TYPE_LINEAR', angle: 90, stops: [{ color: rgba(0, 0, 0, 0), position: 0 }, { color: rgba(0, 0, 0, 1), position: 1 }] } } } },
        textElement('f0000000-0000-0000-0000-000000000006', 'Lyrics', 'Chorus line', 600)
      ], { completion_target_type: 'COMPLETION_TARGET_TYPE_NEXT', completion_action_type: 'COMPLETION_ACTION_TYPE_AFTER_TIME', completion_time: 8 }, [
        { uuid: U('a0000000-0000-0000-0000-000000000008'), isEnabled: true, type: 'ACTION_TYPE_MACRO', macro: { identification: { parameter_uuid: U('3ac30000-0000-0000-0000-000000000001'), parameter_name: 'Song start' } } },
        { uuid: U('a0000000-0000-0000-0000-000000000009'), isEnabled: true, type: 'ACTION_TYPE_MEDIA', media: { element: { uuid: U('a1000000-0000-0000-0000-000000000003'), url: mediaUrl('file:///Users/someone/Music/click.mp3', 'Media/Audio/click.mp3'), audio: { audio: { volume: 0.5 } } }, audio: {} } }
      ]),
      slideCue(SYN.slides[3], [
        { element: { uuid: U('f0000000-0000-0000-0000-000000000007'), name: 'Countdown', bounds: { origin: { x: 1500, y: 40 }, size: { width: 380, height: 100 } }, opacity: 1, text: { attributes: { font: { name: 'Menlo', size: 60 }, text_solid_fill: rgba(1, 1, 1) } } }, data_links: [{ timer_text: { timer_uuid: U('7171a171-0000-0000-0000-000000000001'), timer_name: 'Sermon', timer_format_string: '${timer}' } }] },
        { element: { uuid: U('f0000000-0000-0000-0000-000000000008'), name: 'Clock', bounds: { origin: { x: 40, y: 40 }, size: { width: 380, height: 100 } }, opacity: 1, text: {} }, data_links: [{ clock_text: { clock_format_string: 'Time: ${clock}' } }] },
        textElement('f0000000-0000-0000-0000-000000000009', 'Lyrics', 'Last chorus', 600)
      ], { label: 'End' })
    ],
    music_key: 'G',
    transition: { duration: 0.5, effect: { name: 'Dissolve', category: 'Dissolves' } }
  }
  const bytes = encodePP7('rv.data.Presentation', doc)
  // Append an unknown top-level field (#99, varint 1) — what a newer ProPresenter would write.
  return Buffer.concat([Buffer.from(bytes), Buffer.from([0x98, 0x06, 0x01])])
}

export function syntheticPlaylistDoc(proFileName: string): Uint8Array {
  return encodePP7('rv.data.PlaylistDocument', {
    type: 'TYPE_PRESENTATION',
    root_node: {
      uuid: U('99999999-0000-0000-0000-000000000000'), name: 'PLAYLIST', type: 'TYPE_PLAYLIST',
      playlists: { playlists: [{
        uuid: U('99999999-0000-0000-0000-000000000001'), name: '2026', type: 'TYPE_GROUP',
        playlists: { playlists: [{
          uuid: U('99999999-0000-0000-0000-000000000002'), name: 'Sunday 2026-11-15', type: 'TYPE_PLAYLIST',
          items: { items: [
            { uuid: U('98000000-0000-0000-0000-000000000001'), name: 'Worship', header: { color: rgba(0.2, 0.4, 0.8) } },
            { uuid: U('98000000-0000-0000-0000-000000000002'), name: 'Synthetic Song', presentation: { document_path: { absolute_string: `file:///Users/someone/Documents/ProPresenter/Libraries/Default/${encodeURIComponent(proFileName)}`, local: { root: 'ROOT_SHOW', path: `Libraries/Default/${proFileName}` } }, arrangement: U('eeeeeeee-0000-0000-0000-000000000002'), arrangement_name: 'Short' } },
            { uuid: U('98000000-0000-0000-0000-000000000003'), name: 'Missing Song', presentation: { document_path: { absolute_string: 'file:///Users/someone/Documents/ProPresenter/Libraries/Default/Nope.pro' } } },
            { uuid: U('98000000-0000-0000-0000-000000000004'), name: 'Sermon notes', placeholder: {} }
          ] }
        }] }
      }] }
    }
  })
}

/** Minimal "stored" ZIP writer that reproduces ProPresenter's ZIP64 quirk (central-directory size 98 bytes too large). */
export function zip64WithPPBug(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const crc = crc32(f.data) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(45, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(0, 8)
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(f.data.length, 18); local.writeUInt32LE(f.data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28)
    parts.push(local, name, Buffer.from(f.data))
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(45, 4); cd.writeUInt16LE(45, 6); cd.writeUInt16LE(0x800, 8)
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(f.data.length, 20); cd.writeUInt32LE(f.data.length, 24); cd.writeUInt16LE(name.length, 28)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, name)
    offset += 30 + name.length + f.data.length
  }
  const cdBuf = Buffer.concat(central)
  const cdOffset = offset
  const z64 = Buffer.alloc(56)
  z64.writeUInt32LE(0x06064b50, 0); z64.writeBigUInt64LE(44n, 4); z64.writeUInt16LE(45, 12); z64.writeUInt16LE(45, 14)
  z64.writeBigUInt64LE(BigInt(files.length), 24); z64.writeBigUInt64LE(BigInt(files.length), 32)
  z64.writeBigUInt64LE(BigInt(cdBuf.length + 98), 40) // the bug
  z64.writeBigUInt64LE(BigInt(cdOffset), 48)
  const z64Offset = cdOffset + cdBuf.length
  const loc = Buffer.alloc(20)
  loc.writeUInt32LE(0x07064b50, 0); loc.writeBigUInt64LE(BigInt(Math.max(0, z64Offset - 98)), 8); loc.writeUInt32LE(1, 16) // locator also off by 98
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0xffff, 8); eocd.writeUInt16LE(0xffff, 10)
  eocd.writeUInt32LE(0xffffffff, 12); eocd.writeUInt32LE(0xffffffff, 16)
  return Buffer.concat([...parts, cdBuf, z64, loc, eocd])
}

/** A tiny valid PNG (1×1). */
export const PNG_1PX = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0000003010100c9fe92ef0000000049454e44ae426082', 'hex')

/**
 * A fake ProPresenter folder: real vendored samples + the synthetic song in Libraries/, its media under Media/,
 * a Playlists/Library document, Configuration/* and a theme from the vendored corpus, and a ZIP64-bug bundle.
 */
export function buildFakeProPresenterFolder(dir: string, samplesDir: string): void {
  const mk = (p: string): void => { fs.mkdirSync(path.join(dir, p), { recursive: true }) }
  const cp = (from: string, to: string): void => { mk(path.dirname(to)); fs.copyFileSync(path.join(samplesDir, from), path.join(dir, to)) }
  mk('Libraries/Default'); mk('Libraries/Hymns'); mk('Playlists'); mk('Media/Backgrounds'); mk('Media/Images'); mk('Configuration'); mk('Themes')
  fs.writeFileSync(path.join(dir, 'Libraries/Default/Synthetic Song.pro'), syntheticPresentation())
  for (const f of ['bussnet_test-translated.pro', 'bussnet_test-with-macro.pro', 'chrismbarr_v7-feature-test.pro', 'bes-migrator_windows-template-1.pro']) cp(f, `Libraries/Default/${f}`)
  for (const f of fs.readdirSync(path.join(samplesDir, 'library/Libraries/Hymns'))) cp(`library/Libraries/Hymns/${f}`, `Libraries/Hymns/${f}`)
  fs.writeFileSync(path.join(dir, 'Media/Backgrounds/waves.mp4'), Buffer.from('not really a video'))
  fs.writeFileSync(path.join(dir, 'Media/Images/cross.jpg'), PNG_1PX)
  // avatar.png referenced by an absolute Windows path in the feature test: found by file name under Media/
  fs.writeFileSync(path.join(dir, 'Media/Images/avatar.png'), Buffer.concat([PNG_1PX, Buffer.from('avatar')]))
  fs.writeFileSync(path.join(dir, 'Playlists/Library'), syntheticPlaylistDoc('Synthetic Song.pro'))
  for (const f of fs.readdirSync(path.join(samplesDir, 'library/Configuration'))) cp(`library/Configuration/${f}`, `Configuration/${f}`)
  for (const f of ['Theme', 'Assets/BACKGROUND.jpg', 'Assets/KEY_VISUAL.jpg', 'Assets/BAUCHBIND_STREAM.jpg']) cp(`library/Themes/sample/${f}`, `Themes/Sample/${f}`)
  fs.writeFileSync(path.join(dir, 'Bundle Export.probundle'), zip64WithPPBug([
    { name: 'Bundled.pro', data: readZip(fs.readFileSync(path.join(samplesDir, 'exports/TestBild.probundle'))).entries.find((e) => e.name.endsWith('.pro'))!.read() },
    { name: 'test-background.png', data: PNG_1PX }
  ]))
}
