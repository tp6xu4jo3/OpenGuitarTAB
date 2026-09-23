import assert from 'node:assert/strict';
import { applyCommand } from '../src/editor/commands.js';
import { createDocumentV3, noteBaseFret, noteDisplayValue } from '../src/editor/model.js';
import { documentToLegacyProjection, migrateSongToDocumentV3 } from '../src/editor/migrate-v2.js';
import { buildPlaybackIndex } from '../src/editor/playback-index.js';
import { TOOL_TARGET_KINDS, ToolSession, toolTargetKind } from '../src/editor/tool-session.js';
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

const expectedTargetKinds = {
  harmonic: TOOL_TARGET_KINDS.NOTE,
  strumUp: TOOL_TARGET_KINDS.COLUMN,
  strumDown: TOOL_TARGET_KINDS.COLUMN,
  duration32: TOOL_TARGET_KINDS.COLUMN,
  triplet: TOOL_TARGET_KINDS.RANGE,
  slide: TOOL_TARGET_KINDS.NOTE_PAIR,
  tie: TOOL_TARGET_KINDS.NOTE_PAIR,
  slur: TOOL_TARGET_KINDS.NOTE_PAIR
};

for (const [toolId, target] of Object.entries(expectedTargets)) {
  assert.equal(definitions.get(toolId)?.target, target, `${toolId} target must stay stable`);
  assert.equal(toolTargetKind(definitions.get(toolId)), expectedTargetKinds[toolId], `${toolId} must map to the V3 target kind`);
  assert.ok(definitions.get(toolId)?.label, `${toolId} must expose palette metadata`);
  assert.equal(definitions.get(toolId)?.hint.includes('拖'), false, `${toolId} hint must describe click interaction`);
}

{
  const session = new ToolSession();
  session.activate('harmonic', TOOL_TARGET_KINDS.NOTE);
  assert.equal(session.snapshot().state, 'selected');
  const result = session.select({ noteId: 'n-1' });
  assert.deepEqual(result, { status: 'complete', target: { noteId: 'n-1' } });
  assert.equal(session.snapshot().toolId, 'harmonic', 'session stays active until the command succeeds');
  session.commitSuccess();
  assert.equal(session.snapshot().state, 'idle');

  session.activate('harmonic', TOOL_TARGET_KINDS.NOTE);
  session.activate('harmonic', TOOL_TARGET_KINDS.NOTE);
  assert.equal(session.snapshot().state, 'idle', 'clicking the active tool again cancels it');
}

{
  const session = new ToolSession();
  session.activate('slide', TOOL_TARGET_KINDS.NOTE_PAIR);
  assert.equal(session.select({ noteId: 'n-a' }).status, 'pending');
  assert.equal(session.snapshot().state, 'selecting-target');
  assert.equal(session.select({ noteId: 'n-a' }).reason, 'same-note');
  assert.deepEqual(session.select({ noteId: 'n-b' }).target, {
    fromNoteId: 'n-a',
    toNoteId: 'n-b'
  });
  assert.equal(session.snapshot().firstTarget.noteId, 'n-a', 'failed or uncommitted pair selection must retain the first target');
  session.commitSuccess();
  assert.equal(session.snapshot().state, 'idle');
}

{
  const session = new ToolSession();
  session.activate('triplet', TOOL_TARGET_KINDS.RANGE);
  assert.equal(session.select({ measureId: 'm-1', at: [2, 1] }).status, 'pending');
  assert.equal(session.select({ measureId: 'm-2', at: [3, 1] }).reason, 'same-measure-required');
  assert.equal(session.select({ measureId: 'm-1', at: [2, 1] }).reason, 'different-position-required');
  assert.deepEqual(session.select({ measureId: 'm-1', at: [1, 1] }).target, {
    measureId: 'm-1',
    startAt: [1, 1],
    endAt: [2, 1]
  });
  assert.deepEqual(session.snapshot().firstTarget, { measureId: 'm-1', at: [2, 1] });
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
  assert.ok(grouped.measures[0].groups[0].id, 'groups must own stable IDs');
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
  const documentModel = createDocumentV3({
    measures: [{
      id: 'm-harmonic',
      timeSignature: { numerator: 4, denominator: 4 },
      events: [{
        id: 'e-harmonic',
        at: [0, 1],
        duration: [1, 1],
        notes: [{ id: 'n-harmonic', string: 0, fret: '1' }]
      }],
      groups: []
    }]
  });
  const added = applyCommand(
    documentModel,
    definitions.createCommand('harmonic', { noteId: 'n-harmonic' }),
    { idFactory: idFactory() }
  );
  const note = added.document.measures[0].events[0].notes[0];
  const technique = note.techniques[0];

  assert.equal(note.fret, '', 'canonical harmonic notes must not duplicate the base fret');
  assert.equal(technique.type, 'harmonic');
  assert.equal(technique.touchFret, 13, '1st fret artificial harmonic must store only touch fret 13');
  assert.ok(technique.id, 'techniques must own stable IDs');
  assert.equal('baseFret' in technique, false);
  assert.equal(noteBaseFret(note), '1');
  assert.equal(noteDisplayValue(note), '1<13>');
  assert.equal(documentToLegacyProjection(added.document).rows[0][0][0], '1');
  assert.equal(buildPlaybackIndex(added.document).entries[0].notes[0].fret, '13', 'playback must use harmonic sounding fret');

  const removed = applyCommand(added.document, { type: 'technique/delete', techniqueId: technique.id });
  const restored = removed.document.measures[0].events[0].notes[0];
  assert.equal(restored.fret, '1', 'deleting a harmonic restores the derived base fret');
  assert.deepEqual(restored.techniques, []);
}

{
  assert.deepEqual(definitions.createCommand('harmonic', { noteId: 'n' }).technique, { type: 'harmonic' });
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
