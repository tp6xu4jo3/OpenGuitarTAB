import assert from 'node:assert/strict';
import { cleanSongForWrite } from '../api/index.js';

const row = Array.from({ length: 6 }, () => Array(64).fill(''));
const baseSong = {
  id: 'song-test',
  name: 'Persistence Test',
  beatsPerMeasure: 4,
  rows: [structuredClone(row), structuredClone(row)],
  rhythmRows: []
};
const meta = { owner: 'admin', public: true };

{
  const persisted = cleanSongForWrite({
    ...baseSong,
    rowMeasureCounts: [2, 4]
  }, meta);
  assert.deepEqual(persisted.rowMeasureCounts, [2, 4]);

  const serialized = JSON.parse(JSON.stringify(persisted));
  assert.deepEqual(serialized.rowMeasureCounts, [2, 4]);
}

{
  const persisted = cleanSongForWrite(baseSong, meta);
  const serialized = JSON.parse(JSON.stringify(persisted));
  assert.equal(serialized.difficulty, undefined);
  assert.equal(Object.hasOwn(serialized, 'difficulty'), false);
}

{
  const persisted = cleanSongForWrite({ ...baseSong, difficulty: 4.6 }, meta);
  assert.equal(persisted.difficulty, 5);
}

console.log('song persistence tests passed');
