export const DOCUMENT_VERSION = 3;
export const STRING_COUNT = 6;
export const ARTIFICIAL_HARMONIC_OFFSET = 12;

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

function normalizeOwnedEntity(value, prefix, idFactory) {
  const source = value && typeof value === 'object' ? cloneValue(value) : {};
  source.id = String(source.id || idFactory(prefix));
  return source;
}

function normalizeTechnique(technique, idFactory, fallbackFret = '') {
  const normalized = normalizeOwnedEntity(technique, 't', idFactory);
  if (normalized.type !== 'harmonic') return normalized;
  let touchFret = Number(normalized.touchFret);
  if (!Number.isFinite(touchFret)) {
    const baseFret = Number(fallbackFret);
    if (Number.isFinite(baseFret)) touchFret = baseFret + ARTIFICIAL_HARMONIC_OFFSET;
  }
  if (Number.isFinite(touchFret)) normalized.touchFret = Math.max(ARTIFICIAL_HARMONIC_OFFSET, Math.trunc(touchFret));
  else delete normalized.touchFret;
  delete normalized.kind;
  delete normalized.baseFret;
  delete normalized.fret;
  return normalized;
}

export function harmonicTechnique(note) {
  return (note?.techniques || []).find(technique => technique?.type === 'harmonic' && Number.isFinite(Number(technique?.touchFret))) || null;
}

export function noteBaseFret(note) {
  const fret = String(note?.fret ?? '');
  if (fret !== '') return fret;
  const harmonic = harmonicTechnique(note);
  if (harmonic) return String(Math.max(0, Math.trunc(Number(harmonic.touchFret)) - ARTIFICIAL_HARMONIC_OFFSET));
  return '';
}

export function noteSoundingFret(note) {
  const harmonic = harmonicTechnique(note);
  if (harmonic) return String(Math.max(0, Math.trunc(Number(harmonic.touchFret))));
  return String(note?.fret ?? '');
}

export function noteDisplayValue(note) {
  const harmonic = harmonicTechnique(note);
  if (!harmonic) return String(note?.fret ?? '');
  return `${noteBaseFret(note)}<${Math.trunc(Number(harmonic.touchFret))}>`;
}

function normalizeNote(note, idFactory) {
  const string = Math.max(0, Math.min(STRING_COUNT - 1, Math.trunc(Number(note?.string) || 0)));
  const sourceFret = String(note?.fret ?? '');
  const techniques = Array.isArray(note?.techniques)
    ? note.techniques.map(technique => normalizeTechnique(technique, idFactory, sourceFret))
    : [];
  const harmonic = techniques.find(technique => technique.type === 'harmonic' && Number.isFinite(Number(technique.touchFret)));
  const canonicalFret = sourceFret !== ''
    ? sourceFret
    : harmonic
      ? String(Math.max(0, Math.trunc(Number(harmonic.touchFret)) - ARTIFICIAL_HARMONIC_OFFSET))
      : '';
  return {
    ...(note && typeof note === 'object' ? cloneValue(note) : {}),
    id: String(note?.id || idFactory('n')),
    string,
    fret: canonicalFret,
    techniques
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
    marks: Array.isArray(event?.marks) ? event.marks.map(mark => normalizeOwnedEntity(mark, 'mk', idFactory)) : []
  };
}

function normalizeGroup(group, idFactory) {
  const normalized = normalizeOwnedEntity(group, 'g', idFactory);
  if (Array.isArray(normalized.eventIds)) normalized.eventIds = normalized.eventIds.map(String);
  return normalized;
}

function normalizeMeasure(measure, idFactory) {
  const events = Array.isArray(measure?.events) ? measure.events.map(event => normalizeEvent(event, idFactory)) : [];
  events.sort((left, right) => compareFractions(left.at, right.at) || String(left.id).localeCompare(String(right.id)));
  return {
    ...(measure && typeof measure === 'object' ? cloneValue(measure) : {}),
    id: String(measure?.id || idFactory('m')),
    timeSignature: normalizeTimeSignature(measure?.timeSignature),
    events,
    groups: Array.isArray(measure?.groups) ? measure.groups.map(group => normalizeGroup(group, idFactory)) : []
  };
}

