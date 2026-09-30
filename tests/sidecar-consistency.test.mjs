import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  materializeLegacyPermissions,
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

{
  const seed = {
    version: 1,
    songs: {
      base: { owner: 'admin', public: true, uploadedBy: 'admin' }
    }
  };
  const migrated = materializeLegacyPermissions(seed, [
    {
      modifiedTime: '2026-09-30T10:01:00.000Z',
      event: { version: 1, fileId: 'base', sequence: 1, permission: { owner: 'admin', public: false } }
    },
    {
      modifiedTime: '2026-09-30T10:02:00.000Z',
      event: { version: 1, fileId: 'new', sequence: 2, permission: { owner: 'test', public: true } }
    }
  ]);
  assert.equal(migrated.songs.base.public, false);
  assert.equal(migrated.songs.new.public, true);
  const deleted = materializeLegacyPermissions(migrated, [
    { modifiedTime: '2026-09-30T10:03:00.000Z', event: { version: 1, fileId: 'base', sequence: 3, deleted: true } }
  ]);
  assert.equal(Object.hasOwn(deleted.songs, 'base'), false);
}

assert.equal(songFileName({ name: '簡單愛', arrangementId: 'arr-123' }), '簡單愛__arr-123.json');
assert.equal(songFileName({ name: 'A/B\\C', arrangementId: 'arr 123' }), 'A-B-C__arr-123.json');

const driveFiles = [
  { id: 'file-a', name: '歌曲A__arr-a.json', modifiedTime: '2026-09-30T01:00:00.000Z' },
  { id: 'file-b', name: '歌曲B__arr-b.json', modifiedTime: '2026-09-30T02:00:00.000Z' }
];
const index = normalizeCatalogIndex({
  version: 2,
  manifest: driveFiles.map(file => ({
    driveFileId: file.id,
    fileName: file.name,
    modifiedTime: file.modifiedTime
  })),
  omittedDriveFileIds: [],
  songs: driveFiles.map((file, indexPosition) => ({
    songId: `song-${indexPosition}`,
    workId: `work-${indexPosition}`,
    arrangementId: `arr-${indexPosition}`,
    name: `Song ${indexPosition}`,
    artist: 'Artist',
    album: '',
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
assert.equal(index.version, 2);
assert.equal(Object.hasOwn(index, 'files'), false, 'v2 index must use manifest rather than an ambiguous files array');
assert.equal(Object.hasOwn(index.songs[0], 'id'), false, 'v2 song cache must use songId rather than a generic id');
assert.equal(Object.hasOwn(index.songs[0], '_driveFileId'), false, 'persisted cache fields must use explicit names rather than private-style aliases');
assert.equal(Object.hasOwn(index.songs[0], 'owner'), false, 'index cache must not persist authorization');
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
assert.equal(normalizeCatalogIndex({ version: 1, files: driveFiles, songs: [] }), null, 'legacy index must rebuild directly into v2');

{
  const omittedIndex = normalizeCatalogIndex({
    version: 2,
    manifest: driveFiles.map(file => ({ driveFileId: file.id, fileName: file.name, modifiedTime: file.modifiedTime })),
    omittedDriveFileIds: ['file-b'],
    songs: [index.songs.find(song => song.driveFileId === 'file-a')]
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

  const deleteBlock = source.slice(source.indexOf('async function deleteUserSong('), source.indexOf('async function clonePublicToTest('));
  assert.match(deleteBlock, /method:\s*'DELETE'[\s\S]*deletePermissionRecord\(fileId\)\.catch/s);
  assert.doesNotMatch(deleteBlock, /createSongFile|updateSongFile/);
}

console.log('sidecar consistency tests passed');
