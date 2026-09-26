import {
  fractionKey,
  fractionToNumber,
  harmonicTechnique,
  isDocumentV3,
  normalizeDocumentV3,
  normalizeFraction,
  noteDisplayValue
} from './model.js';
import { editableTimesForMeasure } from './rhythm-grid.js';

export const MAX_MEASURES_PER_SYSTEM = 4;
export const DEFAULT_LAYOUT_WIDTH = 1120;
export const MIN_MEASURE_WIDTH = 205;
export const COMPACT_SCORE_MIN_MEASURE_WIDTH = 112;
export const COMPACT_SCORE_SEGMENT_GAP = 12;
export const COMPACT_SCORE_MAX_MEASURES_PER_ROW = 8;

const COLUMN_SPACING = Object.freeze({
  TWO_DIGIT_SIDE: 6,
  HARMONIC_SIDE: 8,
  SWEEP_LEFT: 18,
  SLIDE_RIGHT: 16
});

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

function textWidthUnits(value) {
  return [...String(value ?? '').trim()].reduce((units, character) => {
    if (/[MW@#%&]/.test(character)) return units + 1.35;
    if (/[ilI1|'`]/.test(character)) return units + 0.55;
    return units + 1;
  }, 0);
}

function addColumnSpace(entry, { left = 0, right = 0 } = {}) {
  if (!entry) return;
  entry.left = Math.max(entry.left, Math.max(0, Number(left) || 0));
  entry.right = Math.max(entry.right, Math.max(0, Number(right) || 0));
}

function localSpacingEntries(document, measure) {
  const times = editableTimesForMeasure(measure);
  const entries = times.map(time => ({
    key: fractionKey(time.at),
    at: time.at,
    duration: time.duration,
    left: 0,
    right: 0
  }));
  const byKey = new Map(entries.map(entry => [entry.key, entry]));
  const noteColumn = new Map();

  for (const event of measure?.events || []) {
    const key = fractionKey(event.at);
    const entry = byKey.get(key);
    if (!entry) continue;
    let hasTwoDigit = false;
    let harmonicSide = 0;
    for (const note of event.notes || []) {
      noteColumn.set(String(note.id), key);
      if (/^\d{2,}$/.test(String(note?.fret ?? '').trim())) hasTwoDigit = true;
      if (harmonicTechnique(note)) {
        const scoreText = `<${noteDisplayValue(note)}>`;
        harmonicSide = Math.max(harmonicSide, COLUMN_SPACING.HARMONIC_SIDE + Math.max(0, textWidthUnits(scoreText) - 4) * 2);
      }
    }
    if (hasTwoDigit) addColumnSpace(entry, { left: COLUMN_SPACING.TWO_DIGIT_SIDE, right: COLUMN_SPACING.TWO_DIGIT_SIDE });
    if (harmonicSide) addColumnSpace(entry, { left: harmonicSide, right: harmonicSide });
    if ((event.marks || []).some(mark => mark?.type === 'strum' || mark?.type === 'arpeggio')) {
      addColumnSpace(entry, { left: COLUMN_SPACING.SWEEP_LEFT });
    }
  }

  for (const relation of document?.relations || []) {
    if (relation?.type !== 'slide') continue;
    const fromKey = relation.fromNoteId
      ? noteColumn.get(String(relation.fromNoteId))
      : String(relation?.fromPosition?.measureId || '') === String(measure?.id || '')
        ? fractionKey(relation.fromPosition.at)
        : null;
    if (fromKey) addColumnSpace(byKey.get(fromKey), { right: COLUMN_SPACING.SLIDE_RIGHT });
  }

  return entries;
}

function spacingExtra(entries) {
  if (!entries.length) return 0;
  let extra = entries[0].left + entries.at(-1).right;
  for (let index = 1; index < entries.length; index++) {
    extra += Math.max(entries[index - 1].right, entries[index].left);
  }
  return extra;
}

export function measureColumnSpacing(documentModel, measure) {
  const document = sourceDocument(documentModel);
  const target = measure || document.measures[0];
  const entries = target ? localSpacingEntries(document, target) : [];
  return { entries, extraWidth: spacingExtra(entries) };
}

function spacingPressureForMeasure(document, measure) {
  return 1 + measureColumnSpacing(document, measure).extraWidth / 23;
}

export function measureComplexity(documentModel, measure) {
  const document = sourceDocument(documentModel);
  const target = measure || document.measures[0];
  return target ? spacingPressureForMeasure(document, target) : 1;
}

export function measureMinimumWidth(documentModel, measure, { minMeasureWidth = MIN_MEASURE_WIDTH } = {}) {
  const document = sourceDocument(documentModel);
  const target = measure || document.measures[0];
  if (!target) return minMeasureWidth;
  return Math.round(minMeasureWidth + measureColumnSpacing(document, target).extraWidth);
}

function metricForMeasure(document, measure, minMeasureWidth) {
  const spacing = measureColumnSpacing(document, measure);
  return {
    complexity: 1 + spacing.extraWidth / 23,
    extraWidth: spacing.extraWidth,
    minimumWidth: Math.round(minMeasureWidth + spacing.extraWidth),
    flexibleNotation: spacing.extraWidth > 0
  };
}

function buildMetricsForMeasures(document, measures, minMeasureWidth) {
  const metrics = new Map();
  for (const measure of measures || []) metrics.set(measure.id, metricForMeasure(document, measure, minMeasureWidth));
  return metrics;
}

function buildMetrics(document, minMeasureWidth) {
  return buildMetricsForMeasures(document, document.measures || [], minMeasureWidth);
}

function rowBaseWidth(availableWidth, minMeasureWidth, maxMeasures) {
  const slots = Math.max(1, Math.min(
    Math.max(1, Math.trunc(Number(maxMeasures) || 1)),
    Math.max(1, Math.floor(availableWidth / Math.max(1, minMeasureWidth)))
  ));
  return { slots, width: availableWidth / slots };
}

function naturalMeasureWidth(metric, baseWidth) {
  return Math.max(baseWidth, Number(metric?.minimumWidth) || baseWidth);
}

function segmentAllocation(measures, metrics, baseWidth) {
  const pixels = measures.map(measure => naturalMeasureWidth(metrics.get(measure.id), baseWidth));
  const pixelTotal = pixels.reduce((sum, value) => sum + value, 0) || 1;
  return {
    pixels,
    percentages: pixels.map(value => value / pixelTotal * 100),
    widthPx: pixelTotal,
    minimumWidth: measures.reduce((sum, measure) => sum + (metrics.get(measure.id)?.minimumWidth || baseWidth), 0)
  };
}

function splitLogicalSystem(measures, sourceSystemIndex, availableWidth, maxMeasuresPerSystem, metrics, minMeasureWidth) {
  const result = [];
  let cursor = 0;
  const sourceMeasureCount = measures.length;
  const base = rowBaseWidth(availableWidth, minMeasureWidth, maxMeasuresPerSystem);
  while (cursor < measures.length) {
    let count = 0;
    let required = 0;
    while (cursor + count < measures.length && count < base.slots) {
      const measure = measures[cursor + count];
      const nextWidth = naturalMeasureWidth(metrics.get(measure.id), base.width);
      if (count > 0 && required + nextWidth > availableWidth + 0.01) break;
      required += nextWidth;
      count += 1;
    }
    if (!count) count = 1;
    const slice = measures.slice(cursor, cursor + count);
    const allocation = segmentAllocation(slice, metrics, base.width);
    result.push({
      sourceSystemIndex,
      sourceMeasureCount,
      startMeasure: cursor,
      measures: slice,
      measureIds: slice.map(measure => measure.id),
      measureWidths: allocation.percentages,
      measureWidthsPx: allocation.pixels,
      widthPx: Math.min(availableWidth, allocation.widthPx),
      minimumWidth: allocation.minimumWidth,
      baseMeasureWidth: base.width
    });
    cursor += count;
  }
  return result;
}

export function buildAdaptiveSystemLayout(measures, {
  sourceSystemIndex = 0,
  availableWidth = DEFAULT_LAYOUT_WIDTH,
  maxMeasuresPerSystem = MAX_MEASURES_PER_SYSTEM,
  minMeasureWidth = MIN_MEASURE_WIDTH,
  documentModel = null
} = {}) {
  const sourceMeasures = Array.isArray(measures) ? measures : [];
  if (!sourceMeasures.length) return [];
  const width = Math.max(1, Number(availableWidth) || DEFAULT_LAYOUT_WIDTH);
  const context = documentModel ? sourceDocument(documentModel) : sourceDocument({ version: 3, measures: sourceMeasures, relations: [], layout: {} });
  const metrics = buildMetricsForMeasures(context, sourceMeasures, minMeasureWidth);
  return splitLogicalSystem(sourceMeasures, Number(sourceSystemIndex) || 0, width, maxMeasuresPerSystem, metrics, minMeasureWidth);
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
      minMeasureWidth,
      documentModel: document
    }));
  });
  return { availableWidth: width, systems, logicalSystems };
}

