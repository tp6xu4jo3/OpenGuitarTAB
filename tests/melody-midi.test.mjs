import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readMidiTracks, melodyFromMidiTrack, normalizeMelody, resolveMidiBeatScale, validateMidiBeatScale } from '../src/editor/melody-midi.js';
import { cleanSongForWrite } from '../api/index.js';
import { compactSong } from '../src/core/song-codec.js';

function int32(value) { return [(value>>>24)&255,(value>>>16)&255,(value>>>8)&255,value&255]; }
function variable(value) {
  let n = Math.floor(value);
  const bytes = [n & 0x7f];
  while ((n >>= 7) > 0) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}
function midiTrack(bytes) { return [77,84,114,107,...int32(bytes.length),...bytes]; }
function midiFile(tracks, division = 480) {
  return Uint8Array.from([
    77,84,104,100,0,0,0,6,0,tracks.length>1?1:0,0,tracks.length,(division>>8)&255,division&255,
    ...tracks.flatMap(midiTrack)
  ]).buffer;
}
const trackA=[
  0,0xff,0x03,0x06,77,101,108,111,100,121,
  0,0x90,76,100,
  ...variable(480),76,0, // running status: velocity zero is note-off
  0,0x90,77,95,
  ...variable(240),0x80,77,0,
  0,0xff,0x2f,0
];
const trackB=[
  0,0x99,36,110,
  ...variable(480),0x89,36,0,
  0,0xff,0x2f,0
];
const tracks=readMidiTracks(midiFile([trackA,trackB]));
assert.equal(tracks.length,1,'percussion track must not be imported into melody');
assert.equal(tracks[0].name,'Melody');
assert.equal(tracks[0].notes.length,2);
const melody=melodyFromMidiTrack(tracks[0],'lead.mid');
assert.deepEqual(melody.notes.map(note=>[note.beat,note.duration,note.pitch]),[[0,1,76],[1,0.5,77]]);
assert.equal(melody.sourceName,'lead.mid');
assert.equal(melody.format,'midi');

const midiTempo = bpm => {
  const microseconds = Math.round(60000000 / bpm);
  return [0, 0xff, 0x51, 0x03, (microseconds >>> 16) & 255, (microseconds >>> 8) & 255, microseconds & 255];
};
const explicitTempoTracks = readMidiTracks(midiFile([[...midiTempo(120), ...trackA]]));
assert.equal(explicitTempoTracks[0].tempoStatus, 'constant');
assert.equal(explicitTempoTracks[0].midiBpm, 120);
assert.equal(tracks[0].tempoStatus, 'implicit-default', 'MIDI with no tempo event defaults to 120 BPM');
assert.equal(tracks[0].midiBpm, 120);

const half = resolveMidiBeatScale({ midiBpm: explicitTempoTracks[0].midiBpm, scoreBpm: 60 });
assert.deepEqual(half, { scale: 0.5, reason: 'auto' }, '120 BPM MIDI and 60 BPM half-time score must auto-align');
const aligned = melodyFromMidiTrack(explicitTempoTracks[0], 'lead.mid', half.scale);
assert.deepEqual(aligned.notes.map(note => [note.beat, note.duration, note.pitch]), [[0, 0.5, 76], [0.5, 0.25, 77]],
  'start positions and durations must both be halved exactly once during import');
assert.equal(aligned.notes[1].beat * 60 / 60, 0.5, 'at score BPM 60 the second MIDI note starts half a second after the first');
assert.ok(Math.abs(aligned.notes[1].beat * 60 / 61 - 30 / 61) < 1e-10,
  'when editing score BPM from 60 to 61, saved score beat positions stay unchanged; effective MIDI tempo becomes 122');
assert.deepEqual(resolveMidiBeatScale({ markedScale: 0.5, midiBpm: 120, scoreBpm: 61 }), { scale: 0.5, reason: 'marked' },
  'the JSON marker must override future BPM guesses when re-importing after changing BPM');
assert.deepEqual(resolveMidiBeatScale({ midiBpm: 120, scoreBpm: 120 }), { scale: 1, reason: 'auto' });
assert.deepEqual(resolveMidiBeatScale({ midiBpm: 60, scoreBpm: 120 }), { scale: 2, reason: 'auto' });
assert.deepEqual(resolveMidiBeatScale({ midiBpm: 117, scoreBpm: 60 }), { scale: 0.5, reason: 'auto' }, 'minor BPM rounding differences should be allowed');
assert.deepEqual(resolveMidiBeatScale({ midiBpm: 100, scoreBpm: 60 }), { scale: null, reason: 'ambiguous' },
  'uncertain ratios must request a user choice instead of silently changing alignment');
