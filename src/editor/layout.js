import { fractionToNumber, indexDocument, isDocumentV3, normalizeDocumentV3, normalizeFraction } from './model.js';

export const MAX_MEASURES_PER_SYSTEM = 4;
export const DEFAULT_LAYOUT_WIDTH = 1120;
export const MIN_MEASURE_WIDTH = 205;
export const COMPACT_SCORE_MIN_MEASURE_WIDTH = 112;
export const COMPACT_SCORE_SEGMENT_GAP = 12;

function sourceDocument(document) {
  return isDocumentV3(document) ? document : normalizeDocumentV3(document);
}

export function buildSystems(document, { maxMeasuresPerSystem = MAX_MEASURES_PER_SYSTEM } = {}) {
  const normalized = sourceDocument(document);
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

function complexityForMeasure(measure, relationCount = 0) {
  let score = 1;
  for (const event of measure?.events || []) {
    score += (event.marks || []).length * 2.5;
    if (event.rhythmAnchor) score += 2.25;
    for (const note of event.notes || []) score += (note.techniques || []).length * 2.5;
  }
  score += (measure?.groups || []).length * 3;
  score += relationCount * 2.75;
  return Math.max(1, score);
}

export function measureComplexity(documentModel, measure) {
  const document = sourceDocument(documentModel);
  const target = measure || document.measures[0];
  if (!target) return 1;
  return complexityForMeasure(target, relationCountsByMeasure(document).get(target.id) || 0);
}

function minimumWidthForComplexity(complexity, minMeasureWidth) {
  return Math.round(minMeasureWidth + Math.min(155, Math.max(0, complexity - 1) * 23));
}

export function measureMinimumWidth(documentModel, measure, { minMeasureWidth = MIN_MEASURE_WIDTH } = {}) {
  return minimumWidthForComplexity(measureComplexity(documentModel, measure), minMeasureWidth);
}

function buildMetrics(document, minMeasureWidth) {
  const relations = relationCountsByMeasure(document);
  const metrics = new Map();
  for (const measure of document.measures || []) {
    const complexity = complexityForMeasure(measure, relations.get(measure.id) || 0);
    metrics.set(measure.id, {
      complexity,
      minimumWidth: minimumWidthForComplexity(complexity, minMeasureWidth),
      weight: Math.sqrt(complexity)
    });
  }
  return metrics;
}

function allocateWidths(measures, availableWidth, metrics) {
  const minimums = measures.map(measure => metrics.get(measure.id)?.minimumWidth || MIN_MEASURE_WIDTH);
  const weights = measures.map(measure => metrics.get(measure.id)?.weight || 1);
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

function splitLogicalSystem(measures, sourceSystemIndex, availableWidth, maxMeasuresPerSystem, metrics) {
  const result = [];
  let cursor = 0;
  const maxMeasures = Math.max(1, Math.min(MAX_MEASURES_PER_SYSTEM, Number(maxMeasuresPerSystem) || MAX_MEASURES_PER_SYSTEM));

  while (cursor < measures.length) {
    let count = 0;
    let required = 0;
    while (cursor + count < measures.length && count < maxMeasures) {
      const measure = measures[cursor + count];
      const nextRequired = required + (metrics.get(measure.id)?.minimumWidth || MIN_MEASURE_WIDTH);
      if (count > 0 && nextRequired > availableWidth) break;
      required = nextRequired;
      count += 1;
    }
    if (!count) count = 1;

    const remaining = measures.length - (cursor + count);
    if (remaining === 1 && count >= 3) count -= 1;

    const slice = measures.slice(cursor, cursor + count);
    const allocation = allocateWidths(slice, availableWidth, metrics);
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
  const document = sourceDocument(documentModel);
  const width = Math.max(1, Number(availableWidth) || DEFAULT_LAYOUT_WIDTH);
  const logicalSystems = buildSystems(document, { maxMeasuresPerSystem: MAX_MEASURES_PER_SYSTEM });
  const metrics = buildMetrics(document, minMeasureWidth);
  const systems = [];

  logicalSystems.forEach((measures, sourceSystemIndex) => {
    systems.push(...splitLogicalSystem(measures, sourceSystemIndex, width, maxMeasuresPerSystem, metrics));
  });

  return { availableWidth: width, systems, logicalSystems };
}

function finalizeCompactRow(row, availableWidth, gap, metrics) {
  if (!row?.segments?.length) return null;
  const measures = row.segments.flatMap(segment => segment.measures);
  const usableWidth = Math.max(1, availableWidth - gap * Math.max(0, row.segments.length - 1));
  const allocation = allocateWidths(measures, usableWidth, metrics);
  let cursor = 0;

  const segments = row.segments.map(segment => {
    const count = segment.measures.length;
    const pixels = allocation.pixels.slice(cursor, cursor + count);
    cursor += count;
    const pixelTotal = pixels.reduce((sum, value) => sum + value, 0) || 1;
    return {
      ...segment,
      measureIds: segment.measures.map(measure => measure.id),
      measureWidthsPx: pixels,
      measureWidths: pixels.map(value => value / pixelTotal * 100),
      widthWeight: pixelTotal
    };
  });

  return {
    segments,
    measureCount: measures.length,
    minimumWidth: row.minimumWidth
  };
}

export function buildCompactScoreLayout(documentModel, {
  availableWidth = DEFAULT_LAYOUT_WIDTH,
  minMeasureWidth = COMPACT_SCORE_MIN_MEASURE_WIDTH,
  segmentGap = COMPACT_SCORE_SEGMENT_GAP
} = {}) {
  const document = sourceDocument(documentModel);
  const width = Math.max(1, Number(availableWidth) || DEFAULT_LAYOUT_WIDTH);
  const gap = Math.max(0, Number(segmentGap) || 0);
  const logicalSystems = buildSystems(document, { maxMeasuresPerSystem: MAX_MEASURES_PER_SYSTEM });
  const metrics = buildMetrics(document, minMeasureWidth);
  const rows = [];
  let row = null;

  const flush = () => {
    const finalized = finalizeCompactRow(row, width, gap, metrics);
    if (finalized) rows.push(finalized);
    row = null;
  };

  logicalSystems.forEach((measures, sourceSystemIndex) => {
    measures.forEach((measure, measureIndex) => {
      const minimumWidth = metrics.get(measure.id)?.minimumWidth || minMeasureWidth;
      const lastSegment = row?.segments?.[row.segments.length - 1] || null;
      const startsSegment = !lastSegment || lastSegment.sourceSystemIndex !== sourceSystemIndex;
      const extraGap = row?.segments?.length && startsSegment ? gap : 0;
      if (row?.measureCount && row.minimumWidth + extraGap + minimumWidth > width) flush();

      if (!row) row = { segments: [], measureCount: 0, minimumWidth: 0 };
      let segment = row.segments[row.segments.length - 1];
      if (!segment || segment.sourceSystemIndex !== sourceSystemIndex) {
        if (row.segments.length) row.minimumWidth += gap;
        segment = {
          sourceSystemIndex,
          startMeasure: measureIndex,
          measures: []
        };
        row.segments.push(segment);
      }

      segment.measures.push(measure);
      row.measureCount += 1;
      row.minimumWidth += minimumWidth;
    });
  });
  flush();

  return { availableWidth: width, rows, logicalSystems };
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
