import assert from 'node:assert/strict';
import { serializeSong, deserializeSong } from '../src/core/song-codec.js';
import { applyCommand } from '../src/editor/commands.js';
import { buildSystems } from '../src/editor/layout.js';
import { createDocumentV3, indexDocument, noteDisplayValue } from '../src/editor/model.js';
import { buildPlaybackIndex } from '../src/editor/playback-index.js';
import { ScoreStore } from '../src/editor/store.js';
import { deleteMeasureAt, insertMeasureAt } from '../src/editor/structure-commands.js';
import { resolveTechniqueTarget } from '../src/editor/technique-rules.js';
import { ToolRegistry } from '../src/editor/tools.js';

function ids() {
  let sequence = 0;
  return prefix => `${prefix}-regression-${++sequence}`;
}

const idFactory = ids();
const registry = new ToolRegistry();
let documentModel = createDocumentV3({
  measures: [
    {
      id: 'm-regression-1',
      timeSignature: { numerator: 4, denominator: 4 },
      events: [
        {
          id: 'e-chord',
          at: [0, 1],
          duration: [1, 4],
          notes: [
            { id: 'n-harmonic', string: 0, fret: '1', techniques: [] },
            { id: 'n-chord', string: 3, fret: '5', techniques: [] }
          ],
          marks: []
        },
        {
          id: 'e-tie',
          at: [1, 1],
          duration: [1, 4],
          notes: [{ id: 'n-tie', string: 0, fret: '1', techniques: [] }],
          marks: []
        },
        {
          id: 'e-slide',
          at: [2, 1],
          duration: [1, 4],
          notes: [{ id: 'n-slide', string: 0, fret: '5', techniques: [] }],
          marks: []
        }
      ],
      groups: []
    },
    {
      id: 'm-regression-2',
      timeSignature: { numerator: 4, denominator: 4 },
      events: [],
      groups: []
    }
  ],
  relations: [],
  layout: { systemBreakAfter: ['m-regression-1'] }
}, { idFactory });

function dispatch(command) {
  documentModel = applyCommand(documentModel, command, { idFactory }).document;
}

dispatch(registry.createCommand('harmonic', { noteId: 'n-harmonic' }));
dispatch(registry.createCommand('strumUp', { eventId: 'e-chord' }));

const arc = resolveTechniqueTarget('arc', { fromNoteId: 'n-harmonic', toNoteId: 'n-tie' }, documentModel);
assert.equal(arc.ok, true);
assert.equal(arc.target.relationType, 'tie');
dispatch(registry.createCommand('arc', arc.target));

const slide = resolveTechniqueTarget('slide', { fromNoteId: 'n-tie', toNoteId: 'n-slide' }, documentModel);
assert.equal(slide.ok, true);
dispatch(registry.createCommand('slide', slide.target));

dispatch(registry.createCommand('triplet', {
  measureId: 'm-regression-2',
  startAt: [0, 1],
  endAt: [1, 4]
}));
dispatch(registry.createCommand('duration32', {
  measureId: 'm-regression-2',
  startAt: [1, 1],
  endAt: [5, 4]
}));

{
  const index = indexDocument(documentModel);
  const harmonic = index.noteById.get('n-harmonic');
  assert.equal(harmonic.fret, '1');
  assert.equal(noteDisplayValue(harmonic), '1<13>');
  assert.equal(index.eventById.get('e-chord').marks[0].type, 'strum');
  assert.deepEqual(documentModel.relations.map(relation => relation.type).sort(), ['slide', 'tie']);
  assert.equal(documentModel.measures[1].groups[0].type, 'tuplet');
  assert.ok(documentModel.measures[1].events.some(event => event.rhythmAnchor), '32nd subdivision must survive alongside triplet data');
}

{
  const playback = buildPlaybackIndex(documentModel);
  const harmonicEntry = playback.entries.find(entry => entry.eventId === 'e-chord');
  assert.equal(harmonicEntry.notes.find(note => note.id === 'n-harmonic').fret, '13');
  assert.ok(playback.entries.some(entry => entry.at[0] === 9 && entry.at[1] === 8), '32nd midpoint must reach playback as fractional time');
}

const song = {
  id: 'song-regression',
  name: 'Regression',
  tempo: 120,
  capo: 0,
  document: documentModel
};
const store = new ScoreStore(song);
store.prepareForPersistence({ tempo: 132, capo: 2 });
const serialized = serializeSong(song);
const reloadedSong = deserializeSong(serialized);
const reloadedStore = new ScoreStore(reloadedSong);
const reloaded = reloadedStore.getDocument();

{
  const index = indexDocument(reloaded);
  assert.equal(index.noteById.get('n-harmonic').fret, '1', 'Save/Reload must preserve the actual fretted note');
  assert.equal(noteDisplayValue(index.noteById.get('n-harmonic')), '1<13>');
  assert.equal(index.eventById.get('e-chord').marks[0].type, 'strum');
  assert.deepEqual(reloaded.relations.map(relation => relation.type).sort(), ['slide', 'tie']);
  assert.equal(reloaded.measures[1].groups[0].type, 'tuplet');
  assert.equal(reloadedSong.tempo, 132);
  assert.equal(reloadedSong.capo, 2);
}

{
  const inserted = insertMeasureAt(reloaded, 1, 1, { idFactory });
  assert.deepEqual(buildSystems(inserted.document).map(system => system.length), [1, 2]);
  const restored = deleteMeasureAt(inserted.document, 1, 1).document;
  assert.deepEqual(buildSystems(restored).map(system => system.length), [1, 1]);
  assert.deepEqual(restored.relations.map(relation => relation.type).sort(), ['slide', 'tie'], 'unrelated structure edits must preserve technique relations');
}

console.log('editor integration regression tests passed');
