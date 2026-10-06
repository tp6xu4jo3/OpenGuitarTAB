import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizePermissionFile,
  normalizeCatalogIndex,
  catalogIndexMatchesFiles,
  catalogIndexRefreshPlan,
  songFileName
} from '../api/index.js';

{
  const record = normalizePermissionFile({
    version: 1,
    songFileId: 'drive-a',
    owner: 'test',
    public: true,
    uploadedBy: 'test',
    updatedBy: 'admin',
    sourcePublicFileId: 'source-a',
    publishedAt: 123456789
  });
  assert.deepEqual(record, {
    version: 1,
    songFileId: 'drive-a',
    owner: 'test',
    public: true,
    uploadedBy: 'test',
    updatedBy: 'admin',
    sourcePublicFileId: 'source-a',
    publishedAt: 123456789
  });
}

assert.equal(songFileName({ name: '簡單愛', arrangementId: 'arr-123' }), '簡單愛_簡單愛_arr-123.json', 'legacy scores without arrangementName must use the song title as the score-name filename fallback');
assert.equal(songFileName({ name: '簡單愛', arrangementName: '簡單愛 指彈版', arrangementId: 'arr-123' }), '簡單愛_簡單愛 指彈版_arr-123.json');
assert.equal(songFileName({ name: 'A/B\\C', arrangementName: '簡單/A版', arrangementId: 'arr 123' }), 'A-B-C_簡單-A版_arr-123.json');

const driveFiles = [
  { id: 'file-a', name: '歌曲A__arr-a.json', modifiedTime: '2026-09-30T01:00:00.000Z' },
  { id: 'file-b', name: '歌曲A__arr-b.json', modifiedTime: '2026-09-30T02:00:00.000Z' }
];
const index = normalizeCatalogIndex({
  version: 3,
  manifest: driveFiles.map(file => ({
    driveFileId: file.id,
    fileName: file.name,
    modifiedTime: file.modifiedTime
  })),
  omittedDriveFileIds: [],
  works: [{
    workId: 'work-shared',
    name: 'Song A',
    artist: 'Artist',
    album: 'Album'
  }],
  arrangements: driveFiles.map((file, indexPosition) => ({
    songId: `song-${indexPosition}`,
    workId: 'work-shared',
    arrangementId: `arr-${indexPosition}`,
    arrangementName: `Arrangement ${indexPosition}`,
    name: 'must-not-persist-here',
    artist: 'must-not-persist-here',
    album: 'must-not-persist-here',
    cover: 'must-not-persist-here',
    artistImage: 'must-not-persist-here',
    source: '',
    playStyle: 'fingerstyle',
    difficulty: 2,
    tempo: 120,
    capo: 0,
    beatsPerMeasure: 4,
    driveFileId: file.id,
    driveFileName: file.name,
    driveModifiedTime: file.modifiedTime,
    owner: 'forged',
    public: true
  }))
});
assert.ok(index);
assert.equal(index.version, 3);
assert.equal(index.works.length, 1, 'same-work arrangements must share one persisted work metadata record');
assert.deepEqual(index.works[0], { workId: 'work-shared', name: 'Song A', artist: 'Artist', album: 'Album' });
assert.equal(index.arrangements.length, 2);
for (const [indexPosition, arrangement] of index.arrangements.entries()) {
  assert.equal(arrangement.arrangementName, `Arrangement ${indexPosition}`, 'arrangement-specific display names belong in the arrangement cache');
  assert.equal(Object.hasOwn(arrangement, 'name'), false, 'arrangements must not duplicate work title');
  assert.equal(Object.hasOwn(arrangement, 'artist'), false, 'arrangements must not duplicate work artist');
  assert.equal(Object.hasOwn(arrangement, 'album'), false, 'arrangements must not duplicate work album');
  assert.equal(Object.hasOwn(arrangement, 'cover'), false, 'media must stay in artists.json rather than the catalog index');
  assert.equal(Object.hasOwn(arrangement, 'artistImage'), false, 'artist media must stay in artists.json rather than the catalog index');
  assert.equal(Object.hasOwn(arrangement, 'driveFileName'), false, 'fileName belongs only to manifest');
  assert.equal(Object.hasOwn(arrangement, 'driveModifiedTime'), false, 'modifiedTime belongs only to manifest');
  assert.equal(Object.hasOwn(arrangement, 'owner'), false, 'index cache must not persist authorization');
}
assert.equal(index.songs.length, 2, 'runtime may expose joined transient metadata for existing catalog consumers');
assert.equal(index.songs[0].name, 'Song A');
assert.equal(index.songs[0].arrangementName, 'Arrangement 0');
assert.equal(index.songs[0].artist, 'Artist');
assert.equal(index.songs[0].album, 'Album');
const persistedIndex = JSON.parse(JSON.stringify(index));
assert.equal(Object.hasOwn(persistedIndex, 'songs'), false, 'joined song metadata must be transient and never duplicated in index.json');
assert.equal(persistedIndex.works.length, 1);
assert.equal(persistedIndex.arrangements.length, 2);
assert.equal(catalogIndexMatchesFiles(index, driveFiles), true);

