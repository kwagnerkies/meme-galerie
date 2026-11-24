const $ = (id) => document.getElementById(id);

const gallery = $('gallery');
const statusEl = $('status');
const search = $('search');
const uploadDialog = $('upload-dialog');
const viewDialog = $('view-dialog');

let memes = [];
let selectedFile = null;
let current = null;
let me = null;

// ---------- Votes ----------
// Everybody logs in as the same user, so the browser gets its own voter id. The own votes are
// cached in localStorage (instant display) and stored in the backend (totals for everybody).

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

const voterId = (() => {
  let id = storageGet('voterId');
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) {
    // randomUUID only exists in secure contexts (HTTPS/localhost)
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
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
// voteCache: { memeId: 1|-1 }, awardCache: { memeId: [awardId, …] }
const voteCache = readCache('votes');
const awardCache = readCache('awards');
function saveVoteCache() {
  storageSet('votes', JSON.stringify(voteCache));
  storageSet('awards', JSON.stringify(awardCache));
}

// Backend is authoritative; keep the cache in sync with what it reports
function syncVoteCache(list) {
  for (const meme of list) {
    if (meme.myVote) voteCache[meme.id] = meme.myVote;
    else delete voteCache[meme.id];
    if (meme.myAwards && meme.myAwards.length) awardCache[meme.id] = meme.myAwards;
    else delete awardCache[meme.id];
  }
  const ids = new Set(memes.map((m) => m.id));
  for (const cache of [voteCache, awardCache]) {
    for (const id of Object.keys(cache)) if (!ids.has(id)) delete cache[id];
  }
  saveVoteCache();
}

// ---------- Awards ----------

let awardTypes = []; // [{ id, name }] from /api/awards

// Icon from the SVG sprite in index.html
function awardIcon(id) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'award-icon');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `#award-${id}`);
  svg.append(use);
  return svg;
}
const awardType = (id) => awardTypes.find((a) => a.id === id);
const myAwards = (meme) => awardCache[meme.id] || [];

// Compact display for the gallery card: up to three icons plus the total
function awardBadge(meme) {
  const entries = Object.entries(meme.awards || {}).filter(([id]) => awardType(id));
  if (!entries.length) return null;
  const badge = document.createElement('span');
  badge.className = 'award-badge';
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  const top = [...entries].sort((a, b) => b[1] - a[1]).slice(0, 3);
  badge.append(...top.map(([id]) => awardIcon(id)));
  if (total > 1) badge.append(String(total));
  badge.title = entries.map(([id, n]) => `${awardType(id).name} ×${n}`).join(', ');
  return badge;
}

// Detail view: one toggle button per award type
function renderViewAwards() {
  if (!current) return;
  const meme = current;
  const mine = myAwards(meme);
  $('view-awards').replaceChildren(...awardTypes.map((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    const given = mine.includes(a.id);
    const count = (meme.awards || {})[a.id] || 0;
    b.className = 'award' + (given ? ' active' : '');
    b.append(awardIcon(a.id));
    if (count) b.append(String(count));
    b.title = given ? `${a.name} – zurücknehmen` : `${a.name} vergeben`;
    b.setAttribute('aria-label', b.title);
    b.setAttribute('aria-pressed', String(given));
    b.addEventListener('click', () => giveAward(meme, a.id, !given));
    return b;
  }));
}

async function giveAward(meme, award, given) {
  // Optimistic like votes: update right away, roll back on error
  const previous = { awards: { ...(meme.awards || {}) }, myAwards: myAwards(meme) };
  const counts = { ...(meme.awards || {}) };
  counts[award] = (counts[award] || 0) + (given ? 1 : -1);
  if (counts[award] <= 0) delete counts[award];
  meme.awards = counts;
  meme.myAwards = given ? [...previous.myAwards, award] : previous.myAwards.filter((id) => id !== award);
  syncVoteCache([meme]);
  render();
  if (current === meme) renderViewAwards();
  try {
    const updated = await api(`/api/memes/${meme.id}/awards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ award, given }),
    });
    Object.assign(meme, updated);
  } catch (err) {
    Object.assign(meme, previous);
    alert(err.message);
  }
  syncVoteCache([meme]);
  render();
  if (current === meme) renderViewAwards();
}

const myVote = (meme) => voteCache[meme.id] || 0;

function voteControl(meme) {
  const wrap = document.createElement('span');
  wrap.className = 'votes';
  const mine = myVote(meme);
  const make = (value, label, symbol) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vote' + (mine === value ? ' active' : '');
    b.textContent = symbol;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-pressed', String(mine === value));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      vote(meme, mine === value ? 0 : value);
    });
    return b;
  };
  const score = document.createElement('span');
  score.className = 'score';
  score.textContent = meme.score || 0;
  score.title = `${meme.up || 0} 👍 / ${meme.down || 0} 👎`;
  wrap.append(make(1, 'Upvote', '▲'), score, make(-1, 'Downvote', '▼'));
  return wrap;
}

function renderViewVotes() {
  if (current) $('view-votes').replaceChildren(voteControl(current));
}

async function vote(meme, value) {
  // Optimistic: update cache and counts right away, roll back on error
  const previous = { ...meme, myVote: myVote(meme) };
  const old = previous.myVote;
  if (old > 0) meme.up--;
  if (old < 0) meme.down--;
  if (value > 0) meme.up = (meme.up || 0) + 1;
  if (value < 0) meme.down = (meme.down || 0) + 1;
  meme.score = (meme.up || 0) - (meme.down || 0);
  if (value) voteCache[meme.id] = value;
  else delete voteCache[meme.id];
  saveVoteCache();
  render();
  if (current === meme) renderViewVotes();
  try {
    const updated = await api(`/api/memes/${meme.id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vote: value }),
    });
    Object.assign(meme, updated);
    syncVoteCache([meme]);
  } catch (err) {
    Object.assign(meme, previous);
    if (old) voteCache[meme.id] = old;
    else delete voteCache[meme.id];
    saveVoteCache();
    alert(err.message);
  }
  render();
  if (current === meme) renderViewVotes();
}