function finalizeCompactRow(row, gap) {
  if (!row?.segments?.length) return null;
  const segments = row.segments.map(segment => {
    const pixels = segment.measureWidthsPx.slice();
    const pixelTotal = pixels.reduce((sum, value) => sum + value, 0) || 1;
    return {
      ...segment,
      measureIds: segment.measures.map(measure => measure.id),
      measureWidths: pixels.map(value => value / pixelTotal * 100),
      widthWeight: pixelTotal,
      widthPx: pixelTotal
    };
  });
  const widthPx = segments.reduce((sum, segment) => sum + segment.widthPx, 0) + gap * Math.max(0, segments.length - 1);
  return {
    segments,
    measureCount: row.measureCount,
    minimumWidth: row.minimumWidth,
    widthPx,
    plainNotation: !row.hasFlexibleNotation
  };
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
  const base = rowBaseWidth(width, minMeasureWidth, maxPerRow);
  const rows = [];
  let row = null;
  const flush = () => {
    const finalized = finalizeCompactRow(row, gap);
    if (finalized) rows.push(finalized);
    row = null;
  };

  logicalSystems.forEach((measures, sourceSystemIndex) => {
    measures.forEach((measure, measureIndex) => {
      const metric = metrics.get(measure.id);
      const measureWidth = naturalMeasureWidth(metric, base.width);
      const lastSegment = row?.segments?.[row.segments.length - 1] || null;
      const startsSegment = !lastSegment || lastSegment.sourceSystemIndex !== sourceSystemIndex;
      const extraGap = row?.segments?.length && startsSegment ? gap : 0;
      if (row?.measureCount && (row.measureCount >= maxPerRow || row.widthPx + extraGap + measureWidth > width + 0.01)) flush();
      if (!row) row = { segments: [], measureCount: 0, widthPx: 0, minimumWidth: 0, hasFlexibleNotation: false };
      let segment = row.segments[row.segments.length - 1];
      if (!segment || segment.sourceSystemIndex !== sourceSystemIndex) {
        if (row.segments.length) row.widthPx += gap;
        segment = {
          sourceSystemIndex,
          sourceMeasureCount: measures.length,
          startMeasure: measureIndex,
          measures: [],
          measureWidthsPx: []
        };
        row.segments.push(segment);
      }
      segment.measures.push(measure);
      segment.measureWidthsPx.push(measureWidth);
      row.measureCount += 1;
      row.widthPx += measureWidth;
      row.minimumWidth += metric?.minimumWidth || minMeasureWidth;
      row.hasFlexibleNotation ||= Boolean(metric?.flexibleNotation);
    });
  });
  flush();
  return { availableWidth: width, rows, logicalSystems, segmentGap: gap, baseMeasureWidth: base.width };
}

