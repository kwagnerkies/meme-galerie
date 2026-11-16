# Meme-Galerie

Interne Galerie für Memes: Login, Bilder hochladen und benennen, Galerie mit Suche nach Namen.

- Ein Node.js-Server ohne externe Abhängigkeiten, also kein `npm install` nötig
- Bilder (JPG, PNG, GIF, WebP, max. 15 MB) liegen in `/data/uploads`, Namen in `/data/memes.json`
- Hochladen per Button, Drag & Drop oder Strg+V (Screenshot aus der Zwischenablage)
- Klick auf ein Bild: groß ansehen, kommentieren, umbenennen, herunterladen, löschen
- Kommentare (max. 500 Zeichen, 200 pro Meme) liegen mit in `memes.json`. Ein Kommentar kann ein Bild enthalten (📎, Strg+V oder Drag & Drop), es gelten dieselben Regeln wie beim Upload
- Login wahlweise mit gemeinsamem Passwort oder per OpenID Connect (z. B. Keycloak), siehe [Login mit Keycloak](#login-mit-keycloak-oidc)
- Bei jedem Meme steht, wer es hochgeladen hat, bei jedem Kommentar, wer ihn geschrieben hat. Eigene Kommentare kann man löschen (✕). Wer sich mit dem Standard-User (Passwort) anmeldet, teilt sich diesen Benutzer mit allen anderen Passwort-Logins, deren Kommentare können also gegenseitig gelöscht werden

## Sicherheit

- Login mit serverseitigen Sessions (HttpOnly-Cookie, 30 Tage). Logout beendet die Session sofort. Ändert man Benutzername oder Passwort, sind alle Geräte abgemeldet
- Nach 10 falschen Logins pro IP ist das Login 15 Minuten gesperrt. Jeder Fehlversuch wird zusätzlich um 1 Sekunde verzögert und geloggt
- Schutz gegen CSRF (Prüfung von Origin und Sec-Fetch-Site), strenge Content-Security-Policy und weitere Security-Header, HSTS hinter HTTPS
- Den Bildtyp erkennt der Server am Dateiinhalt. Erlaubt sind nur JPG, PNG, GIF und WebP, also kein SVG/HTML
- **Metadaten werden entfernt**: EXIF (z. B. GPS-Position vom Handy), XMP, IPTC und Kommentare. Bei JPEGs bleibt nur die Bildausrichtung erhalten
- Container läuft ohne root, npm ist aus dem Image entfernt
- Bilder und Daten werden mit Dateirechten `600` gespeichert, also nur für den Container-User zugänglich. Die Sessions werden nur als Hash gespeichert

## Konfiguration (Umgebungsvariablen)

| Variable         | Standard  | Bedeutung                                                |
|------------------|-----------|----------------------------------------------------------|
| `APP_USERNAME`   | `cloud`   | Benutzername des Standard-Users                          |
| `APP_PASSWORD`   | `hosting` | Passwort des Standard-Users                              |
| `OIDC_ISSUER`    | –         | Issuer-URL, z. B. `https://sso.example.de/realms/firma`. Ist sie gesetzt, gibt es auf der Login-Seite zusätzlich „Mit Keycloak anmelden“ |
| `OIDC_CLIENT_ID` | –         | Client-ID aus Keycloak                                   |
| `OIDC_CLIENT_SECRET` | –     | Client-Secret (bei „Client authentication: On“)          |
| `APP_URL`        | –         | Öffentliche URL der Galerie ohne `/` am Ende, z. B. `https://memes.example.de`. Daraus wird die Redirect-URI `<APP_URL>/auth/callback` |
| `OIDC_SCOPE`     | `openid profile email` | Angefragte Scopes                           |
| `TRUST_PROXY`    | `true`    | `X-Forwarded-*`-Header vom Reverse-Proxy auswerten (bei mittwald richtig). Ohne Proxy auf `false` setzen |
| `MAX_UPLOAD_MB`  | `15`      | Maximale Dateigröße                                      |
| `PORT`           | `3000`    | Port im Container                                        |
| `DATA_DIR`       | `/data`   | Speicherort für Bilder und Metadaten                     |

Ein starkes Passwort erzeugen: `openssl rand -base64 24`

## Login mit Keycloak (OIDC)

1. In Keycloak im gewünschten Realm einen Client anlegen:
   - Client type: `OpenID Connect`, Client ID z. B. `meme-galerie`
   - Client authentication: `On` (vertraulicher Client), Standard flow: an, alle anderen Flows aus
   - Valid redirect URIs: `https://<domain>/auth/callback`
   - Unter *Advanced* → PKCE Method `S256` (empfohlen)
2. Unter *Credentials* das Client-Secret kopieren.
3. Container-Umgebung setzen: `OIDC_ISSUER=https://<keycloak>/realms/<realm>`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `APP_URL=https://<domain>`.

Hinweise:

- Der Login mit Standard-User und Passwort bleibt zusätzlich möglich. Wer ihn nicht braucht, sollte `APP_PASSWORD` trotzdem auf ein langes, zufälliges Passwort setzen.
- Beim Ein- oder Umstellen von OIDC werden alle bestehenden Sessions ungültig.
- Eine Session über Keycloak gilt 12 Stunden (mit Passwort weiterhin 30 Tage), danach geht es per SSO-Redirect neu durch Keycloak. Wer in Keycloak gesperrt wird, verliert den Zugriff also spätestens nach 12 Stunden.
- Abmelden beendet nur die Session in der Galerie, nicht die Keycloak-Session.
- Anmelden kann sich jeder Benutzer des Realms. Wer das einschränken will, macht das in Keycloak (z. B. eigener Realm oder ein Authentication-Flow, der eine Rolle prüft). Eine Rollenprüfung in der Galerie selbst gibt es noch nicht.
- Als Name wird `name`, sonst `preferred_username`, sonst `email` aus dem ID-Token angezeigt. Ändert sich der Name in Keycloak, bleiben bereits gespeicherte Memes und Kommentare beim alten Namen.
- ID-Tokens müssen mit RS256 signiert sein (Keycloak-Standard).

## Lokal testen

```bash
docker compose up --build
# -> http://localhost:3000
```

Oder ohne Docker: `node server.js` (Node 20 oder neuer, Daten landen in `./data`).

## Deployment bei mittwald (Container)

1. **Image bauen und in eine Registry pushen** (z. B. Docker Hub oder GitHub Container Registry):
   ```bash
   docker build -t <registry>/<name>/meme-galerie:latest .
   docker push <registry>/<name>/meme-galerie:latest
   ```
   Ist die Registry privat, die Zugangsdaten im mStudio als Registry hinterlegen.

2. **Container im mStudio anlegen**
   - Image: `<registry>/<name>/meme-galerie:latest`
   - Port: `3000`
   - Umgebungsvariablen: `APP_USERNAME` und `APP_PASSWORD` (dringend empfohlen: ein langes Passwort statt `hosting`)
   - **Volume an `/data` mounten.** Ohne Volume gehen alle Bilder beim Neustart oder Update verloren

3. **Domain verbinden:** Im mStudio eine Domain bzw. Subdomain auf den Container (Port 3000) zeigen lassen. HTTPS übernimmt mittwald.

4. **Prüfen:** `https://<domain>/healthz` sollte `ok` liefern, `https://<domain>/` zeigt den Login.

**Startet der Container nicht** und im Log steht `/data ist nicht beschreibbar`, gehört das Volume nicht dem Container-User (`node`, UID 1000). Dann im Dockerfile die Zeile `USER node` entfernen und das Image neu bauen.

## Backup

Den Inhalt des Volumes `/data` sichern (`memes.json` und der Ordner `uploads/`).
