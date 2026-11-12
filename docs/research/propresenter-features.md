# ProPresenter feature inventory (parity checklist)

Researched 2026-11-12. Covers Renewed Vision ProPresenter from 7.0 through version 22 (released 2026-11-05).

**Version naming.** "ProPresenter 7" stopped being the version label after 7.16.3 (mid-2024). Releases since then are numbered 17, 18, 19, 20, 21, 21.x and 22, and the product is just "ProPresenter". Everything below describes the current product unless a version is named.

**How to read this file**

- Each bullet is one feature. Tags give priority for a typical church running Sunday services:
  - `[CORE]` needed every Sunday
  - `[COMMON]` used by many churches, but not every week or not by every church
  - `[NICHE]` broadcast, large-venue, or specialist use
- `(unverified)` means I could not confirm the feature or the detail in a primary source during this research. Treat it as a lead, not a requirement.
- `(vN)` after a feature is the version that introduced it, where the source states one.
- Priority tags are my judgment, not Renewed Vision's.

**Source limits.** The official ProPresenter 7 user guide PDF and `learn.renewedvision.com` were unreachable (the guide now redirects to the knowledge base). The inventory is built from all 156 knowledge base articles, the full OpenAPI spec, the release notes page, release blog posts for 7.0 and 7.4 to 7.10, and Reddit. Detailed release notes for 7.11 to 7.16 and 17 to 21 were only available as headlines, so some editor-level details (shape types, effect lists, exact inspector fields) are marked unverified.

---

## 1. Application shell and modes

- [CORE] **Show mode** — main operating view; clicking any slide sends it live immediately.
- [CORE] **Edit mode** — slide editor for the selected presentation.
- [CORE] **Reflow mode** — text-first editor for a whole presentation (see section 5).
- [COMMON] **Bible mode** — scripture browser and slide generator (see section 7).
- [COMMON] **"More" editors menu** — opens the Stage Editor, Theme Editor, CCLI (copyright) Editor, Props Editor and Masks Editor.
- [CORE] **Fixed toolbar** — Search, Text, Theme, mode buttons, ProContent, Media, Looks, Live (capture), Audience and Stage toggles, Notifications, Status.
- [CORE] **Three-pane layout** — library/playlist outline and item list on the left, slides in the center, preview plus clear buttons plus show controls on the right, media bin along the bottom.
- [CORE] **Preview window** — shows live output; a dropdown picks which screen to preview.
- [CORE] **Transport controls under the preview** — scrub, play/pause, skip back/forward 15 s, go to end, for the presentation, announcement and audio layers.
- [COMMON] **Configurable go-to-end button** — right-click to jump to 0, 10, 30, 60 or 90 seconds before the end.
- [CORE] **Show Controls panel** — bottom-right tabs for Audio Bin, Stage, Timers, Messages, Props and Macros; tabs can be reordered with Cmd/Ctrl-drag (7.5, 7.6).
- [CORE] **Audience and Stage toggle buttons** — turn all system (graphics) audience or stage outputs on or off; SDI, NDI and Syphon outputs are always on.
- [COMMON] **Active Look indicator and picker in the toolbar** — shows and changes the live Look (7.9).
- [COMMON] **Collapsible outline panes** — library and media bin outlines collapse to a dropdown navigator.
- [COMMON] **Slide size slider** — scales thumbnails in the slide area and media bin.
- [COMMON] **Notifications feed** — in-app account and product update notices (v19+).
- [COMMON] **Status popover** — active account, active workspace, sync progress, pause/restart of the media manager.
- [COMMON] **Dark interface** — single dark theme designed for booth use.
- [COMMON] **Interface languages** — English, Spanish, Portuguese, French, German, Korean, Norwegian, Czech, Simplified Chinese, Russian; follows OS language, with an override on Windows.
- [COMMON] **House of Worship toggle** — one setting hides Bibles, SongSelect, MultiTracks, Planning Center and copyright display for non-church users.
- [COMMON] **Welcome/onboarding window** — first-run setup including the House of Worship choice and sign-in.
- [COMMON] **In-app support window** — opens a support ticket and gathers system data via a helper tool (7.15).
- [COMMON] **Sample content download** — optional starter library and media.
- [NICHE] **Find My Mouse** — highlights the cursor; also an API call.
- [NICHE] **Download manager window** — Windows only.
- [NICHE] **Kiosk mode** — (unverified) no kiosk or operator-lock mode appears anywhere in the current knowledge base or release notes; assume it does not exist.

## 2. Libraries, playlists and search

- [CORE] **Libraries** — named collections of presentations; multiple libraries allowed.
- [CORE] **Playlists** — ordered service plans built from presentations in any library.
- [CORE] **Playlist folders** — group playlists in the outline.
- [CORE] **Add to playlist** — drag from a library, right-click "Add to", or drag from search results to an exact position.
- [CORE] **Playlist headers** — section dividers such as "Worship" or "Message"; a header can also start a timer.
- [COMMON] **Playlist placeholders** — empty slots to be filled later; files can be dropped onto a placeholder (7.7).
- [COMMON] **Playlist templates** — save a playlist's structure and create new playlists from it (7.10).
- [CORE] **Media items in playlists** — standalone videos, images and audio sit in the running order beside presentations.
- [COMMON] **Stream items in playlists** — an HLS video or audio stream as a playlist item (v22).
- [CORE] **Continuous playlist view** — shows every item's slides in one scrolling view; toggle in the View menu.
- [CORE] **Quick Search** — Cmd/Ctrl+F searches all libraries with a text or thumbnail preview of the result (7.7).
- [COMMON] **Search SongSelect and MultiTracks from the same window** — import straight from results.
- [COMMON] **Add search result to playlist** — Cmd/Ctrl+Enter.
- [COMMON] **Reveal in Library / Show Triggered Presentation / Show Triggered Announcement** — jump to the item that is live.
- [COMMON] **Per-playlist arrangement choice** — the same song can use a different arrangement in each playlist.
- [COMMON] **Linked calendar indicator** — a calendar icon marks playlists scheduled by the Calendar.
- [COMMON] **Planning Center playlists and APlay playlists** — externally sourced playlists marked with the provider's logo (see section 21).
- [COMMON] **Operator notes** — notes on a playlist item, shown to the operator and available as stage linked text.
- [COMMON] **Workspaces** — a workspace is a complete set of libraries, playlists, media, themes and show controls; switch between workspaces in the workspace manager (v20).
- [NICHE] **Print** — File > Print for a presentation (details unverified).

## 3. Presentations, slides, groups and arrangements

- [CORE] **Presentations** — a document of slides (song, sermon, announcement loop) with its own size, background and transition.
- [CORE] **Slide grid** — click to trigger; arrow keys or space bar to advance.
- [CORE] **Slide views: Grid, Table, Easy** — Grid shows true thumbnails; Table shows text beside a thumbnail with notes; Easy renders operator-friendly text on the thumbnail without changing output.
- [COMMON] **View options** — "Slides by Group" rows, thumbnail background color, table font/size/color/alignment, and truncation from start, middle or end.
- [COMMON] **Media thumbnails in Easy View** — optionally show media actions (7.9).
- [COMMON] **Hold `~` to peek at Easy View from Grid View.**
- [COMMON] **View switching from the View menu, with mappable keys** (21.3).
- [CORE] **Groups** — label and color runs of slides as Verse 1, Chorus, Bridge and so on; SongSelect imports arrive grouped.
- [COMMON] **Custom group names and colors** — "Other" lets you define your own; global groups are exposed by the API.
- [CORE] **Arrangements** — reorder and repeat groups without duplicating slides; a Master arrangement plus any number of named ones.
- [COMMON] **Arrangement Manager** — create, rename, duplicate and delete arrangements; group tokens are colored to match.
- [CORE] **Group hot keys** — single keys jump to a section (for example C for chorus, B for bridge, A/S/D/F for verses 1 to 4); source is Renewed Vision's volunteer guide.
- [COMMON] **Jump to slide by number** — type a number and press Enter.
- [COMMON] **Per-slide hot keys** — (unverified in the current KB) a hot key icon appears on slide thumbnails.
- [COMMON] **Slide labels** — a name and color on an individual slide, editable by right-click (7.5); usable as linked text.
- [COMMON] **Slide notes** — per-slide notes, visible in Table View and on stage layouts.
- [COMMON] **Enable/disable slides** — (unverified in the KB) skip a slide without deleting it; Reddit users describe relying on it.
- [COMMON] **Go to Next timer** — auto-advance a slide after a set time, with "Loop to Beginning" on the last slide for loops.
- [COMMON] **Cancel auto-advance** — available in the API and as an action.
- [CORE] **Presentation destination: Presentation or Announcements** — a target icon in the header sends the whole presentation to the announcements layer.
- [COMMON] **Slide Destination "Stage Only"** — send slides to stage screens while the audience keeps the previous slide; Cmd/Ctrl+0, menu, or action.
- [COMMON] **Presentation size and resolution-mismatch warning** — a yellow warning appears when the presentation size matches no configured screen, with a one-click fix.
- [COMMON] **Missing-media and text-overflow warnings on slides** — hover for the cause; relink or grow the box.
- [COMMON] **Quick Edit** — right-click a slide to fix text without opening the editor.
- [COMMON] **Copy/paste/duplicate slides, multi-select, drag to reorder.**
- [COMMON] **Background colors at slide and presentation level** — these sit above the media layer since 7.11 and can hide backgrounds; "Ignore Background Colors" is a setting.
- [COMMON] **Chord charts** — attach a chord chart image to a slide for stage display; exposed through the API.
- [COMMON] **Native chords on lyrics** — chords stored with the text and shown above words on stage in chord, number or numeral notation (via MultiTracks import).
- [COMMON] **Automatic spell check** (7.10), plus the OS dictation and emoji pickers on macOS.
- [COMMON] **Undo/redo.**

