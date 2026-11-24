// Backend access plus the per-browser voter id and vote cache.
// Uses the same localStorage keys as the classic UI, so votes survive switching UIs.

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode or blocked storage: votes still work for this page view
  }
}

function randomUuid() {
  // randomUUID only exists in secure contexts (HTTPS/localhost)
  if (crypto.randomUUID) return crypto.randomUUID();
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16),
  );
}

export const voterId = (() => {
  let id = storageGet('voterId');
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) {
    id = randomUuid();
    storageSet('voterId', id);
  }
  return id;
})();

function readCache(key) {
  try {
    const value = JSON.parse(storageGet(key) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

// voteCache: { memeId: 1|-1 }
const voteCache = readCache('votes');
try {
  localStorage.removeItem('awards'); // left over from the removed awards feature
} catch {
  // storage blocked
}

// Backend is authoritative; mirror what it reports into the cache
export function syncVoteCache(memes, { prune = false } = {}) {
  for (const meme of memes) {
    if (meme.myVote) voteCache[meme.id] = meme.myVote;
    else delete voteCache[meme.id];
  }
  if (prune) {
    const ids = new Set(memes.map((m) => m.id));
    for (const id of Object.keys(voteCache)) if (!ids.has(id)) delete voteCache[id];
  }
  storageSet('votes', JSON.stringify(voteCache));
}

export async function api(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...options.headers, 'X-Voter-Id': voterId } });
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('Nicht angemeldet');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Fehler ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const jsonBody = (data) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

// Switches between the classic and the Flow UI; the server picks the page by this cookie
export function switchUi(ui) {
  const maxAge = ui === 'flow' ? 365 * 24 * 60 * 60 : 0;
  document.cookie = `ui=${ui}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
  location.reload();
}

export const formatDate = (iso) =>
  new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
