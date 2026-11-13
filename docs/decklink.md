# SDI output through a Blackmagic DeckLink card (Mac)

For the tech lead. Do this once on the presentation Mac. It takes about 30 minutes plus testing.

Reach can send any screen or region out of a **DeckLink** SDI port (the Duo 2 in the booth, the second SDI device for
the stage display). On a Mac a DeckLink card is not a display, so Reach talks to it through a small native add-on.
That add-on has to be **built on the Mac**, against Blackmagic's SDK. We can't ship it prebuilt because the SDK needs
a free registration download and has its own licence.

> **Status: unverified.** The add-on (`native/decklink/`) was written against Blackmagic's documented API, with no
> card and no SDK available. It has never been compiled or run on hardware. Everything around it (routing, pacing,
> the Displays page, error messages) is tested against a fake card. Expect the first build to need small fixes.
> See "If the build fails" below. Test it thoroughly (checklist at the end) before a Sunday.

## What you get

| ProPresenter screen | Size | Reach canvas → region | SDI port | Format | Keying |
|---|---|---|---|---|---|
| LED WALL | 1920×880 | **LED Wall (stacked)** → Top | DeckLink Duo 2 · port 1 | 1080p29.97 | Picture only |
| Key | 1920×1080 | **Key** (transparent background) | DeckLink Duo 2 · port 2 | 1080p29.97 | Fill + key |
| LED LYRICS | 1920×320 | **LED Wall (stacked)** → Bottom | DeckLink Duo 2 · port 3 | 1080p29.97 | Picture only |
| Stage Display | 1920×1080 | **Stage Display** | the other Blackmagic SDI device | 1080p60 | Picture only |

A picture smaller than the SDI frame (1920×880 inside 1920×1080) sits **top-left, pixel for pixel**, with black below.
That's what an LED processor expects. You can change it to "Centred" per output. A picture bigger than the frame is
scaled down to fit.

## 1. Install Blackmagic Desktop Video

1. Download **Desktop Video** for macOS from blackmagicdesign.com → Support → "Capture and Playback".
   It's probably already installed if ProPresenter uses the card.
2. Install it. macOS asks you to allow the Blackmagic system extension (System Settings → Privacy & Security).
   Allow it and restart.
3. Open **Blackmagic Desktop Video Setup** and check that the Duo 2 and the stage device show up. Note the port
   names (e.g. "DeckLink Duo (1)" … "(4)").
4. Write down the Desktop Video version (Desktop Video Setup → About). The SDK you download must be the **same
   version or older**.

## 2. Download the DeckLink SDK

