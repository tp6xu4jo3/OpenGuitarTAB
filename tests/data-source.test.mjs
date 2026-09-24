import assert from 'node:assert/strict';
import { LocalTestDataSource, LOCAL_TEST_STORAGE_KEY } from '../src/data/local-test-data-source.js';
import { ServerDataSource } from '../src/data/server-data-source.js';
import { createDataSource } from '../src/data/data-source.js';
import { DATA_SOURCE_TARGET } from '../src/data/runtime-target.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const baseHref = 'https://tp6xu4jo3.github.io/OpenGuitarTAB/';
const catalog = {
  works: [
    { id: 'work-a', workId: 'work-a', name: 'Alpha', artist: 'Artist A', album: 'One', cover: '', arrangements: [{ id: 'arr-drive-pages-a', arrangementId: 'arr-drive-pages-a', workId: 'work-a', songId: 'song-a', source: 'fixture', playStyle: 'fingerstyle', difficulty: 2, owner: 'admin', uploadedBy: 'admin', public: true, tempo: 90, capo: 1, beatsPerMeasure: 4, _driveFileId: 'pages-a', _driveFileName: 'pages-a.json', _driveModifiedTime: 'fixture-a' }] },
    { id: 'work-b', workId: 'work-b', name: 'Beta', artist: 'Artist B', album: 'Two', cover: '', arrangements: [{ id: 'arr-drive-pages-b', arrangementId: 'arr-drive-pages-b', workId: 'work-b', songId: 'song-b', source: 'fixture', playStyle: 'chord', difficulty: 3, owner: 'admin', uploadedBy: 'admin', public: true, tempo: 100, capo: 0, beatsPerMeasure: 4, _driveFileId: 'pages-b', _driveFileName: 'pages-b.json', _driveModifiedTime: 'fixture-b' }] }
  ]
};
const responses = new Map([
  [`${baseHref}test-data/pages/catalog.json`, catalog],
  [`${baseHref}test-data/pages/songs/pages-a.json`, { id: 'song-a', name: 'Alpha', artist: 'Artist A', album: 'One', tempo: 90, capo: 1, beatsPerMeasure: 4, rows: [{}] }],
  [`${baseHref}test-data/pages/songs/pages-b.json`, { id: 'song-b', name: 'Beta', artist: 'Artist B', album: 'Two', tempo: 100, capo: 0, beatsPerMeasure: 4, rows: [{}] }]
]);
const fetchCalls = [];
const fetchImpl = async input => {
  const url = String(input);
  fetchCalls.push(url);
  return { ok: responses.has(url), status: responses.has(url) ? 200 : 404, json: async () => structuredClone(responses.get(url)) };
};
const storage = new MemoryStorage();
const now = () => new Date('2026-09-24T15:00:00.000Z');

assert.equal(DATA_SOURCE_TARGET, 'local-test', 'repository source should default to the GitHub/local test target');
assert.equal(createDataSource({ target: 'local-test', fetchImpl, storage, baseHref, now }).isLocalTest, true);
assert.equal(createDataSource({ target: 'local-test', fetchImpl, storage, baseHref: 'https://tabs.example.com/', now }).isLocalTest, true, 'custom-domain test builds must not depend on hostname detection');
assert.equal(createDataSource({ target: 'server', fetchImpl, origin: 'https://openguitartab.vercel.app' }).isLocalTest, false);
assert.throws(() => createDataSource({ target: 'invalid-target' }), /INVALID_DATA_SOURCE_TARGET/);

const local = new LocalTestDataSource({ fetchImpl, storage, baseHref, now });
const session = await local.session();
assert.equal(session.user.localTest, true);
assert.equal(session.user.username, 'admin');
let library = await local.library();
assert.equal(library.songs.length, 2);
const alpha = library.songs.find(song => song.id === 'song-a');
assert.equal(alpha.workId, 'work-a');
assert.equal(alpha.arrangementId, 'arr-drive-pages-a');
assert.equal(alpha._driveFileId, 'pages-a');

alpha.name = 'Alpha edited';
const saved = await local.saveSong(alpha);
assert.equal(saved.song._driveFileId, 'pages-a', 'saving a fixture must keep the same local fixture identity');
assert.equal(JSON.parse(storage.getItem(LOCAL_TEST_STORAGE_KEY)).records['pages-a'].name, 'Alpha edited');

const reopened = new LocalTestDataSource({ fetchImpl, storage, baseHref, now });
library = await reopened.library();
assert.equal(library.songs.find(song => song.id === 'song-a').name, 'Alpha edited', 'browser-local edits must survive a new data source instance');
await reopened.deleteSong('pages-a');
assert.equal((await reopened.library()).songs.some(song => song.id === 'song-a'), false);
await reopened.reset();
assert.equal((await reopened.library()).songs.find(song => song.id === 'song-a').name, 'Alpha', 'reset must restore repo fixtures');
assert.ok(fetchCalls.every(url => !url.includes('/api')), 'LocalTestDataSource must never call /api');
assert.ok(fetchCalls.every(url => url.includes('/test-data/pages/')), 'LocalTestDataSource may fetch only static test fixtures');

const originalFetch = globalThis.fetch;
let defaultFetchCalls = 0;
globalThis.fetch = async function (url, options) {
  assert.equal(this, globalThis, 'default browser fetch must execute with the global object as its receiver');
  defaultFetchCalls += 1;
  return { ok: true, status: 200, json: async () => ({ user: null }) };
};
try {
  const defaultServer = new ServerDataSource({ origin: 'https://openguitartab.vercel.app' });
  await defaultServer.session();
  assert.equal(defaultFetchCalls, 1, 'default server transport should call the browser fetch implementation once');
} finally {
  globalThis.fetch = originalFetch;
}

const serverCalls = [];
const server = new ServerDataSource({
  origin: 'https://openguitartab.vercel.app',
  fetchImpl: async (url, options) => {
    serverCalls.push({ url: String(url), options });
    return { ok: true, status: 200, json: async () => ({ song: { id: 'server-song' } }) };
  }
});
await server.saveSong({ id: 'server-song' });
assert.match(serverCalls[0].url, /^https:\/\/openguitartab\.vercel\.app\/api\?action=save$/);
assert.equal(serverCalls[0].options.method, 'POST');

const challenged = new ServerDataSource({
  origin: 'https://openguitartab.vercel.app',
  fetchImpl: async () => ({
    ok: false,
    status: 429,
    headers: { get: name => name.toLowerCase() === 'x-vercel-mitigated' ? 'challenge' : null },
    json: async () => { throw new Error('HTML response'); }
  })
});
await assert.rejects(
  challenged.catalog(),
  error => error.message === 'VERCEL_SECURITY_CHALLENGE' && error.status === 429 && error.mitigation === 'challenge',
  'Vercel edge challenges should be distinguishable from an empty catalog or bad credentials'
);

console.log('Data source tests passed');
