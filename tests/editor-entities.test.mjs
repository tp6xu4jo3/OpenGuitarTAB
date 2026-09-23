import assert from 'node:assert/strict';
import { applyCommand } from '../src/editor/commands.js';
import { createDocumentV3, indexDocument } from '../src/editor/model.js';

function ids() {
  let value = 0;
  return prefix => `${prefix}-entity-${++value}`;
}

const idFactory = ids();
let documentModel = createDocumentV3({
  measures: [{
    id: 'm-entities',
    timeSignature: { numerator: 4, denominator: 4 },
    events: [
      { id: 'e-a', at: [0, 1], duration: [1, 1], notes: [{ id: 'n-a', string: 0, fret: '1' }], marks: [] },
      { id: 'e-b', at: [1, 1], duration: [1, 1], notes: [{ id: 'n-b', string: 0, fret: '3' }], marks: [] }
    ],
    groups: []
  }]
}, { idFactory });

documentModel = applyCommand(documentModel, {
  type: 'note/technique/add',
  noteId: 'n-a',
  technique: { type: 'harmonic' }
}, { idFactory }).document;

documentModel = applyCommand(documentModel, {
  type: 'event/mark/add',
  eventId: 'e-a',
  mark: { type: 'strum', direction: 'up' }
}, { idFactory }).document;

documentModel = applyCommand(documentModel, {
  type: 'event/mark/add',
  eventId: 'e-a',
  mark: { type: 'accent' }
}, { idFactory }).document;

documentModel = applyCommand(documentModel, {
  type: 'group/add',
  measureId: 'm-entities',
  group: { type: 'tuplet', ratio: [3, 2], eventIds: ['e-a', 'e-b'] }
}, { idFactory }).document;

documentModel = applyCommand(documentModel, {
  type: 'relation/add',
  relation: { type: 'slide', fromNoteId: 'n-a', toNoteId: 'n-b' }
}, { idFactory }).document;

let index = indexDocument(documentModel);
assert.equal(index.techniqueById.size, 1);
assert.equal(index.markById.size, 2);
assert.equal(index.groupById.size, 1);
assert.equal(index.relationById.size, 1);

const techniqueId = [...index.techniqueById.keys()][0];
const markIds = [...index.markById.keys()];
const groupId = [...index.groupById.keys()][0];
const relationId = [...index.relationById.keys()][0];

documentModel = applyCommand(documentModel, { type: 'mark/delete', markId: markIds[0] }).document;
index = indexDocument(documentModel);
assert.equal(index.markById.has(markIds[0]), false);
assert.equal(index.markById.has(markIds[1]), true, 'mark deletion must remove only the selected mark');

documentModel = applyCommand(documentModel, { type: 'group/delete', groupId }).document;
assert.equal(indexDocument(documentModel).groupById.has(groupId), false);

documentModel = applyCommand(documentModel, { type: 'relation/delete', relationId }).document;
assert.equal(indexDocument(documentModel).relationById.has(relationId), false);

documentModel = applyCommand(documentModel, { type: 'technique/delete', techniqueId }).document;
index = indexDocument(documentModel);
assert.equal(index.techniqueById.has(techniqueId), false);
assert.equal(index.noteById.get('n-a').fret, '1', 'removing the harmonic must restore the derived base fret');

console.log('editor entity tests passed');
