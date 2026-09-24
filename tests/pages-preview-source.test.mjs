import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGitHubPagesPreview, pagesPreviewAssetUrl, pagesPreviewRequest } from '../src/services/pages-preview-source.js';

assert.equal(isGitHubPagesPreview('tp6xu4jo3.github.io'), true);
assert.equal(isGitHubPagesPreview('openguitartab.vercel.app'), false);
assert.equal(
  pagesPreviewAssetUrl('./test-data/pages/catalog.json', 'https://tp6xu4jo3.github.io/OpenGuitarTAB/'),
  'https://tp6xu4jo3.github.io/OpenGuitarTAB/test-data/pages/catalog.json'
);

const responses = new Map([
  ['https://tp6xu4jo3.github.io/OpenGuitarTAB/test-data/pages/catalog.json', {
    songs: [{ _driveFileId: 'pages-summer' }, { _driveFileId: 'pages-jiandanai' }]
  }],
  ['https://tp6xu4jo3.github.io/OpenGuitarTAB/test-data/pages/songs/pages-summer.json', { id: 'song-summer', rows: [{}] }],
  ['https://tp6xu4jo3.github.io/OpenGuitarTAB/test-data/pages/songs/pages-jiandanai.json', { id: 'song-jiandanai', rows: [{}] }]
]);
const fetchImpl = async url => ({
  ok: responses.has(url),
  status: responses.has(url) ? 200 : 404,
  json: async () => responses.get(url)
});
const runtime = { fetchImpl, baseHref: 'https://tp6xu4jo3.github.io/OpenGuitarTAB/' };
assert.deepEqual(await pagesPreviewRequest('catalog', {}, runtime), {
  songs: [{ _driveFileId: 'pages-summer' }, { _driveFileId: 'pages-jiandanai' }]
});
assert.deepEqual(
  await pagesPreviewRequest('catalog-song', { params: { fileId: 'pages-jiandanai' } }, runtime),
  { song: { id: 'song-jiandanai', rows: [{}], _driveFileId: 'pages-jiandanai' } }
);
await assert.rejects(() => pagesPreviewRequest('save', { method: 'POST' }, runtime), /GITHUB_PAGES_READ_ONLY/);

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.resolve(here, '../test-data/pages');
const fixtureCatalog = JSON.parse(await readFile(path.join(fixturesRoot, 'catalog.json'), 'utf8'));
assert.ok(fixtureCatalog.songs.length >= 2, 'Pages catalog should expose multiple real layout fixtures');
assert.ok(fixtureCatalog.works.length >= 2, 'Pages catalog should expose the aggregated Work model');
for (const work of fixtureCatalog.works) {
  assert.equal(work.id, work.workId);
  assert.ok(Array.isArray(work.arrangements) && work.arrangements.length > 0);
  for (const arrangement of work.arrangements) {
    assert.equal(arrangement.workId, work.workId);
    assert.ok(arrangement.arrangementId);
  }
}
for (const meta of fixtureCatalog.songs) {
  assert.match(meta._driveFileId, /^[a-zA-Z0-9_-]+$/);
  assert.ok(meta.workId);
  assert.ok(meta.arrangementId);
  const song = JSON.parse(await readFile(path.join(fixturesRoot, 'songs', `${meta._driveFileId}.json`), 'utf8'));
  assert.equal(song.id, meta.id, `fixture id must match catalog entry for ${meta._driveFileId}`);
  assert.ok(Array.isArray(song.rows) && song.rows.length > 0, `${meta._driveFileId} must contain playable TAB rows`);
}

console.log('GitHub Pages preview source tests passed');
