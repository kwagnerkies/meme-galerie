// Pre-compresses the built JS and CSS, the server sends the .br/.gz file when the browser accepts it
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const dir = new URL('./dist/assets/', import.meta.url);
for (const name of readdirSync(dir)) {
  if (!/\.(js|css)$/.test(name)) continue;
  const data = readFileSync(new URL(name, dir));
  writeFileSync(new URL(`${name}.br`, dir), brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
  writeFileSync(new URL(`${name}.gz`, dir), gzipSync(data, { level: 9 }));
}
