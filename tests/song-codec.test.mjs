import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { compactSong, expandSong } from '../src/core/song-codec.js';

const catalogPath = new URL('../public/catalog/index.json', import.meta.url);
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
assert.ok(Array.isArray(catalog) && catalog.length > 0, 'catalog should contain songs');

for (const entry of catalog) {
  const filePath = path.resolve(path.dirname(fileURLToPath(catalogPath)), entry.file.replace(/^\.\//, ''));
  const source = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const dense = expandSong(source);
  const compact = compactSong(dense);
  assert.deepEqual(compact, source, `round-trip mismatch: ${source.id}`);
}

console.log(`OK: ${catalog.length} songs round-trip sparse → dense → sparse`);
