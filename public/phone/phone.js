(function () {
  'use strict';

  var AIM_RANGE_DEG = 25; // rotating this many degrees from the calibrated center reaches the screen edge
  var SEND_INTERVAL_MS = 50; // ~20/sec, matches the protocol's throttle target
  var FIRE_GRACE_MS = 400; // tolerate the brief sensor jitter a screen tap itself causes

  // --- DOM ---
  var screenJoin = document.getElementById('screenJoin');
  var screenStatus = document.getElementById('screenStatus');
  var screenMotion = document.getElementById('screenMotion');
  var screenCalibrate = document.getElementById('screenCalibrate');
  var playScreen = document.getElementById('playScreen');

  var sessionInput = document.getElementById('sessionInput');
  var joinBtn = document.getElementById('joinBtn');
  var joinError = document.getElementById('joinError');
  var statusText = document.getElementById('statusText');
  var statusError = document.getElementById('statusError');
  var retryBtn = document.getElementById('retryBtn');
  var motionBtn = document.getElementById('motionBtn');
  var motionError = document.getElementById('motionError');
  var calibrateBtn = document.getElementById('calibrateBtn');
  var angleReadout = document.getElementById('angleReadout');
  var angleReadoutPlay = document.getElementById('angleReadoutPlay');
  var recalibrateBtn = document.getElementById('recalibrateBtn');
  var fireCatcher = document.getElementById('fireCatcher');
  var blockedFlash = document.getElementById('blockedFlash');

  // --- state ---
  var appState = 'join'; // join | connecting | motion-permission | calibrating | playing
  var ws = null;
  var latestOrientation = null; // {alpha, beta, gamma}
  var baseline = null; // {alpha, beta}
  var lastAim = null; // {x, y} normalized 0-1
  var lastGoodAimAt = 0;
  var sendIntervalId = null;

  function showScreen(name) {
    screenJoin.classList.toggle('hidden', name !== 'join');
    screenStatus.classList.toggle('hidden', name !== 'status');
    screenMotion.classList.toggle('hidden', name !== 'motion');
    screenCalibrate.classList.toggle('hidden', name !== 'calibrate');
    playScreen.style.display = name === 'play' ? 'flex' : 'none';
  }

  function setStatus(text, errorText) {
    statusText.textContent = text;
    statusError.textContent = errorText || '';
    retryBtn.classList.toggle('hidden', !errorText);
    showScreen('status');
  }

  function backToJoin() {
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    if (sendIntervalId) { clearInterval(sendIntervalId); sendIntervalId = null; }
    baseline = null;
    lastAim = null;
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
      } else if (msg.type === PROTOCOL.MSG_SESSION_READY) {
        appState = 'motion-permission';
        showScreen('motion');
      } else if (msg.type === PROTOCOL.MSG_PEER_DISCONNECTED) {
        if (sendIntervalId) { clearInterval(sendIntervalId); sendIntervalId = null; }
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

  // --- Motion sensors ---

  function onOrientation(event) {
    if (event.alpha === null && event.beta === null && event.gamma === null) return;
    latestOrientation = { alpha: event.alpha, beta: event.beta, gamma: event.gamma };
  }

  function requestMotionAccess() {
    motionError.textContent = '';

    function start() {
      window.addEventListener('deviceorientation', onOrientation);
      appState = 'calibrating';
      showScreen('calibrate');
      requestAnimationFrame(updateCalibrateReadout);
    }

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(function (result) {
        if (result === 'granted') {
          start();
        } else {
          motionError.textContent = 'Motion access was denied. Enable it in Settings > Safari > Motion & Orientation Access, then try again.';
        }
      }).catch(function () {
        motionError.textContent = 'Could not request motion access on this browser.';
      });
    } else if (typeof DeviceOrientationEvent !== 'undefined') {
      start();
    } else {
      motionError.textContent = 'This browser does not support motion sensors, so phone aiming cannot work here.';
    }
  }

  // --- Calibration ---

  function angleDelta(a, b) {
    return ((a - b + 540) % 360) - 180;
  }

  function updateCalibrateReadout() {
    if (appState !== 'calibrating') return;
    if (latestOrientation) {
      calibrateBtn.disabled = false;
      angleReadout.textContent =
        'pan ' + latestOrientation.alpha.toFixed(1) + '°  tilt ' + latestOrientation.beta.toFixed(1) + '°';
    } else {
      calibrateBtn.disabled = true;
      angleReadout.textContent = 'waiting for sensor…';
    }
    requestAnimationFrame(updateCalibrateReadout);
  }

  function calibrate() {
    if (!latestOrientation) return;
    baseline = { alpha: latestOrientation.alpha, beta: latestOrientation.beta };
    appState = 'playing';
    showScreen('play');
    if (sendIntervalId) clearInterval(sendIntervalId);
    sendIntervalId = setInterval(tick, SEND_INTERVAL_MS);
  }

  // --- Per-tick aim computation ---

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  function tick() {
    if (!latestOrientation || !baseline) return;

    var deltaPan = angleDelta(latestOrientation.alpha, baseline.alpha);
    var deltaTilt = latestOrientation.beta - baseline.beta;

    var aim = {
      x: clamp01(0.5 + (deltaPan / AIM_RANGE_DEG) * 0.5),
      y: clamp01(0.5 + (deltaTilt / AIM_RANGE_DEG) * 0.5)
    };
    lastAim = aim;
    lastGoodAimAt = performance.now();

    angleReadoutPlay.textContent = 'pan ' + deltaPan.toFixed(1) + '°  tilt ' + deltaTilt.toFixed(1) + '°';

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: PROTOCOL.MSG_AIM, x: aim.x, y: aim.y }));
    }
  }

  // --- Input handling ---

  joinBtn.addEventListener('click', join);
  sessionInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') join();
  });
  retryBtn.addEventListener('click', backToJoin);
  motionBtn.addEventListener('click', requestMotionAccess);
  calibrateBtn.addEventListener('click', calibrate);
  recalibrateBtn.addEventListener('click', calibrate);

  fireCatcher.addEventListener('pointerdown', function () {
    if (appState !== 'playing') return;
    var withinGracePeriod = performance.now() - lastGoodAimAt <= FIRE_GRACE_MS;
    if (!lastAim || !withinGracePeriod) {
      blockedFlash.style.display = 'block';
      setTimeout(function () { blockedFlash.style.display = 'none'; }, 150);
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
