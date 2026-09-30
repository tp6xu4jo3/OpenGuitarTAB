import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../api/index.js', import.meta.url), 'utf8');

const saveStart = source.indexOf('async function saveUserSong(');
const publishStart = source.indexOf('async function publishSong(');
const visibilityStart = source.indexOf('async function setPublicState(');
const deleteStart = source.indexOf('async function deleteUserSong(');
const cloneStart = source.indexOf('async function clonePublicToTest(');

assert.ok(saveStart >= 0 && publishStart > saveStart && visibilityStart > publishStart && deleteStart > visibilityStart && cloneStart > deleteStart);

const saveBlock = source.slice(saveStart, publishStart);
assert.doesNotMatch(saveBlock, /appendPermissionEvent/, 'ordinary score saves must never mutate permission authority');

const publishBlock = source.slice(publishStart, visibilityStart);
assert.match(publishBlock, /appendPermissionEvent\(fileId, permission\)/, 'publish must explicitly update centralized permission authority');

const visibilityBlock = source.slice(visibilityStart, deleteStart);
assert.match(visibilityBlock, /appendPermissionEvent\(fileId, permission\)/, 'visibility changes must explicitly update centralized permission authority');

const deleteBlock = source.slice(deleteStart, cloneStart);
assert.match(deleteBlock, /appendPermissionEvent\(fileId, null, \{ deleted: true \}\)/, 'delete must persist a permission tombstone without restoring a shared snapshot');

assert.doesNotMatch(source, /async function writePermissions\(/, 'permissions.json must be an immutable baseline, not a runtime write target');
assert.doesNotMatch(source, /upsertCatalogIndexEntry|removeCatalogIndexEntry/, 'catalog index must be a rebuildable cache rather than shared read-modify-write state');

console.log('permission overlay source tests passed');
