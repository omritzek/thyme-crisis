const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const http = require('http');
const https = require('https');
const express = require('express');
const QRCode = require('qrcode');
const selfsigned = require('selfsigned');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const SESSION_RE = /^[A-Z0-9]{4}$/;

// When hosted on a real platform (Render, Railway, Fly, etc.), that platform's
// edge terminates real, browser-trusted TLS and proxies plain HTTP/WS to this
// process — generating our own self-signed cert would be redundant and, since
// nothing forwards the raw TLS port to us there, wouldn't even be reachable.
// The self-signed cert is only needed for the "run it on your own LAN" path.
const BEHIND_TLS_PROXY = process.env.RENDER === 'true' || process.env.NODE_ENV === 'production';

const app = express();
app.set('trust proxy', 1);

// The phone needs camera access (getUserMedia), which mobile browsers only
// allow on a secure context (HTTPS or localhost) — a plain http:// LAN
// address is blocked, most strictly on iOS Safari/WebKit. So the whole app
// is served over a self-signed HTTPS cert; every device that visits it
// (display included) will see a one-time "not secure" warning to click
// through, since the cert isn't from a trusted CA.
function localLanIps() {
  const ips = [];
  const interfaces = os.networkInterfaces();
  Object.values(interfaces).forEach((addrs) => {
    (addrs || []).forEach((addr) => {
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
    });
  });
  return ips;
}

async function generateCert() {
  const altNames = [
    { type: 2, value: 'localhost' }, // DNS
    { type: 7, ip: '127.0.0.1' } // IP
  ];
  localLanIps().forEach((ip) => altNames.push({ type: 7, ip }));

  const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    days: 365,
    keySize: 2048,
    extensions: [{ name: 'subjectAltName', altNames }]
  });
  return { key: pems.private, cert: pems.cert };
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/display/index.html'));
});

app.get('/phone', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/phone/index.html'));
});

// Renders a QR code for a given piece of text server-side, since the QR
// library ships no browser bundle. The session code itself is still
// generated client-side by the display page.
app.get('/api/qrcode', async (req, res) => {
  const text = req.query.text;
  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'missing text query param' });
    return;
  }
  try {
    const dataUrl = await QRCode.toDataURL(text, { margin: 1, width: 240 });
    res.json({ dataUrl });
  } catch (err) {
    res.status(500).json({ error: 'failed to render qr code' });
  }
});

// Lists whatever enemy sprite images are actually present, so dropping a
// file into public/display/assets/enemies/ is enough to use it — no code
// change needed. Returns an empty list (not an error) if the folder is
// missing or empty; the display falls back to its built-in drawn sprite.
//
// A file named "<name>-hit" or "<name>-hit<N>" (e.g. "-hit1", "-hit2", with
// or without an extension) is treated as a hit-reaction pose for the base
// sprite "<name>" rather than listed as its own independent spawnable
// sprite. A base sprite can have several numbered hit poses, one of which
// is picked at random each time it's shot; a lone unnumbered "-hit" is just
// that sprite's single pose. A "-hit" file with no matching base file is
// just ignored.
//
// Files are identified as images by sniffing their actual bytes (PNG/JPEG/
// WEBP signatures), not by trusting the filename's extension — tools like
// Photopea's export dialog, or a quick manual rename, can easily leave a
// real image file with no extension (or the wrong one), and requiring a
// specific extension there just means "my sprite doesn't show up" for no
// reason a player would guess.
const ASSETS_DIR = path.join(__dirname, '../public/display/assets');
const ENEMY_SPRITE_DIR = path.join(ASSETS_DIR, 'enemies');
const BACKGROUND_DIR = path.join(ASSETS_DIR, 'backgrounds');
const MENU_MUSIC_DIR = path.join(ASSETS_DIR, 'music/menu');
const LEVEL_MUSIC_DIR = path.join(ASSETS_DIR, 'music/levels');
const LOBBY_IMAGE_DIR = path.join(ASSETS_DIR, 'lobby');
const INTRO_CUTSCENE_DIR = path.join(ASSETS_DIR, 'cutscenes/intro');
const OUTRO_CUTSCENE_DIR = path.join(ASSETS_DIR, 'cutscenes/outro');
const BOSS_SPRITE_DIR = path.join(ASSETS_DIR, 'boss');
const BOSS_MUSIC_DIR = path.join(ASSETS_DIR, 'music/boss');

