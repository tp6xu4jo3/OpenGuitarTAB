import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  catalogSnapshotFromDriveFile,
  permissionFromDriveFile
} from '../api/index.js';

{
  const permission = permissionFromDriveFile({
    appProperties: {
      opentabManaged: '1',
      opentabOwner: 'test',
      opentabPublic: '0',
      opentabUploadedBy: 'test',
      opentabUpdatedBy: 'admin',
      opentabPublishedAt: '123',
      opentabSourcePublicFileId: 'public-source'
    }
  });
  assert.deepEqual(permission, {
    owner: 'test',
    public: false,
    uploadedBy: 'test',
    updatedBy: 'admin',
    sourcePublicFileId: 'public-source',
    publishedAt: 123
  });
  assert.equal(permissionFromDriveFile({ appProperties: { opentabOwner: 'admin', opentabPublic: '1' } }), null,
    'permission metadata is valid only when the server-managed marker is present');
}

{
  const metadata = {
    id: 'song-a',
    workId: 'work-a',
    arrangementId: 'arr-drive-file-a',
    name: 'A',
    artist: 'Artist',
    album: 'Album',
    tempo: 90,
    capo: 1,
    beatsPerMeasure: 4
  };
  const file = {
    id: 'file-a',
    name: 'song-a.json',
    modifiedTime: '2026-09-30T01:00:00.000Z',
    md5Checksum: 'checksum-a',
    description: JSON.stringify({
      schema: 'opentab-catalog-v1',
      checksum: 'checksum-a',
      metadata
    })
  };
  assert.deepEqual(catalogSnapshotFromDriveFile(file), {
    ...metadata,
    _driveFileId: 'file-a',
    _driveFileName: 'song-a.json',
    _driveModifiedTime: '2026-09-30T01:00:00.000Z'
  });
  assert.equal(
    catalogSnapshotFromDriveFile({ ...file, md5Checksum: 'content-changed' }),
    null,
    'an externally changed score must invalidate its cached catalog metadata'
  );
  assert.equal(
    catalogSnapshotFromDriveFile({ ...file, description: '{bad-json' }),
    null,
    'invalid metadata must fall back to reading the score rather than poisoning the catalog'
  );
}

{
  const source = readFileSync(new URL('../api/index.js', import.meta.url), 'utf8');
  assert.equal(source.includes('/comments?'), false, 'Drive comments must not be used as a growing event database');
  assert.equal(source.includes('async function writePermissions'), false, 'permissions.json must not be a runtime mutation target');
  assert.equal(source.includes('async function writeCatalogIndex'), false, 'index.json must not be a runtime mutation target');

  const saveMatch = source.match(/async function saveUserSong[\s\S]*?async function publishSong/);
  assert.ok(saveMatch, 'saveUserSong source must be discoverable');
  assert.equal(
    saveMatch[0].includes('updatePermissionMetadata'),
    false,
    'ordinary score saves must not rewrite authorization metadata'
  );
  assert.ok(
    source.includes('appProperties: permissionAppProperties(permission'),
    'new songs must receive authorization metadata on their own Drive file'
  );
  assert.ok(
    source.includes('ensureSongDocumentV3(input)'),
    'server persistence must use the canonical legacy→V3 migration before writing'
  );
}

console.log('Drive file metadata authority tests passed');