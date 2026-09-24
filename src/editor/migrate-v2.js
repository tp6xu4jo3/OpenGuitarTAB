import { createDocumentV3, isDocumentV3, normalizeDocumentV3, normalizeFraction } from './model.js';

export const LEGACY_STRINGS = 6;
export const LEGACY_MEASURES_PER_ROW = 4;
export const LEGACY_SLOTS_PER_BEAT = 4;

function normalizeBeats(value) {
  return Number(value) === 3 ? 3 : 4;
}

function legacyTimeSignature(song) {
  const beats = normalizeBeats(song?.beatsPerMeasure);
  const fallback = { numerator: beats, denominator: 4 };
  const match = String(song?.meter || '').trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return fallback;

  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  const validDenominators = new Set([1, 2, 4, 8, 16, 32, 64]);
  if (!Number.isInteger(numerator) || numerator <= 0 || !validDenominators.has(denominator)) return fallback;

  const quarterNoteBeats = (numerator * 4) / denominator;
  if (Math.abs(quarterNoteBeats - beats) > 1e-9) return fallback;
  return { numerator, denominator };
}

function clampMeasureCount(value) {
  const count = Number(value);
  return Number.isInteger(count)
    ? Math.max(1, Math.min(LEGACY_MEASURES_PER_ROW, count))
    : LEGACY_MEASURES_PER_ROW;
}

function noteValue(row, string, position) {
  return String(row?.[string]?.[position] ?? '').trim();
}

function deterministicMeasureId(rowIndex, measureIndex) {
  return `m-${rowIndex + 1}-${measureIndex + 1}`;
}

function deterministicEventId(rowIndex, measureIndex, localPosition) {
  return `e-${rowIndex + 1}-${measureIndex + 1}-${localPosition}`;
}

function deterministicNoteId(rowIndex, measureIndex, localPosition, string) {
  return `n-${rowIndex + 1}-${measureIndex + 1}-${localPosition}-${string + 1}`;
}

function durationForOnset({ rhythm, absolutePosition, localPosition, measureSlots, onsets }) {
  const explicit = Number(rhythm?.[absolutePosition]);
  if (Number.isInteger(explicit) && explicit > 0) return Math.min(measureSlots, explicit);
  const currentIndex = onsets.indexOf(localPosition);
  const next = currentIndex >= 0 ? onsets[currentIndex + 1] : undefined;
  return Math.max(1, Math.min(
    measureSlots,
    next == null ? measureSlots - localPosition : next - localPosition
  ));
}

export function legacyMeasureToV3(song, rowIndex, measureIndex, { measureId } = {}) {
  const beats = normalizeBeats(song?.beatsPerMeasure);
  const measureSlots = beats * LEGACY_SLOTS_PER_BEAT;
  const row = song?.rows?.[rowIndex] || [];
  const rhythm = song?.rhythmRows?.[rowIndex] || {};
  const start = measureIndex * measureSlots;
  const onsets = [];

  for (let localPosition = 0; localPosition < measureSlots; localPosition++) {
    const absolutePosition = start + localPosition;
    if (Array.from({ length: LEGACY_STRINGS }, (_, string) => noteValue(row, string, absolutePosition))
      .some(Boolean)) onsets.push(localPosition);
  }

  const events = onsets.map(localPosition => {
    const absolutePosition = start + localPosition;
    const durationSlots = durationForOnset({ rhythm, absolutePosition, localPosition, measureSlots, onsets });
    const notes = [];
    for (let string = 0; string < LEGACY_STRINGS; string++) {
      const fret = noteValue(row, string, absolutePosition);
      if (fret === '') continue;
      notes.push({
        id: deterministicNoteId(rowIndex, measureIndex, localPosition, string),
        string,
        fret,
        techniques: []
      });
    }
    return {
      id: deterministicEventId(rowIndex, measureIndex, localPosition),
      at: normalizeFraction([localPosition, LEGACY_SLOTS_PER_BEAT]),
      duration: normalizeFraction([durationSlots, LEGACY_SLOTS_PER_BEAT]),
      notes,
      marks: []
    };
  });

  return {
    id: String(measureId || deterministicMeasureId(rowIndex, measureIndex)),
    timeSignature: legacyTimeSignature(song),
    events,
    groups: []
  };
}

export function migrateSongToDocumentV3(song) {
  if (isDocumentV3(song?.document)) return normalizeDocumentV3(song.document);

  const rows = Array.isArray(song?.rows) && song.rows.length ? song.rows : [[]];
  const measures = [];
  const systemBreakAfter = [];
  rows.forEach((row, rowIndex) => {
    const count = clampMeasureCount(song?.rowMeasureCounts?.[rowIndex]);
    for (let measureIndex = 0; measureIndex < count; measureIndex++) {
      measures.push(legacyMeasureToV3(song, rowIndex, measureIndex));
    }
    if (measures.length) systemBreakAfter.push(measures.at(-1).id);
  });

  return createDocumentV3({ measures, relations: [], layout: { systemBreakAfter } });
}

export function ensureSongDocumentV3(song) {
  if (!song || typeof song !== 'object') return createDocumentV3();
  song.document = migrateSongToDocumentV3(song);
  delete song.rows;
  delete song.rhythmRows;
  delete song.rowMeasureCounts;
  return song.document;
}
