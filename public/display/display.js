(function () {
  'use strict';

  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
  var TARGET_RADIUS = 72;
  var HIT_FORGIVENESS = 15;
  var HIT_HOLD_MS = 450; // how long a killed enemy stays fully visible (showing the hit sprite/flash) before it shrinks away
  var MISS_FLASH_MS = 300;

  // Fixed spots (as fractions of the canvas) where enemies pop up from —
  // picked to line up with playground features in the background image
  // (tunnel slide opening, climbing panel, dome roof, swing seat, benches).
  // Checked against the actual background once it was added; still eyeballed
  // rather than pixel-measured, so further nudges are expected.
  var HIDE_SPOTS = [
    { x: 0.10, y: 0.72 }, // tunnel slide opening
    { x: 0.30, y: 0.36 }, // purple climbing panel window
    { x: 0.61, y: 0.20 }, // orange dome roof
    { x: 0.85, y: 0.40 }, // swing seat
    { x: 0.11, y: 0.80 }, // left bench
    { x: 0.83, y: 0.80 }  // right bench
  ];
  var POP_UP_MS = 180;
  var POP_DOWN_MS = 150;
  var SPAWN_INTERVAL_MS = 5000; // a new enemy appears on this fixed cadence
  var ENEMY_LIFETIME_MS = 3000; // an enemy has this long to be shot before it fires back
  var STARTING_LIVES = 3;
  var DAMAGE_FLASH_MS = 400;
  var ENEMY_MUZZLE_FLASH_MS = 350;
  var ROUND_END_DISPLAY_MS = 4500;
  var ENEMIES_TO_CLEAR = 15; // defeat this many as a group to clear the level

  var pairingEl = document.getElementById('pairing');
  var stageEl = document.getElementById('stage');
  var sessionCodeEl = document.getElementById('sessionCode');
  var pairingUrlEl = document.getElementById('pairingUrl');
  var qrImgEl = document.getElementById('qrImg');
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var pauseOverlayEl = document.getElementById('pauseOverlay');
  var pauseRestartBtn = document.getElementById('pauseRestartBtn');
  var pauseQuitBtn = document.getElementById('pauseQuitBtn');

  var W = PROTOCOL.LOGICAL_WIDTH;
  var H = PROTOCOL.LOGICAL_HEIGHT;

  var sessionCode = generateSessionCode();
  var ws = null;

  // players: playerId -> { color, lives, score, shots, out }. Populated as
  // phones join (player_joined) and never removed (even on player_left /
  // elimination) so a final scoreboard can still show everyone who played.
  var players = new Map();
  var crosshairs = new Map(); // playerId -> { x, y, visible }
  var enemiesDefeated = 0;
  var target = null;
  var lastSpotIndex = -1;
  var nextSpawnAt = 0;
  var missFlashes = [];
  var muzzleFlashes = []; // enemy fired-back effects, at the enemy's position
  var hitBurstFlashes = []; // bright burst at the impact point on a successful hit
  var HIT_BURST_MS = 300;
  var hitFlashUntil = 0;
  var damageFlashUntil = 0;
  var roundResult = null; // null while playing, else 'cleared' | 'game_over'
  var roundResultAt = 0;
  var paired = false;
  var roundStarted = false; // at least one phone has finished its first calibration -- enemies only start spawning after this

  // Pausing (Esc) needs to freeze every timestamp-driven timer (spawn cadence,
  // enemy fire-back deadline, flash effects) without them jumping forward the
  // instant play resumes. Rather than manually shifting every stored deadline,
  // all game logic reads time through this virtual clock instead of raw
  // performance.now() directly — it simply stops advancing while paused.
  var paused = false;
  var pauseStartedAt = 0;
  var totalPausedMs = 0;

  function gameNow() {
    if (paused) return pauseStartedAt - totalPausedMs;
    return performance.now() - totalPausedMs;
  }

  // Background image — whatever's sitting in public/display/assets/ (any
  // name, doesn't have to be exactly "playground.jpg"). Falls back to a
  // plain dark background if nothing's there.
  var bgImage = new Image();
  var bgReady = false;
  bgImage.onload = function () { bgReady = true; };
  bgImage.onerror = function () { console.error('[background] image failed to load:', bgImage.src); };
  fetch('/api/background-image')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      console.log('[background] /api/background-image ->', data);
      if (data.url) bgImage.src = data.url;
    })
    .catch(function (err) { console.error('[background] fetch failed:', err); });

  // Optional enemy sprite images — if the server finds any in
  // public/display/assets/enemies/, use those instead of the built-in
  // drawn face, picking a random pair for each spawn. Each entry is
  // { img, hitImg }: hitImg is the "<name>-hit.<ext>" companion file if one
  // was found (shown during the hit flash instead of the white-tint
  // effect), or null if there isn't one for that sprite. Falls back cleanly
  // (drawTarget uses the drawn face) if the list is empty or fails to load.
  var enemySprites = [];
  fetch('/api/enemy-sprites')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      console.log('[sprites] /api/enemy-sprites ->', data);
      (data.sprites || []).forEach(function (entry) {
        var img = new Image();
        var hitImg = null;
        if (entry.hit) {
          hitImg = new Image();
          hitImg.onerror = function () { console.error('[sprites] hit image failed to load:', entry.hit); };
          hitImg.src = entry.hit;
        }
        img.onload = function () {
          enemySprites.push({ img: img, hitImg: hitImg });
          console.log('[sprites] loaded, pool size now', enemySprites.length, '-', entry.base);
        };
        img.onerror = function () { console.error('[sprites] base image failed to load:', entry.base); };
        img.src = entry.base;
      });
    })
    .catch(function (err) { console.error('[sprites] fetch failed:', err); });

  function generateSessionCode() {
    var code = '';
    for (var i = 0; i < 4; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return code;
  }

  // Deterministic from playerId alone -- the server assigns playerIds but
  // never needs to know about colors, since both clients derive the same
  // color from the same id independently.
  function playerColor(playerId) {
    return PROTOCOL.PLAYER_COLORS[(playerId - 1) % PROTOCOL.PLAYER_COLORS.length];
  }

  function sendToPhone(playerId, msg) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    var out = {};
    for (var k in msg) out[k] = msg[k];
    out.targetPlayerId = playerId;
    ws.send(JSON.stringify(out));
  }

  function broadcastToPhones(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function resizeCanvasToWindow() {
    var scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = (W * scale) + 'px';
    canvas.style.height = (H * scale) + 'px';
  }

  function showPairing() {
    paired = false;
    roundStarted = false;
    players.clear();
    crosshairs.clear();
    pairingEl.classList.remove('hidden');
    stageEl.classList.add('hidden');
  }

  function showGame() {
    paired = true;
    pairingEl.classList.add('hidden');
    stageEl.classList.remove('hidden');
  }

  function startNewGame(now) {
    roundResult = null;
    target = null;
    lastSpotIndex = -1;
    nextSpawnAt = now + 1000;
    enemiesDefeated = 0;
    players.forEach(function (p) {
      p.lives = STARTING_LIVES;
      p.score = 0;
      p.shots = 0;
      p.out = false;
    });
  }

  function pauseGame() {
    if (!paired || !roundStarted || roundResult || paused) return;
    paused = true;
    pauseStartedAt = performance.now();
    pauseOverlayEl.classList.remove('hidden');
  }

  function resumeGame() {
    if (!paused) return;
    totalPausedMs += performance.now() - pauseStartedAt;
    paused = false;
    pauseOverlayEl.classList.add('hidden');
  }

  function restartGame() {
    pauseOverlayEl.classList.add('hidden');
    paused = false;
    startNewGame(gameNow());
    broadcastToPhones({ type: PROTOCOL.MSG_ROUND_STARTED });
  }

  function quitToLobby() {
    pauseOverlayEl.classList.add('hidden');
    paused = false;
    // The existing 'close' handler already shows the pairing screen and
    // reconnects (same session code) after a short delay — the same path
    // used for any real disconnect — which also relays a peer_disconnected
    // to every phone, sending them back to their own join screen.
    if (ws) { try { ws.close(); } catch (e) {} }
  }

  function spawnEnemy(now) {
    var idx;
    do {
      idx = Math.floor(Math.random() * HIDE_SPOTS.length);
    } while (idx === lastSpotIndex && HIDE_SPOTS.length > 1);
    lastSpotIndex = idx;
    var spot = HIDE_SPOTS[idx];
    target = {
      x: spot.x * W,
      y: spot.y * H,
      r: TARGET_RADIUS,
      state: 'popping-up',
      stateStartedAt: now,
      firesAt: now + ENEMY_LIFETIME_MS,
      resolved: false,
      sprite: enemySprites.length ? enemySprites[Math.floor(Math.random() * enemySprites.length)] : null
    };
  }

  function targetScale(now) {
    if (!target) return 0;
    if (target.state === 'popping-up') return Math.min(1, (now - target.stateStartedAt) / POP_UP_MS);
    if (target.state === 'popping-down') return Math.max(0, 1 - (now - target.stateStartedAt) / POP_DOWN_MS);
    return 1; // includes the 'hit' hold state — stays full size so the hit sprite reads clearly
  }

  // True once every currently-known player has 0 lives -- the group is out.
  function allPlayersOut() {
    if (players.size === 0) return false;
    var out = true;
    players.forEach(function (p) { if (!p.out) out = false; });
    return out;
  }

  function checkRoundEnd(now) {
    if (roundResult) return;
    if (allPlayersOut()) {
      roundResult = 'game_over';
      roundResultAt = now;
      broadcastToPhones({ type: PROTOCOL.MSG_ROUND_ENDED, result: 'game_over' });
    }
  }

  function updateGame(now) {
    if (!roundStarted) return;

    if (roundResult) {
      if (now - roundResultAt >= ROUND_END_DISPLAY_MS) {
        startNewGame(now);
        broadcastToPhones({ type: PROTOCOL.MSG_ROUND_STARTED });
      }
      return;
    }

    // A new enemy appears on a fixed cadence, independent of whatever
    // happened to the previous one — with a 5s interval and a 3s enemy
    // lifetime there's always a clear gap between one resolving and the
    // next appearing, so only one is ever on screen at a time.
    if (now >= nextSpawnAt) {
      nextSpawnAt = now + SPAWN_INTERVAL_MS;
      if (!target) spawnEnemy(now);
    }

    if (!target) return;

    if (target.state === 'popping-up' && now - target.stateStartedAt >= POP_UP_MS) {
      target.state = 'visible';
    } else if (target.state === 'visible' && !target.resolved && now >= target.firesAt) {
      // Not shot in time -- the enemy fires back. With one shared enemy and
      // several players, there's no notion of "who it was aiming at", so it
      // just hits a random player who's still in the round.
      target.resolved = true;
      target.state = 'popping-down';
      target.stateStartedAt = now;
      muzzleFlashes.push({ x: target.x, y: target.y, expire: now + ENEMY_MUZZLE_FLASH_MS });
      damageFlashUntil = now + DAMAGE_FLASH_MS;

      var alive = [];
      players.forEach(function (p, pid) { if (!p.out) alive.push(pid); });
      if (alive.length) {
        var victimId = alive[Math.floor(Math.random() * alive.length)];
        var victim = players.get(victimId);
        victim.lives--;
        if (victim.lives <= 0) {
          victim.out = true;
          sendToPhone(victimId, { type: PROTOCOL.MSG_YOU_ARE_OUT });
        }
      }
      checkRoundEnd(now);
    } else if (target.state === 'hit' && now - target.stateStartedAt >= HIT_HOLD_MS) {
      target.state = 'popping-down';
      target.stateStartedAt = now;
    } else if (target.state === 'popping-down' && now - target.stateStartedAt >= POP_DOWN_MS) {
      target = null;
    }
  }

  function handleFire(msg) {
    if (!roundStarted || roundResult || paused) return;
    var shooter = players.get(msg.playerId);
    if (!shooter || shooter.out) return;
    shooter.shots++;
    var px = msg.x * W;
    var py = msg.y * H;
    var now = gameNow();
    if (target && target.state === 'visible' && !target.resolved) {
      var dx = px - target.x;
      var dy = py - target.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= target.r + HIT_FORGIVENESS) {
        shooter.score++;
        target.resolved = true;
        hitFlashUntil = now + HIT_HOLD_MS;
        target.state = 'hit';
        target.stateStartedAt = now;
        hitBurstFlashes.push({ x: target.x, y: target.y, expire: now + HIT_BURST_MS });
        enemiesDefeated++;
        if (enemiesDefeated >= ENEMIES_TO_CLEAR) {
          roundResult = 'cleared';
          roundResultAt = now;
          broadcastToPhones({ type: PROTOCOL.MSG_ROUND_ENDED, result: 'cleared' });
        }
        return;
      }
    }
    missFlashes.push({ x: px, y: py, expire: now + MISS_FLASH_MS });
  }

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/?role=display&session=' + sessionCode);

    ws.addEventListener('message', function (evt) {
      var msg;
      try { msg = JSON.parse(evt.data); } catch (e) { return; }

      if (msg.type === PROTOCOL.MSG_PLAYER_JOINED) {
        var joinedId = msg.playerId;
        if (!players.has(joinedId)) {
          players.set(joinedId, { color: playerColor(joinedId), lives: STARTING_LIVES, score: 0, shots: 0, out: false });
        }
        crosshairs.set(joinedId, { x: W / 2, y: H / 2, visible: false });
        showGame();
        sendToPhone(joinedId, { type: PROTOCOL.MSG_SESSION_READY });
      } else if (msg.type === PROTOCOL.MSG_PLAYER_LEFT) {
        var leftId = msg.playerId;
        crosshairs.delete(leftId);
        var leftPlayer = players.get(leftId);
        if (leftPlayer) leftPlayer.out = true;
        checkRoundEnd(gameNow());
      } else if (msg.type === PROTOCOL.MSG_CALIBRATED) {
        var calibratedId = msg.playerId;
        var calibratedPlayer = players.get(calibratedId);
        if (calibratedPlayer) {
          calibratedPlayer.lives = STARTING_LIVES;
          calibratedPlayer.score = 0;
          calibratedPlayer.shots = 0;
          calibratedPlayer.out = false;
        }
        if (!roundStarted) {
          roundStarted = true;
          startNewGame(gameNow());
        }
      } else if (msg.type === PROTOCOL.MSG_AIM) {
        var aiming = crosshairs.get(msg.playerId);
        if (aiming) {
          aiming.x = msg.x * W;
          aiming.y = msg.y * H;
          aiming.visible = true;
        }
      } else if (msg.type === PROTOCOL.MSG_FIRE) {
        handleFire(msg);
      }
    });

    ws.addEventListener('close', function () {
      showPairing();
      setTimeout(connect, 1500);
    });
  }

  // Offscreen scratch canvas used to build the white-flash version of a
  // sprite in isolation, so `source-atop` only sees the sprite's own alpha
  // shape — compositing directly on the main canvas would instead see
  // whatever else (the background image, etc.) is already painted there.
  var spriteFlashCanvas = document.createElement('canvas');
  var spriteFlashCtx = spriteFlashCanvas.getContext('2d');

  function drawSpriteEnemy(spriteEntry, r, flashing) {
    var size = r * 2.6; // roughly matches the built-in face's visual extent

    if (flashing && spriteEntry.hitImg && spriteEntry.hitImg.naturalWidth > 0) {
      // A dedicated hit-reaction pose was provided — just show it, no tint needed.
      ctx.drawImage(spriteEntry.hitImg, -size / 2, -size / 2, size, size);
      return;
    }

    if (flashing) {
      spriteFlashCanvas.width = size;
      spriteFlashCanvas.height = size;
      spriteFlashCtx.drawImage(spriteEntry.img, 0, 0, size, size);
      spriteFlashCtx.globalCompositeOperation = 'source-atop';
      spriteFlashCtx.fillStyle = '#ffffff';
      spriteFlashCtx.fillRect(0, 0, size, size);
      spriteFlashCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(spriteFlashCanvas, -size / 2, -size / 2, size, size);
    } else {
      ctx.drawImage(spriteEntry.img, -size / 2, -size / 2, size, size);
    }
  }

  function drawBuiltInFace(r, flashing) {
    var skin = flashing ? '#ffffff' : '#d9a066';
    var skinShade = flashing ? '#eeeeee' : '#b9824f';
    var hair = flashing ? '#ffffff' : '#4a3728';
    var hairShade = flashing ? '#eeeeee' : '#332319';

    // faceted low-poly head silhouette: skin (lower/front) + hair (upper/back)
    ctx.beginPath();
    ctx.moveTo(-r * 0.75, r * 0.05);
    ctx.lineTo(-r * 0.55, r * 0.55);
    ctx.lineTo(-r * 0.05, r * 0.78);
    ctx.lineTo(r * 0.35, r * 0.62);
    ctx.lineTo(r * 0.55, r * 0.15);
    ctx.lineTo(r * 0.42, -r * 0.25);
    ctx.lineTo(r * 0.05, -r * 0.55);
    ctx.lineTo(-r * 0.4, -r * 0.5);
    ctx.lineTo(-r * 0.72, -r * 0.2);
    ctx.closePath();
    ctx.fillStyle = skin;
    ctx.fill();

    // hair cap (upper-back facet)
    ctx.beginPath();
    ctx.moveTo(-r * 0.72, -r * 0.2);
    ctx.lineTo(-r * 0.4, -r * 0.5);
    ctx.lineTo(r * 0.05, -r * 0.55);
    ctx.lineTo(r * 0.42, -r * 0.25);
    ctx.lineTo(r * 0.15, -r * 0.85);
    ctx.lineTo(-r * 0.45, -r * 0.8);
    ctx.closePath();
    ctx.fillStyle = hair;
    ctx.fill();

    // a couple of shading facets for a faceted/low-poly feel
    ctx.beginPath();
    ctx.moveTo(-r * 0.75, r * 0.05);
    ctx.lineTo(-r * 0.4, -r * 0.5);
    ctx.lineTo(-r * 0.55, r * 0.55);
    ctx.closePath();
    ctx.fillStyle = skinShade;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-r * 0.72, -r * 0.2);
    ctx.lineTo(-r * 0.4, -r * 0.5);
    ctx.lineTo(-r * 0.45, -r * 0.8);
    ctx.closePath();
    ctx.fillStyle = hairShade;
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = flashing ? '#ffffff' : 'rgba(0,0,0,0.25)';
    ctx.stroke();

    // ear
    ctx.beginPath();
    ctx.ellipse(-r * 0.62, r * 0.12, r * 0.12, r * 0.18, 0, 0, Math.PI * 2);
    ctx.fillStyle = skin;
    ctx.fill();

    // eye
    ctx.beginPath();
    ctx.arc(r * 0.12, -r * 0.05, r * 0.06, 0, Math.PI * 2);
    ctx.fillStyle = flashing ? '#888' : '#2a2015';
    ctx.fill();

    // mouth
    ctx.beginPath();
    ctx.moveTo(r * 0.05, r * 0.38);
    ctx.lineTo(r * 0.3, r * 0.32);
    ctx.lineWidth = 2;
    ctx.strokeStyle = flashing ? '#ccc' : '#7a4a3a';
    ctx.stroke();
  }

  function drawTarget(now) {
    if (!target) return;
    var scale = targetScale(now);
    if (scale <= 0) return;
    var flashing = now < hitFlashUntil;
    var r = target.r;
    var dir = target.x < W / 2 ? 1 : -1; // face toward the center of the screen

    ctx.save();
    ctx.translate(target.x, target.y);
    ctx.scale(dir * scale, scale); // mirror to face center, and grow/shrink for the pop-up/down animation

    if (target.sprite && target.sprite.img.naturalWidth > 0) {
      drawSpriteEnemy(target.sprite, r, flashing);
    } else {
      drawBuiltInFace(r, flashing);
    }

    ctx.restore();
  }

  function drawMissFlashes(now) {
    missFlashes = missFlashes.filter(function (m) { return m.expire > now; });
    missFlashes.forEach(function (m) {
      var t = (m.expire - now) / MISS_FLASH_MS;
      ctx.strokeStyle = 'rgba(255,255,255,' + t + ')';
      ctx.lineWidth = 3;
      var s = 14;
      ctx.beginPath();
      ctx.moveTo(m.x - s, m.y - s);
      ctx.lineTo(m.x + s, m.y + s);
      ctx.moveTo(m.x + s, m.y - s);
      ctx.lineTo(m.x - s, m.y + s);
      ctx.stroke();
    });
  }

  function drawHitBurstFlashes(now) {
    hitBurstFlashes = hitBurstFlashes.filter(function (f) { return f.expire > now; });
    hitBurstFlashes.forEach(function (f) {
      var t = (f.expire - now) / HIT_BURST_MS; // 1 -> 0 over the effect's life
      var radius = 70 * (1 - t) + 20;
      ctx.beginPath();
      ctx.arc(f.x, f.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, ' + (0.5 * t) + ')';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255, 240, 160, ' + t + ')';
      ctx.stroke();
    });
  }

  function drawMuzzleFlashes(now) {
    muzzleFlashes = muzzleFlashes.filter(function (m) { return m.expire > now; });
    muzzleFlashes.forEach(function (m) {
      var t = (m.expire - now) / ENEMY_MUZZLE_FLASH_MS; // 1 -> 0 over the effect's life
      var radius = 46 * (1 - t) + 10;
      ctx.beginPath();
      ctx.arc(m.x, m.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 140, 26, ' + (0.55 * t) + ')';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255, 200, 120, ' + t + ')';
      ctx.stroke();
    });
  }

  function drawDamageFlash(now) {
    if (now >= damageFlashUntil) return;
    var t = (damageFlashUntil - now) / DAMAGE_FLASH_MS;
    ctx.fillStyle = 'rgba(216, 40, 30, ' + (0.4 * t) + ')';
    ctx.fillRect(0, 0, W, H);
  }

  function drawRoundEndOverlay() {
    if (!roundResult) return;
    ctx.fillStyle = 'rgba(10, 10, 6, 0.78)';
    ctx.fillRect(0, 0, W, H);

    var cleared = roundResult === 'cleared';
    ctx.textAlign = 'center';
    ctx.font = '900 64px "Arial Black", Arial, sans-serif';
    ctx.fillStyle = cleared ? '#8fd94a' : '#d84a3a';
    ctx.fillText(cleared ? 'LEVEL CLEARED' : 'GAME OVER', W / 2, 130);

    var ranked = Array.from(players.entries()).sort(function (a, b) { return b[1].score - a[1].score; });
    var winnerId = cleared && ranked.length ? ranked[0][0] : null;

    ctx.font = '26px -apple-system, Helvetica, Arial, sans-serif';
    var startY = 210;
    ranked.forEach(function (entry, i) {
      var pid = entry[0], p = entry[1];
      var y = startY + i * 44;
      var label = 'P' + pid + '   ' + p.score + ' pts' + (pid === winnerId ? '   ★ WINNER' : '');
      ctx.fillStyle = p.color;
      ctx.fillRect(W / 2 - 220, y - 24, 20, 20);
      ctx.fillStyle = pid === winnerId ? '#ffd24d' : '#ded9c4';
      ctx.textAlign = 'left';
      ctx.fillText(label, W / 2 - 190, y - 6);
    });

    ctx.textAlign = 'center';
    ctx.font = '16px -apple-system, Helvetica, Arial, sans-serif';
    ctx.fillStyle = '#a29d87';
    ctx.fillText('Next round starting soon…', W / 2, startY + ranked.length * 44 + 30);
  }

  function drawWaitingForCalibration() {
    if (roundStarted) return;
    ctx.fillStyle = 'rgba(10, 10, 6, 0.6)';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.font = '900 40px "Arial Black", Arial, sans-serif';
    ctx.fillStyle = '#ded9c4';
    ctx.fillText('WAITING FOR PLAYERS', W / 2, H / 2 - 10);

    ctx.font = '18px -apple-system, Helvetica, Arial, sans-serif';
    ctx.fillStyle = '#a29d87';
    ctx.fillText('Calibrate your phone to begin', W / 2, H / 2 + 28);
  }

  function drawCrosshairs() {
    crosshairs.forEach(function (c, pid) {
      if (!c.visible) return;
      var p = players.get(pid);
      if (p && p.out) return;
      var x = c.x, y = c.y;
      ctx.strokeStyle = p ? p.color : '#00ffe1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.moveTo(x - 26, y);
      ctx.lineTo(x - 8, y);
      ctx.moveTo(x + 8, y);
      ctx.lineTo(x + 26, y);
      ctx.moveTo(x, y - 26);
      ctx.lineTo(x, y - 8);
      ctx.moveTo(x, y + 8);
      ctx.lineTo(x, y + 26);
      ctx.stroke();
    });
  }

  function drawHud() {
    var progressText = 'Enemies: ' + enemiesDefeated + ' / ' + ENEMIES_TO_CLEAR;
    ctx.font = '22px -apple-system, Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    var pw = ctx.measureText(progressText).width;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(W / 2 - pw / 2 - 14, 10, pw + 28, 30);
    ctx.fillStyle = '#eee';
    ctx.fillText(progressText, W / 2, 32);

    var sortedPlayers = Array.from(players.entries()).sort(function (a, b) { return a[0] - b[0]; });
    ctx.textAlign = 'left';
    ctx.font = '18px -apple-system, Helvetica, Arial, sans-serif';
    var rowY = 50;
    sortedPlayers.forEach(function (entry) {
      var pid = entry[0], p = entry[1];
      var label = 'P' + pid + (p.out ? '   OUT' : '   ♥' + Math.max(0, p.lives) + '   ' + p.score + 'pt');
      var tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(10, rowY, tw + 46, 26);
      ctx.fillStyle = p.color;
      ctx.fillRect(14, rowY + 5, 16, 16);
      ctx.fillStyle = p.out ? '#888' : '#eee';
      ctx.fillText(label, 36, rowY + 18);
      rowY += 30;
    });
  }

  function drawBackground() {
    if (bgReady) {
      var scale = Math.max(W / bgImage.naturalWidth, H / bgImage.naturalHeight);
      var dw = bgImage.naturalWidth * scale;
      var dh = bgImage.naturalHeight * scale;
      ctx.drawImage(bgImage, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, W, H);
    }
  }

  function render() {
    var now = gameNow();

    if (paired && !paused) updateGame(now);

    ctx.clearRect(0, 0, W, H);
    drawBackground();
    drawTarget(now);
    drawHitBurstFlashes(now);
    drawMuzzleFlashes(now);
    drawMissFlashes(now);
    drawCrosshairs();
    drawDamageFlash(now);
    drawHud();
    if (paired) drawWaitingForCalibration();
    drawRoundEndOverlay();
    requestAnimationFrame(render);
  }

  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (paused) resumeGame();
    else pauseGame();
  });
  pauseRestartBtn.addEventListener('click', restartGame);
  pauseQuitBtn.addEventListener('click', quitToLobby);

  function init() {
    sessionCodeEl.textContent = sessionCode;
    var joinUrl = location.origin + '/phone?session=' + sessionCode;
    pairingUrlEl.textContent = joinUrl;
    fetch('/api/qrcode?text=' + encodeURIComponent(joinUrl))
      .then(function (r) { return r.json(); })
      .then(function (data) { qrImgEl.src = data.dataUrl; })
      .catch(function () { /* QR is a convenience; code+URL text still works */ });

    resizeCanvasToWindow();
    window.addEventListener('resize', resizeCanvasToWindow);

    showPairing();
    connect();
    requestAnimationFrame(render);
  }

  init();
})();
