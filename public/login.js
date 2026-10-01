const error = new URLSearchParams(location.search).get('error');
if (error) {
  const el = document.getElementById('error');
  el.textContent = error === 'blocked'
    ? 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.'
    : 'Benutzername oder Passwort falsch.';
  el.hidden = false;
}
