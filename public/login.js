const MESSAGES = {
  blocked: 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.',
  oidc: 'Anmeldung über Keycloak fehlgeschlagen. Bitte erneut versuchen.',
};
const error = new URLSearchParams(location.search).get('error');
if (error) {
  const el = document.getElementById('error');
  el.textContent = MESSAGES[error] || 'Benutzername oder Passwort falsch.';
  el.hidden = false;
}
