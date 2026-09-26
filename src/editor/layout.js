import { fractionToNumber, harmonicTechnique, isDocumentV3, normalizeDocumentV3, normalizeFraction, noteDisplayValue } from './model.js';

export const MAX_MEASURES_PER_SYSTEM = 4;
export const DEFAULT_LAYOUT_WIDTH = 1120;
export const MIN_MEASURE_WIDTH = 205;
export const COMPACT_SCORE_MIN_MEASURE_WIDTH = 112;
export const COMPACT_SCORE_SEGMENT_GAP = 12;
export const COMPACT_SCORE_MAX_MEASURES_PER_ROW = 8;

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

function hasTwoDigitFret(event) {
  return (event?.notes || []).some(note => /^\d{2,}$/.test(String(note?.fret ?? '').trim()));
}

function closeTwoDigitPairs(measure) {
  const events = [...(measure?.events || [])]
    .filter(event => (event.notes || []).length)
    .sort((left, right) => fractionToNumber(left.at) - fractionToNumber(right.at));
  let pairs = 0;
  for (let index = 1; index < events.length; index++) {
    if (!hasTwoDigitFret(events[index - 1]) || !hasTwoDigitFret(events[index])) continue;
    const distance = fractionToNumber(events[index].at) - fractionToNumber(events[index - 1].at);
    if (distance > 0 && distance <= 0.25 + 1e-9) pairs += 1;
  }
  return pairs;
}

