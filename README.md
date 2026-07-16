# Thyme Crisis Game(MVP)

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

## Customizing the visuals

- **Background**: drop an image directly in `public/display/assets/` — any
  filename, any of `.png`/`.jpg`/`.jpeg`/`.webp`. See
  `public/display/assets/README.md` for details. Falls back to a plain dark
  background if nothing's there.
- **Enemy sprites**: drop PNG images (transparent background) into
  `public/display/assets/enemies/` — see `public/display/assets/enemies/README.md`
  for exact requirements. No restart needed beyond a page reload; the display
  asks the server what's in that folder on load, and picks a random one per
  spawn if there's more than one. Falls back to a built-in drawn face if the
  folder is empty.

Both are auto-detected by the server (`GET /api/background-image` and
`GET /api/enemy-sprites`) — you never need to edit code or update a filename
in `display.js` to swap art.

## Project structure

```
/server
  index.js          # express + ws relay, serves /public
/public
  /display
    index.html
    display.js       # game state, rendering, hit detection
    /assets
      *.jpg/png       # background image, any filename (not checked in by default — see assets/README.md)
      /enemies        # optional enemy sprite images (see enemies/README.md) — empty folder is fine
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
- **Display client**: owns all game state — score, shots, lives, and the current
  enemy. Renders a fixed 1280×720 logical canvas with whatever image the server
  finds via `GET /api/background-image` as a cover-fit background (falls back
  to a plain dark background if none is found). Once the phone pairs, the
  display shows a "waiting for player" overlay and doesn't spawn anything
  until the phone finishes its *first* calibration (a `calibrated` message,
  sent once — recalibrating later doesn't re-trigger this or reset the
  running game). After that, an enemy spawns on a fixed
  cadence (`SPAWN_INTERVAL_MS`, 5s) at one of a handful of fixed spots
  positioned over playground features in that background (tunnel opening,
  climbing panel, dome roof, swing seat, benches — see `HIDE_SPOTS` in
  `display.js`), rendered either as a sprite from `GET /api/enemy-sprites`
  (randomly picked per spawn, if any are present) or a built-in drawn face.
  Each enemy has a fixed window (`ENEMY_LIFETIME_MS`, 3s) to be shot: a `fire`
  message landing within its hit radius while it's up kills it (+1 score),
  showing a bright impact burst plus the sprite's `-hit` pose (or a white
  tint if there isn't one) held for `HIT_HOLD_MS` (450ms) before it ducks
  down, so the hit actually reads clearly instead of flashing for a single
  frame; if that window expires first, it fires back instead — the player
  loses a life (with a muzzle-flash effect at the enemy and a red screen
  flash), and the enemy ducks down either way. Losing all starting lives
  (`STARTING_LIVES`, 3) shows a **GAME OVER** overlay with the final score,
  then auto-restarts after a few seconds. Also renders a live crosshair from
  `aim` messages. Pressing **Esc** at any time during play pauses the game
  (freezing every timer so nothing resolves the instant you resume) and
  shows **Restart** (resets score/lives, keeps calibration) and **Quit to
  Lobby** (disconnects the phone back to its join screen and returns the
  display to the pairing screen).
- **Phone client**: on pairing, requests motion sensor access
  (`DeviceOrientationEvent.requestPermission()` on iOS 13+; no prompt needed on
  most Android browsers). Raw `alpha`/`beta`/`gamma` readings are smoothed with an
  exponential moving average (raw sensor data is noisy enough to visibly jitter
  the crosshair otherwise), then converted into the 3D direction the back of the
  phone points — the same axis a rear camera would point down, i.e. however you'd
  naturally hold it like a remote aimed at the screen — rather than using the
  Euler angles directly, since those hit a real gimbal-lock singularity exactly
  when the phone is held near-vertical (the aiming pose). The player points at the
  screen and taps **Calibrate**, which records that direction's azimuth/elevation
  as the "aim center" baseline; every subsequent reading's angular delta from that
  baseline is scaled by a fixed degrees-per-screen-width constant (`AIM_RANGE_DEG`,
  currently 25°) and clamped to a normalized `x,y` aim point, sent at ~20/sec.
  Taps send `fire` with the most recent aim point; a short grace period (400ms)
  tolerates the sensor jitter that tapping the screen itself causes, so a real tap
  doesn't silently get swallowed by a one-frame reading blip. Since axis-sign
  conventions can vary by device/browser, **Invert Pan**/**Invert Tilt** toggles
  on the calibrate screen (persisted per-device) let the player fix a backwards
  axis themselves without a code change. Each tap also fires the phone's own
  camera flash as a physical "muzzle flash," if the browser exposes torch
  control on a camera track — Android Chrome/Edge generally do; **iOS Safari
  never has** (an Apple/WebKit platform restriction, not a bug here), so on
  iPhone the game just plays without it, silently, with no extra permission
  prompt for a feature that could never work there anyway. The gun holds 6
  shots (`AMMO_MAX`); once empty, taps do nothing but flash a "reload" hint
  until the player tilts the phone down (50°+ below the calibrated baseline,
  held briefly) to reload back to a full 6 — same aim math already used for
  aiming, just checking the tilt delta against a different threshold.

## Deploying it publicly

Running on your own LAN is fine for playing at home, but a **self-signed
certificate only works if you personally click through the "not secure"
browser warning** — a random visitor won't (and iOS Safari may refuse
motion-sensor access on an untrusted origin outright). To make this playable
by anyone from a real URL, host it on a platform that terminates real,
browser-trusted TLS for you instead of generating one yourself:

1. Push this repo to GitHub (already done if you're reading this from there).
2. Create a [Render](https://render.com) account, then **New → Blueprint** and
   point it at this repo — it picks up `render.yaml` automatically (free web
   service, `npm install` / `npm start`, `NODE_ENV=production`). Any other
   Node-friendly host that proxies WebSockets works too (Railway, Fly.io);
   just make sure `NODE_ENV=production` is set so the server knows a proxy
   is handling TLS.
3. Once it's deployed, visit the `https://your-app.onrender.com/` URL it
   gives you — that's a real certificate, so there's no warning to click
   through, on the display or the phone.

Setting `NODE_ENV=production` (or deploying on Render specifically, which
sets `RENDER=true` automatically) switches the server to listen on plain
HTTP and skip self-signed cert generation entirely, since the hosting
platform's edge is what actually terminates TLS in that setup — see
`BEHIND_TLS_PROXY` in `server/index.js`. Locally (`npm start` with neither
of those set), it behaves exactly as described above: self-signed HTTPS,
LAN IPs, the works.

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
