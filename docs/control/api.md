# Remote, REST API, ProPresenter-compatible API and OSC

All served by the app's built-in server on its port (Settings → Remote & API shows the address and PIN).

**Auth.** Calls from the same computer need nothing. Others send the PIN as `?token=PIN`, `Authorization: Bearer PIN`
or `X-Reach-PIN`. Wrong or missing PIN gives `401`. The `/v1` compatible API follows the setting
*PIN needed / Anyone on the network / Off* (default: PIN).

## Phone remote

`GET /remote` — PIN entry, current/next slide, Back/Next, service items, clears, black/logo,
timers, messages and stage message. Uses the same WebSocket API as the app.

## Reach REST API (`/api/v1`)

`GET` and `POST` unless noted. `{id}` accepts an id or a name.

| Endpoint | Does |
|---|---|
| `GET /api/v1/status` | Current/next text, timers, messages, props |
| `GET /api/v1/live` | Full live state |
| `GET /api/v1/actions` | All action types and their parameters |
| `/api/v1/next`, `/prev` | Next / previous slide |
| `/api/v1/slide/{number}` | Slide number (1-based) in the live presentation |
| `/api/v1/section/{name}` | First slide of a section ("Chorus") |
| `/api/v1/item/{next|prev|number}` | Service item |
| `/api/v1/clear/{layer}` | all, slide, media, props, audio, message, announcement |
| `/api/v1/blackout/{on|off|toggle}` | Black screen |
| `/api/v1/macro/{id}` | Run macro |
| `POST /api/v1/action` `{type, params}` | Run any action |
| `/api/v1/timer/{id}/{start|stop|reset|restart|adjust|set}` | `seconds`, `duration`, `target` as query or body |
| `/api/v1/countdown/{id}` | Full-screen countdown |
| `/api/v1/message/{id}/show` | Fill-in values as query or `{values}`; `seconds` auto-hides |
| `/api/v1/message/{id}/hide`, `/api/v1/messages/hide` | Hide |
| `POST/PUT/DELETE /api/v1/stage-message` | `{text, flash}` / clear |
| `/api/v1/prop/{id}/{on|off|toggle}` | Props |
| `/api/v1/trigger/{name}` | Fire web-hook automations with that name |
| `GET /api/v1/{timers|macros|messages|props|audio|playlists|triggers}` | Lists |
| `POST /api/v1/rpc/{method}` | Call any app method with the body as payload |

## ProPresenter-compatible API (`/version`, `/v1`)

Shaped after Renewed Vision's published ProPresenter OpenAPI spec. Only the endpoints below exist; anything else is `404`.
Presentation/playlist `{which}` is `active` or `focused` (`focused` only for playlists next/previous).

- `GET /version`
- `GET /v1/status/slide` · `/v1/status/layers` · `/v1/presentation/slide_index`
- `GET /v1/trigger/next` · `/v1/trigger/previous`
- `GET /v1/presentation/{active|focused}/next/trigger` · `/previous/trigger` · `/trigger` · `/{index}/trigger` · `/group/{group}/trigger`
- `GET /v1/playlist/focused/next/trigger` · `/previous/trigger` · `/v1/playlist/focused/{index}/trigger` · `/v1/playlist/active/presentation/{index}/trigger` (indexes are 0-based like ProPresenter)
- `GET /v1/clear/layer/{audio|props|messages|announcements|slide|media}` (`video_input` is accepted but does nothing)
- `GET /v1/trigger/audio/next` · `/previous`
- `GET /v1/timers` · `/v1/timers/current` · `/v1/timers/{start|stop|reset}` · `/v1/timer/system_time` · `/v1/timer/{id}` · `/v1/timer/{id}/{start|stop|reset}` · `/v1/timer/{id}/increment/{seconds}`
- `GET /v1/macros` · `/v1/macro/{id}/trigger`
- `GET /v1/props` · `/v1/prop/{id}/trigger` · `/v1/prop/{id}/clear`
- `GET /v1/messages` · `POST /v1/message/{id}/trigger` · `GET /v1/message/{id}/clear`
- `GET|PUT|DELETE /v1/stage/message`

## OSC (UDP, off by default)

Set a port in Settings → Remote & API. Addresses: `/reach/next`, `/reach/prev`, `/reach/clear/{layer}`,
`/reach/slide/{n}`, `/reach/item/{next|prev|n}`, `/reach/section/{name}`, `/reach/macro/{id}`,
`/reach/blackout`, `/reach/timer/{id}` (+ `/start|stop|reset|restart` as 4th segment),
`/reach/prop/{id}`, `/reach/stage "text"`, `/reach/action/{type} '{"json":"params"}'`.
