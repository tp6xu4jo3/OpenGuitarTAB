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
    technique: { type: 'harmonic', kind: 'natural' }
  });
  documentModel = result.document;
  assert.deepEqual(result.changeSet.measures, [firstMeasure.id]);
  assert.deepEqual(result.changeSet.playback, []);
  assert.equal(documentModel.measures[0].events[0].notes[0].techniques[0].type, 'harmonic');
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
  assert.deepEqual(tools.createCommand('duration32', { eventId: firstEvent.id }).duration, [1, 8]);
  assert.equal(tools.createCommand('slide', { fromNoteId: 'a', toNoteId: 'b' }).relation.type, 'slide');
}

{
  const clipboardDocument = migrateSongToDocumentV3(legacySong);
  const noteA = clipboardDocument.measures[0].events[0].notes[0];
  const noteB = clipboardDocument.measures[0].events[0].notes[1];
  const withRelation = applyCommand(clipboardDocument, {
    type: 'relation/add',
    relation: { type: 'tie', fromNoteId: noteA.id, toNoteId: noteB.id }
  }, { idFactory: idFactory() }).document;

  const clipboard = new EditorClipboard();
  clipboard.copyMeasure(withRelation, withRelation.measures[0].id);
  const pasted = clipboard.pasteMeasure(withRelation, withRelation.measures[1].id, { idFactory: idFactory() });
  assert.ok(pasted);
  const target = pasted.document.measures[1];
  assert.notEqual(target.events[0].id, withRelation.measures[0].events[0].id);
  assert.notEqual(target.events[0].notes[0].id, noteA.id);
  const pastedTie = pasted.document.relations.find(relation => relation.type === 'tie' && relation.id !== withRelation.relations[0].id);
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
