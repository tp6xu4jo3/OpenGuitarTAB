import assert from 'node:assert/strict';
import {
  GuitarAudioEngine,
  MASTER_OUTPUT_DB,
  MELODY_BASE_LEVEL,
  MELODY_LOW_LIFT_DB,
  MELODY_PRESENCE_DB,
  melodyVoiceProfile,
  melodyHarmonics
} from '../src/editor/audio-engine.js';

assert.equal(MASTER_OUTPUT_DB, -6, 'do not change guitar/master headroom');
assert.equal(MELODY_BASE_LEVEL, 0.24, 'melody needs modest presence over its previous quiet triangle wave');
assert.equal(MELODY_LOW_LIFT_DB, 3, 'lower registers get only a bounded, three-dB lift');
assert.equal(MELODY_PRESENCE_DB, 2.5, 'presence emphasis must be subtle enough to remain pleasant');

const low = melodyVoiceProfile(48, 80);
const mid = melodyVoiceProfile(66, 80);
const high = melodyVoiceProfile(84, 80);
assert.equal(low.register, 'low');
assert.equal(mid.register, 'mid');
assert.equal(high.register, 'high');
assert.ok(low.level > mid.level && mid.level > high.level, 'lower notes need more volume without changing the MIDI velocity');
assert.ok(Math.abs(low.level / high.level - 10 ** (3 / 20)) < 1e-9, 'low/high volume difference must be a smooth +3dB maximum');
assert.ok(Math.abs(low.frequency - 440 * 2 ** ((48 - 69) / 12)) < 1e-9, 'low MIDI pitch must not be transposed');
assert.ok(Math.abs(high.frequency - 440 * 2 ** ((84 - 69) / 12)) < 1e-9, 'high MIDI pitch must not be transposed');
assert.ok(melodyVoiceProfile(48, 127).level < 0.35, 'loud low note gain must remain bounded before the shared compressor');
assert.ok(melodyVoiceProfile(48, 20).level > 0, 'quiet MIDI velocities remain audible');
for (const register of ['low', 'mid', 'high']) {
  const { real, imag } = melodyHarmonics(register);
  assert.equal(real.length, imag.length);
  assert.equal(imag[0], 0, 'periodic waveform cannot introduce DC');
  assert.equal(imag[1], 1, 'the original fundamental must remain present');
  assert.ok(imag.every(Number.isFinite), 'harmonic coefficients must be valid');
}
const lowWave = melodyHarmonics('low');
const highWave = melodyHarmonics('high');
assert.ok(lowWave.imag.length > highWave.imag.length, 'lower notes need extra upper harmonics');
assert.ok(lowWave.imag[5] > highWave.imag[5], 'lower notes need brighter fifth harmonics');
assert.ok(lowWave.imag[15] > 0, 'lower notes need audibility from higher harmonics');

const nodes = [];
function param() {
  return {
    value: 0,
    events: [],
    setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; },
    linearRampToValueAtTime(v, t) { this.events.push(['linear', v, t]); this.value = v; },
    exponentialRampToValueAtTime(v, t) { this.events.push(['exponential', v, t]); this.value = v; },
    cancelScheduledValues(t) { this.events.push(['cancel', t]); }
  };
}
function node(kind) {
  const n = {
    kind,
    connections: [],
    connect(destination) { this.connections.push(destination); },
    disconnect() { this.connections.length = 0; }
  };
  nodes.push(n);
  return n;
}
class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 10;
    this.destination = node('destination');
    this.createdWaves = [];
  }
  createGain() { const n = node('gain'); n.gain = param(); return n; }
  createDynamicsCompressor() {
    const n = node('compressor');
    for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[key] = param();
    return n;
  }
  createBiquadFilter() {
    const n = node('filter');
    n.frequency = param();
    n.Q = param();
    n.gain = param();
    return n;
  }
  createPeriodicWave(real, imag) {
    const wave = { real, imag };
    this.createdWaves.push(wave);
    return wave;
  }
  createOscillator() {
    const n = node('oscillator');
    n.frequency = param();
    n.setPeriodicWave = wave => { n.wave = wave; };
    n.start = t => { n.startedAt = t; };
    n.stop = t => { n.stoppedAt = t; };
    return n;
  }
}
globalThis.window = { AudioContext: FakeAudioContext };
const engine = new GuitarAudioEngine();
engine.setup();
assert.equal(engine.context.createdWaves.length, 3, 'waveforms must be cached once per AudioContext, not constructed per note');
assert.equal(engine.setup(), engine.context, 'AudioContext should be reused');
assert.equal(engine.context.createdWaves.length, 3, 'no waveform reallocation during setup reuse');

const hp = engine.melodyBus.connections[0];
const presence = hp.connections[0];
assert.equal(hp.type, 'highpass');
assert.equal(hp.frequency.value, 58);
assert.equal(presence.type, 'peaking');
assert.equal(presence.frequency.value, 1650);
assert.equal(presence.gain.value, MELODY_PRESENCE_DB);
assert.equal(presence.connections[0], engine.masterGain, 'melody must join the guitar only at the existing master stage');
assert.equal(engine.masterGain.connections[0].kind, 'compressor', 'existing master dynamics protect polyphonic melody+guitar mixing');

const start = 10.05;
engine.scheduleMelodyNote({ pitch: 48, duration: 1, velocity: 80 }, start, 0.5);
engine.scheduleMelodyNote({ pitch: 84, duration: 1, velocity: 80 }, start, 0.5);
const oscillators = nodes.filter(n => n.kind === 'oscillator');
assert.equal(oscillators.length, 2, 'one oscillator per melody note must be enough');
for (const osc of oscillators) {
  assert.equal(osc.startedAt, start, 'shared playback origin must be retained exactly');
  assert.ok(Math.abs(osc.stoppedAt - 10.56) < 1e-9, 'notes retain their expected 0.5s duration');
  assert.equal(osc.connections[0].connections[0], engine.melodyBus, 'voices must feed the melody-only EQ, not guitar EQ');
}
assert.equal(oscillators[0].wave, engine.melodyWaves.low);
assert.equal(oscillators[1].wave, engine.melodyWaves.high);
assert.equal(oscillators[0].frequency.events[0][1], low.frequency);
assert.equal(oscillators[1].frequency.events[0][1], high.frequency);
const lowEnvelope = oscillators[0].connections[0].gain;
const highEnvelope = oscillators[1].connections[0].gain;
assert.ok(lowEnvelope.events[1][1] > highEnvelope.events[1][1], 'quiet low registers must actually receive larger output levels');
assert.equal(engine.melodyVoices.size, 2);
engine.stopMelody();
assert.equal(engine.melodyVoices.size, 0, 'stopping playback must silence scheduled melody voices');
assert.ok(oscillators.every(osc => osc.stoppedAt <= 10.02), 'stop should immediately silence both voices');
console.log('melody low-register audio balance tests passed');
