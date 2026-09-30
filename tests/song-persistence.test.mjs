import assert from 'node:assert/strict';
import { cleanSongForWrite } from '../api/index.js';

const legacySong = {
  id: 'song-test',
  name: 'Persistence Test',
  beatsPerMeasure: 4,
  rows: [Array.from({ length: 6 }, () => Array(64).fill(''))],
  rhythmRows: [],
  rowMeasureCounts: [1],
  _opentab: { owner: 'test', public: true, uploadedBy: 'test' }
};

assert.throws(
  () => cleanSongForWrite(legacySong),
  /V3_DOCUMENT_REQUIRED/,
  'server write boundary must reject legacy score payloads instead of persisting rows again'
);

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

{
  const persisted = cleanSongForWrite({ ...legacySong, difficulty: 4.6, document });
  assert.equal(persisted.document.version, 3);
  assert.equal(persisted.difficulty, 5);
  assert.deepEqual(persisted.document.layout, {}, 'V3 persistence must normalize obsolete systemBreakAfter data away');
  assert.equal(Object.hasOwn(persisted, 'rows'), false, 'V3 persistence must never write legacy rows');
  assert.equal(Object.hasOwn(persisted, 'rhythmRows'), false, 'V3 persistence must never write legacy rhythmRows');
  assert.equal(Object.hasOwn(persisted, 'rowMeasureCounts'), false, 'V3 persistence must never write legacy rowMeasureCounts');
  assert.equal(Object.hasOwn(persisted, '_opentab'), false, 'song persistence must never store permission metadata');
}

{
  const persisted = cleanSongForWrite({ ...legacySong, difficulty: undefined, document });
  const serialized = JSON.parse(JSON.stringify(persisted));
  assert.equal(Object.hasOwn(serialized, 'difficulty'), false);
  assert.equal(Object.hasOwn(serialized, '_opentab'), false);
  assert.ok(serialized.document, 'V3 document must remain the only persisted score representation');
}

console.log('song persistence tests passed');
