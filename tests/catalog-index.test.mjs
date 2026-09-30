import assert from 'node:assert/strict';
import { catalogIndexMatchesFiles, normalizeCatalogIndex } from '../api/index.js';

const driveFiles = [
  { id: 'file-a', name: 'song-a.json', modifiedTime: '2026-09-30T01:00:00.000Z' },
  { id: 'file-b', name: 'invalid.json', modifiedTime: '2026-09-30T02:00:00.000Z' }
];

const valid = normalizeCatalogIndex({
  version: 1,
  files: driveFiles,
  songs: [
    {
      id: 'song-a',
      _driveFileId: 'file-a',
      _driveFileName: 'song-a.json',
      _driveModifiedTime: '2026-09-30T01:00:00.000Z'
    }
  ]
});

assert.ok(valid, 'version 1 catalog index with a file manifest should normalize');
assert.equal(catalogIndexMatchesFiles(valid, driveFiles), true, 'matching Drive metadata should keep the metadata-first index path');
assert.equal(
  catalogIndexMatchesFiles(valid, driveFiles.map(file => file.id === 'file-a' ? { ...file, modifiedTime: '2026-09-30T03:00:00.000Z' } : file)),
  false,
  'a changed song modifiedTime must invalidate the index'
);
assert.equal(
  catalogIndexMatchesFiles(valid, [...driveFiles, { id: 'file-c', name: 'song-c.json', modifiedTime: '2026-09-30T04:00:00.000Z' }]),
  false,
  'a newly added Drive JSON file must invalidate the index'
);
assert.equal(
  catalogIndexMatchesFiles(valid, driveFiles.slice(0, 1)),
  false,
  'a removed Drive JSON file must invalidate the index'
);
assert.equal(
  catalogIndexMatchesFiles(normalizeCatalogIndex({ version: 1, songs: valid.songs }), driveFiles),
  false,
  'legacy indexes without a Drive file manifest must rebuild once'
);
assert.equal(
  catalogIndexMatchesFiles(normalizeCatalogIndex({
    version: 1,
    files: driveFiles,
    songs: [{ ...valid.songs[0], _driveModifiedTime: 'stale' }]
  }), driveFiles),
  false,
  'song metadata must agree with the file manifest, not only the manifest itself'
);
assert.equal(
  catalogIndexMatchesFiles(normalizeCatalogIndex({
    version: 1,
    files: driveFiles,
    songs: [valid.songs[0], { ...valid.songs[0] }]
  }), driveFiles),
  false,
  'duplicate catalog entries for one Drive file must invalidate the index'
);

console.log('Catalog index tests passed');
