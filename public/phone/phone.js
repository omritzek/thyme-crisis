(function () {
  'use strict';

  var AIM_RANGE_DEG = 25; // rotating this many degrees from the calibrated center reaches the screen edge
  var SEND_INTERVAL_MS = 50; // ~20/sec, matches the protocol's throttle target
  var FIRE_GRACE_MS = 400; // tolerate the brief sensor jitter a screen tap itself causes

  // --- Ammo / reload ---
  // Six shots, then the player has to physically reload by tilting the
  // phone down (like lowering the muzzle) and holding it there briefly —
  // measured relative to the calibrated baseline so it works regardless of
  // how the phone happens to be held or where the screen sits.
  var AMMO_MAX = 6;
  var RELOAD_TILT_DELTA_DEG = -50; // this far below the calibrated baseline counts as "pointed down"
  var RELOAD_HOLD_MS = 400;
  var ammo = AMMO_MAX;
  var reloadHoldStartedAt = null;

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
  var invertPanBtn = document.getElementById('invertPanBtn');
  var invertTiltBtn = document.getElementById('invertTiltBtn');
  var angleReadout = document.getElementById('angleReadout');
  var angleReadoutPlay = document.getElementById('angleReadoutPlay');
  var recalibrateBtn = document.getElementById('recalibrateBtn');
  var fireCatcher = document.getElementById('fireCatcher');
  var blockedFlash = document.getElementById('blockedFlash');
  var ammoReadout = document.getElementById('ammoReadout');
  var playHint = document.getElementById('playHint');
  var screenWaiting = document.getElementById('screenWaiting');
  var waitingMessage = document.getElementById('waitingMessage');
  var waitingHint = document.getElementById('waitingHint');
  var playerBadge = document.getElementById('playerBadge');
  var playerBadgeDot = document.getElementById('playerBadgeDot');
  var playerBadgeText = document.getElementById('playerBadgeText');

  // --- state ---
  var appState = 'join'; // join | connecting | motion-permission | calibrating | playing | waiting
  var ws = null;
  var latestOrientation = null; // {alpha, beta, gamma}
  var baseline = null; // {azimuth, elevation} of the pointing vector at calibration time
  var lastAim = null; // {x, y} normalized 0-1
  var lastGoodAimAt = 0;
  var sendIntervalId = null;
  var hasCalibratedOnce = false; // only the first calibration should tell the display to start the game; recalibrating mid-game shouldn't reset it
  var myPlayerId = null;

  function showScreen(name) {
    screenJoin.classList.toggle('hidden', name !== 'join');
    screenStatus.classList.toggle('hidden', name !== 'status');
    screenMotion.classList.toggle('hidden', name !== 'motion');
    screenCalibrate.classList.toggle('hidden', name !== 'calibrate');
    screenWaiting.classList.toggle('hidden', name !== 'waiting');
    playScreen.style.display = name === 'play' ? 'flex' : 'none';
  }

  function showWaitingScreen(message, hintText, cssClass) {
    appState = 'waiting';
    if (sendIntervalId) { clearInterval(sendIntervalId); sendIntervalId = null; }
    waitingMessage.textContent = message;
    waitingMessage.classList.remove('cleared', 'game-over');
    if (cssClass) waitingMessage.classList.add(cssClass);
    waitingHint.textContent = hintText || '';
    showScreen('waiting');
  }

  function setStatus(text, errorText) {
    statusText.textContent = text;
    statusError.textContent = errorText || '';
    retryBtn.classList.toggle('hidden', !errorText);
    showScreen('status');
  }

  function updatePlayerBadge() {
    if (myPlayerId === null) {
      playerBadge.classList.remove('visible');
      return;
    }
    playerBadgeDot.style.background = PROTOCOL.PLAYER_COLORS[(myPlayerId - 1) % PROTOCOL.PLAYER_COLORS.length];
    playerBadgeText.textContent = 'Player ' + myPlayerId;
    playerBadge.classList.add('visible');
  }

  function backToJoin() {
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    if (sendIntervalId) { clearInterval(sendIntervalId); sendIntervalId = null; }
    stopTorch();
    baseline = null;
    lastAim = null;
    hasCalibratedOnce = false;
    myPlayerId = null;
    updatePlayerBadge();
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
      } else if (msg.type === PROTOCOL.MSG_PLAYER_ASSIGNED) {
        myPlayerId = msg.playerId;
        updatePlayerBadge();
      } else if (msg.type === PROTOCOL.MSG_SESSION_READY) {
        appState = 'motion-permission';
        showScreen('motion');
      } else if (msg.type === PROTOCOL.MSG_YOU_ARE_OUT) {
        showWaitingScreen('YOU\'RE OUT', 'Spectating — waiting for the round to end.');
      } else if (msg.type === PROTOCOL.MSG_ROUND_ENDED) {
        var cleared = msg.result === 'cleared';
        showWaitingScreen(cleared ? 'LEVEL CLEARED!' : 'GAME OVER', 'Waiting for the next round…', cleared ? 'cleared' : 'game-over');
      } else if (msg.type === PROTOCOL.MSG_ROUND_STARTED) {
        if (appState === 'waiting' && baseline) enterPlayingState();
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

  // Raw deviceorientation readings are noisy frame-to-frame (alpha especially,
  // since it's magnetometer-derived) — feeding that straight into the aim
  // calculation makes the crosshair visibly jitter even when the phone is
  // held still. Smooth it with a simple exponential moving average: each new
  // reading nudges the tracked value toward itself rather than replacing it
  // outright. Lower = smoother but more lag; higher = snappier but noisier.
  var ORIENTATION_SMOOTHING = 0.2;

  function onOrientation(event) {
    if (event.alpha === null && event.beta === null && event.gamma === null) return;
    if (!latestOrientation) {
      latestOrientation = { alpha: event.alpha, beta: event.beta, gamma: event.gamma };
      return;
    }
    var alphaStep = angleDelta(event.alpha, latestOrientation.alpha) * ORIENTATION_SMOOTHING;
    latestOrientation = {
      alpha: (latestOrientation.alpha + alphaStep + 360) % 360,
      beta: latestOrientation.beta + (event.beta - latestOrientation.beta) * ORIENTATION_SMOOTHING,
      gamma: latestOrientation.gamma + (event.gamma - latestOrientation.gamma) * ORIENTATION_SMOOTHING
    };
  }

  // --- Camera torch flash on fire ---
  // A real LED flash on each shot reads as a much more tactile "gunshot"
  // than a screen effect. This only works where the browser exposes torch
  // control on a getUserMedia video track at all — iOS Safari/WebKit never
  // has (an Apple platform restriction, not a bug here), so camera access
  // is skipped there entirely rather than prompting for a permission that
  // could never do anything. Android Chrome/Edge generally support it.
  var IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  var TORCH_FLASH_MS = 120;
  var torchTrack = null;
  var torchOffTimer = null;

  function initTorch() {
    if (IS_IOS || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
      .then(function (stream) {
        var track = stream.getVideoTracks()[0];
        if (!track) return;
        var caps = track.getCapabilities ? track.getCapabilities() : {};
        if (!caps.torch) {
          track.stop();
          return;
        }
        torchTrack = track;
      })
      .catch(function () {
        // No camera, permission denied, or no torch support — the flash is
        // purely a nice-to-have, so fail silently and keep playing without it.
      });
  }

  function flashTorch() {
    if (!torchTrack) return;
    if (torchOffTimer) clearTimeout(torchOffTimer);
    torchTrack.applyConstraints({ advanced: [{ torch: true }] }).catch(function () {});
    torchOffTimer = setTimeout(function () {
      torchTrack.applyConstraints({ advanced: [{ torch: false }] }).catch(function () {});
    }, TORCH_FLASH_MS);
  }

  function stopTorch() {
    if (torchOffTimer) { clearTimeout(torchOffTimer); torchOffTimer = null; }
    if (torchTrack) { try { torchTrack.stop(); } catch (e) {} torchTrack = null; }
  }

  function requestMotionAccess() {
    motionError.textContent = '';

    function start() {
      window.addEventListener('deviceorientation', onOrientation);
      initTorch();
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

  // Raw alpha/beta/gamma Euler angles hit a real singularity (gimbal lock)
  // exactly when the phone is held near-vertical — which is exactly the pose
  // used to aim it at a screen. Near that pose, alpha can swing wildly or
  // flip sign for a tiny hand movement. Instead, extract the actual 3D
  // direction the back of the phone points (the same axis a rear camera
  // would point down, i.e. how you'd naturally hold it like a remote aimed
  // at the screen) and work with its azimuth/elevation. That vector stays
  // well-behaved through the vertical pose, since the singularity for THIS
  // axis is at pointing straight up/down, not at "held upright".
  function toRad(deg) { return deg * Math.PI / 180; }
  function toDeg(rad) { return rad * 180 / Math.PI; }

  function pointingVector(o) {
    var a = toRad(o.alpha), b = toRad(o.beta), g = toRad(o.gamma);
    var ca = Math.cos(a), sa = Math.sin(a);
    var cb = Math.cos(b), sb = Math.sin(b);
    var cg = Math.cos(g), sg = Math.sin(g);
    return {
      x: -(ca * sg + cg * sa * sb),
      y: ca * cg * sb - sa * sg,
      z: -(cb * cg)
    };
  }

  function azimuthElevation(v) {
    return {
      azimuth: toDeg(Math.atan2(v.x, v.y)),
      elevation: toDeg(Math.atan2(v.z, Math.hypot(v.x, v.y)))
    };
  }

  // Device/browser axis-sign conventions vary enough in practice that a
  // fixed formula can't be guaranteed correct on every phone sight unseen —
  // these let the player flip either axis themselves instead of needing a
  // code change. Persisted per-device so it's a one-time fix.
  var invertPan = localStorage.getItem('lightgun_invertPan') === '1';
  var invertTilt = localStorage.getItem('lightgun_invertTilt') === '1';

  function updateCalibrateReadout() {
    if (appState !== 'calibrating') return;
    if (latestOrientation) {
      calibrateBtn.disabled = false;
      var ae = azimuthElevation(pointingVector(latestOrientation));
      angleReadout.textContent =
        'pan ' + ae.azimuth.toFixed(1) + '°  tilt ' + ae.elevation.toFixed(1) + '°';
    } else {
      calibrateBtn.disabled = true;
      angleReadout.textContent = 'waiting for sensor…';
    }
    requestAnimationFrame(updateCalibrateReadout);
  }

  function updateAmmoUi() {
    ammoReadout.textContent = 'AMMO ' + Math.max(0, ammo) + '/' + AMMO_MAX;
    ammoReadout.classList.toggle('empty', ammo <= 0);
    if (ammo <= 0) {
      playHint.textContent = 'POINT PHONE DOWN TO RELOAD';
      playHint.classList.add('reload-hint');
    } else {
      playHint.textContent = 'TAP ANYWHERE TO FIRE';
      playHint.classList.remove('reload-hint');
    }
  }

  function enterPlayingState() {
    appState = 'playing';
    showScreen('play');
    ammo = AMMO_MAX;
    reloadHoldStartedAt = null;
    updateAmmoUi();
    if (sendIntervalId) clearInterval(sendIntervalId);
    sendIntervalId = setInterval(tick, SEND_INTERVAL_MS);
  }

  function calibrate() {
    if (!latestOrientation) return;
    baseline = azimuthElevation(pointingVector(latestOrientation));
    enterPlayingState();

    if (!hasCalibratedOnce) {
      hasCalibratedOnce = true;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: PROTOCOL.MSG_CALIBRATED }));
      }
    }
  }

  // --- Per-tick aim computation ---

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  function tick() {
    if (!latestOrientation || !baseline) return;

    var ae = azimuthElevation(pointingVector(latestOrientation));
    var deltaPan = angleDelta(ae.azimuth, baseline.azimuth);
    var deltaTilt = ae.elevation - baseline.elevation;

    if (ammo <= 0) {
      if (deltaTilt <= RELOAD_TILT_DELTA_DEG) {
        if (reloadHoldStartedAt === null) reloadHoldStartedAt = performance.now();
        else if (performance.now() - reloadHoldStartedAt >= RELOAD_HOLD_MS) {
          ammo = AMMO_MAX;
          reloadHoldStartedAt = null;
          updateAmmoUi();
        }
      } else {
        reloadHoldStartedAt = null;
      }
    }

    // Derived signs (verified against the pointing-vector math): turning the
    // phone right decreases azimuth, so aimX moves the opposite way from
    // deltaPan by default; pointing more upward increases elevation, so
    // aimY (0=top) also moves the opposite way from deltaTilt by default.
    var panSign = invertPan ? 1 : -1;
    var tiltSign = invertTilt ? 1 : -1;

    var aim = {
      x: clamp01(0.5 + panSign * (deltaPan / AIM_RANGE_DEG) * 0.5),
      y: clamp01(0.5 + tiltSign * (deltaTilt / AIM_RANGE_DEG) * 0.5)
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

  recalibrateBtn.addEventListener('click', function () {
    if (sendIntervalId) { clearInterval(sendIntervalId); sendIntervalId = null; }
    appState = 'calibrating';
    showScreen('calibrate');
    requestAnimationFrame(updateCalibrateReadout);
  });

  function updateInvertButtonLabels() {
    invertPanBtn.textContent = 'Pan: ' + (invertPan ? 'Inverted' : 'Normal');
    invertTiltBtn.textContent = 'Tilt: ' + (invertTilt ? 'Inverted' : 'Normal');
  }
  invertPanBtn.addEventListener('click', function () {
    invertPan = !invertPan;
    localStorage.setItem('lightgun_invertPan', invertPan ? '1' : '0');
    updateInvertButtonLabels();
  });
  invertTiltBtn.addEventListener('click', function () {
    invertTilt = !invertTilt;
    localStorage.setItem('lightgun_invertTilt', invertTilt ? '1' : '0');
    updateInvertButtonLabels();
  });
  updateInvertButtonLabels();

  fireCatcher.addEventListener('pointerdown', function () {
    if (appState !== 'playing') return;
    if (ammo <= 0) {
      blockedFlash.style.display = 'block';
      setTimeout(function () { blockedFlash.style.display = 'none'; }, 150);
      return;
    }
    var withinGracePeriod = performance.now() - lastGoodAimAt <= FIRE_GRACE_MS;
    if (!lastAim || !withinGracePeriod) {
      blockedFlash.style.display = 'block';
      setTimeout(function () { blockedFlash.style.display = 'none'; }, 150);
      return;
    }
    ammo--;
    updateAmmoUi();
    flashTorch();
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