const changedFiles = driveFiles.map(file => file.id === 'file-a'
  ? { ...file, modifiedTime: '2026-09-30T03:00:00.000Z' }
  : file
);
assert.equal(catalogIndexMatchesFiles(index, changedFiles), false);
const refreshPlan = catalogIndexRefreshPlan(index, changedFiles);
assert.deepEqual(refreshPlan.filesToRead.map(file => file.id), ['file-a']);
assert.deepEqual(refreshPlan.reusableSongs.map(song => song.driveFileId), ['file-b']);

assert.equal(
  catalogIndexMatchesFiles(index, [...driveFiles, { id: 'file-c', name: '歌曲C__arr-c.json', modifiedTime: 'later' }]),
  false
);
const addedPlan = catalogIndexRefreshPlan(
  index,
  [...driveFiles, { id: 'file-c', name: '歌曲C__arr-c.json', modifiedTime: 'later' }]
);
assert.deepEqual(addedPlan.filesToRead.map(file => file.id), ['file-c']);
assert.equal(catalogIndexMatchesFiles(index, driveFiles.slice(0, 1)), false);
assert.deepEqual(catalogIndexRefreshPlan(index, driveFiles.slice(0, 1)).filesToRead, []);
assert.equal(normalizeCatalogIndex({ version: 2, manifest: [], songs: [] }), null, 'legacy v2 index must rebuild directly into deduplicated v3');

{
  const omittedIndex = normalizeCatalogIndex({
    version: 3,
    manifest: driveFiles.map(file => ({ driveFileId: file.id, fileName: file.name, modifiedTime: file.modifiedTime })),
    omittedDriveFileIds: ['file-b'],
    works: [{ workId: 'work-a', name: 'Song A', artist: 'Artist', album: '' }],
    arrangements: [{
      songId: 'song-a',
      workId: 'work-a',
      arrangementId: 'arr-a',
      source: '',
      playStyle: 'fingerstyle',
      difficulty: 2,
      tempo: 120,
      capo: 0,
      beatsPerMeasure: 4,
      driveFileId: 'file-a'
    }]
  });
  assert.equal(catalogIndexMatchesFiles(omittedIndex, driveFiles), true);
  const plan = catalogIndexRefreshPlan(omittedIndex, driveFiles);
  assert.deepEqual(plan.filesToRead, []);
  assert.deepEqual(plan.retainedOmittedDriveFileIds, ['file-b']);
}

{
  const source = await readFile(new URL('../api/index.js', import.meta.url), 'utf8');
  const saveBlock = source.slice(source.indexOf('async function saveUserSong('), source.indexOf('async function publishSong('));
  assert.doesNotMatch(saveBlock, /writePermissionRecord/, 'ordinary score saves must not rewrite permission authority');
  assert.doesNotMatch(source, /writePermissions\(/, 'runtime must never perform shared permissions read-modify-write');
  assert.doesNotMatch(source, /migrateLegacyPermissions|materializeLegacyPermissions|normalizeLegacyPermission/, 'production runtime must not carry a legacy permission migration path');

  const arrangementPersistence = source.slice(source.indexOf('const arrangements = normalizedSongs'), source.indexOf('const index = {', source.indexOf('const arrangements = normalizedSongs')));
  assert.match(arrangementPersistence, /arrangementName: song\.arrangementName/, 'editable score names must persist at the Arrangement layer');
  assert.doesNotMatch(arrangementPersistence, /(?:^|\s)name:|artist:|album:|cover:|artistImage:/m, 'persisted arrangement cache must not duplicate Work-level title/media metadata');
  assert.match(source, /version: 3[\s\S]*works,[\s\S]*arrangements/s, 'catalog index v3 must persist shared work metadata separately from arrangements');
  assert.match(source, /Object\.defineProperty\(index, 'songs'[\s\S]*enumerable: false/s, 'flattened catalog metadata may exist only as a non-persisted runtime projection');
  assert.match(source, /function catalogApiSongs\([\s\S]*index\?\.manifest[\s\S]*index\?\.songs[\s\S]*catalogApiMeta/s, 'catalog API metadata must join work metadata and manifest metadata at runtime');

  const libraryBlock = source.slice(source.indexOf('async function userLibrary('), source.indexOf('function writeMeta('));
  assert.match(libraryBlock, /readCatalogIndex\(/, 'personal library listing must use catalog metadata indexes');
  assert.doesNotMatch(libraryBlock, /entriesFromFiles|readDriveJson/, 'personal library listing must not download every full score JSON');

  const managedEntryBlock = source.slice(source.indexOf('async function readManagedEntry('), source.indexOf('async function managedPublicCatalog('));
  assert.match(managedEntryBlock, /readPermissionRecord\(fileId\)/, 'single-score reads should fetch only that score permission record');
  assert.doesNotMatch(managedEntryBlock, /readPermissions\(\)/, 'single-score reads must not scan the entire permission folder');

  const deleteBlock = source.slice(source.indexOf('async function deleteUserSong('), source.indexOf('async function clonePublicToTest('));
  assert.match(deleteBlock, /method:\s*'DELETE'[\s\S]*deletePermissionRecord\(fileId\)\.catch/s);
  assert.doesNotMatch(deleteBlock, /createSongFile|updateSongFile/);
}

console.log('sidecar consistency tests passed');
