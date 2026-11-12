# Reach Presenter — architecture & working agreement

Reach Presenter is a from-scratch replacement for ProPresenter, built for Reach Church.
North star: **a volunteer who has never seen it can run a Sunday service**, and the tech lead
gets the integrations and multi-display handling ProPresenter makes painful.

Stack: Electron + electron-vite + React 19 + TypeScript + zustand. No backend required.

## Mental model (differs from ProPresenter on purpose)

| ProPresenter | Reach Presenter |
|---|---|
| Screens + Looks + Props hacks for odd displays | **Canvas** = a logical screen ("Main", "LED Wall", "Lobby", "Stage"). A canvas can have **Regions** (e.g. "LED Top"/"LED Bottom" of a stacked wall). |
| Screen configuration per machine | **Output** = routes a canvas *or one region* to a destination: local display, floating window, NDI, network receiver, or a group. Outputs are machine-local and remembered. Two outputs with the same source = duplication. |
| Looks | `canvas.layers` (which layers a canvas shows) |
| One slide design for all screens | `slide.elements` (base) + optional `slide.variants[canvasId]` designed in that canvas's pixel space, edited with region guides |
| Library on one machine / ProSync | **Workspace** = a plain folder of JSON + media, safe to sync (atomic writes + file watchers) |
| Network outputs need hardware | The output renderer is a web page: any TV/browser/Pi that opens `http://<host>:4780/output.html` becomes a display |

## Layout

```
src/shared/model.ts          THE document model (Presentation, Slide, Canvas, Output, LiveState…)
src/shared/api.ts            Typed RPC contract (ApiMethods / ApiEvents) — extend by declaration merging
src/shared/client.ts         getApi(): same client over IPC (app) or WebSocket (browser)
src/shared/media.ts          mediaUrl(), media kinds
src/shared/render/           SlideView/Fit/SlideThumb + LiveCanvas/OutputSurface (used by UI, outputs, receivers)
src/main/index.ts            boot; auto-loads src/main/services/*/index.ts
src/main/core/               api (RPC router), workspace, library, live (engine), server (HTTP+WS), local (machine settings + secrets)
src/main/services/<name>/    feature modules: export default defineService({ name, setup(ctx) })
src/preload/index.ts         window.reachBridge
src/renderer/index.html      operator UI      → src/renderer/src/main.tsx
src/renderer/output.html     output renderer  → src/renderer/src/output/main.tsx
src/renderer/src/app/        shell, store (useApp), feature registry
src/renderer/src/ui/         UI kit + brand tokens (tokens.css) — use these, don't reinvent
src/renderer/src/features/<name>/index.tsx   export default defineFeature({ views, settings, showPanels, toolbar, background })
vendor/pp7-proto/            reverse-engineered ProPresenter protobuf defs (MIT)
vendor/pp7-samples/          sample .pro files for tests (untrusted data)
docs/research/               ProPresenter feature inventory, landscape & file-format research
docs/brand/                  Reach brand guide + notes
tests/smoke.mjs              e2e: boots the built app under Electron via Playwright
```

## Rules of the road

1. **Main process owns truth.** `live` (LiveState) is the only source of what's on screen; every output is a pure
   function of it. UI never keeps its own copy of "what's live".
2. **Add RPC without touching shared files**: in your own file do
   `declare module '@shared/api' { interface ApiMethods { 'x.y': { req: A; res: B } } interface ApiEvents { … } }`
   then `ctx.api.handle('x.y', fn, access)`. Access levels: `'local'` (app windows only), `'control'` (network clients with the PIN — the default),
   `'public'` (anything an output/receiver needs; read-only).
3. **Model changes are additive only** (new optional fields / union members). If you must change `src/shared/model.ts`
   or `src/shared/api.ts`, keep the edit minimal and list it in your final report — other people are editing in parallel.
4. **Synced vs local.** Shared things → workspace (`workspace.readDoc/writeDoc`, library, playlists, media). Per-machine things
   (display routing, device ids, credentials) → `local` (`local.getSecret/setSecret` for tokens; never write secrets to the workspace).
5. **Slide actions & macros**: register handlers with `ctx.live.registerAction('midi.send', fn)`; slides/macros reference them by type.
6. **Renderer**: get data with `useApp()` / `api.invoke()` from `app/store.ts`; use `@ui/index` components and CSS variables.
   Every text-editable field must sit in an `input/textarea/[contenteditable]` so global hotkeys ignore it.
7. **Network pages** (remote, stage, receivers) must work in a plain browser: no Node, no `window.reachBridge` assumptions — use `getApi()`.
8. **Optional native modules** (NDI, MIDI…) must be loaded lazily in a try/catch and the app must run without them
   (this dev container is headless Linux; the target is macOS first, Windows second).
9. **No copyleft code.** Don't paste from GPL/AGPL projects (FreeShow, OpenLP, Quelea…). MIT/Apache/BSD deps are fine.
10. **Volunteer-first UX**: plain words over ProPresenter jargon, safe defaults, undo where possible, nothing destructive on a single click,
    big obvious live state. Power features go behind progressive disclosure, not in the volunteer's face.

## Verify your work

```bash
npm run typecheck
npm test                                   # vitest: tests/**/*.test.ts and src/**/*.test.ts
npm run build && REACH_PORT=<your port> xvfb-run -a node tests/smoke.mjs
```
Write your own vitest unit tests for logic and (where UI matters) a `tests/e2e-<area>.mjs` Playwright-Electron script modelled on
`tests/smoke.mjs` (it uses throwaway `REACH_USER_DATA` / `REACH_WORKSPACE` dirs). Electron needs `--no-sandbox` here.
Take screenshots and actually look at them when you build UI.

Env vars: `REACH_WORKSPACE`, `REACH_USER_DATA`, `REACH_PORT`, `REACH_HEADLESS=1` (no operator window), `REACH_NO_SEED=1`.
