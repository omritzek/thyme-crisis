(function () {
  'use strict';

  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
  var TARGET_RADIUS = 50; // 30% smaller than the previous 72
  // Far-spawn enemies (TARGET_RADIUS * FAR_DEPTH_SCALE = 32.5) get clamped
  // up to this floor -- measured against reference objects in the actual
  // background photos (car rooflines ~1.5m, door frames ~2m) at the hide
  // spots' own depth: a human standing there comes out to roughly 60-70px
  // radius once converted to canvas scale, so this is 80% of that.
  var MIN_ENEMY_RADIUS = 56;
  var HIT_FORGIVENESS = 15;
  var HIT_HOLD_MS = 450; // how long a killed enemy stays fully visible (showing the hit sprite/flash) before it shrinks away
  var MISS_FLASH_MS = 300;
  var FLINCH_FLASH_MS = 120; // brief white tint on a non-lethal hit against a multi-hit enemy -- reuses each target's own flashUntil field, just for a much shorter beat than a real kill
  var SHIELD_BLOCK_MS = 250; // spark/clank effect duration when a shot lands on a raised shield

  // Fixed spots (as fractions of the canvas) where enemies pop up from,
  // keyed by the background image's filename so each level's spots line up
  // with that specific photo/art (a tree trunk, a bench, whatever's
  // actually there). DEFAULT_HIDE_SPOTS is the fallback for any background
  // that doesn't have its own tuned entry yet -- so dropping in a brand new
  // image still works out of the box, just with generic placement until
  // someone eyeballs it against that image and adds an entry below.
  //
  // A spot can optionally include `occluders`: rects (also canvas
  // fractions) that get re-painted from the background on top of the
  // enemy every frame, so something in the scene (a trunk, a post) reads as
  // being in front of it instead of the enemy just floating over
  // everything. Same eyeballing process as the spot position itself.
  //
  // All of this is eyeballed against each image, not pixel-measured, so
  // further nudges are expected.
  var DEFAULT_HIDE_SPOTS = [
    { x: 0.15, y: 0.70 },
    { x: 0.35, y: 0.35 },
    { x: 0.60, y: 0.25 },
    { x: 0.85, y: 0.45 },
    { x: 0.12, y: 0.80 },
    { x: 0.85, y: 0.80 }
  ];

  // All 7 background images share the same 1445x1088 native size, cover-fit
  // into the 1280x720 canvas -- since that's narrower/taller than 16:9, the
  // fit is width-bound and crops ~12.65% off both the top and bottom of the
  // original photo. Every y below already has that crop folded in (spots
  // were placed by eye against the source photo, then converted with
  // canvasY = (photoY - 0.1265) / 0.747), so they line up with what's
  // actually visible on the fixed 1280x720 canvas, not the original image.
  var BACKGROUND_HIDE_SPOTS = {
    '1 - behind-matilda.png': [ // tree-lined street, cars parked along the curb
      { x: 0.10, y: 0.39 }, // foreground tree trunk, left
      { x: 0.22, y: 0.26 }, // second trunk, further back
      { x: 0.42, y: 0.63 }, // pedestrian info sign board, center
      { x: 0.50, y: 0.71 }, // first parked car
      { x: 0.66, y: 0.77 }, // car further down the row
      { x: 0.80, y: 0.82 }  // car nearest camera, right
    ],
    '2 - magen.png': [ // courtyard with a pergola, pillars, and bollards
      { x: 0.05, y: 0.70 }, // huge foreground tree trunk, far left
      { x: 0.16, y: 0.57 }, // left pergola pillar
      { x: 0.50, y: 0.57 }, // right pergola pillar
      { x: 0.44, y: 0.90 }, // round bollard cluster, foreground
      { x: 0.76, y: 0.50 }, // cluster of thin tree trunks, right
      { x: 0.90, y: 0.61 }  // picnic table, far right
    ],
    '3 - bney efrayim.png': [ // narrow backyard alley behind a low wall
      { x: 0.05, y: 0.57 }, // foreground tree trunk, left edge
      { x: 0.30, y: 0.50 }, // white door / wall section
      { x: 0.60, y: 0.57 }, // concrete block wall, right of the doorway
      { x: 0.78, y: 0.43, occluders: [{ x: 0.765, y: 0.15, w: 0.025, h: 0.35 }] }, // yellow sign post
      { x: 0.68, y: 0.23 }, // flowering bush, upper right
      { x: 0.72, y: 0.66 }  // ground clutter/rubble pile
    ],
    '4 - mf.png': [ // parking area beside a graffitied wall
      { x: 0.15, y: 0.74 }, // parked white car, foreground
      { x: 0.28, y: 0.63 }, // parked dark car, further back
      { x: 0.22, y: 0.57, occluders: [{ x: 0.205, y: 0.0, w: 0.03, h: 0.9 }] }, // thick utility pole, foreground
      { x: 0.42, y: 0.61 }, // corner of the graffitied wall
      { x: 0.75, y: 0.43 }, // bougainvillea bush, right
      { x: 0.90, y: 0.57 }  // blank wall section, far right
    ],
    '5 - trees.png': [ // paved plaza with large tree trunks and a lamp post
      { x: 0.05, y: 0.57, occluders: [{ x: 0.04, y: 0.10, w: 0.02, h: 0.64 }] }, // lamp post, far left
      { x: 0.27, y: 0.57 }, // twisted tree trunk, left-of-center
      { x: 0.68, y: 0.66 }, // trash bin, center
      { x: 0.82, y: 0.74 }, // massive foreground trunk, right
      { x: 0.55, y: 0.39 }, // small background trees, center
      { x: 0.95, y: 0.47 }  // second lamp post, far right
    ],
    '6 - house.png': [ // apartment building entrance framed by trees/bushes
      { x: 0.22, y: 0.83 }, // diagonal tree trunk, center-left
      { x: 0.10, y: 0.66 }, // bush cluster, left of the entrance
      { x: 0.63, y: 0.66 }, // large bush, right of the doorway
      { x: 0.35, y: 0.74 }, // red mailbox, near the door
      { x: 0.85, y: 0.63 }, // bush near the right building corner
      { x: 0.50, y: 0.70 }  // lit doorway itself
    ]
    // '7 - ganash.png' has no entry: it's the boss level's backdrop, and
    // the boss (spawnBoss) stands at a fixed center-arena position rather
    // than using hide spots at all -- hideSpotsForBg is never even called
    // for it in practice.
  };

  function hideSpotsForBg(bg) {
    if (bg && BACKGROUND_HIDE_SPOTS[bg.name]) return BACKGROUND_HIDE_SPOTS[bg.name];
    return DEFAULT_HIDE_SPOTS;
  }
  var POP_UP_MS = 180;
  var POP_DOWN_MS = 150;
  var SPAWN_INTERVAL_MS = 5000; // a new enemy attempts to appear on this fixed cadence, capped by MAX_CONCURRENT_ENEMIES
  var MAX_CONCURRENT_ENEMIES = 3; // how many regular enemies/decoys can be on screen at once -- they no longer disappear on their own once they fire, so this caps how much can pile up
  var STARTING_LIVES = 3;
  var DAMAGE_FLASH_MS = 400;
  var ENEMY_MUZZLE_FLASH_MS = 350;
  var ROUND_END_DISPLAY_MS = 4500;
  var ENEMIES_TO_CLEAR = 3; // defeat this many as a group to clear the level -- recomputed per level, see enemiesToClearForLevel
  var levelTimeLimitAt = null; // gameNow() timestamp the current level's timer expires at; null = untimed (timer off, or the boss level)

  // Depth ("far" vs "close") is derived from a hide spot's y position rather
  // than tracked as its own field: spots lower in frame (tunnel opening,
  // benches) read as foreground, spots higher up (dome roof, climbing panel)
  // read as background, so scaling off y alone already matches the art's
  // perspective. Far enemies render small and take longer to fire back;
  // close ones render big and react fast -- a small target you have more
  // time to line up vs. a big one you have to snap-shoot.
  var FAR_DEPTH_SCALE = 0.65;
  var NEAR_DEPTH_SCALE = 1.3;
  var FAR_LIFETIME_MS = 3600;
  var NEAR_LIFETIME_MS = 2200;
  var LEVEL_INTRO_MS = 1100; // dolly-zoom + "LEVEL N" card shown when a new level begins

  // Difficulty scaling by level (1-indexed; currentLevelIndex + 1). Each
  // mechanic unlocks at its own level and then intensifies further, rather
  // than all four showing up at once on level 1 -- movement first, then
  // tougher (multi-hit) enemies, then decoys, then shields, each getting
  // its own "introduction" before the next stacks on top.
  function levelNumberFor(levelIndex) { return levelIndex + 1; }

  // Enemies drift in a small bounded loop around their hide spot once
  // visible (see updateGame) instead of standing dead still. Capped small
  // on purpose: a spot's `occluders` (e.g. a tree trunk redrawn in front of
  // it) are fixed to the hide spot's own position, not the enemy's current
  // drifted position, so too large a drift would visibly wander out from
  // behind them.
  function driftAmplitudeForLevel(level) {
    if (level < 2) return 0;
    return Math.min(18 + (level - 2) * 6, 46);
  }
  function driftSpeedForLevel(level) {
    return 0.0012 + Math.min(level, 8) * 0.00025;
  }

  // Hits required to put an enemy down -- keyed by enemy TYPE (the sprite
  // filename's stem, same per-filename tuning convention as
  // BACKGROUND_HIDE_SPOTS) rather than by level: "arsketer" is the buffed
  // version of "arsnormal", needing more hits to put down regardless of
  // what level it shows up on. Any unrecognized name, or the built-in
  // drawn face if no sprites are loaded at all, is just a normal 1-hit
  // enemy. Flinches (a brief white tint, without ducking down) on every
  // hit short of the last one.
  var ENEMY_TYPE_HITS_TO_KILL = { arsketer: 3 };
  var DEFAULT_ENEMY_HITS_TO_KILL = 1;
  function hitsToKillForEnemyName(name) {
    return (name && ENEMY_TYPE_HITS_TO_KILL[name]) || DEFAULT_ENEMY_HITS_TO_KILL;
  }

  // How often the buffed type is picked over a normal one when both are
  // present in the loaded sprite pool (see pickEnemySprite) -- ramps up by
  // level and by the chosen difficulty, so early/easy levels lean toward
  // the weaker sprite even with the tougher one sitting right there in the
  // folder. Level 1 is always 0% regardless of difficulty -- the very
  // first level should only ever show arsnormal, so the group meets the
  // tougher enemy for the first time on level 2, not immediately.
  function arsketerChanceForLevel(level) {
    if (level < 2) return 0;
    var base = Math.min(0.1 + (level - 2) * 0.12, 0.65);
    return Math.min(base + DIFFICULTY_ARSKETER_BONUS[difficulty], 0.85);
  }

  // Shields cycle guarded <-> exposed on a fixed rhythm (same timing every
  // time, just a shorter exposed window at higher levels) rather than a
  // randomized one -- a learnable beat instead of a pure reflex check.
  var SHIELD_GUARDED_MS = 1300;
  function shieldChanceForLevel(level) {
    if (level < 5) return 0;
    return Math.min(0.35 + (level - 5) * 0.12, 0.85);
  }
  function shieldExposedMsForLevel(level) {
    return Math.max(350, 900 - (level - 5) * 120);
  }

  // Decoys (cats) spawn in place of a real enemy at some of the spawn
  // slots -- shooting one costs the shooter a life instead of scoring, and
  // doesn't count toward clearing the level, so ignoring it is always the
  // safe choice.
  function decoyChanceForLevel(level) {
    if (level < 4) return 0;
    return Math.min(0.18 + (level - 4) * 0.08, 0.4);
  }

  // --- Difficulty (chosen by clicking the controls drawn in the ready-up
  // lobby -- see drawDifficultyControls/handleLobbyClick -- while players
  // are joining and calibrating, right up until the round actually
  // starts) ---
  var difficulty = 'normal'; // 'easy' | 'normal' | 'hard'
  var timerEnabled = true;
  var DIFFICULTY_ENEMY_COUNT_MULTIPLIER = { easy: 0.75, normal: 1, hard: 1.4 };
  var DIFFICULTY_ARSKETER_BONUS = { easy: 0, normal: 0.08, hard: 0.2 };
  var DIFFICULTY_TIME_PER_ENEMY_MS = { easy: 12000, normal: 9000, hard: 6500 };
  var ENEMIES_PER_EXTRA_PLAYER = 2; // each player beyond the first adds this many to the level's target

  // How many currently-logged-in players count toward "more players, more
  // enemies" -- recomputed at the start of every level (not cached once),
  // so a player joining mid-run raises the very next level's count too.
  function countActivePlayers() {
    var n = 0;
    players.forEach(function (p) { if (p.loggedIn) n++; });
    return n;
  }

  // The enemy-count "benchmark": a gently-increasing per-level baseline
  // (level 1:3, 2:4, 3:6, 4:7, ...), scaled by difficulty, plus a flat
  // bonus per extra player. Only used for regular levels -- the boss fight
  // has its own HP-based clear condition instead.
  function enemiesToClearForLevel(level, playerCount) {
    var base = 3 + Math.floor((level - 1) * 1.5);
    var scaled = Math.round(base * DIFFICULTY_ENEMY_COUNT_MULTIPLIER[difficulty]);
    var playerBonus = Math.max(0, playerCount - 1) * ENEMIES_PER_EXTRA_PLAYER;
    return Math.max(1, scaled + playerBonus);
  }

  // The level timer is derived from how many enemies must be cleared
  // (itself already shaped by level/difficulty/player-count) rather than a
  // flat per-level number, so a level padded out by a bigger group or a
  // harder difficulty setting gets proportionally more time instead of the
  // same fixed clock regardless of how much bigger the ask just got.
  function levelTimeLimitMs(enemyCount) {
    return enemyCount * DIFFICULTY_TIME_PER_ENEMY_MS[difficulty];
  }

  var pairingEl = document.getElementById('pairing');
  var stageEl = document.getElementById('stage');
  var startGameBtn = document.getElementById('startGameBtn');
  var pairingPanelEl = document.getElementById('pairingPanel');
  var pairingHintEl = document.getElementById('pairingHint');
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
  var targets = []; // regular (non-boss) enemies/decoys currently on screen -- see MAX_CONCURRENT_ENEMIES
  var bossTarget = null; // the final boss, kept separate from targets since its lifecycle (updateBossFight) is a different shape entirely
  var nextSpawnAt = 0;
  var missFlashes = [];
  var muzzleFlashes = []; // enemy fired-back effects, at the enemy's position
  var hitBurstFlashes = []; // bright burst at the impact point on a successful hit
  var HIT_BURST_MS = 300;
  var shieldBlockFlashes = []; // spark/clank effect where a shot was blocked by a raised shield
  var damageFlashUntil = 0;
  var roundResult = null; // null while playing, else 'cleared' | 'game_over'
  var roundResultAt = 0;
  var paired = false;
  var roundStarted = false; // true once every logged-in player has shot the lobby's START target (see maybeStartRound) -- enemies only start spawning after this

  // Generic cutscene player -- an image with a streaming typewriter line
  // over it, tap-to-fast-forward-then-continue. Deliberately has no
  // auto-advance: it waits indefinitely for a player to fire, however long
  // that takes, rather than timing out on its own -- used for both the
  // opening villain monologue (see maybeStartRound) and the boss-defeat
  // ending (see updateBossFight). Only one plays at a time; activeCutscene
  // is null whenever none is showing.
  var activeCutscene = null; // { img, text, startedAt, onDone }
  var CUTSCENE_CHAR_MS = 35; // typewriter reveal speed

  // The opening villain-monologue cutscene: plays once, the first time
  // maybeStartRound's ready-up gate is satisfied, before the round actually
  // begins (see beginRound). introCutscenePlayed guards against replaying it
  // on a later level -- only showPairing() (a real return to the pairing
  // screen) resets it, so it's once per game session, not once per level.
  var introCutscenePlayed = false;
  var INTRO_TEXT = "hahaha, i've kidnapped Shira, and you'll never catch me! I've sent my minions to make sure you never get to me and never get the girl!";

  // The final boss: a taunt cutscene right before the fight (bossActive is
  // set true, and boss music takes over, as soon as this begins -- see the
  // roundResult resolution in updateGame -- not just once the fight
  // itself starts), then a chained sequence of ending cutscenes once he's
  // defeated (see updateBossFight and playCutsceneSequence): one line per
  // image found in public/display/assets/cutscenes/outro/, played in
  // sorted-filename order (him defeated, then the group's celebration,
  // then whatever else -- e.g. a "to be continued" hook -- is dropped in
  // there), before finally returning everyone to the pairing screen. If
  // there turn out to be more images than lines here, the extras just play
  // with no text; see playCutsceneSequence.
  var BOSS_LEVEL = 7; // 6 regular levels (one per non-boss background), boss is the 7th
  var BOSS_MAX_HP = 20;
  var BOSS_RADIUS_SCALE = 2.4;
  var BOSS_GUARDED_MS = 1100;
  var BOSS_PHASE_CARD_MS = 1800;
  var BOSS_INTRO_TEXT = "Look who showed up! You'll never stop me now that I'm in my final form!";
  var BOSS_OUTRO_TEXTS = [
    "No! This isn't possible! I was supposed to be unstoppable in my final form...",
    "And now the group can enjoy their celebrations, knowing that everything is alright!",
    "Or is it...?"
  ];
  var bossActive = false; // true only while the boss level's fight is in progress
  var bossPhaseCardUntil = 0;

  // Levels: currentLevelIndex just counts up (level N = index N-1); which
  // background image it maps to wraps modulo however many are actually
  // available, so this keeps climbing even with only one image loaded.
  var currentLevelIndex = 0;
  var levelIntroStartedAt = 0;
  var levelIntroUntil = 0;

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

  // Background images — one per level. Whatever's sitting in
  // public/display/assets/backgrounds/ (any names, don't have to be exactly
  // "playground.jpg"), sorted, becomes an ordered list of level backdrops;
  // clearing a level advances to the next one, wrapping back to the first.
  // With only one image present, levels still advance (same backdrop, but a
  // fresh transition + higher level number) -- dropping in more images later
  // is enough to give later levels their own backdrop, no code change
  // needed. Falls back to a plain dark background if none are found.
  var bgImages = []; // [{ img, ready, name }] -- name is the plain filename, used to look up that level's hide spots
  fetch('/api/background-image')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      console.log('[background] /api/background-image ->', data);
      (data.urls || []).forEach(function (url) {
        var name = decodeURIComponent(url.split('/').pop());
        var entry = { img: new Image(), ready: false, name: name };
        entry.img.onload = (function (e) { return function () { e.ready = true; }; })(entry);
        entry.img.onerror = function () { console.error('[background] image failed to load:', url); };
        entry.img.src = url;
        bgImages.push(entry);
      });
    })
    .catch(function (err) { console.error('[background] fetch failed:', err); });

  function currentBg() {
    if (!bgImages.length) return null;
    return bgImages[currentLevelIndex % bgImages.length];
  }

  function stemFromUrl(url) {
    var filename = decodeURIComponent(url.split('/').pop());
    var dot = filename.lastIndexOf('.');
    return (dot > 0 ? filename.slice(0, dot) : filename).toLowerCase();
  }

  // Optional enemy sprite images — if the server finds any in
  // public/display/assets/enemies/, use those instead of the built-in
  // drawn face (see pickEnemySprite for how one's picked per spawn). Each
  // entry is { img, hitImgs, name }: hitImgs is the list of
  // "<name>-hit"/"<name>-hit<N>" companion files found for that sprite
  // (shown during the hit flash instead of the white-tint effect) -- one
  // is picked at random per hit (see handleFire), or none if there aren't
  // any for that sprite. `name` is the lowercased filename stem (e.g.
  // "arsketer"), used to look up that type's toughness -- see
  // hitsToKillForEnemyName. Falls back cleanly (drawTarget uses the drawn
  // face) if the list is empty or fails to load.
  var enemySprites = [];
  // A base sprite named exactly "cat" is reserved: it's not a spawnable
  // enemy at all (even though it lives in the same folder) -- it's the
  // decoy's own image, replacing drawBuiltInCat's drawn shape wherever a
  // decoy would otherwise be rendered. Kept out of enemySprites entirely
  // so it never gets picked by pickEnemySprite as if it were a real
  // arsnormal/arsketer-style enemy.
  var catDecoyImg = null;
  fetch('/api/enemy-sprites')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      console.log('[sprites] /api/enemy-sprites ->', data);
      (data.sprites || []).forEach(function (entry) {
        var img = new Image();
        var name = stemFromUrl(entry.base);
        if (name === 'cat') {
          img.onerror = function () { console.error('[sprites] cat decoy image failed to load:', entry.base); };
          img.src = entry.base;
          catDecoyImg = img;
          return;
        }
        var hitImgs = (entry.hits || []).map(function (hitUrl) {
          var hitImg = new Image();
          hitImg.onerror = function () { console.error('[sprites] hit image failed to load:', hitUrl); };
          hitImg.src = hitUrl;
          return hitImg;
        });
        img.onload = function () {
          enemySprites.push({ img: img, hitImgs: hitImgs, name: name });
          console.log('[sprites] loaded, pool size now', enemySprites.length, '-', entry.base);
        };
        img.onerror = function () { console.error('[sprites] base image failed to load:', entry.base); };
        img.src = entry.base;
      });
    })
    .catch(function (err) { console.error('[sprites] fetch failed:', err); });

  // Lobby/pairing-screen artwork -- same single-file convention as menu
  // music (public/display/assets/lobby/). Used both as the pairing screen's
  // CSS backdrop and as the canvas background for the "logged in / ready
  // up" screen shown once at least one phone has joined but the round
  // hasn't started. Letterboxed (not cropped) when drawn on the canvas --
  // see drawLobbyBackground -- since a poster-style image often has
  // text/logo near the edges.
  var lobbyImg = new Image();
  var lobbyImgReady = false;
  fetch('/api/lobby-image')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.url) return;
      lobbyImg.onload = function () {
        lobbyImgReady = true;
        pairingEl.style.backgroundImage =
          'linear-gradient(rgba(10,10,6,0.15), rgba(10,10,6,0.15)), url("' + data.url + '")';
        pairingEl.style.backgroundSize = 'contain';
        pairingEl.style.backgroundPosition = 'center';
        pairingEl.style.backgroundRepeat = 'no-repeat';
      };
      lobbyImg.onerror = function () { console.error('[lobby] image failed to load:', data.url); };
      lobbyImg.src = data.url;
    })
    .catch(function (err) { console.error('[lobby] fetch failed:', err); });

  // Opening villain-monologue cutscene artwork -- same single-file
  // convention (public/display/assets/cutscenes/intro/), just letterboxed
  // above the dialogue box instead of filling the frame. INTRO_TEXT itself
  // is set above with the other cutscene state, not fetched, since it's
  // narrative rather than swappable art. Readiness is just `naturalWidth >
  // 0` (no separate ready flag).
  var introImg = new Image();
  fetch('/api/intro-image')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.url) return;
      introImg.onerror = function () { console.error('[intro] image failed to load:', data.url); };
      introImg.src = data.url;
    })
    .catch(function (err) { console.error('[intro] fetch failed:', err); });

  // The boss-ending cutscene sequence's artwork, all from
  // public/display/assets/cutscenes/outro/ -- sorted filename order
  // becomes play order (e.g. "1 - sad cyborg.png" plays before "2 -
  // celebration.png"), same convention as background/level-music
  // ordering. Paired up with BOSS_OUTRO_TEXTS by index in
  // playCutsceneSequence -- however many images are actually present
  // (could be fewer or more than the text array), each just plays with
  // whatever line lines up with its position, or no line if it runs past
  // the end of BOSS_OUTRO_TEXTS.
  var outroImgs = [];
  fetch('/api/outro-images')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      (data.urls || []).forEach(function (url) {
        var img = new Image();
        img.onerror = function () { console.error('[outro] image failed to load:', url); };
        img.src = url;
        outroImgs.push(img);
      });
    })
    .catch(function (err) { console.error('[outro] fetch failed:', err); });

  // The boss's own in-fight sprite (public/display/assets/boss/) -- a
  // transparent-background character image, unlike the cutscene art (a
  // full backdrop scene), drawn via the same fit-to-radius logic as a
  // regular enemy sprite. Falls back to the intro cutscene's artwork, then
  // to the built-in drawn face, if nothing's dropped in here.
  var bossImg = new Image();
  fetch('/api/boss-sprite')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.url) return;
      bossImg.onerror = function () { console.error('[boss] sprite failed to load:', data.url); };
      bossImg.src = data.url;
    })
    .catch(function (err) { console.error('[boss] fetch failed:', err); });

  // Music -- same drop-in-folder convention as backgrounds/enemy sprites.
  // public/display/assets/music/menu/ supplies the pairing-screen theme
  // (just the first file, sorted, if more than one ever ends up there);
  // public/display/assets/music/levels/ supplies one loopable track per
  // level via the same sorted/wrapping-modulo scheme as bgImages, so a
  // single track just keeps looping until more are dropped in. Both fall
  // back to silence (no errors) if their folder is empty.
  var menuMusicUrls = [];
  var levelMusicUrls = [];
  var bossMusicUrls = [];
  var currentLevelMusicUrl = null; // randomly (re-)picked each time a new regular level begins -- see pickLevelMusic

  // Picks a fresh random track from levelMusicUrls for the level that's
  // just starting -- randomized rather than a fixed per-level mapping, so
  // replaying the same level number doesn't always play the same track.
  // Only called on an actual level transition (startNewGame), not every
  // time updateMusic() runs, so the track doesn't change mid-level.
  function pickLevelMusic() {
    currentLevelMusicUrl = levelMusicUrls.length ? levelMusicUrls[Math.floor(Math.random() * levelMusicUrls.length)] : null;
  }
  fetch('/api/menu-music')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      menuMusicUrls = data.urls || [];
      updateMusic();
    })
    .catch(function (err) { console.error('[music] menu fetch failed:', err); });
  fetch('/api/level-music')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      levelMusicUrls = data.urls || [];
      // Covers the race where this fetch resolves after a level has
      // already started (and startNewGame's own pick came up empty since
      // the list wasn't loaded yet) -- picks one now instead of playing
      // silence for the rest of that level.
      if (!currentLevelMusicUrl) pickLevelMusic();
      updateMusic();
    })
    .catch(function (err) { console.error('[music] level fetch failed:', err); });
  // public/display/assets/music/boss/ -- same single-file convention as
  // menu music, overriding the normal per-level rotation for the whole
  // boss level (taunt cutscene through the fight through both ending
  // cutscenes) -- see updateMusic and the BOSS_LEVEL transition in
  // updateGame.
  fetch('/api/boss-music')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      bossMusicUrls = data.urls || [];
      updateMusic();
    })
    .catch(function (err) { console.error('[music] boss fetch failed:', err); });

  // A tiny crossfading loop player so switching tracks (menu -> level 1,
  // level N -> level N+1, back to menu on disconnect) fades rather than
  // hard-cuts. Autoplay policies can silently reject the very first play()
  // call on this page before any real user gesture has happened on it (e.g.
  // music trying to start the instant the pairing screen loads) --
  // unlockMusicOnce retries once real input arrives, rather than every
  // caller needing to handle that itself.
  var MUSIC_CROSSFADE_MS = 700;
  var activeTrack = null; // { audio, url }
  var fadeTimers = [];

  function fadeVolume(audio, from, to, ms, onDone) {
    var steps = Math.max(1, Math.round(ms / 40));
    var step = 0;
    audio.volume = from;
    var id = setInterval(function () {
      step++;
      var t = Math.min(1, step / steps);
      audio.volume = from + (to - from) * t;
      if (t >= 1) {
        clearInterval(id);
        fadeTimers = fadeTimers.filter(function (x) { return x !== id; });
        if (onDone) onDone();
      }
    }, 40);
    fadeTimers.push(id);
  }

  function playTrack(url, volume) {
    if (activeTrack && activeTrack.url === url) return;
    var prev = activeTrack;
    if (url) {
      var audio = new Audio(url);
      audio.loop = true;
      audio.volume = 0;
      var playPromise = audio.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch(function () { /* blocked until a user gesture -- unlockMusicOnce retries it */ });
      }
      activeTrack = { audio: audio, url: url };
      fadeVolume(audio, 0, volume, MUSIC_CROSSFADE_MS);
    } else {
      activeTrack = null;
    }
    if (prev) {
      fadeVolume(prev.audio, prev.audio.volume, 0, MUSIC_CROSSFADE_MS, function () { prev.audio.pause(); });
    }
  }

  // Deliberately NOT { once: true } -- the first gesture on this page can
  // easily land before the music fetch even resolves (nothing to unlock
  // yet), which would burn a one-shot listener for nothing and leave every
  // later gesture unable to retry. Left permanently attached instead;
  // play()-ing an already-playing element is a harmless no-op, so this
  // costs nothing once audio is actually running.
  function retryBlockedMusic() {
    // The `!paused` check matters here: `paused` is the game's own Esc-pause
    // flag, which deliberately leaves activeTrack.audio paused too -- without
    // it, any keypress while the pause menu is up (not just Escape) would
    // resume the music underneath a still-paused game.
    if (activeTrack && activeTrack.audio.paused && !paused) activeTrack.audio.play().catch(function () {});
    // Same unlock story for the synthesized shot SFX (see playSfx) -- a
    // freshly-created AudioContext can start 'suspended' until a real
    // gesture resumes it; by the time any shot actually fires (well after
    // Start Game was clicked), this has almost always already run once.
    if (sfxAudioCtx && sfxAudioCtx.state === 'suspended') sfxAudioCtx.resume().catch(function () {});
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (evt) {
    window.addEventListener(evt, retryBlockedMusic);
  });

  // Picks whichever track should be playing right now given game state, and
  // hands it to playTrack (a no-op if it's already the active track).
  // Pairing/waiting-for-calibration both read as "menu" -- gameplay music
  // only kicks in once the round actually starts.
  var MENU_MUSIC_VOLUME = 0.5;
  var LEVEL_MUSIC_VOLUME = 0.45;
  function updateMusic() {
    if (paired && roundStarted) {
      // bossActive is set true (see the BOSS_LEVEL transition in
      // updateGame) as soon as the taunt cutscene begins, before the fight
      // itself starts, so boss music covers the whole thing -- falls back
      // to the normal per-level track if nothing's dropped into
      // music/boss/.
      var url = bossActive && bossMusicUrls.length ? bossMusicUrls[0] : currentLevelMusicUrl;
      playTrack(url, LEVEL_MUSIC_VOLUME);
    } else {
      playTrack(menuMusicUrls.length ? menuMusicUrls[0] : null, MENU_MUSIC_VOLUME);
    }
  }

  // Synthesized shot sound effects (Web Audio, no audio file needed) played
  // on the DISPLAY itself -- separate from the phone's own per-shooter
  // "pew" (public/phone/phone.js), which only that one player hears on
  // their own phone speaker. This is the shared TV/monitor's own sound, so
  // the whole room hears every shot fired, by a player or an enemy,
  // regardless of whose phone did the firing. Lazily created on first use
  // for the same reason phone.js does: browsers require an AudioContext to
  // start from within a real user-gesture call stack, and the display's
  // first shot never happens before some real interaction (Start Game,
  // joining, etc.) has already occurred on this page.
  var sfxAudioCtx = null;

  function playSfx(kind) {
    try {
      if (!sfxAudioCtx) sfxAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var t0 = sfxAudioCtx.currentTime;
      var osc = sfxAudioCtx.createOscillator();
      var gain = sfxAudioCtx.createGain();
      if (kind === 'enemyShot') {
        // Lower and a bit longer/harsher than the player's own shot, so the
        // two read as distinct even layered on top of each other.
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(420, t0);
        osc.frequency.exponentialRampToValueAtTime(70, t0 + 0.14);
        gain.gain.setValueAtTime(0.22, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
        osc.connect(gain);
        gain.connect(sfxAudioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.15);
      } else {
        // 'playerShot' -- same square-wave downward-sweep "pew" shape as
        // the phone's own shot sound, just a separate synth instance since
        // this one plays from the display's speakers instead.
        osc.type = 'square';
        osc.frequency.setValueAtTime(900, t0);
        osc.frequency.exponentialRampToValueAtTime(120, t0 + 0.09);
        gain.gain.setValueAtTime(0.2, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
        osc.connect(gain);
        gain.connect(sfxAudioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.1);
      }
    } catch (e) {
      // Sound is a nice-to-have, not required for gameplay -- fail silently.
    }
  }

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
    currentLevelIndex = 0;
    levelIntroUntil = 0;
    introCutscenePlayed = false;
    activeCutscene = null;
    bossActive = false;
    levelTimeLimitAt = null;
    pairingEl.classList.remove('hidden');
    stageEl.classList.add('hidden');
    // Back to the artwork-only start screen -- the code/QR panel only
    // reappears once Start Game is clicked again, rather than leaving a
    // stale session code exposed the instant a round is quit.
    startGameBtn.classList.remove('hidden');
    pairingPanelEl.classList.add('hidden');
    pairingHintEl.classList.add('hidden');
    updateMusic();
  }

  function showGame() {
    paired = true;
    pairingEl.classList.add('hidden');
    stageEl.classList.remove('hidden');
    updateMusic();
  }

  // Advances to the next level: bumps the level counter (background wraps
  // via currentBg()'s modulo regardless of how many images loaded) and
  // starts the on-screen dolly-zoom + "LEVEL N" intro that startNewGame's
  // spawn delay below waits out.
  function advanceLevel(now) {
    currentLevelIndex++;
    levelIntroStartedAt = now;
    levelIntroUntil = now + LEVEL_INTRO_MS;
    updateMusic();
  }

  function startNewGame(now) {
    roundResult = null;
    targets = [];
    bossTarget = null;
    nextSpawnAt = Math.max(now + 1000, levelIntroUntil + 400);
    enemiesDefeated = 0;
    var level = levelNumberFor(currentLevelIndex);
    bossActive = level === BOSS_LEVEL;
    if (bossActive) {
      levelTimeLimitAt = null; // the boss fight is untimed regardless of the timer toggle
    } else {
      ENEMIES_TO_CLEAR = enemiesToClearForLevel(level, countActivePlayers());
      levelTimeLimitAt = timerEnabled ? now + levelTimeLimitMs(ENEMIES_TO_CLEAR) : null;
      pickLevelMusic();
    }
    players.forEach(function (p) {
      p.lives = STARTING_LIVES;
      p.score = 0;
      p.shots = 0;
      p.out = false;
      p.outOfAmmo = false;
    });
  }

  function pauseGame() {
    if (!paired || !roundStarted || roundResult || paused) return;
    paused = true;
    pauseStartedAt = performance.now();
    pauseOverlayEl.classList.remove('hidden');
    if (activeTrack) activeTrack.audio.pause();
  }

  function resumeGame() {
    if (!paused) return;
    totalPausedMs += performance.now() - pauseStartedAt;
    paused = false;
    pauseOverlayEl.classList.add('hidden');
    if (activeTrack) activeTrack.audio.play().catch(function () {});
  }

  function restartGame() {
    pauseOverlayEl.classList.add('hidden');
    paused = false;
    currentLevelIndex = 0;
    levelIntroUntil = 0;
    startNewGame(gameNow());
    updateMusic();
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

  // Dev/test cheat (see the "win" keydown listener near init) -- instantly
  // clears whatever's currently in progress. On a regular level this is
  // just the normal clear flow fast-forwarded (same scoreboard, same
  // auto-advance). During the boss fight it finishes him off through the
  // real kill presentation (hit flash/hold, then pop-down into the ending
  // cutscene via updateBossFight) rather than jump-cutting straight to the
  // ending, so the rest of that flow doesn't need a separate code path.
  function cheatWinLevel() {
    // The activeCutscene check matters: without it, typing "win" during the
    // boss's outro cutscene would set a stray roundResult that races with
    // the cutscene's own quitToLobby (see updateBossFight) rather than
    // doing anything meaningful.
    if (!roundStarted || roundResult || activeCutscene) return;
    var now = gameNow();
    if (bossActive) {
      // Guards against the brief pre-spawn window (right as the boss
      // level's intro card is still showing) where bossActive is already
      // true but spawnBoss hasn't run yet -- force it so there's always a
      // target to finish off.
      if (!bossTarget) spawnBoss(now);
      bossTarget.hitsTaken = bossTarget.hitsToKill;
      bossTarget.state = 'hit';
      bossTarget.stateStartedAt = now;
      bossTarget.flashUntil = now + HIT_HOLD_MS;
      hitBurstFlashes.push({ x: bossTarget.x, y: bossTarget.y, expire: now + HIT_BURST_MS, scale: bossTarget.r / TARGET_RADIUS });
    } else {
      roundResult = 'cleared';
      roundResultAt = now;
      broadcastToPhones({ type: PROTOCOL.MSG_ROUND_ENDED, result: 'cleared' });
    }
  }

  // 0 (far/background) .. 1 (close/foreground), derived from the spot's y
  // position relative to the rest of that level's spots, with a little
  // jitter so the same spot doesn't play identically every time.
  function depthFactorForSpot(spot, spots) {
    var ys = spots.map(function (s) { return s.y; });
    var yMin = Math.min.apply(null, ys);
    var yMax = Math.max.apply(null, ys);
    var span = yMax - yMin;
    var t = span > 0 ? (spot.y - yMin) / span : 0.5;
    t += Math.random() * 0.16 - 0.08;
    return Math.max(0, Math.min(1, t));
  }

  // Splits the loaded sprite pool into "buffed" (named arsketer) and
  // "normal" (everything else), and weights the pick toward the buffed
  // pool by arsketerChanceForLevel -- falling back to whichever pool is
  // non-empty if only one type is loaded, so this works the same whether
  // the folder has just arsnormal, just arsketer, both, or some other
  // unrecognized-name sprite entirely (which just counts as normal).
  function pickEnemySprite(level) {
    if (!enemySprites.length) return null;
    var tough = enemySprites.filter(function (s) { return s.name === 'arsketer'; });
    var normal = enemySprites.filter(function (s) { return s.name !== 'arsketer'; });
    var pool = (tough.length && Math.random() < arsketerChanceForLevel(level)) ? tough
      : (normal.length ? normal : tough);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Which hide spots are already taken by a currently-active enemy/decoy --
  // spawnEnemy avoids these so two targets never land on the exact same
  // spot at once.
  function occupiedSpotIndices() {
    return targets.map(function (t) { return t.spotIndex; });
  }

  function spawnEnemy(now) {
    var level = levelNumberFor(currentLevelIndex);
    var spots = hideSpotsForBg(currentBg());
    var occupied = occupiedSpotIndices();
    var available = [];
    spots.forEach(function (s, i) { if (occupied.indexOf(i) === -1) available.push(i); });
    if (!available.length) return; // every spot's already got someone in it -- try again next spawn tick
    var idx = available[Math.floor(Math.random() * available.length)];
    var spot = spots[idx];
    var depthT = depthFactorForSpot(spot, spots);
    var depthScale = FAR_DEPTH_SCALE + (NEAR_DEPTH_SCALE - FAR_DEPTH_SCALE) * depthT;
    // Doubles as both the initial "how long before its first shot" delay
    // and (see updateGame) the cooldown between every attack after that --
    // far spawns stay slower/safer, near ones stay snap-shoot fast, for as
    // long as the enemy is alive rather than just for one shot.
    var attackIntervalMs = FAR_LIFETIME_MS + (NEAR_LIFETIME_MS - FAR_LIFETIME_MS) * depthT;

    // A decoy replaces the slot entirely (not an extra spawn on top) -- it
    // still occupies the level's spawn cadence, so checking each target
    // before firing costs pace, not just risk. Shields never apply to
    // decoys (they're a one-shot "don't shoot me", not a tougher enemy).
    var isDecoy = Math.random() < decoyChanceForLevel(level);
    var isShielded = !isDecoy && Math.random() < shieldChanceForLevel(level);
    var pickedSprite = isDecoy ? null : pickEnemySprite(level);

    targets.push({
      spotIndex: idx,
      x: spot.x * W,
      y: spot.y * H,
      baseX: spot.x * W,
      baseY: spot.y * H,
      // Clamped up to MIN_ENEMY_RADIUS -- a far-spawn enemy at the raw
      // FAR_DEPTH_SCALE was small enough to be genuinely hard to land a
      // shot on.
      r: Math.max(TARGET_RADIUS * depthScale, MIN_ENEMY_RADIUS),
      state: 'popping-up',
      stateStartedAt: now,
      firesAt: now + attackIntervalMs,
      attackIntervalMs: attackIntervalMs,
      flashUntil: 0,
      sprite: pickedSprite,
      occluders: spot.occluders || null,
      isDecoy: isDecoy,
      isShielded: isShielded,
      hitsTaken: 0,
      hitsToKill: isDecoy ? 1 : hitsToKillForEnemyName(pickedSprite && pickedSprite.name),
      driftAmp: driftAmplitudeForLevel(level) * depthScale,
      driftSpeed: driftSpeedForLevel(level),
      driftPhaseX: Math.random() * Math.PI * 2,
      driftPhaseY: Math.random() * Math.PI * 2,
      shieldGuardedMs: SHIELD_GUARDED_MS,
      shieldExposedMs: shieldExposedMsForLevel(level)
    });
  }

  // Shield state is derived from elapsed time rather than stored/advanced
  // per frame -- a fixed guarded/exposed rhythm from the moment the enemy
  // becomes 'visible' (t.stateStartedAt doesn't change again until it's
  // actually killed), so this is always correct however often it's checked.
  function targetShieldState(t, now) {
    if (!t || !t.isShielded) return 'exposed';
    var cycle = t.shieldGuardedMs + t.shieldExposedMs;
    var phase = (now - t.stateStartedAt) % cycle;
    return phase < t.shieldGuardedMs ? 'guarded' : 'exposed';
  }

  // Shared by both a regular enemy's drift (updateGame) and the boss's
  // (updateBossFight) -- a small bounded wobble around the target's own
  // fixed base position, via two out-of-phase sines so it reads as a
  // wander rather than a straight back-and-forth.
  function applyTargetDrift(t, now) {
    if (!t || t.driftAmp <= 0) return;
    var dt = now - t.stateStartedAt;
    t.x = t.baseX + Math.sin(dt * t.driftSpeed + t.driftPhaseX) * t.driftAmp;
    t.y = t.baseY + Math.sin(dt * t.driftSpeed * 1.3 + t.driftPhaseY) * t.driftAmp * 0.6;
  }

  // Players still in the round (!out) who are also exposed (!inCover) --
  // taking cover (see MSG_COVER_STATUS) makes a player safe from
  // enemy/boss fire-back entirely, not just less likely to be picked.
  function vulnerablePlayerIds() {
    var ids = [];
    players.forEach(function (p, pid) { if (!p.out && !p.inCover) ids.push(pid); });
    return ids;
  }

  // Up to `count` distinct random picks from `pool` -- used for a regular
  // enemy's single fire-back victim and the boss's double one. Naturally
  // returns fewer than `count` (down to none) if the pool's smaller, e.g.
  // everyone but one player is in cover.
  function pickRandomVictims(pool, count) {
    var copy = pool.slice();
    var picks = [];
    while (copy.length && picks.length < count) {
      picks.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    }
    return picks;
  }

  // Shared by a regular enemy's fire-back and the boss's attack: applies a
  // life loss to each victim, tells anyone who just ran out they're out,
  // and checks for a round-ending wipe. Returns whether anyone was
  // actually hit, so callers can skip the "you got hurt" red flash when an
  // attack lands on nobody (everyone was in cover).
  function applyFireBackDamage(victims, now) {
    victims.forEach(function (victimId) {
      var victim = players.get(victimId);
      victim.lives--;
      if (victim.lives <= 0) {
        victim.out = true;
        sendToPhone(victimId, { type: PROTOCOL.MSG_YOU_ARE_OUT });
      } else {
        sendToPhone(victimId, { type: PROTOCOL.MSG_PLAYER_HIT });
      }
    });
    if (victims.length) checkRoundEnd(now);
    return victims.length > 0;
  }

  // The final boss: a persistent target (no pop-up/pop-down spawn cadence)
  // that stands center-arena rather than at one of the background's hide
  // spots, always shielded, and escalates through 3 phases as its HP drops
  // (see updateBossFight) instead of the usual single fire-back-then-duck
  // lifecycle. hitsTaken/hitsToKill double as its HP/max-HP -- same fields
  // a multi-hit regular enemy uses, so handleFire's hit resolution and
  // drawBossHealthBar both just read them directly.
  function bossDriftAmpForPhase(phase) { return [26, 46, 70][phase - 1]; }
  function bossExposedMsForPhase(phase) { return [750, 550, 380][phase - 1]; }
  function bossAttackIntervalForPhase(phase) { return [4200, 3200, 2400][phase - 1]; }

  function spawnBoss(now) {
    var baseX = W / 2;
    var baseY = H * 0.46;
    bossTarget = {
      x: baseX,
      y: baseY,
      baseX: baseX,
      baseY: baseY,
      r: TARGET_RADIUS * BOSS_RADIUS_SCALE,
      state: 'popping-up',
      stateStartedAt: now,
      flashUntil: 0,
      occluders: null,
      isDecoy: false,
      isBoss: true,
      isShielded: true,
      hitsTaken: 0,
      hitsToKill: BOSS_MAX_HP,
      phase: 1,
      driftAmp: bossDriftAmpForPhase(1),
      driftSpeed: driftSpeedForLevel(BOSS_LEVEL),
      driftPhaseX: Math.random() * Math.PI * 2,
      driftPhaseY: Math.random() * Math.PI * 2,
      shieldGuardedMs: BOSS_GUARDED_MS,
      shieldExposedMs: bossExposedMsForPhase(1),
      nextAttackAt: 0 // set once it becomes 'visible'
    };
    bossPhaseCardUntil = now + BOSS_PHASE_CARD_MS;
  }

  function updateBossFight(now) {
    var t = bossTarget;
    if (t.state === 'visible') applyTargetDrift(t, now);

    if (t.state === 'popping-up' && now - t.stateStartedAt >= POP_UP_MS) {
      t.state = 'visible';
      t.nextAttackAt = now + bossAttackIntervalForPhase(t.phase);
      return;
    }

    if (t.state === 'visible') {
      var hpFrac = Math.max(0, 1 - t.hitsTaken / t.hitsToKill);
      var newPhase = hpFrac > 0.66 ? 1 : (hpFrac > 0.33 ? 2 : 3);
      if (newPhase !== t.phase) {
        t.phase = newPhase;
        t.driftAmp = bossDriftAmpForPhase(newPhase);
        t.shieldExposedMs = bossExposedMsForPhase(newPhase);
        bossPhaseCardUntil = now + BOSS_PHASE_CARD_MS;
      }

      if (now >= t.nextAttackAt) {
        // Same fire-back as a regular enemy's expiry, just repeating on a
        // cadence instead of happening once and ducking away, and hitting
        // up to 2 vulnerable players instead of 1 -- he's the final boss.
        muzzleFlashes.push({ x: t.x, y: t.y, expire: now + ENEMY_MUZZLE_FLASH_MS, scale: t.r / TARGET_RADIUS });
        playSfx('enemyShot');
        var bossVictims = pickRandomVictims(vulnerablePlayerIds(), 2);
        if (applyFireBackDamage(bossVictims, now)) damageFlashUntil = now + DAMAGE_FLASH_MS;
        t.nextAttackAt = now + bossAttackIntervalForPhase(t.phase);
      }
    } else if (t.state === 'hit' && now - t.stateStartedAt >= HIT_HOLD_MS) {
      t.state = 'popping-down';
      t.stateStartedAt = now;
    } else if (t.state === 'popping-down' && now - t.stateStartedAt >= POP_DOWN_MS) {
      bossTarget = null;
      bossActive = false;
      // The full ending sequence -- however many images actually turned up
      // in cutscenes/outro/ (him defeated, the celebration, maybe more) --
      // one after another, then back to the pairing screen.
      playCutsceneSequence(outroImgs, BOSS_OUTRO_TEXTS, now, quitToLobby);
    }
  }

  function targetScale(t, now) {
    if (!t) return 0;
    if (t.state === 'popping-up') return Math.min(1, (now - t.stateStartedAt) / POP_UP_MS);
    if (t.state === 'popping-down') return Math.max(0, 1 - (now - t.stateStartedAt) / POP_DOWN_MS);
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
    if (!roundStarted || roundResult) return;
    if (allPlayersOut()) {
      roundResult = 'game_over';
      roundResultAt = now;
      broadcastToPhones({ type: PROTOCOL.MSG_ROUND_ENDED, result: 'game_over' });
    }
  }

  var START_BUTTON_RADIUS = 70;
  function startButtonRect() {
    return { x: W / 2, y: H * 0.6, r: START_BUTTON_RADIUS };
  }

  // Difficulty/timer controls, drawn top-right of the ready-up lobby
  // (mirroring the roster's top-left position) and clicked with a mouse on
  // the display's own computer -- unlike everything else in the lobby,
  // this isn't phone-driven. Editable for as long as the lobby is showing,
  // i.e. right up until the round actually starts.
  var DIFFICULTY_BAR_X = 1010;
  var DIFFICULTY_BAR_Y = 40;
  var DIFFICULTY_BTN_W = 78;
  var DIFFICULTY_BTN_H = 32;
  var DIFFICULTY_BTN_GAP = 8;
  var TIMER_BTN_W = DIFFICULTY_BTN_W * 3 + DIFFICULTY_BTN_GAP * 2;
  var TIMER_BTN_H = 30;

  function difficultyButtonRects() {
    return ['easy', 'normal', 'hard'].map(function (d, i) {
      return {
        difficulty: d,
        x: DIFFICULTY_BAR_X + i * (DIFFICULTY_BTN_W + DIFFICULTY_BTN_GAP),
        y: DIFFICULTY_BAR_Y,
        w: DIFFICULTY_BTN_W,
        h: DIFFICULTY_BTN_H
      };
    });
  }

  function timerToggleRect() {
    return { x: DIFFICULTY_BAR_X, y: DIFFICULTY_BAR_Y + DIFFICULTY_BTN_H + 10, w: TIMER_BTN_W, h: TIMER_BTN_H };
  }

  function pointInRect(pt, r) {
    return pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;
  }

  // Maps a mouse event's page-space coordinates to the canvas's fixed
  // 1280x720 logical space -- the canvas is scaled to fit the window via
  // CSS (see resizeCanvasToWindow), so its on-screen size rarely matches
  // its drawing-buffer size 1:1.
  function canvasPointFromEvent(e) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (W / rect.width),
      y: (e.clientY - rect.top) * (H / rect.height)
    };
  }

  function handleLobbyClick(e) {
    if (!paired || roundStarted || activeCutscene) return;
    var pt = canvasPointFromEvent(e);
    var hitDifficulty = difficultyButtonRects().filter(function (btn) { return pointInRect(pt, btn); })[0];
    if (hitDifficulty) {
      difficulty = hitDifficulty.difficulty;
      return;
    }
    if (pointInRect(pt, timerToggleRect())) {
      timerEnabled = !timerEnabled;
    }
  }

  function beginRound(now) {
    roundStarted = true;
    startNewGame(now);
    updateMusic();
    broadcastToPhones({ type: PROTOCOL.MSG_ROUND_STARTED });
  }

  // Starts the shared cutscene player -- onDone(now) fires once, either
  // because the line finished and auto-advanced, or because someone tapped
  // through it. Only one cutscene plays at a time (activeCutscene is a
  // single slot, not a queue) -- playCutsceneSequence below is what chains
  // several of these end to end when needed.
  function playCutscene(img, text, now, onDone) {
    activeCutscene = { img: img, text: text, startedAt: now, onDone: onDone };
  }

  // Chains an arbitrary number of images through playCutscene one after
  // another -- texts[i] pairs with images[i] by index (no text at all,
  // just the art, if the sequence runs past the end of texts), and
  // onAllDone(now) fires once the last one finishes. Used for the boss's
  // ending sequence, whose length is however many images are actually
  // dropped into cutscenes/outro/ (see the outroImgs fetch), not a fixed
  // count.
  function playCutsceneSequence(images, texts, now, onAllDone) {
    // Driven by whichever is longer, not just images.length -- an empty
    // (or short) art folder still shows every line's text on a plain dark
    // background (see drawCutscene's fallback), same as any other
    // no-image cutscene, rather than silently skipping straight to
    // onAllDone.
    var count = Math.max(images.length, texts.length);
    if (!count) { onAllDone(now); return; }
    var i = 0;
    function playNext(playNow) {
      playCutscene(images[i] || null, texts[i] || '', playNow, function (doneNow) {
        i++;
        if (i < count) playNext(doneNow);
        else onAllDone(doneNow);
      });
    }
    playNext(now);
  }

  function finishCutscene(now) {
    var onDone = activeCutscene.onDone;
    activeCutscene = null;
    if (onDone) onDone(now);
  }

  // Fire during a cutscene skips it instead of resolving against anything
  // on screen: the first tap fast-forwards a still-streaming line to fully
  // revealed (so an eager tap doesn't blow straight past it unread), and
  // only a second tap (once it's already fully shown) actually ends it.
  function handleCutsceneFire() {
    if (!activeCutscene) return;
    var now = gameNow();
    var elapsed = now - activeCutscene.startedAt;
    var textDone = elapsed >= activeCutscene.text.length * CUTSCENE_CHAR_MS;
    if (!textDone) {
      activeCutscene.startedAt = now - activeCutscene.text.length * CUTSCENE_CHAR_MS;
    } else {
      finishCutscene(now);
    }
  }


  // Every calibrated (loggedIn), still-connected (!out) player counts
  // toward the denominator -- dynamic rather than a snapshot taken when the
  // lobby opened, so a player joining or leaving mid-lobby immediately
  // changes what "everyone" means, and a group that's already all-ready
  // starts the instant the last straggler either readies up or disconnects.
  function maybeStartRound(now) {
    if (roundStarted || activeCutscene) return;
    var loggedInCount = 0, readyCount = 0;
    players.forEach(function (p) {
      if (p.out || !p.loggedIn) return;
      loggedInCount++;
      if (p.readyForStart) readyCount++;
    });
    if (loggedInCount > 0 && readyCount >= loggedInCount) {
      if (introCutscenePlayed) {
        beginRound(now);
      } else {
        introCutscenePlayed = true;
        playCutscene(introImg, INTRO_TEXT, now, beginRound);
      }
    }
  }

  // Fire messages that land before the round has started are aimed at the
  // lobby's START target, not an enemy -- shooting it (once, per player)
  // marks that player ready and may kick off maybeStartRound. Mirrors
  // handleFire's hit/miss shape, reusing the same flash effects/constants
  // so a hit or miss reads exactly the same as it will once gameplay
  // actually starts.
  function handleLobbyFire(msg) {
    if (!paired || paused) return;
    var shooter = players.get(msg.playerId);
    if (!shooter || shooter.out) return;
    var px = msg.x * W;
    var py = msg.y * H;
    var now = gameNow();
    var btn = startButtonRect();
    if (shooter.loggedIn && !shooter.readyForStart) {
      var dx = px - btn.x;
      var dy = py - btn.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= btn.r + HIT_FORGIVENESS) {
        shooter.readyForStart = true;
        hitBurstFlashes.push({ x: btn.x, y: btn.y, expire: now + HIT_BURST_MS, scale: 1 });
        maybeStartRound(now);
        return;
      }
    }
    missFlashes.push({ x: px, y: py, expire: now + MISS_FLASH_MS });
  }

  function updateGame(now) {
    if (!roundStarted) return;
    // Freezes all game-timer processing while any cutscene is up --
    // critically, the boss taunt cutscene (which defers its own
    // startNewGame call to the cutscene's onDone): without this,
    // roundResult stays 'cleared' and roundResultAt stays in the past for
    // the cutscene's whole duration, so this function's own
    // ROUND_END_DISPLAY_MS check below would keep re-triggering every
    // single frame, calling advanceLevel() over and over and blowing
    // straight past BOSS_LEVEL before the cutscene even finishes -- which
    // is why the boss never actually spawned and the ending cutscene never
    // fired.
    if (activeCutscene) return;

    if (roundResult) {
      if (now - roundResultAt >= ROUND_END_DISPLAY_MS) {
        if (roundResult === 'cleared') advanceLevel(now);
        else currentLevelIndex = 0; // game over or timeout -- back to level 1

        if (levelNumberFor(currentLevelIndex) === BOSS_LEVEL) {
          // Set (and the music switched) before the cutscene starts, not
          // just once the fight itself begins, so boss music covers the
          // taunt too -- startNewGame recomputes the same bossActive value
          // once the cutscene finishes, which is harmless.
          bossActive = true;
          updateMusic();
          playCutscene(bossImg.naturalWidth > 0 ? bossImg : introImg, BOSS_INTRO_TEXT, now, function (doneNow) {
            startNewGame(doneNow);
            broadcastToPhones({ type: PROTOCOL.MSG_ROUND_STARTED });
          });
        } else {
          startNewGame(now);
          broadcastToPhones({ type: PROTOCOL.MSG_ROUND_STARTED });
        }
      }
      return;
    }

    if (levelTimeLimitAt !== null && now >= levelTimeLimitAt) {
      roundResult = 'timeout';
      roundResultAt = now;
      broadcastToPhones({ type: PROTOCOL.MSG_ROUND_ENDED, result: 'timeout' });
      return;
    }

    // A new enemy attempts to appear on a fixed cadence -- "attempts"
    // because it's also capped by MAX_CONCURRENT_ENEMIES and by every hide
    // spot already being occupied (see spawnEnemy), either of which just
    // silently skips this tick rather than erroring. The boss (on
    // BOSS_LEVEL) bypasses this cadence entirely: it spawns once and never
    // re-triggers here, since it doesn't disappear on its own -- bossTarget
    // only goes null once it's actually defeated (see updateBossFight).
    if (now >= nextSpawnAt) {
      if (bossActive) {
        nextSpawnAt = Infinity;
        if (!bossTarget) spawnBoss(now);
      } else {
        nextSpawnAt = now + SPAWN_INTERVAL_MS;
        if (targets.length < MAX_CONCURRENT_ENEMIES) spawnEnemy(now);
      }
    }

    if (bossTarget) updateBossFight(now);

    targets.forEach(function (t) {
      // Drift runs every frame while visible, independent of whichever
      // branch below fires this frame -- a small bounded wobble around the
      // hide spot's own (fixed) position rather than the enemy standing
      // dead still.
      if (t.state === 'visible') applyTargetDrift(t, now);

      if (t.state === 'popping-up' && now - t.stateStartedAt >= POP_UP_MS) {
        t.state = 'visible';
      } else if (t.state === 'visible' && now >= t.firesAt) {
        if (t.isDecoy) {
          // Not shot in time -- it was never a threat, so it just ducks
          // away harmlessly and leaves for good (no repeat-fire, unlike a
          // real enemy below).
          t.state = 'popping-down';
          t.stateStartedAt = now;
        } else {
          // Fires back at a random *vulnerable* player (not in cover) --
          // with several enemies and players and no notion of "who it was
          // aiming at", it's just a random pick. If everyone's in cover,
          // the shot lands on nobody. Unlike the old single-enemy design,
          // firing doesn't end this enemy's turn -- it stays fully in
          // play (still shootable) and just re-arms to fire again later,
          // the same repeating-attack model the boss already uses.
          muzzleFlashes.push({ x: t.x, y: t.y, expire: now + ENEMY_MUZZLE_FLASH_MS, scale: t.r / TARGET_RADIUS });
          playSfx('enemyShot');
          var victims = pickRandomVictims(vulnerablePlayerIds(), 1);
          if (applyFireBackDamage(victims, now)) damageFlashUntil = now + DAMAGE_FLASH_MS;
          t.firesAt = now + t.attackIntervalMs;
        }
      } else if (t.state === 'hit' && now - t.stateStartedAt >= HIT_HOLD_MS) {
        t.state = 'popping-down';
        t.stateStartedAt = now;
      }
    });

    targets = targets.filter(function (t) {
      return !(t.state === 'popping-down' && now - t.stateStartedAt >= POP_DOWN_MS);
    });
  }

  // Shooting a decoy is friendly fire on yourself: same life-loss/out/round-
  // end handling as an enemy's fire-back, just triggered by the shooter's
  // own shot instead of a timer expiring, and it doesn't touch score or
  // enemiesDefeated -- it was never a real kill.
  function resolveDecoyHit(t, shooterId, shooter, now) {
    t.state = 'popping-down';
    t.stateStartedAt = now;
    damageFlashUntil = now + DAMAGE_FLASH_MS;
    shooter.lives--;
    if (shooter.lives <= 0) {
      shooter.out = true;
      sendToPhone(shooterId, { type: PROTOCOL.MSG_YOU_ARE_OUT });
    } else {
      sendToPhone(shooterId, { type: PROTOCOL.MSG_PLAYER_HIT });
    }
    checkRoundEnd(now);
  }

  // Finds whichever visible target (boss or regular) a shot actually
  // landed on -- the boss and every entry in `targets` are all candidates,
  // and with several enemies now possibly on screen at once, picks the
  // *closest* one under the forgiveness radius rather than just the first
  // match, so an accidental overlap between two nearby enemies resolves
  // sensibly.
  function findHitTarget(px, py) {
    var candidates = [];
    if (bossTarget && bossTarget.state === 'visible') candidates.push(bossTarget);
    targets.forEach(function (t) { if (t.state === 'visible') candidates.push(t); });
    var best = null;
    var bestDist = Infinity;
    candidates.forEach(function (t) {
      var dx = px - t.x, dy = py - t.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= t.r + HIT_FORGIVENESS && dist < bestDist) {
        best = t;
        bestDist = dist;
      }
    });
    return best;
  }

  function handleFire(msg) {
    if (!roundStarted || roundResult || paused) return;
    var shooter = players.get(msg.playerId);
    if (!shooter || shooter.out) return;
    shooter.shots++;
    var px = msg.x * W;
    var py = msg.y * H;
    var now = gameNow();
    playSfx('playerShot');

    var t = findHitTarget(px, py);
    if (t) {
      if (t.isDecoy) {
        resolveDecoyHit(t, msg.playerId, shooter, now);
        return;
      }
      if (targetShieldState(t, now) === 'guarded') {
        // Blocked -- no damage, no progress, and deliberately not a
        // miss-flash either: the shot visually landed, it just didn't
        // get through, which is a different read than missing entirely.
        shieldBlockFlashes.push({ x: t.x, y: t.y, expire: now + SHIELD_BLOCK_MS, scale: t.r / TARGET_RADIUS });
        return;
      }
      t.hitsTaken++;
      if (t.hitsTaken < t.hitsToKill) {
        // Flinch, not a kill -- same white-tint flash a kill uses, just a
        // much shorter beat, and the target stays 'visible' (still
        // shootable, its fire-back timer keeps running) rather than
        // transitioning to 'hit'.
        t.flashUntil = now + FLINCH_FLASH_MS;
        return;
      }
      shooter.score++;
      t.flashUntil = now + HIT_HOLD_MS;
      t.state = 'hit';
      t.stateStartedAt = now;
      // Picked once, here, rather than re-rolled every frame the flash is
      // held -- otherwise a multi-pose sprite would flicker between poses.
      var hitPool = t.sprite ? t.sprite.hitImgs : null;
      t.hitImg = hitPool && hitPool.length ? hitPool[Math.floor(Math.random() * hitPool.length)] : null;
      hitBurstFlashes.push({ x: t.x, y: t.y, expire: now + HIT_BURST_MS, scale: t.r / TARGET_RADIUS });
      if (t.isBoss) {
        // No level-clear flow here -- updateBossFight finishes the
        // pop-down animation, then starts the ending cutscene itself.
      } else {
        enemiesDefeated++;
        if (enemiesDefeated >= ENEMIES_TO_CLEAR) {
          roundResult = 'cleared';
          roundResultAt = now;
          broadcastToPhones({ type: PROTOCOL.MSG_ROUND_ENDED, result: 'cleared' });
        }
      }
      return;
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
          players.set(joinedId, { color: playerColor(joinedId), lives: STARTING_LIVES, score: 0, shots: 0, out: false, outOfAmmo: false, loggedIn: false, readyForStart: false, inCover: false });
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
        maybeStartRound(gameNow()); // a straggler leaving can complete the remaining group's ready set
      } else if (msg.type === PROTOCOL.MSG_CALIBRATED) {
        // Marks this player "logged in" (shows their crosshair + roster row
        // and lets them shoot the START target) -- it does NOT start the
        // round by itself. The round only begins once every logged-in
        // player has also shot the target (see maybeStartRound), unless
        // it's already running (mid-round join), in which case this player
        // just jumps in with fresh stats like before.
        var calibratedId = msg.playerId;
        var calibratedPlayer = players.get(calibratedId);
        if (calibratedPlayer) {
          calibratedPlayer.lives = STARTING_LIVES;
          calibratedPlayer.score = 0;
          calibratedPlayer.shots = 0;
          calibratedPlayer.out = false;
          calibratedPlayer.outOfAmmo = false;
          calibratedPlayer.loggedIn = true;
          calibratedPlayer.inCover = false;
        }
      } else if (msg.type === PROTOCOL.MSG_AMMO_STATUS) {
        var ammoPlayer = players.get(msg.playerId);
        if (ammoPlayer) ammoPlayer.outOfAmmo = !!msg.empty;
      } else if (msg.type === PROTOCOL.MSG_COVER_STATUS) {
        var coverPlayer = players.get(msg.playerId);
        if (coverPlayer) coverPlayer.inCover = !!msg.inCover;
      } else if (msg.type === PROTOCOL.MSG_AIM) {
        var aiming = crosshairs.get(msg.playerId);
        if (aiming) {
          aiming.x = msg.x * W;
          aiming.y = msg.y * H;
          aiming.visible = true;
        }
      } else if (msg.type === PROTOCOL.MSG_FIRE) {
        if (activeCutscene) handleCutsceneFire();
        else if (roundStarted) handleFire(msg);
        else handleLobbyFire(msg);
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

  // Fits an image within roughly the built-in face's visual extent along its
  // longer axis, preserving its native aspect ratio (sprites aren't
  // necessarily square, e.g. a tall portrait crop) instead of stretching it
  // into one.
  function spriteFitSize(img, r) {
    var targetDim = r * 2.6;
    var maxDim = Math.max(img.naturalWidth, img.naturalHeight) || 1;
    var scale = targetDim / maxDim;
    return { dw: img.naturalWidth * scale, dh: img.naturalHeight * scale };
  }

  function drawSpriteEnemy(spriteEntry, r, flashing, hitImg) {
    if (flashing && hitImg && hitImg.naturalWidth > 0) {
      // A dedicated hit-reaction pose was picked for this hit — just show it, no tint needed.
      var hitSize = spriteFitSize(hitImg, r);
      ctx.drawImage(hitImg, -hitSize.dw / 2, -hitSize.dh / 2, hitSize.dw, hitSize.dh);
      return;
    }

    var size = spriteFitSize(spriteEntry.img, r);

    if (flashing) {
      spriteFlashCanvas.width = size.dw;
      spriteFlashCanvas.height = size.dh;
      spriteFlashCtx.drawImage(spriteEntry.img, 0, 0, size.dw, size.dh);
      spriteFlashCtx.globalCompositeOperation = 'source-atop';
      spriteFlashCtx.fillStyle = '#ffffff';
      spriteFlashCtx.fillRect(0, 0, size.dw, size.dh);
      spriteFlashCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(spriteFlashCanvas, -size.dw / 2, -size.dh / 2, size.dw, size.dh);
    } else {
      ctx.drawImage(spriteEntry.img, -size.dw / 2, -size.dh / 2, size.dw, size.dh);
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

  // A simple, obviously-not-an-enemy silhouette -- round head, pointed
  // ears, whiskers -- so a decoy reads as "don't shoot" at a glance rather
  // than needing to be studied. Never swapped for a sprite (decoys are a
  // core mechanic, not reskinnable enemy art).
  function drawBuiltInCat(r, flashing) {
    var fur = flashing ? '#ffffff' : '#c98a4b';
    var furShade = flashing ? '#eeeeee' : '#a86c34';
    var patch = flashing ? '#ffffff' : '#f0d9b5';

    ctx.beginPath();
    ctx.ellipse(0, r * 0.05, r * 0.62, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fillStyle = fur;
    ctx.fill();

    // ears
    [-1, 1].forEach(function (side) {
      ctx.beginPath();
      ctx.moveTo(side * r * 0.5, -r * 0.25);
      ctx.lineTo(side * r * 0.65, -r * 0.75);
      ctx.lineTo(side * r * 0.15, -r * 0.35);
      ctx.closePath();
      ctx.fillStyle = fur;
      ctx.fill();
    });

    // left-ear shading facet
    ctx.beginPath();
    ctx.moveTo(-r * 0.42, -r * 0.32);
    ctx.lineTo(-r * 0.5, -r * 0.6);
    ctx.lineTo(-r * 0.24, -r * 0.36);
    ctx.closePath();
    ctx.fillStyle = furShade;
    ctx.fill();

    // muzzle patch
    ctx.beginPath();
    ctx.ellipse(0, r * 0.28, r * 0.32, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = patch;
    ctx.fill();

    // eyes
    ctx.fillStyle = flashing ? '#999' : '#2a2015';
    [-1, 1].forEach(function (side) {
      ctx.beginPath();
      ctx.ellipse(side * r * 0.22, -r * 0.02, r * 0.07, r * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    // nose
    ctx.beginPath();
    ctx.moveTo(-r * 0.05, r * 0.18);
    ctx.lineTo(r * 0.05, r * 0.18);
    ctx.lineTo(0, r * 0.26);
    ctx.closePath();
    ctx.fillStyle = flashing ? '#ccc' : '#c96a6a';
    ctx.fill();

    // whiskers
    ctx.strokeStyle = flashing ? '#ddd' : 'rgba(40,30,20,0.6)';
    ctx.lineWidth = 1.5;
    [-1, 1].forEach(function (side) {
      for (var i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(side * r * 0.3, r * 0.22 + i * r * 0.06);
        ctx.lineTo(side * r * 0.85, r * 0.18 + i * r * 0.1);
        ctx.stroke();
      }
    });
  }

  // A raised riot-style shield drawn in front of the enemy while guarded;
  // drawn inside the same translate/scale/mirror transform as the enemy
  // itself, so it lines up and mirrors with it automatically. Not drawn at
  // all while exposed -- its absence IS the "shoot now" signal.
  function drawShieldOverlay(r) {
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.05, r * 0.75, r * 0.95, 0, 0, Math.PI * 2);
    var grad = ctx.createLinearGradient(0, -r, 0, r);
    grad.addColorStop(0, '#dfe8f2');
    grad.addColorStop(0.5, '#8ea3b8');
    grad.addColorStop(1, '#4c5b6b');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#2a333d';
    ctx.stroke();
    ctx.fillStyle = '#2a333d';
    [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.4], [0.3, 0.4]].forEach(function (p) {
      ctx.beginPath();
      ctx.arc(p[0] * r, p[1] * r, r * 0.05, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawOneTarget(t, now) {
    if (!t) return;
    var scale = targetScale(t, now);
    if (scale <= 0) return;
    var flashing = now < t.flashUntil;
    var r = t.r;
    // Regular enemies mirror to face whichever half of the screen they
    // spawned on; the boss stands center-arena and drifts across that
    // midline, so facing off its (frequently sign-flipping) x would flicker
    // it left/right constantly -- it just keeps one fixed facing instead.
    var dir = t.isBoss ? -1 : (t.x < W / 2 ? 1 : -1);

    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(dir * scale, scale); // mirror to face center, and grow/shrink for the pop-up/down animation

    if (t.isBoss) {
      if (bossImg.naturalWidth > 0) {
        drawSpriteEnemy({ img: bossImg, hitImgs: [] }, r, flashing, null);
      } else if (introImg.naturalWidth > 0) {
        drawSpriteEnemy({ img: introImg, hitImgs: [] }, r, flashing, null);
      } else {
        drawBuiltInFace(r, flashing);
      }
    } else if (t.isDecoy) {
      if (catDecoyImg && catDecoyImg.naturalWidth > 0) {
        drawSpriteEnemy({ img: catDecoyImg, hitImgs: [] }, r, flashing, null);
      } else {
        drawBuiltInCat(r, flashing);
      }
    } else if (t.sprite && t.sprite.img.naturalWidth > 0) {
      drawSpriteEnemy(t.sprite, r, flashing, t.hitImg);
    } else {
      drawBuiltInFace(r, flashing);
    }

    if (t.isShielded && t.state === 'visible' && targetShieldState(t, now) === 'guarded') {
      drawShieldOverlay(r);
    }

    ctx.restore();
  }

  // Draws every active target -- the boss (if any) plus each regular
  // enemy/decoy currently on screen, since more than one can now be up at
  // once.
  function drawTargets(now) {
    if (bossTarget) drawOneTarget(bossTarget, now);
    targets.forEach(function (t) { drawOneTarget(t, now); });
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
      var radius = (70 * (1 - t) + 20) * (f.scale || 1);
      ctx.beginPath();
      ctx.arc(f.x, f.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, ' + (0.5 * t) + ')';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255, 240, 160, ' + t + ')';
      ctx.stroke();
    });
  }

  function drawShieldBlockFlashes(now) {
    shieldBlockFlashes = shieldBlockFlashes.filter(function (f) { return f.expire > now; });
    shieldBlockFlashes.forEach(function (f) {
      var t = (f.expire - now) / SHIELD_BLOCK_MS; // 1 -> 0 over the effect's life
      var radius = (34 * (1 - t) + 8) * (f.scale || 1);
      ctx.beginPath();
      ctx.arc(f.x, f.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(180, 220, 255, ' + t + ')';
      ctx.lineWidth = 3;
      ctx.stroke();
      for (var i = 0; i < 5; i++) {
        var ang = (i / 5) * Math.PI * 2;
        var x2 = f.x + Math.cos(ang) * radius * 1.6;
        var y2 = f.y + Math.sin(ang) * radius * 1.6;
        ctx.beginPath();
        ctx.moveTo(f.x, f.y);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = 'rgba(255, 255, 200, ' + t + ')';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
  }

  function drawMuzzleFlashes(now) {
    muzzleFlashes = muzzleFlashes.filter(function (m) { return m.expire > now; });
    muzzleFlashes.forEach(function (m) {
      var t = (m.expire - now) / ENEMY_MUZZLE_FLASH_MS; // 1 -> 0 over the effect's life
      var radius = (46 * (1 - t) + 10) * (m.scale || 1);
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
    var headline = cleared ? ('LEVEL ' + (currentLevelIndex + 1) + ' CLEARED')
      : (roundResult === 'timeout' ? "TIME'S UP!" : 'GAME OVER');
    ctx.textAlign = 'center';
    ctx.font = '900 64px "Arial Black", Arial, sans-serif';
    ctx.fillStyle = cleared ? '#8fd94a' : '#d84a3a';
    ctx.fillText(headline, W / 2, 130);

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
    var nextText = cleared ? ('Advancing to Level ' + (currentLevelIndex + 2) + '…') : 'Returning to Level 1…';
    ctx.fillText(nextText, W / 2, startY + ranked.length * 44 + 30);
  }

  // Letterboxed (not cover-fit) on purpose -- see lobbyImg's comment at the
  // top of the file. Only a light tint on top (just enough for the roster
  // text/START target to read clearly) rather than the heavier dark
  // overlays used elsewhere (round-end, damage flash) -- this is the
  // artwork itself, so it should stay visible, not be dimmed to a mood
  // backdrop.
  function drawLobbyBackground() {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);
    if (!lobbyImgReady) return;
    var scale = Math.min(W / lobbyImg.naturalWidth, H / lobbyImg.naturalHeight);
    var dw = lobbyImg.naturalWidth * scale;
    var dh = lobbyImg.naturalHeight * scale;
    ctx.drawImage(lobbyImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.fillStyle = 'rgba(10, 10, 6, 0.15)';
    ctx.fillRect(0, 0, W, H);
  }

  // The shootable target players ready up on. Idle pulse is purely visual
  // (doesn't affect the hit test, which always uses START_BUTTON_RADIUS) --
  // just a cheap way to read as "interactive" against a static backdrop.
  function drawStartButton(now) {
    var btn = startButtonRect();
    var loggedInCount = 0, readyCount = 0;
    players.forEach(function (p) {
      if (p.out || !p.loggedIn) return;
      loggedInCount++;
      if (p.readyForStart) readyCount++;
    });

    var pulse = 1 + Math.sin(now / 220) * 0.03;
    var r = btn.r * pulse;

    ctx.beginPath();
    ctx.arc(btn.x, btn.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#e8433d';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ffd24d';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = '900 30px "Arial Black", Arial, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText('START', btn.x, btn.y + 10);

    ctx.font = '900 24px "Arial Black", Arial, sans-serif';
    ctx.fillStyle = loggedInCount > 0 && readyCount >= loggedInCount ? '#8fd94a' : '#ded9c4';
    var readyText = loggedInCount > 0 ? (readyCount + ' / ' + loggedInCount + ' READY') : 'WAITING FOR PLAYERS';
    ctx.fillText(readyText, btn.x, btn.y + r + 42);

    ctx.font = '16px -apple-system, Helvetica, Arial, sans-serif';
    ctx.fillStyle = '#a29d87';
    ctx.fillText('Calibrate, then aim at the target and fire to ready up', btn.x, btn.y + r + 70);
  }

  // Roster of everyone connected -- shows each player's own color plus
  // where they are in the join flow (still calibrating vs. logged in vs.
  // already readied), so a group can see at a glance who they're waiting
  // on. Disconnected (out) players are dropped entirely rather than shown
  // stale.
  function drawLobbyRoster() {
    var sortedPlayers = Array.from(players.entries()).sort(function (a, b) { return a[0] - b[0]; });
    ctx.textAlign = 'left';
    ctx.font = '18px -apple-system, Helvetica, Arial, sans-serif';
    var rowY = 40;
    sortedPlayers.forEach(function (entry) {
      var pid = entry[0], p = entry[1];
      if (p.out) return;
      var statusText = p.readyForStart ? 'READY' : (p.loggedIn ? 'LOGGED IN' : 'CALIBRATING…');
      var label = 'P' + pid + '   ' + statusText;
      var tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(10, rowY, tw + 46, 26);
      ctx.fillStyle = p.color;
      ctx.fillRect(14, rowY + 5, 16, 16);
      ctx.fillStyle = p.readyForStart ? '#8fd94a' : (p.loggedIn ? '#eee' : '#a29d87');
      ctx.fillText(label, 36, rowY + 18);
      rowY += 30;
    });
  }

  function drawDifficultyControls() {
    ctx.textAlign = 'left';
    ctx.font = '13px -apple-system, Helvetica, Arial, sans-serif';
    ctx.fillStyle = '#a29d87';
    ctx.fillText('DIFFICULTY', DIFFICULTY_BAR_X, DIFFICULTY_BAR_Y - 8);

    difficultyButtonRects().forEach(function (btn) {
      var active = btn.difficulty === difficulty;
      ctx.fillStyle = active ? '#ff8c1a' : 'rgba(0,0,0,0.5)';
      ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
      ctx.lineWidth = 2;
      ctx.strokeStyle = active ? '#ffd24d' : '#5c6b3f';
      ctx.strokeRect(btn.x, btn.y, btn.w, btn.h);
      ctx.textAlign = 'center';
      ctx.font = '900 13px "Arial Black", Arial, sans-serif';
      ctx.fillStyle = active ? '#241300' : '#ded9c4';
      ctx.fillText(btn.difficulty.toUpperCase(), btn.x + btn.w / 2, btn.y + btn.h / 2 + 5);
    });

    var t = timerToggleRect();
    ctx.fillStyle = timerEnabled ? 'rgba(143, 217, 74, 0.25)' : 'rgba(0,0,0,0.5)';
    ctx.fillRect(t.x, t.y, t.w, t.h);
    ctx.lineWidth = 2;
    ctx.strokeStyle = timerEnabled ? '#8fd94a' : '#5c6b3f';
    ctx.strokeRect(t.x, t.y, t.w, t.h);
    ctx.textAlign = 'center';
    ctx.font = '13px -apple-system, Helvetica, Arial, sans-serif';
    ctx.fillStyle = '#ded9c4';
    ctx.fillText('TIMER: ' + (timerEnabled ? 'ON' : 'OFF') + ' (click to toggle)', t.x + t.w / 2, t.y + t.h / 2 + 5);
  }

  function drawLobbyScreen(now) {
    drawLobbyBackground();
    drawStartButton(now);
    drawHitBurstFlashes(now);
    drawMissFlashes(now);
    drawLobbyRoster();
    drawDifficultyControls();
    drawCrosshairs();
  }

  // Canvas fillText doesn't wrap on its own -- greedily packs words onto
  // each line up to maxWidth, left-aligned starting at (x, y).
  function drawWrappedText(text, x, y, maxWidth, lineHeight) {
    var words = text.split(' ');
    var line = '';
    var lines = [];
    words.forEach(function (word) {
      var test = line ? line + ' ' + word : word;
      if (line && ctx.measureText(test).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    });
    if (line) lines.push(line);
    lines.forEach(function (l, i) { ctx.fillText(l, x, y + i * lineHeight); });
  }

  var CUTSCENE_BOX_HEIGHT = 170;
  var CUTSCENE_BOX_MARGIN = 40;

  function drawCutscene(now) {
    if (!activeCutscene) return;
    ctx.fillStyle = '#0a0a06';
    ctx.fillRect(0, 0, W, H);

    var boxY = H - CUTSCENE_BOX_HEIGHT - CUTSCENE_BOX_MARGIN;
    var img = activeCutscene.img;

    if (img && img.naturalWidth > 0) {
      var maxW = W * 0.75;
      var maxH = boxY - 60;
      var scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
      var dw = img.naturalWidth * scale;
      var dh = img.naturalHeight * scale;
      ctx.drawImage(img, (W - dw) / 2, 30, dw, dh);
    }

    var text = activeCutscene.text;
    var elapsed = now - activeCutscene.startedAt;
    var charsShown = Math.max(0, Math.min(text.length, Math.floor(elapsed / CUTSCENE_CHAR_MS)));
    var revealed = text.slice(0, charsShown);
    var textDone = charsShown >= text.length;

    ctx.fillStyle = 'rgba(10, 10, 6, 0.88)';
    ctx.fillRect(CUTSCENE_BOX_MARGIN, boxY, W - CUTSCENE_BOX_MARGIN * 2, CUTSCENE_BOX_HEIGHT);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#5c6b3f';
    ctx.strokeRect(CUTSCENE_BOX_MARGIN, boxY, W - CUTSCENE_BOX_MARGIN * 2, CUTSCENE_BOX_HEIGHT);

    ctx.textAlign = 'left';
    ctx.font = '22px -apple-system, Helvetica, Arial, sans-serif';
    ctx.fillStyle = '#e7e3d3';
    drawWrappedText(revealed, CUTSCENE_BOX_MARGIN + 24, boxY + 42, W - CUTSCENE_BOX_MARGIN * 2 - 48, 30);

    if (textDone) {
      var blink = Math.floor(now / 500) % 2 === 0;
      if (blink) {
        ctx.textAlign = 'right';
        ctx.font = '16px -apple-system, Helvetica, Arial, sans-serif';
        ctx.fillStyle = '#a29d87';
        ctx.fillText('▼ tap to continue', W - CUTSCENE_BOX_MARGIN - 24, boxY + CUTSCENE_BOX_HEIGHT - 16);
      }
    }
  }

  function drawCrosshairs() {
    crosshairs.forEach(function (c, pid) {
      if (!c.visible) return;
      var p = players.get(pid);
      if (p && (p.out || p.inCover)) return;
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

  function drawBossHealthBar() {
    ctx.textAlign = 'center';
    ctx.font = '900 20px "Arial Black", Arial, sans-serif';
    ctx.fillStyle = '#ded9c4';
    ctx.fillText('FINAL BATTLE', W / 2, 26);

    var barW = 420, barH = 18;
    var barX = W / 2 - barW / 2, barY = 34;
    var hpFrac = bossTarget ? Math.max(0, 1 - bossTarget.hitsTaken / bossTarget.hitsToKill) : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(barX - 4, barY - 4, barW + 8, barH + 8);
    ctx.fillStyle = '#3a1210';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = '#d84a3a';
    ctx.fillRect(barX, barY, barW * hpFrac, barH);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ded9c4';
    ctx.strokeRect(barX, barY, barW, barH);
  }

  function drawBossPhaseCard(now) {
    if (!bossActive || !bossTarget || now >= bossPhaseCardUntil) return;
    ctx.textAlign = 'center';
    ctx.font = '900 44px "Arial Black", Arial, sans-serif';
    ctx.fillStyle = '#d84a3a';
    ctx.globalAlpha = Math.min(1, (bossPhaseCardUntil - now) / 300); // quick fade near the end
    ctx.fillText('PHASE ' + bossTarget.phase, W / 2, H * 0.18);
    ctx.globalAlpha = 1;
  }

  function drawHud(now) {
    if (bossActive) {
      drawBossHealthBar();
    } else {
      var progressText = 'LEVEL ' + (currentLevelIndex + 1) + '   Enemies: ' + enemiesDefeated + ' / ' + ENEMIES_TO_CLEAR;
      if (levelTimeLimitAt !== null) {
        var secsLeft = Math.max(0, Math.ceil((levelTimeLimitAt - now) / 1000));
        progressText += '   ⏱ ' + Math.floor(secsLeft / 60) + ':' + (secsLeft % 60 < 10 ? '0' : '') + (secsLeft % 60);
      }
      ctx.font = '22px -apple-system, Helvetica, Arial, sans-serif';
      ctx.textAlign = 'center';
      var pw = ctx.measureText(progressText).width;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(W / 2 - pw / 2 - 14, 10, pw + 28, 30);
      ctx.fillStyle = '#eee';
      ctx.fillText(progressText, W / 2, 32);
    }

    var sortedPlayers = Array.from(players.entries()).sort(function (a, b) { return a[0] - b[0]; });
    ctx.textAlign = 'left';
    ctx.font = '18px -apple-system, Helvetica, Arial, sans-serif';
    var rowY = 50;
    sortedPlayers.forEach(function (entry) {
      var pid = entry[0], p = entry[1];
      var label = 'P' + pid + (p.out ? '   OUT' : '   ' + (p.inCover ? '🛡 ' : '') + '♥' + Math.max(0, p.lives) + '   ' + p.score + 'pt');
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

  function drawAmmoWarnings() {
    var outOfAmmoPlayers = Array.from(players.entries())
      .filter(function (entry) { return entry[1].outOfAmmo && !entry[1].out; })
      .sort(function (a, b) { return a[0] - b[0]; });
    if (!outOfAmmoPlayers.length) return;

    ctx.textAlign = 'center';
    ctx.font = '900 22px "Arial Black", Arial, sans-serif';
    var startY = 80;
    outOfAmmoPlayers.forEach(function (entry, i) {
      var pid = entry[0], p = entry[1];
      var text = 'Player ' + pid + ' - Out of Ammo';
      var y = startY + i * 32;
      var tw = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(W / 2 - tw / 2 - 14, y - 22, tw + 28, 30);
      ctx.fillStyle = p.color;
      ctx.fillText(text, W / 2, y);
    });
  }

  // The cover-fit transform a background image is drawn with (scale +
  // centering offset) at normal (non-intro-zoom) framing -- shared by the
  // full draw and by occlusion patches, which need to map a canvas-space
  // rect back to the matching source-image rect.
  function backgroundGeometry(bg) {
    var scale = Math.max(W / bg.img.naturalWidth, H / bg.img.naturalHeight);
    var dw = bg.img.naturalWidth * scale;
    var dh = bg.img.naturalHeight * scale;
    return { scale: scale, dx: (W - dw) / 2, dy: (H - dh) / 2 };
  }

  function drawBackground(zoom) {
    var bg = currentBg();
    if (bg && bg.ready) {
      var z = zoom || 1;
      var scale = Math.max(W / bg.img.naturalWidth, H / bg.img.naturalHeight) * z;
      var dw = bg.img.naturalWidth * scale;
      var dh = bg.img.naturalHeight * scale;
      ctx.drawImage(bg.img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, W, H);
    }
  }

  // Re-paints a rect of the background (canvas-space fractions, at normal
  // framing) on top of whatever's already drawn there -- used to make a
  // scene element (a tree trunk, a post) read as being in front of an
  // enemy standing behind it, without needing a separate cutout asset:
  // it's literally the same background pixels, just redrawn after the
  // enemy so they cover part of it.
  function drawOcclusionPatch(rectFrac) {
    var bg = currentBg();
    if (!bg || !bg.ready) return;
    var geo = backgroundGeometry(bg);
    var destX = rectFrac.x * W, destY = rectFrac.y * H;
    var destW = rectFrac.w * W, destH = rectFrac.h * H;
    var srcX = (destX - geo.dx) / geo.scale;
    var srcY = (destY - geo.dy) / geo.scale;
    var srcW = destW / geo.scale;
    var srcH = destH / geo.scale;
    ctx.drawImage(bg.img, srcX, srcY, srcW, srcH, destX, destY, destW, destH);
  }

  function drawOccluders() {
    targets.forEach(function (t) {
      if (t.occluders) t.occluders.forEach(drawOcclusionPatch);
    });
  }

  // Fakes "walking forward" into the next level with a canvas-only dolly
  // zoom (start zoomed in on the new backdrop, settle to normal framing)
  // plus a "LEVEL N" title card. Returns true while it's covering the
  // frame, so render() can skip drawing gameplay underneath it.
  function drawLevelIntro(now) {
    if (now >= levelIntroUntil) return false;
    var t = Math.max(0, Math.min(1, (now - levelIntroStartedAt) / LEVEL_INTRO_MS));
    drawBackground(1.3 - 0.3 * t);

    ctx.fillStyle = 'rgba(10, 10, 6, ' + (0.55 * (1 - t)) + ')';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.font = '900 56px "Arial Black", Arial, sans-serif';
    ctx.fillStyle = '#ded9c4';
    ctx.globalAlpha = Math.min(1, t * 2);
    ctx.fillText('LEVEL ' + (currentLevelIndex + 1), W / 2, H / 2);
    ctx.globalAlpha = 1;
    return true;
  }

  function render() {
    var now = gameNow();

    if (paired && !paused) updateGame(now);

    ctx.clearRect(0, 0, W, H);
    if (activeCutscene) {
      drawCutscene(now);
    } else if (paired && !roundStarted) {
      drawLobbyScreen(now);
    } else if (!drawLevelIntro(now)) {
      drawBackground();
      drawTargets(now);
      drawOccluders();
      drawHitBurstFlashes(now);
      drawShieldBlockFlashes(now);
      drawMuzzleFlashes(now);
      drawMissFlashes(now);
      drawCrosshairs();
      drawDamageFlash(now);
      drawHud(now);
      drawBossPhaseCard(now);
      drawAmmoWarnings();
    }
    // Gated behind !activeCutscene: roundResult stays 'cleared' for the
    // boss level's whole taunt cutscene (startNewGame, which resets it, is
    // deferred to the cutscene's onDone -- see updateGame), so without
    // this check the "LEVEL CLEARED" scoreboard would keep painting over
    // the cutscene for its entire duration instead of the cutscene alone
    // being visible/interactive.
    if (!activeCutscene) drawRoundEndOverlay();
    requestAnimationFrame(render);
  }

  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (paused) resumeGame();
    else pauseGame();
  });

  // Dev/test cheat: typing "win" anywhere on this page (no input focus
  // needed) instantly clears the current level, or finishes the boss off
  // if that's what's up -- see cheatWinLevel. Classic typed-cheat-code
  // convention rather than a visible button, so it doesn't clutter the UI
  // for actual players.
  var CHEAT_WIN_SEQUENCE = 'win';
  var cheatKeyBuffer = '';
  window.addEventListener('keydown', function (e) {
    if (e.key.length !== 1) return; // ignore Escape, Shift, arrows, etc.
    cheatKeyBuffer = (cheatKeyBuffer + e.key.toLowerCase()).slice(-CHEAT_WIN_SEQUENCE.length);
    if (cheatKeyBuffer === CHEAT_WIN_SEQUENCE) {
      cheatKeyBuffer = '';
      cheatWinLevel();
    }
  });

  pauseRestartBtn.addEventListener('click', restartGame);
  pauseQuitBtn.addEventListener('click', quitToLobby);

  canvas.addEventListener('click', handleLobbyClick);
  canvas.addEventListener('mousemove', function (e) {
    if (!paired || roundStarted || activeCutscene) { canvas.style.cursor = 'default'; return; }
    var pt = canvasPointFromEvent(e);
    var overButton = difficultyButtonRects().some(function (btn) { return pointInRect(pt, btn); }) || pointInRect(pt, timerToggleRect());
    canvas.style.cursor = overButton ? 'pointer' : 'default';
  });

  startGameBtn.addEventListener('click', function () {
    startGameBtn.classList.add('hidden');
    pairingPanelEl.classList.remove('hidden');
    pairingHintEl.classList.remove('hidden');
  });

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
