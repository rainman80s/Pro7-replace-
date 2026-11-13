# Planning Center Services

## Set up (each computer, once)
1. Sign in at https://api.planningcenteronline.com/oauth/applications as someone who can see Services plans.
2. **Personal Access Tokens → Create one now**, name it "Reach Presenter".
3. Integrations → Planning Center: paste the **Application ID** and **Secret** → Connect. The service type that looks
   like the Sunday service (`*Churchwide Gatherings` at Reach) is chosen automatically.

The token can read everything that person can read in PCO. The app only calls Services endpoints, read-only — except
the opt-in **Drive PCO Live** switch, which POSTs `live/go_to_next_item` / `go_to_previous_item`.

## What a pull does
`GET /services/v2/service_types/{st}/plans/{plan}` + `/items?include=song,arrangement,key,item_notes` (paginated via
`meta.next.offset`, `per_page=100`) + `/team_members?include=team` + `/plan_times`.

| PCO | Reach Presenter |
|---|---|
| plan `dates` + `title` | playlist name ("November 15, 2026 — Sardis / Revelation 3:1-6"), `date` = first service's local date |
| `header` item | header (section) |
| `song` item | presentation from the library — matched by remembered link → CCLI number → exact title → confident fuzzy title. Unmatched: review screen offers *use existing*, *import lyrics from the PCO arrangement* (lyrics + `sequence` → groups + arrangement in plan order; chords stripped), or *placeholder* |
| other items | typed placeholders: Message/Sermon → `sermon` (filled from Notion), Announcements/Highlights → `announcements`, video → `media`, Call to Worship/Benediction/Reading → `scripture` |
| `length` | item length |
| ItemNote in category **Person** (Reach's convention) | `people` on the item; else the team position whose name matches the item ("Benediction", "Speaker" → Message) |
| other ItemNotes, `description`, `html_details`, key/arrangement/bpm | item `notes` |
| team members in key roles (Speaker, Host, Worship Leader, Announcements…) | plan-level roles at the top of the review |
| `plan_times` of type service | "Service starts 9:00" countdown suggestions → workspace doc `timers` (`{id,name,kind:'countdownTo',target:'HH:MM'}`) |

## Re-sync (plans change all week)
Every imported item remembers the PCO values it was created with (`playlist.source.origins[itemId].base`). A re-pull is a
three-way merge: remote-only changes apply, local-only edits are kept, both-changed is a **conflict** (default: keep
yours). Items you deleted stay deleted; items you added stay next to their neighbour; a remote re-order is followed
unless you re-ordered locally too. Filled placeholders (sermon linked to a presentation) keep their slides. The app
re-checks upcoming plans every 15 minutes (configurable) and shows "3 changes from Planning Center" on the Show screen
with a review screen. Rate limits: ~4 req/s, 429 + `Retry-After` honoured. Offline: the pulled playlist keeps working.

## OAuth later
`PcoClient` takes an auth strategy (`{type:'pat'}` or `{type:'oauth', accessToken}`); to ship OAuth: register an app at
api.planningcenteronline.com/oauth/applications (redirect `http://127.0.0.1:<port>/oauth/pco`), do Authorization Code +
PKCE in the system browser, store refresh token with `local.setSecret('pco.refresh')`, refresh on 401.

## PCO Live
Opt-in "Drive PCO Live": when the operator goes to a playlist item, the app reads `GET …/live?include=current_item_time`
and steps the Live session with `go_to_next_item`/`go_to_previous_item` until it's on the matching PCO item. Also slide
actions `pco.live.next` / `pco.live.previous`. (Requires the token owner to have Live control rights.) Not verified
against the real API — mock only.
