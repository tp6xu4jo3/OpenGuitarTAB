import {
  RecordedGuitarSampleBank,
  SAMPLE_ATTACK_PREROLL_SECONDS,
  SAMPLE_DURATION_SECONDS,
  samplePlanForTab
} from './sample-bank.js';

const STRING_TUNING = [329.6275569128699, 246.94165062806206, 195.99771799008746, 146.8323839587038, 110, 82.4068892282175];
const SAME_STRING_DAMP_LEAD_SECONDS = 0.025;
const SAME_STRING_SILENCE_BEFORE_ATTACK_SECONDS = 0.002;
const MANUAL_RELEASE_SECONDS = 0.018;
const MIN_SLIDE_SECONDS = 0.015;
const SLIDE_MOTION_SECONDS = 0.25;
const SLIDE_TARGET_HOLD_SECONDS = 0.045;
const SLIDE_TRANSITION_LEVEL = 0.9;
export const MASTER_OUTPUT_DB = -6;
export const MASTER_OUTPUT_GAIN = Math.pow(10, MASTER_OUTPUT_DB / 20);
// Melody is intentionally mixed separately from the recorded guitar bank.
// A brighter harmonic profile lets lower notes cut through chords without changing pitch.
export const MELODY_BASE_LEVEL = 0.24;
export const MELODY_LOW_LIFT_DB = 3;
export const MELODY_PRESENCE_DB = 2.5;
const MELODY_BUS_GAIN = 0.9;
const MELODY_WAVEFORMS = {
  low: { partials: 24, rolloff: 1.3 },
  mid: { partials: 18, rolloff: 1.6 },
  high: { partials: 12, rolloff: 1.9 }
};
let installedEngine = null;

export function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

export function melodyVoiceProfile(pitch, velocity = 80) {
  const midiPitch = clamp(Number(pitch), 0, 127);
  const midiVelocity = clamp(Number(velocity), 1, 127);
  // Smooth register-dependent level, avoiding abrupt volume changes at octave boundaries.
  const lowWeight = clamp((72 - midiPitch) / 24, 0, 1);
  return {
    register: midiPitch < 60 ? 'low' : midiPitch < 76 ? 'mid' : 'high',
    frequency: 440 * 2 ** ((midiPitch - 69) / 12),
    level: MELODY_BASE_LEVEL
      * 10 ** ((MELODY_LOW_LIFT_DB * lowWeight) / 20)
      * (midiVelocity / 127) ** 0.75
  };
}

export function melodyHarmonics(register) {
  const { partials, rolloff } = MELODY_WAVEFORMS[register];
  const real = new Float32Array(partials + 1);
  const imag = new Float32Array(partials + 1);
  for (let harmonic = 1; harmonic <= partials; harmonic += 1) {
    imag[harmonic] = (harmonic % 2 === 0 ? 0.8 : 1) / harmonic ** rolloff;
  }
  return { real, imag };
}

export function getTempoFromUi() {
  const input = document.getElementById('tempoInput');
  const raw = Number(input?.value);
  const value = clamp(Math.round(Number.isFinite(raw) ? raw : 120), 30, 300);
  if (input) input.value = String(value);
  return value;
}

export function getCapoFromUi() {
  const input = document.getElementById('capoInput');
  const raw = Number(input?.value);
  const value = clamp(Math.round(Number.isFinite(raw) ? raw : 0), 0, 12);
  if (input) input.value = String(value);
  return value;
}

// Relative sample loudness is mastered into the single recorded bank.
export function stringLevelDb() { return 0; }

export function frequencyForTab(stringIndex, fret, capo = 0) {
  const string = clamp(Math.round(Number(stringIndex) || 0), 0, STRING_TUNING.length - 1);
  const soundingFret = clamp(Number(fret) || 0, 0, 36) + clamp(Number(capo) || 0, 0, 12);
  return STRING_TUNING[string] * Math.pow(2, soundingFret / 12);
}

export function pitchPlanForTab(stringIndex, fret, { capo = 0, slideToFret = null, slideSeconds = 0 } = {}) {
  const startFret = clamp(Number(fret) || 0, 0, 36);
  const frequency = frequencyForTab(stringIndex, startFret, capo);
  const hasTarget = slideToFret !== null && slideToFret !== undefined && String(slideToFret).trim() !== '';
  const rawTarget = hasTarget ? Number(slideToFret) : Number.NaN;
  const targetFret = Number.isFinite(rawTarget) ? clamp(rawTarget, 0, 36) : startFret;
  const sliding = Number.isFinite(rawTarget) && Math.abs(targetFret - startFret) > 1e-9;
  return {
    startFret,
    targetFret,
    frequency,
    targetFrequency: sliding ? frequencyForTab(stringIndex, targetFret, capo) : frequency,
    glideSeconds: sliding ? clamp(Number(slideSeconds) || 0.25, MIN_SLIDE_SECONDS, 4) : 0,
    sliding
  };
}