function visualCenterRatio(time, measure) {
  const duration = Math.max(0.000001, measureDurationInBeats(measure));
  const at = fractionToNumber(time?.at || [0, 1]);
  const slot = Math.max(0, fractionToNumber(time?.duration || [1, 4]));
  return Math.max(0, Math.min(1, (at + slot / 2) / duration));
}

export function columnGeometryForMeasure(documentModel, measure, measureWidthPx) {
  const document = sourceDocument(documentModel);
  const width = Math.max(1, Number(measureWidthPx) || measureMinimumWidth(document, measure));
  const spacing = measureColumnSpacing(document, measure);
  const entries = spacing.entries.map(entry => ({ ...entry, baseRatio: visualCenterRatio(entry, measure) }));
  const baseWidth = Math.max(1, width - spacing.extraWidth);
  const centers = new Map();
  const gaps = [];
  let inserted = entries[0]?.left || 0;

  entries.forEach((entry, index) => {
    if (index > 0) {
      const gap = Math.max(entries[index - 1].right, entry.left);
      gaps[index] = gap;
      inserted += gap;
    }
    centers.set(entry.key, (entry.baseRatio * baseWidth + inserted) / width * 100);
  });

  const percentForFraction = value => {
    const ratio = Math.max(0, Math.min(1, fractionToNumber(value) / Math.max(0.000001, measureDurationInBeats(measure))));
    let shift = entries[0]?.left || 0;
    for (let index = 1; index < entries.length; index++) {
      const boundary = (entries[index - 1].baseRatio + entries[index].baseRatio) / 2;
      if (ratio < boundary) break;
      shift += gaps[index] || 0;
    }
    return Math.max(0, Math.min(100, (ratio * baseWidth + shift) / width * 100));
  };

  return {
    widthPx: width,
    extraWidth: spacing.extraWidth,
    entries,
    percentForKey: key => centers.get(String(key)),
    percentForFraction
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
