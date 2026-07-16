# Phone Light Gun Game (MVP)

A two-screen, single-player shooting game. A computer displays the game (one static
target on screen at a time, Duck Hunt style). A phone acts as the gun: hold it up,
aim at the computer screen using the phone's rear camera, and tap to fire. The phone
tracks four colored markers at the corners of the display and computes where the
center of its camera view intersects that plane.

No app install — both the display and the phone open a web page in the browser.
They connect through a small local WebSocket relay server.

## Requirements

- Node.js 18+
- A computer and a phone on the **same local network**
- A modern mobile browser with rear camera access

## Setup

```bash
npm install
npm start
```

The server listens on port 3000 by default (override with `PORT=xxxx npm start`),
and serves everything over **HTTPS with a self-signed certificate** — generated
fresh each time the server starts, valid for `localhost`, `127.0.0.1`, and every
LAN IP address detected on the machine. This is required because mobile browsers
(iOS Safari/WebKit in particular) block camera access (`getUserMedia`) on any page
loaded over plain `http://`, even on a local network.

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
3. Grant camera access when prompted. Point the rear camera at the computer screen
   until the "Detecting markers" overlay shows 4/4 and the **Start** button enables.
4. Tap **Start**, then aim by physically moving the phone (the crosshair overlay
   marks the phone's fixed aim point) and tap anywhere on the phone screen to fire.

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
    phone.js          # camera access, marker detection, homography, input handling
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
  count. Renders a fixed 1280×720 logical canvas with four colored corner markers
  (red/green/blue/yellow, top-left/top-right/bottom-left/bottom-right) that never
  move. On pairing it sends the phone a `marker_layout` message (exact pixel
  position of each marker) and a `session_ready` message. It resolves hits/misses
  when it receives `fire` messages and renders a live crosshair from `aim` messages.
- **Phone client**: captures the rear camera, downsamples frames to 160×90, and
  scans for the four marker colors by HSV thresholding to find each one's centroid.
  With all four camera-space points and their known display-space positions (from
  `marker_layout`), it solves the 3×3 planar homography via the standard 4-point
  DLT (an 8×8 linear system solved with Gaussian elimination — no CV library
  needed). Applying that homography to the camera's fixed center point yields the
  aim point on the display, sent as `aim` messages at ~20/sec. Taps send `fire`
  with the last computed aim point. If fewer than four markers are detected in a
  frame, tracking is marked lost: no new `aim` is sent and firing is disabled until
  all four markers are reacquired.

## Known limitations (by design, see PRD)

- Tuned for a fixed, controlled distance/lighting — no auto-exposure compensation.
- No moving targets, multiplayer, or persistence — this is an MVP proving the
  aiming interaction, not a shippable game.
- The self-signed certificate means every device must click through a browser
  security warning once per server restart (the cert is regenerated fresh each
  time `npm start` runs). If you'd rather not see that warning at all, generate a
  locally-trusted certificate with [mkcert](https://github.com/FiloSottile/mkcert)
  and pass its key/cert paths in instead — not needed for normal use.
