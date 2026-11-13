# ProPresenter import — what maps to what

Implementation: `src/main/services/importers/` (pp7/, pp6/, rtf/, text/, office/, pipeline/), schema compiled by
`scripts/build-pp7-descriptor.mjs` from `vendor/pp7-proto/autogen-proto` (version `22,369098928`) into
`pp7/descriptor.json` (bundled; no `.proto` at runtime). Diagnostics: `npx tsx scripts/pp7-inspect.ts <path>`.

## Workspace generations

| detected as | layout | handling |
|---|---|---|
| `pp7-files` | `Libraries/<lib>/*.pro`, `Playlists/Library`, `Configuration/*`, `Themes/<t>/Theme`, `Media/` | full import |
| `pp22-database` | few/no loose `.pro`; database files (SQLite / LevelDB / realm …) | wizard explains: **File ▸ Export Legacy Workspace**, or export `.pro`/`.proBundle`/`.proPlaylist`; CLI prints a census + DB probe (tables, row counts, blobs that decode as `rv.data.Presentation`/`PlaylistDocument`); experimental direct import of decodable presentation blobs |
| `mixed` | both | imports the files, reports the DB |
| `pp6` | `.pro6/.pro5/.pro4` | converted |

The v22 database format is **not known**. The vendored protos include `workspace.entities.local.proto`
(`workspace.local.Workspace { metadata, documents: document.DocumentSet }`, where `DocumentSet` holds
`intrinsics` keyed by kind — Calendar, CCLI, ClearGroups, Groups, KeyMappings, Labels, Macros, Messages, Props,
Stage, Timers, Workspace, LibraryData, Playlist{Audio,Library,Media,Templates} — as raw `bytes`, and
`presentations`/`themes` as `Document { uuid, path, ready{data} }`). That looks like the in-memory/sync shape of a
v22 workspace; whether it is what sits on disk needs one real run of the CLI.

## Presentation (`rv.data.Presentation`)

| ProPresenter | Reach |
|---|---|
| name, category, notes, CCLI (author, artist, publisher, year, song number, album, display) | title, meta.* (`copyright` = "© year publisher") |
| cues[] (flat) + cue_groups (uuid refs) | slides in group order; groups with name/colour (+ `ext.hotKey`, global group) |
| arrangements (repeats kept), selected_arrangement | arrangements, activeArrangementId |
| cue.isEnabled / hot_key / name; slide action label (+ colour) | slide.enabled / hotKey / label (`ext.labelColor`) |
| completion "next after N s" | slide.autoAdvance; other completion targets → `ext.completion` |
| base_slide.size (most common) / background colour / notes (RTF) | presentation.size, slide.background, slide.notes |
| elements (front-first) | elements back→front; bounds, rotation (clockwise), opacity, locked, hidden, stroke, shadow (angle CCW), rounded-rect radius, fill colour / linear gradient / media |
| text: RTF (Cocoa + Windows dialects), attributes fallback, vertical alignment, margins, scale-font-down → autoFit, text shadow, caps | paragraphs/runs with font (PostScript name → family+weight+italic), size, bold/italic/underline, colour incl. alpha, alignment, line height, stroke, letter spacing |
| 1st text box / 2nd text box | role `lyrics` (`body` for non-songs) / `translation`; names like "Reference", "Title", "Translation" set roles |
| data links (timer, clock, current/next slide text/notes, stage message, CCLI, group, label, playlist item, video/audio countdown …) | `dynamic: true` + tokens `{timer:Name}`, `{clock}`, `{current.text}`, `{next.text}`, `{stageMessage}` … |
| media/web/live-video fills | image / video / live(web, camera) elements |
| actions | `media.play` (layer background/video/audio, loop, in/out, volume, fit, transition), `macro.run`, `timer.start/stop/reset/restart/increment`, `live.clear{layer}`, `live.clearGroup`, `stage.setLayout`, `props.show/clear`, `message.show`, `midi.send{type,channel,note,velocity}`, `device.send`, `look.set`, `mask.set`, `presentation.open`, `audio.input`, `playlist.trigger`, `media.transport`, `capture.control`, `slide.destination`; disabled actions → `ext.disabledActions`; anything else → `meta.source.unmapped` |
| transitions | slide.transition / meta.transition (named effects → fade/dissolve/push/slide/zoom/cut; original in `ext`) |

**Not reproduced (counted per file in the report):** build-outs, text reveal (bullet), text scroller, visibility
links, Bezier paths (approximated as polygons), feather, flip, gradient/media/cut-out text fills, background blur,
text line masks, chord charts (chords preserved in `ext.chords`), timeline/timecode cues, MultiTracks licensing,
smart playlists, Calendar, ClearGroups (beyond a named `live.clearGroup` action), KeyMappings, CCLI display template,
TestPatterns, Looks (become suggestions only).

## Known risks on a real library

* Newer ProPresenter versions add fields; the decoder ignores them and the report counts them (`Type#field`).
* Fonts: ProPresenter stores PostScript names; the mapping to CSS families is heuristic.
* Text size: Reach draws font sizes in slide pixels as ProPresenter does; line height is approximated (multiple × 1.2).
* Media on external drives / other computers: resolved by root-relative path, absolute path, then file name under
  `Media/`; Windows paths never resolve on a Mac except by file name.
* Element z-order: samples indicate `elements[0]` is front-most (e.g. a "Background Image" listed last); confirm on real files.
