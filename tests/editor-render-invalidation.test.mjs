import assert from 'node:assert/strict';
import { applyCommand } from '../src/editor/commands.js';
import { createDocumentV3 } from '../src/editor/model.js';

function idFactory() {
  let sequence = 0;
  return prefix => `${prefix}-invalidation-${++sequence}`;
}

const ids = idFactory();
let documentModel = createDocumentV3({
  measures: [
    {
      id: 'm-technique',
      timeSignature: { numerator: 4, denominator: 4 },
      events: [
        {
          id: 'e-chord',
          at: [0, 1],
          duration: [1, 4],
          notes: [
            { id: 'n-a', string: 0, fret: '3', techniques: [] },
            { id: 'n-b', string: 2, fret: '5', techniques: [] }
          ],
          marks: []
        },
        {
          id: 'e-next',
          at: [1, 1],
          duration: [1, 4],
          notes: [{ id: 'n-next', string: 0, fret: '5', techniques: [] }],
          marks: []
        }
      ],
      groups: []
    },
    {
      id: 'm-rhythm',
      timeSignature: { numerator: 4, denominator: 4 },
      events: [],
      groups: []
    }
  ],
  relations: [],
  layout: { systemBreakAfter: [] }
}, { idFactory: ids });

function apply(command) {
  const result = applyCommand(documentModel, command, { idFactory: ids });
  documentModel = result.document;
  return result;
}

{
  const harmonic = apply({
    type: 'note/technique/add',
    noteId: 'n-a',
    technique: { type: 'harmonic' }
  });
  assert.equal(harmonic.changeSet.layoutFrom, null, 'harmonic is notation-only and must not invalidate the full grid layout');

  const strum = apply({
    type: 'event/mark/add',
    eventId: 'e-chord',
    mark: { type: 'strum', direction: 'up' }
  });
  assert.equal(strum.changeSet.layoutFrom, null, 'strum is notation-only and must not invalidate the full grid layout');

  const relation = apply({
    type: 'relation/add',
    relation: { type: 'slide', fromNoteId: 'n-a', toNoteId: 'n-next' }
  });
  assert.equal(relation.changeSet.layoutFrom, null, 'slide/tie/slur relations must stay on the partial notation path');

  const relationId = relation.document.relations[0].id;
  const removedRelation = apply({ type: 'relation/delete', relationId });
  assert.equal(removedRelation.changeSet.layoutFrom, null, 'deleting a relation must stay on the partial notation path');
}

{
  const triplet = apply({
    type: 'rhythm/triplet/apply',
    measureId: 'm-rhythm',
    startAt: [0, 1],
    endAt: [1, 4]
  });
  assert.equal(triplet.changeSet.layoutFrom, 'm-rhythm', 'triplet changes editable time positions and must invalidate layout');

  const groupId = triplet.document.measures[1].groups[0].id;
  const removedGroup = apply({ type: 'group/delete', groupId });
  assert.equal(removedGroup.changeSet.layoutFrom, 'm-rhythm', 'removing a tuplet group changes fractional grid positions and must invalidate layout');
}

{
  const thirtySecond = apply({
    type: 'rhythm/32nd/apply',
    measureId: 'm-rhythm',
    startAt: [1, 1],
    endAt: [5, 4]
  });
  assert.equal(thirtySecond.changeSet.layoutFrom, 'm-rhythm', '32nd subdivision changes editable time positions and must invalidate layout');
}

{
  const replacement = apply({
    type: 'measure/replace-content',
    measureId: 'm-rhythm',
    measure: {
      timeSignature: { numerator: 4, denominator: 4 },
      events: [],
      groups: []
    }
  });
  assert.equal(replacement.changeSet.layoutFrom, 'm-rhythm', 'measure content replacement may change grid shape and must invalidate layout');
}

console.log('editor render invalidation tests passed');