## 4. Slide editor

### Canvas and objects

- [CORE] **Text boxes** — add, move, resize, rotate; multiple per slide.
- [CORE] **Shapes** — rectangles, ellipses and other shapes with adjustable properties (full shape list unverified).
- [CORE] **Image and video objects on the slide layer** — media as slide elements, distinct from the media layer.
- [COMMON] **Live video input object** — place a camera or other input inside a slide.
- [COMMON] **Editor toolbar for adding objects** (updated v18).
- [COMMON] **Object list** — rename, hide, lock, delete and drag to change stacking order.
- [COMMON] **Arrange commands** — bring forward/backward, to front/back.
- [COMMON] **Alignment tools, guides and rulers.**
- [COMMON] **Objects placed off-canvas** — stay with the slide but do not render.
- [COMMON] **Fit slide to window / zoom.**
- [COMMON] **Slide navigator** — thumbnails of all slides down the left of the editor.
- [COMMON] **Inspector tabs** — Presentation/Slide (size, background, transition), Shape, Text, Build.

### Shape properties

- [CORE] **Fill: solid color.**
- [COMMON] **Fill: gradient.**
- [COMMON] **Fill: media** — image or video inside any shape, with its own scaling mode.
- [COMMON] **Fill: Background Blur** — blurs the media or live video behind the object, with blur and saturation controls (7.11).
- [COMMON] **Fill: Color Invert** — inverts what is behind the object; stackable with blur (7.11).
- [COMMON] **Stroke, shadow, feathering, opacity, corner radius** (corner radius unverified).
- [NICHE] **Fill: web page** — confirmed for stage layouts; (unverified) for audience slides.
- [COMMON] **Visibility rules** — show or hide an object when a condition is true, for example "video countdown is playing".

### Text formatting

- [CORE] **Font, style, size, color, alignment (horizontal and vertical).**
- [CORE] **Bold, italic, underline; character spacing; line and paragraph spacing.**
- [CORE] **Text stroke and shadow.**
- [CORE] **All caps and other capitalization transforms** — applied as a style, the stored text keeps its original case.
- [CORE] **Automatic text scaling** — shrink text to fit its box.
- [COMMON] **Gradient text fill** (7.5).
- [COMMON] **Text Cut Out** — letters become transparent holes revealing the background (7.12).
- [COMMON] **Media fill for text** — video or image plays inside the letters, with effects, invert, blur and saturation (7.12).
- [COMMON] **Line fills** — a colored bar behind each line, fitted to box width or to text width (7.4).
- [COMMON] **Custom underline color and text background color** (7.5).
- [COMMON] **Lists** — bullet and numbered list attributes.
- [COMMON] **Copy and paste text style; paste and match style.**
- [COMMON] **Remove line returns** — flatten paragraphs to one line, used for tickers.
- [COMMON] **Scrolling text** — any direction, speed, start position, edge feathering, repeat and gap distance (7.6).
- [COMMON] **Text animations** — builds that reveal text by character, word or line, with direction, follow-on motion, style and duration; delivery by bullet or by fill-in-the-blank underline (v22).

### Linked text (dynamic data tokens)

- [CORE] **Timer and clock values** — any timer, the system clock, the video countdown.
- [COMMON] **Timer format control** — per-segment display of hours, minutes, seconds and milliseconds, with or without leading zeros, or collapsed into the next unit.
- [COMMON] **Timer color triggers** — text changes color at set remaining times and on overrun.
- [COMMON] **Current and next slide text, slide notes, slide image.**
- [COMMON] **Slide label text and color; group name and color.**
- [COMMON] **Presentation name; current and next playlist item; current and next header.**
- [COMMON] **Slide count** — current number, remaining, total.
- [COMMON] **Auto-advance (Go to Next) time remaining** — for the presentation or announcement layer.
- [COMMON] **Audio countdown; video countdown for the announcement layer** (7.5).
- [COMMON] **Capture status and elapsed capture time.**
- [COMMON] **Playback marker name and time to marker.**
- [COMMON] **Operator notes.**
- [COMMON] **Text file source** — pull text from a `.txt` file on disk (7.6).
- [COMMON] **RSS feed source** — titles only or titles and descriptions, with a custom delimiter (7.6).
- [COMMON] **Stage message** — the current stage message as text.

### Builds and transitions

- [COMMON] **Object builds** — build-in and build-out per object, started with the slide, after the transition, or on click.
- [COMMON] **Build order list** — sequence of on-click reveals, used for sermon points.
- [CORE] **Global slide transition** — cut, dissolve (0.1 to 5 s), or anything from the Advanced Transitions window.
- [CORE] **Global media transition** — a separate default for the media layer.
- [COMMON] **Presentation-level and slide-level transition overrides**, each with a "Default" reset.
- [COMMON] **Per-media-cue transitions** — set in the media inspector.
- [COMMON] **Separate transitions for Props, Bibles and Messages.**
- [COMMON] **Advanced Transitions window** — transition list with parameters, drag-to-preview, filter by type or recent.
- [COMMON] **Favorite transitions** — save a named, parameterized transition.

### Themes and templates

- [CORE] **Themes** — a named set of theme slides (templates) holding text styles, shapes and media.
- [CORE] **Theme Editor** — the same tools as the slide editor, focused on styling.
- [CORE] **Apply a theme** — to one slide, a selection, a whole presentation or a whole library.
- [COMMON] **Theme application is a one-time copy** — slides do not update when the theme is edited later, unless the theme is applied to a screen through a Look.
- [COMMON] **Theme media actions** — a theme can carry a background on the media layer; toggle whether it is applied (7.11).
- [COMMON] **Themes applied per screen in Looks** — reformat the same slide for a lower third or stage without touching the presentation.
- [COMMON] **Maintain text attributes** — bold, italic, underline and color on part of a text box survive an alternate theme; position and size follow the theme (7.7).
- [COMMON] **Text box naming** — named boxes let Bibles and themes map content to the right box.
- [COMMON] **Bundled themes** — including "Bright Side", which ships with text animations (v22).
- [COMMON] **Rename and delete themes.**
- [COMMON] **Themes for sale and free in ProContent.**

### Stickers

- [COMMON] **Stickers by ProContent** — searchable library of animated graphics dropped onto slides, restyled with media effects and revealed with builds (v22).

## 5. Reflow editor

- [CORE] **Whole-presentation text view** — all slide text in one column beside live thumbnails.
- [CORE] **Insert slide break** — Option/Alt+Return splits a slide at the cursor.
- [CORE] **Merge slides** — Delete at the start of a slide joins it to the previous one.
- [CORE] **Edits apply in real time** to the presentation.
- [COMMON] **Per-slide menu** — set group, transition and theme from the reflow list.
- [COMMON] **Thumbnail size slider.**

## 6. Songs: import, copyright and reporting

