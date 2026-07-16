(function () {
  'use strict';

  var SAMPLE_W = 160;
  var SAMPLE_H = 90;
  var FRAME_INTERVAL_MS = 50; // ~20fps
  var MIN_TRACKING_MARKERS = 2; // fewer than this and there's no usable transform at all
  var MIN_MARKER_PIXELS = 6;
  var MIN_FILL_RATIO = 0.45; // matched pixels / bounding-box area — rejects scattered noise
  var HUE_TOLERANCE_DEG = 25;
  var MIN_SATURATION = 0.45;
  var MIN_VALUE = 0.35;

  var MARKER_COLOR_HUE = { tl: 0, tr: 120, bl: 240, br: 60 }; // red, green, blue, yellow

  // --- DOM ---
  var screenJoin = document.getElementById('screenJoin');
  var screenStatus = document.getElementById('screenStatus');
  var sessionInput = document.getElementById('sessionInput');
  var joinBtn = document.getElementById('joinBtn');
  var joinError = document.getElementById('joinError');
  var statusText = document.getElementById('statusText');
  var statusError = document.getElementById('statusError');
  var retryBtn = document.getElementById('retryBtn');
  var cameraContainer = document.getElementById('cameraContainer');
  var video = document.getElementById('cam');
  var overlay = document.getElementById('overlay');
  var overlayCtx = overlay.getContext('2d');
  var fireCatcher = document.getElementById('fireCatcher');
  var startBtn = document.getElementById('startBtn');
  var markerDots = {};
  document.querySelectorAll('.markerDot').forEach(function (el) {
    markerDots[el.dataset.id] = el;
  });

  var sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = SAMPLE_W;
  sampleCanvas.height = SAMPLE_H;
  var sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

  // --- state ---
  var appState = 'join'; // join | connecting | camera-error | disconnected | calibrating | playing
  var ws = null;
  var markerLayout = null; // { width, height, markers: [{id,xPx,yPx}] }
  var detectedMarkers = {}; // id -> {x,y} in sample-canvas space, this frame only
  var detectedCount = 0;
  var trackingOk = false;
  var trackingQuality = 'full'; // 'full' (4 markers) | 'partial' (3) | 'low' (2)
  var lastAim = null; // {x, y} normalized 0-1
  var lastGoodTrackingAt = 0;
  var FIRE_GRACE_MS = 400; // tapping the screen jostles the camera right when firing — don't let a one-frame tracking blip silently eat the shot
  var blockedFireFlashUntil = 0;
  var detectIntervalId = null;

  function showScreen(name) {
    screenJoin.classList.toggle('hidden', name !== 'join');
    screenStatus.classList.toggle('hidden', name !== 'status');
    cameraContainer.style.display = name === 'camera' ? 'block' : 'none';
  }

  function setStatus(text, errorText) {
    statusText.textContent = text;
    statusError.textContent = errorText || '';
    retryBtn.classList.toggle('hidden', !errorText);
    showScreen('status');
  }

  function backToJoin() {
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    if (detectIntervalId) { clearInterval(detectIntervalId); detectIntervalId = null; }
    markerLayout = null;
    lastAim = null;
    trackingOk = false;
    appState = 'join';
    joinError.textContent = '';
    showScreen('join');
  }

  // --- Websocket / pairing ---

  function join() {
    var code = (sessionInput.value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) {
      joinError.textContent = 'Enter the 4-character code shown on the display.';
      return;
    }
    joinError.textContent = '';
    appState = 'connecting';
    setStatus('Connecting to display…');

    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/?role=phone&session=' + code);

    ws.addEventListener('message', function (evt) {
      var msg;
      try { msg = JSON.parse(evt.data); } catch (e) { return; }

      if (msg.type === PROTOCOL.MSG_SESSION_ERROR) {
        setStatus('Could not join', msg.reason || 'That session code is not available.');
      } else if (msg.type === PROTOCOL.MSG_MARKER_LAYOUT) {
        markerLayout = msg;
      } else if (msg.type === PROTOCOL.MSG_SESSION_READY) {
        startCamera();
      } else if (msg.type === PROTOCOL.MSG_PEER_DISCONNECTED) {
        if (detectIntervalId) { clearInterval(detectIntervalId); detectIntervalId = null; }
        setStatus('Display disconnected', 'Go back and rejoin the session.');
      }
    });

    ws.addEventListener('close', function () {
      if (appState === 'connecting') {
        setStatus('Connection lost', 'Could not reach the display. Try again.');
      }
    });

    ws.addEventListener('error', function () {
      setStatus('Connection error', 'Could not reach the display. Try again.');
    });
  }

  // --- Camera ---

  function startCamera() {
    setStatus('Requesting camera access…', '');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('Camera access unavailable', 'This browser cannot access the camera on this page (it may need to be loaded over HTTPS).');
      return;
    }
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    }).then(function (stream) {
      video.srcObject = stream;
      return video.play();
    }).then(function () {
      appState = 'calibrating';
      showScreen('camera');
      startBtn.disabled = true;
      startBtn.textContent = 'Detecting markers… (0/4)';
      resizeOverlay();
      detectIntervalId = setInterval(processFrame, FRAME_INTERVAL_MS);
      requestAnimationFrame(drawOverlay);
    }).catch(function (err) {
      setStatus('Camera access needed', 'Please allow camera access and try again.');
    });
  }

  function resizeOverlay() {
    overlay.width = window.innerWidth;
    overlay.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeOverlay);

  // --- Color detection ---

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var d = max - min;
    var h = 0;
    if (d !== 0) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    var s = max === 0 ? 0 : d / max;
    var v = max;
    return [h, s, v];
  }

  function hueDist(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function detectMarkerCentroids() {
    sampleCtx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
    var data;
    try {
      data = sampleCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
    } catch (e) {
      return {};
    }

    var sums = {};
    Object.keys(MARKER_COLOR_HUE).forEach(function (id) {
      sums[id] = { sx: 0, sy: 0, count: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    });

    for (var py = 0; py < SAMPLE_H; py++) {
      for (var px = 0; px < SAMPLE_W; px++) {
        var idx = (py * SAMPLE_W + px) * 4;
        var r = data[idx], g = data[idx + 1], b = data[idx + 2];
        var hsv = rgbToHsv(r, g, b);
        if (hsv[1] < MIN_SATURATION || hsv[2] < MIN_VALUE) continue;

        for (var id in MARKER_COLOR_HUE) {
          if (hueDist(hsv[0], MARKER_COLOR_HUE[id]) <= HUE_TOLERANCE_DEG) {
            var s = sums[id];
            s.sx += px;
            s.sy += py;
            s.count++;
            if (px < s.minX) s.minX = px;
            if (px > s.maxX) s.maxX = px;
            if (py < s.minY) s.minY = py;
            if (py > s.maxY) s.maxY = py;
            break;
          }
        }
      }
    }

    // A real marker is a small solid-color square, so its matched pixels
    // should densely fill their own bounding box. A handful of pixels
    // scattered across a wide area (video noise, anti-aliased text edges
    // that happen to pick up a color tinge) is rejected here even though
    // it might clear the raw pixel-count bar — this is what stops a stray
    // false positive from being treated as a genuine marker detection.
    var centroids = {};
    Object.keys(sums).forEach(function (id) {
      var s = sums[id];
      if (s.count < MIN_MARKER_PIXELS) return;
      var boxW = s.maxX - s.minX + 1;
      var boxH = s.maxY - s.minY + 1;
      var fillRatio = s.count / (boxW * boxH);
      if (fillRatio < MIN_FILL_RATIO) return;
      centroids[id] = { x: s.sx / s.count, y: s.sy / s.count };
    });
    return centroids;
  }

  // --- Homography (4-point DLT solved via Gaussian elimination) ---

  function solveLinearSystem(A, b) {
    var n = b.length;
    var M = A.map(function (row, i) { return row.concat([b[i]]); });

    for (var col = 0; col < n; col++) {
      var pivot = col;
      for (var r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
      }
      if (Math.abs(M[pivot][col]) < 1e-9) return null;
      var tmp = M[col]; M[col] = M[pivot]; M[pivot] = tmp;

      for (r = col + 1; r < n; r++) {
        var factor = M[r][col] / M[col][col];
        for (var c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
      }
    }

    var x = new Array(n).fill(0);
    for (var i = n - 1; i >= 0; i--) {
      var sum = M[i][n];
      for (var j = i + 1; j < n; j++) sum -= M[i][j] * x[j];
      x[i] = sum / M[i][i];
    }
    return x;
  }

  function computeHomography(srcPts, dstPts) {
    var A = [];
    var b = [];
    for (var i = 0; i < 4; i++) {
      var x = srcPts[i].x, y = srcPts[i].y;
      var X = dstPts[i].x, Y = dstPts[i].y;
      A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
      b.push(X);
      A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
      b.push(Y);
    }
    var h = solveLinearSystem(A, b);
    if (!h) return null;
    return {
      h11: h[0], h12: h[1], h13: h[2],
      h21: h[3], h22: h[4], h23: h[5],
      h31: h[6], h32: h[7]
    };
  }

  function applyHomography(H, x, y) {
    var denom = H.h31 * x + H.h32 * y + 1;
    if (Math.abs(denom) < 1e-9) return null;
    return {
      x: (H.h11 * x + H.h12 * y + H.h13) / denom,
      y: (H.h21 * x + H.h22 * y + H.h23) / denom
    };
  }

  // --- Lower-DOF fallbacks for when not all four markers are visible ---
  // These trade accuracy for coverage: a full homography needs all four
  // corners in frame, which often isn't true at close range. With 3 points
  // we fit a 6-DOF affine transform (no perspective correction); with 2 we
  // fit a 4-DOF similarity transform (uniform scale + rotation + translation,
  // no perspective or shear). Both are exact fits for their point count, and
  // markedly less accurate than the full homography, especially the 2-point
  // case — but "less accurate" beats "can't aim at all".

  function computeAffine(srcPts, dstPts) {
    var A = [];
    var b = [];
    for (var i = 0; i < 3; i++) {
      var x = srcPts[i].x, y = srcPts[i].y;
      A.push([x, y, 1, 0, 0, 0]);
      b.push(dstPts[i].x);
      A.push([0, 0, 0, x, y, 1]);
      b.push(dstPts[i].y);
    }
    var m = solveLinearSystem(A, b);
    if (!m) return null;
    return { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] };
  }

  function applyAffine(T, x, y) {
    return { x: T.a * x + T.b * y + T.c, y: T.d * x + T.e * y + T.f };
  }

  function computeSimilarity(srcPts, dstPts) {
    var A = [];
    var b = [];
    for (var i = 0; i < 2; i++) {
      var x = srcPts[i].x, y = srcPts[i].y;
      A.push([x, -y, 1, 0]);
      b.push(dstPts[i].x);
      A.push([y, x, 0, 1]);
      b.push(dstPts[i].y);
    }
    var m = solveLinearSystem(A, b);
    if (!m) return null;
    return { a: m[0], b: m[1], tx: m[2], ty: m[3] };
  }

  function applySimilarity(T, x, y) {
    return { x: T.a * x - T.b * y + T.tx, y: T.b * x + T.a * y + T.ty };
  }

  // Picks the best transform the currently-visible markers allow: full
  // homography (4 pts) > affine (3 pts) > similarity (2 pts). Returns a
  // function that maps a sample-space point to display-space, or null if
  // fewer than 2 markers are visible or the fit is degenerate.
  function computeAimMapper(centroids, layoutById) {
    var visibleIds = ['tl', 'tr', 'bl', 'br'].filter(function (id) { return !!centroids[id]; });
    if (visibleIds.length < MIN_TRACKING_MARKERS) return null;

    var ids = visibleIds.length >= 4 ? visibleIds.slice(0, 4) : visibleIds;
    var srcPts = ids.map(function (id) { return centroids[id]; });
    var dstPts = ids.map(function (id) { return { x: layoutById[id].xPx, y: layoutById[id].yPx }; });

    if (ids.length >= 4) {
      var H = computeHomography(srcPts, dstPts);
      return H && function (x, y) { return applyHomography(H, x, y); };
    }
    if (ids.length === 3) {
      var Aff = computeAffine(srcPts, dstPts);
      return Aff && function (x, y) { return applyAffine(Aff, x, y); };
    }
    var Sim = computeSimilarity(srcPts, dstPts);
    return Sim && function (x, y) { return applySimilarity(Sim, x, y); };
  }

  // --- Per-frame processing ---

  function processFrame() {
    if (!markerLayout) return;
    var centroids = detectMarkerCentroids();
    detectedMarkers = centroids;
    var ids = Object.keys(centroids);
    detectedCount = ids.length;

    if (appState === 'calibrating') {
      if (detectedCount >= MIN_TRACKING_MARKERS) {
        startBtn.textContent = detectedCount >= 4
          ? 'Start (4/4 — best accuracy)'
          : 'Start (' + detectedCount + '/4 — reduced accuracy)';
      } else {
        startBtn.textContent = 'Detecting markers… (' + detectedCount + '/4)';
      }
      startBtn.disabled = detectedCount < MIN_TRACKING_MARKERS;
      Object.keys(markerDots).forEach(function (id) {
        markerDots[id].classList.toggle('found', !!centroids[id]);
      });
    }

    var layoutById = {};
    markerLayout.markers.forEach(function (m) { layoutById[m.id] = m; });

    var mapper = computeAimMapper(centroids, layoutById);
    if (!mapper) {
      trackingOk = false;
      return;
    }

    var center = mapper(SAMPLE_W / 2, SAMPLE_H / 2);
    if (!center) {
      trackingOk = false;
      return;
    }

    var aim = {
      x: center.x / markerLayout.width,
      y: center.y / markerLayout.height
    };
    lastAim = aim;
    trackingOk = true;
    trackingQuality = detectedCount >= 4 ? 'full' : (detectedCount === 3 ? 'partial' : 'low');
    lastGoodTrackingAt = performance.now();

    if (appState === 'playing' && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: PROTOCOL.MSG_AIM, x: aim.x, y: aim.y }));
    }
  }

  // --- Overlay drawing (crosshair, calibration dots, status text) ---

  function videoFrameToViewport(fx, fy) {
    var vw = video.videoWidth || SAMPLE_W;
    var vh = video.videoHeight || SAMPLE_H;
    var iw = window.innerWidth;
    var ih = window.innerHeight;
    var videoAspect = vw / vh;
    var viewportAspect = iw / ih;
    var x, y;
    if (videoAspect > viewportAspect) {
      var scale = ih / vh;
      var displayedWidth = vw * scale;
      var offsetX = (displayedWidth - iw) / 2;
      x = fx * displayedWidth - offsetX;
      y = fy * ih;
    } else {
      var scale2 = iw / vw;
      var displayedHeight = vh * scale2;
      var offsetY = (displayedHeight - ih) / 2;
      x = fx * iw;
      y = fy * displayedHeight - offsetY;
    }
    return { x: x, y: y };
  }

  function drawOverlay() {
    var w = overlay.width, h = overlay.height;
    overlayCtx.clearRect(0, 0, w, h);

    if (appState === 'calibrating') {
      Object.keys(detectedMarkers).forEach(function (id) {
        var c = detectedMarkers[id];
        var p = videoFrameToViewport(c.x / SAMPLE_W, c.y / SAMPLE_H);
        overlayCtx.beginPath();
        overlayCtx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        overlayCtx.fillStyle = '#fff';
        overlayCtx.fill();
        overlayCtx.lineWidth = 3;
        overlayCtx.strokeStyle = '#000';
        overlayCtx.stroke();
      });
    }

    var cx = w / 2, cy = h / 2;
    var lost = appState === 'playing' && !trackingOk;
    var crosshairColor = lost ? '#ff4d4d' : (trackingQuality === 'full' ? '#00ffe1' : '#ffd24d');
    overlayCtx.strokeStyle = crosshairColor;
    overlayCtx.lineWidth = 2;
    overlayCtx.beginPath();
    overlayCtx.arc(cx, cy, 22, 0, Math.PI * 2);
    overlayCtx.moveTo(cx - 32, cy); overlayCtx.lineTo(cx - 10, cy);
    overlayCtx.moveTo(cx + 10, cy); overlayCtx.lineTo(cx + 32, cy);
    overlayCtx.moveTo(cx, cy - 32); overlayCtx.lineTo(cx, cy - 10);
    overlayCtx.moveTo(cx, cy + 10); overlayCtx.lineTo(cx, cy + 32);
    overlayCtx.stroke();

    if (lost) {
      overlayCtx.font = '18px -apple-system, Helvetica, Arial, sans-serif';
      overlayCtx.textAlign = 'center';
      overlayCtx.fillStyle = '#ff4d4d';
      overlayCtx.fillText('tracking lost — recenter phone on screen', cx, cy + 60);
    } else if (appState === 'playing' && trackingQuality !== 'full') {
      overlayCtx.font = '16px -apple-system, Helvetica, Arial, sans-serif';
      overlayCtx.textAlign = 'center';
      overlayCtx.fillStyle = '#ffd24d';
      overlayCtx.fillText('reduced accuracy — only ' + detectedCount + '/4 markers visible', cx, cy + 60);
    }

    if (performance.now() < blockedFireFlashUntil) {
      overlayCtx.font = 'bold 20px -apple-system, Helvetica, Arial, sans-serif';
      overlayCtx.textAlign = 'center';
      overlayCtx.fillStyle = '#ff4d4d';
      overlayCtx.fillText('shot blocked — no tracking', cx, cy - 40);
    }

    if (appState === 'calibrating' || appState === 'playing') {
      requestAnimationFrame(drawOverlay);
    }
  }

  // --- Input handling ---

  joinBtn.addEventListener('click', join);
  sessionInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') join();
  });
  retryBtn.addEventListener('click', backToJoin);

  startBtn.addEventListener('click', function () {
    appState = 'playing';
    startBtn.style.display = 'none';
  });

  fireCatcher.addEventListener('pointerdown', function () {
    if (appState !== 'playing') return;
    var withinGracePeriod = performance.now() - lastGoodTrackingAt <= FIRE_GRACE_MS;
    if (!lastAim || !withinGracePeriod) {
      blockedFireFlashUntil = performance.now() + 200;
      return;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: PROTOCOL.MSG_FIRE, x: lastAim.x, y: lastAim.y }));
    }
  });

  // Pre-fill session code from ?session= query param.
  (function prefill() {
    var params = new URLSearchParams(location.search);
    var s = params.get('session');
    if (s) sessionInput.value = s.toUpperCase();
  })();

  showScreen('join');
})();
