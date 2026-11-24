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

  // Votes: per browser voter id, one vote each, changeable and removable
  const voterA = { ...headers, 'X-Voter-Id': '11111111-1111-4111-8111-111111111111' };
  const voterB = { ...headers, 'X-Voter-Id': '22222222-2222-4222-8222-222222222222' };
  const vote = (h, v) => fetch(`${base}/api/memes/${meme.id}/vote`, { method: 'POST', headers: h, body: JSON.stringify({ vote: v }) });
  let voted = await (await vote(voterA, 1)).json();
  assert.deepStrictEqual([voted.up, voted.down, voted.score, voted.myVote], [1, 0, 1, 1]);
  assert.strictEqual(voted.votes, undefined);
  voted = await (await vote(voterA, 1)).json();
  assert.strictEqual(voted.up, 1);
  voted = await (await vote(voterB, -1)).json();
  assert.deepStrictEqual([voted.up, voted.down, voted.score, voted.myVote], [1, 1, 0, -1]);
  voted = await (await vote(voterA, -1)).json();
  assert.deepStrictEqual([voted.up, voted.down, voted.score], [0, 2, -2]);
  voted = await (await vote(voterB, 0)).json();
  assert.deepStrictEqual([voted.down, voted.myVote], [1, 0]);
  assert.strictEqual((await vote(headers, 1)).status, 400); // without voter id
  assert.strictEqual((await vote(voterA, 5)).status, 400);
  const listA = await (await fetch(`${base}/api/memes`, { headers: voterA })).json();
  assert.deepStrictEqual([listA[0].myVote, listA[0].score], [-1, -1]);
  const listB = await (await fetch(`${base}/api/memes`, { headers: voterB })).json();
  assert.strictEqual(listB[0].myVote, 0);

  // Awards: each voter gives each award once, can take it back
  const types = await (await fetch(`${base}/api/awards`, { headers })).json();
  assert.ok(types.some((a) => a.id === 'gold'));
  const award = (h, a, given) => fetch(`${base}/api/memes/${meme.id}/awards`, { method: 'POST', headers: h, body: JSON.stringify({ award: a, given }) });
  let awarded = await (await award(voterA, 'gold', true)).json();
  awarded = await (await award(voterA, 'gold', true)).json();
  awarded = await (await award(voterA, 'fire', true)).json();
  assert.deepStrictEqual(awarded.awards, { gold: 1, fire: 1 });
  assert.deepStrictEqual(awarded.myAwards, ['gold', 'fire']);
  awarded = await (await award(voterB, 'gold', true)).json();
  assert.deepStrictEqual([awarded.awards.gold, awarded.myAwards], [2, ['gold']]);
  awarded = await (await award(voterA, 'fire', false)).json();
  assert.deepStrictEqual([awarded.awards, awarded.myAwards], [{ gold: 2 }, ['gold']]);
  assert.strictEqual((await award(voterA, 'platinum', true)).status, 400);
  assert.strictEqual((await award(voterA, 'gold', 'yes')).status, 400);
  assert.strictEqual((await award(headers, 'gold', true)).status, 400);

  // Meme löschen räumt auch die Kommentar-Bilder weg
  assert.strictEqual((await fetch(`${base}/api/memes/${meme.id}`, { method: 'DELETE', headers })).status, 204);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.strictEqual((await fetch(`${base}/uploads/${file}`, { headers })).status, 404);
});