assert.throws(() => validateMidiBeatScale(0.25), /midiBeatScale/);
const changingTempoTracks = readMidiTracks(midiFile([[...midiTempo(120), ...variable(480), ...midiTempo(90).slice(1), ...trackA]]));
assert.equal(changingTempoTracks[0].tempoStatus, 'variable', 'variable MIDI tempos must be identified, not falsely auto-aligned');
assert.equal(changingTempoTracks[0].midiBpm, null);


const saved=cleanSongForWrite({
  id:'song-a',name:'測試',arrangementName:'和弦',arrangementId:'arr-a',playStyle:'chord',
  tempo: 60, midiBeatScale: 0.5, melody: aligned, document:{version:3,measures:[{id:'m1',events:[{id:'e1',at:[0,1],duration:[1,1],notes:[{id:'n1',string:0,fret:'1',techniques:[]}],marks:[]}],groups:[],timeSignature:{numerator:4,denominator:4}}],relations:[],layout:{}}
});
assert.deepEqual(saved.melody,aligned,'Drive payload must preserve the already-aligned melody data');
assert.equal(saved.midiBeatScale, 0.5, 'Drive must retain the half-time marker in the same song JSON');
const tempoEdited = cleanSongForWrite({ ...saved, tempo: 61 });
assert.equal(tempoEdited.midiBeatScale, 0.5, 'BPM changes must not change the rhythm marker');
assert.deepEqual(tempoEdited.melody.notes, saved.melody.notes, 'BPM changes must not rescale or mutate imported score beats');
assert.deepEqual(normalizeMelody(tempoEdited.melody), saved.melody);
assert.equal(saved.document.measures[0].events[0].notes.length,1,'import must not erase chord score events');
assert.deepEqual(compactSong(saved).melody,aligned,'client persistence must preserve melody events');
assert.equal(compactSong(saved).midiBeatScale, 0.5, 'client persistence must retain the rhythm marker');

assert.throws(()=>readMidiTracks(new Uint8Array([1,2,3]).buffer),/MIDI/);
assert.throws(()=>readMidiTracks(midiFile([trackA],0xE728)),/PPQ/,'SMPTE timing is intentionally rejected');

