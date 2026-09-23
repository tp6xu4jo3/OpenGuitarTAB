import { fractionToNumber, normalizeDocumentV3, normalizeFraction } from './model.js';

export function buildSystems(document, { maxMeasuresPerSystem = 4 } = {}) {
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

export function systemIndexForMeasure(document, measureId, options) {
  const systems = buildSystems(document, options);
  for (let systemIndex = 0; systemIndex < systems.length; systemIndex++) {
    const measureIndex = systems[systemIndex].findIndex(measure => measure.id === measureId);
    if (measureIndex >= 0) return { systemIndex, measureIndex };
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
