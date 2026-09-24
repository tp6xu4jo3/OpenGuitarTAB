import assert from 'node:assert/strict';
import { EditorClipboard } from '../src/editor/clipboard.js';
import { applyCommand } from '../src/editor/commands.js';
import { buildSystems } from '../src/editor/layout.js';
import { createBlankDocumentV3, fractionToNumber } from '../src/editor/model.js';
import { ensureSongDocumentV3, migrateSongToDocumentV3 } from '../src/editor/migrate-v2.js';
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

{
  const legacy = structuredClone(legacySong);
  const documentModel = ensureSongDocumentV3(legacy);
  assert.equal(documentModel.version, 3);
  assert.equal('rows' in legacy, false, 'legacy rows must be removed after migration');
  assert.equal('rhythmRows' in legacy, false, 'legacy rhythm rows must be removed after migration');
  assert.equal('rowMeasureCounts' in legacy, false, 'legacy row counts must be removed after migration');
}

{
  const blank = createBlankDocumentV3({ beats: 3, systems: 4, measuresPerSystem: 4, idFactory: idFactory() });
  assert.equal(blank.measures.length, 16);
  assert.deepEqual(buildSystems(blank).map(system => system.length), [4, 4, 4, 4]);
  assert.equal(blank.measures.every(measure => measure.timeSignature.numerator === 3), true);
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
  assert.equal(harmonicNote.fret, '5');
  assert.equal(harmonicNote.techniques[0].type, 'harmonic');
  assert.equal(harmonicNote.techniques[0].touchFret, 17);
}

{
  const result = applyCommand(documentModel, { type: 'event/duration/set', eventId: firstEvent.id, duration: [1, 8] });
  documentModel = result.document;
  assert.equal(fractionToNumber(documentModel.measures[0].events[0].duration), 0.125);
}

{
  const result = applyCommand(documentModel, {
    type: 'group/add',
    measureId: firstMeasure.id,
    group: { type: 'tuplet', ratio: [3, 2], eventIds: documentModel.measures[0].events.slice(0, 2).map(event => event.id) }
  }, { idFactory: idFactory() });
  documentModel = result.document;
  assert.equal(documentModel.measures[0].groups[0].type, 'tuplet');
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
}

{
  const result = applyCommand(documentModel, { type: 'note/delete', noteId: secondNote.id });
  documentModel = result.document;
  assert.equal(documentModel.relations.some(relation => relation.id === slideId), false);
}

{
  const tools = new ToolRegistry();
  assert.equal(tools.get('harmonic').target, 'note');
  const duration32 = tools.createCommand('duration32', { measureId: firstMeasure.id, startAt: [0, 1], endAt: [1, 4] });
  assert.equal(duration32.type, 'rhythm/32nd/apply');
  assert.equal(tools.createCommand('slide', { fromNoteId: 'a', toNoteId: 'b' }).relation.type, 'slide');
}

{
  const clipboardDocument = migrateSongToDocumentV3(legacySong);
  const noteA = clipboardDocument.measures[0].events[0].notes[0];
  const noteB = clipboardDocument.measures[0].events[0].notes[1];
  let decorated = applyCommand(clipboardDocument, {
    type: 'note/technique/add', noteId: noteA.id, technique: { type: 'harmonic' }
  }, { idFactory: idFactory() }).document;
  decorated = applyCommand(decorated, {
    type: 'event/mark/add', eventId: decorated.measures[0].events[0].id, mark: { type: 'strum', direction: 'up' }
  }, { idFactory: idFactory() }).document;
  decorated = applyCommand(decorated, {
    type: 'relation/add', relation: { type: 'tie', fromNoteId: noteA.id, toNoteId: noteB.id }
  }, { idFactory: idFactory() }).document;
  const sourceTechniqueId = decorated.measures[0].events[0].notes[0].techniques[0].id;
  const sourceMarkId = decorated.measures[0].events[0].marks[0].id;
  const clipboard = new EditorClipboard();
  clipboard.copyMeasure(decorated, decorated.measures[0].id);
  const pasted = clipboard.pasteMeasure(decorated, decorated.measures[1].id, { idFactory: idFactory() });
  assert.ok(pasted);
  const target = pasted.document.measures[1];
  assert.notEqual(target.events[0].notes[0].techniques[0].id, sourceTechniqueId);
  assert.notEqual(target.events[0].marks[0].id, sourceMarkId);
  const pastedTie = pasted.document.relations.find(relation => relation.type === 'tie' && relation.id !== decorated.relations[0].id);
  assert.ok(pastedTie);
}

{
  const song = structuredClone(legacySong);
  const store = new ScoreStore(song);
  assert.equal(song.document.version, 3);
  assert.equal('rows' in song, false);
  const measureId = store.getDocument().measures[0].id;
  const result = store.dispatch({ type: 'note/set', measureId, at: [2, 1], string: 3, fret: '9', duration: [1, 4] }, { idFactory: idFactory() });
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
  assert.equal(buildSystems(structure)[1][1].id, movedMeasureId);
  structure = moveSystem(structure, 1, 0).document;
  assert.equal(buildSystems(structure)[0].some(measure => measure.id === movedMeasureId), true);
  structure = deleteMeasureAt(structure, 0, 0).document;
  structure = deleteSystem(structure, 1).document;
  assert.equal(buildSystems(structure).length, 1);
}

{
  const pureV3Song = { id: 'v3-only', name: 'V3 only', document: migrated };
  const decoded = deserializeSong(serializeSong(pureV3Song));
  assert.equal(decoded.document.version, 3);
  assert.equal(decoded.document.measures.length, 2);
}

console.log('editor v3 tests passed');
