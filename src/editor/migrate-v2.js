import {
  cloneValue,
  compareFractions,
  createDocumentV3,
  fractionKey,
  indexDocument,
  isDocumentV3,
  normalizeDocumentV3,
  normalizeFraction,
  relationNoteIds
} from './model.js';

export const LEGACY_STRINGS = 6;
export const LEGACY_MEASURES_PER_ROW = 4;
export const LEGACY_SLOTS_PER_BEAT = 4;

function normalizeBeats(value) {
  return Number(value) === 3 ? 3 : 4;
}

function clampMeasureCount(value) {
  const count = Number(value);
  return Number.isInteger(count) ? Math.max(1, Math.min(LEGACY_MEASURES_PER_ROW, count)) : LEGACY_MEASURES_PER_ROW;
}

function noteValue(row, string, position) {
  const value = String(row?.[string]?.[position] ?? '').trim();
  return value;
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

function durationForOnset({ row, rhythm, absolutePosition, localPosition, measureSlots, onsets }) {
  const explicit = Number(rhythm?.[absolutePosition]);
  if (Number.isInteger(explicit) && explicit > 0) return Math.min(measureSlots, explicit);
  const currentIndex = onsets.indexOf(localPosition);
  const next = currentIndex >= 0 ? onsets[currentIndex + 1] : undefined;
  return Math.max(1, Math.min(measureSlots, next == null ? measureSlots - localPosition : next - localPosition));
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
    let filled = false;
    for (let string = 0; string < LEGACY_STRINGS; string++) {
      if (noteValue(row, string, absolutePosition) !== '') {
        filled = true;
        break;
      }
    }
    if (filled) onsets.push(localPosition);
  }

  const events = onsets.map(localPosition => {
    const absolutePosition = start + localPosition;
    const durationSlots = durationForOnset({ row, rhythm, absolutePosition, localPosition, measureSlots, onsets });
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
    timeSignature: { numerator: beats, denominator: 4 },
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
    if (measures.length) systemBreakAfter.push(measures[measures.length - 1].id);
  });

  return createDocumentV3({
    measures,
    relations: [],
    layout: { systemBreakAfter }
  });
}

export function ensureSongDocumentV3(song) {
  if (!song || typeof song !== 'object') return createDocumentV3();
  song.document = migrateSongToDocumentV3(song);
  return song.document;
}

function buildSystems(document, maxMeasures = LEGACY_MEASURES_PER_ROW) {
  const breaks = new Set(document?.layout?.systemBreakAfter || []);
  const systems = [];
  let current = [];
  for (const measure of document?.measures || []) {
    current.push(measure);
    if (breaks.has(measure.id) || current.length >= maxMeasures) {
      systems.push(current);
      current = [];
    }
  }
  if (current.length) systems.push(current);
  return systems.length ? systems : [[]];
}

function mergeLegacyMeasure(existingMeasure, generatedMeasure) {
  if (!existingMeasure) return generatedMeasure;
  const existingEventsByAt = new Map((existingMeasure.events || []).map(event => [fractionKey(event.at), event]));

  const events = generatedMeasure.events.map(generatedEvent => {
    const existingEvent = existingEventsByAt.get(fractionKey(generatedEvent.at));
    if (!existingEvent) return generatedEvent;
    const existingNotesByString = new Map((existingEvent.notes || []).map(note => [Number(note.string), note]));
    const notes = generatedEvent.notes.map(generatedNote => {
      const existingNote = existingNotesByString.get(Number(generatedNote.string));
      if (!existingNote) return generatedNote;
      return {
        ...cloneValue(existingNote),
        string: generatedNote.string,
        fret: generatedNote.fret,
        techniques: Array.isArray(existingNote.techniques) ? cloneValue(existingNote.techniques) : []
      };
    });
    return {
      ...cloneValue(existingEvent),
      at: generatedEvent.at,
      duration: generatedEvent.duration,
      notes,
      marks: Array.isArray(existingEvent.marks) ? cloneValue(existingEvent.marks) : []
    };
  });

  const liveEventIds = new Set(events.map(event => event.id));
  const groups = (existingMeasure.groups || []).filter(group =>
    !Array.isArray(group?.eventIds) || group.eventIds.every(id => liveEventIds.has(String(id)))
  );

  return {
    ...cloneValue(existingMeasure),
    id: existingMeasure.id,
    timeSignature: generatedMeasure.timeSignature,
    events,
    groups: cloneValue(groups)
  };
}

function remapBreaksFromLegacy(song, measures) {
  const breaks = [];
  let offset = 0;
  const rowCount = Array.isArray(song?.rows) && song.rows.length ? song.rows.length : 1;
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const count = clampMeasureCount(song?.rowMeasureCounts?.[rowIndex]);
    offset += count;
    const measure = measures[offset - 1];
    if (measure) breaks.push(measure.id);
  }
  return breaks;
}

