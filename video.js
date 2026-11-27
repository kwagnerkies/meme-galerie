'use strict';

// Video uploads: the raw upload is always re-encoded with ffmpeg to a small H.264/AAC MP4
// (longest side max. 1280 px, max. 30 fps, metadata removed) plus a JPEG poster for the gallery.
// The original file is never served.

const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const TIMEOUT_MS = 5 * 60 * 1000;
const MAX_SECONDS = 300;

// Is ffmpeg with the needed encoders installed? Checked once at startup.
const available = (() => {
  try {
    const out = spawnSync(FFMPEG, ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 10000 });
    return out.status === 0 && /\blibx264\b/.test(out.stdout) && /\baac\b/.test(out.stdout);
  } catch {
    return false;
  }
})();

// Container by magic bytes; the demuxer is forced from this, ffmpeg never guesses
function detectContainer(head) {
  if (head.length >= 12 && head.toString('ascii', 4, 8) === 'ftyp') return 'mov'; // MP4, MOV, M4V
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) return 'matroska'; // WebM, MKV
  return null;
}

function run(args) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(FFMPEG, ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      return reject(err);
    }
    let stderr = '';
    child.stderr.on('data', (d) => {
      if (stderr.length < 4000) stderr += d;
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg ${signal ? `killed (${signal})` : `exit ${code}`}: ${stderr.trim().slice(-500)}`));
    });
  });
}

// Fits the longest side into `max` px, keeps the aspect ratio, even dimensions for yuv420p
const scale = (max) =>
  `scale=w='if(gte(iw,ih),trunc(min(${max},iw)/2)*2,-2)':h='if(gte(iw,ih),-2,trunc(min(${max},ih)/2)*2)'`;

// Transcodes `input` into `output` (.mp4) and writes a poster frame to `poster` (.jpg).
// Returns false if the input is no supported video, throws on ffmpeg failure.
async function processVideo(input, output, poster) {
  const fd = fs.openSync(input, 'r');
  const head = Buffer.alloc(12);
  fs.readSync(fd, head, 0, 12, 0);
  fs.closeSync(fd);
  const container = detectContainer(head);
  if (!container) return false;

  await run([
    '-protocol_whitelist', 'file',
    '-f', container, '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-t', String(MAX_SECONDS),
    '-vf', scale(1280), '-fpsmax', '30',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
    '-map_metadata', '-1', '-map_chapters', '-1',
    '-movflags', '+faststart',
    '-y', '-f', 'mp4', output,
  ]);
  await run([
    '-protocol_whitelist', 'file',
    '-f', 'mp4', '-i', output,
    '-frames:v', '1', '-vf', scale(480), '-q:v', '4',
    '-map_metadata', '-1',
    '-y', '-f', 'image2', poster,
  ]);
  fs.chmodSync(output, 0o600);
  fs.chmodSync(poster, 0o600);
  return true;
}

module.exports = { available, processVideo };
