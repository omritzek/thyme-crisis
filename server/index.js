const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const https = require('https');
const express = require('express');
const QRCode = require('qrcode');
const selfsigned = require('selfsigned');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const SESSION_RE = /^[A-Z0-9]{4}$/;

const app = express();

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
// A file named "<name>-hit.<ext>" is treated as the hit-reaction pose for
// the base sprite "<name>.<ext>" and paired with it rather than listed as
// its own independent spawnable sprite. A "-hit" file with no matching base
// file is just ignored.
const ASSETS_DIR = path.join(__dirname, '../public/display/assets');
const ENEMY_SPRITE_DIR = path.join(ASSETS_DIR, 'enemies');
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

app.get('/api/enemy-sprites', async (req, res) => {
  try {
    const entries = await fs.readdir(ENEMY_SPRITE_DIR);
    const imageFiles = entries.filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()));
    const byName = new Set(imageFiles);

    const sprites = imageFiles
      .filter((name) => !/-hit\.[^.]+$/i.test(name))
      .sort()
      .map((name) => {
        const ext = path.extname(name);
        const hitName = name.slice(0, -ext.length) + '-hit' + ext;
        return {
          base: `/display/assets/enemies/${name}`,
          hit: byName.has(hitName) ? `/display/assets/enemies/${hitName}` : null
        };
      });

    res.json({ sprites });
  } catch (err) {
    res.json({ sprites: [] });
  }
});

// Finds whatever background image is sitting directly in
// public/display/assets/ (any name, any of the supported extensions) —
// dropping a file in there is enough, it doesn't have to be named
// exactly "playground.jpg". Ignores the enemies/ subfolder. Returns
// { url: null } (not an error) if nothing is found.
app.get('/api/background-image', async (req, res) => {
  try {
    const entries = await fs.readdir(ASSETS_DIR, { withFileTypes: true });
    const match = entries
      .filter((e) => e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
      .map((e) => e.name)
      .sort()[0];
    res.json({ url: match ? `/display/assets/${match}` : null });
  } catch (err) {
    res.json({ url: null });
  }
});

app.use(express.static(path.join(__dirname, '../public')));

// --- WebSocket relay ---
// Rooms are keyed by 4-char session code. Each room holds at most one
// display socket and one phone socket. The server only relays app-level
// messages between the two peers in a room; it never inspects game state.

const rooms = new Map(); // session -> { display: ws|null, phone: ws|null }

function getRoom(session) {
  let room = rooms.get(session);
  if (!room) {
    room = { display: null, phone: null };
    rooms.set(session, room);
  }
  return room;
}

function cleanupRoom(session) {
  const room = rooms.get(session);
  if (room && !room.display && !room.phone) {
    rooms.delete(session);
  }
}

function otherRole(role) {
  return role === 'display' ? 'phone' : 'display';
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
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

    if (room[role]) {
      console.log(`[ws] rejected: role already connected (role=${role} session=${session})`);
      send(ws, { type: 'session_error', reason: 'that role is already connected for this session' });
      ws.close();
      return;
    }

    room[role] = ws;
    ws.session = session;
    ws.role = role;
    console.log(`[ws] joined: role=${role} session=${session} (peer ${room[otherRole(role)] ? 'present' : 'not yet connected'})`);

    const peer = room[otherRole(role)];
    if (peer) {
      if (role === 'phone') {
        send(peer, { type: 'phone_connected' });
      } else {
        send(peer, { type: 'display_connected' });
      }
    }

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch (err) {
        return;
      }
      const target = room[otherRole(ws.role)];
      send(target, msg);
    });

    ws.on('close', () => {
      const current = rooms.get(ws.session);
      if (!current) return;
      if (current[ws.role] === ws) {
        current[ws.role] = null;
      }
      const remainingPeer = current[otherRole(ws.role)];
      send(remainingPeer, { type: 'peer_disconnected' });
      cleanupRoom(ws.session);
    });
  });
}

async function main() {
  const { key, cert } = await generateCert();
  const server = https.createServer({ key, cert }, app);
  attachWebSocketServer(server);

  server.listen(PORT, () => {
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
