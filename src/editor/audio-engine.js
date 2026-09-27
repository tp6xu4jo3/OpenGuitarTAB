const STRING_TUNING = [
  329.6275569128699,
  246.94165062806206,
  195.99771799008746,
  146.8323839587038,
  110,
  82.4068892282175
];

// String index 0 is the first (high E) string and index 5 is the sixth (low E).
// Keep the level spread intentionally small so chords stay balanced while the
// low strings do not dominate the mix.
const STRING_LEVEL_DB = [0.5, 0.3, 0.1, -0.1, -0.3, -0.5];
const PLUCK_BUFFER_CACHE_LIMIT = 48;
let installedEngine = null;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function getTempoFromUi() {
  const input = document.getElementById('tempoInput');
  const raw = Number(input?.value);
  const tempo = Number.isFinite(raw) ? raw : 120;
  const clamped = clamp(Math.round(tempo), 30, 300);
  if (input) input.value = String(clamped);
  return clamped;
}

export function getCapoFromUi() {
  const input = document.getElementById('capoInput');
  const raw = Number(input?.value);
  const capo = Number.isFinite(raw) ? raw : 0;
  const clamped = clamp(Math.round(capo), 0, 12);
  if (input) input.value = String(clamped);
  return clamped;
}

export function stringLevelDb(stringIndex) {
  const string = clamp(Math.round(Number(stringIndex) || 0), 0, STRING_LEVEL_DB.length - 1);
  return STRING_LEVEL_DB[string];
}

export function frequencyForTab(stringIndex, fret, capo = 0) {
  const string = clamp(Math.round(Number(stringIndex) || 0), 0, STRING_TUNING.length - 1);
  const cleanFret = clamp(Number(fret) || 0, 0, 36);
  const soundingFret = cleanFret + clamp(Number(capo) || 0, 0, 12);
  return STRING_TUNING[string] * Math.pow(2, soundingFret / 12);
}

export function pitchPlanForTab(stringIndex, fret, {
  capo = 0,
  slideToFret = null,
  slideSeconds = 0
} = {}) {
  const startFret = clamp(Number(fret) || 0, 0, 36);
  const frequency = frequencyForTab(stringIndex, startFret, capo);
  const hasSlideTarget = slideToFret !== null
    && slideToFret !== undefined
    && String(slideToFret).trim() !== '';
  const rawTargetFret = hasSlideTarget ? Number(slideToFret) : Number.NaN;
  const targetFret = Number.isFinite(rawTargetFret) ? clamp(rawTargetFret, 0, 36) : startFret;
  const sliding = Number.isFinite(rawTargetFret) && Math.abs(targetFret - startFret) > 1e-9;
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
  const targetValue = Number(toFret);
  if (!Number.isFinite(targetValue)) return [];
  const target = clamp(Math.round(targetValue), 0, 36);
  if (target === start) return [];

  const direction = Math.sign(target - start);
  const fretCount = Math.abs(target - start);
  const duration = clamp(Number(slideSeconds) || 0.25, 0.06, 4);
  const stepDuration = duration / fretCount;

  return Array.from({ length: fretCount }, (_, index) => {
    const fret = start + direction * (index + 1);
    return {
      fret,
      playbackRate: Math.pow(2, (fret - start) / 12),
      atSeconds: stepDuration * (index + 1),
      transitionSeconds: Math.min(0.026, Math.max(0.006, stepDuration * 0.35))
    };
  });
}

export class GuitarAudioEngine {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this.compressor = null;
    this.activeVoices = Array(STRING_TUNING.length).fill(null);
    this.pluckBufferCache = new Map();
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
    masterGain.gain.value = 1.38;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 14;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.22;
    masterGain.connect(compressor);
    compressor.connect(context.destination);