- [CORE] **SongSelect search and import** — by title, author, keyword or CCLI number, with a lyric preview that does not count against the account; needs a CCLI license and a SongSelect subscription.
- [CORE] **Import options** — lines per slide and target library and theme at import (details unverified for SongSelect; MultiTracks offers 1, 2, 3 or 4 lines).
- [CORE] **Copyright metadata per presentation** — title, author, publisher, copyright year, CCLI song number, edited in the CCLI Editor.
- [CORE] **Automatic copyright display** — shows copyright on the first slide, last slide or all slides (choice of slide confirmed, exact options unverified), with a token-based layout and a positionable template.
- [CORE] **Church CCLI license number setting.**
- [COMMON] **CCLI auto-reporting** — reports each song once per day when a slide of it is triggered, with a status color per entry (7.12).
- [COMMON] **CCLI usage report** — viewable, exportable and resettable.
- [COMMON] **MultiTracks search and import** — lyrics, chords and MIDI automation cues, depending on the MultiTracks plan (7.8).
- [COMMON] **Key selection at MultiTracks import** — sets the key used for stage chords.
- [COMMON] **Text file import** — `.txt` and `.rtf`, with "slides delimited by" line break, paragraph break or custom marker, and delimiters per slide.
- [COMMON] **Word import** — `.doc` and `.docx` (per the v7 guide as quoted in search results; unverified in the current KB).
- [COMMON] **Import text from clipboard** — same options as file import.
- [COMMON] **Legacy ProPresenter import** — `.pro6` and `.pro5` documents; migration from Pro 5 and Pro 6 libraries.
- [COMMON] **Multi-language songs** — (unverified as a dedicated feature) done with one text box per language plus per-screen themes; Bibles have true multi-translation support.

## 7. Bibles

- [CORE] **Bible browser** — pick translation, then book and chapter, or type a reference.
- [CORE] **Shorthand reference parsing** — "Matt 1 2 3" resolves to Matthew 1:2-3.
- [COMMON] **Keyword search** within a translation.
- [CORE] **Generated slides with a theme** — verse text and reference mapped to named text boxes.
- [CORE] **Send to screen directly from the Bible view.**
- [CORE] **Save as Presentation / Copy to Current Presentation / Save to Playlist.**
- [COMMON] **Previous Verse and Next Verse buttons** — extend a passage live, crossing chapter boundaries.
- [COMMON] **Show verse numbers.**
- [COMMON] **Break on new verse** — one verse per slide.
- [COMMON] **Display translation name.**
- [COMMON] **Preserve font color** — keeps red-letter text.
- [COMMON] **Reference placement** — on each verse, the passage on each slide, the passage on the last slide only, or none; reference in its own box or with the verse.
- [COMMON] **Multiple translations on one slide** — any number, each mapped to its own text box; forces one verse per slide.
- [COMMON] **Bible-specific transition.**
- [COMMON] **Target library for saved scripture.**
- [COMMON] **Free public-domain Bibles** — install in-app with no license.
- [COMMON] **Purchased Bibles** — bought per translation in-app or from the store and tied to the account; 130+ translations in 25+ languages.
- [COMMON] **Install and remove translations in-app** — needs internet.
- [COMMON] **Bibles usable on editor seats** (7.4).
- [NICHE] **Some translations unavailable** — NIV 1984 and HCSB are no longer sold.

## 8. Media bin and media playback

- [CORE] **Media bin** — videos and images organized into playlists and playlist folders.
- [CORE] **Grid or list view, thumbnail size slider, name filter.**
- [COMMON] **Smart playlists** — mirror a folder on disk and update automatically.
- [COMMON] **Video Inputs playlist** — a fixed playlist of configured live inputs.
- [CORE] **Background versus foreground behavior** — backgrounds persist under slides and usually loop; foregrounds play once over everything on the media layer.
- [CORE] **Next/previous background shortcuts.**
- [CORE] **Supported formats** — JPEG, PNG, TIFF, HEIC; MOV and MP4 with H.264, H.265, ProRes (422 family, 4444) and HAP (HAP, HAP Q, HAP Alpha); MP3, AAC, WAV; RGB only.
- [COMMON] **Alpha-channel video** — ProRes 4444 and HAP Alpha.
- [COMMON] **Hardware decoding** of H.264 and H.265 on macOS (7.10).
- [CORE] **Scaling modes** — Scale to Fit, Scale to Fill, Stretch to Fill, Scale and Blur (7.16).
- [COMMON] **Import presets** — defaults for scaling, foreground/background, image duration (none, fixed, random), video end behavior and audio end behavior.
- [COMMON] **Media inspector** — preview, info, custom thumbnail, properties, transition, effects, audio, markers.
- [COMMON] **In and out points, play rate, start delay.**
- [COMMON] **Alignment, cropping, rotation and flip** (flip unverified).
- [COMMON] **End behavior** — stop, loop, play next and related options (exact list, including soft loop, unverified).
- [COMMON] **Retrigger rules** — Automatic, Always or Never; by default a looping background does not restart when clicked again (7.4, 7.13.1).
- [COMMON] **Video effects and effect presets** — per-cue effects such as color adjustment and blur (full list unverified).
- [COMMON] **Playback markers** — named, colored markers on video and audio that fire actions, appear on the scrub bar, and allow jumping (7.10).
- [COMMON] **Media actions on slides** — attach a background or foreground to a slide so it fires with the slide.
- [COMMON] **Trigger a media bin or audio bin playlist from a slide action.**
- [COMMON] **Stream actions** — play an HLS (`.m3u8`) video or audio stream, live or on demand, with URL validation (v22).
- [COMMON] **Manage Media Automatically** — copy imported media into the workspace so links do not break.
- [COMMON] **Search paths** — relink missing media by root plus relative path, cross-platform.
- [COMMON] **Manual relink of missing media.**
- [COMMON] **Clean Up Unlinked Media** — delete media nothing references (v19).
- [COMMON] **Enhanced media search** (7.15).
- [COMMON] **ProContent in the media bin** — browse, search and download Renewed Vision's stock library; a free tier is included (7.13).
- [NICHE] **"Select for Communications"** — mark the one media playlist that AMP and CITP devices control.
- [NICHE] **Web/YouTube playback** — not supported; Renewed Vision recommends local files.
- [NICHE] **PDF import** — explicitly not supported.

## 9. Layers and clearing

- [CORE] **Fixed layer stack, top to bottom** — Mask, Messages, Props, Announcements, Slide, slide background color, presentation background color, Media, Video Input, screen color; audio is a separate non-visual layer.
- [CORE] **Clear All** — F1.
- [CORE] **Clear individual layers** — slide F2, media F3, props F4, audio F5, messages F6, announcements F7, plus video input.
- [COMMON] **Clear groups** — custom clear buttons choosing any mix of music, audio effects, messages, props, announcements, presentation, presentation media and video input, with icon and tint (7.7).
- [COMMON] **Clear group options** — optionally stop the presentation or announcement timeline; clear "next slide" on stage (7.9).
- [COMMON] **Clear to Logo** — removed in v22; the documented replacement is a logo prop plus a macro.
- [COMMON] **Audio clear behavior rules** — choose which media types or destinations clear playing audio (7.5).

## 10. Announcements layer

- [COMMON] **Second independent presentation** — runs at the same time as the main presentation on its own layer.
- [COMMON] **Route by Look** — typically to lobby screens or a stream.
- [COMMON] **Self-running loops** — Go to Next timers with loop to beginning.
- [COMMON] **Own transport, timeline, clear button and API endpoints.**
- [COMMON] **Green indicators** — the destination target and live-slide outline turn green for announcement presentations.

## 11. Props

- [COMMON] **Props** — persistent overlays (logo bug, lower third, countdown) built in a Props Editor with the full slide toolset.
- [COMMON] **Toggle on and off** from Show Controls, slide actions, macros, MIDI, DMX and the API.
- [COMMON] **Prop transitions.**
- [COMMON] **Prop collections** with table or grid view (v17).
- [COMMON] **Single Prop Mode** — triggering one prop clears the others in its collection (v17).
- [COMMON] **Auto-clear** — a prop removes itself after a set time, with pause and resume (v17).
- [COMMON] **Separate Props and Messages layers** — route each to different screens (7.5).

## 12. Masks

- [NICHE] **Mask layer** — top-most layer that hides parts of the output for shaped or partial screens.
- [NICHE] **Masks Editor** — draw shapes or import a transparent PNG.
- [NICHE] **Masks stay on until cleared**; assigned per screen through Looks; listed by the API.

## 13. Messages

- [COMMON] **Messages** — reusable text overlays on the Messages layer (nursery call, countdown).
- [COMMON] **Tokens** — fill-in text fields, timers and clocks inside a message; values are entered when shown.
- [COMMON] **Theme per message.**
- [COMMON] **Dismiss behavior** — manual, when the timer ends, or after a set time.
- [COMMON] **Message transition.**
- [COMMON] **Show and hide** from Show Controls, actions, macros, the Remote app and the API.

## 14. Timers, clocks and countdowns

