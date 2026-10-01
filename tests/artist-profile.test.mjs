import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ensureArtistProfileData } from '../api/index.js';

{
  const original = {
    version: 2,
    artists: {
      '周杰倫': {
        image: 'https://example.com/jay.jpg',
        albums: { '范特西': { cover: 'https://example.com/fantasy.jpg' } },
        songs: {}
      }
    }
  };

  const created = ensureArtistProfileData(original, '  盧廣仲  ');
  assert.equal(created.changed, true);
  assert.deepEqual(created.media.artists['盧廣仲'], {
    image: '',
    albums: {},
    songs: {}
  });
  assert.equal(created.media.artists['周杰倫'].image, 'https://example.com/jay.jpg');
  assert.equal(created.media.artists['周杰倫'].albums['范特西'].cover, 'https://example.com/fantasy.jpg');

  const existing = ensureArtistProfileData(created.media, '周杰倫');
  assert.equal(existing.changed, false);
  assert.equal(existing.media.artists['周杰倫'].image, 'https://example.com/jay.jpg');
  assert.equal(existing.media.artists['周杰倫'].albums['范特西'].cover, 'https://example.com/fantasy.jpg');

  const blank = ensureArtistProfileData(created.media, '   ');
  assert.equal(blank.changed, false);
  assert.equal(Object.hasOwn(blank.media.artists, ''), false);
}

{
  const source = await readFile(new URL('../api/index.js', import.meta.url), 'utf8');
  const createBlock = source.slice(source.indexOf('async function createSongFile('), source.indexOf('async function updateSongFile('));
  const updateBlock = source.slice(source.indexOf('async function updateSongFile('), source.indexOf('async function readManagedEntry('));
  assert.match(createBlock, /ensureArtistProfile\(persisted\.artist\)/, 'new scores must register a non-empty artist profile before writing the score');
  assert.match(updateBlock, /ensureArtistProfile\(persisted\.artist\)/, 'renaming an existing score to a new artist must register the profile too');
  assert.match(source, /media\.artists\[artist\] = \{ image: '', albums: \{\}, songs: \{\} \}/, 'new artist profiles must use the canonical empty media shape');
}

console.log('artist profile tests passed');
