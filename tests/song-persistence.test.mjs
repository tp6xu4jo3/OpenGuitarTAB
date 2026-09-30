import assert from 'node:assert/strict';
import { cleanSongForWrite } from '../api/index.js';

const row = Array.from({ length: 6 }, () => Array(64).fill(''));
const document = {
  version: 3,
  measures: [{
    id: 'm1',
    timeSignature: { numerator: 4, denominator: 4 },
    events: [{
      id: 'e1',
      at: [0, 1],
      duration: [1, 8],
      notes: [{ id: 'n1', string: 0, fret: '12', techniques: [{ type: 'harmonic', kind: 'natural' }] }],
      marks: [{ type: 'strum', direction: 'down' }]
    }],
    groups: []
  }],
  relations: [],
  layout: { systemBreakAfter: ['m1'] }
};
const baseSong = {
  id: 'song-test',
  name: 'Persistence Test',
  beatsPerMeasure: 4,
  document,
  _opentab: { owner: 'test', public: true, uploadedBy: 'test' }
};

{
  const legacySong = {
    ...baseSong,
    document: undefined,
    rows: [structuredClone(row), structuredClone(row)],
    rhythmRows: [],
    rowMeasureCounts: [2, 4]
  };
  assert.throws(
    () => cleanSongForWrite(legacySong),
    /V3_DOCUMENT_REQUIRED/,
    'server persistence must reject legacy rows instead of writing a new legacy Drive song'
  );
}

{
  const persisted = cleanSongForWrite({ ...baseSong, rowMeasureCounts: [1] });
  assert.equal(persisted.document.version, 3);
  assert.deepEqual(persisted.document.layout, {}, 'V3 persistence must normalize obsolete systemBreakAfter data away');
  assert.equal(Object.hasOwn(persisted, 'rows'), false, 'V3 persistence must not write legacy rows');
  assert.equal(Object.hasOwn(persisted, 'rhythmRows'), false, 'V3 persistence must not write legacy rhythmRows');
  assert.equal(Object.hasOwn(persisted, 'rowMeasureCounts'), false, 'V3 persistence must not write legacy rowMeasureCounts');
  assert.equal(Object.hasOwn(persisted, '_opentab'), false, 'V3 persistence must not write permission metadata');
  const serialized = JSON.parse(JSON.stringify(persisted));
  assert.equal(Object.hasOwn(serialized, 'rows'), false);
  assert.equal(Object.hasOwn(serialized, 'rhythmRows'), false);
  assert.equal(Object.hasOwn(serialized, 'rowMeasureCounts'), false);
  assert.equal(Object.hasOwn(serialized, '_opentab'), false);
  assert.deepEqual(serialized.document.layout, {});
}

{
  const persisted = cleanSongForWrite(baseSong);
  const serialized = JSON.parse(JSON.stringify(persisted));
  assert.equal(serialized.difficulty, undefined);
  assert.equal(Object.hasOwn(serialized, 'difficulty'), false);
  assert.equal(serialized.document.version, 3);
  assert.equal(Object.hasOwn(serialized, '_opentab'), false);
}

{
  const persisted = cleanSongForWrite({ ...baseSong, difficulty: 4.6 });
  assert.equal(persisted.difficulty, 5);
}

console.log('song persistence tests passed');