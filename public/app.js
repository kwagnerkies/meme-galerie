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

async function api(url, options = {}) {
  const res = await fetch(url, options);
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
  render();
}

function render() {
  const q = search.value.trim().toLowerCase();
  const list = q ? memes.filter((m) => m.name.toLowerCase().includes(q)) : memes;

  gallery.replaceChildren(...list.map((meme) => {
    const card = document.createElement('button');
    card.className = 'card';
    card.type = 'button';
    card.title = meme.name;
    const img = document.createElement('img');
    img.src = `/uploads/${meme.file}`;
    img.alt = meme.name;
    img.loading = 'lazy';
    const caption = document.createElement('span');
    caption.className = 'caption';
    caption.textContent = meme.name;
    if (meme.uploadedBy) card.title = `${meme.name} – von ${meme.uploadedBy.name}`;
    const foot = document.createElement('span');
    foot.className = 'card-foot';
    foot.append(caption);
    const count = (meme.comments || []).length;
    if (count) {
      // Eigenes Element, damit ein langer Name den Zähler nicht abschneidet
      const badge = document.createElement('span');
      badge.className = 'count';
      badge.textContent = `💬 ${count}`;
      badge.title = `${count} Kommentare`;
      foot.append(badge);
    }
    card.append(img, foot);
    card.addEventListener('click', () => openView(meme));
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
  .then(load)
  .catch((err) => { statusEl.textContent = err.message; });
