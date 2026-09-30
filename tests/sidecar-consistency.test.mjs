import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  materializePermissions,
  permissionEventAppProperties,
  permissionEventFromFile,
  normalizeCatalogIndex,
  catalogIndexMatchesFiles,
  catalogIndexRefreshPlan
} from '../api/index.js';

const seed = {
  version: 1,
  songs: {
    base: { owner: 'admin', public: true, uploadedBy: 'admin' }
  }
};

function permissionFile(id, modifiedTime, event) {
  return {
    id,
    name: `${id}.json`,
    modifiedTime,
    appProperties: permissionEventAppProperties(event)
  };
}

{
  const event = {
    version: 1,
    fileId: 'song-a',
    sequence: 1001,
    permission: {
      owner: 'test',
      public: true,
      uploadedBy: 'test',
      updatedBy: 'test',
      sourcePublicFileId: 'source-a',
      publishedAt: 123456789
    }
  };
  const file = permissionFile('record-a', '2026-09-30T10:00:00.000Z', event);
  const parsed = permissionEventFromFile(file);
  assert.ok(parsed, 'permission record must be reconstructable from Drive appProperties without downloading JSON media');
  assert.deepEqual(parsed.event, {
    ...event,
    deleted: false,
    permission: event.permission
  });
}

{
  const permissions = materializePermissions(seed, [
    permissionEventFromFile(permissionFile('record-a', '2026-09-30T10:00:00.000Z', {
      version: 1,
      fileId: 'song-a',
      sequence: 1,
      permission: { owner: 'test', public: false }
    })),
    permissionEventFromFile(permissionFile('record-b', '2026-09-30T10:00:00.001Z', {
      version: 1,
      fileId: 'song-b',
      sequence: 2,
      permission: { owner: 'test', public: true }
    }))
  ]);
  assert.deepEqual(Object.keys(permissions.songs).sort(), ['base', 'song-a', 'song-b']);
  assert.equal(permissions.songs['song-a'].public, false);
  assert.equal(permissions.songs['song-b'].public, true);
}

{
  const permissions = materializePermissions(seed, [
    permissionEventFromFile(permissionFile('record-old', '2026-09-30T10:01:00.000Z', {
      version: 1,
      fileId: 'base',
      sequence: 999,
      permission: { owner: 'admin', public: false }
    })),
    permissionEventFromFile(permissionFile('record-new', '2026-09-30T10:02:00.000Z', {
      version: 1,
      fileId: 'base',
      sequence: 1,
      deleted: true
    }))
  ]);
  assert.equal(
    Object.hasOwn(permissions.songs, 'base'),
    false,
    'Drive modifiedTime must define the latest permission authority before local sequence tie-breaking'
  );
}

const driveFiles = [
  { id: 'file-a', name: 'song-a.json', modifiedTime: '2026-09-30T01:00:00.000Z' },
  { id: 'file-b', name: 'song-b.json', modifiedTime: '2026-09-30T02:00:00.000Z' }
];
const index = normalizeCatalogIndex({
  version: 1,
  files: driveFiles,
  omittedFileIds: [],
  songs: driveFiles.map((file, indexPosition) => ({
    id: `song-${indexPosition}`,
    _driveFileId: file.id,
    _driveFileName: file.name,
    _driveModifiedTime: file.modifiedTime,
    owner: 'forged',
    public: true
  }))
});
assert.ok(index);
assert.equal(
  index.songs.some(song => Object.hasOwn(song, 'owner') || Object.hasOwn(song, 'public')),
  false,
  'index cache must not persist authorization'
);
assert.equal(catalogIndexMatchesFiles(index, driveFiles), true);

const changedFiles = driveFiles.map(file => file.id === 'file-a'
  ? { ...file, modifiedTime: '2026-09-30T03:00:00.000Z' }
  : file
);
assert.equal(catalogIndexMatchesFiles(index, changedFiles), false);
const refreshPlan = catalogIndexRefreshPlan(index, changedFiles);
assert.deepEqual(
  refreshPlan.filesToRead.map(file => file.id),
  ['file-a'],
  'a score save must refresh only the changed full song JSON'
);
assert.deepEqual(
  refreshPlan.reusableSongs.map(song => song._driveFileId),
  ['file-b'],
  'unchanged catalog metadata must be reused from the index cache'
);

assert.equal(
  catalogIndexMatchesFiles(index, [...driveFiles, { id: 'file-c', name: 'song-c.json', modifiedTime: 'later' }]),
  false
);
const addedPlan = catalogIndexRefreshPlan(
  index,
  [...driveFiles, { id: 'file-c', name: 'song-c.json', modifiedTime: 'later' }]
);
assert.deepEqual(addedPlan.filesToRead.map(file => file.id), ['file-c']);
assert.equal(catalogIndexMatchesFiles(index, driveFiles.slice(0, 1)), false);
assert.deepEqual(
  catalogIndexRefreshPlan(index, driveFiles.slice(0, 1)).filesToRead,
  [],
  'deleting a score must not force any surviving full song JSON to be reread'
);
assert.equal(
  catalogIndexMatchesFiles(normalizeCatalogIndex({ version: 1, files: driveFiles, songs: index.songs }), driveFiles),
  false,
  'legacy index without explicit omitted-file coverage must rebuild once'
);

{
  const omittedIndex = normalizeCatalogIndex({
    version: 1,
    files: driveFiles,
    omittedFileIds: ['file-b'],
    songs: [index.songs.find(song => song._driveFileId === 'file-a')]
  });
  assert.equal(catalogIndexMatchesFiles(omittedIndex, driveFiles), true);
  const plan = catalogIndexRefreshPlan(omittedIndex, driveFiles);
  assert.deepEqual(plan.filesToRead, []);
  assert.deepEqual(plan.retainedOmittedFileIds, ['file-b']);
}

{
  const source = await readFile(new URL('../api/index.js', import.meta.url), 'utf8');
  const saveBlock = source.slice(source.indexOf('async function saveUserSong('), source.indexOf('async function publishSong('));
  assert.doesNotMatch(
    saveBlock,
    /appendPermissionEvent/,
    'ordinary score save must not rewrite permission authority'
  );
  assert.doesNotMatch(
    source,
    /writePermissions\(/,
    'runtime must never perform whole-file permissions.json read-modify-write mutations'
  );

  const deleteBlock = source.slice(source.indexOf('async function deleteUserSong('), source.indexOf('async function clonePublicToTest('));
  assert.match(
    deleteBlock,
    /method:\s*'DELETE'[\s\S]*appendPermissionEvent\(fileId, null, \{ deleted: true \}\)\.catch/,
    'score deletion stays authoritative even if best-effort permission tombstone persistence fails'
  );
  assert.doesNotMatch(
    deleteBlock,
    /createSongFile|updateSongFile/,
    'tombstone failure must not recreate or overwrite a successfully deleted score'
  );
}

console.log('sidecar consistency tests passed');
