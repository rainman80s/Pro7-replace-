# Livestream output (16:9)

The LED wall is two strips (1920×880 + 1920×320), but the stream encoder wants a normal 16:9 picture. Instead of
sending the 1920×880 slide letterboxed with black bars, give the stream its **own screen**:

1. **Displays → Screens & regions → + Livestream** (or *+ New screen → Livestream (16:9)*).
   You get a 1920×1080 screen with the **Background** and **Video** layers off and the built-in theme
   **Livestream lower third** as its default theme (`canvas.themeId`).
2. Every slide that has no layout of its own for this screen is automatically restyled: lyrics become a two-line
   lower third on a soft translucent plate, over transparency. You do not edit any slide. To fine-tune one slide, use the
   *Livestream* tab in the editor (its own layout wins over the theme). To change the look for all slides, edit the theme in
   *Edit → Themes* (a workspace theme with id `reach-livestream` replaces the built-in).
3. Send it out (Displays → *Where things show* → add an output whose screen is **Livestream (16:9)**).

## Getting it into the stream

| Route | How | Notes |
|---|---|---|
| **DeckLink fill + key into the switcher** | Output → *DeckLink*, port with SDI; keying *Fill + key* (fill on one port, key on the next). Set the switcher's downstream keyer (e.g. ATEM DSK) to *Key source = the key port, Fill = the fill port*. | Cleanest: lyrics sit over the program camera, no re-encode. Format 1080p29.97 to match the switcher. See `docs/decklink.md`. |
| **NDI** | Output → *NDI*, tick **Transparent** (alpha). In OBS (DistroAV/NDI plugin), vMix, or the ATEM-like NDI switcher, add an NDI source named as shown. | One cable; alpha channel carries the key. Works over Wi‑Fi but prefer wired. |
| **OBS / vMix browser source** | Displays → *Network displays* → *Live stream overlays*: copy `http://<this computer>:4780/output.html?canvasId=<id>&transparent=1`; add a *Browser source* 1920×1080. | No hardware at all; the encoder computer only needs network access to this one. |
| **Window capture** | Output → *Window* (floating), tick **Transparent**, then *Window Capture* in OBS (macOS: Screen Capture → window; transparency needs the NDI or browser route). | Simplest to try, least reliable. |

Tips:
- Keep the **Livestream** screen's output *Transparent* for NDI/browser sources and **Fill + key** for SDI; for a
  solid-colour chroma key instead, add a background colour layer in the theme.
- Announcement and video layers are off by default so the stream never gets a full-screen slide by accident; turn them on
  per screen in *Screens & regions → Layers* if you want them.

## Not included (possible future)

Streaming directly to RTMP/SRT from Reach Presenter (so no OBS/encoder is needed) is out of scope; the app only produces
the picture. It would need an encoder (ffmpeg/libav) fed from the same frame pump that NDI/DeckLink use.