- [CORE] **Countdown timer** — duration in h:mm:ss.
- [CORE] **Countdown to Time** — reaches zero at a clock time (AM, PM or 24-hour).
- [COMMON] **Elapsed time timer** — counts up from a start, optionally to an end.
- [COMMON] **Overrun** — continue into negative time past zero.
- [COMMON] **Unlimited named timers** — start, stop and reset each; collapse rows.
- [COMMON] **System clock** — with date, format and 24-hour options.
- [COMMON] **Video countdown** — time remaining on the playing video.
- [COMMON] **Audio countdown.**
- [CORE] **Show a countdown to the audience** — as a message, as linked text on a slide, or in a prop.
- [COMMON] **Start timers from** the panel, a message, a playlist header, a slide action, a macro, a playback marker, MIDI, DMX or the API.
- [COMMON] **Timer actions can set values** — set and start a timer with a new duration or target time.
- [COMMON] **Increment a running timer** — API call.
- [COMMON] **Planning Center Live timer object** for stage layouts.

## 15. Actions and macros

- [COMMON] **Actions on slides** — any slide can carry multiple actions that fire when it is triggered; icons show on the thumbnail.
- [COMMON] **Action Palette** — drag actions onto slides, macros, markers or timeline tracks.
- [COMMON] **Media action** — background or foreground image or video.
- [COMMON] **Audio action** — play a file or an audio bin playlist.
- [COMMON] **Video input action.**
- [COMMON] **Stream action** — HLS video or audio (v22).
- [COMMON] **Clear action** — a layer or a clear group.
- [COMMON] **Audience Look action.**
- [COMMON] **Stage action** — set a layout per stage screen, and set destination to Stage Only or Stage + Audience.
- [COMMON] **Timer action** — start, stop, reset or configure.
- [COMMON] **Message action** — show or hide.
- [COMMON] **Prop action** — show or clear.
- [COMMON] **Macro action.**
- [COMMON] **Capture action** — start or stop recording or streaming.
- [COMMON] **Communication action** — MIDI note on/off, RossTalk, GlobalCache and other device commands.
- [COMMON] **Slide destination action.**
- [COMMON] **Go to Next / auto-advance action.**
- [COMMON] **Macros** — a named, colored, icon-bearing bundle of actions triggered with one click (7.6).
- [COMMON] **Macro collections**, with grid and table views.
- [COMMON] **Macro triggers** — Show Controls, slides, playback markers, timeline, calendar, MIDI, DMX, Stream Deck, Remote app, API.
- [COMMON] **Startup macro** — run a chosen macro when the app launches.
- [COMMON] **Nested macros** — a macro can trigger another macro.
- [COMMON] **Drag actions out of a macro onto a slide.**
- [COMMON] **Custom macro icons.**

## 16. Timeline and timecode

- [COMMON] **Presentation timeline** — tracks for slides, media, audio and actions on one time base (reworked in 7.10).
- [COMMON] **Record mode** — play the audio and click slides; each trigger is stamped onto the timeline.
- [COMMON] **Edit cues** — drag, delete, re-record, or drop media and actions onto tracks.
- [COMMON] **Playback** — play, pause, rewind, start from any point; loop (unverified).
- [COMMON] **Remote control of timelines** — Remote app, Stream Deck, MIDI/DMX, API.
- [NICHE] **SMPTE (LTC) timecode chase** — an audio input feeds timecode; each presentation has a start offset; a Timecode window selects the playlist and shows engaged state (7.10).

## 17. Audio

- [COMMON] **Audio bin** — playlists and folders of audio files in Show Controls.
- [COMMON] **Playlist behavior** — stop, loop or play next; shuffle.
- [COMMON] **Audio types** — "Audio Track" (music) and "Sound Effect", cleared separately.
- [COMMON] **Audio transport and scrubbing.**
- [COMMON] **Audio inspector** — in and out points, per-channel volume and routing, playback markers.
- [COMMON] **Audio settings** — channel count up to 16 internal channels, main output device, output delay, inspector (cue) output.
- [COMMON] **Routing matrix** — map internal channels to device channels, with mute, solo and test tone per channel, auto-map and clear.
- [COMMON] **Per-media channel routing.**
- [COMMON] **Audio over SDI and NDI** — separately routed (7.2).
- [COMMON] **Audio inputs** — modes Off, On, Auto Off (duck when a foreground video with audio plays) and Auto On (open when a linked video input is live).
- [COMMON] **Input delay, master volume, per-channel level (-60 to +6 dB), monitoring, transition duration.**
- [COMMON] **Capture audio routing** — choose which channels feed the stream, so house audio and stream audio differ.
- [COMMON] **Audio/video sync test pattern.**

## 18. Looks

- [COMMON] **Looks** — a matrix of audience screens by layers deciding which layers each screen shows.
- [COMMON] **Look presets** — unlimited, named, reorderable; one is live at a time.
- [COMMON] **Per-screen alternate theme** — restyle slide text on one screen, for example a lower third on the stream.
- [COMMON] **Per-screen mask and per-screen props/messages/announcements routing.**
- [COMMON] **Enable Identify** — overlay showing which layer is which on the real outputs.
- [COMMON] **Change Looks** from the window, toolbar, Screens menu, slide action, macro, Remote, web control, MIDI or API.
- [COMMON] **Look transition duration** — cross-dissolve per Look (7.15).
- [COMMON] **Live-look editing through the API.**

## 19. Stage screens

- [CORE] **Stage screens** — confidence monitor outputs, configured separately from audience screens.
- [CORE] **Stage layouts and Stage Editor** — free-form layouts built with the slide toolset; bundled starter layouts.
- [CORE] **Current slide and next slide text.**
- [COMMON] **Current and next slide image.**
- [COMMON] **Slide notes object.**
- [COMMON] **Clocks, timers, video countdown** as prebuilt objects.
- [COMMON] **Stage message** — typed by the operator and shown on stage layouts.
- [COMMON] **Chord chart object** and **chords-over-lyrics** with notation and color options.
- [COMMON] **Screen preview object** — a live picture of any audience or stage screen.
- [COMMON] **Multiviewer layout** — several screen previews with labels on one stage screen.
- [COMMON] **Group name and group color object.**
- [COMMON] **Capture status object and color.**
- [COMMON] **Planning Center Live timer object** — light or dark, with three timing modes.
- [COMMON] **Playback marker objects.**
- [COMMON] **Video input and media fills** in a layout.
- [COMMON] **Full text styling on stage objects** — including forcing all caps on stage only.
- [COMMON] **Assign a layout per stage screen** from Show Controls, the editor's Show button, slide actions, macros, Remote or API.
- [COMMON] **Layout actions persist** until another layout is set.
- [COMMON] **Operator or producer views** — stage layouts used as a control-room display.

## 20. Screen configuration and outputs

- [CORE] **Audience and Stage screen lists** — add, rename, delete, reorder.
- [CORE] **Screen versus output model** — a screen is one render; an output is where it is sent.
- [CORE] **System (graphics) outputs** — HDMI, DisplayPort and similar.
- [CORE] **Automatic detection of connected displays** without restarting.
- [COMMON] **Placeholder outputs** — define a screen at a resolution with no hardware attached, for off-site prep.
- [COMMON] **NDI outputs** — virtual network outputs, with custom resolution (7.9).
- [COMMON] **SDI outputs** — Blackmagic DeckLink and UltraStudio devices.
- [NICHE] **Syphon output** — macOS only.
- [COMMON] **Windowed output** — any screen in a floating, resizable window for Zoom sharing or a large preview (v18).
- [COMMON] **Mirror screens** — one render to several outputs.
- [NICHE] **Grouped screens** — one render spanning a grid of outputs (video wall).
- [NICHE] **Edge blend screens** — two or three projectors, with blend width, mode (linear, cubic, quadratic), radius, intensity and black level.
- [NICHE] **Corner pin** — (present in the ProPresenter 7 screen configuration UI; not covered in the current KB, so unverified here).
- [NICHE] **Color adjustment per output** — confirmed for blends; general per-output color correction is unverified.
- [COMMON] **Custom output target size** — for non-standard LED walls such as the 768x128 Lyric Banner.
- [COMMON] **Screen background color** — the bottom-most layer per screen.
- [NICHE] **Alpha key output** — fill and key over SDI, NDI or a second graphics output; straight or premultiplied; internal or external key.
- [NICHE] **HDR output** — Rec. 2100 HLG or PQ per screen, with 10-bit rendering (v21); not for NDI or capture.
- [NICHE] **HDR brightness calibration.**
- [COMMON] **Disable a screen** — keep it configured but stop rendering it, per computer (v22).
- [COMMON] **Screen limits** — the marketing page says 8 unique outputs; the 18.2 release headline says expansion to 16 screens.
- [COMMON] **Test patterns** — A/V sync, blend grid, color bars, focus, greyscale, lines, logo bounce, radar, solid color, text (expanded 7.15).
- [COMMON] **On-screen performance statistics** — internal and output frame rates.
- [COMMON] **Screen configuration is per computer** — it does not sync with Cloud.
- [NICHE] **macOS privacy-indicator workaround** — documented fix for the orange dot on external displays.

