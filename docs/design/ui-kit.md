# Reach UI kit

Everything in `src/renderer/src/ui/` is exported from `@ui/index`. Use it instead of hand-rolled
buttons, inputs and modals so the whole app looks, sounds and behaves the same. All existing names
and props from the scaffold (`Button`, `Field`, `Input`, `TextArea`, `Select`, `Panel`, `Modal`,
`Empty`, `toast`, `ToastHost`) still work. Each section below has a short usage example.

```tsx
import { Button, IconButton, Icon, Field, Input, Toggle, Panel, toast, confirm } from '@ui/index'
```

## Design tokens (`tokens.css`)

| Token | Use |
|---|---|
| `--bg`, `--bg-raised`, `--bg-sunken`, `--bg-hover`, `--bg-active` | Warm Charcoal surfaces. Panels are `--bg-raised`; wells and inputs are `--bg-sunken`. |
| `--border-soft`, `--border`, `--border-strong` | Hairlines, from quiet to emphasised. |
| `--text`, `--text-dim`, `--text-faint` | Paper text at three strengths. |
| `--live` (Mustard), `--live-soft`, `--on-live` | **Only** for "this is on the screens right now". |
| `--accent` (Lakeside), `--accent-soft`, `--accent-text` | Selection, focus, the primary action. |
| `--warn`, `--warn-text` | Terracotta warnings. Never Mustard, because Mustard means live. |
| `--danger`, `--ok`, `--focus` | Destructive actions, healthy state, keyboard focus ring. |
| `--font-display` | Perfectly Nineties, falling back to the bundled Instrument Serif. Use for titles. |
| `--font-label` | TAY Birdie, falling back to Inter. Use in UPPERCASE with `letter-spacing: .14–.18em`, or the `.t-label` class. |
| `--font-ui` | Inter (bundled). Body UI text. |
| `--font-mono` | Courier Prime (bundled, OFL). Small meta text (`.t-meta`): durations, paths, counts. |
| `--radius-sm/--radius/--radius-lg`, `--control-h(-sm/-lg)`, `--shadow-pop`, `--ease` | Shape and motion. |

Helper classes: `.t-display`, `.t-label`, `.t-meta`, `.dim`, `.faint`, `.row`, `.col`, `.grow`,
`.scroll`, `.truncate`, `.sr-only`. `prefers-reduced-motion` is respected globally.

## Brand

### `Logo`
```tsx
<Logo variant="wordmark" height={20} />          // top bar
<Logo variant="combo" height={96} clear />         // splash / about (vertical lockup only)
<Logo variant="icon" height={40} />                // empty states, small spaces
```
It draws in `currentColor`. On Charcoal leave it Paper (the default text colour). On Paper use
Charcoal, Lakeside or Mustard. Never put a Lakeside or Mustard logo on Charcoal. `clear` adds the
brand's minimum clear space (1× the R height). SVG files are in `src/renderer/public/brand/`.
`LOGO_SCREEN_DATA_URI` and `logoScreenSvg()` give a 1920×1080 logo slide (Paper on Charcoal).

### `Icon`
```tsx
<Icon name="play" />  <Icon name="warning" size={20} />
```
These are inline SVGs on a 24px grid with a 1.75 stroke. Names are listed in `iconNames`. Add new
icons to `icons.tsx` and keep the same style. Never use emoji as icons.

## Actions

### `Button`
```tsx
<Button>Cancel</Button>
<Button variant="primary" icon="plus">Add song</Button>
<Button variant="live">Go live</Button>        // Mustard: only for things that put content on screen
<Button variant="danger">Delete</Button>        // outlined red, fills on hover
<Button variant="ghost" size="sm">More</Button>
<Button size="lg" block>Next</Button>
<Button active={on} onClick={toggle}>Logo</Button>  // pressed state
```
Variants: `default | primary | live | danger | ghost`. Sizes: `sm | md | lg`. Props: `icon`, `block`, `active`.

