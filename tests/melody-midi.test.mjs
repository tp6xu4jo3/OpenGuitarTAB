import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readMidiTracks, melodyFromMidiTrack } from '../src/editor/melody-midi.js';
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

const saved=cleanSongForWrite({
  id:'song-a',name:'測試',arrangementName:'和弦',arrangementId:'arr-a',playStyle:'chord',
  melody,document:{version:3,measures:[{id:'m1',events:[{id:'e1',at:[0,1],duration:[1,1],notes:[{id:'n1',string:0,fret:'1',techniques:[]}],marks:[]}],groups:[],timeSignature:{numerator:4,denominator:4}}],relations:[],layout:{}}
});
assert.deepEqual(saved.melody,melody,'Drive payload must preserve the compact melody data');
assert.equal(saved.document.measures[0].events[0].notes.length,1,'import must not erase chord score events');
assert.deepEqual(compactSong(saved).melody,melody,'client persistence must preserve melody events');

assert.throws(()=>readMidiTracks(new Uint8Array([1,2,3]).buffer),/MIDI/);
assert.throws(()=>readMidiTracks(midiFile([trackA],0xE728)),/PPQ/,'SMPTE timing is intentionally rejected');

const playback=await readFile(new URL('../src/editor/playback-controller.js',import.meta.url),'utf8');
const audio=await readFile(new URL('../src/editor/audio-engine.js',import.meta.url),'utf8');
assert.match(playback,/soundControlButton\('music', '模擬'/,'existing music toggle must be relabeled 模擬');
assert.match(playback,/if \(chord\) buttons\.push\(soundControlButton\('melody', '旋律', state\.melodyEnabled\)\)/,'melody toggle must appear only for chord charts and to the left of simulation');
assert.match(playback,/melodyEnabled: false/,'melody must be off by default');
assert.match(playback,/const melody = melodyFromMidiTrack\(track, file\.name\)[\s\S]*song\.melody = melody[\s\S]*await window\.persistSong\(song\)/s,'MIDI import must be stored in the existing song persistence flow');
assert.match(playback,/startMelodyScheduler\(\)[\s\S]*clock\.audioStartTime \+ \(Number\(note\.beat\) - offset\) \* secondsPerBeat/s,'melody must be scheduled against the shared playback origin');
assert.match(playback,/const nextAt = wallStart \+ \(nextBeat - startBeat\) \* beatMs/,'score ticks must be corrected against a single origin instead of accumulating setTimeout delay');
assert.match(audio,/scheduleMelodyNote\(note, atTime, secondsPerBeat\)/,'melody must use sample-accurate WebAudio start times');
assert.match(audio,/stopMelody\(\)/,'melody must be able to stop independently of the guitar');
console.log('MIDI melody and synchronized playback tests passed');
