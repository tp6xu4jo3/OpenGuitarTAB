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
const SLIDE_TRANSITION_LEVEL = 0.62;
let installedEngine = null;

export function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

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
    glideSeconds: sliding ? clamp(Number(slideSeconds) || 0.25, 0.06, 4) : 0,
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
  const duration = clamp(Number(slideSeconds) || 0.25, 0.06, 4);
  const motionDuration = Math.min(duration, clamp(0.04 + count * 0.018, 0.07, 0.18));
  const holdDuration = Math.max(0, duration - motionDuration);
  const stepDuration = motionDuration / count;
  return Array.from({ length: count }, (_, index) => {
    const fret = start + direction * (index + 1);
    return {
      fret,
      playbackRate: Math.pow(2, (fret - start) / 12),
      atSeconds: holdDuration + stepDuration * (index + 1),
      transitionSeconds: Math.min(0.026, Math.max(0.006, stepDuration * 0.35))
    };
  });
}

export class GuitarAudioEngine {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this.activeVoices = Array(STRING_TUNING.length).fill(null);
    this.samples = new RecordedGuitarSampleBank();
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
    masterGain.gain.value = 0.95;
    compressor.threshold.value = -10;
    compressor.knee.value = 12;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;
    masterGain.connect(compressor);
    compressor.connect(context.destination);
    this.context = context;
    this.masterGain = masterGain;
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

  connectSample(plan, startTime, destination, slideSteps) {
    const source = this.context.createBufferSource();
    const basePlaybackRate = plan.playbackRate;
    source.buffer = this.samples.buffer;
    source.playbackRate.setValueAtTime(basePlaybackRate, startTime);
    let previousRate = basePlaybackRate;
    let previousStepTime = startTime;
    for (const step of slideSteps) {
      const stepEnd = startTime + Math.max(0, Number(step.atSeconds) || 0);
      const rampStart = Math.max(previousStepTime, stepEnd - Math.max(0.001, Number(step.transitionSeconds) || 0.01));
      const nextRate = basePlaybackRate * step.playbackRate;
      source.playbackRate.setValueAtTime(previousRate, rampStart);
      source.playbackRate.linearRampToValueAtTime(nextRate, stepEnd);
      previousRate = nextRate;
      previousStepTime = stepEnd;
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
      const slideStart = Math.max(0, firstStep.atSeconds - firstStep.transitionSeconds);
      const slideEnd = Math.max(slideStart, lastStep.atSeconds);
      const slideSpan = Math.max(0.001, slideEnd - slideStart);
      const dipEnd = Math.min(slideEnd, slideStart + Math.min(0.012, slideSpan * 0.18));
      const restoreStart = Math.max(dipEnd, slideEnd - Math.min(0.015, slideSpan * 0.2));
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
