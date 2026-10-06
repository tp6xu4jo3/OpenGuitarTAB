import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanSongForWrite } from '../api/index.js';
import { enrichSongMedia, normalizeArtistMedia } from '../src/catalog/media.js';
import {
  aggregateCatalogWorks,
  deriveLegacyWorkId,
  ensureArrangementIdentity
} from '../src/catalog/work-model.js';

const summerA = { name: 'Summer', artist: '久石讓' };
const summerB = { name: '  summer ', artist: '久石讓', difficulty: 5, playStyle: 'chord' };
assert.equal(deriveLegacyWorkId(summerA), deriveLegacyWorkId(summerB), 'work identity must normalize title whitespace and case');
assert.equal(deriveLegacyWorkId(summerA), deriveLegacyWorkId({ name: 'Ｓｕｍｍｅｒ', artist: '其他作者' }), 'same normalized title must share one work regardless of arrangement metadata or artist');
assert.notEqual(deriveLegacyWorkId(summerA), deriveLegacyWorkId({ name: 'Summer Night', artist: '久石讓' }));

const legacyIdentity = ensureArrangementIdentity({ ...summerA, workId: 'work-stale' }, { fileId: 'drive-file-a' });
assert.match(legacyIdentity.workId, /^work-/);
assert.notEqual(legacyIdentity.workId, 'work-stale', 'workId must be canonicalized from the normalized title');
assert.equal(legacyIdentity.arrangementId, 'arr-drive-drive-file-a');

const works = aggregateCatalogWorks([
  {
    id: 'song-a2',
    workId: 'work-stale-a',
    arrangementId: 'arr-a2',
    arrangementName: '同一首歌 簡單版',
    name: '同一首歌',
    artist: '同一位作者',
    album: 'Album',
    artistImage: 'artist.jpg',
    cover: 'cover.jpg',
    playStyle: 'chord',
    difficulty: 2,
    owner: 'test',
    _driveFileId: 'file-a2',
    _driveModifiedTime: '2026-09-24T12:00:00Z'
  },
  {
    id: 'song-a1',
    workId: 'work-stale-b',
    arrangementId: 'arr-a1',
    arrangementName: '同一首歌 指彈版',
    name: ' 同一首歌 ',
    artist: '同一位作者',
    album: 'Album',
    artistImage: 'artist.jpg',
    cover: 'cover.jpg',
    playStyle: 'fingerstyle',
    difficulty: 5,
    owner: 'admin',
    _driveFileId: 'file-a1',
    _driveModifiedTime: '2026-09-24T13:00:00Z'
  },
  {
    id: 'song-b1',
    workId: 'work-other',
    arrangementId: 'arr-b1',
    arrangementName: '另一首歌 標準版',
    name: '另一首歌',
    artist: '另一位作者',
    playStyle: 'fingerstyle',
    difficulty: 3,
    _driveFileId: 'file-b1',
    _driveModifiedTime: '2026-09-23T13:00:00Z'
  }
]);

assert.equal(works.length, 2);
const shared = works.find(work => work.workId === deriveLegacyWorkId({ name: '同一首歌' }));
assert.ok(shared);
assert.equal(shared.name.trim(), '同一首歌');
assert.equal(shared.artist, '同一位作者');
assert.equal(shared.album, 'Album');
assert.equal(shared.cover, 'cover.jpg');
assert.equal(shared.artistImage, 'artist.jpg');
assert.deepEqual(shared.arrangements.map(item => item.arrangementId), ['arr-a1', 'arr-a2']);
assert.deepEqual(shared.arrangements.map(item => item.arrangementName), ['同一首歌 指彈版', '同一首歌 簡單版'], 'arrangements of the same work must keep independent editable score names');
assert.equal(Object.hasOwn(shared, 'difficulty'), false, 'difficulty belongs to Arrangement, not Work');
assert.equal(Object.hasOwn(shared, 'playStyle'), false, 'playStyle belongs to Arrangement, not Work');
assert.equal(Object.hasOwn(shared.arrangements[0], 'artist'), false, 'artist belongs to Work, not Arrangement');
assert.equal(shared.arrangements[0].difficulty, 5);
assert.equal(shared.arrangements[0].playStyle, 'fingerstyle');

