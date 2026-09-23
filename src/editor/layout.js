import { fractionToNumber, indexDocument, normalizeDocumentV3, normalizeFraction } from './model.js';

export const MAX_MEASURES_PER_SYSTEM = 4;
export const DEFAULT_LAYOUT_WIDTH = 1120;
export const MIN_MEASURE_WIDTH = 205;

export function buildSystems(document, { maxMeasuresPerSystem = MAX_MEASURES_PER_SYSTEM } = {}) {
  const normalized = normalizeDocumentV3(document);
  const breaks = new Set(normalized.layout?.systemBreakAfter || []);
  const systems = [];
  let current = [];

  for (const measure of normalized.measures) {
    current.push(measure);
    if (breaks.has(measure.id) || current.length >= maxMeasuresPerSystem) {
      systems.push(current);
      current = [];
    }
  }
  if (current.length) systems.push(current);
  return systems.length ? systems : [[]];
}

function relationCountsByMeasure(document) {
  const counts = new Map();
  const index = indexDocument(document);
  for (const relation of document.relations || []) {
    const measureIds = new Set();
    for (const noteId of [relation.fromNoteId, relation.toNoteId, ...(relation.noteIds || [])].filter(Boolean)) {
      const measureId = index.noteLocation.get(String(noteId))?.measureId;
      if (measureId) measureIds.add(measureId);
    }
    for (const measureId of measureIds) counts.set(measureId, (counts.get(measureId) || 0) + 1);
  }
  return counts;
}

export function measureComplexity(documentModel, measure) {
  const document = normalizeDocumentV3(documentModel);
  const target = measure || document.measures[0];
  if (!target) return 1;
  const relations = relationCountsByMeasure(document).get(target.id) || 0;
  let score = 1;

  for (const event of target.events || []) {
    const notes = event.notes || [];
    score += 0.52;
    if (notes.length > 1) score += (notes.length - 1) * 0.18;
    score += (event.marks || []).length * 0.85;
    for (const note of notes) {
      if (/^\d{2,}$/.test(String(note.fret ?? ''))) score += 0.24;
      score += (note.techniques || []).length * 0.72;
    }
  }

  score += (target.groups || []).length * 1.15;
  score += relations * 0.95;
  return Math.max(1, score);
}

export function measureMinimumWidth(documentModel, measure, { minMeasureWidth = MIN_MEASURE_WIDTH } = {}) {
  const complexity = measureComplexity(documentModel, measure);
  return Math.round(minMeasureWidth + Math.min(155, Math.max(0, complexity - 1) * 18));
}

function allocateWidths(document, measures, availableWidth, options) {
  const minimums = measures.map(measure => measureMinimumWidth(document, measure, options));
  const weights = measures.map(measure => Math.sqrt(measureComplexity(document, measure)));
  const minimumTotal = minimums.reduce((sum, value) => sum + value, 0);
  const remaining = Math.max(0, availableWidth - minimumTotal);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0) || 1;
  const pixels = minimums.map((minimum, index) => minimum + remaining * (weights[index] / weightTotal));
  const pixelTotal = pixels.reduce((sum, value) => sum + value, 0) || 1;
  return {
    minimums,
    pixels,
    percentages: pixels.map(value => value / pixelTotal * 100)
  };
}

function splitLogicalSystem(document, measures, sourceSystemIndex, availableWidth, options) {
  const result = [];
  let cursor = 0;
  const maxMeasures = Math.max(1, Math.min(MAX_MEASURES_PER_SYSTEM, Number(options.maxMeasuresPerSystem) || MAX_MEASURES_PER_SYSTEM));

  while (cursor < measures.length) {
    let count = 0;
    let required = 0;
    while (cursor + count < measures.length && count < maxMeasures) {
      const measure = measures[cursor + count];
      const nextRequired = required + measureMinimumWidth(document, measure, options);
      if (count > 0 && nextRequired > availableWidth) break;
      required = nextRequired;
      count += 1;
    }
    if (!count) count = 1;

    const slice = measures.slice(cursor, cursor + count);
    const allocation = allocateWidths(document, slice, availableWidth, options);
    result.push({
      sourceSystemIndex,
      startMeasure: cursor,
      measures: slice,
      measureIds: slice.map(measure => measure.id),
      measureWidths: allocation.percentages,
      measureWidthsPx: allocation.pixels,
      minimumWidth: allocation.minimums.reduce((sum, value) => sum + value, 0)
    });
    cursor += count;
  }
  return result;
}

