(function () {
  'use strict';

  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
  var SAFE_AREA = { xMin: 60, xMax: 1220, yMin: 70, yMax: 680 }; // margin is just for the HUD text and canvas edges now that there are no corner markers to avoid
  var TARGET_RADIUS = 36;
  var TARGET_SPEED = 70; // logical px/sec — kept slow so tracking accuracy is easy to judge
  var HIT_FORGIVENESS = 15;
  var HIT_FLASH_MS = 150;
  var MISS_FLASH_MS = 300;

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
  var crosshair = { x: W / 2, y: H / 2, visible: false };
  var missFlashes = [];
  var hitFlashUntil = 0;
  var paired = false;
  var lastFrameTime = null;

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

  function spawnTarget() {
    var angle = Math.random() * Math.PI * 2;
    target = {
      x: SAFE_AREA.xMin + Math.random() * (SAFE_AREA.xMax - SAFE_AREA.xMin),
      y: SAFE_AREA.yMin + Math.random() * (SAFE_AREA.yMax - SAFE_AREA.yMin),
      r: TARGET_RADIUS,
      vx: Math.cos(angle) * TARGET_SPEED,
      vy: Math.sin(angle) * TARGET_SPEED
    };
  }

  function updateTarget(dt) {
    if (!target) return;
    target.x += target.vx * dt;
    target.y += target.vy * dt;
    if (target.x < SAFE_AREA.xMin) { target.x = SAFE_AREA.xMin; target.vx = Math.abs(target.vx); }
    if (target.x > SAFE_AREA.xMax) { target.x = SAFE_AREA.xMax; target.vx = -Math.abs(target.vx); }
    if (target.y < SAFE_AREA.yMin) { target.y = SAFE_AREA.yMin; target.vy = Math.abs(target.vy); }
    if (target.y > SAFE_AREA.yMax) { target.y = SAFE_AREA.yMax; target.vy = -Math.abs(target.vy); }
  }

  function handleFire(msg) {
    shots++;
    var px = msg.x * W;
    var py = msg.y * H;
    var now = performance.now();
    if (target) {
      var dx = px - target.x;
      var dy = py - target.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= target.r + HIT_FORGIVENESS) {
        score++;
        hitFlashUntil = now + HIT_FLASH_MS;
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
        spawnTarget();
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
    var flashing = now < hitFlashUntil;
    var facingRight = target.vx >= 0;
    var r = target.r;
    var dir = facingRight ? 1 : -1;

    var skin = flashing ? '#ffffff' : '#d9a066';
    var skinShade = flashing ? '#eeeeee' : '#b9824f';
    var hair = flashing ? '#ffffff' : '#4a3728';
    var hairShade = flashing ? '#eeeeee' : '#332319';

    ctx.save();
    ctx.translate(target.x, target.y);
    ctx.scale(dir, 1); // mirror the whole face toward the direction of travel

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
    ctx.fillStyle = '#eee';
    ctx.fillText(text, W / 2, 34);
  }

  function render() {
    var now = performance.now();
    var dt = lastFrameTime === null ? 0 : Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;

    if (paired) updateTarget(dt);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);
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
