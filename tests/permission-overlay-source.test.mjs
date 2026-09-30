import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { permissionRecordFileName } from '../api/index.js';

const source = await readFile(new URL('../api/index.js', import.meta.url), 'utf8');

const saveStart = source.indexOf('async function saveUserSong(');
const publishStart = source.indexOf('async function publishSong(');
const visibilityStart = source.indexOf('async function setPublicState(');
const deleteStart = source.indexOf('async function deleteUserSong(');
const cloneStart = source.indexOf('async function clonePublicToTest(');

assert.ok(saveStart >= 0 && publishStart > saveStart && visibilityStart > publishStart && deleteStart > visibilityStart && cloneStart > deleteStart);
assert.equal(permissionRecordFileName('drive-song-id'), 'permission-drive-song-id.json');

const saveBlock = source.slice(saveStart, publishStart);
assert.doesNotMatch(saveBlock, /writePermissionRecord/, 'ordinary score saves must not rewrite permission authority');

const publishBlock = source.slice(publishStart, visibilityStart);
assert.match(publishBlock, /writePermissionRecord\(fileId, permission\)/, 'publish must update the canonical per-song permission file');

const visibilityBlock = source.slice(visibilityStart, deleteStart);
assert.match(visibilityBlock, /writePermissionRecord\(fileId, permission\)/, 'visibility changes must update the canonical per-song permission file');

const deleteBlock = source.slice(deleteStart, cloneStart);
assert.match(deleteBlock, /deletePermissionRecord\(fileId\)/, 'delete must remove the matching permission file');
assert.doesNotMatch(deleteBlock, /tombstone|appendPermissionEvent/, 'delete must not create permission tombstones');

assert.match(source, /PERMISSION_FILE_PREFIX = 'permission-'/);
assert.match(source, /songFileId/);
assert.doesNotMatch(source, /permissionEventAppProperties|cleanupPermissionRecords|appendPermissionEvent/, 'runtime permission authority must have one implementation');
assert.doesNotMatch(source, /async function writePermissions\(/, 'runtime must never rewrite a shared permissions snapshot');
assert.doesNotMatch(source, /upsertCatalogIndexEntry|removeCatalogIndexEntry/, 'catalog index must remain a rebuildable cache');

console.log('per-song permission source tests passed');
