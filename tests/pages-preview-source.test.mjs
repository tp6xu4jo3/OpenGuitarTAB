import assert from 'node:assert/strict';
import { isGitHubPagesPreview, pagesPreviewAssetUrl, pagesPreviewRequest } from '../src/services/pages-preview-source.js';

assert.equal(isGitHubPagesPreview('tp6xu4jo3.github.io'), true);
assert.equal(isGitHubPagesPreview('openguitartab.vercel.app'), false);
assert.equal(
  pagesPreviewAssetUrl('./test-data/pages/catalog.json', 'https://tp6xu4jo3.github.io/OpenGuitarTAB/'),
  'https://tp6xu4jo3.github.io/OpenGuitarTAB/test-data/pages/catalog.json'
);

const responses = new Map([
  ['https://tp6xu4jo3.github.io/OpenGuitarTAB/test-data/pages/catalog.json', { songs: [{ _driveFileId: 'pages-summer' }] }],
  ['https://tp6xu4jo3.github.io/OpenGuitarTAB/test-data/pages/songs/pages-summer.json', { id: 'song-test', rows: [] }]
]);
const fetchImpl = async url => ({
  ok: responses.has(url),
  status: responses.has(url) ? 200 : 404,
  json: async () => responses.get(url)
});
const runtime = { fetchImpl, baseHref: 'https://tp6xu4jo3.github.io/OpenGuitarTAB/' };
assert.deepEqual(await pagesPreviewRequest('catalog', {}, runtime), { songs: [{ _driveFileId: 'pages-summer' }] });
assert.deepEqual(
  await pagesPreviewRequest('catalog-song', { params: { fileId: 'pages-summer' } }, runtime),
  { song: { id: 'song-test', rows: [], _driveFileId: 'pages-summer' } }
);
await assert.rejects(() => pagesPreviewRequest('save', { method: 'POST' }, runtime), /GITHUB_PAGES_READ_ONLY/);

console.log('GitHub Pages preview source tests passed');
