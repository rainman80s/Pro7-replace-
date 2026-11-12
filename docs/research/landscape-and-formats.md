# Reach Presenter research: landscape, ProPresenter formats, output options

Researched 2026-11-12. Every claim is tagged by how it was established:

- **[verified]** — read directly from a repo, file or doc during this research (source linked).
- **[snippet]** — from a search-result summary only; the page itself was not read.
- **[memory]** — general knowledge, not re-checked today. Confirm before depending on it.

**Access limits.** Reddit could not be fetched in any form (www, old., `.json`, and search is blocked for the
domain), and X was not searchable. The "people vibe-coding their own presenter" wave is therefore documented from
GitHub (where those projects actually live) rather than from Reddit/X threads. Hacker News has almost nothing on
this topic (see 1.4). GitHub's API was only reachable unauthenticated, so star counts are a snapshot.

Vendored artifacts produced by this research:

| Path | What | License |
|---|---|---|
| `vendor/pp7-proto/` | `greyshirtguy/ProPresenter7-Proto` @ `7607ba9` (2026-11-11, "Update protobufs for ProPresenter 22,369098928"), `.git` removed, `LICENSE` kept, `VENDORED.txt` added | MIT |
| `vendor/pp7-samples/` | 5 real ProPresenter files (4 `.pro`, 1 `.probundle`) — untrusted test data | see 2.9 |

---

## Part 1 — Landscape

### 1.1 Established open-source / free alternatives

| Project | Stack | License | Notes |
|---|---|---|---|
| **FreeShow** (ChurchApps) — https://github.com/ChurchApps/FreeShow, https://freeshow.app | Electron 45 + Svelte 3 + TypeScript, Vite/Rollup, `better-sqlite3`, `socket.io`, `express` **[verified: package.json v1.6.8-beta.3]** | GPL-3.0 | The closest thing to what we are building, in the same stack. Study it hardest. |
| **OpenLP** — https://openlp.org | Python + Qt **[memory]** | GPL-3.0 **[memory]** | Oldest and most conservative. Browser stage view and web remote, remote apps in app stores, Planning Center plugin since 3.0 **[snippet: openlp.org blog, manual.openlp.org/stage_view.html]**. Weak on motion backgrounds **[snippet]**. |
| **Quelea** — https://quelea.org | Java / JavaFX **[memory]** | GPL-3.0 **[memory]** | Mobile lyrics and mobile remote served over HTTP **[memory]**. Reviewers call stage display limited and note no direct SongSelect integration **[snippet]**. |
| **Presenter by WorshipTools** — https://worshiptools.com/presenter | Closed source, free | proprietary | Cloud sync is the core idea: services, songs and slides sync automatically; media only syncs if saved to their cloud; sync errors are the recurring complaint. NDI arrived only in the 2026 beta **[snippet: worshiptools.com docs, faith.tools]**. |
| **OpenSong** — https://opensong.org | Xojo/REALbasic **[memory]** | GPL **[memory]** | Legacy, but its XML song format and chord handling are still widely imported. |
| **Praisenter** — https://github.com/praisenter/praisenter | Java | BSD-3-Clause **[verified: GitHub API]** | Small, still pushed in Nov 2026. |
| **TheOpenPresenter** — https://github.com/Vija02/TheOpenPresenter | Web-first; desktop "Studio" app stable on Windows, alpha on Mac **[verified: README]** | AGPL-3.0 **[snippet]** | Any browser is a screen; multi-user real-time control; plugin architecture. |
| **Cloud of Worship** — https://github.com/CoW-Labs/cloudofworship | Nuxt 4 / Vue 3 / Dexie (IndexedDB) / Socket.IO, Tauri 2 desktop **[verified: README]** | AGPL-3.0 | Browser app that works offline; Tauri shell exists purely to add what a browser can't (NDI). |
| **ChurchPresenter** — https://github.com/ChurchPresenter/ChurchPresenter | Kotlin, Compose Multiplatform on JVM, bundled ffmpeg for capture, DeckLink **[verified: README]** | GPL-3.0 | Went fully open source May 2026 **[snippet]**. |
| **CasparCG church client** — https://sourceforge.net/projects/caspar-cg-church | CasparCG client | — | Emulates ProPresenter 6 look and hotkeys on a broadcast playout engine **[snippet]**. |

"Cuelist" did not turn up as a church presentation project in any search; nothing to report.

#### FreeShow in detail (all **[verified]** from source at depth-1 clone, Nov 2026)

- **Outputs.** Each output is a `BrowserWindow`. Capture-only outputs (NDI/OMT/Blackmagic/RTMP) use Electron
  offscreen rendering; `OutputLifecycle.ts` turns on `offscreen: { useSharedTexture: true }` when the GPU state
  allows and falls back to bitmap paint otherwise. Frames are fanned out from a worker
  (`src/electron/capture/senderWorker.ts`) so encoding doesn't block the main process.
- **NDI**: `grandiose` pinned to their own fork (`github:ChurchApps/grandiose#203a287`), sender and receiver, in a worker.
  Byte-order helpers are lifted from Vingester (GPL).
- **OMT** (Open Media Transport, an open NDI alternative): `openmediatransport` node binding by meros-co.
- **Blackmagic**: `macadam` from a personal fork (`github:vassbo/macadam`); upstream Streampunk `macadam` on npm
  was last published 2022-03.
- **MIDI**: `jzz`. **LTC timecode**: bitfocus `libltc-wrapper`. **OSC**: `osc-js`.
- **Network servers**: Express + Socket.IO on fixed ports — REMOTE 5510, STAGE 5511, CONTROLLER 5512,
  OUTPUT_STREAM 5513 — each advertised over mDNS as service type `freeshow` using `bonjour-service`.
  A code comment notes pure-JS mDNS bypasses `mDNSResponder` on macOS, and they special-case the Mac.
- **Streaming**: RTMP via managed ffmpeg, WebRTC/WHIP host, output recording.
- **Integrations**: content-provider registry with Planning Center (incl. PCO Live), ChurchApps, Canva, OnStage;
  cloud sync via Google Drive and ChurchApps with a tested sync ledger.
- **Importers**: ProPresenter (`.pro` decoded in the main process with `protobufjs` against a bundled
  `presentation.proto`; 918-line converter), EasyWorship, MediaShout (`mdb-reader`), OpenLP, OpenSong, Quelea,
  SongBeamer, VideoPsalm, VerseView, SoftProjector, EasySlides, ChordPro, CSV, plain text with auto-sectioning,
  PowerPoint, Zefania/OSIS Bibles.