async function api(url, options = {}) {
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

// ---------- Galerie ----------

async function load() {
  memes = await api('/api/memes');
  syncVoteCache(memes);
  render();
}

function render() {
  const q = search.value.trim().toLowerCase();
  const list = q ? memes.filter((m) => m.name.toLowerCase().includes(q)) : memes;

  gallery.replaceChildren(...list.map((meme) => {
    // Vote buttons live in the card, so the card itself is no button (no nested buttons)
    const card = document.createElement('div');
    card.className = 'card';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'card-open';
    open.title = meme.name;
    const img = document.createElement('img');
    img.src = `/uploads/${meme.file}`;
    img.alt = meme.name;
    img.loading = 'lazy';
    const caption = document.createElement('span');
    caption.className = 'caption';
    caption.textContent = meme.name;
    if (meme.uploadedBy) open.title = `${meme.name} – von ${meme.uploadedBy.name}`;
    const foot = document.createElement('span');
    foot.className = 'card-foot';
    open.append(img, caption);
    foot.append(voteControl(meme));
    const awards = awardBadge(meme);
    if (awards) foot.append(awards);
    const count = (meme.comments || []).length;
    if (count) {
      // Eigenes Element, damit ein langer Name den Zähler nicht abschneidet
      const badge = document.createElement('span');
      badge.className = 'count';
      badge.textContent = `💬 ${count}`;
      badge.title = `${count} Kommentare`;
      foot.append(badge);
    }
    card.append(open, foot);
    open.addEventListener('click', () => openView(meme));
    return card;
  }));

  if (memes.length === 0) statusEl.textContent = 'Noch keine Memes. Lad das erste hoch!';
  else if (list.length === 0) statusEl.textContent = `Keine Memes zu „${search.value.trim()}“ gefunden.`;
  else statusEl.textContent = q ? `${list.length} von ${memes.length} Memes` : `${memes.length} Memes`;
}

search.addEventListener('input', render);

// ---------- Upload ----------

function setFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  selectedFile = file;
  const preview = $('preview');
  if (preview.src) URL.revokeObjectURL(preview.src);
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
  $('drop-hint').hidden = true;
  const nameInput = $('name');
  if (!nameInput.value) nameInput.value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  nameInput.focus();
}

function openUpload(file) {
  $('upload-form').reset();
  selectedFile = null;
  $('preview').hidden = true;
  $('drop-hint').hidden = false;
  $('upload-error').hidden = true;
  if (!uploadDialog.open) uploadDialog.showModal();
  if (file) setFile(file);
}

$('open-upload').addEventListener('click', () => openUpload());
$('file').addEventListener('change', (e) => setFile(e.target.files[0]));

const dropzone = $('dropzone');
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('over');
  setFile(e.dataTransfer.files[0]);
});

// Bild auf die Seite ziehen öffnet direkt den Upload
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (viewDialog.open) setCommentFile(file);
  else if (!uploadDialog.open) openUpload(file);
});

// Strg+V mit Bild in der Zwischenablage
document.addEventListener('paste', (e) => {
  const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'));
  if (!item) return;
  // In der Detailansicht wird das Bild an den Kommentar gehängt
  if (viewDialog.open) setCommentFile(item.getAsFile());
  else openUpload(item.getAsFile());
});

$('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = $('upload-error');
  errorEl.hidden = true;
  if (!selectedFile) {
    errorEl.textContent = 'Bitte ein Bild auswählen.';
    errorEl.hidden = false;
    return;
  }
  const submit = $('upload-submit');
  submit.disabled = true;
  submit.textContent = 'Lädt hoch …';
  try {
    const name = encodeURIComponent($('name').value.trim());
    const meme = await api(`/api/memes?name=${name}`, {
      method: 'POST',
      headers: { 'Content-Type': selectedFile.type },
      body: selectedFile,
    });
    memes.unshift(meme);
    render();
    uploadDialog.close();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Hochladen';
  }
});

