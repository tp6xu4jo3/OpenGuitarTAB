export const DOCUMENT_VERSION = 3;
export const STRING_COUNT = 6;

export function cloneValue(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function gcd(a, b) {
  a = Math.abs(Math.trunc(a));
  b = Math.abs(Math.trunc(b));
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export function normalizeFraction(value, fallback = [0, 1]) {
  const source = Array.isArray(value) && value.length >= 2 ? value : fallback;
  let numerator = Number(source[0]);
  let denominator = Number(source[1]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    [numerator, denominator] = fallback;
  }
  numerator = Math.trunc(numerator);
  denominator = Math.trunc(denominator) || 1;
  if (denominator < 0) {
    numerator *= -1;
    denominator *= -1;
  }
  const divisor = gcd(numerator, denominator);
  return [numerator / divisor, denominator / divisor];
}

export function fractionToNumber(value) {
  const [numerator, denominator] = normalizeFraction(value);
  return numerator / denominator;
}

export function addFractions(left, right) {
  const [a, b] = normalizeFraction(left);
  const [c, d] = normalizeFraction(right);
  return normalizeFraction([a * d + c * b, b * d]);
}

export function compareFractions(left, right) {
  const [a, b] = normalizeFraction(left);
  const [c, d] = normalizeFraction(right);
  return a * d - c * b;
}

export function fractionKey(value) {
  const [numerator, denominator] = normalizeFraction(value);
  return `${numerator}/${denominator}`;
}

export function createId(prefix = 'id') {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return `${prefix}-${random}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isDocumentV3(document) {
  return Boolean(document && document.version === DOCUMENT_VERSION && Array.isArray(document.measures));
}

function normalizeTimeSignature(value) {
  const numerator = Math.max(1, Math.trunc(Number(value?.numerator) || 4));
  const denominator = Math.max(1, Math.trunc(Number(value?.denominator) || 4));
  return { numerator, denominator };
}

function normalizeNote(note, idFactory) {
  const string = Math.max(0, Math.min(STRING_COUNT - 1, Math.trunc(Number(note?.string) || 0)));
  const fret = String(note?.fret ?? '');
  return {
    ...(note && typeof note === 'object' ? cloneValue(note) : {}),
    id: String(note?.id || idFactory('n')),
    string,
    fret,
    techniques: Array.isArray(note?.techniques) ? cloneValue(note.techniques) : []
  };
}

function normalizeEvent(event, idFactory) {
  const duration = normalizeFraction(event?.duration, [1, 1]);
  return {
    ...(event && typeof event === 'object' ? cloneValue(event) : {}),
    id: String(event?.id || idFactory('e')),
    at: normalizeFraction(event?.at, [0, 1]),
    duration: duration[0] > 0 ? duration : [1, 1],
    notes: Array.isArray(event?.notes) ? event.notes.map(note => normalizeNote(note, idFactory)) : [],
    marks: Array.isArray(event?.marks) ? cloneValue(event.marks) : []
  };
}

function normalizeMeasure(measure, idFactory) {
  const events = Array.isArray(measure?.events)
    ? measure.events.map(event => normalizeEvent(event, idFactory))
    : [];
  events.sort((left, right) => compareFractions(left.at, right.at) || String(left.id).localeCompare(String(right.id)));
  return {
    ...(measure && typeof measure === 'object' ? cloneValue(measure) : {}),
    id: String(measure?.id || idFactory('m')),
    timeSignature: normalizeTimeSignature(measure?.timeSignature),
    events,
    groups: Array.isArray(measure?.groups) ? cloneValue(measure.groups) : []
  };
}

export function createDocumentV3({ measures = [], relations = [], layout = {}, idFactory = createId } = {}) {
  const sourceMeasures = measures.length ? measures : [{ id: idFactory('m'), timeSignature: { numerator: 4, denominator: 4 }, events: [], groups: [] }];
  return normalizeDocumentV3({
    version: DOCUMENT_VERSION,
    measures: sourceMeasures,
    relations,
    layout
  }, { idFactory });
}

export function normalizeDocumentV3(document, { idFactory = createId } = {}) {
  const source = document && typeof document === 'object' ? cloneValue(document) : {};
  const measures = Array.isArray(source.measures)
    ? source.measures.map(measure => normalizeMeasure(measure, idFactory))
    : [];
  if (!measures.length) measures.push(normalizeMeasure({}, idFactory));

  const measureIds = new Set(measures.map(measure => measure.id));
  const rawBreaks = Array.isArray(source.layout?.systemBreakAfter) ? source.layout.systemBreakAfter : [];
  const systemBreakAfter = [...new Set(rawBreaks.map(String).filter(id => measureIds.has(id)))];

  return {
    ...source,
    version: DOCUMENT_VERSION,
    measures,
    relations: Array.isArray(source.relations) ? cloneValue(source.relations) : [],
    layout: {
      ...(source.layout && typeof source.layout === 'object' ? source.layout : {}),
      systemBreakAfter
    }
  };
}

export function relationNoteIds(relation) {
  const ids = [];
  if (relation?.fromNoteId) ids.push(String(relation.fromNoteId));
  if (relation?.toNoteId) ids.push(String(relation.toNoteId));
  if (Array.isArray(relation?.noteIds)) ids.push(...relation.noteIds.map(String));
  return [...new Set(ids)];
}

export function indexDocument(document) {
  const measureById = new Map();
  const eventById = new Map();
  const noteById = new Map();
  const eventLocation = new Map();
  const noteLocation = new Map();

  for (let measureIndex = 0; measureIndex < (document?.measures?.length || 0); measureIndex++) {
    const measure = document.measures[measureIndex];
    measureById.set(measure.id, { measure, measureIndex });
    for (let eventIndex = 0; eventIndex < (measure.events?.length || 0); eventIndex++) {
      const event = measure.events[eventIndex];
      eventById.set(event.id, event);
      eventLocation.set(event.id, { measureId: measure.id, measureIndex, eventIndex });
      for (let noteIndex = 0; noteIndex < (event.notes?.length || 0); noteIndex++) {
        const note = event.notes[noteIndex];
        noteById.set(note.id, note);
        noteLocation.set(note.id, { measureId: measure.id, measureIndex, eventId: event.id, eventIndex, noteIndex });
      }
    }
  }

  return { measureById, eventById, noteById, eventLocation, noteLocation };
}
