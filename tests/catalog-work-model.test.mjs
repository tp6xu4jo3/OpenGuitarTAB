import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanSongForWrite } from '../api/index.js';
import {
  aggregateCatalogWorks,
  deriveLegacyWorkId,
  ensureArrangementIdentity
} from '../src/catalog/work-model.js';

const summerA = { name: 'Summer', artist: '久石讓' };
const summerB = { name: '  summer ', artist: '久石讓', difficulty: 5, playStyle: 'chord' };
assert.equal(deriveLegacyWorkId(summerA), deriveLegacyWorkId(summerB), 'legacy work identity must depend on normalized work metadata, not arrangement metadata');
assert.notEqual(deriveLegacyWorkId(summerA), deriveLegacyWorkId({ name: 'Summer', artist: '其他作者' }));

const legacyIdentity = ensureArrangementIdentity(summerA, { fileId: 'drive-file-a' });
assert.match(legacyIdentity.workId, /^work-/);
assert.equal(legacyIdentity.arrangementId, 'arr-drive-drive-file-a');

const workId = 'work-shared';
const works = aggregateCatalogWorks([
  {
    id: 'song-a2',
    workId,
    arrangementId: 'arr-a2',
    name: '同一首歌',
    artist: '同一位作者',
    album: 'Album',
    cover: 'cover.jpg',
    playStyle: 'chord',
    difficulty: 2,
    owner: 'test',
    _driveFileId: 'file-a2',
    _driveModifiedTime: '2026-09-24T12:00:00Z'
  },
  {
    id: 'song-a1',
    workId,
    arrangementId: 'arr-a1',
    name: '同一首歌',
    artist: '同一位作者',
    album: 'Album',
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
    name: '另一首歌',
    artist: '另一位作者',
    playStyle: 'fingerstyle',
    difficulty: 3,
    _driveFileId: 'file-b1',
    _driveModifiedTime: '2026-09-23T13:00:00Z'
  }
]);

assert.equal(works.length, 2);
const shared = works.find(work => work.workId === workId);
assert.ok(shared);
assert.equal(shared.name, '同一首歌');
assert.equal(shared.artist, '同一位作者');
assert.equal(shared.album, 'Album');
assert.equal(shared.cover, 'cover.jpg');
assert.deepEqual(shared.arrangements.map(item => item.arrangementId), ['arr-a1', 'arr-a2']);
assert.equal(Object.hasOwn(shared, 'difficulty'), false, 'difficulty belongs to Arrangement, not Work');
assert.equal(Object.hasOwn(shared, 'playStyle'), false, 'playStyle belongs to Arrangement, not Work');
assert.equal(Object.hasOwn(shared.arrangements[0], 'artist'), false, 'artist belongs to Work, not Arrangement');
assert.equal(shared.arrangements[0].difficulty, 5);
assert.equal(shared.arrangements[0].playStyle, 'fingerstyle');

const persisted = cleanSongForWrite({
  id: 'song-persist',
  name: 'Persisted Work',
  artist: 'Artist',
  document: { version: 3, measures: [{ id: 'm1', timeSignature: { numerator: 4, denominator: 4 }, events: [], groups: [] }], relations: [], layout: { systemBreakAfter: [] } }
}, { owner: 'test', public: false });
assert.match(persisted.workId, /^work-/);
assert.match(persisted.arrangementId, /^arr-/);
const persistedAgain = cleanSongForWrite(persisted, { owner: 'test', public: false });
assert.equal(persistedAgain.workId, persisted.workId);
assert.equal(persistedAgain.arrangementId, persisted.arrangementId);

const root = fileURLToPath(new URL('..', import.meta.url));
const apiSource = readFileSync(join(root, 'api/index.js'), 'utf8');
assert.match(apiSource, /works:\s*aggregateCatalogWorks\(songs\)/);
assert.match(apiSource, /copy\.arrangementId\s*=\s*createCatalogId\('arr'\)/, 'cloning an arrangement must preserve workId but create a new arrangementId');
assert.match(apiSource, /'workId'[\s\S]*'arrangementId'/, 'Drive JSON persistence must include both catalog identities');

console.log('catalog work model tests passed');
