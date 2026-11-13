# Reach Presenter — integrations

| Area | Code | Doc |
|---|---|---|
| Planning Center Services → service plans | `src/main/services/pco/` | [planning-center.md](planning-center.md) |
| Notion → sermon slides + announcements loop | `src/main/services/notion/` | [notion-slide-rules.md](notion-slide-rules.md) (for pastors) |
| Bibles (offline public domain + API.Bible + ESV) | `src/shared/bible.ts`, `src/main/services/bible/` | [bibles.md](bibles.md) |
| Cloud workspace (built-in sync, cloud folders, history, presence) | `src/main/services/sync/` | [cloud-workspace.md](cloud-workspace.md) |
| Figma → image slides | `src/main/services/figma/` | [figma.md](figma.md) |
| OBS scenes | `src/main/services/obs/` | [roadmap.md](roadmap.md) |
| What Reach's real data looks like | — | [reach-data-shapes.md](reach-data-shapes.md) |
| Everything else (CCLI, Slack, calendar, YouTube…) | — | [roadmap.md](roadmap.md) |

Common rules: all network calls run in the main process through `integrations/http.ts` (timeouts, retries with
backoff, 429/Retry-After, per-service rate limit, plain-English errors). Credentials are stored only with
`local.setSecret` (OS keychain–encrypted, per computer, never in the workspace). Everything pulled in is written to the
workspace (presentations, playlists, media, Bibles), so Sunday works offline.

API base URLs are overridable for tests: `REACH_PCO_API`, `REACH_NOTION_API`, `REACH_FIGMA_API`, `REACH_HELLOAO_API`,
`REACH_APIBIBLE_API`, `REACH_ESV_API`. Mock servers: `tests/mock-apis.mjs`.
