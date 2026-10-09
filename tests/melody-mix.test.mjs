import assert from 'node:assert/strict';
import {
  GuitarAudioEngine, MASTER_OUTPUT_DB,
  MELODY_PARTIALS, MELODY_BASE_LEVEL, MELODY_ATTACK_SECONDS,
  MELODY_DECAY_RATE, MELODY_RELEASE_SECONDS, MELODY_VOLUME_RAMP_SECONDS,
  MELODY_MAX_VOLUME_PERCENT, melodyVoiceProfile, melodyHarmonics
} from '../src/editor/audio-engine.js';

assert.equal(MASTER_OUTPUT_DB, -6, 'unchanged master must preserve recorded-guitar headroom');
assert.deepEqual(MELODY_PARTIALS, [1, 0.25, 0.1, 0.04]);
assert.equal(MELODY_BASE_LEVEL, 0.07);
assert.equal(MELODY_ATTACK_SECONDS, 0.006);
assert.equal(MELODY_DECAY_RATE, 1.6);
assert.equal(MELODY_RELEASE_SECONDS, 0.065);
assert.equal(MELODY_VOLUME_RAMP_SECONDS, 0.02);
assert.equal(MELODY_MAX_VOLUME_PERCENT, 400);
const low = melodyVoiceProfile(48, 80);
const high = melodyVoiceProfile(84, 80);
assert.ok(Math.abs(low.level - 0.07 * 80 / 127) < 1e-12);
assert.equal(low.level, high.level, 'the new piano timbre must not exaggerate low or high frequencies');
assert.ok(Math.abs(low.frequency - 440 * 2 ** ((48 - 69) / 12)) < 1e-9);
assert.ok(Math.abs(high.frequency - 440 * 2 ** ((84 - 69) / 12)) < 1e-9);
assert.equal(melodyVoiceProfile(60, 0).level, 0);
assert.equal(melodyVoiceProfile(60, 127).level, 0.07);
const { real, imag } = melodyHarmonics();
assert.deepEqual([...real], [0, 0, 0, 0, 0]);
assert.ok([...imag].every((value, i) => Math.abs(value - [0, 1, 0.25, 0.1, 0.04][i]) < 1e-8));

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
engine.setMelodyVolume(150);
engine.setup();
assert.equal(engine.melodyVolumePercent, 150);
assert.equal(engine.melodyBus.gain.value, 1.5, 'volume set before AudioContext exists should initialize the gain');
assert.equal(engine.context.waves.length, 1, 'one shared four-sine wave must be cached for all MIDI notes');
assert.equal(engine.context.waves[0].options.disableNormalization, true, 'WebAudio must not renormalize requested sine amplitudes');
assert.equal(engine.setup(), engine.context, 'setup must reuse the existing graph and waveform');

const melodyCompressor = engine.melodyBus.connections[0];
assert.equal(melodyCompressor.kind, 'compressor');
for (const [name, value] of Object.entries({ threshold:-4, knee:6, ratio:12, attack:0.003, release:0.1 })) {
  assert.equal(melodyCompressor[name].value, value, `melody compressor ${name}`);
}
assert.equal(melodyCompressor.connections[0], engine.masterGain, 'melody compressor must mix to existing master');
assert.equal(engine.masterGain.connections[0].kind, 'compressor', 'existing guitar master compressor is preserved');
assert.equal(engine.masterGain.connections[0].threshold.value, -10, 'do not alter guitar compressor settings');

const start = 10.05;
engine.scheduleMelodyNote({ pitch:48, duration:1, velocity:80 }, start, 0.5);
engine.scheduleMelodyNote({ pitch:84, duration:1, velocity:80 }, start, 0.5);
assert.equal(engine.melodyVoices.size, 2, 'MIDI chords must sustain simultaneous notes');
assert.equal(engine.context.waves.length, 1, 'polyphonic MIDI notes must reuse the wave');
const oscillators = nodes.filter(n => n.kind === 'oscillator');
assert.equal(oscillators.length, 2, 'four partials are synthesized by one efficient oscillator per note');
for (const [i, osc] of oscillators.entries()) {
  assert.equal(osc.startedAt, start, 'notes must keep sample-accurate absolute scheduling');
  assert.ok(Math.abs(osc.stoppedAt - (start + 0.5 + 0.065 + 0.005)) < 1e-9);
  assert.equal(osc.wave, engine.melodyWave);
  assert.equal(osc.frequency.events[0][1], i === 0 ? low.frequency : high.frequency);
  const env = osc.connections[0].gain;
  assert.equal(osc.connections[0].connections[0], engine.melodyBus);
  assert.deepEqual(env.events.map(e => e[0]), ['set', 'linear', 'exponential', 'exponential']);
  assert.ok(Math.abs(env.events[1][2] - (start + 0.006)) < 1e-9, '6 ms attack');
  assert.ok(Math.abs(env.events[1][1] - 0.07 * 80 / 127) < 1e-12, 'linear MIDI velocity gain');
  assert.ok(Math.abs(env.events[2][1] - (0.07 * 80 / 127) * Math.exp(-1.6 * (0.5-0.006))) < 1e-9, 'true exponential body decay');
  assert.ok(Math.abs(env.events[3][2] - (start + 0.5 + 0.065)) < 1e-9, '65 ms release after note off');
}

engine.setMelodyVolume(400);
assert.equal(engine.melodyVolumePercent, 400);
assert.deepEqual(engine.melodyBus.gain.events.slice(-2).map(e => [e[0], e[2]]), [['set',10],['linear',10.02]], 'volume changes ramp smoothly for 20ms');
assert.equal(engine.melodyBus.gain.events.at(-1)[1], 4);
engine.setMelodyVolume(-5);
assert.equal(engine.melodyVolumePercent, 0);
engine.setMelodyVolume(900);
assert.equal(engine.melodyVolumePercent, 400);
engine.stopMelody();
assert.equal(engine.melodyVoices.size, 0);
assert.ok(oscillators.every(osc => osc.stoppedAt <= 10.02), 'stop must cancel scheduled voices');
console.log('soft four-sine melody mix tests passed');
