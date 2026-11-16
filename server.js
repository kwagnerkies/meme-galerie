'use strict';

// Meme-Galerie – kleiner Webserver ohne externe Abhängigkeiten.
// Bilder liegen in DATA_DIR/uploads, Metadaten in DATA_DIR/memes.json.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TYPES, processImage } = require('./image');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'memes.json');
const SESSION_FILE = path.join(DATA_DIR, 'sessions.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const USERNAME = process.env.APP_USERNAME || 'cloud';
const PASSWORD = process.env.APP_PASSWORD || 'hosting';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB || 15) * 1024 * 1024;
// Hinter dem mittwald-Proxy kommt die echte Client-IP aus X-Forwarded-For
const TRUST_PROXY = process.env.TRUST_PROXY !== 'false';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_NAME_LENGTH = 120;
const MAX_COMMENT_LENGTH = 500;
const MAX_COMMENTS = 200; // pro Meme, damit memes.json nicht unbegrenzt wächst
const MAX_PARALLEL_UPLOADS = 4;

const EXT_TO_MIME = Object.fromEntries(Object.entries(TYPES).map(([mime, t]) => [t.ext, mime]));
const STATIC_MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

// ---------- Datenhaltung ----------

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
try {
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch {
  console.error(`FEHLER: ${DATA_DIR} ist nicht beschreibbar. Volume-Berechtigungen prüfen.`);
  process.exit(1);
}

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}

function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

let memes = readJson(DB_FILE, []);
const saveDb = () => writeJson(DB_FILE, memes);

function cleanName(value, maxLength = MAX_NAME_LENGTH) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '') // Steuer- und Bidi-Zeichen
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

// ---------- Login / Session ----------

// Sessions liegen serverseitig: Logout macht sie sofort ungültig, und eine Änderung
// von Benutzername/Passwort meldet automatisch alle Geräte ab.
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const sessionStore = readJson(SESSION_FILE, {});
const credentialSalt = sessionStore.salt || crypto.randomBytes(16).toString('hex');
const credentialHash = crypto.scryptSync(`${USERNAME}\n${PASSWORD}`, credentialSalt, 32).toString('hex');
let sessions = sessionStore.credentialHash === credentialHash ? sessionStore.sessions || {} : {};

function saveSessions() {
  const now = Date.now();
  for (const [id, expires] of Object.entries(sessions)) if (expires < now) delete sessions[id];
  writeJson(SESSION_FILE, { salt: credentialSalt, credentialHash, sessions });
}
saveSessions();
setInterval(saveSessions, 60 * 60 * 1000).unref();

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        // ungültiges Cookie ignorieren
      }
    }
  }
  return out;
}

function sessionId(req) {
  const token = parseCookies(req).session;
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? sha256(token) : null;
}

function isLoggedIn(req) {
  const id = sessionId(req);
  return Boolean(id && sessions[id] && sessions[id] > Date.now());
}

function isHttps(req) {
  return TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https';
}

