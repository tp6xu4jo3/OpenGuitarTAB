import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyCatalogEvents, applyPermissionEvents } from '../api/index.js';

function comment(id, createdTime, event) {
  return {
    id,
    createdTime,
    deleted: false,
    content: JSON.stringify(event)
  };
}

{
  const base = {
    version: 1,
    songs: {
      existing: { owner: 'admin', public: true, uploadedBy: 'admin' }
    }
  };
  const comments = [
    comment('c-a', '2026-09-30T01:00:00.001Z', {
      schema: 'opentab-permission-event-v1',
      eventId: 'event-a',
      op: 'upsert',
      fileId: 'song-a',
      permission: { owner: 'admin', public: true, uploadedBy: 'admin' }
    }),
    comment('c-b', '2026-09-30T01:00:00.002Z', {
      schema: 'opentab-permission-event-v1',
      eventId: 'event-b',
      op: 'upsert',
      fileId: 'song-b',
      permission: { owner: 'test', public: false }
    })
  ];
  const result = applyPermissionEvents(base, comments);
  assert.deepEqual(Object.keys(result.songs).sort(), ['existing', 'song-a', 'song-b']);
  assert.equal(result.songs['song-a'].public, true);
  assert.equal(result.songs['song-b'].owner, 'test');
}

{
  const base = {
    version: 1,
    eventCursor: { createdTime: '2026-09-30T01:00:00.001Z', id: 'c-a' },
    songs: { existing: { owner: 'admin', public: true } }
  };
  const comments = [
    comment('c-a', '2026-09-30T01:00:00.001Z', {
      schema: 'opentab-permission-event-v1',
      eventId: 'old-event',
      op: 'delete',
      fileId: 'existing'
    }),
    comment('c-b', '2026-09-30T01:00:00.002Z', {
      schema: 'opentab-permission-event-v1',
      eventId: 'new-event',
      op: 'upsert',
      fileId: 'new-song',
      permission: { owner: 'admin', public: false }
    })
  ];
  const result = applyPermissionEvents(base, comments);
  assert.ok(result.songs.existing, 'snapshot cursor must prevent replaying already compacted permission events');
  assert.ok(result.songs['new-song']);
}

{
  const base = { version: 1, songs: [] };
  const comments = [
    comment('catalog-a', '2026-09-30T02:00:00.001Z', {
      schema: 'opentab-catalog-event-v1',
      eventId: 'catalog-event-a',
      op: 'upsert',
      fileId: 'song-a',
      metadata: {
        id: 'a',
        name: 'A',
        _driveFileId: 'song-a',
        _driveFileName: 'a.json',
        _driveModifiedTime: '2026-09-30T01:00:00.000Z'
      }
    }),
    comment('catalog-b', '2026-09-30T02:00:00.002Z', {
      schema: 'opentab-catalog-event-v1',
      eventId: 'catalog-event-b',
      op: 'upsert',
      fileId: 'song-b',
      metadata: {
        id: 'b',
        name: 'B',
        _driveFileId: 'song-b',
        _driveFileName: 'b.json',
        _driveModifiedTime: '2026-09-30T01:00:01.000Z'
      }
    })
  ];
  const result = applyCatalogEvents(base, comments);
  assert.deepEqual(result.songs.map(item => item._driveFileId).sort(), ['song-a', 'song-b']);
}

{
  const base = { version: 1, songs: [] };
  const comments = [
    comment('newer-score-first', '2026-09-30T03:00:00.001Z', {
      schema: 'opentab-catalog-event-v1',
      eventId: 'newer-score',
      op: 'upsert',
      fileId: 'same-song',
      metadata: {
        id: 'same',
        name: 'Newer score metadata',
        _driveFileId: 'same-song',
        _driveFileName: 'same.json',
        _driveModifiedTime: '2026-09-30T03:00:02.000Z'
      }
    }),
    comment('older-score-comment-late', '2026-09-30T03:00:00.002Z', {
      schema: 'opentab-catalog-event-v1',
      eventId: 'older-score',
      op: 'upsert',
      fileId: 'same-song',
      metadata: {
        id: 'same',
        name: 'Older score metadata',
        _driveFileId: 'same-song',
        _driveFileName: 'same.json',
        _driveModifiedTime: '2026-09-30T03:00:01.000Z'
      }
    })
  ];
  const result = applyCatalogEvents(base, comments);
  assert.equal(result.songs.length, 1);
  assert.equal(result.songs[0].name, 'Newer score metadata', 'late event delivery must not regress newer score metadata');
}

{
  const source = readFileSync(new URL('../api/index.js', import.meta.url), 'utf8');
  const saveMatch = source.match(/async function saveUserSong[\s\S]*?async function publishSong/);
  assert.ok(saveMatch, 'saveUserSong source must be discoverable');
  assert.equal(
    saveMatch[0].includes('appendPermissionEvent'),
    false,
    'ordinary score saves must not rewrite or append authorization state'
  );
  assert.equal(source.includes('async function writePermissions'), false, 'whole-file permissions mutation must stay removed');
  assert.equal(source.includes('async function writeCatalogIndex'), false, 'whole-file catalog mutation must stay removed');
}

console.log('conflict-safe sidecar event tests passed');