# UX principles: Reach Presenter

Who we design for, in order:

1. **The once-a-month volunteer** who has never seen the app before 8:45 on Sunday. They must be
   able to say what is on the screens, what comes next, how to move on and how to get out of trouble.
2. **The tech lead**, who builds services, sets up screens and connects Planning Center. They get
   full mode, and they are the only person who sees configuration.

The research (`docs/research/propresenter-features.md`, "Volunteer pain points") sets the agenda.
Trainers reduce ProPresenter to "advance slides, Clear All, don't panic". Looks and layers cause
"why is nothing on the screen". Stability failures happen at the worst moment. Every decision below
traces back to one of those.

## Decisions

### 1. One meaning per colour
- **Mustard = live.** Mustard marks the live slide border, the LIVE badge on the service item, the
  "On screen now" frame, the live pill in the top bar and the "On" state on Clear buttons. Nothing
  else uses it. Warnings are terracotta (`--warn`) so a warning is never mistaken for "on air".
- **Lakeside = selection and the primary action.** It marks the selected service item, the focus
  colour and the big Next button. Selecting is not going live, so the two colours never mix.
- Everything else is Charcoal and Paper. The brand guide warns that overloading Charcoal layouts
  with accent blocks "drifts tech-driven", so accents appear as small signals, not large blocks.

### 2. Picking is not going live
Clicking a service item only shows its slides. Nothing reaches the screens until you click a slide
or press Next. ProPresenter mixes these up in places (a playlist click can trigger a slide), and
that is a common source of accidents. The empty state says so in plain words.

### 3. One way forward
- **Space, →, and the big Next button all do the same thing.** At the last slide of an item they
  continue to the first slide of the next item, skipping headers and placeholders. ← reverses, and
  goes back to the previous item's last slide. The button label changes with context: "Start"
  (nothing live yet), "Next", or "Next item".
- Space always means Next, even when a button has keyboard focus. Enter still activates the focused
  button. A volunteer pressing Space must never re-trigger the slide they just clicked.
