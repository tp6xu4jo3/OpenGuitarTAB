import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { frettedSlideSteps, pitchPlanForTab, stringLevelDb, MASTER_OUTPUT_DB, MASTER_OUTPUT_GAIN } from '../src/editor/audio-engine.js';
import { samplePlanForTab, SAMPLE_ATTACK_PREROLL_SECONDS, SAMPLE_COUNT, SAMPLE_DURATION_SECONDS, SAMPLE_FRETS_BY_STRING } from '../src/editor/sample-bank.js';
import { playbackNoteSchedule } from '../src/editor/playback-articulation.js';
import { buildPlaybackIndex } from '../src/editor/playback-index.js';

const notes = [
  { id: 'high', string: 0, fret: '5', techniques: [] },
  { id: 'mid', string: 2, fret: '5', techniques: [] },
  { id: 'low', string: 5, fret: '5', techniques: [] }
];
const scheduleFor = mark => playbackNoteSchedule({ durationBeats: 1, notes, marks: mark ? [mark] : [] }, 500);
const plain = scheduleFor(null);
assert.deepEqual(plain.map(item => item.note.id), ['high', 'mid', 'low']);
assert.deepEqual(plain.map(item => item.delayMs), [0, 0, 0]);
const downStrum = scheduleFor({ type: 'strum', direction: 'down' });
const upStrum = scheduleFor({ type: 'strum', direction: 'up' });
assert.deepEqual(downStrum.map(item => item.note.id), ['low', 'mid', 'high']);
assert.deepEqual(upStrum.map(item => item.note.id), ['high', 'mid', 'low']);
assert.ok(downStrum.at(-1).delayMs > 0 && downStrum.at(-1).delayMs <= 48);
const upArpeggio = scheduleFor({ type: 'arpeggio', direction: 'up' });
assert.ok(upArpeggio.at(-1).delayMs > downStrum.at(-1).delayMs);

assert.equal(stringLevelDb(0), 0);
assert.equal(stringLevelDb(5), 0, 'relative sample loudness must be mastered into the bank, not patched per string at runtime');
assert.equal(MASTER_OUTPUT_DB, -6, 'recorded guitar playback should reserve 6 dB of output headroom for polyphonic summing');
assert.ok(Math.abs(MASTER_OUTPUT_GAIN - Math.pow(10, -6 / 20)) < 1e-12);
assert.equal(SAMPLE_COUNT, 42);
assert.equal(SAMPLE_DURATION_SECONDS, 3);
assert.equal(SAMPLE_ATTACK_PREROLL_SECONDS, 0.02);
let expectedIndex = 0;
SAMPLE_FRETS_BY_STRING.forEach((frets, stringIndex) => frets.forEach(fret => {
  const plan = samplePlanForTab(stringIndex, fret);
  assert.equal(plan.stringIndex, stringIndex, 'sample lookup must stay on the recorded string');
  assert.equal(plan.anchorFret, fret);
  assert.equal(plan.sampleIndex, expectedIndex);
  assert.equal(plan.offsetSeconds, expectedIndex * 3);
  assert.equal(plan.playbackRate, 1);
  expectedIndex += 1;
}));
const nearest = samplePlanForTab(0, 2);
assert.equal(nearest.anchorFret, 1, 'equal-distance lookup must prefer the lower anchor');
assert.ok(Math.abs(nearest.playbackRate - Math.pow(2, 1 / 12)) < 1e-9);
const capoPlan = samplePlanForTab(5, 8, { capo: 2 });
assert.equal(capoPlan.soundingFret, 10);
assert.equal(capoPlan.anchorFret, 10);
assert.equal(samplePlanForTab(0, 12).semitoneShift, 2);

const plainPitch = pitchPlanForTab(2, '5', { slideToFret: null, slideSeconds: 1 });
assert.equal(plainPitch.sliding, false);
assert.equal(plainPitch.targetFrequency, plainPitch.frequency);
assert.equal(plainPitch.glideSeconds, 0);
for (const target of [undefined, '']) assert.equal(pitchPlanForTab(2, '5', { slideToFret: target }).sliding, false);
const openSlide = pitchPlanForTab(2, '5', { slideToFret: '0', slideSeconds: 0.5 });
assert.equal(openSlide.sliding, true);
assert.ok(openSlide.targetFrequency < openSlide.frequency);
const slideSteps = frettedSlideSteps(5, 9, 0.4);
assert.deepEqual(slideSteps.map(step => step.fret), [6, 7, 8, 9]);
assert.ok(slideSteps.every((step, index) => index === 0 || step.playbackRate > slideSteps[index - 1].playbackRate));
assert.ok(Math.abs(slideSteps.at(-1).playbackRate - Math.pow(2, 4 / 12)) < 1e-9);
assert.ok(slideSteps[0].atSeconds > 0.3, 'a rhythmic slide should hold the source note before the quick motion');
assert.ok(Math.abs(slideSteps.at(-1).atSeconds - 0.4) < 1e-9, 'the slide must arrive exactly at the target-note onset');
assert.ok(slideSteps.at(-1).atSeconds - slideSteps[0].atSeconds < 0.12, 'the fret transition should occupy only a short part of the relation duration');

