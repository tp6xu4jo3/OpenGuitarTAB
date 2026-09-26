import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { frequencyForTab } from '../src/editor/audio-engine.js';
import { migrateSongToDocumentV3 } from '../src/editor/migrate-v2.js';
import { fractionKey } from '../src/editor/model.js';
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
          duration: [1, 3],
          notes: [{ id: 'n1', string: 0, fret: '5', techniques: [] }],
          marks: []
        },
        {
          id: 'e2',
          at: [1, 3],
          duration: [1, 3],
          notes: [{ id: 'n2', string: 1, fret: '7', techniques: [] }],
          marks: []
        },
        {
          id: 'e2b',
          at: [2, 3],
          duration: [1, 3],
          notes: [{ id: 'n2b', string: 2, fret: '9', techniques: [] }],
          marks: []
        }
      ],
      groups: [{
        id: 'g1',
        type: 'tuplet',
        ratio: [3, 2],
        subdivision: 'eighth',
        beamCount: 1,
        startAt: [0, 1],
        endExclusive: [1, 1],
        duration: [1, 3],
        slots: [[0, 1], [1, 3], [2, 3]],
        eventIds: ['e1', 'e2', 'e2b']
      }]
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
assert.equal(playback.entries.length, 27, 'playback must traverse every editable column, including empty columns');
assert.equal(playback.totalBeats, 7);
const m1Entries = playback.entries.filter(entry => entry.measureId === 'm1');
const m2Entries = playback.entries.filter(entry => entry.measureId === 'm2');
assert.equal(m1Entries.length, 15, 'one triplet beat plus three regular beats yields fifteen editable columns');
assert.equal(m2Entries.length, 12, 'a three-beat measure yields twelve sixteenth-grid columns');
assert.deepEqual(m1Entries.slice(0, 3).map(entry => fractionKey(entry.at)), ['0/1', '1/3', '2/3']);
assert.ok(m1Entries.slice(0, 3).every(entry => Math.abs(entry.durationBeats - 1 / 3) < 1e-9), 'triplet playback cells must keep equal thirds');
assert.deepEqual(m1Entries.find(entry => fractionKey(entry.at) === '5/4')?.events, [], 'an empty editable column must remain on the timeline');
assert.equal(m1Entries[0].events[0].eventId, 'e1');
assert.equal(m1Entries[1].events[0].eventId, 'e2');
assert.equal(m1Entries[2].events[0].eventId, 'e2b');
assert.equal(m1Entries[1].events[0].offsetBeats, 0, 'events start at their exact playback column');
assert.equal(m2Entries.find(entry => fractionKey(entry.at) === '1/2')?.events[0].eventId, 'e3');
assert.equal(m2Entries[0].absoluteBeat, 4);
assert.equal(m2Entries[0].rowIndex, 0);
assert.equal(m2Entries[0].measureIndexInSystem, 1);

const secondBeatEntry = m1Entries.find(entry => fractionKey(entry.at) === '1/1');
assert.equal(legacyPositionForEntry(secondBeatEntry), 4);
assert.equal(nearestPlaybackIndex(playback, 0, 0), 0);
const legacy18 = nearestPlaybackIndex(playback, 0, 18);
assert.equal(playback.entries[legacy18].measureId, 'm2');
assert.equal(fractionKey(playback.entries[legacy18].at), '3/2');

const openLowE = frequencyForTab(5, 0, 0);
const octaveLowE = frequencyForTab(5, 12, 0);
const capoLowE = frequencyForTab(5, 0, 12);
assert.ok(Math.abs(octaveLowE - openLowE * 2) < 0.000001);
assert.ok(Math.abs(capoLowE - octaveLowE) < 0.000001);

const compoundRow = Array.from({ length: 6 }, () => Array(48).fill(''));
compoundRow[0][0] = '0';
const compoundSong = {
  id: 'legacy-six-eight',
  beatsPerMeasure: 3,
  meter: '6/8',
  rows: [compoundRow],
  rowMeasureCounts: [1],
  rhythmRows: [{}]
};
const compoundDocument = migrateSongToDocumentV3(compoundSong);
assert.deepEqual(compoundDocument.measures[0].timeSignature, { numerator: 6, denominator: 8 });
assert.equal(buildPlaybackIndex(compoundDocument).totalBeats, 3, '6/8 must keep the legacy three-quarter-note measure duration');
assert.equal(buildPlaybackIndex(compoundDocument).entries.length, 12, 'compound meter playback must still visit every fillable sixteenth-grid column');

const inconsistentMeter = migrateSongToDocumentV3({ ...compoundSong, meter: '4/4' });
assert.deepEqual(
  inconsistentMeter.measures[0].timeSignature,
  { numerator: 3, denominator: 4 },
  'inconsistent legacy meter metadata must fall back to beatsPerMeasure'
);

const playbackControllerSource = await readFile(new URL('../src/editor/playback-controller.js', import.meta.url), 'utf8');
assert.equal(
  (playbackControllerSource.match(/ensureIndex\(\{ force: true \}\)/g) || []).length,
  1,
  'only the explicit rebuild API may force a full playback index rebuild'
);
assert.equal(
  playbackControllerSource.includes("querySelectorAll('.playhead-column')"),
  false,
  'clearing the sparse playback cursor must not scan the whole document for legacy playhead nodes'
);
assert.match(playbackControllerSource, /v3-playback-beat/,'playback must render one rounded column bar rather than note highlights');
assert.doesNotMatch(playbackControllerSource, /\.classList\.add\('is-playing'\)/,'playback must not highlight individual notes');
assert.match(playbackControllerSource, /timelineDirty[\s\S]*navigationPlaybackIndex\(\)[\s\S]*state\.playbackIndex && !state\.timelineDirty/s, 'ordinary content edits should reuse the existing playback timeline for navigation until fresh event data is needed');
assert.match(playbackControllerSource, /function invalidatePlaybackIndex\(\{ timeline = false \} = \{\}\)/s, 'playback invalidation should distinguish content dirtiness from timeline-topology dirtiness');

console.log('editor v3 playback tests passed');