// OIDC login against a fake identity provider (discovery, JWKS, token endpoint)
test('OIDC-Login', async (t) => {
  const http = require('node:http');
  const crypto = require('node:crypto');
  const APP_PORT = 3998;
  const app = `http://127.0.0.1:${APP_PORT}`;
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };

  const sign = (claims, key = privateKey, header = { alg: 'RS256', kid: 'k1', typ: 'JWT' }) => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const input = `${enc(header)}.${enc(claims)}`;
    return `${input}.${crypto.sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
  };

  // code -> function(authRequest) returning the id_token
  const codes = new Map();
  let lastAuth = null;
  const idp = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (status, data) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
    if (url.pathname === '/realms/test/.well-known/openid-configuration') {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
        token_endpoint: `${issuer}/protocol/openid-connect/token`,
        jwks_uri: `${issuer}/protocol/openid-connect/certs`,
      });
    }
    if (url.pathname === '/realms/test/protocol/openid-connect/certs') return json(200, { keys: [jwk] });
    if (url.pathname === '/realms/test/protocol/openid-connect/token' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const p = new URLSearchParams(body);
      const auth = Buffer.from((req.headers.authorization || '').replace('Basic ', ''), 'base64').toString();
      const challenge = crypto.createHash('sha256').update(p.get('code_verifier') || '').digest('base64url');
      const make = codes.get(p.get('code'));
      codes.delete(p.get('code'));
      if (!make || auth !== 'meme:geheim' || challenge !== lastAuth.get('code_challenge') || p.get('redirect_uri') !== `${app}/auth/callback`) {
        return json(400, { error: 'invalid_grant' });
      }
      return json(200, { access_token: 'x', token_type: 'Bearer', id_token: make(lastAuth) });
    }
    json(404, {});
  });
  await new Promise((r) => idp.listen(0, '127.0.0.1', r));
  const issuer = `http://127.0.0.1:${idp.address().port}/realms/test`;

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meme-test-'));
  const server = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env, PORT: APP_PORT, DATA_DIR: dataDir, TRUST_PROXY: 'false',
      OIDC_ISSUER: issuer + '/', OIDC_CLIENT_ID: 'meme', OIDC_CLIENT_SECRET: 'geheim', APP_URL: app,
      APP_USERNAME: 'u', APP_PASSWORD: 'p',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    server.kill();
    idp.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    server.stdout.once('data', resolve);
    server.once('exit', () => reject(new Error(`Server nicht gestartet (Port ${APP_PORT} belegt?)`)));
  });

  const get = (p, cookie) => fetch(`${app}${p}`, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
  const cookies = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]);
  const claims = (auth, extra = {}) => ({
    iss: issuer, aud: 'meme', azp: 'meme', sub: 'u1', preferred_username: 'alice', nonce: auth.get('nonce'),
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, ...extra,
  });

  // Runs the flow up to the callback; returns the callback response
  async function login(makeToken, { tamperState = false } = {}) {
    const start = await get('/auth/login');
    assert.strictEqual(start.status, 303);
    lastAuth = new URL(start.headers.get('location')).searchParams;
    assert.strictEqual(lastAuth.get('code_challenge_method'), 'S256');
    const code = crypto.randomUUID();
    codes.set(code, makeToken);
    const state = tamperState ? 'falsch' : lastAuth.get('state');
    return get(`/auth/callback?code=${code}&state=${state}`, cookies(start)[0]);
  }
  const isError = (res) => res.status === 303 && res.headers.get('location') === '/login?error=oidc';

  // Login page offers both: Keycloak button and the password form for the standard user
  const page = await get('/login');
  assert.strictEqual(page.status, 200);
  const html = await page.text();
  assert.match(html, /href="\/auth\/login"/);
  assert.match(html, /name="password"/);
  const pw = await fetch(`${app}/login`, { method: 'POST', body: new URLSearchParams({ username: 'u', password: 'p' }), redirect: 'manual' });
  assert.strictEqual(pw.headers.get('location'), '/');
  const pwSession = cookies(pw).find((c) => c.startsWith('session='));
  assert.deepStrictEqual(await (await get('/api/me', pwSession)).json(), { id: 'local', name: 'u' });
  const wrong = await fetch(`${app}/login`, { method: 'POST', body: new URLSearchParams({ username: 'u', password: 'x' }), redirect: 'manual' });
  assert.strictEqual(wrong.headers.get('location'), '/login?error=1');

  // Happy path
  const ok = await login((a) => sign(claims(a)));
  assert.strictEqual(ok.status, 303);
  assert.strictEqual(ok.headers.get('location'), '/');
  const session = cookies(ok).find((c) => c.startsWith('session='));
  assert.ok(session && session.length > 'session='.length);
  assert.ok(cookies(ok).includes('oidc_pending='));
  assert.strictEqual((await get('/api/memes', session)).status, 200);

  // Logout ends the session and lands on the page with the button
  const out = await fetch(`${app}/logout`, { method: 'POST', redirect: 'manual', headers: { Cookie: session } });
  assert.strictEqual(out.headers.get('location'), '/login');
  assert.strictEqual((await get('/api/memes', session)).status, 401);

  // Uploader and comment authors come from the ID token; only authors can delete comments
  const loginAs = async (sub, name) => cookies(await login((a) => sign(claims(a, { sub, name })))).find((c) => c.startsWith('session='));
  const alice = await loginAs('u1', 'Alice Example');
  const bob = await loginAs('u2', 'Bob');
  assert.deepStrictEqual(await (await get('/api/me', alice)).json(), { id: 'u1', name: 'Alice Example' });
  const post = (p, cookie, init = {}) => fetch(`${app}${p}`, { method: 'POST', ...init, headers: { Cookie: cookie, ...init.headers } });
  const meme = await (await post('/api/memes?name=x', alice, { body: GIF })).json();
  assert.deepStrictEqual(meme.uploadedBy, { id: 'u1', name: 'Alice Example' });
  const withComment = await (await post(`/api/memes/${meme.id}/comments`, bob, { headers: { 'X-Comment-Text': 'hi' }, body: GIF })).json();
  const c = withComment.comments[0];
  assert.deepStrictEqual(c.author, { id: 'u2', name: 'Bob' });
  const del = (cookie) => fetch(`${app}/api/memes/${meme.id}/comments/${c.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.strictEqual((await del(alice)).status, 403);
  const afterDelete = await del(bob);
  assert.strictEqual(afterDelete.status, 200);
  assert.strictEqual((await afterDelete.json()).comments.length, 0);
  assert.strictEqual((await del(bob)).status, 404);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.strictEqual((await get(`/uploads/${c.file}`, bob)).status, 404);

  // Rejected tokens
  assert.ok(isError(await login((a) => sign(claims(a)), { tamperState: true })), 'state');
  assert.ok(isError(await login((a) => sign(claims(a, { nonce: 'falsch' })))), 'nonce');
  assert.ok(isError(await login((a) => sign(claims(a), other))), 'signature');
  assert.ok(isError(await login((a) => sign(claims(a, { aud: 'andere-app', azp: 'andere-app' })))), 'aud');
  assert.ok(isError(await login((a) => sign(claims(a, { iss: 'http://evil/realms/test' })))), 'iss');
  assert.ok(isError(await login((a) => sign(claims(a, { exp: Math.floor(Date.now() / 1000) - 3600 })))), 'exp');
  assert.ok(isError(await login((a) => sign(claims(a), privateKey, { alg: 'none', kid: 'k1' }))), 'alg');
  // Callback without the pending cookie (e.g. login CSRF)
  assert.ok(isError(await get('/auth/callback?code=x&state=y')), 'no cookie');
});

// Sessions survive a restart, including legacy sessions (plain expiry timestamp)
test('Sessions nach Neustart', async (t) => {
  const crypto = require('node:crypto');
  const RESTART_PORT = 3997;
  const url = `http://127.0.0.1:${RESTART_PORT}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meme-test-'));
  let server;
  const start = async () => {
    server = spawn(process.execPath, ['server.js'], {
      cwd: __dirname,
      env: { ...process.env, PORT: RESTART_PORT, DATA_DIR: dataDir, TRUST_PROXY: 'false', APP_USERNAME: 'u', APP_PASSWORD: 'p' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      server.stdout.once('data', resolve);
      server.once('exit', () => reject(new Error('Server nicht gestartet')));
    });
  };
  const stop = () => new Promise((resolve) => {
    server.removeAllListeners('exit');
    if (server.exitCode !== null || server.signalCode !== null) return resolve();
    server.once('exit', resolve);
    server.kill();
  });
  t.after(async () => {
    await stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await start();
  const login = await fetch(`${url}/login`, { method: 'POST', body: new URLSearchParams({ username: 'u', password: 'p' }), redirect: 'manual' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  await stop();

  // Add a legacy session in the old format
  const legacyToken = crypto.randomBytes(32).toString('base64url');
  const file = path.join(dataDir, 'sessions.json');
  const store = JSON.parse(fs.readFileSync(file, 'utf8'));
  store.sessions[crypto.createHash('sha256').update(legacyToken).digest('hex')] = Date.now() + 60000;
  fs.writeFileSync(file, JSON.stringify(store));

  await start();
  const me = async (c) => (await fetch(`${url}/api/me`, { headers: { Cookie: c } })).json();
  assert.deepStrictEqual(await me(cookie), { id: 'local', name: 'u' });
  assert.deepStrictEqual(await me(`session=${legacyToken}`), { id: 'local', name: 'u' });
});