## 21. Video inputs

- [COMMON] **Video inputs** — USB capture devices and webcams, SDI, NDI and Syphon sources.
- [COMMON] **Input naming, live preview, mode detection, custom thumbnail.**
- [COMMON] **Linked audio per input** — embedded or separate, with delay and levels.
- [COMMON] **Use an input** as a triggered cue, a slide action, a macro step, or an object inside a slide.
- [COMMON] **NDI discovery controls** — show local sources, receive groups, extra search IPs (7.9).
- [COMMON] **AirCast Receiver** — receive AirPlay video and audio from Apple devices as an input, with optional password (v18).
- [NICHE] **Camera and microphone permission prompts** handled per OS.

## 22. Capture, recording and streaming

- [COMMON] **Capture one screen** — any audience or stage screen; one source and one destination at a time.
- [COMMON] **Record to disk** — codec, resolution, frame rate and folder; H.264 needs hardware encoder support.
- [COMMON] **RTMP streaming** — server address and stream key (YouTube, Facebook, Vimeo and others); single destination.
- [COMMON] **Save a local copy while streaming.**
- [COMMON] **Capture presets.**
- [COMMON] **Resi streaming** — built-in resilient streaming encoder with health indicator and remote start from Resi Studio (7.3).
- [COMMON] **Live button and capture indicator** — start, stop and status in the toolbar and preview.
- [COMMON] **Capture control** from actions, macros, calendar, Stream Deck, web control and API.
- [NICHE] **Capacity monitoring** — beta feature from 7.1.2 (unverified whether it still exists).

## 23. Calendar and scheduling

- [COMMON] **Calendar** — schedule playlists, presentations, macros and capture to start at a date and time.
- [COMMON] **One-time and recurring events** with an optional end date.
- [COMMON] **Enable/disable the whole calendar.**
- [COMMON] **Test button** — fire an event immediately.
- [COMMON] **View filters** — hide recurring instances; current versus upcoming.

## 24. Devices and show-control protocols

All devices except MIDI are macOS only, per the current knowledge base.

- [COMMON] **MIDI in** — a note map controls slides, playlists, clears, props, macros, timers, audio and more; note plus velocity selects items by index.
- [COMMON] **MIDI out** — slide actions send Note On/Off on a chosen channel; multiple MIDI devices on macOS.
- [COMMON] **MIDI over network and virtual ports** — used with Ableton and MultiTracks Playback; loopMIDI on Windows.
- [COMMON] **MIDI map with auto-fill and live note monitor.**
- [NICHE] **DMX and Art-Net in** — the app behaves as a 17-channel fixture: select playlists and items, trigger cues, props, macros, audio, timers, clears and transport; no sACN.
- [NICHE] **RossTalk out** — fade to black, key cut, key auto-transition, GPI, custom control.
- [NICHE] **AMP in** — a switcher drives one media playlist: play, stop, cue, list clips; TCP, UDP or serial.
- [NICHE] **CITP** — sends media thumbnails to lighting consoles for previsualization.
- [NICHE] **GlobalCache out** — relay and IR control: on, off, pulse.
- [NICHE] **VDCP, Sony BVW, Sony BVS, GVG100** — listed as available devices; behavior undocumented in the KB (details unverified).
- [NICHE] **OSC** — (unverified) not listed as a native device; typically done through Bitfocus Companion.
- [COMMON] **Auto-reconnect per device.**

## 25. Networking, remote control and API

- [COMMON] **Network settings** — enable network, show IP and port, enable the TCP/IP API port, set the Remote password, configure Network Link.
- [COMMON] **ProPresenter Remote app** — iOS and Android (and Apple Silicon Macs); included with subscriptions; needs v20+.
- [COMMON] **Remote: browse libraries and playlists and trigger slides and media.**
- [COMMON] **Remote: clear layers and clear groups.**
- [COMMON] **Remote: timers, messages, props, macros, Looks, audio bin, stage layouts and stage messages.**
- [COMMON] **Remote: presenter view** — current and next slide with tap to advance; a Stage Mode shows upcoming slides, notes and timers.
- [COMMON] **Remote: grid or list view, follow-presentation toggle, configurable tabs.**
- [COMMON] **Remote: auto-discovery or manual IP, password protected.**
- [NICHE] **ProPresenter Remote Classic** — the older app for pre-v20 versions; a separate legacy "ProPresenter Stage" app is (unverified) no longer current.
- [COMMON] **ProPresenter Control** — a web page (hosted, or served offline from the View menu) for Looks, macros, audio, capture, screens, playlists, timers, messages, props and stage (7.9).
- [COMMON] **Official Stream Deck plugin** — next/previous, clears, slide groups, macros, props, camera inputs, capture, with premade profiles (7.9).
- [COMMON] **Bitfocus Companion support** — third-party module built on the API.
- [COMMON] **HTTP API** — 231 documented endpoints across 24 groups: announcement, audio, capture, clear, global groups, library, looks, macro, masks, media, message, miscellaneous, playlist, presentation, prop, stage, status, theme, timer, transport, trigger, video input.
- [COMMON] **API streaming updates** — chunked responses push changes for slides, timers, playlists and status; one aggregate endpoint subscribes to many.
- [COMMON] **API thumbnails** — slide, media, prop, mask, layout and theme images.
- [COMMON] **API write access** — create or edit playlists, messages, timers, looks, macros, props, clear groups and theme slides; no endpoint edits slide content.
- [NICHE] **TCP/IP API** — the same API as one-line JSON over a socket for control systems (v17).
- [NICHE] **Network Link** — peer computers in a group mirror triggers by index for backup machines, extra outputs or other rooms; also mirrors timer and message values, props, macros and stage layouts (7.8).
- [NICHE] **Network Link limits** — content must sit at the same index on every machine; Go to Next timers do not propagate.

## 26. Cloud, sync, files and migration

- [COMMON] **Cloud workspaces** — whole-workspace sync in near real time across the organization's computers (v22).
- [COMMON] **Edit while another computer presents.**
- [COMMON] **Local-first** — every computer holds a full copy; a short outage does not stop a service.
- [COMMON] **Cloud storage** — 50 GB included, shared; paid tiers of 200 GB, 1 TB and 3 TB; automatic upgrade 30 days after exceeding the limit.
- [COMMON] **Workspace manager** — create, download, switch, convert a local workspace to Cloud, restore.
- [COMMON] **What syncs** — presentations, media, libraries, playlists, themes, macros, props, timers, messages, stage layouts.
- [COMMON] **What does not sync** — screen configuration, Bibles, account sign-ins, media outside the workspace.
- [COMMON] **No documented conflict resolution or version history** — the KB only warns that long offline edits can cause conflicts.
- [COMMON] **Local Sync (removed in v22)** — the older feature synced libraries, media and playlists to a folder or shared drive with "replace" options.
- [NICHE] **ProSync** — (unverified) not present in the current product documentation; Cloud is the current sync mechanism.
- [COMMON] **Workspace storage format** — since v22 presentations and playlists live in a database inside the workspace, not as loose `.pro` files.
- [COMMON] **Export presentation** — `.pro` file, or a bundle that includes media.
- [COMMON] **Export playlist** — optionally with media, so it rebuilds exactly on another computer.
- [COMMON] **Export plain text** — lyrics only, formatting stripped.
- [COMMON] **Export slides as images** — (unverified).
- [COMMON] **Export Legacy Workspace** — to move data back to v21 (v22).
- [COMMON] **Export to ProDisplay** — push presentations to Renewed Vision's digital signage product (v22).
- [COMMON] **Import files by drag and drop** into a library, playlist or placeholder.
- [COMMON] **PowerPoint import as editable presentation** — `.pptx` text, shapes, media, notes and simple animations, with no PowerPoint install (v21); optional background import (v22).
- [COMMON] **PowerPoint import as images.**
- [NICHE] **PowerPoint import as objects and text** — the older macOS path.
- [NICHE] **PowerPoint gaps** — no `.ppt`, SmartArt, charts, 3-D effects, glow or reflection, emphasis animations.
- [NICHE] **Keynote import** — (unverified) not documented in the current KB.
- [COMMON] **Migration** — from Pro 5 and Pro 6, and to a new computer.
- [COMMON] **Warnings against third-party cloud folders** — iCloud, Dropbox and OneDrive are documented causes of missing files.

## 27. Integrations

