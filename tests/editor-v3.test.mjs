import assert from 'node:assert/strict';
import { EditorClipboard } from '../src/editor/clipboard.js';
import { applyCommand } from '../src/editor/commands.js';
import { buildSystems } from '../src/editor/layout.js';
import { fractionToNumber } from '../src/editor/model.js';
import {
  documentToLegacyProjection,
  migrateSongToDocumentV3,
  reconcileLegacyMeasure
} from '../src/editor/migrate-v2.js';
import { ScoreStore } from '../src/editor/store.js';
import {
  deleteMeasureAt,
  deleteSystem,
  insertMeasureAt,
  insertSystem,
  moveMeasureAt,
  moveSystem
} from '../src/editor/structure-commands.js';
import { ToolRegistry } from '../src/editor/tools.js';
import { deserializeSong, serializeSong } from '../src/core/song-codec.js';

function row(beats = 4) {
  return Array.from({ length: 6 }, () => Array(4 * beats * 4).fill(''));
}

function idFactory() {
  let sequence = 0;
  return prefix => `${prefix}-test-${++sequence}`;
}

const legacyRow = row();
legacyRow[0][0] = '5';
legacyRow[1][0] = '7';
legacyRow[0][4] = '8';
legacyRow[2][16] = '12';
const legacySong = {
  id: 'legacy-song',
  name: 'Legacy',
  beatsPerMeasure: 4,
  meter: '4/4',
  rows: [legacyRow],
  rowMeasureCounts: [2],
  rhythmRows: [{ 0: 4, 4: 2, 16: 8 }]
};

const migrated = migrateSongToDocumentV3(legacySong);
assert.equal(migrated.version, 3);
assert.equal(migrated.measures.length, 2);
assert.equal(buildSystems(migrated)[0].length, 2);
assert.equal(migrated.measures[0].events.length, 2);
assert.deepEqual(migrated.measures[0].events[0].at, [0, 1]);
assert.deepEqual(migrated.measures[0].events[0].duration, [1, 1]);
assert.deepEqual(migrated.measures[0].events[1].at, [1, 1]);
assert.deepEqual(migrated.measures[0].events[1].duration, [1, 2]);
assert.equal(migrated.measures[0].events[0].notes.length, 2);

const projection = documentToLegacyProjection(migrated);
assert.equal(projection.lossy, false);
assert.deepEqual(projection.rowMeasureCounts, [2]);
assert.equal(projection.rows[0][0][0], '5');
assert.equal(projection.rows[0][1][0], '7');
assert.equal(projection.rows[0][0][4], '8');
assert.equal(projection.rows[0][2][16], '12');
assert.equal(projection.rhythmRows[0][4], 2);

{
  const legacy = structuredClone(legacySong);
  const before = migrateSongToDocumentV3(legacy);
  const untouched = before.measures[1];
  legacy.rows[0][0][4] = '9';
  legacy.rhythmRows[0] = { 0: 4, 4: 2, 16: 8 };
  const after = reconcileLegacyMeasure(legacy, before, 0, 0);
  assert.notEqual(after.measures[0], before.measures[0]);
  assert.equal(after.measures[1], untouched, 'unaffected measures must keep identity');
  assert.equal(after.measures[0].events[1].notes[0].fret, '9');
}

let documentModel = migrated;
const firstMeasure = documentModel.measures[0];
const firstEvent = firstMeasure.events[0];
const firstNote = firstEvent.notes[0];
const secondNote = firstEvent.notes[1];

{
  const result = applyCommand(documentModel, {
    type: 'note/technique/add',
    noteId: firstNote.id,
    technique: { type: 'harmonic' }
  }, { idFactory: idFactory() });
  documentModel = result.document;
  const harmonicNote = documentModel.measures[0].events[0].notes[0];
  assert.deepEqual(result.changeSet.measures, [firstMeasure.id]);
  assert.deepEqual(result.changeSet.playback, [firstMeasure.id]);
  assert.equal(harmonicNote.fret, '');
  assert.equal(harmonicNote.techniques[0].type, 'harmonic');
  assert.equal(harmonicNote.techniques[0].touchFret, 17);
  assert.ok(harmonicNote.techniques[0].id);
}

