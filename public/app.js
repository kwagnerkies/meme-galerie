const $ = (id) => document.getElementById(id);

const gallery = $('gallery');
const statusEl = $('status');
const search = $('search');
const sort = $('sort');
const uploadDialog = $('upload-dialog');
const viewDialog = $('view-dialog');
const changelogDialog = $('changelog-dialog');
const viewVideo = $('view-video');

const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const isVideoFile = (file) => VIDEO_TYPES.includes(file.type);
const isVideo = (meme) => meme.file.endsWith('.mp4');

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
// voteCache: { memeId: 1|-1 }
const voteCache = readCache('votes');
const saveVoteCache = () => storageSet('votes', JSON.stringify(voteCache));
try {
  localStorage.removeItem('awards'); // left over from the removed awards feature
} catch {
  // storage blocked
}

// Backend is authoritative; keep the cache in sync with what it reports
function syncVoteCache(list) {
  for (const meme of list) {
    if (meme.myVote) voteCache[meme.id] = meme.myVote;
    else delete voteCache[meme.id];
  }
  const ids = new Set(memes.map((m) => m.id));
  for (const id of Object.keys(voteCache)) if (!ids.has(id)) delete voteCache[id];
  saveVoteCache();
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

// Sort keys; ties (and the default) go by upload date, newest first
const SORTS = {
  new: () => 0,
  up: (m) => m.up || 0,
  score: (m) => m.score || 0,
};
if (SORTS[storageGet('sort')]) sort.value = storageGet('sort');

function render() {
  const q = search.value.trim().toLowerCase();
  const key = SORTS[sort.value] || SORTS.new;
  const list = (q ? memes.filter((m) => m.name.toLowerCase().includes(q)) : [...memes])
    .sort((a, b) => key(b) - key(a) || b.createdAt.localeCompare(a.createdAt));

  gallery.replaceChildren(...list.map((meme) => {
    // Vote buttons live in the card, so the card itself is no button (no nested buttons)
    const card = document.createElement('div');
    card.className = 'card';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'card-open';
    open.title = meme.name;
    // Videos show their poster frame in the gallery, playing starts in the detail view
    const img = document.createElement('img');
    img.src = `/uploads/${meme.poster || meme.file}`;
    img.alt = meme.name;
    img.loading = 'lazy';
    const caption = document.createElement('span');
    caption.className = 'caption';
    caption.textContent = meme.name;
    if (meme.uploadedBy) open.title = `${meme.name} – von ${meme.uploadedBy.name}`;
    const foot = document.createElement('span');
    foot.className = 'card-foot';
    open.append(img, caption);
    if (isVideo(meme)) {
      const badge = document.createElement('span');
      badge.className = 'video-badge';
      badge.textContent = '▶';
      badge.setAttribute('aria-label', 'Video');
      open.append(badge);
    }
    foot.append(voteControl(meme));
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
sort.addEventListener('change', () => {
  storageSet('sort', sort.value);
  render();
});

// ---------- Upload ----------

function clearPreview() {
  for (const el of [$('preview'), $('preview-video')]) {
    if (el.src) URL.revokeObjectURL(el.src);
    el.removeAttribute('src');
    el.hidden = true;
  }
  $('preview-video').load(); // stops a playing preview
}

function setFile(file) {
  if (!file || !(file.type.startsWith('image/') || isVideoFile(file))) return;
  selectedFile = file;
  clearPreview();
  const preview = isVideoFile(file) ? $('preview-video') : $('preview');
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
  if (preview.play) preview.play().catch(() => {});
  $('drop-hint').hidden = true;
  const nameInput = $('name');
  if (!nameInput.value) nameInput.value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  nameInput.focus();
}

function openUpload(file) {
  $('upload-form').reset();
  selectedFile = null;
  clearPreview();
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
    errorEl.textContent = 'Bitte ein Bild oder Video auswählen.';
    errorEl.hidden = false;
    return;
  }
  const submit = $('upload-submit');
  submit.disabled = true;
  // Videos are shrunk on the server, that takes a moment
  submit.textContent = isVideoFile(selectedFile) ? 'Lädt hoch und verkleinert …' : 'Lädt hoch …';
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

// Videos loop without controls; sound only after a click
function setMuted(muted) {
  viewVideo.muted = muted;
  $('view-sound').textContent = muted ? '🔇 Klicken für Ton' : '🔊';
}

viewVideo.addEventListener('click', () => setMuted(!viewVideo.muted));

function stopVideo() {
  viewVideo.pause();
  viewVideo.removeAttribute('src');
  viewVideo.load();
}

function openView(meme) {
  current = meme;
  const video = isVideo(meme);
  $('view-img').hidden = video;
  $('view-video-wrap').hidden = !video;
  if (video) {
    $('view-img').removeAttribute('src');
    setMuted(true);
    viewVideo.poster = meme.poster ? `/uploads/${meme.poster}` : '';
    viewVideo.src = `/uploads/${meme.file}`;
    viewVideo.setAttribute('aria-label', `${meme.name} (Video, Klicken für Ton)`);
    viewVideo.play().catch(() => {});
  } else {
    stopVideo();
    $('view-img').src = `/uploads/${meme.file}`;
  }
  $('view-img').alt = meme.name;
  $('view-name').value = meme.name;
  const date = new Date(meme.createdAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  $('view-meta').textContent = meme.uploadedBy ? `Hochgeladen von ${meme.uploadedBy.name} am ${date}` : `Hochgeladen am ${date}`;
  $('view-download').href = `/uploads/${meme.file}`;
  $('view-download').download = meme.name + meme.file.slice(meme.file.lastIndexOf('.'));
  resetCommentForm();
  renderComments();
  renderViewVotes();
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

viewDialog.addEventListener('close', stopVideo);
uploadDialog.addEventListener('close', clearPreview);

// ---------- Changelog ----------

// Pops up once per new entry: the browser remembers the date of the newest entry it has shown
async function showChangelog({ onlyIfNew = false } = {}) {
  const box = $('changelog');
  try {
    const entries = await api('/api/changelog');
    const newest = entries[0] && entries[0].date;
    if (onlyIfNew && (!newest || storageGet('changelogSeen') >= newest)) return;
    if (newest) storageSet('changelogSeen', newest);
    box.replaceChildren(...entries.map((entry) => {
      const section = document.createElement('section');
      const h = document.createElement('h3');
      h.textContent = new Date(entry.date).toLocaleDateString('de-DE', { dateStyle: 'long' });
      const ul = document.createElement('ul');
      for (const item of entry.items) {
        const li = document.createElement('li');
        li.textContent = item;
        ul.append(li);
      }
      section.append(h, ul);
      return section;
    }));
  } catch (err) {
    if (onlyIfNew) return;
    box.textContent = err.message;
  }
  if (!changelogDialog.open && !uploadDialog.open && !viewDialog.open) changelogDialog.showModal();
}

$('open-changelog').addEventListener('click', () => showChangelog());

// Dialoge schließen: Button oder Klick auf den Hintergrund
for (const dialog of [uploadDialog, viewDialog, changelogDialog]) {
  dialog.addEventListener('click', (e) => {
    const r = dialog.getBoundingClientRect();
    const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if ((e.target === dialog && outside) || e.target.closest('[data-close]')) dialog.close();
  });
}

// Opt in to the Flow UI; the server picks the page by this cookie
$('switch-ui').addEventListener('click', () => {
  document.cookie = `ui=flow; Path=/; Max-Age=${365 * 24 * 60 * 60}; SameSite=Lax`;
  location.reload();
});

api('/api/me')
  .then((user) => { me = user; $('me').textContent = user.name; })
  .catch(() => {})
  .then(load)
  .then(() => showChangelog({ onlyIfNew: true }))
  .catch((err) => { statusEl.textContent = err.message; });