const persisted = cleanSongForWrite({
  id: 'song-persist',
  name: 'Persisted Work',
  arrangementName: 'Persisted Work 指彈',
  artist: 'Artist',
  album: 'Album',
  cover: 'must-not-persist.jpg',
  artistImage: 'must-not-persist-artist.jpg',
  document: { version: 3, measures: [{ id: 'm1', timeSignature: { numerator: 4, denominator: 4 }, events: [], groups: [] }], relations: [], layout: { systemBreakAfter: [] } }
}, { owner: 'test', public: false });
assert.match(persisted.workId, /^work-/);
assert.match(persisted.arrangementId, /^arr-/);
assert.equal(persisted.arrangementName, 'Persisted Work 指彈');
assert.equal(persisted.name, 'Persisted Work');
assert.equal(Object.hasOwn(persisted, 'cover'), false, 'album covers belong to artists.json, never a persisted song JSON');
assert.equal(Object.hasOwn(persisted, 'artistImage'), false, 'artist images belong to artists.json, never a persisted song JSON');
const persistedAgain = cleanSongForWrite(persisted, { owner: 'test', public: false });
assert.equal(persistedAgain.workId, persisted.workId);
assert.equal(persistedAgain.arrangementId, persisted.arrangementId);
const renamedArrangement = cleanSongForWrite({ ...persisted, arrangementName: 'Persisted Work 抒情版' }, { owner: 'test', public: false });
assert.equal(renamedArrangement.workId, persisted.workId, 'renaming an arrangement must not change its Work identity');
assert.equal(renamedArrangement.name, persisted.name, 'arrangement rename must not mutate the song title');
assert.equal(renamedArrangement.arrangementName, 'Persisted Work 抒情版');
const differentWork = cleanSongForWrite({ ...persisted, name: 'Different Work' }, { owner: 'test', public: false });
assert.notEqual(differentWork.workId, persisted.workId, 'a different title supplied at creation/migration still derives a different canonical Work identity');

const media = normalizeArtistMedia({
  version: 2,
  artists: {
    Artist: {
      image: 'artist.jpg',
      albums: { Album: { cover: 'album.jpg' } },
      songs: { 'song-without-album': { cover: 'fallback.jpg' } }
    }
  }
});
assert.deepEqual(enrichSongMedia({ id: 'song-persist', artist: 'Artist', album: 'Album' }, media), {
  id: 'song-persist', artist: 'Artist', album: 'Album', artistImage: 'artist.jpg', cover: 'album.jpg'
});
assert.equal(enrichSongMedia({ id: 'song-without-album', artist: 'Artist', album: '' }, media).cover, 'fallback.jpg');

const root = fileURLToPath(new URL('..', import.meta.url));
const apiSource = readFileSync(join(root, 'api/index.js'), 'utf8');
assert.match(apiSource, /works:\s*aggregateCatalogWorks\(songs\)/);
assert.match(apiSource, /readCatalogIndex\(PUBLIC_FOLDER_ID[\s\S]*readCatalogIndex\(TEST_FOLDER_ID[\s\S]*readArtistMedia\(\)/, 'catalog must use metadata indexes plus centralized media');
assert.doesNotMatch(apiSource, /PUBLIC_CATALOG_CACHE_TTL_MS|publicCatalogCache/,'catalog consistency must not depend on warm-instance memory caches');
assert.match(apiSource, /copy\.arrangementId\s*=\s*createCatalogId\('arr'\)/, 'cloning an arrangement must keep the same title-derived work and create a new arrangementId');
assert.match(apiSource, /'workId'[\s\S]*'arrangementId'[\s\S]*'arrangementName'/, 'Drive JSON persistence must include both catalog identities and the editable arrangement name');
const updateBlock = apiSource.slice(apiSource.indexOf('async function updateSongFile('), apiSource.indexOf('async function readManagedEntry('));
assert.match(updateBlock, /const immutableWorkName = String\(previousSong\?\.name \|\| song\?\.name \|\| ''\)\.trim\(\)[\s\S]*\.\.\.\(immutableWorkName \? \{ name: immutableWorkName \} : \{\}\)/s, 'existing Drive scores must preserve their original song title on every update');

console.log('catalog work model tests passed');