- [COMMON] **Planning Center Services: sign in and import a plan as a playlist.**
- [COMMON] **Planning Center: auto-check for plan updates** with a refresh prompt.
- [COMMON] **Planning Center: match items to library presentations** by title or CCLI number.
- [COMMON] **Planning Center: make arrangements from song sequences**, including custom sequences (21.4).
- [COMMON] **Planning Center: download and upload attachments** — presentations and media.
- [COMMON] **Planning Center: link, unlink and hide plan items; show historical plans.**
- [COMMON] **Planning Center: per-item link tools** — attach from the plan, create new, import a file, or search the library, SongSelect or MultiTracks.
- [COMMON] **Planning Center Live** — an in-app window to take control and advance the plan, with chat; not tied to slide advancement.
- [COMMON] **SongSelect by CCLI** — see section 6.
- [COMMON] **MultiTracks** — see section 6; automation with the Playback app over MIDI.
- [COMMON] **ProContent** — stock media, themes and stickers, with free and premium tiers.
- [COMMON] **Resi** — see section 22.
- [NICHE] **Amazing (APlay) kids curriculum** — import a curriculum playlist; slides download, video and audio stream (v22).
- [NICHE] **ProDisplay** — signage export (v22).
- [NICHE] **ProPresenter Lyric Banner** — Renewed Vision's LED lyric strip hardware with a documented screen setup.
- [NICHE] **ProVideoPlayer** — sister product receiving NDI from ProPresenter.

## 28. Settings (preferences)

- [CORE] **General** — House of Worship toggle, copyright display, CCLI reporting, language, workspace manager, support files location.
- [CORE] **Screens** — rendering bit depth, performance statistics, ignore background colors.
- [COMMON] **Audio** — channel count, devices, routing, SDI/NDI audio.
- [COMMON] **Inputs** — video inputs, audio inputs, NDI discovery, AirCast receiver.
- [COMMON] **Import** — media import presets.
- [COMMON] **Media** — manage media automatically, search paths, clean up unlinked media.
- [COMMON] **Devices** — add devices, MIDI map, DMX map.
- [COMMON] **Network** — see section 25.
- [COMMON] **Integrations** — Planning Center, SongSelect, MultiTracks, Resi, Amazing.
- [COMMON] **Account** — sign in, seat type, ProContent.
- [COMMON] **Groups** — (unverified tab name) global group names, colors and hot keys.
- [COMMON] **Updates** — release or beta channel.
- [NICHE] **High-performance GPU mode and non-admin launch guidance** on Windows.

## 29. Keyboard shortcuts

- [CORE] **Slide navigation** — right arrow or space next, left arrow previous, up and down between playlist items.
- [CORE] **Clear keys** — F1 to F7 as in section 9.
- [CORE] **Background navigation** — Cmd/Alt + arrows.
- [COMMON] **Mode switching** — Ctrl+S Show, Ctrl+E Edit, Ctrl+R Reflow, Ctrl+B Bible.
- [COMMON] **Panel shortcuts** — timers, messages, props, stage, media bin, ProContent, Planning Center, calendar, action palette.
- [COMMON] **Screens** — Cmd/Ctrl+1 audience on/off, +2 stage on/off, +4 stage layouts, Shift+1 Looks, Opt/Alt+1 configure screens.
- [COMMON] **Editor shortcuts** — font, bold, italic, underline, size, spacing, alignment, arrange.
- [COMMON] **File and edit shortcuts** — new presentation, new slide, import, search, copy/paste text style, duplicate.
- [COMMON] **Custom key mapping** — remap any menu command, with "customized" and "conflicts" filters (7.7).
- [COMMON] **Mappable keys for props and macros** (7.7) and slide views (21.3).

## 30. Licensing, seats and platform

- [CORE] **Subscription only** — $29/month or $289/year for one seat; tiered annual pricing to 10 seats; custom above that.
- [CORE] **Seat types** — Presenter (clean output, Cloud), Cloud Editor (Cloud, watermarked; two included), Local Editor (free, unlimited, watermarked, no Cloud).
- [CORE] **Free editing** — the app downloads free and is fully functional with a watermark on outputs.
- [COMMON] **Account sign-in activation** — replaces unlock codes (v17); seats are moved between computers from the app or the web account.
- [COMMON] **Internet needed** to install, register, verify the subscription and update; not to run a service.
- [COMMON] **14-day full trial** — one per organization.
- [COMMON] **Legacy perpetual users** — keep the last version released before their ProPresenter+ expired; discounted migration pricing.
- [COMMON] **Cross-platform** — macOS 14+ and Windows 10/11; one seat works on either.
- [COMMON] **Feature gaps on Windows** — no Syphon, no devices other than MIDI, a single MIDI device.
- [COMMON] **Apple Silicon and Metal rendering** (7.4).
- [COMMON] **Beta channel** — opt in to beta builds; downgrade path documented for v22.
- [COMMON] **Support** — chat and tickets; the site advertises seven-day support.

---

## Volunteer pain points

Drawn from 1,130 r/ProPresenter posts and 62 r/churchtech posts (January 2023 to November 2026) pulled from a Reddit archive, ranked by comment count, plus review-site summaries. Reddit itself blocked direct fetching, so thread text and top comments come from the archive. r/techtheatre returned no ProPresenter threads in that window.

### 1. Too many concepts for a once-a-month volunteer

