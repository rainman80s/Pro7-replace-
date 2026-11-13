# Other integrations — done, designed, and ideas

| Integration | Status | Notes |
|---|---|---|
| **OBS Studio** (obs-websocket v5) | **Done** | Integrations → OBS (per computer). Slide/macro actions `obs.setScene {scene}` and `obs.request {requestType, requestData}` (e.g. `StartStream`, `StartRecord`). |
| **PCO Live** | Done (opt-in, mock-tested) | actions `pco.live.next` / `pco.live.previous` + follow-the-operator. |
| **CCLI SongSelect** | Document | No public lyrics API (SongSelect's API is partner-only). Legitimate route: download `.usr`/`.txt` from SongSelect → the files importer; songs then match PCO items by CCLI number automatically. |
| **CCLI reporting** | Next | Export "songs used" per date (from playlists with `ccliNumber`) as CSV for CCLI's online reporting; also streaming licence. |
| Google Slides / Canva / Keynote | Next | Export as PNG/PDF → import as image slides (same path as Figma). Google Slides API `presentations.pages.getThumbnail` could automate it with OAuth. |
| YouTube / Vimeo / Resi | Next | Media items by URL (download for offline where the licence allows); Resi/streaming encoders mostly via OBS or their own hardware. |
| Slack / PCO chat notifications | Next | "Slides ready for Sunday" when the Notion import + PCO pull are complete; a Slack incoming-webhook URL in local secrets. |
| Calendar (Google/PCO Calendar) | Idea | Auto-select next service; event countdowns in the lobby loop. |
| Planning Center Publishing | Idea | Sermon series artwork → title slide backgrounds. |
| ProPresenter network link | Not needed | Reach outputs are web pages; ProPresenter import is the files agent's. |
