import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ensureArtistProfileData,
  normalizeArtistMedia,
  removeArtistProfileData
} from '../src/catalog/media.js';

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
    albums: {}
  });
  assert.equal(Object.hasOwn(created.media.artists['盧廣仲'], 'songs'), false);
  assert.equal(created.media.artists['周杰倫'].image, 'https://example.com/jay.jpg');
  assert.equal(created.media.artists['周杰倫'].albums['范特西'].cover, 'https://example.com/fantasy.jpg');
  assert.equal(Object.hasOwn(created.media.artists['周杰倫'], 'songs'), false, 'empty song overrides must not be serialized');

  const existing = ensureArtistProfileData(created.media, '周杰倫');
  assert.equal(existing.changed, false);

  const removed = removeArtistProfileData(created.media, '盧廣仲');
  assert.equal(removed.changed, true);
  assert.equal(Object.hasOwn(removed.media.artists, '盧廣仲'), false);

  const blank = ensureArtistProfileData(created.media, '   ');
  assert.equal(blank.changed, false);
  assert.equal(Object.hasOwn(blank.media.artists, ''), false);
}

{
  const media = normalizeArtistMedia({
    version: 2,
    artists: {
      Artist: {
        image: '',
        albums: {},
        songs: {
          'song-a': { cover: 'https://example.com/song-a.jpg' }
        }
      }
    }
  });
  assert.deepEqual(media.artists.Artist.songs, {
    'song-a': { cover: 'https://example.com/song-a.jpg' }
  }, 'non-empty per-song cover overrides remain supported');
}

{
  const source = await readFile(new URL('../api/index.js', import.meta.url), 'utf8');
  const createBlock = source.slice(source.indexOf('async function createSongFile('), source.indexOf('async function updateSongFile('));
  const updateBlock = source.slice(source.indexOf('async function updateSongFile('), source.indexOf('async function readManagedEntry('));
  const deleteBlock = source.slice(source.indexOf('async function deleteUserSong('), source.indexOf('async function clonePublicToTest('));
  assert.match(createBlock, /ensureArtistProfile\(persisted\.artist\)/, 'new scores must register a non-empty artist profile before writing the score');
  assert.match(updateBlock, /pruneArtistProfileIfUnused\(previousArtist\)/, 'changing artist must remove the old profile after its last score disappears');
  assert.match(deleteBlock, /pruneArtistProfileIfUnused\(artist\)/, 'deleting the final score for an artist must remove that profile');
  assert.match(source, /publicIndex\?\.works[\s\S]*testIndex\?\.works/, 'artist retention must consider both public and test catalog works');
}

console.log('artist profile tests passed');
