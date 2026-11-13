# Themes, per-screen layouts and stage layouts (for importers & integrations)

## Text roles — how themes find "the lyrics"
Set `TextElement.role` on every text box you create. Themes restyle by role:

| role | use |
|---|---|
| `lyrics` | song lyrics (one box per slide) |
| `title` | headline / sermon point / song title |
| `subtitle` | line under a title (series, artist) |
| `reference` | scripture reference, CCLI line |
| `body` | scripture text, paragraphs, announcement details |
| `caption` | small label above a title ("Point one", "This week") |

Unknown roles still work: unmatched text takes the next free template box.

## Theme JSON — workspace doc `themes` (`workspace.readDoc({name:'themes'})` → `Theme[]`)
```jsonc
{ "id": "my-theme", "name": "Easter", "size": { "width": 1920, "height": 1080 },
  "templates": [ { "id": "t1", "name": "Lyrics", "slide": {
      "id": "s", "background": { "type": "color", "color": "#292929" },
      "elements": [ /* text boxes with roles = slots; shapes/images/text without role = decoration */ ],
      "variants": { "<canvasId>": { "elements": [ /* layout for that screen, in its pixels */ ] } } } } ] }
```
Built-in themes (`src/shared/themes-builtin.ts`, ids stable): `reach-lyrics`, `reach-lower-third`, `reach-scripture`,
`reach-sermon`, `reach-announcement`. A workspace theme with the same id overrides the built-in.

API (`src/shared/themes.ts`, pure functions usable in main or renderer):
- `applyTheme(presentation, theme, { slideIds?, templateId? })` — keeps words (and bold/italic/colour runs), swaps
  look by role, adds template decoration flagged `fromTheme: true`, copies template `variants` per canvas.
  Records the pre-theme look in `presentation.meta.theme` and sets `presentation.themeId`.
- `removeTheme(presentation, slideIds?)` — restores the original look with the current words (reversible).
- Re-running `applyTheme` with an edited theme updates slides (remembers each slide's template).
- `resolveSlideWithCanvasTheme(slide, size, canvas, themes)` — what a canvas with `canvas.themeId` should draw for a
  slide without its own variant (output renderers can adopt this).
- `workspace.defaultThemeId` — applied by the editor to new presentations; importers may call `applyTheme` too.

## Per-screen layouts (variants)
`slide.variants[canvasId] = { elements, background? }` in that canvas's pixel space (see `src/shared/editor-variants.ts`:
`createVariant`, `applyVariantLayout`, `setVariant`). Text in a variant is **single-source**: a variant text box with a
`role` shows the base box's paragraphs with the same role (`linkVariantElements`, applied in `resolveSlideForCanvas`).
`linked: false` gives it its own words. Importers only need to write `slide.elements`.

## Stage layouts — workspace doc `stageLayouts` (`StageLayout[]`)
A stage layout is one slide of text boxes with `dynamic: true`; `{tokens}` are replaced live (`liveTokens` in
`render/LiveCanvas.tsx`): `{current.text} {next.text} {current.notes} {current.label} {next.label} {current.title}
{clock} {clock.seconds} {date} {timer} {timer:Name} {stageMessage} {message}`.
Built-ins (`src/shared/editor-stagelayouts.ts`): `reach-stage-lyrics`, `reach-stage-speaker`, `reach-stage-countdown`
(not stored in the doc until someone opens a copy). `canvas.stageLayoutId` picks one per stage canvas.
