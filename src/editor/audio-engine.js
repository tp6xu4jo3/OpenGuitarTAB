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
// Four sine partials in one cached PeriodicWave are exactly equivalent to
// four phase-aligned sine oscillators, with one audio-rate voice per MIDI note.
export const MELODY_PARTIALS = Object.freeze([1, 0.25, 0.1, 0.04]);
export const MELODY_LOW_PARTIALS = Object.freeze([1, 0.4, 0.18, 0.05]);
export const GUITAR_DUCK_DB = -5;
export const MIX_FADE_SECONDS = 0.03;
export const MELODY_TRIM_MIN_DB = -6;
export const MELODY_TRIM_MAX_DB = 6;
export const MELODY_BASE_LEVEL = 0.07;
export const MELODY_ATTACK_SECONDS = 0.006;
export const MELODY_DECAY_RATE = 1.6;
export const MELODY_RELEASE_SECONDS = 0.065;
export const MELODY_VOLUME_RAMP_SECONDS = 0.02;
let installedEngine = null;

export function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

export function melodyVoiceProfile(pitch, velocity = 80) {
  const midiPitch = clamp(Number(pitch), 0, 127);
  const midiVelocity = clamp(Number(velocity), 0, 127);
  return {
    frequency: 440 * 2 ** ((midiPitch - 69) / 12),
    level: MELODY_BASE_LEVEL * midiVelocity / 127
  };
}

export function melodyHarmonics(pitch = 72) {
  const numericPitch = Number(pitch);
  const lowWeight = clamp((72 - (Number.isFinite(numericPitch) ? numericPitch : 72)) / 24, 0, 1);
  const real = new Float32Array(5);
  const imag = new Float32Array(5);
  for (let i = 0; i < MELODY_PARTIALS.length; i += 1) {
    imag[i + 1] = MELODY_PARTIALS[i] + (MELODY_LOW_PARTIALS[i] - MELODY_PARTIALS[i]) * lowWeight;
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
    this.guitarBus = null;
    this.guitarDucked = false;
    this.melodyBus = null;
    this.melodyWaves = new Map();
    this.melodyTrimDb = 0;
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

    // Duck only the recorded guitar, keeping the metronome and master untouched.
    const guitarBus = context.createGain();
    guitarBus.gain.value = this.guitarDucked ? 10 ** (GUITAR_DUCK_DB / 20) : 1;
    guitarBus.connect(masterGain);

    const melodyBus = context.createGain();
    melodyBus.gain.value = 10 ** (this.melodyTrimDb / 20);
    const melodyCompressor = context.createDynamicsCompressor();
    melodyCompressor.threshold.value = -4;
    melodyCompressor.knee.value = 6;
    melodyCompressor.ratio.value = 3;
    melodyCompressor.attack.value = 0.003;
    melodyCompressor.release.value = 0.1;
    melodyBus.connect(melodyCompressor);
    melodyCompressor.connect(masterGain);

    this.context = context;
    this.masterGain = masterGain;
    this.guitarBus = guitarBus;
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

  setMelodyTrimDb(decibels) {
    const value = clamp(Number(decibels) || 0, MELODY_TRIM_MIN_DB, MELODY_TRIM_MAX_DB);
    this.melodyTrimDb = value;
    if (this.context && this.melodyBus) {
      const now = this.context.currentTime;
      const gain = this.melodyBus.gain;
      if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now);
      else {
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(gain.value, now);
      }
      gain.linearRampToValueAtTime(10 ** (value / 20), now + MELODY_VOLUME_RAMP_SECONDS);
    }
    return value;
  }

  setGuitarDucking(enabled) {
    this.guitarDucked = Boolean(enabled);
    if (this.context && this.guitarBus) {
      const now = this.context.currentTime;
      const gain = this.guitarBus.gain;
      if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now);
      else {
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(gain.value, now);
      }
      gain.linearRampToValueAtTime(
        this.guitarDucked ? 10 ** (GUITAR_DUCK_DB / 20) : 1,
        now + MIX_FADE_SECONDS
      );
    }
    return this.guitarDucked;
  }

  scheduleMelodyNote(note, atTime, secondsPerBeat) {
    if (!this.context || !this.melodyBus) return;
    const pitch = Number(note?.pitch);
    const length = Number(note?.duration) * secondsPerBeat;
    if (!Number.isFinite(pitch) || pitch < 0 || pitch > 127 || !(length > 0)) return;
    const start = Math.max(this.context.currentTime + 0.005, Number(atTime));
    const duration = Math.min(8, Math.max(0.03, length));
    const end = start + duration;
    const voiceProfile = melodyVoiceProfile(pitch, note?.velocity ?? 80);
    if (voiceProfile.level <= 0) return;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    const notePitch = Math.round(pitch);
    let wave = this.melodyWaves.get(notePitch);
    if (!wave) {
      const { real, imag } = melodyHarmonics(notePitch);
      wave = this.context.createPeriodicWave(real, imag, { disableNormalization: true });
      this.melodyWaves.set(notePitch, wave);
    }
    oscillator.setPeriodicWave(wave);
    oscillator.frequency.setValueAtTime(voiceProfile.frequency, start);
    const attackEnd = start + Math.min(MELODY_ATTACK_SECONDS, duration);
    const releaseEnd = end + MELODY_RELEASE_SECONDS;
    const decayedLevel = voiceProfile.level * Math.exp(-MELODY_DECAY_RATE * (end - attackEnd));
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(voiceProfile.level, attackEnd);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.000001, decayedLevel), end);
    envelope.gain.exponentialRampToValueAtTime(0.000001, releaseEnd);
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
    oscillator.stop(releaseEnd + 0.005);
  }

  stopMelody() {
    const now = this.context?.currentTime || 0;
    for (const voice of this.melodyVoices) {
      const gain = voice.envelope.gain;
      if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now);
      else {
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(Math.max(0.000001, gain.value), now);
      }
      gain.linearRampToValueAtTime(0, now + 0.018);
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
    gain.connect(this.guitarBus);

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