- Show hotkeys work from any screen, so a volunteer who wanders into Settings can still advance.
- An "Up next" card spells out what the next press will do ("Next slide: …", "Next in the service:
  Doxology", "Nothing — this is the end").
- The footer under the slide grid always shows the four keys a volunteer needs.

### 4. Clear buttons that explain themselves
Clear slide, Clear media and Clear all are large tiles with an On/Off indicator for their layer.
Disabled means there is nothing to clear, so a volunteer can see at a glance that the layer is
empty. Tooltips say what will be cleared, including messages and props for Clear all. Esc clears
the words. Logo and Black screen are toggles with a pressed state. The Logo button works on first
run because it falls back to the Reach logo screen (Paper combo mark on Charcoal).

### 5. A persistent live preview
The right column always shows each audience canvas, rendered by the same `LiveCanvas` the outputs
use, so the preview cannot disagree with the room. Stage canvases sit in a collapsed panel below.
When the operator is on another screen, a "Live / Clear" pill in the top bar shows the state and
links back.

### 6. Volunteer mode
A lock in the top bar hides Edit, Media, Displays, Integrations and Settings, plus every
add/remove/reorder/delete control and all right-click destructive items. It leaves Show (and any
view that opts in with `volunteer: true`, for example Bible). Leaving the mode asks for a PIN if one
is set. This is a guard rail against accidents, not a security boundary. It is remembered on each
computer, so the tech lead can lock the booth Mac on Saturday night.

### 7. Nothing destructive on a single click
- Removing a service item is instant and comes with an **Undo** toast. An "Are you sure?" dialog
  would train people to click OK without reading.
- Deleting a service or a library item asks once, says what survives ("the songs stay in your
  library"), and names the button after the action ("Delete service").
- Reordering uses drag and drop, plus Move up/down in the context menu as a precise alternative
  that also works from the keyboard.

### 8. Words a volunteer would use
"Service", not "playlist". "Clear the words", not "Clear slide layer". "Screens", not "outputs",
on the Show screen. "Black screen", not "Blackout". "To be added", not "Placeholder". Empty states
say what to do next and who to ask ("Ask your tech lead…").

### 9. Resilience
- **Error boundaries everywhere.** Each view, each Show panel, each toolbar item, each status item
  and each background helper is isolated. A crash in, say, the Timers panel shows a small card ("hit
  a problem… what is on screen is not affected") and the Show screen keeps working.
- **A status strip** at the bottom shows screens connected or unplugged (built in), plus anything
  other features add (sync, MIDI, Planning Center). It stays quiet when healthy. When something is
  wrong it says what to do: "Check the cable — it reconnects by itself."
- Service edits are optimistic: the list updates at once and failures surface as toasts.

### 10. Find anything (⌘K)
Quick search matches titles, artists, CCLI numbers and lyric excerpts, ignoring accents and
punctuation. Each result has explicit actions: **Show now** (Enter) and **Add to service**
(⌘/Ctrl+Enter). The same dialog serves "Add to this service" from the + menu and "Choose what goes
here" for placeholders. Other features plug in commands and result providers.

### 11. Accessibility
- One focus ring (`--focus`, a light Lakeside) on every keyboard-reachable control, shown only for
  keyboard focus (`:focus-visible`).
- Dialogs trap focus and restore it when closed. Menus use arrow keys. Tabs and segmented controls
  are ARIA tablists and radiogroups.
- Slides carry an `aria-label` with their number, section, text and "on screen now" state.
- Text contrast: Paper on Charcoal is about 13:1, and `--text-dim` is about 7:1 on the raised surface.
- `prefers-reduced-motion` turns off transitions and animations.
- UI scale (Settings > Appearance) applies CSS zoom, for small laptops and high booth monitors.

### 12. Brand, used sparingly
- The wordmark sits top-left at 19px. It is Paper on Charcoal, has clear space, and clicking it
  opens the About box.
- The combo mark (vertical lockup only) appears on the boot splash, the welcome dialog (Charcoal on
  Paper, the brand's preferred pairing) and the About box.
- The Window R is used for the app icon (Paper on Charcoal), the Show screen's main empty state and
  the default output logo screen.
- Type: Perfectly Nineties for titles (falling back to the bundled Instrument Serif), TAY Birdie for
  tracked caps labels (falling back to Inter), Courier Prime for meta text such as durations, counts
  and paths (that is the "typed journal" feel from the guide). Inter is the UI body face.

## Deliberately simpler than ProPresenter

| ProPresenter | Reach | Why |
|---|---|---|
| Looks, layer routing and Props on the operator screen | Not on the Show screen. Canvas layers live in Displays. | The #2 pain point is "why is nothing on the screen". Volunteers should never meet layer routing. |
| Library, playlist, media bin and audio bin all on one screen | Service + a collapsible Library on the left; Media is its own screen | Fewer panes at once, and the volunteer's eye goes left to right. |
| Easy View / thumbnail modes | One thumbnail size slider | ProPresenter's own KB flags Easy View as a cause of "why are my slides black". |
| Separate "clear to logo" / "clear groups" configuration | Three fixed Clear buttons + Logo + Black screen | Matches the trainers' minimum ("Clear All, don't panic"). Custom clear groups belong in Macros (control feature). |
| Playlists, folders, templates | Services with an optional date, newest first; Duplicate to reuse last week's order | That is how a church actually plans. |
| Click to trigger and select at the same time | Select, then fire | Decoupled select and fire (landscape research §1.3, item 9). |
| Confirmation dialogs | Undo toasts for reversible actions | Fewer dialogs, and the ones left get read. |
| Everything visible to everyone | Volunteer mode | Matches how churches split prep and operation. |

## Recommendations for the other areas (for the post-merge review)

**All features**
- Use `@ui/index` for every control. Check `useLocked()` and hide anything that edits, deletes or
  configures. Use `toast` with Undo instead of `confirm` wherever the action can be undone.
- Register your keys in `shortcuts`, your actions in `commands` and your health in `statusItems`,
  so the operator has one place to look for each.
- Mustard means live and nothing else. Use `--warn` for warnings.

**Displays**
- Show each physical screen as a picture of the screen with its live thumbnail, not as rows.
  "Identify" should be one big button.
- When a display disappears, say so in the status strip (`statusItems`) with the output's name and
  "it reconnects by itself", and keep the last frame on the screens.
- Hide region and corner-pin details behind "Advanced". A volunteer should only ever see
  "Main Screen → Projector".
- Offer the Reach logo screen (`LOGO_SCREEN_DATA_URI`) as the default logo in the canvas or
  workspace settings.

**Editor**
- Open on the slide that was selected in Show (`selectedPresentationId`, plus the live index if
  it's the same presentation), and offer a "Back to Show" button.
- Lyrics-first editing: a plain-text pane with the same blank-line/section rules as
  `library.create`, next to the visual editor.
- Group colours: pick from a short, warm palette (the kit's `ColorInput` swatches), not from rainbow defaults.
  Today every group in the seed is the same Lakeside blue, so section boundaries don't stand out
  in the Show grid.
- Theme changes should be live links ("un-theme" was a top complaint).

**Control (timers, messages, props, macros, MIDI, remote, hotkeys)**
- Show panels should be compact and collapsible, with one obvious action each ("Start 5:00
  countdown", "Show message").
- Register Show-screen hotkeys through `shortcuts` so they appear in the ? overlay. Don't bind
  Space, arrows, Esc, F1, Shift+L or Shift+B, which belong to Show.
- The phone remote should copy the Show screen's mental model: big Next, Up next, the three Clear
  buttons and a Live/Clear indicator, all in the same words.
- Macros are the place for custom "clear groups". Give each macro a colour and an icon from the kit icon set.

**Files / import**
- Expose "Import from ProPresenter…" as a `commands` entry (id containing `import`). The welcome
  guide links to it.
- Show a summary when finished ("142 songs, 12 services; 3 media files not found"), with a list of
  what needs attention, rather than a series of toasts.

**Integrations / Bible**
- Planning Center: an "Update from Planning Center" button on the service picker, and per-item
  `people`/`length`/`notes` mapped onto playlist items (the Show screen already displays them, and
  header `time` drives the running times).
- Add `statusItems` for sync state ("Synced 2 min ago", or "Offline: changes saved locally").
- Bible: register a `searchProviders` entry so "John 3:16" in ⌘K returns a result with "Show now"
  and "Add to service". Mark the Bible view `volunteer: true`.
