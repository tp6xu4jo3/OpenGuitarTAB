import assert from 'node:assert/strict';
import { compactSong, expandSong } from '../src/core/song-codec.js';

const fixtures = [
  {
    id: 'codec-four-beat',
    name: 'Codec 4/4',
    tempo: 120,
    capo: 0,
    beatsPerMeasure: 4,
    rowMeasureCounts: [4],
    rhythmRows: [{}],
    rows: [
      {
        '0,0': '0',
        '0,3': '12',
        '3,31': '7',
        '5,63': '9'
      }
    ]
  },
  {
    id: 'codec-three-beat',
    name: 'Codec 3/4',
    tempo: 90,
    capo: 2,
    beatsPerMeasure: 3,
    rowMeasureCounts: [4],
    rhythmRows: [{}],
    rows: [
      {
        '1,0': '3',
        '2,24': '10',
        '4,47': '5'
      }
    ]
  }
];

for (const source of fixtures) {
  const dense = expandSong(source);
  const compact = compactSong(dense);
  assert.deepEqual(compact, source, `round-trip mismatch: ${source.id}`);
}

console.log(`OK: ${fixtures.length} codec fixtures round-trip sparse → dense → sparse`);