- **Display handling**: stores `output.screen = display.id.toString()` plus bounds; on
  `display-added/removed/metrics-changed` it re-aligns each window to `screen.getDisplayNearestPoint(center)`.
  Refuses to open an output that would cover >50% of the operator window. Always-on-top level is
  `screen-saver` on Windows and `pop-up-menu` on macOS; macOS uses a `panel` window type to sit over fullscreen apps.
- **Praise / complaints.** Praised for price, interface and multi-screen output; criticised for bugs, crashes and
  rough edges, and a thinner feature set than paid tools **[snippet: Capterra/GetApp summaries]**. 83-point
  Show HN in 2022 (https://news.ycombinator.com/item?id=32476943) **[verified]**.

**License warning.** FreeShow, OpenLP, Quelea and ChurchPresenter are GPL-3.0; TheOpenPresenter and Cloud of
Worship are AGPL-3.0. Read them for ideas, but do not paste their code into Reach Presenter unless we intend to
ship under a compatible copyleft license. MIT/Apache sources we *can* reuse are listed in 2.8.

### 1.2 The 2026 DIY / AI-assisted wave (GitHub)

Almost all of these were created in 2026, have 0–30 stars and a single author. Only the ones marked say anything
about AI tooling; for the rest it is inferred from age, pace and style, not confirmed.

| Project | Stack | What's notable |
|---|---|---|
| **Simple Presenter** — https://github.com/greyshirtguy/Simple-Presenter (MIT) | C++/Qt/QML, Linux | **Explicitly "vibe coded"**, by the author of the proto repo. Opens a *copied ProPresenter folder as-is* — no import step — and writes changes back, "writes whatever it does not understand back exactly as it found it". Up to 16 screens over windows/displays/NDI/DeckLink, looks, masks, stage layouts, macros, timers, props, chords, PPTX import, SongSelect lyrics import. Ships `CLAUDE.md`/`AGENTS.md`, a self-test, a benchmark, and a log "written to be read by a person or handed to an AI model". Its `docs/features/*.md` are the best free description of ProPresenter behaviour available. |
| **WorshipSync** — https://github.com/crmusico125/WorshipSync | Electron, React, TS, Zustand, SQLite, Drizzle | Same stack family as ours. Stage display is a local web server pushed by **SSE**; settings show both `http://<hostname>.local:4040` and an IP fallback "for smart TVs and devices without mDNS". Portable `.worshipsync` backup file. Service readiness states (`empty` / `in-progress` / `ready`). |
| **EasyPresent** — https://github.com/francis-p-n/easyPresent | Electron + vanilla JS, optional C++ N-API addon (DirectX 11, Media Foundation, WASAPI) | Native renderer shares texture handles with Electron windows, and **falls back to HTML canvas if the addon fails to load**. Three role screens: Audience, Presenter (`/presenter`), PA/sound desk (`/pa`). PPTX parsed in the main process with `adm-zip`. Windows-only native path. |
| **OpenPresenter** — https://github.com/open-mission/openpresenter (GPL-3.0) | Rust (Axum) + Svelte 5 + SQLite WAL | Outputs are just URLs (`/public`, `/stage`) opened in any browser or captured in OBS. Select-without-projecting, then `Enter` to fire, `Esc` to stop; single-key jumps to chorus/verse/bridge; overtime timer pulsing red. |
| **RAMEDIA** — https://github.com/michaelyuswandi/RAMEDIA (GPL-3.0) | Electron, React, TS, Tailwind | Per-destination "song view profiles" (main / stage / stream lower-third). EasyWorship import. |
| **phyto** — https://github.com/studio-liturgy/acts2-phyto (GPL-3.0) | TypeScript | Scoped deliberately to small home gatherings. |
| **Refuge Presenter** — https://github.com/w3nash/refuge-presenter (GPL-3.0+) | Tauri | Early; could not be cloned today (repo unavailable). **[snippet]** |
| **ProPresenter Garage** — https://github.com/eugenius1/propresenter-garage (GPL-3.0) | TypeScript web app + **MCP server** | Reads real Pro7 libraries in the browser; lints slide text across a whole library; diffs media-bin playlists; read-only MCP server so Claude can answer "which songs haven't we used this year?". Validates against the schema before writing and reads back afterwards. |
| **bes-propres7-migrator** — https://github.com/ioanlucut/bes-propres7-migrator (Apache-2.0) | TypeScript, `ts-proto` | "Songs as code": ~1,900 songs as text in Git compiled to `.pro` by CI since 2023, shipping only changed files via a content-hash manifest. |
| Companion tools | — | `sftchurch/txt2pro`, `dimjer/propresenter-bilingual-songs` (a Claude Code skill), `stephenrgarcia/pro7-lyric-corrector`, `nathanlin-av/sunday-slides` (PCO plan → Pro7 slides), `harrygoodwin41/ministry-stage-releases` (stage display to tablets, approve once, auto-reconnect), `whiteoakmedia/prodeck`, `dbullard/Relay`. Found via the `propresenter` GitHub topic (87 repos). |

**Avoid:** `V0ID240/easy-worship-desktop` (33 stars, created 2026-11-02) advertises a "pre-activated" build
installed by a PowerShell one-liner. It has the shape of a malware/piracy lure. Do not run it or link to it.

### 1.3 Clever ideas worth copying

1. **Browser pages as first-class outputs.** Stage, remote, presenter and "PA" views served from a local HTTP
   server (FreeShow, OpenLP, Quelea, WorshipSync, EasyPresent, OpenPresenter, TheOpenPresenter). It costs
   almost nothing once the output is already HTML, and it covers tablets, phones, Fire sticks and Pis.
2. **Show two URLs** — `hostname.local` and raw IP — plus a QR code. Smart TVs often can't resolve mDNS (WorshipSync).
3. **Open ProPresenter data in place, preserve unknown fields** (Simple Presenter). For us: import is a must;
   lossless write-back is a stretch goal, and only safe if unknown fields survive (see 2.3).
4. **Looks**: per-screen layer routing, so the room gets lyrics over video while the stream gets lyrics on alpha.
   RAMEDIA's "view profiles" and ProPresenter's Looks are the same idea. Design the layer model for this from day one.
5. **Role-specific screens** beyond stage display — a sound-desk view with LIVE/LOGO/CLEARED state and "up next".
6. **Capture-only outputs rendered offscreen at the configured resolution**, independent of any monitor's DPI (FreeShow).
7. **Graceful degradation**: native fast path with a pure-web fallback (EasyPresent); NDI library fetched on
   demand with its licence shown, rather than bundled (Simple Presenter).
8. **Safety rails**: refuse to open an output over the operator window (FreeShow); a dev/"fallback" output window
   when there is no second display (ChurchPresenter); "Identify" overlay per output (FreeShow `OutputIdentify.ts`).
9. **Decoupled select vs. fire**, single-key section jumps, undo in live mode (OpenPresenter, showTime).
10. **Arrangements as ordered references to groups** so a chorus exists once (ProPresenter's own model; see 2.2).
11. **An MCP server / AI-readable log** over the library (ProPresenter Garage, Simple Presenter). Cheap for us to add.
12. **Self-test and benchmark shipped in the app** (Simple Presenter) — valuable for volunteer-run machines.
13. **Portable single-file backup** of the whole library (WorshipSync).

### 1.4 Mistakes to avoid

- **Stability is the whole product.** The consistent complaint about FreeShow is crashes and rough edges, not
  missing features. A Sunday-morning tool must never lose output. Isolate output windows from the editor,
  keep the last frame up if the control process dies, and autosave continuously.
- **Cloud sync as a single point of failure** (WorshipTools). Go offline-first; sync is additive. Treat media
  separately from documents, and never block the show on the network.
- **Depending on forked/abandoned native modules.** FreeShow pins `grandiose` and `macadam` to personal git forks.
  Every native addon is a rebuild on each Electron bump, times three OS/arch targets. Keep the count low,
  load each lazily, and make every one optional at runtime.
- **Trusting `display.id`.** See 3.7.
- **Fixed ports with no fallback**, and assuming mDNS works everywhere.
- **Scope creep.** Small projects that try to match ProPresenter feature-for-feature stall. phyto and WorshipSync
  are explicit about a narrow workflow; that is the right instinct for a v1.
- **Round-tripping protobuf through an incomplete schema** silently drops data (2.3).
- **Hacker News is not where this audience is**: beyond the 2022 FreeShow post, searches for church/worship
  presentation software since early 2025 returned nothing relevant **[verified via hn.algolia.com]**.

---

## Part 2 — ProPresenter file formats

### 2.1 The proto definitions

- **Use `vendor/pp7-proto/autogen-proto/`.** It is regenerated by a daily GitHub Action that runs
  [`protodump`](https://github.com/arkadiyt/protodump) against the current ProPresenter binary; `version.txt`
  reads `22,369098928`. 148 files. Package `rv.data`, proto3. **[verified]**
- The repo also keeps frozen snapshots: `Proto 7.16/`, `Proto7.16.2/`, `Proto 19beta/`, and the original
  hand-reversed `proto/`. No fork is ahead of upstream; upstream is the current one. Source:
  https://github.com/greyshirtguy/ProPresenter7-Proto (MIT, © 2023 greyshirtguy, 120 stars).
- Renewed Vision dropped the "7.x" numbering after 7.16: sample files carry `application_version.major_version`
  of 7 (7.13.2) and 20, and the newest dump is 22. **[verified from decoded samples]**
- Unofficial and unsupported. Do not contact Renewed Vision about them (the README is emphatic).
- All four vendored `.pro` samples, plus `Workspace`, `Stage`, `Macros`, `Props`, `Timers`, `Groups` and a
  `Theme` file from the bussnet repo, decode cleanly against `autogen-proto` with `protoc --decode`. **[verified]**
- For TypeScript, generate with [`ts-proto`](https://github.com/stephenh/ts-proto) (what bes-propres7-migrator
  does) or load at runtime with `protobufjs` (what FreeShow does).

### 2.2 `.pro` presentation — `rv.data.Presentation` (`presentation.proto`)

No container: the file *is* the protobuf message. **[verified]**

```
Presentation
├─ application_info (1)   platform, OS version, app version
├─ uuid (2), name (3), last_date_used (4), last_modified_date (5), category (6), notes (7)
├─ background (8), selected_arrangement (10)
├─ arrangements[] (11)    uuid, name, group_identifiers[]  ← ordered, may repeat a group
├─ cue_groups[] (12)      group{uuid,name,color,hotKey}, cue_identifiers[]  ← slide UUIDs
├─ cues[] (13)            the slides
│   └─ actions[] (10)     type 11 = slide, 2 = media, 23 = macro, …
│       └─ slide.presentation.base_slide.elements[].element   (Graphics.Element)
│            ├─ uuid, name, bounds, opacity, path, fill, stroke, shadow, feather
│            └─ text { attributes, rtf_data (bytes), vertical_alignment, margins, … }
├─ ccli (14)              author, song_title, publisher, copyright_year, song_number, display, album
├─ timeline (17), music_key (22), music (23)
```

- Slides live flat in `cues[]`; groups and arrangements only hold UUID references. Resolve with a
  case-insensitive UUID map and **preserve order and duplicates**.
- Songs with no arrangement are valid (17 of 169 in the bussnet corpus).
- A second text element on a slide is the convention for a translation line.
- Base slide carries its own `size` (e.g. 1920×1080); element `bounds` are in those units.
- Field tables: `doc/formats/pp_song_spec.md` in https://github.com/bussnet/propresenter7-php-lib (MIT).

**Text is RTF in `rtf_data`**, and the dialect depends on which OS last saved the file **[verified from samples]**:

| | macOS | Windows |
|---|---|---|
| Header | `{\rtf1\ansi\ansicpg1252\cocoartf2761 \cocoatextscaling0\cocoaplatform0{\fonttbl…` | `{\rtf0\ansi\ansicpg1252{\fonttbl\f0\fnil Helvetica;}…` |
| Colour table | `\expandedcolortbl;;\cssrgb\c…` / `\csgray` | `\expandedcolortbl;\csgenericrgb\c…` |

Shared quirks: Windows-1252 with `\'xx` hex escapes; `\uNNNN?` for Unicode (decimal, followed by a fallback char to
skip); a bare `\` + newline is a soft line break; stroke via `\outl0\strokewidth-40 \strokec3`; the space after a
control word is consumed. Fills other than a solid colour (gradient, image, blur, cut-out) are stored *beside*
the RTF as ranges, not in it. Write a real tokenizer, not regexes; `text.attributes` duplicates the dominant
font/colour and is a useful fallback when RTF parsing fails.

### 2.3 Round-trip fidelity

bussnet measured **0 of 169** files byte-identical after decode→encode with the 19beta protos — "unknown fields
are lost during serialization". Some of that is canonical re-ordering, but treat it as a warning. If we ever write
`.pro` files: use a runtime that retains unknown fields (ts-proto `unknownFields` option; protobufjs drops them by
default), build new files from a ProPresenter-written template, and keep the original bytes as backup.
Import-only is safe.

### 2.4 `.proplaylist` and `.probundle`

Both are ZIP archives. **[verified: bussnet `pp_playlist_spec.md`, `pp_bundle_spec.md`, and the vendored bundle]**

**`.proplaylist`** — ZIP64, stored (no compression).
- `data` at the root: protobuf, wrapping a root `Playlist` named `"PLAYLIST"` whose `playlists.playlists[0]` is
  the real one. Items are a oneof: `header` (section divider with colour), `presentation` (`document_path` URL,
  `arrangement` UUID, `arrangement_name`, `user_music_key`), `cue`, `planning_center`, `placeholder`.
  (bussnet decodes `data` as `rv.data.Playlist`; the proto README says `rv.data.PlaylistDocument` — whose
  `root_node` is a `Playlist`. Try `PlaylistDocument` first and fall back.)
- Referenced `.pro` files at the root by filename, de-duplicated.
- Media at their **original absolute path minus the leading `/`**.

**`.probundle`** — one `.pro` plus its media.
- ProPresenter's own exports store media under absolute paths (leading `/`), uncompressed, permissions `0000`.
- Bundles built to be portable use `URL.local.root = ROOT_CURRENT_RESOURCE (12)` with a bare filename.
- Detect the `.pro` entry case-insensitively. A bundle with no media is valid; one with no `.pro` is not.

**ZIP64 quirk:** ProPresenter writes a ZIP64 end-of-central-directory locator whose offset is off by 98 bytes.
Strict unzip libraries reject these. Scan backwards for the ZIP64 EOCD signature and correct the offset. Test
`yauzl` (what FreeShow uses) against real exports early.

### 2.5 Media references — `rv.data.URL` (`url.proto`) **[verified]**

```proto
message URL {
  Platform platform = 3;                 // MACOS=1, WIN32=2, WEB=3
  oneof Storage        { string absolute_string = 1; string relative_path = 2; }
  oneof RelativeFilePath { LocalRelativePath local = 4; ExternalRelativePath external = 5; }
}
LocalRelativePath { Root root = 1; string path = 2; }
// Root: BOOT_VOLUME=1 USER_HOME=2 USER_DOCUMENTS=3 USER_DOWNLOADS=4 USER_MUSIC=5 USER_PICTURES=6
//       USER_VIDEOS=7 USER_APP_SUPPORT=8 SHARED=9 SHOW=10 USER_DESKTOP=11 CURRENT_RESOURCE=12
ExternalRelativePath { macos{volume_name} | win32{drive_letter, volume_name, network_share}; path }
```

- Every reference stores **both** an absolute form and a root-relative form. macOS writes `file:///…` URLs;
  Windows writes raw paths (`C:\Users\chris\Documents\avatar.png`). Web media uses `PLATFORM_WEB` with an `https://` URL.
- `ROOT_SHOW (10)` is the ProPresenter folder itself — this is what makes a library portable between machines.
- ProPresenter rejects a media URL with no `local` part ("image not found").
- **Resolution order to implement** (Simple Presenter's, which matches observed behaviour): (1) root-relative
  against our own library root, (2) the recorded absolute path, (3) by filename anywhere under `Media/`.
  Then offer a relink UI. ProPresenter itself exposes user "Search Paths" for this
  (https://support.renewedvision.com/hc/en-us/articles/360044707314) **[snippet]**.
- Media format strings are lowercase (`png`, `jpg`, `mp4`).

### 2.6 On-disk library layout

`~/Documents/ProPresenter/` on macOS, `Documents\ProPresenter\` on Windows; movable in Settings → Advanced.
Files in `Configuration/` and `Playlists/` have **no extension**. Layout **[verified from Simple Presenter's
workspace doc and the bussnet `reference_samples/pp-config` dump]**:

```
Libraries/<Library name>/*.pro        one flat folder per library          rv.data.Presentation
Media/…                               assets, any depth
Playlists/Library                     presentation playlists + folders     rv.data.PlaylistDocument
Playlists/Media                       media-bin playlists                  rv.data.PlaylistDocument
Themes/<Theme name>/Theme             theme slides                         rv.data.Template.Document
Themes/<Theme name>/Assets/…          theme images
Configuration/Workspace               screens, outputs, looks              rv.data.ProPresenterWorkspace
Configuration/Stage                   stage layouts                        rv.data.Stage.Document
Configuration/Macros                  macros + collections                 rv.data.MacrosDocument
Configuration/Props                   props + collections                  rv.data.PropDocument
Configuration/Timers                  timers                               rv.data.TimersDocument
Configuration/Groups                  group names, colours, hotkeys        rv.data.ProGroupsDocument
Configuration/Labels                  slide labels                         rv.data.ProLabelsDocument
Configuration/Messages                messages                             rv.data.MessageDocument
Configuration/ClearGroups             clear groups                         rv.data.ClearGroupsDocument
Configuration/CCLI                    CCLI settings                        rv.data.CCLIDocument
Configuration/KeyMappings             keyboard map                         rv.data.KeyMappingDocument
Configuration/Calendar, CommunicationDevices, TestPatterns
```

Message names for the first seven rows were confirmed by decoding; the rest are the matching `*Document` messages
in the protos and should be confirmed the same way. Also expect `Playlists/Audio` and a `Presets/` folder **[memory]**.

`Configuration/Workspace` shows how ProPresenter itself identifies a screen's output device: `name`, `model`,
`serial`, `deviceName`, `vendor`, a `render_id`, and the chosen `mode` (e.g. `1080p60`). An unassigned output is
simply named "not configured". Relevant to 3.7.

**Not verified:** the contents of `~/Library/Application Support/RenewedVision/ProPresenter` (macOS) and
`%AppData%\RenewedVision\ProPresenter` (Windows). What searching turned up: registration data under
`/Library/Application Support/RenewedVision`; Windows logs in `%LocalAppData%\RenewedVision\ProPresenter\`
(7.13.1+); and, for version 20+, `%AppData%\RenewedVision\ProPresenter\LocalWorkspaces` **[snippet: Renewed
Vision support articles]**. That last one matters: recent versions support multiple workspaces, so the importer
should let the user pick a folder rather than assume `~/Documents/ProPresenter`. Inspect a real install before
writing code against these paths. Renewed Vision also advises against keeping the library in iCloud/Dropbox-style
synced folders.

### 2.7 ProPresenter 6 — `.pro6`

UTF-8 XML with a BOM. **[verified from `v6 - Feature Test.pro6`]**

```xml
<RVPresentationDocument height="1080" width="1920" versionNumber="600" category="Song"
    backgroundColor="0.196 0.643 0.612 1" selectedArrangementID="" os="1" buildNumber="6016" …>
  <RVTimeline …/>
  <array rvXMLIvarName="groups">
    <RVSlideGrouping name="Verse 1" color="r g b a" uuid="…">
      <array rvXMLIvarName="slides">
        <RVDisplaySlide label="" notes="" enabled="true" hotKey="" UUID="…" backgroundColor="…">
          <array rvXMLIvarName="cues"/>                <!-- RVMediaCue: slide-attached media -->
          <array rvXMLIvarName="displayElements">
            <RVTextElement …>
              <RVRect3D rvXMLIvarName="position">{x y z w h}</RVRect3D>
              <NSString rvXMLIvarName="PlainText">BASE64</NSString>
              <NSString rvXMLIvarName="RTFData">BASE64</NSString>
              <NSString rvXMLIvarName="WinFlowData">BASE64</NSString>   <!-- XAML FlowDocument -->
              <NSString rvXMLIvarName="WinFontData">BASE64</NSString>
```

- Colours are space-separated RGBA floats. Element types seen: `RVTextElement`, `RVImageElement`,
  `RVShapeElement`, `RVBezierPathElement`, `RVHTMLShapeElement`, plus `RVVideoElement` **[memory]**.
- `os` distinguishes Mac- from Windows-authored files; Windows files carry the text as XAML in `WinFlowData`
  and may leave `RTFData` stale. **Decode `PlainText` first** — it is the reliable source for lyrics.
- Media `source` is a percent-encoded `file://` URL on Mac and a Windows path on Windows **[memory]**.
- Pro4/Pro5 are the same XML family (`.pro4`, `.pro5`). `.pro6plx` playlists and `.pro6x` bundles are zips **[memory]**.

### 2.8 Existing parsers and converters

| Repo | Lang | License | Use it for |
|---|---|---|---|
| https://github.com/greyshirtguy/ProPresenter7-Proto | proto | MIT | The schema (vendored). |
| https://github.com/ChrisMBarr/ProPresenter-Parser (npm `propresenter-parser` 1.1.1) | TypeScript | MIT | Pro4/5/6 parse + Pro5/6 build, with typed XML models; an undocumented v7 parser in `src/v7`. Best starting point for `.pro6` import. Sample files for every version. |
| https://github.com/ioanlucut/bes-propres7-migrator | TypeScript | Apache-2.0 | Writing valid `.pro` from text with `ts-proto`; RTF escaping; `docs/propresenter-format.md`; Windows-saved reference files with decoded text. |
| https://github.com/bussnet/propresenter7-php-lib | PHP | MIT | The best written specs (`doc/formats/*.md`), a config-file corpus, the ZIP64 fix. Itself agent-written. |
| https://github.com/greyshirtguy/Simple-Presenter | C++/Qt | MIT | Reference behaviour for everything: RTF reader/writer, text fills, PPTX import, media resolution, looks. |
| https://github.com/Joelkott/pro-file-generator | Python | MIT | Template-based text → `.pro` (7.16+). |
| https://github.com/ChurchApps/FreeShow (`src/frontend/converters/propresenter.ts`, `src/electron/data/import.ts`) | TypeScript | **GPL-3.0** | Reading only: how a shipping Electron app maps Pro6/Pro7 to its own model. |
| https://github.com/eugenius1/propresenter-garage | TypeScript | **GPL-3.0** | Browser-side Pro7 reading and safe write-back with verification; MCP server design. |
| https://github.com/jdtcdr/propresenter-proto-dart | Dart | — | Generated classes only **[snippet]**. |
| https://github.com/jeffmikels/ProPresenter-API | docs | — | The *network* remote/stage protocol (not files); last updated 2022. |
| https://greyshirtguy.com/blog/pro7fileformat1/ and `/propresenter-7-file-format-part-2/` | blog | — | How the format was reversed; `protoc --decode` walkthrough. |

### 2.9 Sample files saved (`vendor/pp7-samples/`, 5 files)

| File | From (commit) | Why |
|---|---|---|
| `chrismbarr_v7-feature-test.pro` | ChrisMBarr/ProPresenter-Parser `647db4a` (MIT) | Windows, 7.13.2. Shapes, images, web URL, coloured background, hotkeys. |
| `bes-migrator_windows-template-1.pro` | ioanlucut/bes-propres7-migrator `7cc7de8` (Apache-2.0) | Saved by ProPresenter for Windows; decoded text sits beside it upstream. |
| `bussnet_test-translated.pro` | bussnet/propresenter7-php-lib `22ea585` (MIT) | macOS, v20. Two text elements per slide (translation). |
| `bussnet_test-with-macro.pro` | same | macOS. Slide with a macro action. |
| `bussnet_pp-export.probundle` | same (`RestBildExportFromPP.probundle`) | A bundle: `Media/sample-media.png` + `TestBild.pro`. |

Treat as untrusted input. More are available upstream: `.pro4/.pro5/.pro6` in ChrisMBarr's `sample-files/`;
`.proplaylist` files, a full `Configuration` dump and a theme in bussnet's `doc/reference_samples/`.
None of these was captured from the newest release (22); get a real export from the church's own machine.

### 2.10 Other import formats

| Format | Notes | Priority |
|---|---|---|
| **Plain text / paste** | Blank-line-separated slides, auto-detect `Verse 1` / `Chorus` labels. Every tool has it; users expect it. | Must |
| **CCLI SongSelect `.txt`** | "Lyrics" download: title on line 1, labelled sections, then authors, CCLI song number, copyright, licence number at the foot. Simple Presenter also imports the same text from the clipboard. | Must |
| **CCLI SongSelect `.usr`** | INI-style: `[File]` header, `[S A<number>]` song section, `Title=`, `Author=`, `Copyright=`, `Themes=`, `Keys=`, `Fields=` (section names, `/t`-separated) and `Words=` (sections `/t`-separated, lines `/n`-separated) **[memory]**. Legacy but still in the wild. | Should |
| **ChordPro** (`.cho`, `.chopro`, `.pro` — beware the extension clash) | `{title:}`, `{start_of_chorus}`, inline `[C]` chords. Spec: https://www.chordpro.org/chordpro/. Gives chords for stage display. | Should |
| **OpenLyrics XML** | Open standard used by OpenLP: `<song>` → `<properties>` (titles, authors, `verseOrder`, `ccliNo`) and `<lyrics><verse name="v1"><lines>`. https://docs.openlyrics.org **[memory]**. Many tools export it, so it works as an interchange hub. | Should |
| **PowerPoint `.pptx`** | Two approaches seen: parse OOXML directly for text/backgrounds/formatting (EasyPresent, Simple Presenter), or drive PowerPoint/Keynote and capture slides as images (FreeShow's `slideshow` module). Image-per-slide is far more faithful; text extraction is editable. Offer both. | Should |
| **OpenSong XML, EasyWorship, OpenLP DB, Quelea, MediaShout** | For churches migrating from elsewhere. FreeShow's converter list is the checklist. | Later |
| **Planning Center Services** | Not a file: import the plan (items, songs, arrangements, attachments) by API. PCO items map to playlist `planning_center` entries in ProPresenter. | Should |
| **Bibles** | Zefania XML and OSIS for offline public-domain texts; api.bible for licensed ones. | Later |

---

## Part 3 — Output options in Electron (macOS / Windows)

### 3.1 Getting frames out of Electron

Everything except a plain window on a monitor starts with capturing a renderer's pixels.

| Method | Cost | Notes |
|---|---|---|
| Offscreen `BrowserWindow`, `paint` event → `NativeImage` bitmap (BGRA) | CPU copy per frame; fine at 1080p30, heavy at 4K60 | Simplest. Works everywhere. https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering |
| Offscreen with `webPreferences.offscreen.useSharedTexture: true` | GPU→GPU; frame arrives as a texture handle (D3D11 shared handle / IOSurface) | **Experimental.** Needs a native addon to consume the handle; you must release each texture promptly or the pool drains; release only in the main process. Electron's example: `spec/fixtures/native-addon/osr-gpu`. FreeShow uses this when available and falls back. **[verified: Electron docs via search + FreeShow source]** |
| `webContents.capturePage()` | Slow | Thumbnails only. |

Recommendation: start with bitmap `paint` in a dedicated offscreen window per network output, hand the buffer to
a `worker_thread`, and treat shared-texture as a later optimisation. Render capture outputs at an explicit
resolution, never at a monitor's size (FreeShow hit a Linux bug where a window matching the display size lost 1px,
and NDI rejects odd widths).

### 3.2 NDI

| Package | Latest | License | Status |
|---|---|---|---|
| `@stagetimerio/grandiose` — https://github.com/stagetimerio/grandiose | 0.2.1, 2026-10-12 | Apache-2.0 | **Recommended.** Maintained, used in production in an Electron app (Stagetimer). Send + receive + find, NDI SDK 6, TS types, Win x64 / macOS x64+arm64 / Linux. Downloads the SDK at `npm install`; ships `dist/` with `grandiose.node` + `libndi`. Needs `electron-rebuild` and asar-unpack of `dist/`. **[verified: README, npm]** |
| `grandi` — https://github.com/tux-tn/grandi | 2.0.2, 2026-07-30 | Apache-2.0 | TypeScript-first, NDI 6. Solid second choice **[snippet + npm]**. |
| `rse/grandiose` | — | Apache-2.0 | The consolidation fork both of the above derive from; now effectively unmaintained per Stagetimer. |
| `grandiose` (Streampunk, npm) | 0.0.4, 2018 | Apache-2.0 | Abandoned; receive-only. |
| `grandiose-mac` | 0.0.6, 2023 | Apache-2.0 | Stale. |
| `github:ChurchApps/grandiose` | git pin | Apache-2.0 | What FreeShow ships. Not on npm. |

Lineage: Streampunk → ianshade (sender, types) → danjenkins (macOS) → rse (SDK 6, audio) → stagetimerio / grandi.

**NDI SDK licensing** (https://docs.ndi.video/docs/sdk/licensing, `/software-distribution`) **[snippet — read
the licence PDF in the SDK before shipping]**:
- The standard SDK is royalty-free for free and commercial products.
- Redistributing the runtime library requires your EULA to incorporate NDI's required terms, and the app must
  meet NDI's branding/identification rules (NDI® trademark notice, link to ndi.video).
- The SDK is proprietary. Its headers are MIT-licensed specifically so open-source projects can ship them and
  **load the NDI library dynamically at runtime**. If Reach Presenter is ever GPL, do not bundle `libndi`;
  locate the user's NDI runtime or download it on request with the licence shown (Simple Presenter does this).
- The Advanced SDK (needed for things like custom codecs/HX encode) requires a vendor agreement.
- **OMT** (Open Media Transport) is an open alternative FreeShow already supports via `openmediatransport`; worth
  tracking, but NDI is what switchers and OBS/vMix users expect today.

**NDI input** uses the same library (find + receive) and renders into a canvas/WebGL texture. Lower priority than output.

Practical notes: send BGRA or convert to UYVY in the worker; mark alpha correctly for key/fill; let the NDI
sender clock the video (`clockVideo`) so frame pacing is steady; advertise a stable source name per output.

### 3.3 Syphon (macOS) and Spout (Windows)

- **Syphon**: `node-syphon` 1.5.5 (2026-10-11, MIT) — https://github.com/benoitlahoz/node-syphon. Publishes
  from pixel buffers or, in Electron, from **IOSurface handles** (pairs with `useSharedTexture`). Receiving shared
  textures in Electron was waiting on https://github.com/electron/electron/pull/46811. Intel + Apple Silicon.
  There is an Electron example repo. **[verified: README, npm]**
- **Spout**: no maintained npm package found. An Electron maintainer mentions using a private Spout plugin with
  shared textures. Doing this means writing a small N-API addon against https://github.com/leadedge/Spout2
  that takes the D3D11 shared handle from `textureInfo`. **[snippet]**
- Both are same-machine, zero-latency texture sharing for OBS / Resolume / mapping tools. Useful, niche. NDI on
  localhost covers most of the same uses with one implementation. Defer.

### 3.4 Blackmagic DeckLink

- `macadam` (Streampunk, Apache-2.0) is the only Node binding; npm's 2.0.18 dates from 2022-03. FreeShow builds
  from `github:vassbo/macadam`. `@julusian/macadam` does not exist on npm. **[verified: npm]**
- Requires Blackmagic Desktop Video drivers on the machine; the DeckLink SDK has its own licence. Supports
  playback, capture, and key/fill on capable cards.
- ChurchPresenter instead shells out to a bundled **ffmpeg** for capture devices — less elegant, far fewer
  rebuild problems, and ffmpeg's `decklink` output device exists too (needs a build with it enabled).
- Recommendation: do not build this for v1. An SDI output today is more cheaply reached with a full-screen
  window on an HDMI output through a converter, or NDI into a hardware decoder. Revisit on real demand, and
  design the output abstraction so a DeckLink sender slots in like NDI.

### 3.5 Network TVs

| Route | Verdict | Detail |
|---|---|---|
| **Browser receiver page** (TV / Raspberry Pi / Fire stick opens `http://host:port/output/<id>`) | **Do this.** | Send *state*, not video: the receiver is the same renderer code as a local output window, fed slide/layer state over WebSocket, pulling media over HTTP from the app. Text changes arrive in tens of ms on a LAN. |
| **Google Cast** | Possible, second | A custom Web Receiver is just a hosted HTML page, so it can load our receiver URL. Needs a registered Cast app ID, and the receiver must be served over HTTPS from a public origin (which then connects back to the LAN host — mixed-content and private-network rules bite). Node senders: `castv2-client` (2016), `chromecast-api` (2023) — both stale. *Mirroring*-style casting measures 1–13 s of latency **[snippet]**; state-driven pages avoid that. Receivers idle-timeout unless kept alive. |
| **AirPlay** | Don't implement | No supported third-party sender for screen mirroring; AirPlay 2 mirroring is proprietary and encrypted, and `airplay-protocol` on npm is from 2016. On macOS the user can add an Apple TV as a wireless display in the OS, after which it appears to Electron as an ordinary `Display` — support that path for free, and warn about latency (~100–300 ms, variable) **[memory]**. |
| **DLNA / UPnP** | Don't | It pushes media files/streams to a renderer; no live composited page, seconds of buffering. `node-ssdp` is from 2020. |
| **Miracast** (Windows "wireless display") | Free via OS | Same as AirPlay: appears as a display. |

**Sync and latency design for the receiver page**
- One WebSocket per receiver; messages are small state diffs with a monotonically increasing sequence number.
  On reconnect the receiver asks for a full snapshot. Never rely on having seen every message.
- **Clock sync**: do an NTP-style ping exchange on connect and periodically; schedule transitions and video
  starts as "at server time T" rather than "now". This is what keeps two TVs from being visibly out of step.
- **Preload**: send "next" before "go" so images and fonts are decoded before the cue fires.
- **Video**: serve files with HTTP range requests; start at a scheduled time, then nudge `playbackRate`
  (±2–5%) to hold drift under a frame or two instead of seeking. Expect smart-TV browsers to lack codecs,
  refuse autoplay with sound, and throttle. Keep audio on the main machine. For genuinely frame-accurate video
  on several screens, use real outputs or NDI.
- **Device reality**: TV browsers are old Chromium/WebKit with little RAM. Ship an ES2017-compatible receiver
  bundle, avoid heavy blur/filters, test on an actual Fire stick and a Pi 4. Use the Wake Lock API and a
  full-screen kiosk hint. A Pi in Chromium kiosk mode is the dependable option; consumer TV browsers are a bonus.
- **Security**: bind to the LAN, put an unguessable token or a pairing code in the URL, make control endpoints
  separate from display endpoints. "Approve a tablet once, then it reconnects on its own" (ministry-stage) is the right UX.
- **Fallback**: an MJPEG or WebRTC stream of the rendered output for receivers that cannot render locally
  (FreeShow has both an `OUTPUT_STREAM` server and a WebRTC host).

### 3.6 mDNS / Bonjour discovery

| Package | Latest | Notes |
|---|---|---|
| `bonjour-service` (MIT) | 1.4.4, 2026-07-28 | Pure JS, TypeScript, publish + browse. What FreeShow uses. Default choice. |
| `@homebridge/ciao` (MIT) | 1.4.0, 2026-11-01 | RFC-compliant **advertiser only**, very actively maintained, handles conflicts and interface changes well. Best if we only need to publish. |
| `multicast-dns` (MIT) | 7.2.5, 2022 | Low-level; what `bonjour-service` builds on. |
| `dnssd` (2018), `ciao` (2018), `mdns` (native, needs Bonjour SDK on Windows) | stale | Avoid. |

Notes **[verified where from FreeShow source; otherwise memory]**:
- Pure-JS mDNS on macOS competes with the system `mDNSResponder` for port 5353. FreeShow special-cases the Mac.
  Test publish and browse on macOS specifically.
- macOS 15+ prompts for **Local Network** permission; add `NSLocalNetworkUsageDescription` and
  `NSBonjourServices` to `Info.plist`. Windows Firewall prompts on first listen.
- Publish distinct service types (e.g. `_reach-stage._tcp`, `_reach-remote._tcp`) with the port and a TXT record
  carrying version and instance name. Also advertise `_http._tcp` so generic browsers find the page.
- Use the same browser to *find* things: NDI sources are discovered by the NDI library itself, but ProPresenter
  instances, Companion, and PCO Live helpers show up on mDNS.
- Enterprise and guest Wi-Fi often block multicast or isolate clients. Always show the IP URL and a QR code too.

### 3.7 MIDI

| Option | Verdict |
|---|---|
| **Web MIDI in the renderer** | Works in Electron with no native module. Since Chromium 124 the whole API is permission-gated: handle `midi` and `midiSysex` in `session.setPermissionRequestHandler` **and** `setPermissionCheckHandler`. Hot-plug via `onstatechange`. Limits: lives in a renderer (dies with the window), cannot create virtual ports, and there are reports of the permission handler alone not being enough **[snippet: Chrome blog, Stack Overflow]**. |
| **`jzz`** (MIT, 1.9.6, 2025-09) | Wraps Web MIDI and its own `jazz-midi` native addon behind one API; runs in main or renderer; FreeShow's choice. Good hedge. |
| **`@julusian/midi`** (MIT, 3.8.1, 2026-08) | Maintained fork of `node-midi` (RtMidi) with prebuilt binaries, by the Bitfocus Companion maintainer. Supports **virtual ports** on macOS/Linux. The best native option. |
| `easymidi` (MIT, 3.2.0, 2026-03) | Friendly message-level wrapper; check which `midi` build it pulls in. |
| `midi` (node-midi, 2.0.0, 2021) | Stale; use the Julusian fork. |

Recommendation: run MIDI in the main process (or a utility process) behind our own small interface, backed by
`@julusian/midi`, so cues keep firing when a window reloads and so we can expose a virtual "Reach Presenter"
port for DAWs/Ableton. Windows has no native virtual ports (users need loopMIDI). Consider rtpMIDI/network MIDI
and OSC alongside; most church control surfaces go through Bitfocus Companion, so an HTTP/WebSocket/OSC API
matters more than MIDI.

### 3.8 Persisting display identity across reconnects

**The problem.** Electron's `Display` (https://www.electronjs.org/docs/latest/api/structures/display) exposes
`id`, `label`, `bounds`, `size`, `scaleFactor`, `rotation`, `internal`, `displayFrequency`, `colorSpace`,
`detected` and a few more — **no EDID, serial, or connector**. **[verified]**

- `id` comes from Chromium. On macOS it is the `CGDirectDisplayID`, which Apple documents as generally stable
  only until restart and partly dependent on which port is used. On Windows Chromium derives it from adapter
  and per-adapter monitor IDs — stable across configuration changes, not across device restarts. On Linux/X11
  it is derived from EDID when parseable, else the display index. **[snippet: Apple docs, Chromium
  `ui/display/win/display_info.cc`, Electron #33861]**
- Two identical projectors or TVs often report identical EDIDs (many have no serial), so even EDID does not
  distinguish them. HDMI splitters, switchers and extenders replace the EDID with their own.
- Display order in `getAllDisplays()` is not stable; Electron #42031 reports `screen` IDs and `desktopCapturer`
  `display_id` disagreeing on 3-monitor setups.
- `label` is the friendly name (e.g. "DELL U2720Q", "Built-in Retina Display") and has been in Electron since v13 **[memory]**.

**What others do**
- **FreeShow**: saves `display.id` as a string plus bounds; on any display event snaps each output to the
  display nearest its saved centre. Position-based in practice.
- **ProPresenter**: `Configuration/Workspace` stores per-output `name`, `model`, `serial`, `deviceName`, `vendor`,
  `render_id` and `mode`; a missing device leaves the screen "not configured" rather than moving it.
- **Simple Presenter**: binds a screen to a display *by name* (`HDMI-A-1`); while unplugged the screen is not
  shown and settings say so; "plugged in again, it is back".
- **Zed** (editor): notes screen IDs are unstable across restarts and uses `CGDisplayCreateUUIDFromDisplayID` on macOS **[snippet]**.

**Recommended approach**
1. Store a **fingerprint** per assigned output, not an id:
   `{ id, label, internal, size (native px), scaleFactor, rotation, bounds origin, displayFrequency }`
   plus, where a tiny native helper is available, a hardware key —
   macOS `CGDisplayCreateUUIDFromDisplayID` (+ vendor/model/serial from `CGDisplay*`);
   Windows the monitor device path from `QueryDisplayConfig`/`EnumDisplayDevices` (includes EDID manufacturer
   and product codes and a per-connector instance).
2. On startup and on every `display-added` / `display-removed` / `display-metrics-changed`, **score** each live
   display against each saved fingerprint: hardware key > `id` > `label` + native size > position relative to
   primary. Assign greedily; break ties between identical displays by position.
3. **Never auto-assign an output to the internal/operator display.** If nothing matches confidently, leave the
   output unassigned, show a clear banner, and keep rendering to its offscreen/preview target.
4. Debounce display events (~500–1000 ms). A projector powering on produces a burst of add/remove/metrics
   events, and macOS rearranges bounds mid-burst.
5. When the display returns, re-attach automatically without operator action, and without stealing focus.
6. Provide **Identify** (big number on each output) and a manual override that updates the fingerprint.
7. Output windows: create frameless at the display's `bounds`, then `setBounds` again after show (mixed-DPI
   Windows setups mis-size on first placement); prefer a borderless always-on-top window over native
   fullscreen on macOS so no new Space is created; require "Displays have separate Spaces" awareness in docs.
   FreeShow's levels (`screen-saver` on Windows, `pop-up-menu` on macOS, `panel` type on macOS) are a tested
   starting point.
8. Recommend an EDID emulator/"ghost" for installs with flaky HDMI runs; it removes the problem at the source.

---

## Recommendations in brief

**Landscape.** Build the output as an HTML renderer that runs identically in a local window, an offscreen
capture window and a remote browser. Copy FreeShow's breadth of outputs and importers but not its dependency on
personal forks; copy Simple Presenter's ProPresenter fidelity and its Looks/layer model; copy WorshipSync's
offline-first SQLite simplicity. Invest in reliability ahead of features.

**Formats.** Generate TypeScript from `vendor/pp7-proto/autogen-proto` with `ts-proto`, keep unknown fields, and
ship **import** for `.pro`, `.proplaylist`, `.probundle` and whole-library folders first, with `.pro6` via
ChrisMBarr's parser. Write a proper RTF tokenizer handling both the Cocoa and Windows dialects. Resolve media
root-relative → absolute → by-name. Handle the ZIP64 offset quirk. Also import plain text, SongSelect, ChordPro,
OpenLyrics and PPTX.

**Outputs.** v1: display windows with fingerprint-based display matching, a browser receiver/stage page over
WebSocket with clock sync, mDNS via `bonjour-service` plus IP/QR fallback, NDI out via `@stagetimerio/grandiose`
in a worker with the NDI runtime loaded dynamically, and MIDI via `@julusian/midi` in the main process. Later:
shared-texture capture, Syphon (`node-syphon`), Spout (own addon), DeckLink, Cast. Skip AirPlay and DLNA as
protocols; let the OS present them as displays.
