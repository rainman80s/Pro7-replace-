# Displays, network displays, NDI and stream overlays

How Reach Presenter gets pictures onto screens, and how to set up each kind of screen.
Everything here is configured in **Displays** (the nav rail). Display routing is stored **per computer**
(`local.json` in the app's user-data folder) — it does not sync, because each computer has its own cables.
Screens (canvases) and regions **do** sync with the workspace.

## Concepts in one minute

| Word | Meaning |
|---|---|
| **Screen** (canvas) | One picture you design for: "Main Screen", "LED Wall", "Lobby", "Stage". Has a pixel size. |
| **Region** | A named part of a screen — e.g. "LED Top" / "LED Bottom" of a stacked LED wall. The slide editor shows regions as guides. |
| **Output** | "Show *this screen or region* on *that destination*". Destinations: a display plugged into this computer, a network display, a floating window, NDI, or a group. |
| **Also show on…** | A second output with the same source (duplication). |
| **Group** | Several outputs treated as one: **same picture on all** (mirror) or **split across them** (video wall). Switch on/off together. |
| **What this screen shows** | Per-screen layer switches (replaces ProPresenter Looks). E.g. Lobby = announcements only; Stream = no backgrounds/videos. |

## Displays plugged into this computer

- Reach recognises each display by a fingerprint (name, native size, position, built-in or not, OS id) and remembers what
  it showed. Unplug a projector mid-service and plug it back in: its output comes back by itself, without stealing focus.
- Reach **never** covers the screen you are operating on. If you choose it anyway, tick "Use this screen anyway" in the
  output's settings.
- Two identical TVs are told apart by their position in the OS display arrangement. Don't swap their positions in
  System Settings → Displays between services.
- If HDMI runs are flaky (displays vanish when a projector sleeps), fit an **EDID emulator** on that run.

**Safe mode**: `⌘⇧Esc` (Mac) / `Ctrl+Shift+F12` (Windows) — or "Hide all outputs" — hides every output on this computer
and blanks every network display instantly. Press again to bring them back.

### macOS notes (check on the real machine)
- System Settings → Desktop & Dock → **"Displays have separate Spaces" ON** (default). Outputs are borderless panels
  above everything on all Spaces; they don't use native fullscreen (no Space switching, no animation).
- AirPlay to an Apple TV: Control Centre → Screen Mirroring → pick it → **Use As Separate Display**. It then appears as a
  normal display under "Displays on this computer". Expect 100–300 ms of delay — fine for lobby screens, not for IMAG.
- macOS 15+ asks for **Local Network** permission the first time (needed for network displays and discovery). Allow it.
  Packaging needs `NSLocalNetworkUsageDescription` and `NSBonjourServices` (`_reach-presenter._tcp`, `_http._tcp`) in Info.plist.
- Energy: Reach keeps displays awake while outputs are showing; after sleep/wake outputs are re-placed automatically.

## Network displays (any TV / Pi / browser)

Any device with a modern web browser on the same network can be a display:

```
http://<this computer's IP>:4780/output.html
```

(Displays → Network displays shows the exact address and a QR code. Use the IP address; many TVs can't resolve `.local` names.)

1. Open the address on the device. It shows "This screen is ready" and its name.
2. In Reach, it appears under Network displays within seconds. Choose what it shows.
3. Reach remembers it. When the TV reboots and reopens the page, it goes straight back to what it showed.

Address options:

| Parameter | Effect |
|---|---|
| `?name=Lobby%20Left` | Initial name (you can rename in Reach; your rename wins). |
| `&receiverId=lobby-left` | A fixed identity. **Use this on kiosks** whose browser storage is wiped on reboot. |
| `?canvasId=<id>[&regionId=<id>]` | Show a screen directly, without assigning it in Reach (testing, OBS). |
| `&transparent=1` | Transparent background, no backgrounds layer (stream overlays). |

What the page does for you: reconnects by itself, **keeps the last picture** if the computer drops off the network,
holds a screen wake lock, goes fullscreen on first tap, syncs its clock to the host (NTP-style over the same connection)
so videos and timers line up across screens, and preloads the next slide's images/videos.

**Several TVs as one** (e.g. three TVs over Ethernet): Network displays → "Make several network displays act as one" →
tick the TVs in left-to-right order → choose *Split the picture across them* (one wide picture, auto-computed regions)
or *Same picture on every one*. Make a "Triple wide" screen (5760×1080) for a three-TV wall.

Latency: text and slide changes arrive in tens of milliseconds on a wired LAN. Video plays *on each device* from the
host's built-in web server and is kept in sync by clock + small speed nudges; cheap TV browsers may lack codecs (use
H.264 MP4) or stutter. Audio is never played by network displays unless you choose one as the audio place.

### Raspberry Pi (recommended, most reliable)
Raspberry Pi 4/5 with Raspberry Pi OS (Desktop), wired Ethernet.
```bash
sudo apt install -y chromium-browser unclutter
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/reach.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Reach display
Exec=chromium-browser --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required --check-for-update-interval=31536000 "http://192.168.1.50:4780/output.html?receiverId=lobby-left&name=Lobby%20Left"
EOF
```
Also: `sudo raspi-config` → Display → disable screen blanking. Give the Reach computer a fixed IP (DHCP reservation).

### Amazon Fire TV stick
Install **Silk Browser** (or "Fully Kiosk Browser" for auto-start), open the address, enable fullscreen. Add
`&receiverId=…` so it keeps its identity. Fire TV puts apps to sleep after the screensaver — set Settings → Display &
Sounds → Screensaver → Never (or start the screensaver after the longest time).

### Smart-TV browsers (Samsung Tizen, LG webOS)
Open the TV's web browser, enter the IP address (not `.local`), add a bookmark. Quality varies a lot: test video playback
before relying on it. If the TV's browser struggles, plug a Pi or Fire TV stick into it instead.

### Chromecast / Google TV
Reach lists Cast devices it finds but cannot drive them directly: Google requires a registered, internet-hosted receiver
app, which conflicts with a LAN-only, account-free setup. Use the TV's own browser (Google TV has Chrome-based browsers
in the Play Store) or a Pi. *Not implemented, on purpose.*

