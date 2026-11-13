# MIDI

Reach Presenter listens on every MIDI input (USB, network/RTP, and a virtual port called **Reach Presenter**)
and turns messages into actions. Settings → MIDI shows devices, the mapping table, a live monitor and
**MIDI learn** (press Learn, hit a pad, pick an action).

Mappings are per workspace; which devices are enabled is per computer. Note names use middle C (60) = C3.

## ProPresenter-compatible preset

Settings → MIDI → **Auto fill** adds the note map below as ordinary, editable rows. "Starting note"
shifts every note (use 1 to match the example numbers in ProPresenter's article text).
Rows marked "—" are not built (no Timeline or Media Playlist in Reach); they are skipped.
Listening is on all channels. Commands in the top block fire on any velocity 1-127;
"velocity = number" commands use the velocity as a 1-based index.

| Note | Command | Reach action |
|---|---|---|
| 0 | Clear All | `live.clear all` |
| 1 | Clear Slide | `live.clear slide` |
| 2 | Clear Background | `live.clear media` |
| 3 | Clear Props | `live.clear props` |
| 4 | Clear Audio | `live.clear audio` |
| 6-9 | Video go to beginning / play-pause / play / pause | `media.transport` |
| 10 / 11 | Next / previous playlist item | `playlist.item` |
| 12 / 13 | Next / previous slide | `live.next` / `live.prev` |
| 14-16 | Start / stop / rewind Timeline | — not built |
| 17 | Select playlist (velocity) | `playlist.select` |
| 18 | Select playlist item (velocity) | `playlist.item` |
| 19 | Trigger slide (velocity) | `live.slideIndex` |
| 20, 21 | Select media playlist / trigger media | — not built |
| 22 | Select audio playlist (velocity) | `audio.playlist` |
| 23 | Trigger audio (velocity = track) | `audio.playlist` |
| 24 | Toggle prop (velocity) | `prop.toggle` |
| 25 / 26 / 27 | Start / stop / reset timer (velocity) | `timer.*` |
| 28 | Clear Messages | `live.clear message` |
| 29 | Trigger macro (velocity) | `macro.run` |
| 30 | Clear Announcements | `live.clear announcement` |
| 31, 32 | Select macro / prop collection | — not built |

**Source:** Renewed Vision knowledge base, "Devices: MIDI: ProPresenter Setup"
(article 1500000020301, updated 2026-10-14) and its MIDI Map screenshot. The table is defined in
`src/shared/control-midi.ts` (`PROPRESENTER_NOTE_MAP`).

## Sending

`midi.send` (RPC) and the "Send a test note" button send note/CC/program messages to enabled outputs.

## Not verified without hardware

Device discovery, hot-plug and real RTP sessions need physical or network MIDI gear. The codec, mapping engine,
learn flow, preset and the virtual-port path are unit-tested (`tests/midi.test.ts`).
