'use strict';

// Prüft hochgeladene Bilder und entfernt Metadaten (EXIF inkl. GPS-Position, XMP, Kommentare).
// Bei JPEGs bleibt nur die Ausrichtung erhalten, damit Handyfotos nicht gedreht angezeigt werden.
// Gibt den bereinigten Buffer zurück oder null, wenn die Datei kein gültiges Bild ist.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_METADATA_CHUNKS = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

function readOrientation(app1) {
  // app1 = Segmentinhalt ohne Marker/Länge, beginnt mit "Exif\0\0"
  try {
    const tiff = app1.subarray(6);
    const le = tiff.toString('ascii', 0, 2) === 'II';
    const u16 = (o) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
    const u32 = (o) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
    const ifd = u32(4);
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (u16(entry) === 0x0112) {
        const value = u16(entry + 8);
        return value >= 1 && value <= 8 ? value : 1;
      }
    }
  } catch {
    // kaputte EXIF-Daten ignorieren
  }
  return 1;
}

function orientationSegment(orientation) {
  // Minimaler EXIF-Block, der nur das Orientation-Tag enthält
  const tiff = Buffer.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM", 42, IFD0 bei Offset 8
    0x00, 0x01, // 1 Eintrag
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, // kein weiteres IFD
  ]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const header = Buffer.from([0xff, 0xe1, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function cleanJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const parts = [];
  let orientation = 1;
  let pos = 2;
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) return null;
    let marker = buf[pos + 1];
    while (marker === 0xff) marker = buf[++pos + 1]; // Füllbytes
    if (marker === undefined) return null;
    if (marker === 0xd9) break; // Ende ohne Bilddaten
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(buf.subarray(pos, pos + 2));
      pos += 2;
      continue;
    }
    if (pos + 4 > buf.length) return null;
    const len = buf.readUInt16BE(pos + 2);
    if (len < 2 || pos + 2 + len > buf.length) return null;
    const segment = buf.subarray(pos, pos + 2 + len);
    if (marker === 0xda) {
      // Start of Scan: ab hier nur noch Bilddaten, alles übernehmen
      parts.push(buf.subarray(pos));
      const meta = orientation > 1 ? [orientationSegment(orientation)] : [];
      return Buffer.concat([buf.subarray(0, 2), ...meta, ...parts]);
    }
    const data = segment.subarray(4);
    if (marker === 0xe1) {
      if (data.toString('binary', 0, 6) === 'Exif\0\0') orientation = readOrientation(data);
    } else if (marker !== 0xed && marker !== 0xfe) {
      // APP1 (EXIF/XMP), APP13 (IPTC/Photoshop) und Kommentare fliegen raus, Rest bleibt (z. B. ICC-Farbprofil)
      parts.push(segment);
    }
    pos += 2 + len;
  }
  return null; // keine Bilddaten gefunden
}

function cleanPng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const parts = [PNG_SIGNATURE];
  let pos = 8;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const end = pos + 12 + len;
    if (end > buf.length) return null;
    if (!PNG_METADATA_CHUNKS.has(type)) parts.push(buf.subarray(pos, end));
    pos = end;
    if (type === 'IEND') return Buffer.concat(parts);
  }
  return null;
}

function cleanWebp(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const parts = [];
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const type = buf.toString('ascii', pos, pos + 4);
    const len = buf.readUInt32LE(pos + 4);
    const end = pos + 8 + len + (len % 2);
    if (pos + 8 + len > buf.length) return null;
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = Buffer.from(buf.subarray(pos, Math.min(end, buf.length)));
      if (type === 'VP8X' && len >= 1) chunk[8] &= ~0x0c; // Flags für EXIF/XMP löschen
      parts.push(chunk);
    }
    pos = end;
  }
  if (parts.length === 0) return null;
  const body = Buffer.concat(parts);
  const header = Buffer.from('RIFF\0\0\0\0WEBP', 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  return Buffer.concat([header, body]);
}

function cleanGif(buf) {
  const sig = buf.toString('ascii', 0, 6);
  return sig === 'GIF87a' || sig === 'GIF89a' ? buf : null;
}

const TYPES = {
  'image/jpeg': { ext: '.jpg', clean: cleanJpeg },
  'image/png': { ext: '.png', clean: cleanPng },
  'image/gif': { ext: '.gif', clean: cleanGif },
  'image/webp': { ext: '.webp', clean: cleanWebp },
};

function detectType(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// Liefert { mime, ext, data } mit bereinigten Bilddaten oder null
function processImage(buf) {
  const mime = detectType(buf);
  if (!mime) return null;
  const data = TYPES[mime].clean(buf);
  return data ? { mime, ext: TYPES[mime].ext, data } : null;
}

module.exports = { TYPES, processImage };
