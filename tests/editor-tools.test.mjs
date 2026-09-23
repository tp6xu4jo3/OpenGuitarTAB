import assert from 'node:assert/strict';
import { applyCommand } from '../src/editor/commands.js';
import { createDocumentV3, noteBaseFret, noteDisplayValue } from '../src/editor/model.js';
import { documentToLegacyProjection, migrateSongToDocumentV3 } from '../src/editor/migrate-v2.js';
import { buildPlaybackIndex } from '../src/editor/playback-index.js';
import { resolveTechniqueTarget } from '../src/editor/technique-rules.js';
import { TOOL_TARGET_KINDS, ToolSession, toolTargetKind } from '../src/editor/tool-session.js';
import { eventRangeFromEvent, ToolRegistry } from '../src/editor/tools.js';

function idFactory() {
  let sequence = 0;
  return prefix => `${prefix}-tool-${++sequence}`;
}

const definitions = new ToolRegistry();
const expectedOrder = [
  'harmonic',
  'strumUp',
  'strumDown',
  'arpeggioUp',
  'arpeggioDown',
  'arc',
  'slide',
  'triplet',
  'duration32'
];
assert.deepEqual(definitions.list().map(tool => tool.id), expectedOrder, 'palette order must match the compact guitar workflow');

const expectedTargets = {
  harmonic: 'note',
  strumUp: 'event',
  strumDown: 'event',
  arpeggioUp: 'event',
  arpeggioDown: 'event',
  arc: 'notePair',
  slide: 'notePair',
  triplet: 'eventRange',
  duration32: 'eventRange'
};

const expectedTargetKinds = {
  harmonic: TOOL_TARGET_KINDS.NOTE,
  strumUp: TOOL_TARGET_KINDS.COLUMN,
  strumDown: TOOL_TARGET_KINDS.COLUMN,
  arpeggioUp: TOOL_TARGET_KINDS.COLUMN,
  arpeggioDown: TOOL_TARGET_KINDS.COLUMN,
  arc: TOOL_TARGET_KINDS.NOTE_PAIR,
  slide: TOOL_TARGET_KINDS.NOTE_PAIR,
  triplet: TOOL_TARGET_KINDS.RANGE,
  duration32: TOOL_TARGET_KINDS.RANGE
};

for (const [toolId, target] of Object.entries(expectedTargets)) {
  assert.equal(definitions.get(toolId)?.target, target, `${toolId} target must stay stable`);
  assert.equal(toolTargetKind(definitions.get(toolId)), expectedTargetKinds[toolId], `${toolId} must map to the V3 target kind`);
  assert.ok(definitions.get(toolId)?.label, `${toolId} must expose palette metadata`);
  assert.equal(definitions.get(toolId)?.hint.includes('拖'), false, `${toolId} hint must describe click interaction`);
}
assert.equal(definitions.get('tie'), null, 'tie must not occupy a separate palette button');
assert.equal(definitions.get('slur'), null, 'slur must not occupy a separate palette button');

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
  const rulesDocument = createDocumentV3({
    measures: [{
      id: 'm-rules',
      timeSignature: { numerator: 4, denominator: 4 },
      events: [
        {
          id: 'e-chord',
          at: [0, 1],
          duration: [1, 1],
          notes: [
            { id: 'n-fret-1', string: 0, fret: '1' },
            { id: 'n-chord-2', string: 2, fret: '2' }
          ]
        },
        { id: 'e-same', at: [1, 1], duration: [1, 1], notes: [{ id: 'n-same', string: 0, fret: '1' }] },
        { id: 'e-slide', at: [2, 1], duration: [1, 1], notes: [{ id: 'n-slide', string: 0, fret: '5' }] },
        { id: 'e-other', at: [3, 1], duration: [1, 1], notes: [{ id: 'n-other', string: 1, fret: '7' }] }
      ],
      groups: []
    }]
  });

  assert.equal(resolveTechniqueTarget('harmonic', { noteId: 'n-fret-1' }, rulesDocument).ok, true);
  assert.equal(resolveTechniqueTarget('strumUp', { eventId: 'e-same' }, rulesDocument).ok, false, 'brush needs a chord');
  assert.equal(resolveTechniqueTarget('arpeggioDown', { eventId: 'e-chord' }, rulesDocument).ok, true, 'arpeggio accepts a chord');

  const tie = resolveTechniqueTarget('arc', { fromNoteId: 'n-fret-1', toNoteId: 'n-same' }, rulesDocument);
  assert.equal(tie.ok, true);
  assert.equal(tie.target.relationType, 'tie', 'same string and fret resolves to a tie');

  const slur = resolveTechniqueTarget('arc', { fromNoteId: 'n-fret-1', toNoteId: 'n-slide' }, rulesDocument);
  assert.equal(slur.ok, true);
  assert.equal(slur.target.relationType, 'slur', 'different pitch resolves to a slur');

  assert.equal(resolveTechniqueTarget('slide', { fromNoteId: 'n-fret-1', toNoteId: 'n-slide' }, rulesDocument).ok, true);
  assert.equal(resolveTechniqueTarget('slide', { fromNoteId: 'n-fret-1', toNoteId: 'n-other' }, rulesDocument).ok, false, 'slide must stay on one string');
  assert.equal(resolveTechniqueTarget('slide', { fromNoteId: 'n-slide', toNoteId: 'n-fret-1' }, rulesDocument).ok, false, 'pair relations must move forward in time');
}

