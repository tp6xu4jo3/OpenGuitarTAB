import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyCommand } from '../src/editor/commands.js';
import { createDocumentV3 } from '../src/editor/model.js';

const base = createDocumentV3({
  measures: [{
    id: 'm1',
    timeSignature: { numerator: 4, denominator: 4 },
    groups: [],
    events: [
      { id: 'e1', at: [0, 1], duration: [1, 4], marks: [], notes: [{ id: 'n1', string: 2, fret: '5', techniques: [] }] },
      { id: 'e2', at: [1, 1], duration: [1, 4], marks: [], notes: [{ id: 'n2', string: 2, fret: '7', techniques: [] }] }
    ]
  }]
});

const added = applyCommand(base, {
  type: 'relation/add',
  relation: { type: 'slide', fromNoteId: 'n1', toNoteId: 'n2' }
}, { idFactory: prefix => `${prefix}-test` });
assert.equal(added.changeSet.layoutFrom, 'm1', 'adding a slide must invalidate local layout metrics immediately');
assert.equal(added.changeSet.layoutKind, 'metrics');
const relationId = added.document.relations[0].id;
const removed = applyCommand(added.document, { type: 'relation/delete', relationId });
assert.equal(removed.changeSet.layoutFrom, 'm1', 'removing a slide must release its local spacing immediately');
assert.equal(removed.changeSet.layoutKind, 'metrics');

const chordOnly = createDocumentV3({
  measures: [{
    id: 'm-chord', timeSignature: { numerator: 4, denominator: 4 }, groups: [], events: [{
      id: 'e-chord', at: [0, 1], duration: [1, 4], marks: [], chord: { symbol: 'C', voicingId: 'v' },
      notes: [{ id: 'n-chord', string: 0, fret: '3', techniques: [] }]
    }]
  }]
});
const commandsSource = await readFile(new URL('../src/editor/commands.js', import.meta.url), 'utf8');
assert.match(commandsSource, /const layoutChanged = measureMetricsChanged\(document, sourceMeasure, measure\);[\s\S]*function updateEvent/s, 'chord application must invalidate layout only when its actual note geometry changes');

const playbackSource = await readFile(new URL('../src/editor/playback-controller.js', import.meta.url), 'utf8');
const audioSource = await readFile(new URL('../src/editor/audio-engine.js', import.meta.url), 'utf8');
const viewStateSource = await readFile(new URL('../src/editor/view-state.js', import.meta.url), 'utf8');
assert.match(playbackSource, /musicEnabled: true[\s\S]*metronomeEnabled: false/s, 'music and metronome must have independent playback state');
assert.match(playbackSource, /needsAudio = state\.musicEnabled \|\| state\.metronomeEnabled/, 'silent visual playback must not require an audio context');
assert.match(playbackSource, /function setMusicEnabled[\s\S]*state\.musicEnabled && state\.playing[\s\S]*ensureReady\(\)/s, 'music can be re-enabled while silent playback is already running');
assert.match(playbackSource, /function setMetronomeEnabled[\s\S]*state\.metronomeEnabled && state\.playing[\s\S]*ensureReady\(\)/s, 'metronome can be re-enabled while silent playback is already running');
assert.match(playbackSource, /playMetronome\(entry, fromOffset\)/, 'playback must schedule metronome clicks from the same score timeline');
assert.match(audioSource, /playMetronomeClick\(\{ accent = false \} = \{\}\)/, 'audio engine owns the metronome sound');
assert.match(viewStateSource, /control\.className = 'mode-toggle-button score-density-toggle'/, 'compact density must use the same switch control as score view');
assert.match(viewStateSource, /label\.textContent = '緊湊'/, 'compact switch must have a single 緊湊 label');

assert.ok(chordOnly.measures[0].events[0].chord, 'fixture keeps a chord label for the no-elastic-layout contract');
console.log('local score spacing and playback sound tests passed');