// ---------- Detailansicht ----------

function openView(meme) {
  current = meme;
  $('view-img').src = `/uploads/${meme.file}`;
  $('view-img').alt = meme.name;
  $('view-name').value = meme.name;
  const date = new Date(meme.createdAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  $('view-meta').textContent = meme.uploadedBy ? `Hochgeladen von ${meme.uploadedBy.name} am ${date}` : `Hochgeladen am ${date}`;
  $('view-download').href = `/uploads/${meme.file}`;
  $('view-download').download = meme.name + meme.file.slice(meme.file.lastIndexOf('.'));
  resetCommentForm();
  renderComments();
  renderViewVotes();
  renderViewAwards();
  viewDialog.showModal();
}

let commentFile = null;

function setCommentFile(file) {
  commentFile = file && file.type.startsWith('image/') ? file : null;
  $('comment-attach').textContent = commentFile ? '📎 ✓' : '📎';
  $('comment-attach').setAttribute('aria-label', commentFile ? 'Bild angehängt, anderes wählen' : 'Bild anhängen');
}

$('comment-attach').addEventListener('click', () => {
  $('comment-file').value = ''; // sonst meldet der Browser dieselbe Datei kein zweites Mal
  $('comment-file').click();
});

function resetCommentForm() {
  $('comment-form').reset();
  setCommentFile(null);
}

$('comment-file').addEventListener('change', (e) => setCommentFile(e.target.files[0]));

function renderComments() {
  $('comments').replaceChildren(...(current.comments || []).map((comment) => {
    const li = document.createElement('li');
    const time = document.createElement('time');
    time.dateTime = comment.createdAt;
    time.textContent = new Date(comment.createdAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
    const head = document.createElement('span');
    head.className = 'comment-head';
    if (comment.author) {
      const author = document.createElement('strong');
      author.textContent = comment.author.name;
      head.append(author);
    }
    head.append(time);
    if (me && comment.author && comment.author.id === me.id) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'comment-delete';
      del.textContent = '✕';
      del.title = 'Kommentar löschen';
      del.setAttribute('aria-label', 'Kommentar löschen');
      del.addEventListener('click', () => deleteComment(comment));
      head.append(del);
    }
    li.append(head, comment.text);
    if (comment.file) {
      const img = document.createElement('img');
      img.src = `/uploads/${comment.file}`;
      img.alt = comment.text || 'Bild im Kommentar';
      img.loading = 'lazy';
      li.append(img);
    }
    return li;
  }));
  $('comments').scrollTop = $('comments').scrollHeight;
}

async function deleteComment(comment) {
  if (!confirm('Kommentar wirklich löschen?')) return;
  const meme = current;
  try {
    Object.assign(meme, await api(`/api/memes/${meme.id}/comments/${comment.id}`, { method: 'DELETE' }));
    if (current === meme) renderComments();
    render();
  } catch (err) {
    alert(err.message);
  }
}

$('comment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const meme = current; // Dialog kann während des Uploads zu einem anderen Meme wechseln
  const submit = $('comment-submit');
  submit.disabled = true;
  try {
    const headers = { 'X-Comment-Text': encodeURIComponent($('comment-text').value.trim()) };
    if (commentFile) headers['Content-Type'] = commentFile.type;
    const updated = await api(`/api/memes/${meme.id}/comments`, { method: 'POST', headers, body: commentFile });
    Object.assign(meme, updated);
    if (current === meme) {
      resetCommentForm();
      renderComments();
    }
    render();
  } catch (err) {
    alert(err.message);
  } finally {
    submit.disabled = false;
  }
});

$('rename-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const updated = await api(`/api/memes/${current.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: $('view-name').value }),
    });
    Object.assign(current, updated);
    render();
    viewDialog.close();
  } catch (err) {
    alert(err.message);
  }
});

$('view-delete').addEventListener('click', async () => {
  if (!confirm(`„${current.name}“ wirklich löschen?`)) return;
  try {
    await api(`/api/memes/${current.id}`, { method: 'DELETE' });
    memes = memes.filter((m) => m.id !== current.id);
    render();
    viewDialog.close();
  } catch (err) {
    alert(err.message);
  }
});

// Dialoge schließen: Button oder Klick auf den Hintergrund
for (const dialog of [uploadDialog, viewDialog]) {
  dialog.addEventListener('click', (e) => {
    const r = dialog.getBoundingClientRect();
    const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if ((e.target === dialog && outside) || e.target.closest('[data-close]')) dialog.close();
  });
}

api('/api/me')
  .then((user) => { me = user; $('me').textContent = user.name; })
  .catch(() => {})
  .then(() => api('/api/awards'))
  .then((types) => { awardTypes = types; })
  .catch(() => {})
  .then(load)
  .catch((err) => { statusEl.textContent = err.message; });
