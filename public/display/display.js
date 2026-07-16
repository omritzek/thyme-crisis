(function () {
  'use strict';

  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
  var SAFE_AREA = { xMin: 180, xMax: 1100, yMin: 180, yMax: 560 };
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
  var markerRects = protocolMarkerRects();

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
        ws.send(JSON.stringify(protocolMarkerLayout()));
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

  function drawMarkers() {
    Object.keys(markerRects).forEach(function (id) {
      var r = markerRects[id];
      ctx.fillStyle = PROTOCOL.MARKER_COLORS[id];
      ctx.fillRect(r.x, r.y, r.w, r.h);
    });
  }

  function drawTarget(now) {
    if (!target) return;
    var flashing = now < hitFlashUntil;
    var facingRight = target.vx >= 0;
    var bodyColor = flashing ? '#ffffff' : '#f6c744';
    var billColor = flashing ? '#ffffff' : '#e8811a';
    var r = target.r;
    var dir = facingRight ? 1 : -1;

    ctx.save();
    ctx.translate(target.x, target.y);

    // body
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.05, r * 0.72, 0, 0, Math.PI * 2);
    ctx.fillStyle = bodyColor;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#8a6a12';
    ctx.stroke();

    // head
    ctx.beginPath();
    ctx.arc(dir * r * 0.62, -r * 0.45, r * 0.48, 0, Math.PI * 2);
    ctx.fillStyle = bodyColor;
    ctx.fill();
    ctx.stroke();

    // bill
    ctx.beginPath();
    ctx.moveTo(dir * r * 0.95, -r * 0.45);
    ctx.lineTo(dir * r * 1.5, -r * 0.32);
    ctx.lineTo(dir * r * 0.95, -r * 0.2);
    ctx.closePath();
    ctx.fillStyle = billColor;
    ctx.fill();

    // eye
    ctx.beginPath();
    ctx.arc(dir * r * 0.72, -r * 0.55, r * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = '#2a2a2a';
    ctx.fill();

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
    drawMarkers();
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
