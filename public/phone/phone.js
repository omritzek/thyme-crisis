(function () {
  'use strict';

  var SAMPLE_W = 160;
  var SAMPLE_H = 90;
  var FRAME_INTERVAL_MS = 50; // ~20fps
  var MIN_MARKER_PIXELS = 4;
  var HUE_TOLERANCE_DEG = 25;
  var MIN_SATURATION = 0.4;
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
  var lastAim = null; // {x, y} normalized 0-1
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
      sums[id] = { sx: 0, sy: 0, count: 0 };
    });

    for (var py = 0; py < SAMPLE_H; py++) {
      for (var px = 0; px < SAMPLE_W; px++) {
        var idx = (py * SAMPLE_W + px) * 4;
        var r = data[idx], g = data[idx + 1], b = data[idx + 2];
        var hsv = rgbToHsv(r, g, b);
        if (hsv[1] < MIN_SATURATION || hsv[2] < MIN_VALUE) continue;

        for (var id in MARKER_COLOR_HUE) {
          if (hueDist(hsv[0], MARKER_COLOR_HUE[id]) <= HUE_TOLERANCE_DEG) {
            sums[id].sx += px;
            sums[id].sy += py;
            sums[id].count++;
            break;
          }
        }
      }
    }

    var centroids = {};
    Object.keys(sums).forEach(function (id) {
      var s = sums[id];
      if (s.count >= MIN_MARKER_PIXELS) {
        centroids[id] = { x: s.sx / s.count, y: s.sy / s.count };
      }
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

  // --- Per-frame processing ---

  function processFrame() {
    if (!markerLayout) return;
    var centroids = detectMarkerCentroids();
    detectedMarkers = centroids;
    var ids = Object.keys(centroids);
    detectedCount = ids.length;

    if (appState === 'calibrating') {
      startBtn.textContent = 'Detecting markers… (' + detectedCount + '/4)';
      startBtn.disabled = detectedCount < 4;
    }

    if (detectedCount < 4) {
      trackingOk = false;
      return;
    }

    var layoutById = {};
    markerLayout.markers.forEach(function (m) { layoutById[m.id] = m; });

    var srcPts = [], dstPts = [];
    ['tl', 'tr', 'bl', 'br'].forEach(function (id) {
      srcPts.push(centroids[id]);
      dstPts.push({ x: layoutById[id].xPx, y: layoutById[id].yPx });
    });

    var H = computeHomography(srcPts, dstPts);
    if (!H) {
      trackingOk = false;
      return;
    }

    var center = applyHomography(H, SAMPLE_W / 2, SAMPLE_H / 2);
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
    overlayCtx.strokeStyle = lost ? '#ff4d4d' : '#00ffe1';
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
    if (!trackingOk || !lastAim) return;
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
