import assert from 'node:assert/strict';
import { frequencyForTab } from '../src/editor/audio-engine.js';
import { buildPlaybackIndex, legacyPositionForEntry, nearestPlaybackIndex } from '../src/editor/playback-index.js';

const documentModel = {
  version: 3,
  measures: [
    {
      id: 'm1',
      timeSignature: { numerator: 4, denominator: 4 },
      events: [
        {
          id: 'e1',
          at: [0, 1],
          duration: [1, 8],
          notes: [{ id: 'n1', string: 0, fret: '5', techniques: [] }],
          marks: []
        },
        {
          id: 'e2',
          at: [1, 3],
          duration: [1, 3],
          notes: [{ id: 'n2', string: 1, fret: '7', techniques: [] }],
          marks: []
        }
      ],
      groups: [{ id: 'g1', type: 'tuplet', ratio: [3, 2], eventIds: ['e2'] }]
    },
    {
      id: 'm2',
      timeSignature: { numerator: 3, denominator: 4 },
      events: [
        {
          id: 'e3',
          at: [1, 2],
          duration: [1, 8],
          notes: [{ id: 'n3', string: 5, fret: '12', techniques: [] }],
          marks: []
        }
      ],
      groups: []
    }
  ],
  relations: [],
  layout: { systemBreakAfter: ['m2'] }
};

const playback = buildPlaybackIndex(documentModel);
assert.equal(playback.entries.length, 3);
assert.equal(playback.totalBeats, 7);
assert.equal(playback.entries[0].durationBeats, 1 / 8);
assert.equal(playback.entries[1].absoluteBeat, 1 / 3);
assert.equal(playback.entries[2].absoluteBeat, 4.5);
assert.equal(playback.entries[2].rowIndex, 0);
assert.equal(playback.entries[2].measureIndexInSystem, 1);

const tripletPosition = legacyPositionForEntry(playback.entries[1]);
assert.equal(tripletPosition, 4 / 3);
assert.equal(Number.isInteger(tripletPosition), false, 'triplets must not be quantized to legacy slots');
assert.equal(nearestPlaybackIndex(playback, 0, 0), 0);
assert.equal(nearestPlaybackIndex(playback, 0, 18), 2);

const openLowE = frequencyForTab(5, 0, 0);
const octaveLowE = frequencyForTab(5, 12, 0);
const capoLowE = frequencyForTab(5, 0, 12);
assert.ok(Math.abs(octaveLowE - openLowE * 2) < 0.000001);
assert.ok(Math.abs(capoLowE - octaveLowE) < 0.000001);

console.log('editor v3 playback tests passed');
