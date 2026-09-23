import assert from 'node:assert/strict';
import { applyCommand } from '../src/editor/commands.js';
import { createDocumentV3 } from '../src/editor/model.js';
import { documentToLegacyProjection, migrateSongToDocumentV3 } from '../src/editor/migrate-v2.js';
import { eventRangeFromEvent, ToolRegistry } from '../src/editor/tools.js';

function idFactory() {
  let sequence = 0;
  return prefix => `${prefix}-tool-${++sequence}`;
}

const definitions = new ToolRegistry();
const expectedTargets = {
  harmonic: 'note',
  strumUp: 'event',
  strumDown: 'event',
  duration32: 'event',
  triplet: 'eventRange',
  slide: 'notePair',
  tie: 'notePair',
  slur: 'notePair'
};

for (const [toolId, target] of Object.entries(expectedTargets)) {
  assert.equal(definitions.get(toolId)?.target, target, `${toolId} target must stay stable`);
  assert.ok(definitions.get(toolId)?.label, `${toolId} must expose palette metadata`);
}

{
  const documentModel = createDocumentV3({
    measures: [{
      id: 'm-tools',
      timeSignature: { numerator: 4, denominator: 4 },
      events: [
        { id: 'e-1', at: [0, 1], duration: [1, 1], notes: [{ id: 'n-1', string: 0, fret: '5' }] },
        { id: 'e-2', at: [1, 1], duration: [1, 1], notes: [{ id: 'n-2', string: 0, fret: '7' }] },
        { id: 'e-3', at: [2, 1], duration: [1, 1], notes: [{ id: 'n-3', string: 0, fret: '8' }] }
      ],
      groups: []
    }]
  });
  assert.deepEqual(eventRangeFromEvent(documentModel, 'e-1', 3), {
    measureId: 'm-tools',
    eventIds: ['e-1', 'e-2', 'e-3']
  });
  assert.equal(eventRangeFromEvent(documentModel, 'e-2', 3), null, 'triplet range must not cross a measure boundary');

  const tripletCommand = definitions.createCommand('triplet', eventRangeFromEvent(documentModel, 'e-1', 3));
  const grouped = applyCommand(documentModel, tripletCommand, { idFactory: idFactory() }).document;
  assert.equal(grouped.measures[0].groups[0].type, 'tuplet');
  assert.deepEqual(grouped.measures[0].groups[0].eventIds, ['e-1', 'e-2', 'e-3']);
}

{
  const row = Array.from({ length: 6 }, () => Array(64).fill(''));
  row[0][0] = '5';
  const legacySong = {
    id: 'duration32-compat',
    beatsPerMeasure: 4,
    rows: [row],
    rowMeasureCounts: [1],
    rhythmRows: [{ 0: 4 }]
  };
  const documentModel = migrateSongToDocumentV3(legacySong);
  const event = documentModel.measures[0].events[0];
  const result = applyCommand(documentModel, definitions.createCommand('duration32', { eventId: event.id }));
  const projection = documentToLegacyProjection(result.document);

  assert.deepEqual(result.document.measures[0].events[0].duration, [1, 8]);
  assert.equal(projection.lossy, true, 'legacy rhythm cannot exactly express a 32nd duration');
  assert.equal(projection.structuralLossy, false, '32nd duration must remain safe for the compatibility grid');
  assert.equal(projection.rows[0][0][0], '5', 'compatibility projection must not drop a 32nd-note event');
  assert.equal(projection.rhythmRows[0][0], 1, 'legacy rhythm should use its smallest visual slot only');
}

{
  assert.deepEqual(definitions.createCommand('harmonic', { noteId: 'n' }).technique, { type: 'harmonic', kind: 'natural' });
  assert.equal(definitions.createCommand('strumUp', { eventId: 'e' }).mark.direction, 'up');
  assert.equal(definitions.createCommand('strumDown', { eventId: 'e' }).mark.direction, 'down');
  assert.deepEqual(definitions.createCommand('duration32', { eventId: 'e' }).duration, [1, 8]);
  for (const toolId of ['slide', 'tie', 'slur']) {
    const command = definitions.createCommand(toolId, { fromNoteId: 'a', toNoteId: 'b' });
    assert.equal(command.type, 'relation/add');
    assert.equal(command.relation.type, toolId);
  }
}

console.log('editor tool tests passed');
