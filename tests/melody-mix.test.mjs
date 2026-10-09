import assert from 'node:assert/strict';
import {
  GuitarAudioEngine, MASTER_OUTPUT_DB, MELODY_PARTIALS, MELODY_LOW_PARTIALS,
  GUITAR_LEVEL_DB, MELODY_GAIN_DB, MELODY_LOW_BOOST_MAX_DB,
  MELODY_BASE_LEVEL, MELODY_ATTACK_SECONDS, MELODY_DECAY_RATE,
  MELODY_RELEASE_SECONDS, melodyVoiceProfile, melodyHarmonics, melodyPitchBoostDb
} from '../src/editor/audio-engine.js';

assert.equal(MASTER_OUTPUT_DB, -6);
assert.deepEqual(MELODY_PARTIALS, [1, 0.25, 0.1, 0.04]);
assert.deepEqual(MELODY_LOW_PARTIALS, [1, 0.4, 0.18, 0.05]);
assert.equal(GUITAR_LEVEL_DB, -10);
assert.equal(MELODY_GAIN_DB, 10);
assert.equal(MELODY_LOW_BOOST_MAX_DB, 5);
assert.equal(MELODY_BASE_LEVEL, 0.07);
assert.equal(MELODY_ATTACK_SECONDS, 0.006);
assert.equal(MELODY_DECAY_RATE, 1.6);
assert.equal(MELODY_RELEASE_SECONDS, 0.065);
assert.equal(melodyPitchBoostDb(48), 5);
assert.equal(melodyPitchBoostDb(72), 0);
assert.equal(melodyPitchBoostDb(84), 0);
assert.ok(Math.abs(melodyPitchBoostDb(60) - 2.5) < 1e-12);
const pitches = [36, 48, 50, 52, 56, 60, 64, 68, 72, 84, 96];
for (let i = 1; i < pitches.length; i += 1) {
  assert.ok(melodyPitchBoostDb(pitches[i]) <= melodyPitchBoostDb(pitches[i - 1]) + 1e-12);
}
const low = melodyVoiceProfile(48, 80);
const middle = melodyVoiceProfile(60, 80);
const high = melodyVoiceProfile(84, 80);
const base = MELODY_BASE_LEVEL * 80 / 127;
assert.ok(Math.abs(low.level - base * 10 ** (5 / 20)) < 1e-12);
assert.ok(Math.abs(middle.level - base * 10 ** (2.5 / 20)) < 1e-12);
assert.ok(Math.abs(high.level - base) < 1e-12);
assert.ok(low.level > middle.level && middle.level > high.level);
assert.ok(Math.abs(low.frequency - 440 * 2 ** ((48 - 69) / 12)) < 1e-9);
assert.ok(Math.abs(high.frequency - 440 * 2 ** ((84 - 69) / 12)) < 1e-9);
assert.equal(melodyVoiceProfile(60, 0).level, 0);
for (const [pitch, expected] of [[48, MELODY_LOW_PARTIALS], [72, MELODY_PARTIALS]]) {
  const wave = melodyHarmonics(pitch);
  assert.deepEqual([...wave.real], [0,0,0,0,0]);
  expected.forEach((value,i)=>assert.ok(Math.abs(wave.imag[i+1]-value)<1e-7));
}
assert.ok(Math.abs(melodyHarmonics(60).imag[2] - 0.325) < 1e-7);

const nodes = [];
function param() {
  return {
    value: 0,
    events: [],
    setValueAtTime(value, at) { this.events.push(['set', value, at]); this.value = value; },
    linearRampToValueAtTime(value, at) { this.events.push(['linear', value, at]); this.value = value; },
    exponentialRampToValueAtTime(value, at) { this.events.push(['exponential', value, at]); this.value = value; },
    cancelScheduledValues(at) { this.events.push(['cancel', at]); }
  };
}
function node(kind) {
  const n = {
    kind,
    connections: [],
    connect(dest) { this.connections.push(dest); },
    disconnect() { this.connections.length = 0; }
  };
  nodes.push(n);
  return n;
}
class FakeAudioContext {
  constructor() { this.state = 'running'; this.currentTime = 10; this.destination = node('destination'); this.waves = []; }
  createGain() { const n = node('gain'); n.gain = param(); return n; }
  createDynamicsCompressor() {
    const n = node('compressor');
    for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[key] = param();
    return n;
  }
  createPeriodicWave(real, imag, options) {
    const wave = { real, imag, options };
    this.waves.push(wave);
    return wave;
  }
  createOscillator() {
    const n = node('oscillator');
    n.frequency = param();
    n.setPeriodicWave = wave => { n.wave = wave; };
    n.start = time => { n.startedAt = time; };
    n.stop = time => { n.stoppedAt = time; };
    return n;
  }
}
globalThis.window = { AudioContext: FakeAudioContext };
const engine = new GuitarAudioEngine();
engine.setup();
assert.equal(engine.guitarBus.gain.value, 10 ** (-10 / 20),
  'guitar bus is fixed at -10dB even without MIDI melody');