### `IconButton`
```tsx
<IconButton icon="trash" label="Remove from service" onClick={remove} />
<IconButton icon="keyboard" label="Keyboard shortcuts" shortcut="?" />
```
`label` is required. It is used for both the tooltip and the accessible name.

### `Menu`, `openContextMenu`, `openMenuAt`
```tsx
<Menu trigger={<IconButton icon="more" label="More" />} align="end" items={[
  { label: 'Rename…', icon: 'rename', onSelect: rename },
  { type: 'separator' },
  locked ? null : { label: 'Delete', icon: 'trash', danger: true, onSelect: del },
]} />

<div onContextMenu={(e) => openContextMenu(e, items)} />
```
Falsy entries are skipped and stray separators are removed. Menus support arrow keys and Escape.
Item fields: `shortcut`, `checked`, `disabled`, `testId`. `{ type: 'heading', label }` adds a heading.

## Form controls

### `Field`
```tsx
<Field label="Name" hint="Shown on the stage display"><Input value={v} onChange={…} /></Field>
<Field inline label="Carry on into the next item" hint="…"><Toggle checked={on} onChange={setOn} /></Field>
<Field label="PIN" error={err}><Input type="password" /></Field>
```
Use `inline` for settings rows, with the label on the left and the control on the right.

### `Input`, `TextArea`, `Select`
These are the plain elements with kit styling, and they forward refs. Add `className="mono"` for codes or paths.
```tsx
<Select value={c} onChange={(e) => setC(e.target.value)}><option value="main">Main Screen</option></Select>
```

### `SearchInput`
```tsx
<SearchInput value={q} onValue={setQ} placeholder="Search songs and slides" />
```
It has a clear button, and Escape clears it.

### `NumberInput`
```tsx
<NumberInput value={secs} onChange={setSecs} min={0} max={600} step={5} suffix="sec" />
```
The value is always clamped. Arrow keys step it (hold Shift for ×10).

### `Slider`
```tsx
<Slider value={vol} onChange={setVol} min={0} max={100} showValue format={(n) => `${n}%`} aria-label="Volume" />
```

### `Toggle`
```tsx
<Toggle checked={on} onChange={setOn} label="Loop video" />
```

### `ColorInput`
```tsx
<ColorInput value={color} onChange={setColor} />               // Reach palette swatches by default
<ColorInput value={color} onChange={setColor} swatches={false} />
```

### `Tabs`, `SegmentedControl`
```tsx
<Tabs value={tab} onChange={setTab} tabs={[{ id: 'text', label: 'Text' }, { id: 'actions', label: 'Actions', badge: 2 }]} />
<SegmentedControl value={fit} onChange={setFit} options={[{ value: 'contain', label: 'Fit' }, { value: 'cover', label: 'Fill' }]} />
```

## Layout and content

### `Panel`
```tsx
<Panel title="Timers" actions={<IconButton icon="plus" label="New timer" />}>…</Panel>
<Panel title="Stage display" collapsible id="stage-preview" defaultCollapsed>…</Panel>
```
`collapsible` together with `id` remembers its collapsed state on each computer.

### `List`, `ListItem`
```tsx
<List aria-label="Timers">
  <ListItem title="Countdown" subtitle="5:00" leading={<Icon name="clock" />} trailing={<Badge>Running</Badge>}
            selected={id === sel} live={isOnScreen} onClick={…} onContextMenu={(e) => openContextMenu(e, …)} />
</List>
```
`selected` gives a Lakeside highlight. `live` adds a Mustard marker, for things on screen now.

### `Badge`, `Dot`, `Kbd`, `Spinner`
```tsx
<Badge tone="live">Live</Badge>  <Badge tone="warn">Offline</Badge>  <Dot tone="ok" />
<Kbd>Space</Kbd>  <Kbd keys="mod+K" />    // "mod" shows ⌘ on Mac and Ctrl elsewhere
<Spinner />
```

### `Empty`
```tsx
<Empty title="No timers yet" icon="clock" action={<Button icon="plus">New timer</Button>}>
  Timers count down to the service start or keep the speaker on time.
</Empty>
<Empty title="Pick something from the service" logo>…</Empty>   // a screen's main empty state only
```

