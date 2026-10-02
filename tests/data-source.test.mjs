import assert from 'node:assert/strict';
import { LocalTestDataSource, LOCAL_TEST_STORAGE_KEY } from '../src/data/local-test-data-source.js';
import { ServerDataSource } from '../src/data/server-data-source.js';
import { deriveLegacyWorkId } from '../src/catalog/work-model.js';
import { settledMapWithConcurrency } from '../api/index.js';
import { createDataSource } from '../src/data/data-source.js';
import { DATA_SOURCE_TARGET } from '../src/data/runtime-target.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const baseHref = 'https://tp6xu4jo3.github.io/OpenGuitarTAB/';
const alphaWorkId = deriveLegacyWorkId({ name: 'Alpha' });
const catalog = {
  works: [
    { id: 'work-a', workId: 'work-a', name: 'Alpha', artist: 'Artist A', album: 'One', arrangements: [{ id: 'arr-drive-pages-a', arrangementId: 'arr-drive-pages-a', workId: 'work-a', songId: 'song-a', source: 'fixture', playStyle: 'fingerstyle', difficulty: 2, owner: 'admin', uploadedBy: 'admin', public: true, tempo: 90, capo: 1, beatsPerMeasure: 4, _driveFileId: 'pages-a', _driveFileName: 'pages-a.json', _driveModifiedTime: 'fixture-a' }] },
    { id: 'work-b', workId: 'work-b', name: 'Beta', artist: 'Artist B', album: 'Two', arrangements: [{ id: 'arr-drive-pages-b', arrangementId: 'arr-drive-pages-b', workId: 'work-b', songId: 'song-b', source: 'fixture', playStyle: 'chord', difficulty: 3, owner: 'admin', uploadedBy: 'admin', public: true, tempo: 100, capo: 0, beatsPerMeasure: 4, _driveFileId: 'pages-b', _driveFileName: 'pages-b.json', _driveModifiedTime: 'fixture-b' }] }
  ]
};
const artists = {
  version: 2,
  artists: {
    'Artist A': { image: 'artist-a.jpg', albums: { One: { cover: 'alpha-cover.jpg' } } },
    'Artist B': { image: '', albums: { Two: { cover: 'beta-cover.jpg' } } }
  }
};
const responses = new Map([
  [`${baseHref}test-data/pages/catalog.json`, catalog],
  [`${baseHref}test-data/pages/artists.json`, artists],
  [`${baseHref}test-data/pages/songs/pages-a.json`, { id: 'song-a', name: 'Alpha', artist: 'Artist A', album: 'One', cover: 'legacy-alpha-cover.jpg', tempo: 90, capo: 1, beatsPerMeasure: 4, rows: [{}] }],
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
assert.equal(alpha.workId, alphaWorkId);
assert.equal(alpha.arrangementId, 'arr-drive-pages-a');
assert.equal(alpha._driveFileId, 'pages-a');
assert.equal(alpha.cover, 'alpha-cover.jpg', 'library media must be projected from artists.json instead of the song fixture');
assert.equal(alpha.artistImage, 'artist-a.jpg');

alpha.name = 'Alpha edited';
const fetchCountBeforeSave = fetchCalls.length;
const saved = await local.saveSong(alpha);
assert.equal(saved.song._driveFileId, 'pages-a', 'saving a fixture must keep the same local fixture identity');
const storedAlpha = JSON.parse(storage.getItem(LOCAL_TEST_STORAGE_KEY)).records['pages-a'];
assert.equal(storedAlpha.name, 'Alpha edited');
assert.equal(Object.hasOwn(storedAlpha, 'cover'), false, 'catalog media must never be persisted back into local song data');
assert.equal(Object.hasOwn(storedAlpha, 'artistImage'), false, 'artist images must never be persisted back into local song data');
assert.equal(fetchCalls.slice(fetchCountBeforeSave).some(url => url.endsWith('/songs/pages-b.json')), false, 'saving one fixture must not load unrelated full scores');

const reopened = new LocalTestDataSource({ fetchImpl, storage, baseHref, now });
library = await reopened.library();
assert.equal(library.songs.find(song => song.id === 'song-a').name, 'Alpha edited', 'browser-local edits must survive a new data source instance');
await reopened.deleteSong('pages-a');
assert.equal((await reopened.library()).songs.some(song => song.id === 'song-a'), false);
await reopened.reset();
assert.equal((await reopened.library()).songs.find(song => song.id === 'song-a').name, 'Alpha', 'reset must restore repo fixtures');
assert.ok(fetchCalls.every(url => !url.includes('/api')), 'LocalTestDataSource must never call /api');
assert.ok(fetchCalls.every(url => url.includes('/test-data/pages/')), 'LocalTestDataSource may fetch only static test fixtures');

{
  const catalogOnlyCalls = [];
  const source = new LocalTestDataSource({
    storage: new MemoryStorage(),
    baseHref,
    now,
    fetchImpl: async input => {
      const url = String(input);
      catalogOnlyCalls.push(url);
      return { ok: responses.has(url), status: responses.has(url) ? 200 : 404, json: async () => structuredClone(responses.get(url)) };
    }
  });
  const result = await source.catalog();
  assert.deepEqual(new Set(catalogOnlyCalls), new Set([
    `${baseHref}test-data/pages/catalog.json`,
    `${baseHref}test-data/pages/artists.json`
  ]), 'catalog must read only metadata and centralized media, not every song document');
  assert.equal(catalogOnlyCalls.some(url => url.includes('/songs/')), false);
  assert.equal(result.songs.length, 2);
  assert.equal(result.songs.every(song => !Object.hasOwn(song, 'document') && !Object.hasOwn(song, 'rows')), true, 'catalog metadata must not carry score documents');
  assert.equal(result.songs.find(song => song.id === 'song-a').cover, 'alpha-cover.jpg');
  assert.equal(result.works.find(work => work.workId === alphaWorkId).artistImage, 'artist-a.jpg');
}

{
  let attempts = 0;
  const source = new LocalTestDataSource({
    storage: new MemoryStorage(),
    baseHref,
    now,
    fetchImpl: async input => {
      const url = String(input);
      if (url.endsWith('/test-data/pages/catalog.json') && attempts++ === 0) {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      return { ok: responses.has(url), status: responses.has(url) ? 200 : 404, json: async () => structuredClone(responses.get(url)) };
    }
  });
  await assert.rejects(source.fixtureCatalog(), /TEST_FIXTURE_503/);
  const retry = await source.fixtureCatalog();
  assert.equal(Array.isArray(retry.works), true);
  assert.equal(attempts, 2, 'a rejected catalog Promise must be evicted so the next call retries');
}

{
  let songAttempts = 0;
  const source = new LocalTestDataSource({
    storage: new MemoryStorage(),
    baseHref,
    now,
    fetchImpl: async input => {
      const url = String(input);
      if (url.endsWith('/test-data/pages/songs/pages-a.json') && songAttempts++ === 0) {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      return { ok: responses.has(url), status: responses.has(url) ? 200 : 404, json: async () => structuredClone(responses.get(url)) };
    }
  });
  const meta = catalog.works[0].arrangements[0];
  await assert.rejects(source.fixtureSong({ ...meta, name: 'Alpha', artist: 'Artist A', album: 'One' }), /TEST_FIXTURE_503/);
  const retry = await source.fixtureSong({ ...meta, name: 'Alpha', artist: 'Artist A', album: 'One' });
  assert.equal(retry.id, 'song-a');
  assert.equal(songAttempts, 2, 'a rejected song Promise must be evicted so the next call retries');
}

{
  const lazyCalls = [];
  const source = new LocalTestDataSource({
    storage: new MemoryStorage(),
    baseHref,
    now,
    fetchImpl: async input => {
      const url = String(input);
      lazyCalls.push(url);
      return { ok: responses.has(url), status: responses.has(url) ? 200 : 404, json: async () => structuredClone(responses.get(url)) };
    }
  });
  const loaded = await source.loadSong('pages-a');
  assert.equal(loaded.song.id, 'song-a');
  assert.equal(loaded.song.cover, 'alpha-cover.jpg');
  assert.equal(lazyCalls.includes(`${baseHref}test-data/pages/songs/pages-a.json`), true);
  assert.equal(lazyCalls.includes(`${baseHref}test-data/pages/songs/pages-b.json`), false, 'loading one fixture must not download unrelated scores');
}

{
  let active = 0;
  let maxActive = 0;
  const values = Array.from({ length: 12 }, (_, index) => index);
  const results = await settledMapWithConcurrency(values, 3, async value => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active -= 1;
    if (value === 5) throw new Error('expected');
    return value * 2;
  });
  assert.equal(maxActive <= 3, true, 'Drive JSON reads must respect the configured concurrency bound');
  assert.equal(results[5].status, 'rejected');
  assert.equal(results[6].value, 12);
}

const originalFetch = globalThis.fetch;
let defaultFetchCalls = 0;
globalThis.fetch = async function (url, options) {
  assert.equal(this, globalThis, 'default browser fetch must execute with the global object as its receiver');
  defaultFetchCalls += 1;
  return { ok: true, status: 200, json: async () => ({ user: null }) };
};
try {
  const defaultLocal = new LocalTestDataSource({ storage: new MemoryStorage(), baseHref });
  await defaultLocal.catalog();
  const defaultServer = new ServerDataSource({ origin: 'https://openguitartab.vercel.app' });
  await defaultServer.session();
  assert.equal(defaultFetchCalls, 3, 'local catalog reads metadata plus media and the server transport performs its session request');
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

{
  const activityStates = [];
  const source = new ServerDataSource({
    origin: 'https://openguitartab.vercel.app',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ song: { id: 'drive-song', _opentab: {} }, privateSong: { id: 'drive-song' }, works: [], songs: [] })
    })
  });
  source.setDriveActivityListener(state => activityStates.push({ ...state }));
  const authBaseline = activityStates.length;
  await source.session();
  assert.equal(activityStates.length, authBaseline, 'auth/session transport must not show the Google Drive loading screen');

  const driveActions = [
    ['catalog', '載入公共曲庫…', () => source.catalog()],
    ['library', '載入個人曲譜…', () => source.library()],
    ['loadSong', '讀取曲譜…', () => source.loadSong('drive-file')],
    ['saveSong', '儲存曲譜…', () => source.saveSong({ id: 'drive-song' })],
    ['deleteSong', '刪除曲譜…', () => source.deleteSong('drive-file')],
    ['setPublic', '更新曲譜狀態…', () => source.setPublic('drive-file', true)],
    ['publishSong', '上傳曲譜…', () => source.publishSong({ id: 'drive-song' })],
    ['clonePublicSong', '加入曲譜…', () => source.clonePublicSong('drive-file')]
  ];
  for (const [name, label, run] of driveActions) {
    const before = activityStates.length;
    await run();
    const emitted = activityStates.slice(before);
    assert.equal(emitted[0]?.active, true, `${name} must open the shared Drive loading lifecycle`);
    assert.equal(emitted[0]?.label, label, `${name} must expose a useful loading label`);
    assert.equal(emitted.at(-1)?.active, false, `${name} must close the shared Drive loading lifecycle`);
  }
}

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
