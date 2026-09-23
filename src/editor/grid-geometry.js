import { addFractions, fractionToNumber } from './model.js';

export function measureWidthsForGrid(grid) {
  const count = Math.max(1, Number(grid?.dataset.measureCount) || 1);
  const raw = String(grid?.dataset.measureWidths || '')
    .split(',')
    .map(Number)
    .filter(Number.isFinite);
  if (raw.length !== count || raw.some(value => value <= 0)) return Array(count).fill(100 / count);
  const total = raw.reduce((sum, value) => sum + value, 0) || 100;
  return raw.map(value => value / total * 100);
}

export function measureBoundaryPercentForGrid(grid, localBoundary) {
  const widths = measureWidthsForGrid(grid);
  const boundary = Math.max(0, Math.min(widths.length, Number(localBoundary) || 0));
  return widths.slice(0, boundary).reduce((sum, value) => sum + value, 0);
}

export function legacyPositionPercentForGrid(grid, absolutePosition, { beatsPerMeasure = 4, slotsPerBeat = 4 } = {}) {
  const measureSlots = beatsPerMeasure * slotsPerBeat;
  const startMeasure = Number(grid?.dataset.measureStart) || 0;
  const widths = measureWidthsForGrid(grid);
  const position = Number(absolutePosition);
  if (!Number.isFinite(position)) return 0;

  const absoluteMeasure = Math.floor(Math.max(0, position) / measureSlots);
  const localMeasure = absoluteMeasure - startMeasure;
  if (localMeasure < 0) return 0;
  if (localMeasure >= widths.length) return 100;

  const slot = Math.max(0, Math.min(measureSlots - 1, position - absoluteMeasure * measureSlots));
  const left = widths.slice(0, localMeasure).reduce((sum, value) => sum + value, 0);
  return left + widths[localMeasure] * ((slot + 1) / measureSlots);
}

export function legacyPositionStepPercentForGrid(grid, absolutePosition, { beatsPerMeasure = 4, slotsPerBeat = 4 } = {}) {
  const measureSlots = beatsPerMeasure * slotsPerBeat;
  const startMeasure = Number(grid?.dataset.measureStart) || 0;
  const widths = measureWidthsForGrid(grid);
  const position = Number(absolutePosition);
  const absoluteMeasure = Math.floor(Math.max(0, position) / measureSlots);
  const localMeasure = absoluteMeasure - startMeasure;
  if (localMeasure < 0 || localMeasure >= widths.length) {
    return 100 / Math.max(1, Number(grid?.dataset.positionCount) || measureSlots);
  }
  return widths[localMeasure] / measureSlots;
}

export function fractionalPercentForGrid(grid, absoluteMeasure, at, duration, measure) {
  const startMeasure = Number(grid?.dataset.measureStart) || 0;
  const widths = measureWidthsForGrid(grid);
  const localMeasure = Number(absoluteMeasure) - startMeasure;
  if (localMeasure < 0 || localMeasure >= widths.length) return 0;

  const left = widths.slice(0, localMeasure).reduce((sum, value) => sum + value, 0);
  const beats = Number(measure?.timeSignature?.numerator || 4)
    * (4 / Number(measure?.timeSignature?.denominator || 4));
  const visualTime = addFractions(at, duration || [1, 4]);
  const ratio = Math.max(0, Math.min(1, fractionToNumber(visualTime) / Math.max(0.000001, beats)));
  return left + widths[localMeasure] * ratio;
}