export function buildAdaptiveLayout(documentModel, {
  availableWidth = DEFAULT_LAYOUT_WIDTH,
  maxMeasuresPerSystem = MAX_MEASURES_PER_SYSTEM,
  minMeasureWidth = MIN_MEASURE_WIDTH
} = {}) {
  const document = normalizeDocumentV3(documentModel);
  const width = Math.max(1, Number(availableWidth) || DEFAULT_LAYOUT_WIDTH);
  const logicalSystems = buildSystems(document, { maxMeasuresPerSystem: MAX_MEASURES_PER_SYSTEM });
  const systems = [];

  logicalSystems.forEach((measures, sourceSystemIndex) => {
    systems.push(...splitLogicalSystem(document, measures, sourceSystemIndex, width, {
      maxMeasuresPerSystem,
      minMeasureWidth
    }));
  });

  return {
    availableWidth: width,
    systems,
    logicalSystems
  };
}

export function systemIndexForMeasure(document, measureId, options) {
  const systems = buildSystems(document, options);
  for (let systemIndex = 0; systemIndex < systems.length; systemIndex++) {
    const measureIndex = systems[systemIndex].findIndex(measure => measure.id === measureId);
    if (measureIndex >= 0) return { systemIndex, measureIndex };
  }
  return null;
}

export function adaptiveLocationForMeasure(document, measureId, options) {
  const layout = buildAdaptiveLayout(document, options);
  for (let systemIndex = 0; systemIndex < layout.systems.length; systemIndex++) {
    const measureIndex = layout.systems[systemIndex].measures.findIndex(measure => measure.id === measureId);
    if (measureIndex >= 0) return { systemIndex, measureIndex, system: layout.systems[systemIndex] };
  }
  return null;
}

export function measureAtLegacyLocation(document, rowIndex, measureIndex) {
  return buildSystems(document)?.[rowIndex]?.[measureIndex] || null;
}

export function measureDurationInBeats(measure) {
  const signature = measure?.timeSignature || { numerator: 4, denominator: 4 };
  return Number(signature.numerator || 4) * (4 / Number(signature.denominator || 4));
}

export function snapFraction(value, increment) {
  const step = fractionToNumber(increment);
  if (!Number.isFinite(step) || step <= 0) return normalizeFraction(value);
  const numeric = fractionToNumber(value);
  const snapped = Math.round(numeric / step) * step;
  const denominator = 96;
  return normalizeFraction([Math.round(snapped * denominator), denominator]);
}

export function timeFromPointerX(clientX, rect, measure, snap = [1, 4]) {
  const width = Math.max(1, Number(rect?.width) || Number(rect?.right) - Number(rect?.left) || 1);
  const left = Number(rect?.left) || 0;
  const ratio = Math.max(0, Math.min(1, (Number(clientX) - left) / width));
  const duration = measureDurationInBeats(measure);
  const denominator = 960;
  const raw = normalizeFraction([Math.round(ratio * duration * denominator), denominator]);
  const snapped = snapFraction(raw, snap);
  const numeric = Math.max(0, Math.min(duration, fractionToNumber(snapped)));
  return normalizeFraction([Math.round(numeric * denominator), denominator]);
}

export function percentageForTime(value, measure) {
  const duration = Math.max(0.000001, measureDurationInBeats(measure));
  return Math.max(0, Math.min(100, fractionToNumber(value) / duration * 100));
}
