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
- A modern mobile browser with rear camera access (served over `http://` on a LAN
  is fine for `getUserMedia` on most Android browsers; iOS Safari requires HTTPS or
  `localhost` — see Troubleshooting below)

## Setup

```bash
npm install
npm start
```

The server listens on port 3000 by default (override with `PORT=xxxx npm start`).

## Playing

1. On the computer, open `http://<computer-lan-ip>:3000/` in a browser and go
   full-screen. It shows a 4-character session code and a QR code.
2. On the phone, open `http://<computer-lan-ip>:3000/phone`, or scan the QR code,
   and tap **Join** (the code is pre-filled if you scanned the QR).
3. Grant camera access when prompted. Point the rear camera at the computer screen
   until the "Detecting markers" overlay shows 4/4 and the **Start** button enables.
4. Tap **Start**, then aim by physically moving the phone (the crosshair overlay
   marks the phone's fixed aim point) and tap anywhere on the phone screen to fire.

Find your computer's LAN IP with `ipconfig getifaddr en0` (macOS), `hostname -I`
(Linux), or `ipconfig` (Windows).

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
  server. Clients connect to `/?role=display&session=CODE` or
  `/?role=phone&session=CODE`. The server pairs at most one display and one phone
  per session code and relays JSON messages between them — it holds no game state.
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
- iOS Safari requires a secure context (HTTPS or `localhost`) for camera access;
  on a plain `http://` LAN address it may block `getUserMedia`. For a quick local
  test on iOS, tunnel the port through an HTTPS-terminating proxy, or test on
  Android where plain-HTTP LAN camera access is generally allowed.
