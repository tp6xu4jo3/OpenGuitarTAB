import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyCommand } from '../src/editor/commands.js';
import { buildPlaybackIndex } from '../src/editor/playback-index.js';
import { CHORD_DEFINITIONS, chordVoicingById } from '../src/editor/chords.js';

let idCounter = 0;
const idFactory = prefix => `${prefix}-${++idCounter}`;
const cMajor = CHORD_DEFINITIONS.find(chord => chord.id === 'C:maj');
const cOpen = chordVoicingById('C:maj:open');
assert.ok(cMajor);
assert.ok(cOpen);

const document = {
  version: 3,
  measures: [{
    id: 'm1',
    timeSignature: { numerator: 4, denominator: 4 },
    events: [{
      id: 'e-old',
      at: [0, 1],
      duration: [1, 4],
      notes: [{ id: 'n-old', string: 0, fret: '9', techniques: [] }],
      marks: []
    }],
    groups: []
  }],
  relations: [{ id: 'r-old', type: 'slide', fromNoteId: 'n-old', toNoteId: 'n-old' }],
  layout: { systemBreakAfter: [] }
};

const applied = applyCommand(document, {
  type: 'chord/apply',
  measureId: 'm1',
  at: [0, 1],
  duration: [1, 4],
  chordId: cMajor.id,
  voicingId: cOpen.id
}, { idFactory });

assert.deepEqual(applied.changeSet.measures, ['m1']);
assert.deepEqual(applied.changeSet.playback, ['m1']);
assert.deepEqual(applied.changeSet.relations, ['r-old']);
assert.equal(applied.document.relations.length, 0, 'replacing an event chord must prune relations to replaced notes');
const event = applied.document.measures[0].events[0];
assert.equal(event.id, 'e-old', 'chord/apply must reuse an existing event at the target column');
assert.deepEqual(event.chord, { symbol: 'C', voicingId: 'C:maj:open' });
assert.deepEqual(event.notes.map(note => [note.string, note.fret]), [
  [0, '0'],
  [1, '1'],
  [2, '0'],
  [3, '2'],
  [4, '3']
]);

const playback = buildPlaybackIndex(applied.document);
assert.equal(playback.entries.length, 4, '4/4 playback must keep all four beats even when three are empty');
assert.deepEqual(playback.entries[0].notes.map(note => [note.string, note.fret]), event.notes.map(note => [note.string, note.fret]), 'playback must consume the notes produced by chord/apply');
assert.deepEqual(playback.entries.slice(1).map(entry => entry.notes.length), [0, 0, 0]);

const manuallyEdited = applyCommand(applied.document, {
  type: 'note/set',
  measureId: 'm1',
  at: [0, 1],
  duration: [1, 4],
  string: 0,
  fret: '1'
}, { idFactory });
assert.equal(manuallyEdited.document.measures[0].events[0].chord, undefined, 'manual pitch edits must clear stale chord metadata');

const root = new URL('..', import.meta.url).pathname;
const dragController = readFileSync(join(root, 'src/editor/chord-drag-controller.js'), 'utf8');
const notationRenderer = readFileSync(join(root, 'src/editor/notation-renderer.js'), 'utf8');
assert.match(dragController, /type:\s*'chord\/apply'/);
assert.doesNotMatch(dragController, /type:\s*'note\/set'/, 'chord drag must not fan out into note commands');
assert.match(notationRenderer, /event\.chord\?\.symbol/);

console.log('chord domain tests passed');