{
  const result = applyCommand(documentModel, {
    type: 'event/duration/set',
    eventId: firstEvent.id,
    duration: [1, 8]
  });
  documentModel = result.document;
  assert.deepEqual(documentModel.measures[0].events[0].duration, [1, 8]);
  assert.equal(fractionToNumber(documentModel.measures[0].events[0].duration), 0.125);
  assert.deepEqual(result.changeSet.playback, [firstMeasure.id]);
}

{
  const result = applyCommand(documentModel, {
    type: 'event/duration/set',
    eventId: firstEvent.id,
    duration: [1, 3]
  });
  documentModel = result.document;
  assert.deepEqual(documentModel.measures[0].events[0].duration, [1, 3]);
  assert.equal(fractionToNumber(documentModel.measures[0].events[0].duration), 1 / 3);
}

{
  const result = applyCommand(documentModel, {
    type: 'group/add',
    measureId: firstMeasure.id,
    group: {
      type: 'tuplet',
      ratio: [3, 2],
      eventIds: documentModel.measures[0].events.slice(0, 2).map(event => event.id)
    }
  }, { idFactory: idFactory() });
  documentModel = result.document;
  assert.equal(documentModel.measures[0].groups[0].type, 'tuplet');
  assert.deepEqual(documentModel.measures[0].groups[0].ratio, [3, 2]);
  assert.ok(documentModel.measures[0].groups[0].id);
}

let slideId;
{
  const result = applyCommand(documentModel, {
    type: 'relation/add',
    relation: { type: 'slide', fromNoteId: firstNote.id, toNoteId: secondNote.id }
  }, { idFactory: idFactory() });
  documentModel = result.document;
  slideId = documentModel.relations.at(-1).id;
  assert.equal(documentModel.relations.at(-1).type, 'slide');
  assert.deepEqual(result.changeSet.measures, [firstMeasure.id]);
}

{
  const result = applyCommand(documentModel, { type: 'note/delete', noteId: secondNote.id });
  documentModel = result.document;
  assert.equal(documentModel.relations.some(relation => relation.id === slideId), false);
  assert.equal(result.changeSet.relations.includes(slideId), true);
}

{
  const tools = new ToolRegistry();
  assert.equal(tools.get('harmonic').target, 'note');
  const duration32 = tools.createCommand('duration32', {
    measureId: firstMeasure.id,
    startAt: [0, 1],
    endAt: [1, 4]
  });
  assert.equal(duration32.type, 'rhythm/32nd/apply');
  assert.deepEqual(duration32.startAt, [0, 1]);
  assert.deepEqual(duration32.endAt, [1, 4]);
  assert.equal(tools.createCommand('slide', { fromNoteId: 'a', toNoteId: 'b' }).relation.type, 'slide');
}