{
  const openString = createDocumentV3({
    measures: [{
      id: 'm-open',
      timeSignature: { numerator: 4, denominator: 4 },
      events: [{ id: 'e-open', at: [0, 1], duration: [1, 1], notes: [{ id: 'n-open', string: 0, fret: '0' }] }],
      groups: []
    }]
  });
  assert.equal(resolveTechniqueTarget('harmonic', { noteId: 'n-open' }, openString).ok, false, 'artificial harmonic requires a fretted note');
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
  assert.equal(definitions.createCommand('arpeggioUp', { eventId: 'e' }).mark.type, 'arpeggio');
  assert.equal(definitions.createCommand('arpeggioDown', { eventId: 'e' }).mark.direction, 'down');
  assert.equal(definitions.createCommand('duration32', { measureId: 'm', startAt: [0, 1], endAt: [1, 4] }).type, 'rhythm/32nd/apply');
  assert.equal(definitions.createCommand('slide', { fromNoteId: 'a', toNoteId: 'b' }).relation.type, 'slide');
  assert.equal(definitions.createCommand('arc', { fromNoteId: 'a', toNoteId: 'b', relationType: 'tie' }).relation.type, 'tie');
  assert.equal(definitions.createCommand('arc', { fromNoteId: 'a', toNoteId: 'b', relationType: 'slur' }).relation.type, 'slur');
}

{
  let documentModel = createDocumentV3({
    measures: [{
      id: 'm-sweep',
      timeSignature: { numerator: 4, denominator: 4 },
      events: [{
        id: 'e-sweep',
        at: [0, 1],
        duration: [1, 1],
        notes: [{ id: 'n-sweep-1', string: 0, fret: '3' }, { id: 'n-sweep-2', string: 2, fret: '2' }],
        marks: []
      }],
      groups: []
    }]
  });
  const ids = idFactory();
  documentModel = applyCommand(documentModel, definitions.createCommand('strumUp', { eventId: 'e-sweep' }), { idFactory: ids }).document;
  documentModel = applyCommand(documentModel, definitions.createCommand('arpeggioDown', { eventId: 'e-sweep' }), { idFactory: ids }).document;
  assert.equal(documentModel.measures[0].events[0].marks.length, 1, 'brush and arpeggio are mutually exclusive sweep marks');
  assert.equal(documentModel.measures[0].events[0].marks[0].type, 'arpeggio');
}

console.log('editor tool tests passed');
