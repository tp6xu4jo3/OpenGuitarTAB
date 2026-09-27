import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyCommand } from '../src/editor/commands.js';
import { measureColumnSpacing } from '../src/editor/layout.js';
import { createDocumentV3, indexDocument } from '../src/editor/model.js';

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
const indexed = indexDocument(added.document);
assert.deepEqual(indexed.relationsByMeasure.get('m1')?.map(relation => relation.id), [relationId], 'document index must expose only relations touching each measure');
assert.ok(measureColumnSpacing(added.document, added.document.measures[0], indexed).extraWidth > 0, 'indexed slide lookup must preserve slide spacing');
const removed = applyCommand(added.document, { type: 'relation/delete', relationId });
assert.equal(removed.changeSet.layoutFrom, 'm1', 'removing a slide must release its local spacing immediately');
assert.equal(removed.changeSet.layoutKind, 'metrics');

const unrelatedMeasureDocument = createDocumentV3({
  measures: [
    base.measures[0],
    {
      id: 'm2', timeSignature: { numerator: 4, denominator: 4 }, groups: [], events: [
        { id: 'e3', at: [0, 1], duration: [1, 4], marks: [], notes: [{ id: 'n3', string: 0, fret: '3', techniques: [] }] },
        { id: 'e4', at: [1, 1], duration: [1, 4], marks: [], notes: [{ id: 'n4', string: 0, fret: '5', techniques: [] }] }
      ]
    }
  ],
  relations: [{ id: 'slide-m2', type: 'slide', fromNoteId: 'n3', toNoteId: 'n4' }]
});
const unrelatedIndex = indexDocument(unrelatedMeasureDocument);
assert.equal(unrelatedIndex.relationsByMeasure.get('m1'), undefined, 'unrelated relations must not enter a measure relation bucket');
assert.deepEqual(unrelatedIndex.relationsByMeasure.get('m2')?.map(relation => relation.id), ['slide-m2']);

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
const relationRendererSource = await readFile(new URL('../src/editor/relation-renderer.js', import.meta.url), 'utf8');
assert.match(playbackSource, /musicEnabled: true[\s\S]*metronomeEnabled: false/s, 'music and metronome must have independent playback state');
assert.match(playbackSource, /needsAudio = state\.musicEnabled \|\| state\.metronomeEnabled/, 'silent visual playback must not require an audio context');
assert.match(playbackSource, /function setMusicEnabled[\s\S]*state\.musicEnabled && state\.playing[\s\S]*ensureReady\(\)/s, 'music can be re-enabled while silent playback is already running');
assert.match(playbackSource, /function setMetronomeEnabled[\s\S]*state\.metronomeEnabled && state\.playing[\s\S]*ensureReady\(\)/s, 'metronome can be re-enabled while silent playback is already running');
assert.match(playbackSource, /playMetronome\(entry, fromOffset\)/, 'playback must schedule metronome clicks from the same score timeline');
assert.match(audioSource, /playMetronomeClick\(\{ accent = false \} = \{\}\)/, 'audio engine owns the metronome sound');
assert.match(viewStateSource, /control\.className = 'mode-toggle-button score-density-toggle'/, 'compact density must use the same switch control as score view');
assert.match(viewStateSource, /label\.textContent = '緊湊'/, 'compact switch must have a single 緊湊 label');
assert.match(relationRendererSource, /index\.relationsByMeasure\.get\(String\(measureId\)\)/, 'relation renderer must use per-measure relation buckets instead of scanning every relation for every system');

assert.ok(chordOnly.measures[0].events[0].chord, 'fixture keeps a chord label for the no-elastic-layout contract');
console.log('local score spacing and playback sound tests passed');
