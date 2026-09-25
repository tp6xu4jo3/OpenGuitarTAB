import assert from 'node:assert/strict';
import { createDocumentV3, fractionKey } from '../src/editor/model.js';
import { ensureSongDocumentV3 } from '../src/editor/migrate-v2.js';
import { editableTimesForMeasure } from '../src/editor/rhythm-grid.js';

{
  const measure = {
    id: 'm-columns',
    timeSignature: { numerator: 4, denominator: 4 },
    events: [{
      id: 'e-triplet',
      at: [1, 3],
      duration: [1, 6],
      notes: [{ id: 'n-triplet', string: 0, fret: '3', techniques: [] }],
      marks: []
    }],
    groups: [{
      id: 'g-triplet',
      type: 'tuplet',
      ratio: [3, 2],
      slots: [[0, 1], [1, 6], [1, 3]],
      duration: [1, 6],
      eventIds: ['e-triplet']
    }]
  };
  const documentModel = createDocumentV3({ measures: [measure] });
  const times = editableTimesForMeasure(documentModel.measures[0]);
  const keys = new Set(times.map(item => fractionKey(item.at)));
  assert.equal(keys.has('0/1'), true, 'base sixteenth columns remain editable');
  assert.equal(keys.has('1/6'), true, 'triplet columns are first-class sparse targets');
  assert.equal(keys.has('1/3'), true, 'fractional event columns are retained');
  assert.equal(times.length < 30, true, 'sparse renderer must not materialize six strings per time column');
}

{
  const row = Array.from({ length: 6 }, () => Array(64).fill(''));
  row[0][0] = '3';
  const song = { id: 'legacy-boundary', beatsPerMeasure: 4, rows: [row], rowMeasureCounts: [1] };
  ensureSongDocumentV3(song);
  assert.equal(song.document.version, 3);
  assert.equal(song.document.measures[0].events[0].notes[0].fret, '3');
  assert.equal('rows' in song, false);
  assert.equal('rhythmRows' in song, false);
  assert.equal('rowMeasureCounts' in song, false);
}

console.log('editor sparse structure cleanup tests passed');