function normalizeRelation(relation, idFactory) {
  const normalized = normalizeOwnedEntity(relation, 'r', idFactory);
  if (normalized.fromNoteId) normalized.fromNoteId = String(normalized.fromNoteId);
  if (normalized.toNoteId) normalized.toNoteId = String(normalized.toNoteId);
  if (Array.isArray(normalized.noteIds)) normalized.noteIds = normalized.noteIds.map(String);
  return normalized;
}

export function createDocumentV3({ measures = [], relations = [], layout = {}, idFactory = createId } = {}) {
  const sourceMeasures = measures.length
    ? measures
    : [{ id: idFactory('m'), timeSignature: { numerator: 4, denominator: 4 }, events: [], groups: [] }];
  return normalizeDocumentV3({ version: DOCUMENT_VERSION, measures: sourceMeasures, relations, layout }, { idFactory });
}

export function createBlankDocumentV3({ beats = 4, systems = 4, measuresPerSystem = 4, idFactory = createId } = {}) {
  const numerator = Number(beats) === 3 ? 3 : 4;
  const systemCount = Math.max(1, Math.trunc(Number(systems) || 4));
  const measureCount = Math.max(1, Math.min(4, Math.trunc(Number(measuresPerSystem) || 4)));
  const measures = [];
  const systemBreakAfter = [];
  for (let systemIndex = 0; systemIndex < systemCount; systemIndex++) {
    for (let measureIndex = 0; measureIndex < measureCount; measureIndex++) {
      measures.push({
        id: idFactory('m'),
        timeSignature: { numerator, denominator: 4 },
        events: [],
        groups: []
      });
    }
    systemBreakAfter.push(measures.at(-1).id);
  }
  return createDocumentV3({ measures, layout: { systemBreakAfter }, idFactory });
}

export function normalizeDocumentV3(document, { idFactory = createId } = {}) {
  const source = document && typeof document === 'object' ? cloneValue(document) : {};
  const measures = Array.isArray(source.measures) ? source.measures.map(measure => normalizeMeasure(measure, idFactory)) : [];
  if (!measures.length) measures.push(normalizeMeasure({}, idFactory));
  const measureIds = new Set(measures.map(measure => measure.id));
  const rawBreaks = Array.isArray(source.layout?.systemBreakAfter) ? source.layout.systemBreakAfter : [];
  const systemBreakAfter = [...new Set(rawBreaks.map(String).filter(id => measureIds.has(id)))];
  return {
    ...source,
    version: DOCUMENT_VERSION,
    measures,
    relations: Array.isArray(source.relations) ? source.relations.map(relation => normalizeRelation(relation, idFactory)) : [],
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
  const techniqueById = new Map();
  const markById = new Map();
  const groupById = new Map();
  const relationById = new Map();
  const eventLocation = new Map();
  const noteLocation = new Map();
  for (let measureIndex = 0; measureIndex < (document?.measures?.length || 0); measureIndex++) {
    const measure = document.measures[measureIndex];
    measureById.set(measure.id, { measure, measureIndex });
    for (const group of measure.groups || []) groupById.set(group.id, { group, measureId: measure.id, measureIndex });
    for (let eventIndex = 0; eventIndex < (measure.events?.length || 0); eventIndex++) {
      const event = measure.events[eventIndex];
      eventById.set(event.id, event);
      eventLocation.set(event.id, { measureId: measure.id, measureIndex, eventIndex });
      for (const mark of event.marks || []) markById.set(mark.id, { mark, measureId: measure.id, measureIndex, eventId: event.id, eventIndex });
      for (let noteIndex = 0; noteIndex < (event.notes?.length || 0); noteIndex++) {
        const note = event.notes[noteIndex];
        noteById.set(note.id, note);
        noteLocation.set(note.id, { measureId: measure.id, measureIndex, eventId: event.id, eventIndex, noteIndex });
        for (const technique of note.techniques || []) {
          techniqueById.set(technique.id, { technique, measureId: measure.id, measureIndex, eventId: event.id, eventIndex, noteId: note.id, noteIndex });
        }
      }
    }
  }
  for (const relation of document?.relations || []) relationById.set(relation.id, relation);
  return { measureById, eventById, noteById, techniqueById, markById, groupById, relationById, eventLocation, noteLocation };
}