### `QRCode`
```tsx
<QRCode value="http://192.168.1.20:4780/remote" size={140} />
```

## Overlays and feedback

### `Modal`, `Drawer`
```tsx
{open && <Modal title="Import" onClose={close} footer={<><Button onClick={close}>Cancel</Button><Button variant="primary">Import</Button></>}>…</Modal>}
{open && <Drawer title="Item details" onClose={close} width={420}>…</Drawer>}
```
Both are portalled. They trap focus, restore it when closed, and close on Escape (only the topmost
overlay closes). While any overlay is open, `overlayOpen()` returns true, so global hotkeys should check it.

### `Tooltip`
```tsx
<Tooltip label="Clear the words" shortcut="Esc"><button …/></Tooltip>
```
It wraps a single element and appears on hover or keyboard focus.

### `toast`
```tsx
toast('Saved')
toast("Couldn't reach Planning Center", 'error', err.message)
toast('Removed "Doxology"', 'info', undefined, { label: 'Undo', onClick: restore })
```
Prefer an Undo toast over asking "are you sure?" for anything that can be undone.

### `confirm`, `promptText`
```tsx
if (await confirm({ title: 'Delete "Sunday 9am"?', message: 'The songs stay in the library.', confirmLabel: 'Delete', danger: true })) …
const name = await promptText({ title: 'Rename', initial: p.name, validate: (v) => (v.trim() ? null : 'Give it a name') })
```
Use confirm only for actions that can't be undone. Name the action on the button ("Delete service"), not "OK".

### `UIHost`
`<UIHost />` mounts toasts, dialogs and menus. The operator shell already mounts it. Other pages
(remote, stage) should mount it once if they use these components.

### `ErrorBoundary`
```tsx
<ErrorBoundary name="Timers" compact><TimersPanel /></ErrorBoundary>
```
The shell already wraps every view, show panel, toolbar item, status item and background
component. Use it yourself around risky sub-parts, for example a third-party embed.

## Drag to reorder

```tsx
const dnd = useDragReorder({ count: items.length, onReorder: (from, to) => save(moveItem(items, from, to)) })
<div {...dnd.containerProps}>
  {items.map((it, i) => { const p = dnd.itemProps(i); return <div key={it.id} {...p} className={`row ${p.className}`}>…</div> })}
</div>
```
To accept drops from elsewhere, pass `acceptType` and `onInsert`, and spread `dragSource(type, payload)`
on the source. Pass `axis: 'x'` for grids.

## Shell APIs (`app/`)

These are additions. The `defineFeature` contract is unchanged, and all new fields are optional:

```ts
defineFeature({
  views: [{ id: 'bible', title: 'Bible', order: 40, component: BibleView, volunteer: true }], // `volunteer`: stays visible in Volunteer mode
  statusItems: [{ id: 'sync', order: 20, component: SyncStatus }],    // bottom status strip
  commands: [{ id: 'timer.5', title: 'Start a 5 minute countdown', icon: 'clock', run: start5 }], // ⌘K actions (adminOnly hides in Volunteer mode)
  searchProviders: [{ id: 'bible', title: 'Bible', search: async (q) => [...] }],                 // ⌘K results, each with actions
  shortcuts: [{ group: 'Timers', keys: 'shift+T', label: 'Start the service countdown' }],      // listed in the ? overlay
})
```

```tsx
import { StatusItem } from '../../app/status'
function SyncStatus() { return <StatusItem tone="ok" icon="cloud" label="Synced" detail="Last synced 2 minutes ago" onClick={…} /> }
```

- `useLocked()` from `app/store` is true in Volunteer mode. Hide anything that edits, deletes or configures.
- `useApp((s) => s.prefs)` holds the per-computer UI prefs: `scale`, `thumbSize`, `volunteerPin`, `onboarded`, `autoContinue`.
- `useApp.getState().setOverlay('search' | 'shortcuts' | 'about' | 'welcome' | null)`.
- `openPresentation(id, 'edit')` is unchanged.
