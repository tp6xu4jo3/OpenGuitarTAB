import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  materializePermissions,
  permissionEventAppProperties,
  permissionEventFromFile,
  normalizeCatalogIndex,
  catalogIndexMatchesFiles
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
assert.equal(
  catalogIndexMatchesFiles(
    index,
    driveFiles.map(file => file.id === 'file-a' ? { ...file, modifiedTime: 'changed' } : file)
  ),
  false
);
assert.equal(
  catalogIndexMatchesFiles(index, [...driveFiles, { id: 'file-c', name: 'song-c.json', modifiedTime: 'later' }]),
  false
);
assert.equal(catalogIndexMatchesFiles(index, driveFiles.slice(0, 1)), false);
assert.equal(
  catalogIndexMatchesFiles(normalizeCatalogIndex({ version: 1, songs: index.songs }), driveFiles),
  false,
  'legacy index without manifest must rebuild once'
);

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
}

console.log('sidecar consistency tests passed');