function textWidthUnits(value) {
  return [...String(value ?? '').trim()].reduce((units, character) => {
    if (/[MW@#%&]/.test(character)) return units + 1.35;
    if (/[ilI1|'`]/.test(character)) return units + 0.55;
    return units + 1;
  }, 0);
}

function chordSymbolPressure(event) {
  const symbol = String(event?.chord?.symbol ?? '').trim();
  if (!symbol) return 0;
  return Math.min(4.5, 0.8 + Math.max(0, textWidthUnits(symbol) - 2) * 0.55);
}

function harmonicTextPressure(event) {
  let pressure = 0;
  for (const note of event?.notes || []) {
    if (!harmonicTechnique(note)) continue;
    const scoreText = `<${noteDisplayValue(note)}>`;
    pressure += Math.min(2.25, 0.85 + Math.max(0, textWidthUnits(scoreText) - 3) * 0.45);
  }
  return pressure;
}

function hasFlexibleScoreNotation(measure) {
  for (const event of measure?.events || []) {
    if (String(event?.chord?.symbol ?? '').trim()) return true;
    if ((event.notes || []).some(note => harmonicTechnique(note))) return true;
    if ((event.marks || []).some(mark => mark?.type === 'strum' || mark?.type === 'arpeggio')) return true;
  }
  return false;
}

function spacingPressureForMeasure(measure) {
  let pressure = 1;
  let previousChordSymbol = null;
  for (const event of measure?.events || []) {
    const chordSymbol = String(event?.chord?.symbol ?? '').trim();
    if (chordSymbol && chordSymbol !== previousChordSymbol) pressure += chordSymbolPressure(event);
    if (chordSymbol) previousChordSymbol = chordSymbol;
    pressure += harmonicTextPressure(event);
    for (const mark of event.marks || []) {
      if (mark?.type === 'strum' || mark?.type === 'arpeggio') pressure += 2.5;
    }
  }
  for (const group of measure?.groups || []) {
    if (group?.type === 'subdivision' && group?.subdivision === 'thirty-second') pressure += 2.75;
  }
  pressure += closeTwoDigitPairs(measure) * 2.25;
  return Math.max(1, pressure);
}

export function measureComplexity(documentModel, measure) {
  const document = sourceDocument(documentModel);
  const target = measure || document.measures[0];
  return target ? spacingPressureForMeasure(target) : 1;
}

function minimumWidthForComplexity(complexity, minMeasureWidth) {
  return Math.round(minMeasureWidth + Math.min(155, Math.max(0, complexity - 1) * 23));
}

export function measureMinimumWidth(documentModel, measure, { minMeasureWidth = MIN_MEASURE_WIDTH } = {}) {
  return minimumWidthForComplexity(measureComplexity(documentModel, measure), minMeasureWidth);
}

function metricForMeasure(measure, minMeasureWidth) {
  const complexity = spacingPressureForMeasure(measure);
  return {
    complexity,
    minimumWidth: minimumWidthForComplexity(complexity, minMeasureWidth),
    weight: Math.sqrt(complexity),
    flexibleNotation: hasFlexibleScoreNotation(measure)
  };
}

function buildMetricsForMeasures(measures, minMeasureWidth) {
  const metrics = new Map();
  for (const measure of measures || []) metrics.set(measure.id, metricForMeasure(measure, minMeasureWidth));
  return metrics;
}

function buildMetrics(document, minMeasureWidth) {
  return buildMetricsForMeasures(document.measures || [], minMeasureWidth);
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

function equalCompactWidths(measures, availableWidth, metrics) {
  const minimums = measures.map(measure => metrics.get(measure.id)?.minimumWidth || COMPACT_SCORE_MIN_MEASURE_WIDTH);
  const width = Math.max(...minimums, availableWidth / Math.max(1, measures.length));
  const pixels = measures.map(() => width);
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
  const sourceMeasureCount = measures.length;
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
      sourceMeasureCount,
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

export function buildAdaptiveSystemLayout(measures, {
  sourceSystemIndex = 0,
  availableWidth = DEFAULT_LAYOUT_WIDTH,
  maxMeasuresPerSystem = MAX_MEASURES_PER_SYSTEM,
  minMeasureWidth = MIN_MEASURE_WIDTH
} = {}) {
  const sourceMeasures = Array.isArray(measures) ? measures : [];
  if (!sourceMeasures.length) return [];
  const width = Math.max(1, Number(availableWidth) || DEFAULT_LAYOUT_WIDTH);
  const metrics = buildMetricsForMeasures(sourceMeasures, minMeasureWidth);
  return splitLogicalSystem(sourceMeasures, Number(sourceSystemIndex) || 0, width, maxMeasuresPerSystem, metrics);
}

export function buildAdaptiveLayout(documentModel, {
  availableWidth = DEFAULT_LAYOUT_WIDTH,
  maxMeasuresPerSystem = MAX_MEASURES_PER_SYSTEM,
  minMeasureWidth = MIN_MEASURE_WIDTH
} = {}) {
  const document = sourceDocument(documentModel);
  const width = Math.max(1, Number(availableWidth) || DEFAULT_LAYOUT_WIDTH);
  const logicalSystems = buildSystems(document, { maxMeasuresPerSystem: MAX_MEASURES_PER_SYSTEM });
  const systems = [];
  logicalSystems.forEach((measures, sourceSystemIndex) => {
    systems.push(...buildAdaptiveSystemLayout(measures, {
      sourceSystemIndex,
      availableWidth: width,
      maxMeasuresPerSystem,
      minMeasureWidth
    }));
  });
  return { availableWidth: width, systems, logicalSystems };
}

function finalizeCompactRow(row, availableWidth, gap, metrics) {
  if (!row?.segments?.length) return null;
  const measures = row.segments.flatMap(segment => segment.measures);
  const usableWidth = Math.max(1, availableWidth - gap * Math.max(0, row.segments.length - 1));
  const plainNotation = measures.every(measure => !metrics.get(measure.id)?.flexibleNotation);
  const allocation = plainNotation
    ? equalCompactWidths(measures, usableWidth, metrics)
    : allocateWidths(measures, usableWidth, metrics);
  let cursor = 0;
  const segments = row.segments.map(segment => {
    const count = segment.measures.length;
    const pixels = allocation.pixels.slice(cursor, cursor + count);
    cursor += count;
    const pixelTotal = pixels.reduce((sum, value) => sum + value, 0) || 1;
    return {
      ...segment,
      sourceMeasureCount: segment.sourceMeasureCount || count,
      measureIds: segment.measures.map(measure => measure.id),
      measureWidthsPx: pixels,
      measureWidths: pixels.map(value => value / pixelTotal * 100),
      widthWeight: pixelTotal
    };
  });
  return { segments, measureCount: measures.length, minimumWidth: row.minimumWidth, plainNotation };
}

export function buildCompactScoreLayout(documentModel, {
  availableWidth = DEFAULT_LAYOUT_WIDTH,
  minMeasureWidth = COMPACT_SCORE_MIN_MEASURE_WIDTH,
  segmentGap = COMPACT_SCORE_SEGMENT_GAP,
  maxMeasuresPerRow = COMPACT_SCORE_MAX_MEASURES_PER_ROW
} = {}) {
  const document = sourceDocument(documentModel);
  const width = Math.max(1, Number(availableWidth) || DEFAULT_LAYOUT_WIDTH);
  const gap = Math.max(0, Number(segmentGap) || 0);
  const maxPerRow = Math.max(1, Math.min(COMPACT_SCORE_MAX_MEASURES_PER_ROW, Math.trunc(Number(maxMeasuresPerRow) || COMPACT_SCORE_MAX_MEASURES_PER_ROW)));
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
      const metric = metrics.get(measure.id);
      const minimumWidth = metric?.minimumWidth || minMeasureWidth;
      const flexibleNotation = Boolean(metric?.flexibleNotation);
      const lastSegment = row?.segments?.[row.segments.length - 1] || null;
      const startsSegment = !lastSegment || lastSegment.sourceSystemIndex !== sourceSystemIndex;
      const extraGap = row?.segments?.length && startsSegment ? gap : 0;
      const candidateMeasureCount = (row?.measureCount || 0) + 1;
      const candidateSegmentCount = row
        ? row.segments.length + (startsSegment ? 1 : 0)
        : 1;
      const candidateHasFlexibleNotation = Boolean(row?.hasFlexibleNotation || flexibleNotation);
      const candidateMaxMinimum = Math.max(row?.maxMeasureMinimum || 0, minimumWidth);
      const candidateMinimumWidth = candidateHasFlexibleNotation
        ? (row?.minimumWidth || 0) + extraGap + minimumWidth
        : candidateMaxMinimum * candidateMeasureCount + gap * Math.max(0, candidateSegmentCount - 1);
      if (row?.measureCount && (row.measureCount >= maxPerRow || candidateMinimumWidth > width)) flush();
      if (!row) row = { segments: [], measureCount: 0, minimumWidth: 0, maxMeasureMinimum: 0, hasFlexibleNotation: false };
      let segment = row.segments[row.segments.length - 1];
      if (!segment || segment.sourceSystemIndex !== sourceSystemIndex) {
        if (row.segments.length) row.minimumWidth += gap;
        segment = { sourceSystemIndex, sourceMeasureCount: measures.length, startMeasure: measureIndex, measures: [] };
        row.segments.push(segment);
      }
      segment.measures.push(measure);
      row.measureCount += 1;
      row.minimumWidth += minimumWidth;
      row.maxMeasureMinimum = Math.max(row.maxMeasureMinimum, minimumWidth);
      row.hasFlexibleNotation ||= flexibleNotation;
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