const documentModel = {
  version: 3,
  measures: [{ id: 'm1', timeSignature: { numerator: 4, denominator: 4 }, groups: [], events: [
    { id: 'e1', at: [0, 1], duration: [1, 1], marks: [], notes: [{ id: 'n1', string: 2, fret: '5', techniques: [] }] },
    { id: 'e2', at: [1, 1], duration: [1, 1], marks: [], notes: [{ id: 'n2', string: 2, fret: '7', techniques: [] }] }
  ] }],
  relations: [
    { id: 'slide-1', type: 'slide', fromNoteId: 'n1', toNoteId: 'n2' },
    { id: 'arc-1', type: 'arc', direction: 'up', fromNoteId: 'n1', fromPosition: { measureId: 'm1', at: [0, 1] }, toPosition: { measureId: 'm1', at: [2, 1] } }
  ],
  layout: { systemBreakAfter: ['m1'] }
};
const playback = buildPlaybackIndex(documentModel);
const sourceNote = playback.entries.find(entry => entry.atBeats === 0)?.notes.find(note => note.id === 'n1');
const targetNote = playback.entries.find(entry => entry.atBeats === 1)?.notes.find(note => note.id === 'n2');
assert.deepEqual(sourceNote.slide, { relationId: 'slide-1', toFret: '7', durationBeats: 1 });
assert.equal(targetNote.slideArrivalRelationId, 'slide-1');
assert.equal(Object.hasOwn(sourceNote, 'arc'), false);

const audioSource = await readFile(new URL('../src/editor/audio-engine.js', import.meta.url), 'utf8');
const bankSource = await readFile(new URL('../src/editor/sample-bank.js', import.meta.url), 'utf8');
const controllerSource = await readFile(new URL('../src/editor/playback-controller.js', import.meta.url), 'utf8');
const audioAssetNames = (await readdir(new URL('../assets/audio/', import.meta.url)))
  .filter(name => /^guitar-samples.*\.m4a$/i.test(name))
  .sort();
assert.deepEqual(audioAssetNames, ['guitar-samples.m4a'], 'the repository must keep only the current recorded guitar bank');
const sampleAsset = await stat(new URL('../assets/audio/guitar-samples.m4a', import.meta.url));
assert.ok(sampleAsset.size > 1_800_000);
assert.match(bankSource, /guitar-samples\.m4a\?rev=20260929b/, 'the one current bank URL must change revision when its bytes change');
assert.match(bankSource, /fetch\(SAMPLE_BANK_URL, \{ cache: 'force-cache' \}\)/, 'bank must preload through browser cache');
assert.match(bankSource, /context\.decodeAudioData\(encoded\)/, 'bank must decode once before playback');
assert.match(audioSource, /MASTER_OUTPUT_DB = -6/,'the output stage must reserve explicit polyphonic headroom');
assert.match(audioSource, /masterGain\.gain\.value = MASTER_OUTPUT_GAIN/,'all guitar voices and metronome output must pass through the mastered headroom stage');
assert.match(audioSource, /plan\.offsetSeconds \+ SAMPLE_ATTACK_PREROLL_SECONDS[\s\S]*SAMPLE_DURATION_SECONDS - SAMPLE_ATTACK_PREROLL_SECONDS/s, 'the physically aligned bank must use one fixed 20 ms safe pre-roll');
assert.match(audioSource, /basePlaybackRate \* step\.playbackRate/, 'slides must move relative to the selected recorded anchor');
assert.match(audioSource, /SLIDE_TRANSITION_LEVEL = 0\.62/, 'the physical slide transition should be quieter than the endpoint notes');
assert.match(audioSource, /linearRampToValueAtTime\(level \* SLIDE_TRANSITION_LEVEL[\s\S]*linearRampToValueAtTime\(level, now \+ slideEnd\)/s, 'slide gain must dip only during motion and recover at the target arrival');
assert.doesNotMatch(audioSource, /if \(!pitch\.sliding && Number\.isFinite\(nextDelay\)/, 'a sustained slide target must still damp before the next real same-string attack');
assert.match(audioSource, /SAME_STRING_DAMP_LEAD_SECONDS = 0\.025/, 'sequenced same-string notes should begin damping before the next attack');
assert.match(audioSource, /SAME_STRING_SILENCE_BEFORE_ATTACK_SECONDS = 0\.002/, 'the old string voice should reach silence just before the next attack');
assert.match(audioSource, /linearRampToValueAtTime\(0, releaseEnd\)/, 'sequenced damping must finish before the following note starts');
assert.match(audioSource, /if \(dampPrevious\) this\.stopStringVoice\(string\);/, 'manual audition may still damp immediately while score playback uses pre-scheduled damping');
assert.match(audioSource, /activeVoices = Array\(STRING_TUNING\.length\)\.fill\(null\)/);
assert.doesNotMatch(audioSource, /pluckBuffer|addPickNoise|Math\.random\(\)/, 'recorded samples must be the only guitar source');
assert.match(audioSource, /void engine\.samples\.preload\(\)/, 'network preload must start before Play');
assert.match(controllerSource, /function buildNextStringDelayMap\(playback, beatMs\)[\s\S]*playbackNoteSchedule\(event, beatMs\)[\s\S]*delays\.set\(previous\.noteId/s, 'playback must derive exact next attacks per string including articulation delay');
assert.match(controllerSource, /nextSameStringSeconds:[\s\S]*state\.nextStringDelayMs/s, 'each plucked note must receive its next same-string attack gap');
assert.match(controllerSource, /dampPrevious: false/, 'score playback must rely on pre-note damping instead of post-attack overlap');
assert.match(controllerSource, /audio\.hasActiveSlide\(string, note\.slideArrivalRelationId\)/);

console.log('technique audio tests passed');