const playback=await readFile(new URL('../src/editor/playback-controller.js',import.meta.url),'utf8');
const audio=await readFile(new URL('../src/editor/audio-engine.js',import.meta.url),'utf8');
assert.match(playback,/soundControlButton\('music', '模擬'/,'existing music toggle must be relabeled 模擬');
assert.match(playback,/if \(chord\) \{[\s\S]*melodyGroup\.appendChild\(soundControlButton\('melody', '旋律', state\.melodyEnabled\)\)[\s\S]*buttons\.push\(melodyGroup\)[\s\S]*buttons\.push\(soundControlButton\('music', '模擬'/s,'melody group must appear only for chord charts and to the left of simulation');
assert.match(playback,/melodyEnabled: false/,'melody must be off by default');
assert.match(playback,/const inferred = resolveMidiBeatScale\([\s\S]*markedScale: song\.midiBeatScale[\s\S]*midiBpm: selection\.midiBpm[\s\S]*const melody = melodyFromMidiTrack\(selection, file\.name, beatScale\)[\s\S]*song\.midiBeatScale = beatScale[\s\S]*await window\.persistSong\(song\)/s,
  'MIDI import must honor JSON markers and persist the resolved scale with score-beat-relative melody notes');
assert.match(playback, /song\.midiBeatScale = beatScale;[\s\S]*song\.tempo = scoreBpm;[\s\S]*await window\.persistSong\(song\)/s,
  'MIDI import must save the currently displayed score BPM and its beat scale together');
assert.match(playback, /song\.tempo = originalTempo;/, 'failed MIDI saves must roll back the score BPM');
assert.match(playback, /tempoStatus === 'variable'/, 'changing-tempo MIDI must not be silently treated as constant');
assert.doesNotMatch(playback, /note\.beat \*.*midiBeatScale/, 'playback must never apply the same conversion twice');
assert.match(playback,/startMelodyScheduler\(\)[\s\S]*clock\.audioStartTime \+ \(Number\(note\.beat\) - offset\) \* secondsPerBeat/s,'melody must be scheduled against the shared playback origin');
assert.match(playback,/const nextAt = wallStart \+ \(nextBeat - startBeat\) \* beatMs/,'score ticks must be corrected against a single origin instead of accumulating setTimeout delay');
assert.match(audio,/scheduleMelodyNote\(note, atTime, secondsPerBeat\)/,'melody must use sample-accurate WebAudio start times');
assert.match(audio,/stopMelody\(\)/,'melody must be able to stop independently of the guitar');
const melodyControls = playback.slice(playback.indexOf('function syncSoundControls('), playback.indexOf('function setMelodyEnabled('));
assert.match(melodyControls, /if \(chord\) \{[\s\S]*melodyGroup\.className = 'playback-melody-group'[\s\S]*melodyGroup\.append\(upload, input\)[\s\S]*melodyGroup\.appendChild\(soundControlButton\('melody', '旋律', state\.melodyEnabled\)\)[\s\S]*buttons\.push\(melodyGroup\)/s,
  'the plus and melody toggle must be children of one rounded melody group, in that order');
assert.doesNotMatch(melodyControls, /buttons\.push\(upload, input\)/,
  'the MIDI plus must not be a separate sibling outside the melody group');
assert.match(melodyControls, /upload\.textContent = '\+';/, 'MIDI import and replacement must use only a plus sign');
assert.match(melodyControls, /upload\.title = hasMelody\(song\) \? '替換主旋律 MIDI' : '匯入主旋律 MIDI'/, 'the plus button must describe whether it imports or replaces MIDI');
assert.match(melodyControls, /upload\.setAttribute\('aria-label', upload\.title\)/, 'the icon-only control must have an accessible name');
assert.match(playback, /controls\.querySelector\('#melodyMidiInput'\)\?\.click\(\)/, 'the plus button must still open the MIDI file picker');
const playbackCss = await readFile(new URL('../styles/playback-controls.css', import.meta.url), 'utf8');
assert.match(playbackCss, /\.playback-melody-group\{[^}]*border:1px solid #ddd;[^}]*border-radius:999px;[^}]*overflow:hidden/, 'MIDI plus and melody toggle must share one pill outline');
assert.match(playbackCss, /\.playback-melody-upload\{[^}]*width:28px;[^}]*border:0;border-right:1px solid #ddd;[^}]*background:transparent/, 'desktop plus must use an internal divider instead of a separate button outline');
assert.match(playbackCss, /@media\(max-width:760px\)[\s\S]*\.editor-view \.playback-melody-group \.playback-sound-toggle\{[^}]*padding:0 3px;[^}]*height:26px;[\s\S]*\.editor-view \.playback-melody-upload\{[^}]*width:20px;[^}]*height:26px;/, 'mobile melody group should keep both controls compact');
const volumeControls = playback.slice(playback.indexOf('function syncSoundControls('), playback.indexOf('function setMelodyEnabled('));
assert.match(volumeControls, /melodyGroup\.appendChild\(volumeButton\)/,
  'volume button belongs inside the existing melody pill, after the melody toggle');
assert.match(volumeControls, /volumeButton\.setAttribute\('aria-label', '微調旋律音量'\)/,
  'compact icon-only volume button needs an accessible label');
assert.match(playback, /range\.min = '-6';[\s\S]*range\.max = '6';[\s\S]*range\.step = '1';/,
  'popup must expose the default-neutral -6 to +6dB range');
assert.match(playback, /range\.addEventListener\('input', \(\) => setMelodyTrimDb\(range\.value\)\)/,
  'changing volume must update MIDI gain without reimporting notes');
assert.match(playback, /state\.melodyTrimDb = storedMelodyTrimDb\(\);[\s\S]*getAudioEngine\(\)\?\.setMelodyTrimDb\(state\.melodyTrimDb\)/,
  'saved melody volume must be restored during playback controller installation');
assert.match(playback, /function syncGuitarMix\(\)[\s\S]*state\.playing && state\.musicEnabled && state\.melodyEnabled[\s\S]*currentIsChordScore\(\) && hasMelody\(\)/,
  'ducking requires active chord melody with recorded-guitar simulation');
assert.match(playback, /state\.playing = true;[\s\S]*syncGuitarMix\(\)/,
  'playback must set accompaniment ducking before the first note');
assert.match(playback, /state\.playing = false;[\s\S]*syncGuitarMix\(\)/,
  'stopping playback restores full recorded-guitar level');
assert.match(playback, /getAudioEngine\(\)\?\.stopMelody\(\);\s*stopMelodyScheduler\(\);\s*syncGuitarMix\(\);/,
  'turning melody off restores accompaniment promptly');
assert.match(playback, /if \(state\.musicEnabled && state\.playing\) void getAudioEngine\(\)\?\.ensureReady\(\);\s*syncGuitarMix\(\);/,
  'simulation toggle recalculates the active melody mix');
assert.match(playback, /const horizon = currentTime \+ 0\.2;/, 'Web Audio lookahead should be 200ms');
assert.match(playback, /state\.melodyTimer = window\.setInterval\(schedule, 35\)/,
  'MIDI scheduler should run every 35ms while notes remain');
const controlsCss = await readFile(new URL('../styles/playback-controls.css', import.meta.url), 'utf8');
assert.match(controlsCss, /\.playback-melody-volume-popup\{[^}]*position:fixed;[^}]*z-index:4000/,
  'volume popover must be outside card overflow and viewport clipping');
assert.match(controlsCss, /\.editor-view \.playback-melody-volume-button\{[^}]*width:20px;[^}]*height:26px/,
  'volume button must remain compact on mobile');
console.log('MIDI melody and synchronized playback tests passed');