export function reconcileLegacySongToDocument(song, existingDocument = song?.document) {
  const generated = migrateSongToDocumentV3({ ...song, document: undefined });
  const existing = isDocumentV3(existingDocument) ? normalizeDocumentV3(existingDocument) : null;
  if (!existing) return generated;

  const measures = generated.measures.map((measure, index) =>
    mergeLegacyMeasure(existing.measures[index], measure)
  );
  const liveNotes = new Set();
  measures.forEach(measure => measure.events.forEach(event => event.notes.forEach(note => liveNotes.add(note.id))));
  const relations = (existing.relations || []).filter(relation => relationNoteIds(relation).every(id => liveNotes.has(id)));

  return normalizeDocumentV3({
    ...cloneValue(existing),
    measures,
    relations,
    layout: {
      ...(existing.layout || {}),
      systemBreakAfter: remapBreaksFromLegacy(song, measures)
    }
  });
}

export function reconcileLegacyMeasure(song, existingDocument, rowIndex, measureIndex) {
  const existing = isDocumentV3(existingDocument) ? normalizeDocumentV3(existingDocument) : migrateSongToDocumentV3(song);
  const systems = buildSystems(existing);
  const target = systems?.[rowIndex]?.[measureIndex];
  if (!target) return existing;

  const generated = legacyMeasureToV3(song, rowIndex, measureIndex, { measureId: target.id });
  const merged = mergeLegacyMeasure(target, generated);
  const targetIndex = existing.measures.findIndex(measure => measure.id === target.id);
  if (targetIndex < 0) return existing;

  const measures = existing.measures.slice();
  measures[targetIndex] = merged;
  const liveNotes = new Set();
  measures.forEach(measure => measure.events.forEach(event => event.notes.forEach(note => liveNotes.add(note.id))));
  const relations = (existing.relations || []).filter(relation => relationNoteIds(relation).every(id => liveNotes.has(id)));

  return normalizeDocumentV3({ ...existing, measures, relations });
}

function fractionToLegacySlots(value) {
  const [numerator, denominator] = normalizeFraction(value);
  const scaled = numerator * LEGACY_SLOTS_PER_BEAT / denominator;
  return Number.isInteger(scaled) ? scaled : null;
}

export function documentToLegacyProjection(document) {
  const normalized = normalizeDocumentV3(document);
  const systems = buildSystems(normalized);
  const firstSignature = normalized.measures[0]?.timeSignature || { numerator: 4, denominator: 4 };
  const beatsPerMeasure = normalizeBeats(firstSignature.numerator);
  const measureSlots = beatsPerMeasure * LEGACY_SLOTS_PER_BEAT;
  const positionsPerRow = LEGACY_MEASURES_PER_ROW * measureSlots;
  let lossy = false;

  const rows = systems.map(() => Array.from({ length: LEGACY_STRINGS }, () => Array(positionsPerRow).fill('')));
  const rhythmRows = systems.map(() => ({}));
  const rowMeasureCounts = systems.map(system => Math.max(1, Math.min(LEGACY_MEASURES_PER_ROW, system.length)));

  systems.forEach((system, rowIndex) => {
    system.slice(0, LEGACY_MEASURES_PER_ROW).forEach((measure, measureIndex) => {
      if (measure.timeSignature?.numerator !== beatsPerMeasure || Number(measure.timeSignature?.denominator) !== 4) lossy = true;
      for (const event of measure.events || []) {
        const localPosition = fractionToLegacySlots(event.at);
        const durationSlots = fractionToLegacySlots(event.duration);
        if (localPosition == null || durationSlots == null || localPosition < 0 || localPosition >= measureSlots) {
          lossy = true;
          continue;
        }
        const absolutePosition = measureIndex * measureSlots + localPosition;
        for (const note of event.notes || []) {
          const string = Number(note.string);
          if (!Number.isInteger(string) || string < 0 || string >= LEGACY_STRINGS) {
            lossy = true;
            continue;
          }
          rows[rowIndex][string][absolutePosition] = String(note.fret ?? '');
        }
        rhythmRows[rowIndex][absolutePosition] = Math.max(1, Math.min(measureSlots, durationSlots));
      }
    });
  });

  return {
    rows,
    rhythmRows,
    rowMeasureCounts,
    beatsPerMeasure,
    meter: `${beatsPerMeasure}/4`,
    lossy
  };
}

export function legacyLocationForMeasure(document, measureId) {
  const systems = buildSystems(normalizeDocumentV3(document));
  for (let rowIndex = 0; rowIndex < systems.length; rowIndex++) {
    const measureIndex = systems[rowIndex].findIndex(measure => measure.id === measureId);
    if (measureIndex >= 0) return { rowIndex, measureIndex };
  }
  return null;
}

export function legacyMeasureIdAt(document, rowIndex, measureIndex) {
  return buildSystems(normalizeDocumentV3(document))?.[rowIndex]?.[measureIndex]?.id || null;
}

export function pruneDanglingRelations(document) {
  const normalized = normalizeDocumentV3(document);
  const { noteById } = indexDocument(normalized);
  normalized.relations = normalized.relations.filter(relation => relationNoteIds(relation).every(id => noteById.has(id)));
  return normalized;
}
