# Evyatime Crisis Game(MVP)

A two-screen shooting game for 1-5 players. A computer displays the game (enemies
popping up from a shared playground background). Each player's phone acts as their
own gun: hold it up like a remote and pan/tilt it to aim, tap the screen to fire.
Aiming uses the phone's built-in motion sensors (`DeviceOrientationEvent`)
calibrated to a baseline pointing direction — there's no camera or visual markers
involved.

No app install — the display and every phone just open a web page in the browser.
They connect through a small local WebSocket relay server, all to the same 4-character
session code.

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
   the certificate warning, and go full-screen, then tap **Start Game** to
   reveal a 4-character session code and a QR code.
2. On each phone (up to 5), open `https://<computer-lan-ip>:3000/phone`, or scan
   the QR code (the QR always encodes an `https://` link), accept the certificate
   warning, and tap **Join** (the code is pre-filled if you scanned the QR). Each
   phone that joins gets its own player number and color (shown as a badge in the
   corner) — a 6th phone trying to join the same session gets turned away.
3. Tap **Enable Motion Access** (iOS will show a native permission prompt the
   first time).
4. Hold the phone pointed at the middle of the display, hold it steady, and tap
   **Calibrate**. This records the phone's current pan/tilt as "aim center" — it
   does not need to see anything on screen, it just needs to be pointed at it.
   Calibrating shows you as logged in on the display (with your own crosshair)
   and drops you into a ready-up lobby with a shootable **START** target — aim
   at it and fire. While the group's joining and calibrating, click
   **Easy/Normal/Hard** and the **Timer** on/off toggle in the lobby's
   top-right corner (mouse-clicked on the computer, not phone-driven) to set
   the session's difficulty — editable right up until the round actually
   starts. The round begins once every logged-in player has shot it
   (the display shows "X / Y READY"); anyone who joins and calibrates *after*
   the round is already running just jumps in with full lives instead.
5. Aim by physically panning/tilting the phone (moving it left/right pans the
   crosshair left/right; tilting the top of the phone up/down moves it up/down),
   and tap anywhere on the phone screen to fire. If the crosshair feels drifted
   or off-center, tap **Recalibrate** (top-right during play) without leaving the
   game. The gun holds 6 shots.
6. Tilt the phone down past aiming range to **take cover** — you're safe from
   enemy/boss fire-back while covered, but can't fire either (your crosshair
   disappears from the display too). Hold cover for 2 seconds and it also
   reloads to a full magazine. Raise the phone back up to expose yourself
   again and keep shooting.
