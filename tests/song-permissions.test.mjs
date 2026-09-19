import assert from 'node:assert/strict';
import {
  songOwner,
  songWasPublished,
  songIsPublic,
  canEditSong,
  canUnlistSong,
  canDeleteSong
} from '../src/core/song-permissions.js';

const admin = { username: 'admin', role: 'admin' };
const test = { username: 'test', role: 'test' };
const other = { username: 'other', role: 'test' };

const testPublic = { _opentab: { owner: 'test', uploadedBy: 'test', public: true, publishedAt: 1 } };
const testUnlisted = { _opentab: { owner: 'test', uploadedBy: 'test', public: false, publishedAt: 1 } };
const testPrivate = { _opentab: { owner: 'test', public: false } };
const adminPublic = { _opentab: { owner: 'admin', uploadedBy: 'admin', public: true, publishedAt: 1 } };

assert.equal(songOwner(testPublic), 'test');
assert.equal(songWasPublished(testPublic), true);
assert.equal(songWasPublished(testUnlisted), true);
assert.equal(songWasPublished(testPrivate), false);
assert.equal(songIsPublic(testPublic), true);
assert.equal(songIsPublic(testUnlisted), false);

assert.equal(canEditSong(test, testPublic), true);
assert.equal(canUnlistSong(test, testPublic), true);
assert.equal(canDeleteSong(test, testPublic), true);

assert.equal(canEditSong(other, testPublic), false);
assert.equal(canUnlistSong(other, testPublic), false);
assert.equal(canDeleteSong(other, testPublic), false);

assert.equal(canEditSong(admin, testPublic), true);
assert.equal(canUnlistSong(admin, testUnlisted), true);
assert.equal(canDeleteSong(admin, testPublic), false);
assert.equal(canEditSong(admin, testPrivate), false);

assert.equal(canEditSong(admin, adminPublic), true);
assert.equal(canDeleteSong(admin, adminPublic), true);

console.log('OK: owner/admin song permissions');
