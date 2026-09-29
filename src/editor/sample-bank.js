export const SAMPLE_DURATION_SECONDS = 3;
export const SAMPLE_ATTACK_PREROLL_SECONDS = 0.02;
export const SAMPLE_FRETS_BY_STRING = Object.freeze([
  Object.freeze([0, 1, 3, 5, 7, 8, 10]),
  Object.freeze([0, 3, 5, 6, 8, 10]),
  Object.freeze([0, 1, 2, 4, 5, 7, 9, 10]),
  Object.freeze([0, 2, 3, 5, 7, 9, 10]),
  Object.freeze([0, 2, 3, 5, 7, 8, 10]),
  Object.freeze([0, 1, 3, 5, 7, 8, 10])
]);
const SAMPLE_START_INDEX = SAMPLE_FRETS_BY_STRING.map((_, index) =>
  SAMPLE_FRETS_BY_STRING.slice(0, index).reduce((sum, frets) => sum + frets.length, 0)
);
export const SAMPLE_COUNT = SAMPLE_FRETS_BY_STRING.reduce((sum, frets) => sum + frets.length, 0);
export const SAMPLE_BANK_URL = new URL('../../assets/audio/guitar-samples.m4a?rev=20260929b', import.meta.url).href;
const MIN_BANK_DURATION = SAMPLE_COUNT * SAMPLE_DURATION_SECONDS - 0.05;

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

export function samplePlanForTab(stringIndex, fret, { capo = 0 } = {}) {
  const string = clamp(Math.round(Number(stringIndex) || 0), 0, SAMPLE_FRETS_BY_STRING.length - 1);
  const cleanFret = clamp(Number(fret) || 0, 0, 36);
  const soundingFret = cleanFret + clamp(Number(capo) || 0, 0, 12);
  const anchors = SAMPLE_FRETS_BY_STRING[string];
  let anchorIndex = 0;
  let distance = Math.abs(soundingFret - anchors[0]);
  for (let index = 1; index < anchors.length; index++) {
    const nextDistance = Math.abs(soundingFret - anchors[index]);
    if (nextDistance < distance) {
      anchorIndex = index;
      distance = nextDistance;
    }
  }
  const anchorFret = anchors[anchorIndex];
  const sampleIndex = SAMPLE_START_INDEX[string] + anchorIndex;
  const semitoneShift = soundingFret - anchorFret;
  return {
    stringIndex: string,
    fret: cleanFret,
    soundingFret,
    anchorFret,
    sampleIndex,
    offsetSeconds: sampleIndex * SAMPLE_DURATION_SECONDS,
    semitoneShift,
    playbackRate: Math.pow(2, semitoneShift / 12)
  };
}

export class RecordedGuitarSampleBank {
  constructor() {
    this.buffer = null;
    this.bytes = null;
    this.fetchPromise = null;
    this.decodePromise = null;
  }

  preload() {
    if (this.buffer || this.bytes) return Promise.resolve(true);
    if (this.fetchPromise) return this.fetchPromise;
    if (typeof fetch !== 'function') return Promise.resolve(false);
    this.fetchPromise = fetch(SAMPLE_BANK_URL, { cache: 'force-cache' })
      .then(response => {
        if (!response.ok) throw new Error(`sample bank request failed: ${response.status}`);
        return response.arrayBuffer();
      })
      .then(bytes => { this.bytes = bytes; return true; })
      .catch(error => {
        console.error('Recorded guitar sample bank failed to preload.', error);
        return false;
      });
    return this.fetchPromise;
  }

  async decode(context) {
    if (this.buffer) return true;
    if (this.decodePromise) return this.decodePromise;
    if (!await this.preload() || !this.bytes) return false;
    const encoded = this.bytes.slice(0);
    this.decodePromise = context.decodeAudioData(encoded)
      .then(buffer => {
        if (buffer.duration < MIN_BANK_DURATION) {
          throw new Error(`sample bank is too short: ${buffer.duration.toFixed(3)}s`);
        }
        this.buffer = buffer;
        this.bytes = null;
        return true;
      })
      .catch(error => {
        console.error('Recorded guitar sample bank failed to decode.', error);
        return false;
      });
    return this.decodePromise;
  }
}