{
  const clipboardDocument = migrateSongToDocumentV3(legacySong);
  const noteA = clipboardDocument.measures[0].events[0].notes[0];
  const noteB = clipboardDocument.measures[0].events[0].notes[1];
  let withDecorations = applyCommand(clipboardDocument, {
    type: 'note/technique/add',
    noteId: noteA.id,
    technique: { type: 'harmonic' }
  }, { idFactory: idFactory() }).document;
  withDecorations = applyCommand(withDecorations, {
    type: 'event/mark/add',
    eventId: withDecorations.measures[0].events[0].id,
    mark: { type: 'strum', direction: 'up' }
  }, { idFactory: idFactory() }).document;
  withDecorations = applyCommand(withDecorations, {
    type: 'relation/add',
    relation: { type: 'tie', fromNoteId: noteA.id, toNoteId: noteB.id }
  }, { idFactory: idFactory() }).document;

  const sourceTechniqueId = withDecorations.measures[0].events[0].notes[0].techniques[0].id;
  const sourceMarkId = withDecorations.measures[0].events[0].marks[0].id;
  const clipboard = new EditorClipboard();
  clipboard.copyMeasure(withDecorations, withDecorations.measures[0].id);
  const pasted = clipboard.pasteMeasure(withDecorations, withDecorations.measures[1].id, { idFactory: idFactory() });
  assert.ok(pasted);
  const target = pasted.document.measures[1];
  assert.notEqual(target.events[0].id, withDecorations.measures[0].events[0].id);
  assert.notEqual(target.events[0].notes[0].id, noteA.id);
  assert.notEqual(target.events[0].notes[0].techniques[0].id, sourceTechniqueId, 'pasted techniques need fresh IDs');
  assert.notEqual(target.events[0].marks[0].id, sourceMarkId, 'pasted marks need fresh IDs');
  const pastedTie = pasted.document.relations.find(relation => relation.type === 'tie' && relation.id !== withDecorations.relations[0].id);
  assert.ok(pastedTie);
  const targetNoteIds = new Set(target.events.flatMap(event => event.notes.map(note => note.id)));
  assert.equal(targetNoteIds.has(pastedTie.fromNoteId), true);
  assert.equal(targetNoteIds.has(pastedTie.toNoteId), true);
}

{
  const song = structuredClone(legacySong);
  const store = new ScoreStore(song);
  assert.equal(song.document.version, 3);
  const measureId = store.getDocument().measures[0].id;
  const result = store.dispatch({
    type: 'note/set',
    measureId,
    at: [2, 1],
    string: 3,
    fret: '9',
    duration: [1, 4]
  }, { idFactory: idFactory() });
  assert.deepEqual(result.changeSet.measures, [measureId]);
  assert.equal(store.getDocument().measures[0].events.some(event => event.notes.some(note => note.fret === '9')), true);

  const authoritative = store.snapshot();
  song.rows[0][0][0] = '22';
  assert.deepEqual(store.getDocument(), authoritative, 'legacy rows must not rewrite the V3 store');
  assert.equal(typeof store.reconcileLegacySong, 'undefined');
  assert.equal(typeof store.reconcileLegacyMeasure, 'undefined');
}

{
  const ids = idFactory();
  let structure = migrateSongToDocumentV3(legacySong);
  structure = insertSystem(structure, 1, { measureCount: 2, idFactory: ids }).document;
  assert.deepEqual(buildSystems(structure).map(system => system.length), [2, 2]);

  structure = insertMeasureAt(structure, 0, 1, { idFactory: ids }).document;
  assert.deepEqual(buildSystems(structure).map(system => system.length), [3, 2]);

  const movedMeasureId = buildSystems(structure)[0][0].id;
  structure = moveMeasureAt(structure, 0, 0, 1, 1, { idFactory: ids }).document;
  assert.deepEqual(buildSystems(structure).map(system => system.length), [2, 3]);
  assert.equal(buildSystems(structure)[1][1].id, movedMeasureId);

  structure = moveSystem(structure, 1, 0).document;
  assert.equal(buildSystems(structure)[0].some(measure => measure.id === movedMeasureId), true);

  structure = deleteMeasureAt(structure, 0, 0).document;
  assert.equal(buildSystems(structure)[0].length, 2);

  structure = deleteSystem(structure, 1).document;
  assert.equal(buildSystems(structure).length, 1);
  assert.equal(documentToLegacyProjection(structure).lossy, false);
}

{
  const pureV3Song = {
    id: 'v3-only',
    name: 'V3 only',
    document: migrated
  };
  const encoded = serializeSong(pureV3Song);
  const decoded = deserializeSong(encoded);
  assert.equal(decoded.document.version, 3);
  assert.equal(decoded.document.measures.length, 2);
}

console.log('editor v3 tests passed');
