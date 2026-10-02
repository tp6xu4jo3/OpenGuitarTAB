import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [catalog, library, importer, stateSync] = await Promise.all([
  readFile(new URL('../src/app-catalog.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app-library.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/library/song-import.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/editor/state-sync.js', import.meta.url), 'utf8')
]);

assert.match(catalog, /#\/preview\/\$\{encodeURIComponent\(arrangement\.arrangementId \|\| arrangement\.songId\)\}/, 'preview URLs must identify an arrangement');
assert.match(catalog, /setRoute\(`#\/editor\/\$\{encodeURIComponent\(local\.arrangementId\)\}`\)/, 'catalog edit URLs must identify the same arrangement');
assert.match(catalog, /setRoute\(`#\/editor\/\$\{encodeURIComponent\(song\.arrangementId\)\}`\)/, 'library card edit URLs must identify the arrangement');
assert.match(library, /setRoute\(`#\/editor\/\$\{encodeURIComponent\(song\.arrangementId\)\}`\)/, 'sidebar score links must identify the arrangement');
assert.match(library, /setRoute\(`#\/editor\/\$\{encodeURIComponent\(saved\.arrangementId\)\}`\)/, 'newly created scores must route by arrangement identity');
assert.match(importer, /setRoute\?\.\(`#\/editor\/\$\{encodeURIComponent\(saved\.arrangementId\)\}`\)/, 'imported scores must route by arrangement identity');

for (const [name, source] of [['catalog', catalog], ['library', library], ['importer', importer]]) {
  assert.doesNotMatch(source, /#\/editor\/\$\{encodeURIComponent\((?:song|saved|local)\.id\)\}/, `${name} must not use internal song ids as editor URLs`);
}

const lazyLoad = catalog.slice(catalog.indexOf('function ensureLibrarySongLoaded('), catalog.indexOf('async function fetchCatalogArrangement('));
assert.match(lazyLoad, /String\(item\?\.arrangementId \|\| ''\) === routeId/, 'editor route resolution must find metadata by arrangementId');
assert.match(lazyLoad, /dataSource\.loadSong\(fileId\)/, 'metadata-only editor navigation must fetch the selected Drive score');
assert.match(stateSync, /return song\?\.document \? this\.registry\.forSong\(song\) : null;/, 'editor state must only mount fully hydrated score records');

console.log('Editor route identity regression tests passed');
