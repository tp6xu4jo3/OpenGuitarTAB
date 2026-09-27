import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pitchPlanForTab } from '../src/editor/audio-engine.js';
import { playbackNoteSchedule } from '../src/editor/playback-articulation.js';
import { buildPlaybackIndex } from '../src/editor/playback-index.js';

const notes = [
  { id: 'high', string: 0, fret: '5', techniques: [] },
  { id: 'mid', string: 2, fret: '5', techniques: [] },
  { id: 'low', string: 5, fret: '5', techniques: [] }
];

function scheduleFor(mark) {
  return playbackNoteSchedule({ durationBeats: 1, notes, marks: mark ? [mark] : [] }, 500);
}

const plain = scheduleFor(null);
assert.deepEqual(plain.map(item => item.note.id), ['high', 'mid', 'low']);
assert.deepEqual(plain.map(item => item.delayMs), [0, 0, 0], 'ordinary chords must remain simultaneous');

const downStrum = scheduleFor({ type: 'strum', direction: 'down' });
const upStrum = scheduleFor({ type: 'strum', direction: 'up' });
assert.deepEqual(downStrum.map(item => item.note.id), ['low', 'mid', 'high'], 'downstroke travels from low strings to high strings');
assert.deepEqual(upStrum.map(item => item.note.id), ['high', 'mid', 'low'], 'upstroke travels from high strings to low strings');
assert.ok(downStrum.at(-1).delayMs > 0, 'strums must be audibly staggered');

const upArpeggio = scheduleFor({ type: 'arpeggio', direction: 'up' });
const downArpeggio = scheduleFor({ type: 'arpeggio', direction: 'down' });
assert.deepEqual(upArpeggio.map(item => item.note.id), ['low', 'mid', 'high'], 'up arpeggio rolls from low strings to high strings');
assert.deepEqual(downArpeggio.map(item => item.note.id), ['high', 'mid', 'low'], 'down arpeggio rolls from high strings to low strings');
assert.ok(upArpeggio.at(-1).delayMs > downStrum.at(-1).delayMs, 'arpeggio spread must be slower than a strum');

const plainPitch = pitchPlanForTab(2, '5', { capo: 0, slideToFret: null, slideSeconds: 1 });
assert.equal(plainPitch.sliding, false, 'a missing slide target must never be coerced to fret zero');
assert.equal(plainPitch.targetFrequency, plainPitch.frequency, 'ordinary notes must keep one fixed fundamental frequency');
assert.equal(plainPitch.glideSeconds, 0, 'ordinary notes must not schedule a pitch glide');
for (const missingTarget of [undefined, '']) {
  const plan = pitchPlanForTab(2, '5', { slideToFret: missingTarget, slideSeconds: 1 });
  assert.equal(plan.sliding, false, 'empty slide targets must remain non-sliding notes');
  assert.equal(plan.targetFrequency, plan.frequency);
}
const openStringSlide = pitchPlanForTab(2, '5', { slideToFret: '0', slideSeconds: 0.5 });
assert.equal(openStringSlide.sliding, true, 'an explicit fret-zero slide target must remain valid');
assert.ok(openStringSlide.targetFrequency < openStringSlide.frequency, 'an explicit downward slide must lower pitch');
assert.equal(openStringSlide.glideSeconds, 0.5);

const documentModel = {
  version: 3,
  measures: [{
    id: 'm1',
    timeSignature: { numerator: 4, denominator: 4 },
    groups: [],
    events: [
      { id: 'e1', at: [0, 1], duration: [1, 1], marks: [], notes: [{ id: 'n1', string: 2, fret: '5', techniques: [] }] },
      { id: 'e2', at: [1, 1], duration: [1, 1], marks: [], notes: [{ id: 'n2', string: 2, fret: '7', techniques: [] }] }
    ]
  }],
  relations: [
    { id: 'slide-1', type: 'slide', fromNoteId: 'n1', toNoteId: 'n2' },
    { id: 'arc-1', type: 'arc', direction: 'up', fromNoteId: 'n1', fromPosition: { measureId: 'm1', at: [0, 1] }, toPosition: { measureId: 'm1', at: [2, 1] } }
  ],
  layout: { systemBreakAfter: ['m1'] }
};

const playback = buildPlaybackIndex(documentModel);
const sourceNote = playback.entries.find(entry => entry.atBeats === 0)?.notes.find(note => note.id === 'n1');
const targetNote = playback.entries.find(entry => entry.atBeats === 1)?.notes.find(note => note.id === 'n2');
assert.deepEqual(sourceNote.slide, { relationId: 'slide-1', toFret: '7', durationBeats: 1 }, 'slide source must carry its target pitch and duration into playback');
assert.equal(targetNote.slideArrivalRelationId, 'slide-1', 'slide target must identify the active glide so it is not needlessly re-picked');
assert.equal(Object.hasOwn(sourceNote, 'arc'), false, 'generic visual arcs must not invent hammer-on, pull-off, or tie audio semantics');

const audioSource = await readFile(new URL('../src/editor/audio-engine.js', import.meta.url), 'utf8');
const controllerSource = await readFile(new URL('../src/editor/playback-controller.js', import.meta.url), 'utf8');
assert.match(audioSource, /playbackRate\.exponentialRampToValueAtTime\(playbackRateEnd, startTime \+ glideSeconds\)/, 'slide audio must continuously ramp pitch instead of retriggering intermediate frets');
assert.match(audioSource, /pitchPlanForTab\(string, fret, \{ capo, slideToFret, slideSeconds \}\)/, 'audio playback must use the validated pitch plan for both ordinary notes and slides');
assert.match(audioSource, /hasActiveSlide\(stringIndex, relationId\)/, 'audio engine must expose active slide identity for arrival handling');
assert.match(audioSource, /harmonic \? 4\.2 : 1\.7/, 'harmonics must have a distinct brighter playback timbre in addition to their sounding pitch');
assert.match(controllerSource, /playbackNoteSchedule\(event, beatMs\)/, 'playback controller must schedule strum and arpeggio note offsets from the articulation model');
assert.match(controllerSource, /slideSeconds: slide \? Math\.max\(0\.06, Number\(slide\.durationBeats \|\| 0\) \* beatMs \/ 1000\) : 0/, 'slide duration must follow score timing and current tempo');
assert.match(controllerSource, /audio\.hasActiveSlide\(string, note\.slideArrivalRelationId\)/, 'slide target must avoid a second pick while the source glide is still active');

console.log('technique audio tests passed');