- Trainers say that explaining Looks, themes, macros and stage layouts loses people; the working minimum is "advance slides, Clear All, don't panic". Churches split the job into a prep team and a click-only operator. [How do you train new ProPresenter volunteers](https://www.reddit.com/r/ProPresenter/comments/1r5ms5t/how_do_you_train_new_propresenter_volunteers/)
- Review sites repeat that volunteers find the interface hard to navigate and that version 7 "tries to do too much". [Capterra reviews](https://www.capterra.com/p/170172/ProPresenter/reviews/?page=3), [G2 reviews](https://www.g2.com/products/renewed-vision-propresenter/reviews)
- Easy View silently changes how thumbnails look, which Renewed Vision's own article flags as a source of "why are my slides black" confusion. [Slide View Options](https://support.renewedvision.com/hc/en-us/articles/360041344174-Slide-View-Options-in-ProPresenter)

### 2. Looks, layers and "why is nothing on the screen"

- Slide and presentation background colors sit above the media layer, so a background video can be hidden with no obvious reason; Renewed Vision publishes a dedicated troubleshooting article. [ProPresenter Output Layers](https://support.renewedvision.com/hc/en-us/articles/13634000690323-ProPresenter-Output-Layers), [My Slide Background Color is not Showing](https://support.renewedvision.com/hc/en-us/articles/360041347774-My-Slide-Background-Color-is-not-Showing)
- An alternate theme left on a screen in Looks makes lyrics render differently from the presentation, and a slide action can change the Look without the operator noticing. [Using Looks](https://support.renewedvision.com/hc/en-us/articles/360041407174-Using-Looks-to-Show-Different-Screen-Content-in-ProPresenter)
- Lower thirds for a stream are the most common "how do I" request and need a second Look, a theme and an extra output. [Is this one thing so difficult?](https://www.reddit.com/r/ProPresenter/comments/1kcam6g/is_this_one_thing_so_difficult/), [Send only Bible reference to center screen](https://www.reddit.com/r/ProPresenter/comments/1tdbkdx/send_only_bible_reference_to_center_screen/)
- Screens showing the wrong content or mirroring each other after a cable or adapter change. [Both main monitors and stage screen are identical](https://www.reddit.com/r/ProPresenter/comments/1ddp702/help_both_main_monitors_and_stage_screen_are/)

### 3. Themes are a one-way paste

- Applying a theme copies its formatting; there is no "un-theme", and editing a theme does not update slides already themed. An all-caps theme also leaves audience and stage text out of step when edited. [Is it possible to "un-theme"?](https://www.reddit.com/r/ProPresenter/comments/1ukoixk/is_it_possible_to_untheme/)
- No clean way to keep one song in two layouts (2 lines versus 4 lines per slide); people duplicate songs or libraries. [Same song, two layouts](https://www.reddit.com/r/ProPresenter/comments/1xm1u3i/same_song_two_layouts_2_lines_vs_4_lines_per/), [two song versions?](https://www.reddit.com/r/ProPresenter/comments/1pmdt2w/two_song_versions/)
- A new arrangement can leave the stage display's "next slide" wrong. [Stage Display not showing next slide](https://www.reddit.com/r/ProPresenter/comments/1hox5hd/stage_display_not_showing_next_slide/)

### 4. Stability, and updates that break Sunday

- A hard-coded certificate expiry stopped every Windows install from launching on 2024-12-06, with no error message. It is the most-commented thread in the sample. [ProPresenter WONT OPEN for users on Windows](https://www.reddit.com/r/ProPresenter/comments/1h8hs3c/propresenter_wont_open_for_users_on_windows/)
- Recurring "is it safe to update?" threads; the community rule is never to update before a service. [Safe to update to 18?](https://www.reddit.com/r/ProPresenter/comments/1jv8d21/), [Safe to update to v19?](https://www.reddit.com/r/ProPresenter/comments/1m6ii42/)
- Windows is widely described as less stable than Mac. [Is mac genuinely better than windows](https://www.reddit.com/r/ProPresenter/comments/1nz0v3r/is_mac_genuinely_better_than_windows_when_it/), [Move to propresenter](https://www.reddit.com/r/churchtech/comments/1mxjxj2/move_to_propresenter/)
- Users attribute slow transitions and lag to memory leaks and want stability work over new features. [Post ProPresenter](https://www.reddit.com/r/churchtech/comments/1inbvlw/post_propresenter/), [Slide transition delay issue](https://www.reddit.com/r/ProPresenter/comments/1jihl7j/slide_transition_delay_issue/)

### 5. Licensing that fails at the worst moment

- "Your registration information is corrupted" on a Sunday morning, leaving a watermark on the output. [Another rant on why i HATE ProPresenter](https://www.reddit.com/r/churchtech/comments/1vjqsjw/another_rant_on_why_i_hate_propresenter/)
- A seat shown as expired after an update, then Bibles disappearing mid-service; activation needs internet. [Licenced Seat malfunction](https://www.reddit.com/r/ProPresenter/comments/1iwu188/licenced_seat_malfunction/)

### 6. Price and the move to subscription

- The 2024 switch from perpetual license to $289 a year per seat drew sustained anger, especially from small churches that want a cheaper, simpler tier. [ProPresenter is now a subscription](https://www.reddit.com/r/ProPresenter/comments/1ehgok6/propresenter_is_now_a_subscription/), [Anyone else just dropping ProPresenter+](https://www.reddit.com/r/ProPresenter/comments/1f2h15f/anyone_else_just_dropping_propresenter_and_not/), [Any good Propresenter alternatives?](https://www.reddit.com/r/churchtech/comments/1pw9jhu/any_good_propresenter_alternatives_i_just_find/)
- Named alternatives in those threads: FreeShow, Proclaim, WorshipTools Presenter, MediaShout, OpenLP.
- Many churches do not realize editing is free and pay for prep seats. [How many ProPresenter seats](https://www.reddit.com/r/ProPresenter/comments/1wimwtg/how_many_propresenter_seats_does_your_church/)

### 7. Getting content between computers, and losing it

- Editing from home has meant exporting bundles, a shared Google Drive folder, or remote desktop. [Editing Presentation from Home](https://www.reddit.com/r/ProPresenter/comments/1qgurdd/editing_presentation_from_home/), [best option to share data files?](https://www.reddit.com/r/churchtech/comments/1wvbhfd/new_to_propresenterbest_option_to_share_data_files/)
- Whole libraries vanishing, in one case 15 minutes before a service; iCloud Desktop/Documents sync is a known cause. [Everything's gone](https://www.reddit.com/r/ProPresenter/comments/1fhcxba/everythings_gone/)
- Version 22 moved presentations into a database, removed Local Sync, and broke Dropbox and file-copy workflows; early reports of slower search and load, and no version history. [ProPresenter 22 completely messes with files!](https://www.reddit.com/r/ProPresenter/comments/1x8rf73/propresenter_22_completely_messes_with_files/), [Updated to ProPresenter 22?](https://www.reddit.com/r/ProPresenter/comments/1xdhv5l/updated_to_propresenter_22_what_changed_that_you/)
- Missing media after files are moved is common enough to have three KB articles. [ProPresenter Media Management](https://support.renewedvision.com/hc/en-us/articles/360041815133-ProPresenter-Media-Management)

### 8. Everyday gaps

- No PDF import; guests arrive with PDFs and operators screenshot pages. [What to do when someone brings a PDF file](https://www.reddit.com/r/ProPresenter/comments/1f02u2r/what_to_do_when_someone_brings_a_pdf_file/)
- No YouTube or web playback. [YouTube and ProPresenter](https://support.renewedvision.com/hc/en-us/articles/360011789813-YouTube-and-ProPresenter)
- Running out of physical outputs for stage plus lower thirds on small Macs. [Propresenter output limits](https://www.reddit.com/r/ProPresenter/comments/1x2rxw0/propresenter_output_limits/)
- The old Remote app was called unreliable, and the replacement raised cost complaints. [Pro remote Update](https://www.reddit.com/r/ProPresenter/comments/1m95jcg/pro_remote_update/)
- No conditional logic, for example one countdown slide that targets 9:00 or 11:00 depending on the time. [Variable Timer Action?](https://www.reddit.com/r/ProPresenter/comments/1rckhxp/variable_timer_action_2_service_times/)
- People build side tools for things the app lacks: lyric export to PowerPoint, automatic lyric following, animated lyrics. [ProPresenter Lyrics Export](https://www.reddit.com/r/ProPresenter/comments/1qw1ql0/propresenter_lyrics_export_a_tool_born_from/), [Made a reliable lyrics follower](https://www.reddit.com/r/ProPresenter/comments/1spnnfd/made_a_reliable_lyrics_follower_first_time/)

---

## Sources

### Renewed Vision product pages

- https://renewedvision.com/propresenter/
- https://renewedvision.com/propresenter/all-features
- https://renewedvision.com/propresenter/release-notes
- https://renewedvision.com/propresenter/remote
- https://renewedvision.com/propresenter/cloud
- https://openapi.propresenter.com/ (spec at https://openapi.propresenter.com/swagger.json)

### Release blog posts

- https://renewedvision.com/blog/propresenter-7-from-renewed-vision-now-available
- https://renewedvision.com/blog/propresenter-7-4-hello-world
- https://renewedvision.com/blog/propresenter-7-5
- https://renewedvision.com/blog/propresenter-7-6
- https://renewedvision.com/blog/propresenter-7-7
- https://renewedvision.com/blog/propresenter-7-8
- https://renewedvision.com/blog/propresenter-7-9
- https://renewedvision.com/blog/propresenter-7-10
- https://renewedvision.com/blog/volunteer-operators-guide-to-propresenter-7

### Knowledge base

All 156 articles in the ProPresenter section were read through the help center API. The ones leaned on most:

- https://support.renewedvision.com/hc/en-us/sections/360002412274-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/360041345954-Understanding-The-ProPresenter-User-Interface
- https://support.renewedvision.com/hc/en-us/articles/13634000690323-ProPresenter-Output-Layers
- https://support.renewedvision.com/hc/en-us/articles/360041344174-Slide-View-Options-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/360041809973-Using-Groups-and-Arrangements-for-Presentation-Organization
- https://support.renewedvision.com/hc/en-us/articles/34513457866899-How-to-Use-Reflow-Editor-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/360041347594-Using-Bibles-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/360041814253-Showing-Multiple-Bible-Versions-at-the-Same-Time
- https://support.renewedvision.com/hc/en-us/articles/11910559859603-Themes-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/22249643660947-Maintaining-Text-Attributes
- https://support.renewedvision.com/hc/en-us/articles/360041342354-Guide-to-Using-Transitions-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/54081982784019-Using-Advanced-Text-Fill-Options-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/4403013895059-Using-Scrolling-Text-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/55783827195795-How-to-Add-Text-Animations-to-a-Slide
- https://support.renewedvision.com/hc/en-us/articles/54342607234451-Media-Bin-Overview
- https://support.renewedvision.com/hc/en-us/articles/7200487649299-What-is-the-Media-Inspector
- https://support.renewedvision.com/hc/en-us/articles/360058902173-What-file-types-work-with-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/7171761588371-Using-Playback-Markers-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/4408681880211-Using-Clear-Groups-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/360041809953-The-Announcement-Layer
- https://support.renewedvision.com/hc/en-us/articles/55744290679315-How-to-Clear-To-A-Logo
- https://support.renewedvision.com/hc/en-us/articles/360050782494-Setting-up-Timers-in-ProPresenter-7
- https://support.renewedvision.com/hc/en-us/articles/360050786794-How-to-Create-a-Countdown-for-an-Audience-Screen
- https://support.renewedvision.com/hc/en-us/articles/360053250613-Using-Timers-on-Stage-Screens
- https://support.renewedvision.com/hc/en-us/articles/4402663090323-Using-Macros-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/55087512188947-Using-Timelines-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/7798653564563-Timecode-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/55626795390867-Using-the-Calendar-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/360041407174-Using-Looks-to-Show-Different-Screen-Content-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/23571612793619-Using-Look-Transitions
- https://support.renewedvision.com/hc/en-us/articles/360041407794-Using-a-Stage-Screen-to-its-Full-Potential
- https://support.renewedvision.com/hc/en-us/articles/360051396653-Create-a-Multiviewer-Output-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/47985491763219-Using-Slide-Destination-within-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/360041879173-Screen-Configuration-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/360041879993-What-s-the-Difference-Between-Screens-and-Outputs
- https://support.renewedvision.com/hc/en-us/articles/360041820053-Edge-Blending-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/18435523006739-Alpha-Keying-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/45240760314003-Using-HDR-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/23669417696147-Using-Test-Patterns-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/35155785296787-Using-Windowed-Output-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/55789647443731-How-to-Disable-Screens
- https://support.renewedvision.com/hc/en-us/articles/360053482973-Setting-Up-A-Video-Input-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/360053484013-Setting-Up-An-Audio-Input-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/54389354146707-Using-the-AirCast-Receiver-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/360052696094-Audio-Routing-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/360049227893-Recording-ProPresenter-Screens
- https://support.renewedvision.com/hc/en-us/articles/360049229013-Streaming-a-ProPresenter-Screen-to-An-RTMP-Server
- https://support.renewedvision.com/hc/en-us/articles/360058942613-Setting-up-Resi-Streaming-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/360058141114-Communication-Devices-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/1500000020301-Devices-MIDI-ProPresenter-Setup
- https://support.renewedvision.com/hc/en-us/articles/360059980973-Devices-DMX
- https://support.renewedvision.com/hc/en-us/articles/1500000025242-Devices-RossTalk
- https://support.renewedvision.com/hc/en-us/articles/360060251553-Devices-AMP
- https://support.renewedvision.com/hc/en-us/articles/360058497634-Devices-CITP
- https://support.renewedvision.com/hc/en-us/articles/1500000062942-Devices-GlobalCache
- https://support.renewedvision.com/hc/en-us/articles/4412193892627-Network-Link
- https://support.renewedvision.com/hc/en-us/articles/31606866768147-TCP-IP-Connections-with-ProPresenter-API
- https://support.renewedvision.com/hc/en-us/articles/6032278869011-Using-ProPresenter-Control
- https://support.renewedvision.com/hc/en-us/articles/43051104879379-ProPresenter-Remote-App-Interface
- https://support.renewedvision.com/hc/en-us/articles/5284750340371-Setting-Up-The-ProPresenter-Stream-Deck-Plugin
- https://support.renewedvision.com/hc/en-us/articles/4408670102419-Using-Planning-Center-with-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/1500003710301-Planning-Center-Online-Preferences
- https://support.renewedvision.com/hc/en-us/articles/1500006143281-Planning-Center-Live-and-Planning-Center-Live-Stage-Timers
- https://support.renewedvision.com/hc/en-us/articles/360041815033-SongSelect-and-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/53940538326419-How-to-Display-Copyright-Information-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/4412207810323-MultiTracks-Integration
- https://support.renewedvision.com/hc/en-us/articles/14648908292755-Using-ProContent-Inside-of-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/55788634384531-How-to-Integrate-Amazing-with-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/45377042213011-Importing-PowerPoint-files-Natively-within-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/55789101197587-How-to-Use-Video-and-Audio-Stream-Actions-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/55701696829715-Getting-Started-With-Cloud-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/45519344429587-Best-Practices-for-ProPresenter-Cloud
- https://support.renewedvision.com/hc/en-us/articles/56274782609427-ProPresenter-Seat-Types
- https://support.renewedvision.com/hc/en-us/articles/35579747176083-Renewed-Vision-Pricing-and-Renewal-Process
- https://support.renewedvision.com/hc/en-us/articles/360042123293-Keyboard-Shortcuts-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/4412282390547-Custom-Key-Mapping
- https://support.renewedvision.com/hc/en-us/articles/360041348414-Toggling-House-of-Worship-Settings-Features
- https://support.renewedvision.com/hc/en-us/articles/360060742733-Using-ProPresenter-7-in-Different-Languages
- https://support.renewedvision.com/hc/en-us/articles/39074753180179-Warning-Signs-in-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/360042186713-What-are-the-minimum-system-requirements-for-ProPresenter
- https://support.renewedvision.com/hc/en-us/articles/55683662214675-Which-Operating-Systems-Does-Each-ProPresenter-Version-Support
- https://support.renewedvision.com/hc/en-us/articles/360011789393-How-do-I-import-plain-text-files-into-ProPresenter (search snippet only)

### Reddit (via the Arctic Shift archive API)

- https://www.reddit.com/r/ProPresenter/comments/1h8hs3c/propresenter_wont_open_for_users_on_windows/
- https://www.reddit.com/r/ProPresenter/comments/1nz0v3r/is_mac_genuinely_better_than_windows_when_it/
- https://www.reddit.com/r/churchtech/comments/1pw9jhu/any_good_propresenter_alternatives_i_just_find/
- https://www.reddit.com/r/churchtech/comments/1vjqsjw/another_rant_on_why_i_hate_propresenter/
- https://www.reddit.com/r/ProPresenter/comments/1ehgok6/propresenter_is_now_a_subscription/
- https://www.reddit.com/r/ProPresenter/comments/1f2h15f/anyone_else_just_dropping_propresenter_and_not/
- https://www.reddit.com/r/ProPresenter/comments/1kcam6g/is_this_one_thing_so_difficult/
- https://www.reddit.com/r/ProPresenter/comments/1x8rf73/propresenter_22_completely_messes_with_files/
- https://www.reddit.com/r/ProPresenter/comments/1xdhv5l/updated_to_propresenter_22_what_changed_that_you/
- https://www.reddit.com/r/ProPresenter/comments/1r5ms5t/how_do_you_train_new_propresenter_volunteers/
- https://www.reddit.com/r/ProPresenter/comments/1fhcxba/everythings_gone/
- https://www.reddit.com/r/ProPresenter/comments/1xm1u3i/same_song_two_layouts_2_lines_vs_4_lines_per/
- https://www.reddit.com/r/ProPresenter/comments/1pmdt2w/two_song_versions/
- https://www.reddit.com/r/ProPresenter/comments/1ukoixk/is_it_possible_to_untheme/
- https://www.reddit.com/r/ProPresenter/comments/1f02u2r/what_to_do_when_someone_brings_a_pdf_file/
- https://www.reddit.com/r/ProPresenter/comments/1qgurdd/editing_presentation_from_home/
- https://www.reddit.com/r/churchtech/comments/1wvbhfd/new_to_propresenterbest_option_to_share_data_files/
- https://www.reddit.com/r/ProPresenter/comments/1x2rxw0/propresenter_output_limits/
- https://www.reddit.com/r/ProPresenter/comments/1ddp702/help_both_main_monitors_and_stage_screen_are/
- https://www.reddit.com/r/ProPresenter/comments/1hox5hd/stage_display_not_showing_next_slide/
- https://www.reddit.com/r/ProPresenter/comments/1tdbkdx/send_only_bible_reference_to_center_screen/
- https://www.reddit.com/r/ProPresenter/comments/1m95jcg/pro_remote_update/
- https://www.reddit.com/r/ProPresenter/comments/1iwu188/licenced_seat_malfunction/
- https://www.reddit.com/r/ProPresenter/comments/1jihl7j/slide_transition_delay_issue/
- https://www.reddit.com/r/ProPresenter/comments/1rckhxp/variable_timer_action_2_service_times/
- https://www.reddit.com/r/ProPresenter/comments/1wimwtg/how_many_propresenter_seats_does_your_church/
- https://www.reddit.com/r/ProPresenter/comments/1qw1ql0/propresenter_lyrics_export_a_tool_born_from/
- https://www.reddit.com/r/ProPresenter/comments/1spnnfd/made_a_reliable_lyrics_follower_first_time/
- https://www.reddit.com/r/churchtech/comments/1mxjxj2/move_to_propresenter/
- https://www.reddit.com/r/churchtech/comments/1inbvlw/post_propresenter/
- https://www.reddit.com/r/ProPresenter/comments/1jv8d21/
- https://www.reddit.com/r/ProPresenter/comments/1m6ii42/
- Archive API used: https://arctic-shift.photon-reddit.com/api/posts/search

### Review sites and other

- https://www.capterra.com/p/170172/ProPresenter/reviews/?page=3
- https://www.g2.com/products/renewed-vision-propresenter/reviews
- https://churchfront.com/2026/01/13/propresenter-deep-dive-for-church-volunteers/

### Unreachable during research

- https://files.renewedvision.com/propresenter/support/Pro7UserGuide.pdf (HTTP 522)
- https://learn.renewedvision.com/propresenter/ (redirects to the knowledge base)
- reddit.com, old.reddit.com and Reddit mirrors (blocked; archive API used instead)
- Softpedia changelog pages (HTTP 403)
