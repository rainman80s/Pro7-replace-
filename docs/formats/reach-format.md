# Reach native formats

## Workspace (a plain folder, safe to sync)

```
<workspace>/workspace.json           WorkspaceConfig (canvases, default size)   version: 1
<workspace>/library/<id>.reach       one Presentation per file (JSON)
<workspace>/playlists/<id>.json      Playlist
<workspace>/media/…                  media files, referenced as `workspace:<path relative to media/>`
<workspace>/media/index.json         media bin (MediaItem[])
<workspace>/docs/<name>.json         themes, macros, props, stageLayouts, timers, messages, pp7-* …
```

Imports add:

| doc | contents |
|---|---|
| `media/ProPresenter/…` | media copied from the ProPresenter folder (sub-path below `Media/` kept; de-duplicated by content) |
| `docs/import-reports.json` | index of import runs |
| `docs/import-report-<id>.json` / `.txt` | full JSON report + the human-readable text report |
| `docs/pp7-screens.json` | ProPresenter screens/looks/masks/video inputs + *suggested* canvases (never applied automatically) |
| `docs/pp7-devices.json` | communication devices / MIDI summary for the control service's ProPresenter-compatible preset |
| `docs/pp7-groups.json`, `docs/pp7-labels.json` | ProPresenter's library-wide group names/colours/hot keys and slide labels |

## `.reach` — one presentation

UTF-8 JSON of `Presentation` (`src/shared/model.ts`). Everything is optional-additive, so readers must ignore
unknown keys. Imported files carry provenance in `meta.source`:

```jsonc
"source": {
  "type": "propresenter7",          // propresenter6, songselect, chordpro, openlyrics, opensong, text, pptx, images
  "ref": "/Users/…/Libraries/Default/Song.pro",   // original path (bundle entries: "<bundle>#<entry>")
  "uuid": "E3961927-…",             // ProPresenter document UUID (re-import key)
  "importedAt": "…", "app": "20 (335544354)", "platform": "macos",
  "hash": "<sha1 of the source bytes>",             // unchanged source → "unchanged"
  "fingerprint": "<sha1 of title+slides+groups+arrangements+size at import>",  // differs → edited in Reach
  "unmapped": [ { "type": "ACTION_TYPE_…", "data": { … } } ]   // cue actions with no Reach equivalent, verbatim
}
```

ProPresenter data without a Reach field is preserved, never dropped, under an `ext` object on the element /
slide / group (e.g. `ext.buildIn`, `ext.reveal`, `ext.scroller`, `ext.visibility`, `ext.chords`, `ext.margins`,
`ext.labelColor`, `ext.completion`, `ext.disabledActions`, `ext.transition`). Renderers ignore `ext`.

**Re-import rules** (same source file → same Reach id): unchanged source → `unchanged`; changed source and
not edited in Reach → `updated` in place; edited in Reach → kept (`skipped`) unless the user picks *overwrite*
or *keep both*. Two different files with the same ProPresenter UUID are imported as separate copies.

## `.reachbundle` — move a service between computers

A ZIP (deflate for JSON, stored for media):

```
manifest.json                  { format: "reachbundle", version: 1, createdAt, app,
                                 presentations:[{id,title,file}], playlists:[{id,name,file}],
                                 media:[{src,file,bytes}], themes?, missingMedia:[] }
presentations/<id>.reach
playlists/<id>.json
media/<path relative to workspace media>
docs/themes.json               (themes used by the included presentations)
```

Import: entry names are sanitised (no `..`, no absolute paths); media lands at the same `workspace:` path, or
beside it with a content-hash suffix if a *different* file already exists (refs are rewritten); presentations
are replaced only when the bundle's `updatedAt` is newer.

## Versioning / migrations

* `workspace.json` has `version: 1`; `.reachbundle` manifests have `version: 1`. Bump only for breaking
  changes, and keep a migration function per step (`migrate_1_to_2(doc)`), run on load, newest-first readers
  refuse nothing (import what they can and warn).
* Within a version, changes are additive: new optional fields / union members only. Never repurpose a field.

## Other exports

`export.run` formats: `reachbundle`, `reach`/`json`, `text` (lyrics with section headings + credits),
`lyrics-plain`, `csv` (song list with CCLI numbers for reporting; formula-injection safe), `openlyrics`,
`pro` (**experimental** lyrics-only ProPresenter 7 file: groups, arrangements, one text box per slide, CCLI;
verified only by our own decoder — ProPresenter never writes byte-identical files and will restyle it).

## PDF / “PowerPoint as pictures”

There is no PDF rasteriser in the app yet. Export pages as PNG/JPEG (macOS Preview ▸ Export, Keynote/PowerPoint
▸ Export ▸ Images, or `soffice --headless --convert-to pdf` then any PDF→PNG tool) and drop the image
folder on Reach: each image becomes a full-screen slide. `.pptx` can also be imported directly as editable text.
