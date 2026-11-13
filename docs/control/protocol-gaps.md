# Protocols not built

ProPresenter can talk to other gear over these. Reach Presenter does **not** implement them yet.
Use the workarounds until a church actually needs one.

| Protocol | Status | Workaround |
|---|---|---|
| RossTalk (Ross video switchers) | Not built | Companion's Ross module, driven by the REST API or a macro that calls it |
| AMP / VDCP (video disk recorders) | Not built | None needed for our setup; use NDI or a media player |
| DMX / Art-Net (lighting) | Not built | Send MIDI or OSC to the lighting desk (`midi.send`, OSC) |
| GlobalCache (IR/relay) | Not built | Companion's GlobalCache module triggered through `/api/v1` or `/v1` |
| ProPresenter Timeline start/stop/rewind, media playlists, collections | Not built | Rows are left out of the MIDI preset |

Supported instead: MIDI in/out, OSC in, REST, the ProPresenter-compatible HTTP subset, web-hook automations and macros.
See `midi.md` and `api.md`.