7. Everyone shares the same enemies (whoever hits one first gets the kill), but
   lives and score are tracked per player. When an enemy (or the boss) fires
   back, it only picks from players who are currently exposed (not in
   cover) — if everyone's covered, the shot lands on nobody. Running out of
   lives puts you in spectator mode until the round ends — the rest of the
   group keeps playing. Defeat enough enemies as a group (more of you means
   more to clear) and everyone sees a **LEVEL CLEARED** scoreboard (highest
   score wins); if everyone runs out of lives, or the level timer runs out
   first (if it's on), it's a shared **GAME OVER**/**TIME'S UP** instead.
   Either way, a new round starts automatically after a few seconds.

Find your computer's LAN IP with `ipconfig getifaddr en0` (macOS), `hostname -I`
(Linux), or `ipconfig` (Windows) — or just read it from the server's startup log,
which prints every LAN address it's reachable on.

## Customizing the visuals and music

- **Background**: drop an image directly in `public/display/assets/` — any
  filename, any of `.png`/`.jpg`/`.jpeg`/`.webp`. See
  `public/display/assets/README.md` for details. Falls back to a plain dark
  background if nothing's there.
- **Enemy sprites**: drop PNG images (transparent background) into
  `public/display/assets/enemies/` — see `public/display/assets/enemies/README.md`
  for exact requirements. No restart needed beyond a page reload; the display
  asks the server what's in that folder on load, and picks a random one per
  spawn if there's more than one. Falls back to a built-in drawn face if the
  folder is empty. A sprite named exactly `cat` is reserved — it's not a
  spawnable enemy at all, it's the decoy's own image instead of the
  built-in drawn cat shape.
- **Menu music**: drop an `.mp3`/`.wav`/`.ogg` file into
  `public/display/assets/music/menu/` — see
  `public/display/assets/music/menu/README.md`. Loops while the pairing
  screen is showing; silent if nothing's there.
- **Level music**: drop `.mp3`/`.wav`/`.ogg` tracks into
  `public/display/assets/music/levels/` — see
  `public/display/assets/music/levels/README.md`. One track is picked at
  random (not a fixed per-level mapping) each time a regular level begins;
  silent if nothing's there.
- **Boss music**: drop a single `.mp3`/`.wav`/`.ogg` file into
  `public/display/assets/music/boss/` — see
  `public/display/assets/music/boss/README.md`. Overrides the normal
  per-level rotation for the entire final boss level (taunt cutscene
  through the fight through the ending sequence); falls back to the normal
  level track if nothing's there.
- **Lobby artwork**: drop an image into `public/display/assets/lobby/` — see
  `public/display/assets/lobby/README.md`. Backs both the pairing screen and
  the ready-up lobby, letterboxed (not cropped) so a poster-style image keeps
  its edges. Falls back to a plain dark background if nothing's there.
- **Intro cutscene artwork**: drop an image into
  `public/display/assets/cutscenes/intro/` — see
  `public/display/assets/cutscenes/intro/README.md`. Shown once, letterboxed,
  behind the streaming villain-monologue line the first time a game actually
  starts. The dialogue text itself is `INTRO_TEXT` in `display.js`, not a
  dropped-in asset. Falls back to text-only on a plain dark background if
  nothing's there.
- **Boss ending cutscene sequence artwork**: drop images into
  `public/display/assets/cutscenes/outro/` — see
  `public/display/assets/cutscenes/outro/README.md`. Plays every image
  found, sorted-filename order, back to back once the final boss is
  defeated (him defeated, the celebration, and anything else you add), each
  paired by position with a line from the `BOSS_OUTRO_TEXTS` array in
  `display.js`. Any line without a matching image still plays as
  text-only.
- **Boss sprite**: drop a transparent-background PNG into
  `public/display/assets/boss/` — see `public/display/assets/boss/README.md`.
  Used for the final boss's in-fight appearance (separate from the cutscene
  art, which is a full backdrop scene, not a fit-to-radius character sprite).
  Falls back to the intro cutscene's artwork, then a built-in drawn face, if
  nothing's there.

All nine are auto-detected by the server (`GET /api/background-image`,
`GET /api/enemy-sprites`, `GET /api/menu-music`, `GET /api/level-music`,
`GET /api/boss-music`, `GET /api/lobby-image`, `GET /api/intro-image`,
`GET /api/outro-images`, `GET /api/boss-sprite`) — you never need to edit
code or update a filename in `display.js` to swap art or music.

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
      /music
        /menu         # optional pairing-screen theme (see music/menu/README.md)
        /levels       # optional per-level gameplay music (see music/levels/README.md)
        /boss         # optional boss-level music override (see music/boss/README.md)
      /lobby          # optional pairing/ready-up lobby artwork (see lobby/README.md)
      /cutscenes
        /intro        # optional opening villain-monologue artwork (see cutscenes/intro/README.md)
        /outro        # optional boss-ending cutscene sequence artwork (see cutscenes/outro/README.md)
      /boss           # optional final boss in-fight sprite (see boss/README.md)
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
  or `/?role=phone&session=CODE`. Each room holds at most one display and up to
  `MAX_PLAYERS` (5) phones, each assigned a stable `playerId` on connect (a 6th
  phone is turned away with a `session_error`). The server tags every phone→display
  message with the sender's `playerId`, and honors an optional `targetPlayerId` on
  display→phone messages (routed to just that one phone; broadcast to all phones
  if absent) — beyond that routing it holds no game state. Every connection
  attempt and its outcome is logged to the terminal, which is the fastest way to
  debug a pairing that won't complete.
- **Display client**: owns all game state — a `playerId -> {color, lives, score,
  out, loggedIn, readyForStart}` map, plus the shared enemy and round progress.
  Renders a fixed 1280×720 logical canvas with whatever image the server finds
  via `GET /api/background-image` as a cover-fit background (falls back to a
  plain dark background if none is found). Once the first phone pairs, the
  display shows a ready-up lobby (backed by `GET /api/lobby-image`, letterboxed
  so a poster-style image doesn't get cropped) with each connected player's
  live crosshair and roster status (calibrating / logged in / ready), plus a
  shootable **START** target. A `calibrated` message marks that player logged
  in but does *not* start the round by itself — a `fire` landing on the START
  target marks that player ready, and the round only actually begins
  (`maybeStartRound`) once every currently logged-in, still-connected player
  has readied up (so the denominator shrinks live if someone disconnects
  mid-lobby instead of forcing the rest to wait on them forever). A round
  already in progress can still be joined by more phones at any time — they
  just jump in with full lives, skipping the ready-up gate entirely. The very
  first time the gate is satisfied, a one-time villain-monologue cutscene
  plays first (backed by `GET /api/intro-image`, streamed line set by
  `INTRO_TEXT` in `display.js`) — tap to fast-forward the line, tap again
  to continue. Cutscenes never auto-advance on their own (see
  `playCutscene` in `display.js`) — they wait indefinitely for a player to
  fire, however long that takes — and only then does the round actually
  begin. After the round starts, an enemy spawns on a fixed
  cadence (`SPAWN_INTERVAL_MS`, 5s) at one of a handful of fixed spots
  positioned over playground features in that background (tunnel opening,
  climbing panel, dome roof, swing seat, benches — see
  `BACKGROUND_HIDE_SPOTS` in `display.js`, one tuned entry per background
  image, keyed by filename), rendered either as a sprite from
  `GET /api/enemy-sprites` (picked per spawn, if any are present — see
  `pickEnemySprite`) or a built-in drawn face. Difficulty scales with level
  number, each mechanic unlocking on its own level and then intensifying
  further: level 1 only ever spawns the normal (`arsnormal`) enemy type,
  regardless of difficulty — the buffed `arsketer` type only starts
  appearing from level 2 (`arsketerChanceForLevel`); from level 2, enemies
  also drift in a small bounded loop around their hide spot instead of
  standing still; from level 4, some spawns are a decoy (an obviously-a-cat
  sprite, never a reskinnable enemy) instead of a real enemy — shooting one
  costs the shooter a life and doesn't count toward the level, so ignoring
  it is always the safe read; from level 5, some enemies carry a shield
  that cycles guarded (shots blocked, spark effect, no damage) and exposed
  (vulnerable) on a fixed rhythm that shortens at higher levels — see
  `driftAmplitudeForLevel`, `decoyChanceForLevel`, and
  `shieldChanceForLevel` in `display.js` for the exact curves. Toughness is
  keyed by enemy *type* rather than level: dropping sprites named
  `arsnormal`/`arsketer` into `public/display/assets/enemies/` (same
  per-filename convention as background hide-spot tuning) makes `arsketer`
  a "buffed" 3-hit enemy vs. `arsnormal`'s normal 1-hit (any other/no
  sprite name also defaults to 1-hit) — `hitsToKillForEnemyName` and
  `arsketerChanceForLevel` in `display.js`, the latter also bumped up by
  the chosen difficulty. Up to `MAX_CONCURRENT_ENEMIES` (3) enemies/decoys
  can be up at once, shared by the whole group, each at its own hide spot
  (`spawnEnemy` avoids spawning two at the same spot — see
  `occupiedSpotIndices`) — a new one attempts to appear every
  `SPAWN_INTERVAL_MS` (5s), skipping that tick if the cap's already full or
  every spot's occupied. A `fire` message landing within a given enemy's
  hit radius while it's visible and exposed resolves the hit against
  *that* one specifically (`findHitTarget` picks the closest match if more
  than one is in range), credited to whichever player's shot that was,
  showing a bright impact burst plus the sprite's `-hit` pose (or a white
  tint if there isn't one) held for `HIT_HOLD_MS` (450ms) before it ducks
  down, so a kill actually reads clearly instead of flashing for a single
  frame. Every enemy's own radius is clamped up to `MIN_ENEMY_RADIUS` (56 —
  measured against reference objects like car rooflines and door frames in
  the actual background photos, at 80% of the size a human standing at that
  hide spot's depth would come out to) regardless of how far/small its
  depth-scale would otherwise make it, so a far-spawn enemy never shrinks
  down to something impractically hard to actually hit. Enemies don't
  disappear once they've fired: instead of a
  single one-shot fire-and-duck, each un-killed enemy fires back on a
  repeating cooldown (faster for close/large spawns, slower for far/small
  ones) at a random *vulnerable* player (see the cover mechanic below) —
  they lose a life (with a muzzle-flash + sound effect at the enemy and a
  red screen flash) — and stays fully in play, still shootable, until it's
  actually killed. An unshot decoy is the one exception: it still just
  ducks away harmlessly and leaves for good once its own timer expires,
  since it was never a real threat. A player who runs out of lives
  (`STARTING_LIVES`, 3 each) is told they're `you_are_out` and spectates
  while everyone else continues. Every registered shot — hit, miss, or
  blocked by a shield — plays a synthesized sound effect on the display
  itself (`playSfx`, Web Audio, no audio file needed), distinct for a
  player's own shot vs. an enemy/boss firing back, so the shared
  screen's speakers give audible feedback for both regardless of whose
  phone fired.

  How many enemies clear a level (`ENEMIES_TO_CLEAR`, decoys don't count)
  isn't fixed — it's a benchmark recomputed at the start of every level
  (`enemiesToClearForLevel` in `display.js`): a gently-increasing per-level
  baseline (level 1: 3, 2: 4, 3: 6, 4: 7), scaled by the chosen difficulty
  (×0.75 easy, ×1 normal, ×1.4 hard), plus +2 for every player beyond the
  first (`ENEMIES_PER_EXTRA_PLAYER`) so a bigger group gets proportionally
  more to do. If the timer's on (see below), the level's time limit is
  itself derived from that same enemy count (`levelTimeLimitMs`) rather
  than a flat per-level number, so a level padded out by more players or a
  harder difficulty gets proportionally more time instead of the same fixed
  clock. If every known player runs out of lives, or the timer runs out
  first, it's a shared loss instead. Either way, all phones get a `round_ended`
  broadcast, the display shows a scoreboard (ranked by score, with a winner
  crowned only on a clear), and a fresh round auto-starts a few seconds later
  (`round_started`, broadcast to every phone so anyone spectating resumes without
  recalibrating). Also renders a live, player-colored crosshair per phone from
  `aim` messages. Pressing **Esc** at any time during play pauses the game
  (freezing every timer so nothing resolves the instant you resume) and shows
  **Restart** (resets everyone's score/lives, keeps calibration) and **Quit to
  Lobby** (disconnects every phone back to its join screen and returns the
  display to the pairing screen). Typing **"win"** anywhere on the display
  page (no click needed first) is a dev/test cheat (`cheatWinLevel`) that
  instantly clears whatever level is in progress — or, during the boss
  fight, finishes him off through the real kill/defeat presentation instead
  of skipping straight to the ending.

  Level `BOSS_LEVEL` (7 — one regular level per non-boss background image,
  6 total, then the boss) opens with its own taunt cutscene the instant the
  previous level's clear screen times out — before the fight itself starts,
  `bossActive` is already set and boss music (`GET /api/boss-music`,
  overriding the normal per-level track for the whole level) takes over,
  using the boss's own sprite (or the intro cutscene's art, or a built-in
  face, whichever's actually available) with a taunt line
  (`BOSS_INTRO_TEXT`). Only then does the fight begin: instead of the usual
  enemy popping up, firing once, and ducking away, the boss replaces the
  spawn cadence with a single persistent target
  (`spawnBoss`/`updateBossFight` in `display.js`) — rendered from
  `GET /api/boss-sprite` — with a visible health bar replacing the usual
  level/enemies-defeated HUD text, always shielded, drifting and
  periodically firing back on a cadence that speeds up as 3 HP-based phases
  tick down (each announced with a brief "PHASE N" card) —
  `hitsToKill`/`hitsTaken` double as its HP/max-HP, the same fields a
  multi-hit regular enemy already uses. Defeating it skips the normal
  level-clear flow entirely: no scoreboard, no auto-advance to a next
  level. Instead it plays the full ending sequence
  (`playCutsceneSequence`) — however many images are actually sitting in
  `GET /api/outro-images` (him defeated, the group's celebration, and
  whatever else, e.g. a sequel hook, is dropped in there), each paired by
  position with a line from the `BOSS_OUTRO_TEXTS` array — and once that
  finishes, disconnects everyone back to the pairing screen — same as
  **Quit to Lobby** — rather than looping into a level 6. Losing to the
  boss (the whole group runs out of lives) is just a normal shared
  `game_over`, which resets back to level 1 like any other loss.
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
  camera flash as a physical "muzzle flash," a short vibration, a brief
  white flash across the phone's own screen, and a short synthesized "shot"
  sound (a square-wave oscillator with a fast downward pitch sweep via the
  Web Audio API — no audio file needed). The flash/vibration require the
  browser to expose torch control on a camera track / the Vibration API —
  Android Chrome/Edge generally do; **iOS Safari never has** (an
  Apple/WebKit platform restriction, not a bug here), so on iPhone those two
  just don't happen, silently, with no extra permission prompt for features
  that could never work there anyway (the screen flash and sound work
  everywhere, including iOS). The gun holds 6 shots (`AMMO_MAX`); once
  empty, taps do nothing but flash a "reload" hint. While a player's ammo is
  empty, the display shows a "Player N - Out of Ammo" banner in that
  player's color (stacked one per line if more than one player is empty at
  once), driven by an `ammo_status` message each phone sends on every
  empty/reload transition — each phone only knows its own ammo, so the
  display has to be told.

  Tilting the phone down past aiming range means **cover**, not just
  reload: taps are blocked while covered (mirroring a physical cover pedal
  — duck to be safe, pop up to shoot), and the phone tells the display via
  a `cover_status` message on every enter/leave transition, which the
  display uses to hide that player's crosshair and gate them out of
  enemy/boss fire-back entirely (`vulnerablePlayerIds` in `display.js`
  filters to `!out && !inCover` before a hit is randomly assigned — if
  everyone's covered, the shot lands on nobody). Getting a phone held
  exactly straight down is hard in practice, so the tilt check uses two
  thresholds rather than one, same as before: `COVER_TILT_TRIGGER_DEG` (30°
  below baseline) enters cover, but once there only rising back above the
  looser `COVER_TILT_CANCEL_DEG` (15°) leaves it — ordinary hand wobble
  doesn't flicker you in and out. Holding cover for `RELOAD_HOLD_MS` (1s)
  on top of that also reloads to a full 6 (a longer rolling vibration plus
  a rising two-note chime, `playReloadSound`, mark completion) — one
  physical motion doubles as both "duck to be safe" and "duck to reload"
  rather than needing separate gestures. The phone's own screen flashes a
  distinct color per state: white while firing (`#fireFlash`), a pulsing
  green for as long as you're in cover (`#coverFlash`), and a pulsing red
  whenever the display tells you you've just been hit (`player_hit`
  message, sent to that one phone whenever a fire-back costs them a life
  without eliminating them — a fully-eliminating hit goes straight to the
  `you_are_out` screen instead). The final boss
  hits 2 random vulnerable players per attack instead of 1 (`pickRandomVictims`
  in `display.js`), since he's meant to punish a group that's spread out
  and exposed.

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

- No moving-target-avoidance or persistence (scores don't survive a server
  restart) — this is an MVP proving the aiming interaction, not a shippable game.
- Up to 5 players share one session code; there's no lobby list showing who's
  joined before the round starts, and a player who leaves mid-round is treated
  as eliminated rather than able to silently rejoin the same slot.
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
