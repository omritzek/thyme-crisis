# Phone Light Gun Game (MVP)

A two-screen, single-player shooting game. A computer displays the game (a single
slow-moving target). A phone acts as the gun: hold it up like a remote and pan/tilt
it to aim, tap the screen to fire. Aiming uses the phone's built-in motion sensors
(`DeviceOrientationEvent`) calibrated to a baseline pointing direction — there's no
camera or visual markers involved.

No app install — both the display and the phone open a web page in the browser.
They connect through a small local WebSocket relay server.

## Requirements

- Node.js 18+
- A computer and a phone on the **same local network**
- A phone browser with motion sensor support (iOS Safari, Android Chrome — most
  modern mobile browsers)

## Setup

```bash
npm install
npm start
```

The server listens on port 3000 by default (override with `PORT=xxxx npm start`),
and serves everything over **HTTPS with a self-signed certificate** — generated
fresh each time the server starts, valid for `localhost`, `127.0.0.1`, and every
LAN IP address detected on the machine. This is required because iOS Safari gates
motion sensor access (`DeviceOrientationEvent.requestPermission`) behind a secure
context, same as it does for camera access.

Because the certificate isn't from a trusted CA, **every device will show a
"connection is not private" warning the first time it loads the page** — this is
expected. Click through it (e.g. "Advanced" → "Proceed anyway" / "visit this
website") on both the computer and the phone.

## Playing

1. On the computer, open `https://<computer-lan-ip>:3000/` in a browser, accept
   the certificate warning, and go full-screen. It shows a 4-character session
   code and a QR code.
2. On the phone, open `https://<computer-lan-ip>:3000/phone`, or scan the QR code
   (the QR always encodes an `https://` link), accept the certificate warning, and
   tap **Join** (the code is pre-filled if you scanned the QR).
3. Tap **Enable Motion Access** (iOS will show a native permission prompt the
   first time).
4. Hold the phone pointed at the middle of the display, hold it steady, and tap
   **Calibrate**. This records the phone's current pan/tilt as "aim center" — it
   does not need to see anything on screen, it just needs to be pointed at it.
5. Aim by physically panning/tilting the phone (moving it left/right pans the
   crosshair left/right; tilting the top of the phone up/down moves it up/down),
   and tap anywhere on the phone screen to fire. If the crosshair feels drifted
   or off-center, tap **Recalibrate** (top-right during play) without leaving the
   game.

Find your computer's LAN IP with `ipconfig getifaddr en0` (macOS), `hostname -I`
(Linux), or `ipconfig` (Windows) — or just read it from the server's startup log,
which prints every LAN address it's reachable on.

## Project structure

```
/server
  index.js          # express + ws relay, serves /public
/public
  /display
    index.html
    display.js       # game state, rendering, hit detection
  /phone
    index.html
    phone.js          # motion sensor calibration, aim computation, input handling
  /shared
    protocol.js       # message type constants shared by both clients
package.json
```

## How it works

- **Relay server** (`server/index.js`): an Express app plus a `ws` WebSocket
  server, both running over a self-signed HTTPS certificate generated at startup
  (via the `selfsigned` package). Clients connect to `/?role=display&session=CODE`
  or `/?role=phone&session=CODE`. The server pairs at most one display and one
  phone per session code and relays JSON messages between them — it holds no game
  state. Every connection attempt and its outcome is logged to the terminal, which
  is the fastest way to debug a pairing that won't complete.
- **Display client**: owns all game state — the target's position, score, and shot
  count. Renders a fixed 1280×720 logical canvas with a single character that
  drifts slowly around the safe play area, bouncing off its bounds. It resolves
  hits/misses when it receives `fire` messages and renders a live crosshair from
  `aim` messages.
- **Phone client**: on pairing, requests motion sensor access
  (`DeviceOrientationEvent.requestPermission()` on iOS 13+; no prompt needed on
  most Android browsers), then waits for the player to point the phone at the
  screen and tap **Calibrate**, which records the current compass heading
  (`alpha`) and front-back tilt (`beta`) as the "aim center" baseline. On every
  subsequent sensor reading, the angular delta from that baseline is scaled by a
  fixed degrees-per-screen-width constant (`AIM_RANGE_DEG`, currently 25°) and
  clamped to produce a normalized `x,y` aim point, sent at ~20/sec. Taps send
  `fire` with the most recent aim point; a short grace period (400ms) tolerates
  the sensor jitter that tapping the screen itself causes, so a real tap doesn't
  silently get swallowed by a one-frame reading blip.

## Known limitations (by design, see PRD)

- No moving-target-avoidance, multiplayer, or persistence — this is an MVP
  proving the aiming interaction, not a shippable game.
- The self-signed certificate means every device must click through a browser
  security warning once per server restart (the cert is regenerated fresh each
  time `npm start` runs). If you'd rather not see that warning at all, generate a
  locally-trusted certificate with [mkcert](https://github.com/FiloSottile/mkcert)
  and pass its key/cert paths in instead — not needed for normal use.
- Motion-sensor aiming has no absolute ground truth (unlike the camera+marker
  approach it replaced) — it's entirely relative to wherever you were pointing at
  calibration time. If you physically move to a different spot relative to the
  screen after calibrating, or the crosshair drifts over a long play session, tap
  **Recalibrate** while pointed back at center.
- `AIM_RANGE_DEG` in `phone.js` is a fixed sensitivity constant, not adaptive to
  distance from the screen — if aiming feels too twitchy or too sluggish, that's
  the value to tune.
