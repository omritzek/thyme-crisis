(function () {
  'use strict';

  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
  var TARGET_RADIUS = 36;
  var HIT_FORGIVENESS = 15;
  var HIT_FLASH_MS = 150;
  var MISS_FLASH_MS = 300;

  // Fixed spots (as fractions of the canvas) where the target pops up from —
  // picked to line up with playground features in the background image
  // (tunnel slide opening, climbing panel, dome roof, swing seat, benches).
  // Nudge these if they don't quite land on the right spot once the actual
  // background is in place.
  var HIDE_SPOTS = [
    { x: 0.10, y: 0.72 }, // tunnel slide opening
    { x: 0.30, y: 0.38 }, // purple climbing panel window
    { x: 0.62, y: 0.24 }, // orange dome roof
    { x: 0.84, y: 0.52 }, // swing seat
    { x: 0.08, y: 0.76 }, // left bench
    { x: 0.78, y: 0.76 }  // right bench
  ];
  var POP_UP_MS = 180;
  var POP_DOWN_MS = 150;
  var VISIBLE_MIN_MS = 2200;
  var VISIBLE_MAX_MS = 3600;
  var HIDDEN_MIN_MS = 500;
  var HIDDEN_MAX_MS = 1200;

  var pairingEl = document.getElementById('pairing');
  var stageEl = document.getElementById('stage');
  var sessionCodeEl = document.getElementById('sessionCode');
  var pairingUrlEl = document.getElementById('pairingUrl');
  var qrImgEl = document.getElementById('qrImg');
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  var W = PROTOCOL.LOGICAL_WIDTH;
  var H = PROTOCOL.LOGICAL_HEIGHT;

  var sessionCode = generateSessionCode();
  var ws = null;

  var score = 0;
  var shots = 0;
  var target = null;
  var lastSpotIndex = -1;
  var nextPopAt = 0;
  var crosshair = { x: W / 2, y: H / 2, visible: false };
  var missFlashes = [];
  var hitFlashUntil = 0;
  var paired = false;

  var bgImage = new Image();
  var bgReady = false;
  bgImage.onload = function () { bgReady = true; };
  bgImage.src = '/display/assets/playground.jpg';

  function generateSessionCode() {
    var code = '';
    for (var i = 0; i < 4; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return code;
  }

  function resizeCanvasToWindow() {
    var scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = (W * scale) + 'px';
    canvas.style.height = (H * scale) + 'px';
  }

  function showPairing() {
    paired = false;
    pairingEl.classList.remove('hidden');
    stageEl.classList.add('hidden');
  }

  function showGame() {
    paired = true;
    pairingEl.classList.add('hidden');
    stageEl.classList.remove('hidden');
  }

  function scheduleNextPop(now, delayMs) {
    nextPopAt = now + delayMs;
  }

  function popUpTarget(now) {
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
      visibleUntil: 0
    };
  }

  function targetScale(now) {
    if (!target) return 0;
    if (target.state === 'popping-up') return Math.min(1, (now - target.stateStartedAt) / POP_UP_MS);
    if (target.state === 'popping-down') return Math.max(0, 1 - (now - target.stateStartedAt) / POP_DOWN_MS);
    return 1;
  }

  function updateTarget(now) {
    if (!target) {
      if (now >= nextPopAt) popUpTarget(now);
      return;
    }
    if (target.state === 'popping-up' && now - target.stateStartedAt >= POP_UP_MS) {
      target.state = 'visible';
      target.stateStartedAt = now;
      target.visibleUntil = now + VISIBLE_MIN_MS + Math.random() * (VISIBLE_MAX_MS - VISIBLE_MIN_MS);
    } else if (target.state === 'visible' && now >= target.visibleUntil) {
      target.state = 'popping-down';
      target.stateStartedAt = now;
    } else if (target.state === 'popping-down' && now - target.stateStartedAt >= POP_DOWN_MS) {
      target = null;
      scheduleNextPop(now, HIDDEN_MIN_MS + Math.random() * (HIDDEN_MAX_MS - HIDDEN_MIN_MS));
    }
  }

  function handleFire(msg) {
    shots++;
    var px = msg.x * W;
    var py = msg.y * H;
    var now = performance.now();
    if (target && target.state === 'visible') {
      var dx = px - target.x;
      var dy = py - target.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= target.r + HIT_FORGIVENESS) {
        score++;
        hitFlashUntil = now + HIT_FLASH_MS;
        target.state = 'popping-down';
        target.stateStartedAt = now;
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

      if (msg.type === PROTOCOL.MSG_PHONE_CONNECTED) {
        ws.send(JSON.stringify({ type: PROTOCOL.MSG_SESSION_READY }));
        score = 0;
        shots = 0;
        target = null;
        lastSpotIndex = -1;
        scheduleNextPop(performance.now(), 300);
        showGame();
      } else if (msg.type === PROTOCOL.MSG_PEER_DISCONNECTED) {
        showPairing();
      } else if (msg.type === PROTOCOL.MSG_AIM) {
        crosshair.x = msg.x * W;
        crosshair.y = msg.y * H;
        crosshair.visible = true;
      } else if (msg.type === PROTOCOL.MSG_FIRE) {
        handleFire(msg);
      }
    });

    ws.addEventListener('close', function () {
      showPairing();
      setTimeout(connect, 1500);
    });
  }

  function drawTarget(now) {
    if (!target) return;
    var scale = targetScale(now);
    if (scale <= 0) return;
    var flashing = now < hitFlashUntil;
    var r = target.r;
    var dir = target.x < W / 2 ? 1 : -1; // face toward the center of the screen

    var skin = flashing ? '#ffffff' : '#d9a066';
    var skinShade = flashing ? '#eeeeee' : '#b9824f';
    var hair = flashing ? '#ffffff' : '#4a3728';
    var hairShade = flashing ? '#eeeeee' : '#332319';

    ctx.save();
    ctx.translate(target.x, target.y);
    ctx.scale(dir * scale, scale); // mirror to face center, and grow/shrink for the pop-up/down animation

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

  function drawCrosshair() {
    if (!crosshair.visible) return;
    var x = crosshair.x, y = crosshair.y;
    ctx.strokeStyle = '#00ffe1';
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
  }

  function drawHud() {
    var accuracy = shots > 0 ? Math.round((score / shots) * 100) : 0;
    var text = 'Score: ' + score + '    Shots: ' + shots + '    Accuracy: ' + accuracy + '%';
    ctx.font = '24px -apple-system, Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    var textWidth = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(W / 2 - textWidth / 2 - 16, 10, textWidth + 32, 32);
    ctx.fillStyle = '#eee';
    ctx.fillText(text, W / 2, 34);
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
    var now = performance.now();

    if (paired) updateTarget(now);

    ctx.clearRect(0, 0, W, H);
    drawBackground();
    drawTarget(now);
    drawMissFlashes(now);
    drawCrosshair();
    drawHud();
    requestAnimationFrame(render);
  }

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
