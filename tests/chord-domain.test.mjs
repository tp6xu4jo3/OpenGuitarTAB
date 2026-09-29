import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHORD_CATEGORIES,
  CHORD_LIBRARY,
  CHORD_QUALITIES,
  CHORD_ROOTS,
  STANDARD_TUNING,
  getChord,
  getChordVoicing,
  notesForVoicing,
  voicingText
} from '../src/editor/chord-library.js';
import { applyCommand } from '../src/editor/commands.js';
import { buildPlaybackIndex } from '../src/editor/playback-index.js';

assert.equal(CHORD_ROOTS.length, 12);
assert.equal(CHORD_QUALITIES.length, 18);
assert.equal(CHORD_LIBRARY.length, 216);
assert.deepEqual(CHORD_CATEGORIES.map(category => category.id), ['major', 'minor', 'dominant', 'suspended', 'other']);

const cMajor = getChord('C', 'maj');
assert.ok(cMajor);
assert.equal(cMajor.symbol, 'C');
assert.equal(cMajor.category, 'major');
assert.ok(cMajor.voicings.length >= 1);
const cOpen = cMajor.voicings[0];
assert.equal(cOpen.id, 'C:maj:open');
assert.deepEqual([...cOpen.frets], [0, 1, 0, 2, 3, 'x']);
assert.equal(voicingText(cOpen.frets), '01023x', 'C open voicing must use first-string to sixth-string order');
assert.deepEqual(notesForVoicing(cOpen).map(note => [note.string, note.fret]), [
  [0, '0'],
  [1, '1'],
  [2, '0'],
  [3, '2'],
  [4, '3']
]);
assert.equal(getChordVoicing(cMajor.id, cOpen.id)?.id, cOpen.id);

const dMinor7 = getChord('D', 'm7');
assert.ok(dMinor7);
assert.deepEqual([...dMinor7.voicings[0].frets], [1, 1, 2, 0, 'x', 'x']);
assert.equal(voicingText(dMinor7.voicings[0].frets), '1120xx', 'Dm7 open voicing must be 1120xx in string-1-to-string-6 order');
assert.equal(voicingText(getChord('D','maj7').voicings[0].frets), '2220xx', 'Dmaj7 must use the standard low open voicing');
assert.equal(voicingText(getChord('D','sus2').voicings[0].frets), '0320xx', 'Dsus2 must use the standard open voicing');
assert.equal(voicingText(getChord('D','sus4').voicings[0].frets), '3320xx', 'Dsus4 must use the standard open voicing');
assert.equal(voicingText(getChord('B','m7').voicings[0].frets), '20202x', 'Bm7 must use the common open-position voicing');

const rootById = new Map(CHORD_ROOTS.map(root => [root.id, root]));
const qualityById = new Map(CHORD_QUALITIES.map(quality => [quality.id, quality]));
for (const chord of CHORD_LIBRARY) {
  const root = rootById.get(chord.root);
  const quality = qualityById.get(chord.quality);
  const expected = new Set(quality.intervals.map(interval => (root.pitchClass + interval) % 12));
  const required = new Set(quality.intervals
    .filter(interval => !(interval === 7 && quality.intervals.length >= 4))
    .map(interval => (root.pitchClass + interval) % 12));
  const defaultFrets = chord.voicings[0].frets.filter(fret => fret !== 'x').map(Number);
  assert.ok(Math.max(0, ...defaultFrets) <= 7, `${chord.id} default voicing should stay in the low seven frets`);
  for (const voicing of chord.voicings) {
    const notes = notesForVoicing(voicing);
    assert.ok(notes.length >= required.size, `${chord.id} must contain its essential chord tones`);
    const actual = new Set();
    for (const note of notes) {
      const fret = Number(note.fret);
      assert.ok(Number.isInteger(fret) && fret >= 0 && fret <= 24, `${chord.id} contains an invalid fret`);
      const pitch = (STANDARD_TUNING.openPitchClasses[note.string] + fret) % 12;
      assert.equal(expected.has(pitch), true, `${chord.id} voicing contains a non-chord tone`);
      actual.add(pitch);
    }
    for (const pitch of required) assert.equal(actual.has(pitch), true, `${chord.id} voicing omits an essential chord tone`);
  }
}

let sequence = 0;
const idFactory = prefix => `${prefix}-${++sequence}`;
const document = {
  version: 3,
  measures: [{
    id: 'm1',
    timeSignature: { numerator: 4, denominator: 4 },
    events: [{
      id: 'e-old',
      at: [0, 1],
      duration: [1, 4],
      notes: [
        { id: 'old-1', string: 0, fret: '3', techniques: [] },
        { id: 'old-2', string: 1, fret: '3', techniques: [] }
      ],
      marks: []
    }],
    groups: []
  }],
  relations: [{ id: 'r-old', type: 'slur', fromNoteId: 'old-1', toNoteId: 'old-2' }],
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
assert.equal(playback.entries.length, 16, '4/4 playback must keep all sixteen fillable sixteenth-grid columns even when fifteen are empty');
assert.deepEqual(playback.entries[0].notes.map(note => [note.string, note.fret]), event.notes.map(note => [note.string, note.fret]), 'playback must consume the notes produced by chord/apply');
assert.equal(playback.entries.slice(1).every(entry => entry.notes.length === 0), true, 'empty fillable columns must remain on the playback timeline');

const manuallyEdited = applyCommand(applied.document, {
  type: 'note/set',
  measureId: 'm1',
  at: [0, 1],
  duration: [1, 4],
  string: 0,
  fret: '1'
}, { idFactory });
assert.equal(manuallyEdited.document.measures[0].events[0].chord, undefined, 'manual pitch edits must clear stale chord metadata');

const root = fileURLToPath(new URL('..', import.meta.url));
const dragController = readFileSync(join(root, 'src/editor/chord-drag-controller.js'), 'utf8');
const notationRenderer = readFileSync(join(root, 'src/editor/notation-renderer.js'), 'utf8');
assert.match(dragController, /type:\s*'chord\/apply'/);
assert.doesNotMatch(dragController, /type:\s*'note\/set'/, 'chord drag must not fan out into note commands');
assert.match(notationRenderer, /event\.chord\?\.symbol/);

console.log('chord domain tests passed');