assert.ok(Math.abs(engine.melodyBus.gain.value - 10 ** (10 / 20)) < 1e-12,
  'melody bus is fixed at +10dB');
assert.equal(engine.context.waves.length, 0, 'sine waves are created on demand');
const melodyCompressor = engine.melodyBus.connections[0];
for (const [key,value] of Object.entries({threshold:-4,knee:6,ratio:3,attack:0.003,release:0.1})) {
  assert.equal(melodyCompressor[key].value,value);
}
assert.equal(melodyCompressor.connections[0], engine.masterGain);
assert.equal(engine.guitarBus.connections[0], engine.masterGain);
assert.equal(engine.masterGain.connections[0].kind, 'compressor');
assert.equal(engine.masterGain.connections[0].threshold.value, -10);
assert.equal(engine.setup(), engine.context, 'one reusable audio graph');

const start = 10.05;
engine.scheduleMelodyNote({ pitch:48, duration:1, velocity:80 }, start, 0.5);
engine.scheduleMelodyNote({ pitch:84, duration:1, velocity:80 }, start, 0.5);
engine.scheduleMelodyNote({ pitch:48, duration:1, velocity:80 }, start, 0.5);
assert.equal(engine.melodyVoices.size, 3, 'polyphonic notes play at the same absolute time');
assert.equal(engine.context.waves.length, 2, 'cached one-wave-per-pitch is reused');
for (const [i, osc] of nodes.filter(n => n.kind === 'oscillator').entries()) {
  assert.equal(osc.startedAt, start);
  assert.ok(Math.abs(osc.stoppedAt - (start + 0.5 + 0.065 + 0.005)) < 1e-9);
  assert.equal(osc.frequency.events[0][1], i === 1 ? high.frequency : low.frequency);
  const env = osc.connections[0].gain;
  assert.equal(osc.connections[0].connections[0], engine.melodyBus);
  assert.deepEqual(env.events.map(e => e[0]), ['set', 'linear', 'exponential', 'exponential']);
  assert.ok(Math.abs(env.events[1][2] - (start + 0.006)) < 1e-9);
  assert.ok(Math.abs(env.events[2][1] - low.level * Math.exp(-1.6 * (0.5 - 0.006))) < 1e-9);
  assert.ok(Math.abs(env.events[3][2] - (start + 0.565)) < 1e-9);
}
assert.equal(engine.context.waves[0].options.disableNormalization, true);
assert.ok(engine.context.waves[0].imag[2] > engine.context.waves[1].imag[2], 'low notes have clearer upper partials');

engine.setMelodyTrimDb(6);
assert.equal(engine.melodyTrimDb, 6);
assert.ok(Math.abs(engine.melodyBus.gain.events.at(-1)[1] - 10 ** (6 / 20)) < 1e-9);
assert.ok(Math.abs(engine.melodyBus.gain.events.at(-1)[2] - (10 + 0.02)) < 1e-9);
engine.setMelodyTrimDb(-6);
assert.equal(engine.melodyTrimDb, -6);
engine.setMelodyTrimDb(50);
assert.equal(engine.melodyTrimDb, 6, 'trim must never expose legacy 400% boost');
engine.setMelodyTrimDb(-50);
assert.equal(engine.melodyTrimDb, -6);

engine.setGuitarDucking(true);
assert.equal(engine.guitarDucked, true);
assert.ok(Math.abs(engine.guitarBus.gain.events.at(-1)[1] - 10 ** (-5 / 20)) < 1e-9);
assert.ok(Math.abs(engine.guitarBus.gain.events.at(-1)[2] - (10 + 0.03)) < 1e-9);
engine.setGuitarDucking(false);
assert.equal(engine.guitarBus.gain.events.at(-1)[1], 1, 'when melody turns off, guitar level returns to normal');
assert.equal(engine.melodyBus.gain.events.at(-1)[1], 10 ** (-6 / 20), 'ducking does not change the independent melody trim');
engine.stopMelody();
assert.equal(engine.melodyVoices.size, 0);
assert.ok(nodes.filter(n => n.kind === 'oscillator').every(n => n.stoppedAt <= 10.02));
console.log('melody-first auto mix and soft low-register harmonic tests passed');
