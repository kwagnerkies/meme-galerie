'use strict';

// Smoke-Test für Kommentare: startet den Server mit leerem Datenordner. Aufruf: npm test
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3999;
const base = `http://127.0.0.1:${PORT}`;
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

test('Kommentare anlegen und begrenzen', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meme-test-'));
  const server = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT, DATA_DIR: dataDir, TRUST_PROXY: 'false', APP_USERNAME: 'u', APP_PASSWORD: 'p' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => {
    server.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    server.stdout.once('data', resolve);
    server.once('exit', () => reject(new Error(`Server nicht gestartet (Port ${PORT} belegt?)`)));
  });

  const login = await fetch(`${base}/login`, { method: 'POST', body: new URLSearchParams({ username: 'u', password: 'p' }), redirect: 'manual' });
  const headers = { Cookie: login.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
  const comment = (id, text, h = headers, body) => fetch(`${base}/api/memes/${id}/comments`, { method: 'POST', headers: { ...h, 'X-Comment-Text': encodeURIComponent(text) }, body });

  const meme = await (await fetch(`${base}/api/memes?name=test`, { method: 'POST', headers, body: GIF })).json();

  const res = await comment(meme.id, '  hallo\n welt  ');
  assert.strictEqual(res.status, 201);
  assert.strictEqual((await res.json()).comments[0].text, 'hallo welt');

  assert.strictEqual((await comment(meme.id, '   ')).status, 400);
  assert.strictEqual((await comment(meme.id, 'x', { 'Content-Type': 'application/json' })).status, 401);
  assert.strictEqual((await comment('00000000-0000-0000-0000-000000000000', 'x')).status, 404);

  const long = await (await comment(meme.id, 'a'.repeat(900))).json();
  assert.strictEqual(long.comments[1].text.length, 500);

  // Kommentar mit Bild, auch ohne Text
  const withImage = await (await comment(meme.id, '', headers, GIF)).json();
  const { file } = withImage.comments[2];
  assert.match(file, /\.gif$/);
  assert.strictEqual((await fetch(`${base}/uploads/${file}`, { headers })).status, 200);
  assert.strictEqual((await comment(meme.id, 'kein bild', headers, Buffer.from('<svg onload=alert(1)>'))).status, 415);

  const list = await (await fetch(`${base}/api/memes`, { headers })).json();
  assert.strictEqual(list[0].comments.length, 3);

  // Limit (200): der nächste Kommentar wird abgelehnt und sein Bild wieder gelöscht
  const uploads = () => fs.readdirSync(path.join(dataDir, 'uploads')).length;
  for (let i = 3; i < 200; i++) assert.strictEqual((await comment(meme.id, `k${i}`)).status, 201);
  const before = uploads();
  assert.strictEqual((await comment(meme.id, 'zu viel', headers, GIF)).status, 400);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.strictEqual(uploads(), before);

  // Meme löschen räumt auch die Kommentar-Bilder weg
  assert.strictEqual((await fetch(`${base}/api/memes/${meme.id}`, { method: 'DELETE', headers })).status, 204);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.strictEqual((await fetch(`${base}/uploads/${file}`, { headers })).status, 404);
});
