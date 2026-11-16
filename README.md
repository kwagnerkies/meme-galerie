# Meme-Galerie

Interne Galerie für Memes: Login, Bilder hochladen und benennen, Galerie mit Suche nach Namen.

- Ein Node.js-Server ohne externe Abhängigkeiten, also kein `npm install` nötig
- Bilder (JPG, PNG, GIF, WebP, max. 15 MB) liegen in `/data/uploads`, Namen in `/data/memes.json`
- Hochladen per Button, Drag & Drop oder Strg+V (Screenshot aus der Zwischenablage)
- Klick auf ein Bild: groß ansehen, kommentieren, umbenennen, herunterladen, löschen
- Kommentare (max. 500 Zeichen, 200 pro Meme) liegen mit in `memes.json`. Ein Kommentar kann ein Bild enthalten (📎, Strg+V oder Drag & Drop), es gelten dieselben Regeln wie beim Upload

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
| `APP_USERNAME`   | `cloud`   | Login-Benutzername                                       |
| `APP_PASSWORD`   | `hosting` | Login-Passwort                                           |
| `TRUST_PROXY`    | `true`    | `X-Forwarded-*`-Header vom Reverse-Proxy auswerten (bei mittwald richtig). Ohne Proxy auf `false` setzen |
| `MAX_UPLOAD_MB`  | `15`      | Maximale Dateigröße                                      |
| `PORT`           | `3000`    | Port im Container                                        |
| `DATA_DIR`       | `/data`   | Speicherort für Bilder und Metadaten                     |

Ein starkes Passwort erzeugen: `openssl rand -base64 24`

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