export function frettedSlideSteps(fromFret, toFret, slideSeconds) {
  const start = clamp(Math.round(Number(fromFret) || 0), 0, 36);
  const rawTarget = Number(toFret);
  if (!Number.isFinite(rawTarget)) return [];
  const target = clamp(Math.round(rawTarget), 0, 36);
  if (target === start) return [];
  const direction = Math.sign(target - start);
  const count = Math.abs(target - start);
  const duration = clamp(Number(slideSeconds) || 0.25, MIN_SLIDE_SECONDS, 4);
  const targetHoldSeconds = Math.min(SLIDE_TARGET_HOLD_SECONDS, duration * 0.25);
  const motionDuration = Math.min(SLIDE_MOTION_SECONDS, Math.max(0.001, duration - targetHoldSeconds));
  const sourceHoldSeconds = Math.max(0, duration - targetHoldSeconds - motionDuration);
  const stepDuration = motionDuration / count;
  return Array.from({ length: count }, (_, index) => {
    const fret = start + direction * (index + 1);
    return {
      fret,
      playbackRate: Math.pow(2, (fret - start) / 12),
      atSeconds: sourceHoldSeconds + stepDuration * (index + 1)
    };
  });
}

export class GuitarAudioEngine {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this.melodyBus = null;
    this.melodyWaves = null;
    this.activeVoices = Array(STRING_TUNING.length).fill(null);
    this.samples = new RecordedGuitarSampleBank();
    this.melodyVoices = new Set();
  }

  setup() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      alert('這個瀏覽器不支援 Web Audio API，無法播放音效。');
      return null;
    }
    if (this.context) return this.context;
    const context = new AudioContextClass();
    const masterGain = context.createGain();
    const compressor = context.createDynamicsCompressor();
    masterGain.gain.value = MASTER_OUTPUT_GAIN;
    compressor.threshold.value = -10;
    compressor.knee.value = 12;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;
    masterGain.connect(compressor);
    compressor.connect(context.destination);

    // Shared nodes are constructed once: each note needs only an oscillator and envelope.
    const melodyBus = context.createGain();
    melodyBus.gain.value = MELODY_BUS_GAIN;
    const melodyHighpass = context.createBiquadFilter();
    melodyHighpass.type = 'highpass';
    melodyHighpass.frequency.value = 58;
    melodyHighpass.Q.value = 0.707;
    const melodyPresence = context.createBiquadFilter();
    melodyPresence.type = 'peaking';
    melodyPresence.frequency.value = 1650;
    melodyPresence.Q.value = 0.85;
    melodyPresence.gain.value = MELODY_PRESENCE_DB;
    melodyBus.connect(melodyHighpass);
    melodyHighpass.connect(melodyPresence);
    melodyPresence.connect(masterGain);

    this.melodyWaves = Object.fromEntries(
      Object.keys(MELODY_WAVEFORMS).map(register => {
        const { real, imag } = melodyHarmonics(register);
        return [register, context.createPeriodicWave(real, imag)];
      })
    );
    this.context = context;
    this.masterGain = masterGain;
    this.melodyBus = melodyBus;
    return context;
  }

  async ensureReady() {
    const context = this.setup();
    if (!context) return false;
    if (context.state === 'suspended') await context.resume();
    const ready = await this.samples.decode(context);
    if (!ready) window.showToast?.('吉他錄音音源載入失敗，請重新整理後再試');
    return ready;
  }

  async ensureMelodyReady() {
    const context = this.setup();
    if (!context) return false;
    if (context.state === 'suspended') await context.resume();
    return true;
  }

  scheduleMelodyNote(note, atTime, secondsPerBeat) {
    if (!this.context || !this.melodyBus) return;
    const pitch = Number(note?.pitch);
    const length = Number(note?.duration) * secondsPerBeat;
    if (!Number.isFinite(pitch) || pitch < 0 || pitch > 127 || !(length > 0)) return;
    const start = Math.max(this.context.currentTime + 0.005, Number(atTime));
    const duration = Math.min(8, Math.max(0.03, length));
    const end = start + duration;
    const voiceProfile = melodyVoiceProfile(pitch, Number(note?.velocity) || 80);
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.setPeriodicWave(this.melodyWaves[voiceProfile.register]);
    oscillator.frequency.setValueAtTime(voiceProfile.frequency, start);
    const attack = Math.min(0.009, duration * 0.2);
    const release = Math.min(0.085, duration * 0.35);
    const level = voiceProfile.level;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(level, start + attack);
    envelope.gain.setValueAtTime(level, Math.max(start + attack, end - release));
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(envelope);
    envelope.connect(this.melodyBus);
    const voice = { oscillator, envelope };
    this.melodyVoices.add(voice);
    oscillator.onended = () => {
      this.melodyVoices.delete(voice);
      oscillator.disconnect();
      envelope.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(end + 0.01);
  }

  stopMelody() {
    const now = this.context?.currentTime || 0;
    for (const voice of this.melodyVoices) {
      const gain = voice.envelope.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(Math.max(0.0001, gain.value), now);
      gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
      try { voice.oscillator.stop(now + 0.02); } catch {}
    }
    this.melodyVoices.clear();
  }

  connectSample(plan, startTime, destination, slideSteps) {
    const source = this.context.createBufferSource();
    const basePlaybackRate = plan.playbackRate;
    source.buffer = this.samples.buffer;
    source.playbackRate.setValueAtTime(basePlaybackRate, startTime);
    for (const step of slideSteps) {
      const stepTime = startTime + Math.max(0, Number(step.atSeconds) || 0);
      const nextRate = basePlaybackRate * step.playbackRate;
      source.playbackRate.setValueAtTime(nextRate, stepTime);
    }
    source.connect(destination);
    source.start(
      startTime,
      plan.offsetSeconds + SAMPLE_ATTACK_PREROLL_SECONDS,
      SAMPLE_DURATION_SECONDS - SAMPLE_ATTACK_PREROLL_SECONDS
    );
    return { source, basePlaybackRate };
  }

  stopStringVoice(stringIndex, releaseSeconds = MANUAL_RELEASE_SECONDS) {
    const voice = this.activeVoices[stringIndex];
    if (!voice || !this.context) return;
    this.activeVoices[stringIndex] = null;
    const now = this.context.currentTime;
    const gain = voice.gain.gain;
    if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now);
    else {
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(Math.max(0, gain.value), now);
    }
    gain.linearRampToValueAtTime(0, now + releaseSeconds);
    window.setTimeout(() => voice.stop(), (releaseSeconds + 0.025) * 1000);
  }

  stopAll() {
    for (let string = 0; string < STRING_TUNING.length; string++) this.stopStringVoice(string, 0.025);
  }

  hasActiveSlide(stringIndex, relationId) {
    const string = clamp(Math.round(Number(stringIndex) || 0), 0, STRING_TUNING.length - 1);
    const voice = this.activeVoices[string];
    return Boolean(voice?.slideRelationId && String(voice.slideRelationId) === String(relationId || ''));
  }

  hasActiveArc(relationId) {
    const id = String(relationId || '');
    return Boolean(id && this.activeVoices.some(voice => String(voice?.arcRelationId || '') === id));
  }

  continueArc(fromRelationId, toRelationId) {
    const fromId = String(fromRelationId || '');
    const toId = String(toRelationId || '');
    if (!fromId || !toId) return false;
    const voice = this.activeVoices.find(item => String(item?.arcRelationId || '') === fromId);
    if (!voice) return false;
    voice.arcRelationId = toId;
    return true;
  }

  playMetronomeClick({ accent = false } = {}) {
    if (!this.context || !this.masterGain) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(accent ? 1480 : 1040, now);
    gain.gain.setValueAtTime(accent ? 0.17 : 0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    oscillator.connect(gain);
    gain.connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + 0.05);
  }

  playNote(stringIndex, fret, {
    capo = getCapoFromUi(),
    harmonic = false,
    slideToFret = null,
    slideSeconds = 0,
    slideRelationId = '',
    arcRelationId = '',
    nextSameStringSeconds = null,
    dampPrevious = true
  } = {}) {
    if (!this.context || !this.masterGain || !this.samples.buffer || /^x$/i.test(String(fret))) return;
    const string = clamp(Math.round(Number(stringIndex) || 0), 0, STRING_TUNING.length - 1);
    const pitch = pitchPlanForTab(string, fret, { capo, slideToFret, slideSeconds });
    const plan = samplePlanForTab(string, pitch.startFret, { capo });
    const slideSteps = pitch.sliding ? frettedSlideSteps(pitch.startFret, pitch.targetFret, pitch.glideSeconds) : [];
    const now = this.context.currentTime;
    if (dampPrevious) this.stopStringVoice(string);

    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    filter.type = harmonic ? 'highpass' : 'lowpass';
    filter.frequency.setValueAtTime(harmonic ? 520 : 15000, now);
    filter.Q.setValueAtTime(harmonic ? 0.75 : 0.35, now);
    const level = harmonic ? 0.86 : 1;
    gain.gain.setValueAtTime(level, now);
    if (slideSteps.length) {
      const firstStep = slideSteps[0];
      const lastStep = slideSteps.at(-1);
      const slideStart = Math.max(0, firstStep.atSeconds);
      const slideEnd = Math.max(slideStart, lastStep.atSeconds);
      const slideSpan = Math.max(0.001, slideEnd - slideStart);
      const dipEnd = Math.min(slideEnd, slideStart + Math.min(0.012, slideSpan * 0.18));
      const restoreStart = Math.max(dipEnd, slideEnd - Math.min(0.012, slideSpan * 0.18));
      gain.gain.setValueAtTime(level, now + slideStart);
      gain.gain.linearRampToValueAtTime(level * SLIDE_TRANSITION_LEVEL, now + dipEnd);
      gain.gain.setValueAtTime(level * SLIDE_TRANSITION_LEVEL, now + restoreStart);
      gain.gain.linearRampToValueAtTime(level, now + slideEnd);
    }
    const { source, basePlaybackRate } = this.connectSample(plan, now, filter, slideSteps);
    filter.connect(gain);
    gain.connect(this.masterGain);

    const nextDelay = Number(nextSameStringSeconds);
    if (Number.isFinite(nextDelay) && nextDelay > SAME_STRING_SILENCE_BEFORE_ATTACK_SECONDS) {
      const nextAttackTime = now + nextDelay;
      const releaseEnd = nextAttackTime - SAME_STRING_SILENCE_BEFORE_ATTACK_SECONDS;
      const releaseStart = Math.max(now, releaseEnd - (SAME_STRING_DAMP_LEAD_SECONDS - SAME_STRING_SILENCE_BEFORE_ATTACK_SECONDS));
      gain.gain.setValueAtTime(level, releaseStart);
      gain.gain.linearRampToValueAtTime(0, releaseEnd);
      try { source.stop(nextAttackTime); } catch {}
    }

    const minimumRate = Math.max(0.25, Math.min(basePlaybackRate, ...slideSteps.map(step => basePlaybackRate * step.playbackRate)));
    let stopped = false;
    let cleanupTimer = null;
    const voice = {
      gain,
      slideRelationId: pitch.sliding ? String(slideRelationId || '') : '',
      arcRelationId: String(arcRelationId || ''),
      stop: () => {
        if (stopped) return;
        stopped = true;
        if (cleanupTimer) clearTimeout(cleanupTimer);
        try { source.stop(); } catch {}
        try { source.disconnect(); } catch {}
        try { filter.disconnect(); } catch {}
        try { gain.disconnect(); } catch {}
        if (this.activeVoices[string] === voice) this.activeVoices[string] = null;
      }
    };
    this.activeVoices[string] = voice;
    cleanupTimer = window.setTimeout(() => voice.stop(), Math.min(8, SAMPLE_DURATION_SECONDS / minimumRate + 0.2) * 1000);
  }
}

export function installAudioEngine() {
  if (typeof window === 'undefined') return null;
  if (!installedEngine) installedEngine = new GuitarAudioEngine();
  const engine = installedEngine;
  void engine.samples.preload();
  Object.assign(window, {
    clamp,
    getTempo: getTempoFromUi,
    getCapo: getCapoFromUi,
    getSlotDurationMs: () => (60000 / getTempoFromUi()) / 4,
    ensureAudioReady: () => engine.ensureReady(),
    playGuitarNote: (stringIndex, fret) => engine.playNote(stringIndex, fret),
    playMetronomeClick: options => engine.playMetronomeClick(options),
    stopAllStringVoices: () => engine.stopAll()
  });
  window.editorAudio = engine;
  return engine;
}

export function getAudioEngine() { return installedEngine; }
