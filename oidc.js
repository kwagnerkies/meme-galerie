'use strict';

// Minimal OpenID Connect client (Authorization Code flow with PKCE) without external
// dependencies. Written for Keycloak; expects ID tokens signed with RS256.

const crypto = require('crypto');

const FETCH_TIMEOUT_MS = 10 * 1000;
const JWKS_MIN_REFRESH_MS = 60 * 1000;
const CLOCK_SKEW_S = 60;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const randomToken = () => b64url(crypto.randomBytes(32));
const stripSlash = (s) => String(s).replace(/\/+$/, '');

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const text = await res.text();
  if (!res.ok) throw new Error(`OIDC: ${url} answered ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function createOidcClient({ issuer, clientId, clientSecret, redirectUri, scope = 'openid profile email' }) {
  const issuerUrl = stripSlash(issuer);
  let discovery = null; // cached only on success
  let jwks = null;
  let jwksFetchedAt = 0;

  async function getDiscovery() {
    if (!discovery) {
      const doc = await fetchJson(`${issuerUrl}/.well-known/openid-configuration`);
      if (stripSlash(doc.issuer) !== issuerUrl) throw new Error(`OIDC: issuer mismatch in discovery (${doc.issuer})`);
      discovery = doc;
    }
    return discovery;
  }

  async function getKey(kid) {
    const find = () => (jwks || []).find((k) => k.kid === kid && k.kty === 'RSA' && (!k.use || k.use === 'sig'));
    // Refetch on unknown kid (key rotation), but not more often than once a minute
    if (!find() && Date.now() - jwksFetchedAt > JWKS_MIN_REFRESH_MS) {
      const { jwks_uri: uri } = await getDiscovery();
      jwks = (await fetchJson(uri)).keys || [];
      jwksFetchedAt = Date.now();
    }
    const jwk = find();
    if (!jwk) throw new Error(`OIDC: no signing key found for kid ${kid}`);
    return crypto.createPublicKey({ key: jwk, format: 'jwk' });
  }

  async function verifyIdToken(token, nonce) {
    const parts = String(token).split('.');
    if (parts.length !== 3) throw new Error('OIDC: malformed ID token');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    if (header.alg !== 'RS256') throw new Error(`OIDC: unsupported ID token alg ${header.alg} (only RS256)`);
    const key = await getKey(header.kid);
    const valid = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
    if (!valid) throw new Error('OIDC: invalid ID token signature');

    const now = Math.floor(Date.now() / 1000);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (stripSlash(claims.iss) !== issuerUrl) throw new Error(`OIDC: wrong issuer ${claims.iss}`);
    if (!aud.includes(clientId)) throw new Error('OIDC: wrong audience');
    if (claims.azp && claims.azp !== clientId) throw new Error('OIDC: wrong azp');
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) throw new Error('OIDC: ID token expired');
    if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_S > now) throw new Error('OIDC: ID token issued in the future');
    if (!nonce || claims.nonce !== nonce) throw new Error('OIDC: nonce mismatch');
    return claims;
  }

  // Returns the URL to redirect the browser to and the values to keep until the callback
  async function startLogin() {
    const { authorization_endpoint: endpoint } = await getDiscovery();
    const pending = { state: randomToken(), nonce: randomToken(), verifier: randomToken() };
    const url = new URL(endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      state: pending.state,
      nonce: pending.nonce,
      code_challenge: b64url(crypto.createHash('sha256').update(pending.verifier).digest()),
      code_challenge_method: 'S256',
    }).toString();
    return { url: url.toString(), pending };
  }

  // Exchanges the authorization code and returns the verified ID token claims
  async function finishLogin(code, pending) {
    const { token_endpoint: endpoint } = await getDiscovery();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: pending.verifier,
    });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
    if (clientSecret) {
      const enc = (s) => encodeURIComponent(s);
      headers.Authorization = 'Basic ' + Buffer.from(`${enc(clientId)}:${enc(clientSecret)}`).toString('base64');
    }
    const tokens = await fetchJson(endpoint, { method: 'POST', headers, body });
    if (!tokens.id_token) throw new Error('OIDC: token response without id_token');
    return verifyIdToken(tokens.id_token, pending.nonce);
  }

  return { startLogin, finishLogin };
}

module.exports = { createOidcClient };