    this.context = context;
    this.masterGain = masterGain;
    this.compressor = compressor;
    return context;
  }

  async ensureReady() {
    const context = this.setup();
    if (!context) return false;
    if (context.state === 'suspended') await context.resume();
    return true;
  }

  bufferKey(frequency, stringIndex, duration) {
    return `${this.context?.sampleRate || 0}:${stringIndex}:${frequency.toFixed(4)}:${duration.toFixed(3)}`;
  }

  pluckBuffer(frequency, stringIndex, duration) {
    const key = this.bufferKey(frequency, stringIndex, duration);
    const cached = this.pluckBufferCache.get(key);
    if (cached) {
      this.pluckBufferCache.delete(key);
      this.pluckBufferCache.set(key, cached);
      return cached;
    }

    const isLowString = stringIndex >= 4;
    const sampleRate = this.context.sampleRate;
    const frameCount = Math.max(1, Math.ceil((duration + 0.04) * sampleRate));
    const delayLength = Math.max(2, Math.round(sampleRate / frequency));
    const delayLine = new Float32Array(delayLength);
    const buffer = this.context.createBuffer(1, frameCount, sampleRate);
    const output = buffer.getChannelData(0);
    const damping = isLowString ? 0.9972 : 0.9958;

    for (let index = 0; index < delayLength; index++) {
      delayLine[index] = (Math.random() * 2 - 1) * Math.sin(Math.PI * (index / delayLength));
    }

    let cursor = 0;
    for (let index = 0; index < frameCount; index++) {
      const next = (cursor + 1) % delayLength;
      const sample = delayLine[cursor];
      output[index] = sample * 0.82;
      delayLine[cursor] = damping * 0.5 * (sample + delayLine[next]);
      cursor = next;
    }

    this.pluckBufferCache.set(key, buffer);
    if (this.pluckBufferCache.size > PLUCK_BUFFER_CACHE_LIMIT) {
      this.pluckBufferCache.delete(this.pluckBufferCache.keys().next().value);
    }
    return buffer;
  }

  connectPluckedString(frequency, stringIndex, startTime, duration, destination, { slideSteps = [] } = {}) {
    const source = this.context.createBufferSource();
    source.buffer = this.pluckBuffer(frequency, stringIndex, duration);
    source.playbackRate.setValueAtTime(1, startTime);

    let previousRate = 1;
    let previousStepTime = startTime;
    for (const step of slideSteps) {
      const stepEnd = startTime + Math.max(0, Number(step.atSeconds) || 0);
      const transitionSeconds = Math.max(0.001, Number(step.transitionSeconds) || 0.01);
      const rampStart = Math.max(previousStepTime, stepEnd - transitionSeconds);
      source.playbackRate.setValueAtTime(previousRate, rampStart);
      source.playbackRate.linearRampToValueAtTime(step.playbackRate, stepEnd);
      previousRate = step.playbackRate;
      previousStepTime = stepEnd;
    }

    source.connect(destination);
    source.start(startTime);
    source.stop(startTime + duration + 0.04);
    return source;
  }

  addPickNoise(startTime, destination, level = 0.082) {
    const sampleRate = this.context.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * 0.018));
    const buffer = this.context.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index++) {
      const ratio = index / length;
      data[index] = (Math.random() * 2 - 1) * Math.pow(1 - ratio, 2.6);
    }
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const highpass = this.context.createBiquadFilter();
    source.buffer = buffer;
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(900, startTime);
    gain.gain.setValueAtTime(level, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.038);
    source.connect(highpass);
    highpass.connect(gain);
    gain.connect(destination);
    source.start(startTime);
    source.stop(startTime + 0.042);
    return source;
  }

  stopStringVoice(stringIndex, releaseSeconds = 0.018) {
    const voice = this.activeVoices[stringIndex];
    if (!voice || !this.context) return;
    this.activeVoices[stringIndex] = null;
    const now = this.context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + releaseSeconds);
    window.setTimeout(() => voice.stop(), (releaseSeconds + 0.05) * 1000);
  }

  stopAll() {
    for (let stringIndex = 0; stringIndex < STRING_TUNING.length; stringIndex++) {
      this.stopStringVoice(stringIndex, 0.025);
    }
  }

  hasActiveSlide(stringIndex, relationId) {
    const voice = this.activeVoices[clamp(Math.round(Number(stringIndex) || 0), 0, STRING_TUNING.length - 1)];
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
    slideRelationId = ''
  } = {}) {
    if (!this.context || !this.masterGain || /^x$/i.test(String(fret))) return;
    const string = clamp(Math.round(Number(stringIndex) || 0), 0, STRING_TUNING.length - 1);
    const {
      startFret,
      targetFret,
      frequency,
      targetFrequency,
      glideSeconds,
      sliding
    } = pitchPlanForTab(string, fret, { capo, slideToFret, slideSeconds });
    const slideSteps = sliding ? frettedSlideSteps(startFret, targetFret, glideSeconds) : [];
    const duration = sliding ? Math.max(1.2, glideSeconds + 0.55) : harmonic ? 1.35 : 1.15;
    const maxPlaybackRate = slideSteps.reduce((value, step) => Math.max(value, step.playbackRate), 1);
    const sourceDuration = duration * maxPlaybackRate + 0.08;
    const now = this.context.currentTime;
    const stringGain = Math.pow(10, stringLevelDb(string) / 20);
    const peakLevel = 0.52 * stringGain * (harmonic ? 0.82 : 1);

    // A guitar string is monophonic along its own length: a new note on the
    // same string damps the previous tail. Other strings keep ringing because
    // activeVoices is indexed independently by string.
    this.stopStringVoice(string);

    const sourceBus = this.context.createGain();
    const bodyLow = this.context.createBiquadFilter();
    const bodyMid = this.context.createBiquadFilter();
    const bodyPresence = this.context.createBiquadFilter();
    const bodyHighCut = this.context.createBiquadFilter();
    const noteGain = this.context.createGain();

    // Longer, convex-down decay: fast pick transient followed by a much slower
    // exponential tail instead of a short straight fade.
    noteGain.gain.setValueAtTime(0.0001, now);
    noteGain.gain.exponentialRampToValueAtTime(peakLevel, now + 0.004);
    noteGain.gain.exponentialRampToValueAtTime(peakLevel * (harmonic ? 0.76 : 0.64), now + 0.055);
    noteGain.gain.exponentialRampToValueAtTime(peakLevel * (harmonic ? 0.40 : 0.31), now + duration * 0.34);
    noteGain.gain.exponentialRampToValueAtTime(peakLevel * (harmonic ? 0.16 : 0.11), now + duration * 0.72);
    noteGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    bodyLow.type = 'peaking';
    bodyLow.frequency.setValueAtTime(string >= 4 ? 105 : 160, now);
    bodyLow.Q.setValueAtTime(0.82, now);
    bodyLow.gain.setValueAtTime(harmonic ? -2.4 : string >= 4 ? 3.4 : 1.9, now);
    bodyMid.type = 'peaking';
    bodyMid.frequency.setValueAtTime(320, now);
    bodyMid.Q.setValueAtTime(1.05, now);
    bodyMid.gain.setValueAtTime(harmonic ? -0.8 : 2.2, now);
    bodyPresence.type = 'peaking';
    bodyPresence.frequency.setValueAtTime(clamp(frequency * (harmonic ? 7.6 : 5.8), 1450, harmonic ? 6200 : 3900), now);
    if (sliding) {
      bodyPresence.frequency.exponentialRampToValueAtTime(
        clamp(targetFrequency * (harmonic ? 7.6 : 5.8), 1450, harmonic ? 6200 : 3900),
        now + glideSeconds
      );
    }
    bodyPresence.Q.setValueAtTime(harmonic ? 1.15 : 0.86, now);
    bodyPresence.gain.setValueAtTime(harmonic ? 4.2 : 1.7, now);
    bodyHighCut.type = 'lowpass';
    bodyHighCut.frequency.setValueAtTime(clamp(frequency * (harmonic ? 16 : 12), 2500, harmonic ? 9800 : 7600), now);
    bodyHighCut.frequency.exponentialRampToValueAtTime(
      clamp((sliding ? targetFrequency : frequency) * (harmonic ? 9 : 5.2), 1200, harmonic ? 8200 : 5600),
      now + duration
    );
    bodyHighCut.Q.setValueAtTime(harmonic ? 0.8 : 0.55, now);

    const stringSource = this.connectPluckedString(frequency, string, now, sourceDuration, sourceBus, { slideSteps });
    const pickSource = this.addPickNoise(now, sourceBus, harmonic ? 0.045 : 0.082);
    sourceBus.connect(bodyLow);
    bodyLow.connect(bodyMid);
    bodyMid.connect(bodyPresence);
    bodyPresence.connect(bodyHighCut);
    bodyHighCut.connect(noteGain);
    noteGain.connect(this.masterGain);

    let stopped = false;
    let cleanupTimer = null;
    const voice = {
      gain: noteGain,
      slideRelationId: sliding ? String(slideRelationId || '') : '',
      stop: () => {
        if (stopped) return;
        stopped = true;
        if (cleanupTimer) clearTimeout(cleanupTimer);
        try { stringSource.stop(); } catch {}
        try { pickSource.stop(); } catch {}
        try { sourceBus.disconnect(); } catch {}
        try { bodyLow.disconnect(); } catch {}
        try { bodyMid.disconnect(); } catch {}
        try { bodyPresence.disconnect(); } catch {}
        try { bodyHighCut.disconnect(); } catch {}
        try { noteGain.disconnect(); } catch {}
        if (this.activeVoices[string] === voice) this.activeVoices[string] = null;
      }
    };
    this.activeVoices[string] = voice;
    cleanupTimer = window.setTimeout(() => voice.stop(), (duration + 0.16) * 1000);
  }
}

export function installAudioEngine() {
  if (typeof window === 'undefined') return null;
  if (!installedEngine) installedEngine = new GuitarAudioEngine();
  const engine = installedEngine;
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

export function getAudioEngine() {
  return installedEngine;
}