async function sniffImageType(filePath) {
  let handle;
  try {
    handle = await fs.open(filePath, 'r');
    const buf = Buffer.alloc(12);
    const { bytesRead } = await handle.read(buf, 0, 12, 0);
    if (bytesRead >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (bytesRead >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
    if (bytesRead >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
    return null;
  } catch (err) {
    return null;
  } finally {
    if (handle) await handle.close();
  }
}

// Same content-sniffing approach as sniffImageType, for the same reason: a
// music file's real extension can't be trusted (exported/renamed by hand),
// so this reads the actual header bytes instead.
async function sniffAudioType(filePath) {
  let handle;
  try {
    handle = await fs.open(filePath, 'r');
    const buf = Buffer.alloc(12);
    const { bytesRead } = await handle.read(buf, 0, 12, 0);
    if (bytesRead >= 3 && buf.toString('ascii', 0, 3) === 'ID3') return 'mp3'; // ID3v2-tagged MP3
    if (bytesRead >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3'; // untagged MP3, raw frame sync
    if (bytesRead >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return 'wav';
    if (bytesRead >= 4 && buf.toString('ascii', 0, 4) === 'OggS') return 'ogg';
    // M4A/MP4 container: a 4-byte box size followed by the ASCII box type
    // "ftyp" at offset 4 -- every MP4-family file (M4A included) starts
    // with this file-type box.
    if (bytesRead >= 8 && buf.toString('ascii', 4, 8) === 'ftyp') return 'm4a';
    return null;
  } catch (err) {
    return null;
  } finally {
    if (handle) await handle.close();
  }
}

async function listFilesBySniff(dirPath, sniffFn) {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    return [];
  }
  const candidates = entries.filter((e) => e.isFile());
  const checks = await Promise.all(candidates.map((e) => sniffFn(path.join(dirPath, e.name))));
  return candidates.filter((e, i) => checks[i]).map((e) => e.name);
}

function listImageFiles(dirPath) {
  return listFilesBySniff(dirPath, sniffImageType);
}

function listAudioFiles(dirPath) {
  return listFilesBySniff(dirPath, sniffAudioType);
}

function stemOf(name) {
  const ext = path.extname(name);
  return ext ? name.slice(0, -ext.length) : name;
}

const HIT_SUFFIX_RE = /-hit(\d*)$/i;

app.get('/api/enemy-sprites', async (req, res) => {
  const names = await listImageFiles(ENEMY_SPRITE_DIR);

  // Group every "-hit"/"-hit<N>" file by its base stem, so a base sprite
  // with several numbered poses (evyard-hit1, evyard-hit2, ...) collects
  // them all instead of only ever pairing with one.
  const hitsByBase = new Map(); // lowercased base stem -> [{ name, order }]
  const baseNames = [];

  names.forEach((name) => {
    const stem = stemOf(name);
    const match = stem.match(HIT_SUFFIX_RE);
    if (!match) {
      baseNames.push(name);
      return;
    }
    const baseStem = stem.slice(0, match.index).toLowerCase();
    const order = match[1] ? parseInt(match[1], 10) : 0;
    if (!hitsByBase.has(baseStem)) hitsByBase.set(baseStem, []);
    hitsByBase.get(baseStem).push({ name, order });
  });

  const sprites = baseNames
    .sort()
    .map((name) => {
      const hitFiles = (hitsByBase.get(stemOf(name).toLowerCase()) || [])
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
      return {
        base: `/display/assets/enemies/${encodeURIComponent(name)}`,
        hits: hitFiles.map((h) => `/display/assets/enemies/${encodeURIComponent(h.name)}`)
      };
    });

  res.json({ sprites });
});

// Lists whatever background image(s) are sitting in
// public/display/assets/backgrounds/ (any name, any extension or none) —
// dropping a file in there is enough, it doesn't have to be named exactly
// "playground.jpg". Sorted order becomes level order: the display cycles
// through them one per level, so dropping in a second image is all it takes
// to give level 2 its own backdrop. Returns { urls: [] } (not an error) if
// nothing is found.
app.get('/api/background-image', async (req, res) => {
  const names = await listImageFiles(BACKGROUND_DIR);
  const urls = names.sort().map((name) => `/display/assets/backgrounds/${encodeURIComponent(name)}`);
  res.json({ urls });
});

// Lists whatever's sitting in public/display/assets/music/menu/ — the
// lobby/pairing-screen theme. Works the same as the other asset endpoints
// (drop a file in, no code change), except only the first one (sorted) is
// ever used — this isn't a rotation, just "what plays on the pairing
// screen." Returns { urls: [] } (not an error) if nothing's there; the
// display just stays silent on that screen.
app.get('/api/menu-music', async (req, res) => {
  const names = await listAudioFiles(MENU_MUSIC_DIR);
  const urls = names.sort().map((name) => `/display/assets/music/menu/${encodeURIComponent(name)}`);
  res.json({ urls });
});

// Lists whatever's sitting in public/display/assets/music/levels/ — one
// loopable track per level, same sorted-order-becomes-level-order and
// wrapping-modulo scheme as /api/background-image (so dropping a second
// track in later is enough to give level 2 its own music, no code change).
app.get('/api/level-music', async (req, res) => {
  const names = await listAudioFiles(LEVEL_MUSIC_DIR);
  const urls = names.sort().map((name) => `/display/assets/music/levels/${encodeURIComponent(name)}`);
  res.json({ urls });
});

// Same single-file convention as /api/menu-music, for the final boss level
// -- overrides the normal per-level rotation for the whole level (taunt
// cutscene through the fight through both ending cutscenes).
app.get('/api/boss-music', async (req, res) => {
  const names = await listAudioFiles(BOSS_MUSIC_DIR);
  const sorted = names.sort();
  const urls = sorted.length ? [`/display/assets/music/boss/${encodeURIComponent(sorted[0])}`] : [];
  res.json({ urls });
});

// Lists whatever's sitting in public/display/assets/lobby/ — the pairing
// screen / pre-round lobby artwork. Same single-file convention as
// /api/menu-music: only the first one (sorted) is ever used, since this is
// a fixed backdrop, not a rotation. Returns { url: null } (not an error) if
// nothing's there; the lobby just falls back to its plain dark background.
app.get('/api/lobby-image', async (req, res) => {
  const names = await listImageFiles(LOBBY_IMAGE_DIR);
  const sorted = names.sort();
  const url = sorted.length ? `/display/assets/lobby/${encodeURIComponent(sorted[0])}` : null;
  res.json({ url });
});

// Same single-file convention as /api/lobby-image, for the opening
// villain-monologue cutscene shown once, the first time a game actually
// starts. A separate folder (rather than reusing lobby/) since this is
// story artwork tied to a specific scene, not a swappable backdrop.
app.get('/api/intro-image', async (req, res) => {
  const names = await listImageFiles(INTRO_CUTSCENE_DIR);
  const sorted = names.sort();
  const url = sorted.length ? `/display/assets/cutscenes/intro/${encodeURIComponent(sorted[0])}` : null;
  res.json({ url });
});

// The two endings back to back: him crying/defeated, then the group's
// celebration. Same sorted-order convention as backgrounds/level music --
// whichever file sorts first is the "defeated" scene, the next is the
// "celebration" scene (e.g. "1 - sad cyborg.png", "2 - celebration.png") --
// rather than two separate single-file folders, since these two always
// play as a pair.
app.get('/api/outro-images', async (req, res) => {
  const names = await listImageFiles(OUTRO_CUTSCENE_DIR);
  const urls = names.sort().map((name) => `/display/assets/cutscenes/outro/${encodeURIComponent(name)}`);
  res.json({ urls });
});

// Same single-file convention, for the final boss's in-fight sprite (a
// transparent-background character image, unlike the cutscene art, which
// is a full backdrop scene) -- separate from /api/enemy-sprites since the
// boss is one specific, non-random, non-reskinnable character.
app.get('/api/boss-sprite', async (req, res) => {
  const names = await listImageFiles(BOSS_SPRITE_DIR);
  const sorted = names.sort();
  const url = sorted.length ? `/display/assets/boss/${encodeURIComponent(sorted[0])}` : null;
  res.json({ url });
});

app.use(express.static(path.join(__dirname, '../public')));

// --- WebSocket relay ---
// Rooms are keyed by 4-char session code. Each room holds at most one
// display socket and up to MAX_PLAYERS phone sockets, each assigned a
// stable playerId on connect (must match PLAYER_COLORS.length in
// public/shared/protocol.js, which is what actually turns a playerId into a
// color on the two clients -- the server never needs to know about colors).
// The server tags every phone->display message with the sender's playerId,
// and honors an optional targetPlayerId on display->phone messages (routed
// to just that one phone; broadcast to all phones if absent). Beyond that
// routing, it never inspects game state.

const MAX_PLAYERS = 5;

const rooms = new Map(); // session -> { display: ws|null, phones: Map<playerId, ws>, nextPlayerId: number }

function getRoom(session) {
  let room = rooms.get(session);
  if (!room) {
    room = { display: null, phones: new Map(), nextPlayerId: 1 };
    rooms.set(session, room);
  }
  return room;
}

function cleanupRoom(session) {
  const room = rooms.get(session);
  if (room && !room.display && room.phones.size === 0) {
    rooms.delete(session);
  }
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastToPhones(room, msg) {
  room.phones.forEach((ws) => send(ws, msg));
}

function attachWebSocketServer(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const role = url.searchParams.get('role');
    const session = (url.searchParams.get('session') || '').toUpperCase();

    console.log(`[ws] connection attempt: role=${role} session=${session} from=${req.socket.remoteAddress}`);

    if ((role !== 'display' && role !== 'phone') || !SESSION_RE.test(session)) {
      console.log(`[ws] rejected: invalid role or session code (role=${role} session=${session})`);
      send(ws, { type: 'session_error', reason: 'invalid role or session code' });
      ws.close();
      return;
    }

    const room = getRoom(session);

    if (role === 'display') {
      if (room.display) {
        console.log(`[ws] rejected: display already connected (session=${session})`);
        send(ws, { type: 'session_error', reason: 'a display is already connected for this session' });
        ws.close();
        return;
      }

      room.display = ws;
      ws.session = session;
      ws.role = 'display';
      console.log(`[ws] joined: role=display session=${session} (${room.phones.size} phone(s) already present)`);

      room.phones.forEach((phoneWs, playerId) => {
        send(ws, { type: 'player_joined', playerId });
      });

      ws.on('message', (data) => {
        let msg;
        try {
          msg = JSON.parse(data);
        } catch (err) {
          return;
        }
        if (msg.targetPlayerId != null) {
          send(room.phones.get(msg.targetPlayerId), msg);
        } else {
          broadcastToPhones(room, msg);
        }
      });

      ws.on('close', () => {
        const current = rooms.get(session);
        if (!current) return;
        if (current.display === ws) current.display = null;
        broadcastToPhones(current, { type: 'peer_disconnected' });
        cleanupRoom(session);
      });
      return;
    }

    // role === 'phone'
    if (room.phones.size >= MAX_PLAYERS) {
      console.log(`[ws] rejected: session full (session=${session})`);
      send(ws, { type: 'session_error', reason: 'this session already has the maximum number of players' });
      ws.close();
      return;
    }

    const playerId = room.nextPlayerId++;
    room.phones.set(playerId, ws);
    ws.session = session;
    ws.role = 'phone';
    ws.playerId = playerId;
    console.log(`[ws] joined: role=phone playerId=${playerId} session=${session} (display ${room.display ? 'present' : 'not yet connected'})`);

    send(ws, { type: 'player_assigned', playerId });
    if (room.display) send(room.display, { type: 'player_joined', playerId });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch (err) {
        return;
      }
      msg.playerId = playerId;
      send(room.display, msg);
    });

    ws.on('close', () => {
      const current = rooms.get(session);
      if (!current) return;
      current.phones.delete(playerId);
      if (current.display) send(current.display, { type: 'player_left', playerId });
      cleanupRoom(session);
    });
  });
}

async function main() {
  let server;
  if (BEHIND_TLS_PROXY) {
    server = http.createServer(app);
  } else {
    const { key, cert } = await generateCert();
    server = https.createServer({ key, cert }, app);
  }
  attachWebSocketServer(server);

  server.listen(PORT, () => {
    if (BEHIND_TLS_PROXY) {
      console.log(`Phone light gun relay server listening on http://0.0.0.0:${PORT}`);
      console.log('Running behind a TLS-terminating proxy (BEHIND_TLS_PROXY) — the');
      console.log('platform hosting this handles the real HTTPS certificate.');
      return;
    }
    console.log(`Phone light gun relay server listening on https://0.0.0.0:${PORT}`);
    console.log('Using a self-signed certificate — every device will need to accept a');
    console.log('one-time browser security warning the first time it loads the page.');
    const ips = localLanIps();
    if (ips.length) {
      console.log('Reachable on your LAN at:');
      ips.forEach((ip) => console.log(`  https://${ip}:${PORT}/`));
    }
  });
}

main();
