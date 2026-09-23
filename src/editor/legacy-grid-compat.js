import { buildSystems } from './layout.js';
import {
  documentToLegacyProjection,
  LEGACY_MEASURES_PER_ROW,
  LEGACY_SLOTS_PER_BEAT as MIGRATION_SLOTS_PER_BEAT,
  LEGACY_STRINGS
} from './migrate-v2.js';

export const LEGACY_STRING_COUNT = LEGACY_STRINGS;
export const LEGACY_SLOTS_PER_BEAT = MIGRATION_SLOTS_PER_BEAT;
export const LEGACY_MAX_MEASURES_PER_SYSTEM = LEGACY_MEASURES_PER_ROW;

export function legacyBeatsPerMeasure(song) {
  return Number(song?.beatsPerMeasure) === 3 ? 3 : 4;
}

export function normalizeLegacyMeasureCount(value) {
  const count = Number(value);
  return Number.isInteger(count)
    ? Math.max(1, Math.min(LEGACY_MAX_MEASURES_PER_SYSTEM, count))
    : LEGACY_MAX_MEASURES_PER_SYSTEM;
}

export function projectSystemCountsToLegacySong(song, documentModel) {
  if (!song) return [];
  const systems = documentModel ? buildSystems(documentModel) : null;
  if (systems?.length) {
    song.rowMeasureCounts = systems.map(system => normalizeLegacyMeasureCount(system.length));
    return song.rowMeasureCounts;
  }

  const rowCount = song.rows?.length || 1;
  song.rowMeasureCounts = Array.from(
    { length: rowCount },
    (_, index) => normalizeLegacyMeasureCount(song.rowMeasureCounts?.[index])
  );
  return song.rowMeasureCounts;
}

export function legacyRowMeasureCount(song, documentModel, rowIndex) {
  const systems = documentModel ? buildSystems(documentModel) : null;
  if (systems?.[rowIndex]?.length) return normalizeLegacyMeasureCount(systems[rowIndex].length);
  return normalizeLegacyMeasureCount(projectSystemCountsToLegacySong(song, documentModel)[rowIndex]);
}

export function legacyRowPositionCount(song, documentModel, rowIndex) {
  return legacyRowMeasureCount(song, documentModel, rowIndex)
    * legacyBeatsPerMeasure(song)
    * LEGACY_SLOTS_PER_BEAT;
}

export function legacyRowStepCount(song, documentModel, rowIndex) {
  return legacyRowMeasureCount(song, documentModel, rowIndex)
    * legacyBeatsPerMeasure(song)
    * 2;
}

export function ensureCompatibilityRow(song, rowIndex) {
  if (!song) return null;
  if (!Array.isArray(song.rows)) song.rows = [];
  while (song.rows.length <= rowIndex) {
    song.rows.push(Array.from({ length: LEGACY_STRING_COUNT }, () => []));
  }
  if (!Array.isArray(song.rows[rowIndex]) || song.rows[rowIndex].length !== LEGACY_STRING_COUNT) {
    song.rows[rowIndex] = Array.from({ length: LEGACY_STRING_COUNT }, () => []);
  }
  return song.rows[rowIndex];
}

export function rhythmOnsetsFromLegacyRow(row, beats = 4) {
  const measureSlots = beats * LEGACY_SLOTS_PER_BEAT;
  const positions = Math.max(...(row || []).map(values => values?.length || 0), measureSlots);
  const onsets = [];

  for (let position = 0; position < positions; position++) {
    let lowestString = -1;
    for (let string = 0; string < LEGACY_STRING_COUNT; string++) {
      if (String(row?.[string]?.[position] ?? '').trim() !== '') lowestString = string;
    }
    if (lowestString >= 0) onsets.push({ position, duration: 1, lowestString });
  }

  onsets.forEach((onset, index) => {
    const measureEnd = (Math.floor(onset.position / measureSlots) + 1) * measureSlots;
    const next = onsets[index + 1];
    onset.duration = Math.max(
      1,
      Math.min(next && next.position < measureEnd ? next.position - onset.position : measureEnd - onset.position, measureSlots)
    );
  });
  return onsets;
}

export function rhythmRowFromLegacyRow(row, beats = 4) {
  const rhythm = {};
  rhythmOnsetsFromLegacyRow(row, beats).forEach(onset => {
    rhythm[onset.position] = onset.duration;
  });
  return rhythm;
}

export function projectDocumentToLegacySong(song, documentModel, { touch = true } = {}) {
  if (!song || !documentModel) return { ok: false, projection: null };
  const projection = documentToLegacyProjection(documentModel);
  if (projection.structuralLossy) return { ok: false, projection };

  song.rows = projection.rows;
  song.rhythmRows = projection.rhythmRows;
  song.rowMeasureCounts = projection.rowMeasureCounts;
  song.beatsPerMeasure = projection.beatsPerMeasure;
  song.meter = projection.meter;
  if (touch) song.updatedAt = Date.now();
  return { ok: true, projection };
}