function sessionCookie(req, value, maxAgeSeconds) {
  const secure = isHttps(req) ? '; Secure' : '';
  return `session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) {
    // Letzter Eintrag = vom Reverse-Proxy gesetzt, nicht vom Client fälschbar
    return String(req.headers['x-forwarded-for']).split(',').pop().trim();
  }
  return req.socket.remoteAddress || '';
}

// Schutz gegen Passwort-Raten: 10 Fehlversuche pro IP -> 15 Minuten Sperre.
const LOCK_MS = 15 * 60 * 1000;
const failedLogins = new Map();
function isBlocked(ip) {
  const entry = failedLogins.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.first > LOCK_MS) {
    failedLogins.delete(ip);
    return false;
  }
  return entry.count >= 10;
}
function recordFailure(ip) {
  if (failedLogins.size > 10000) failedLogins.clear(); // Speicher begrenzen
  const entry = failedLogins.get(ip) || { count: 0, first: Date.now() };
  entry.count++;
  failedLogins.set(ip, entry);
}
setInterval(() => {
  for (const [ip, entry] of failedLogins) if (Date.now() - entry.first > LOCK_MS) failedLogins.delete(ip);
}, LOCK_MS).unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- HTTP-Helfer ----------

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy': "default-src 'none'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function headersFor(req, extra) {
  const h = { ...BASE_HEADERS, ...extra };
  if (isHttps(req)) h['Strict-Transport-Security'] = 'max-age=31536000';
  return h;
}

function send(req, res, status, body, headers = {}) {
  res.writeHead(status, headersFor(req, headers));
  res.end(body);
}

function sendJson(req, res, status, data) {
  send(req, res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

function redirect(req, res, location, headers = {}) {
  send(req, res, 303, '', { Location: location, 'Cache-Control': 'no-store', ...headers });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > limit) {
      reject(Object.assign(new Error('too large'), { status: 413 }));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.pause();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function serveFile(req, res, filePath, headers) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return send(req, res, 404, 'Nicht gefunden');
    res.writeHead(200, headersFor(req, { ...headers, 'Content-Length': stat.size }));
    fs.createReadStream(filePath).pipe(res);
  });
}

function serveStatic(req, res, name) {
  const type = STATIC_MIME[path.extname(name)];
  if (!type) return send(req, res, 404, 'Nicht gefunden');
  serveFile(req, res, path.join(PUBLIC_DIR, path.basename(name)), { 'Content-Type': type, 'Cache-Control': 'no-cache' });
}

// Gegen CSRF: schreibende Anfragen müssen von der eigenen Seite kommen.
function sameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === req.headers.host || (TRUST_PROXY && host === req.headers['x-forwarded-host']);
  } catch {
    return false;
  }
}

// ---------- Routen ----------

let activeUploads = 0;

// Liest ein Bild aus dem Request-Body, bereinigt und speichert es.
// Ergebnis: { id, file } oder { status, error }.
async function storeUpload(req) {
  if (activeUploads >= MAX_PARALLEL_UPLOADS) return { status: 503, error: 'Gerade viel los – bitte gleich nochmal versuchen' };
  activeUploads++;
  let body;
  try {
    body = await readBody(req, MAX_UPLOAD_BYTES);
  } finally {
    activeUploads--;
  }
  const image = processImage(body);
  if (!image) return { status: 415, error: 'Nur gültige JPG-, PNG-, GIF- oder WebP-Bilder erlaubt' };
  const id = crypto.randomUUID();
  const file = id + image.ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), image.data, { mode: 0o600 });
  return { id, file };
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;
  const method = req.method;

  if (pathname === '/healthz') return send(req, res, 200, 'ok', { 'Content-Type': 'text/plain' });

  if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) {
    return sendJson(req, res, 403, { error: 'Ungültige Herkunft' });
  }

  if (pathname === '/login' && method === 'GET') {
    if (isLoggedIn(req)) return redirect(req, res, '/');
    return serveStatic(req, res, 'login.html');
  }

  if (pathname === '/login' && method === 'POST') {
    const ip = clientIp(req);
    if (isBlocked(ip)) return redirect(req, res, '/login?error=blocked');
    const params = new URLSearchParams((await readBody(req, 4 * 1024)).toString());
    const userOk = safeEqual(params.get('username') || '', USERNAME);
    const passOk = safeEqual(params.get('password') || '', PASSWORD);
    if (!(userOk && passOk)) {
      recordFailure(ip);
      console.warn(`Fehlgeschlagener Login von ${ip}`);
      await sleep(1000);
      return redirect(req, res, '/login?error=1');
    }
    failedLogins.delete(ip);
    const token = crypto.randomBytes(32).toString('base64url');
    sessions[sha256(token)] = Date.now() + SESSION_MS;
    saveSessions();
    return redirect(req, res, '/', { 'Set-Cookie': sessionCookie(req, token, SESSION_MS / 1000) });
  }

  if (pathname === '/logout' && method === 'POST') {
    const id = sessionId(req);
    if (id && sessions[id]) {
      delete sessions[id];
      saveSessions();
    }
    return redirect(req, res, '/login', { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  // Login-Seite braucht CSS und JS ohne Anmeldung
  if (pathname === '/style.css' || pathname === '/login.js') return serveStatic(req, res, pathname.slice(1));

  // Ab hier nur mit Login
  if (!isLoggedIn(req)) {
    if (pathname.startsWith('/api/')) return sendJson(req, res, 401, { error: 'Nicht angemeldet' });
    return redirect(req, res, '/login');
  }

  if (pathname === '/' && method === 'GET') return serveStatic(req, res, 'index.html');
  if (pathname === '/app.js' && method === 'GET') return serveStatic(req, res, 'app.js');

  if (pathname.startsWith('/uploads/') && method === 'GET') {
    const file = pathname.slice('/uploads/'.length);
    const mime = EXT_TO_MIME[path.extname(file)];
    if (!mime || !/^[a-f0-9-]{36}\.[a-z]+$/.test(file)) return send(req, res, 404, 'Nicht gefunden');
    return serveFile(req, res, path.join(UPLOAD_DIR, file), {
      'Content-Type': mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
  }

  if (pathname === '/api/memes' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').toLowerCase().trim();
    const list = q ? memes.filter((m) => m.name.toLowerCase().includes(q)) : memes;
    return sendJson(req, res, 200, [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  // Upload: Bild als roher Request-Body, Name als Query-Parameter
  if (pathname === '/api/memes' && method === 'POST') {
    const name = cleanName(url.searchParams.get('name'));
    if (!name) return sendJson(req, res, 400, { error: 'Bitte einen Namen angeben' });
    const up = await storeUpload(req);
    if (up.error) return sendJson(req, res, up.status, { error: up.error });
    const meme = { id: up.id, name, file: up.file, createdAt: new Date().toISOString() };
    memes.push(meme);
    saveDb();
    return sendJson(req, res, 201, meme);
  }

  const match = pathname.match(/^\/api\/memes\/([a-f0-9-]{36})(\/comments)?$/);
  if (match) {
    const meme = memes.find((m) => m.id === match[1]);
    if (!meme) return sendJson(req, res, 404, { error: 'Meme nicht gefunden' });
    const isComment = Boolean(match[2]);

    // Kommentar: Text URL-kodiert im Header (landet so nicht in Proxy-Logs),
    // optional ein Bild als roher Request-Body (wie beim Upload)
    if (isComment && method === 'POST') {
      let text;
      try {
        text = cleanName(decodeURIComponent(req.headers['x-comment-text'] || ''), MAX_COMMENT_LENGTH);
      } catch {
        return sendJson(req, res, 400, { error: 'Ungültige Anfrage' });
      }
      // Reine Text-Kommentare belegen keinen Upload-Platz
      const hasBody = Number(req.headers['content-length']) > 0 || 'transfer-encoding' in req.headers;
      const up = hasBody ? await storeUpload(req) : {};
      if (up.error) return sendJson(req, res, up.status, { error: up.error });
      // Erst nach dem Upload prüfen: währenddessen kann das Meme gelöscht oder voll geworden sein
      const gone = !memes.includes(meme);
      if (gone || (meme.comments || []).length >= MAX_COMMENTS) {
        if (up.file) fs.rm(path.join(UPLOAD_DIR, up.file), { force: true }, () => {});
        return gone
          ? sendJson(req, res, 404, { error: 'Meme nicht gefunden' })
          : sendJson(req, res, 400, { error: 'Zu viele Kommentare an diesem Meme' });
      }
      if (!text && !up.file) return sendJson(req, res, 400, { error: 'Bitte einen Kommentar eingeben oder ein Bild anhängen' });
      const comment = { id: crypto.randomUUID(), text, createdAt: new Date().toISOString() };
      if (up.file) comment.file = up.file;
      meme.comments = meme.comments || []; // ältere Memes haben noch kein Feld
      meme.comments.push(comment);
      saveDb();
      return sendJson(req, res, 201, meme);
    }

    if (method === 'PATCH' && !isComment) {
      let body;
      try {
        body = JSON.parse((await readBody(req, 4 * 1024)).toString() || '{}');
      } catch {
        return sendJson(req, res, 400, { error: 'Ungültige Anfrage' });
      }
      const name = cleanName(body && body.name);
      if (!name) return sendJson(req, res, 400, { error: 'Bitte einen Namen angeben' });
      meme.name = name;
      saveDb();
      return sendJson(req, res, 200, meme);
    }

    if (method === 'DELETE' && !isComment) {
      memes = memes.filter((m) => m.id !== meme.id);
      saveDb();
      const files = [meme.file, ...(meme.comments || []).map((c) => c.file).filter(Boolean)];
      for (const file of files) fs.rm(path.join(UPLOAD_DIR, file), { force: true }, () => {});
      return send(req, res, 204, '');
    }
  }

  return send(req, res, 404, 'Nicht gefunden');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (res.headersSent) return res.destroy();
    if (err.status === 413) {
      // Antwort senden, dann Verbindung schließen statt den Rest der Datei anzunehmen
      res.setHeader('Connection', 'close');
      res.on('finish', () => req.destroy());
      return sendJson(req, res, 413, { error: `Datei zu groß (max. ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)` });
    }
    console.error(err);
    sendJson(req, res, 500, { error: 'Interner Fehler' });
  });
});

// Langsame oder hängende Verbindungen nicht ewig offen halten
server.headersTimeout = 20 * 1000;
server.requestTimeout = 120 * 1000;
server.keepAliveTimeout = 5 * 1000;

server.listen(PORT, () => {
  console.log(`Meme-Galerie läuft auf Port ${PORT}, Daten in ${DATA_DIR}`);
  if (PASSWORD === 'hosting' || PASSWORD.length < 12) {
    console.warn('WARNUNG: Schwaches Passwort. Für den Betrieb APP_PASSWORD auf ein langes, zufälliges Passwort setzen.');
  }
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