### Security
Network displays only get **read-only** access (what's live, the screen layout, media). Anything that changes routing
or the show needs the app itself or the remote-control PIN.

## Stream overlays (OBS / vMix browser source)

Add a **Browser source** with:
```
http://127.0.0.1:4780/output.html?canvasId=<screen id>&transparent=1
```
Width/height = the screen's pixel size (e.g. 1920×1080). The background is transparent and the backgrounds layer is
skipped, so lyrics sit over the camera shot. For a lower-thirds-only look, create a screen with the **Stream overlay**
preset (no backgrounds/videos) and design a variant of your slides for it. Copy-able URLs are on the Network displays tab.

## NDI output

NDI sends the rendered picture to OBS, vMix, TriCaster or hardware decoders. Reach renders each NDI output in a hidden
window at the screen's exact pixel size and sends frames (BGRA; with alpha when "Transparent" is ticked). When the page
is static the last frame is repeated at the chosen frame rate.

NDI is **optional** and not bundled. Without it, NDI outputs show "NDI isn't installed on this computer yet".
To enable on the show machine (tech lead):
```bash
npm i @stagetimerio/grandiose      # Apache-2.0, downloads the NDI SDK runtime
npx electron-rebuild -f -w @stagetimerio/grandiose
```
For packaged builds add the module's `dist/` to `asarUnpack`, and follow NDI's licence/branding terms
(NDI® trademark notice + link to ndi.video in About). Status: **frame plumbing verified with a fake sink in CI**;
the real NDI sender is **unverified** (no NDI runtime in the dev container). Check on a real Mac: the source shows up in
NDI Studio Monitor as "<computer> (Reach 1)", 1080p30 holds without dropped frames, alpha keys correctly in OBS.

Developer switches: `REACH_FAKE_NDI=1` (memory sink), `REACH_NDI_MODULE=<name>` (alternate binding such as `grandi`),
`REACH_FAKE_DISPLAYS='[…]'` (simulated display set), `REACH_NO_MDNS=1`.

## Program audio
Displays → Sound & safety → "Audio plays from": this computer (default), one output, or nowhere. Exactly one place plays
video and audio-file sound, so there is never an echo. Choosing a group plays from its first enabled screen.

## Real-hardware checklist (Mac first)
1. Two external displays + laptop: assign, reboot, confirm both come back on the right displays.
2. Unplug/replug a projector during a looping video: no crash, no focus change, output returns within ~1 s.
3. Close the lid / sleep and wake: outputs return on top, cursor hidden over them, the menu bar doesn't appear.
4. Mission Control / Cmd-Tab / a fullscreen app on the operator screen: outputs stay put.
5. Safe-mode shortcut works while another app is frontmost.
6. AirPlay "Use As Separate Display" shows up as a display and can be assigned.
7. A Pi and a Fire TV on Ethernet: video sync between them and a local output (aim < 2 frames).
8. NDI (if installed) visible in OBS; alpha correct.
9. 3840×2160 canvas with two regions on two 4K outputs: smooth dissolves, looping background video.
10. Windows: same tests; check the taskbar never covers an output and mixed-DPI placement is exact.
