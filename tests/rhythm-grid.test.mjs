import assert from 'node:assert/strict';
import { applyCommand } from '../src/editor/commands.js';
import { createDocumentV3, fractionKey } from '../src/editor/model.js';
import { buildPlaybackIndex } from '../src/editor/playback-index.js';
import {
  applyThirtySecondRangeToMeasure,
  applyTripletRangeToMeasure,
  fractionalGridTimes,
  thirtySecondRange,
  tripletRange
} from '../src/editor/rhythm-grid.js';
import { resolveTechniqueTarget } from '../src/editor/technique-rules.js';

function idFactory() {
  let sequence = 0;
  return prefix => `${prefix}-rhythm-${++sequence}`;
}

{
  const range = tripletRange([0, 1], [1, 4]);
  assert.deepEqual(range.endExclusive, [1, 2], 'two selected 16th columns span one eighth-note window');
  assert.deepEqual(range.duration, [1, 6], 'three notes must occupy the time of two sixteenths');
  assert.deepEqual(range.slots, [[0, 1], [1, 6], [1, 3]]);
}

{
  const measure = {
    id: 'm-empty-triplet',
    timeSignature: { numerator: 4, denominator: 4 },
    events: [],
    groups: []
  };
  const result = applyTripletRangeToMeasure(measure, { startAt: [0, 1], endAt: [1, 4] }, idFactory());
  assert.equal(result.ok, true);
  assert.deepEqual(result.measure.events, [], 'empty triplet range must stay sparse');
  assert.equal(result.measure.groups.length, 1);
  assert.deepEqual(result.measure.groups[0].ratio, [3, 2]);
  assert.deepEqual(result.measure.groups[0].slots, [[0, 1], [1, 6], [1, 3]]);
  assert.equal(fractionalGridTimes(result.measure).length, 3, 'empty triplet must still expose three editable time positions');
}

{
  const measure = {
    id: 'm-two-events',
    timeSignature: { numerator: 4, denominator: 4 },
    events: [
      { id: 'e-head', at: [0, 1], duration: [1, 4], notes: [{ id: 'n-head', string: 0, fret: '3', techniques: [] }], marks: [] },
      { id: 'e-tail', at: [1, 4], duration: [1, 4], notes: [{ id: 'n-tail', string: 0, fret: '5', techniques: [] }], marks: [] }
    ],
    groups: []
  };
  const result = applyTripletRangeToMeasure(measure, { startAt: [0, 1], endAt: [1, 4] }, idFactory());
  assert.equal(result.ok, true);
  assert.deepEqual(result.measure.events.map(event => event.at), [[0, 1], [1, 3]], 'two events map to triplet head and tail');
  assert.deepEqual(result.measure.events.map(event => event.duration), [[1, 6], [1, 6]]);
}

{
  const events = [0, 1, 2, 3].map(index => ({
    id: `e-${index}`,
    at: [index, 4],
    duration: [1, 4],
    notes: [{ id: `n-${index}`, string: 0, fret: String(index + 1), techniques: [] }],
    marks: []
  }));
  const documentModel = createDocumentV3({
    measures: [{ id: 'm-too-many', timeSignature: { numerator: 4, denominator: 4 }, events, groups: [] }]
  });
  const validation = resolveTechniqueTarget('triplet', {
    measureId: 'm-too-many',
    startAt: [0, 1],
    endAt: [3, 4]
  }, documentModel);
  assert.equal(validation.ok, false, 'four existing events in a triplet range must be rejected');
}

{
  assert.deepEqual(thirtySecondRange([0, 1], [1, 4])?.slots, [[0, 1], [1, 8]]);
  assert.equal(thirtySecondRange([0, 1], [1, 2]), null, '32nd selection requires adjacent 16th columns');

  const measure = {
    id: 'm-32',
    timeSignature: { numerator: 4, denominator: 4 },
    events: [],
    groups: []
  };
  const result = applyThirtySecondRangeToMeasure(measure, { startAt: [0, 1], endAt: [1, 4] }, idFactory());
  assert.equal(result.ok, true);
  assert.deepEqual(result.measure.events.map(event => event.at), [[0, 1], [1, 8]]);
  assert.deepEqual(result.measure.events.map(event => event.duration), [[1, 8], [1, 8]]);
  assert.ok(result.measure.events.every(event => event.rhythmAnchor && event.rhythmOnly));
  assert.deepEqual(fractionalGridTimes(result.measure).map(item => fractionKey(item.at)), ['0/1', '1/8']);
}

{
  let documentModel = createDocumentV3({
    measures: [{ id: 'm-edit-32', timeSignature: { numerator: 4, denominator: 4 }, events: [], groups: [] }]
  });
  const ids = idFactory();
  documentModel = applyCommand(documentModel, {
    type: 'rhythm/32nd/apply',
    measureId: 'm-edit-32',
    startAt: [0, 1],
    endAt: [1, 4]
  }, { idFactory: ids }).document;

  documentModel = applyCommand(documentModel, {
    type: 'note/set',
    measureId: 'm-edit-32',
    at: [1, 8],
    duration: [1, 8],
    string: 0,
    fret: '7'
  }, { idFactory: ids }).document;

  let midpoint = documentModel.measures[0].events.find(event => fractionKey(event.at) === '1/8');
  assert.equal(midpoint.notes[0].fret, '7');
  assert.equal(midpoint.rhythmAnchor, true);
  assert.equal(midpoint.rhythmOnly, false);

  documentModel = applyCommand(documentModel, {
    type: 'note/set',
    measureId: 'm-edit-32',
    at: [1, 8],
    duration: [1, 8],
    string: 0,
    fret: ''
  }, { idFactory: ids }).document;

  midpoint = documentModel.measures[0].events.find(event => fractionKey(event.at) === '1/8');
  assert.ok(midpoint, 'deleting the note must preserve the 32nd rhythm position');
  assert.equal(midpoint.rhythmOnly, true);
  assert.deepEqual(midpoint.notes, []);
}

{
  let documentModel = createDocumentV3({
    measures: [{
      id: 'm-play-triplet',
      timeSignature: { numerator: 4, denominator: 4 },
      events: [
        { id: 'e-a', at: [0, 1], duration: [1, 4], notes: [{ id: 'n-a', string: 0, fret: '3', techniques: [] }], marks: [] },
        { id: 'e-b', at: [1, 4], duration: [1, 4], notes: [{ id: 'n-b', string: 0, fret: '5', techniques: [] }], marks: [] }
      ],
      groups: []
    }]
  });
  documentModel = applyCommand(documentModel, {
    type: 'rhythm/triplet/apply',
    measureId: 'm-play-triplet',
    startAt: [0, 1],
    endAt: [1, 4]
  }, { idFactory: idFactory() }).document;

  const playback = buildPlaybackIndex(documentModel);
  assert.deepEqual(playback.entries.map(entry => entry.at), [[0, 1], [1, 3]]);
  assert.deepEqual(playback.entries.map(entry => entry.duration), [[1, 6], [1, 6]]);
  assert.equal(playback.entries[1].absoluteBeat, 1 / 3, 'playback must schedule the remapped triplet tail at exact fractional time');
}

console.log('fractional rhythm grid tests passed');