1. blackmagicdesign.com → Support → search "Desktop Video SDK" (it's listed as **Blackmagic DeckLink SDK**).
   Register and download the version that matches Desktop Video.
2. Unzip it, e.g. to `~/Downloads/Blackmagic DeckLink SDK 14.4/`.
3. The folder you need is `…/Mac/include`. It contains `DeckLinkAPI.h`, `DeckLinkAPIDispatch.cpp` and
   `DeckLinkAPIVersion.h`. **Don't copy the SDK into the Reach repo.**

## 3. Build the add-on

Prerequisites: Xcode Command Line Tools (`xcode-select --install`), Node as used for Reach, and `npm install` done
in the repo.

```bash
cd reach-presenter
DECKLINK_SDK_DIR="$HOME/Downloads/Blackmagic DeckLink SDK 14.4/Mac/include" npm run build:decklink
```

This compiles `native/decklink` with node-gyp against **Reach's Electron version** (not your Node version) and
writes `native/decklink/build/Release/reach_decklink.node`.

- **Development** (`npm run dev`): picked up automatically.
- **Packaged app** (`npm run dist:mac`): electron-builder copies it to `Reach Presenter.app/Contents/Resources/decklink/`.
  Build the add-on **before** `dist:mac`. Without it the app still works, just without SDI.
- **After upgrading Electron or Desktop Video**: run `npm run build:decklink` again.
- To try a build somewhere else, set `REACH_DECKLINK_MODULE=/path/to/reach_decklink.node`.

The add-on doesn't link the DeckLink framework at build time. It compiles the SDK's own `DeckLinkAPIDispatch.cpp`,
which loads `/Library/Frameworks/DeckLinkAPI.framework` (installed by Desktop Video) when Reach starts. That is how
Blackmagic's sample apps work, and it means a missing driver shows a message instead of a crash.

### If the build fails

The code targets SDK 12.x–14.x. Likely spots, all in `native/decklink/src/decklink_addon.cc`:

- **`GetBytes` / `IDeckLinkVideoBuffer`**: newer SDKs moved frame memory access to `IDeckLinkVideoBuffer`. The
  file guesses from `BLACKMAGIC_DECKLINK_API_VERSION`. Force one or the other by adding
  `"REACH_DECKLINK_VIDEO_BUFFER=1"` (or `=0`) to `defines` in `native/decklink/binding.gyp`.
- **`IDeckLinkProfileAttributes`** was called `IDeckLinkAttributes` before SDK 11. Use a newer SDK.
- **A method signature doesn't match** (e.g. an `override` error): check that method in the SDK's
  `DeckLinkAPI.h` and adjust. The SDK manual (PDF in the SDK zip) documents every call used:
  `IDeckLinkIterator`, `IDeckLinkOutput::EnableVideoOutput / CreateVideoFrame / ScheduleVideoFrame /
  StartScheduledPlayback / StopScheduledPlayback`, `IDeckLinkVideoOutputCallback`, `IDeckLinkKeyer`.
- **Spaces in the SDK path**: the build script goes through a symlink (`native/decklink/.sdk`), so that's handled.

## 4. Quit ProPresenter

Only one app can drive a DeckLink port at a time. **Quit ProPresenter completely** (⌘Q, not just close the window)
before Reach starts its SDI outputs. If ProPresenter still has a port, that output in Reach says:

> "DeckLink Duo 2 · port 2" is busy (is ProPresenter running?)

Reach keeps trying every few seconds. As soon as ProPresenter quits, the output starts by itself.

## 5. Set up the screens in Reach

1. **Import from ProPresenter** (Import → ProPresenter). In the report under "ProPresenter screens → Reach
   canvases", Reach suggests **LED Wall (stacked)**, 1920×1200 with regions *Top* (0,0 1920×880) and *Bottom*
   (0,880 1920×320). It's marked *Recommended* and already ticked. Also tick **Key** and **Stage Display**, then
   click "Create selected canvases".
   (Without an import: Displays → Screens & regions → add a canvas from the "Stacked LED wall" preset and resize
   the regions to 880 / 320.)
2. Make **Key** render transparent: its slides and themes should have no background. Reach sends the
   transparent areas as "no key".
3. Go to **Displays → Where things show**. Under **SDI outputs (Blackmagic DeckLink)** you see one card per port
   (click "Check again" if you just plugged something in). On each card, pick what it shows:
   - *DeckLink Duo 2 · port 1* → **LED Wall (stacked) › Top**
   - *DeckLink Duo 2 · port 2* → **Key**, then in its settings set **Keying: Fill + key (for a switcher)**
   - *DeckLink Duo 2 · port 3* → **LED Wall (stacked) › Bottom**
   - the stage device → **Stage Display**, then set **Video format: 1080p60**
4. Check each output's **Video format** in its settings (default 1080p29.97). It must match what the LED
   processor and the switcher expect, which is what ProPresenter used.
5. Reach remembers each port **by card model + port number** on this Mac. If the card goes missing, the output says
   "isn't connected right now" and comes back by itself.

**Fill + key and port pairing.** In fill + key mode the card sends the picture (fill) on the chosen port and the
alpha (key) on a **paired** port, which can't be used for anything else at the same time. Which ports pair on the
Duo 2, and whether keying needs a particular connector mapping, is set in **Desktop Video Setup**. Check it there
before you rely on the table above. If the key would land on port 1 or 3, move the LED feeds to the free ports.
If a port can't key, Reach says so ("can't do keying") and doesn't silently send fill only. On the ATEM side, set
the upstream/downstream keyer to that fill/key pair and turn on **Pre-multiplied key** (Reach sends
pre-multiplied fill, the same as Chromium paints it).

## 6. Test checklist (before the first Sunday)

Do these with ProPresenter **quit**, on the real wiring.

- [ ] **Driver / build states**: Displays → Sound & safety → "SDI (Blackmagic DeckLink)" says *DeckLink is ready
      (Desktop Video x.y)*. (Without the build it says "DeckLink output not built — run npm run build:decklink".
      Without Desktop Video it says "DeckLink driver not installed".)
- [ ] **Colour bars on each port**: select each SDI output → Test pattern → *Colour bars*. Check on the LED
      processor, the switcher multiview, and the stage monitor that every port shows bars, in the right place, with
      correct colours (no pink/green = wrong pixel format, no wrap-around = wrong size).
- [ ] **Region alignment**: Test pattern → *Region labels* / *Pixel grid + size* on the LED outputs. The top strip
      must start at the LED processor's first pixel row, and the bottom strip likewise.
- [ ] **Fill + key into the switcher**: put lyrics on Key. On the ATEM the keyer shows clean text over camera, with
      no black box (key working) and no dark fringe (pre-multiplied on). Switch Keying back to "Picture only" and
      check that you see text on black.
- [ ] **29.97 vs 59.94**: confirm the LED processor and switcher lock to 1080p29.97, and the stage device to
      1080p60. Try 1080p59.94 on the stage device too and keep whichever the monitor/converter locks to. A wrong rate
      usually shows as "no signal" or a flashing picture.
- [ ] **Motion**: play a moving background and a slide transition on the LED wall. Look for smooth motion
      (occasional repeated frames are fine; regular stutter is not). Sound & safety shows each port's frame counters.
      *late* should stay near zero.
- [ ] **Unplug / replug**: pull and re-seat each SDI cable while live (the output must recover instantly; the card
      keeps sending). If the stage device is on Thunderbolt/USB, unplug it: Reach shows "isn't connected right now";
      plug it back in: it resumes within ~5 s without touching anything.
- [ ] **Busy**: start ProPresenter while Reach runs, or start Reach while ProPresenter runs. Reach should say "busy
      (is ProPresenter running?)" and recover when ProPresenter quits.
- [ ] **Safe mode**: ⌘⇧Esc hides all outputs (SDI goes black / no key), press again to bring them back.
- [ ] **2-hour soak**: run a looping playlist with video backgrounds on all four ports for 2 hours. Afterwards:
      no drift between LED top and bottom, no growing delay, Activity Monitor shows stable memory for Reach, and the
      frame counters keep rising.

## How it works (for developers)

```
canvas/region ─▶ offscreen output window (same page as every output, rendered at the region's size)
               ─▶ FramePump (newest frame only) ─▶ FramePacer @ the mode's exact rate (30000/1001 …)
               ─▶ DeckLinkSink.pushFrame ─▶ native: copy → [card's callback thread] place/scale into the
                  1080 frame → ScheduleVideoFrame; 3-frame preroll; when no new frame came, the card's
                  frame is re-scheduled as is (repeat-last), so SDI never stalls.
```

- JS: `src/main/services/outputs/decklink.ts` (loader, registry, pacer, sink), `decklink-fake.ts` (fake card),
  `src/shared/decklink.ts` (types, RPC `decklink.status` / `decklink.devices` / `decklink.forget`).
- Native: `native/decklink/src/decklink_addon.cc`. `pushFrame` never waits for the card: it swaps a buffer under a
  short lock. All DeckLink calls run on libuv worker threads or the driver's own callback thread.
- Tests: `tests/decklink.test.ts` (fake card), `tests/e2e-decklink.mjs` (`REACH_FAKE_DECKLINK=1`, whole app).
