import { fractionToNumber, normalizeFraction } from './model.js';

const EPSILON = 1e-9;
const DEFAULT_GRID_DURATION = 0.25;

function numericFraction(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fractionToNumber(value);
}

function measureDurationInQuarterBeats(measure) {
  const signature = measure?.timeSignature || { numerator: 4, denominator: 4 };
  const numerator = Math.max(1, Math.trunc(Number(signature.numerator) || 4));
  const denominator = Math.max(1, Math.trunc(Number(signature.denominator) || 4));
  return numerator * (4 / denominator);
}

export function rhythmBeamCountForValue(value) {
  if (!Number.isFinite(value) || value >= 1) return 0;
  if (value >= 0.5) return 1;
  if (value >= 0.25) return 2;
  return 3;
}

export function rhythmDotCountForValue(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  for (const base of [2, 1, 0.5, 0.25, 0.125]) {
    if (Math.abs(value - base * 1.5) <= EPSILON) return 1;
  }
  return 0;
}

function placeholderDurationForAt(at) {
  const normalized = normalizeFraction(at || [0, 1]);
  const denominator = Math.abs(Number(normalized[1])) || 1;
  return denominator === 1 ? 1 : denominator === 2 ? 0.5 : 0.25;
}

export function resolvedOrdinaryDurationValue(event, orderedEvents, measure) {
  const storedDuration = numericFraction(event?.duration || [1, 4]);
  const atValue = numericFraction(event?.at || [0, 1]);
  let duration = Math.abs(storedDuration - DEFAULT_GRID_DURATION) <= EPSILON
    ? placeholderDurationForAt(event?.at)
    : storedDuration;

  const next = (orderedEvents || []).find(candidate => numericFraction(candidate?.at || [0, 1]) > atValue + EPSILON);
  const nextAt = next ? numericFraction(next.at) : Number.POSITIVE_INFINITY;
  const measureEnd = measureDurationInQuarterBeats(measure);
  const boundary = Math.min(nextAt, measureEnd);
  if (Number.isFinite(boundary) && boundary > atValue + EPSILON) {
    duration = Math.min(duration, boundary - atValue);
  }
  return Math.max(0, duration);
}

function meterBeamGroupDurations(measure, beamLevel = 1) {
  const signature = measure?.timeSignature || { numerator: 4, denominator: 4 };
  const numerator = Math.max(1, Math.trunc(Number(signature.numerator) || 4));
  const denominator = Math.max(1, Math.trunc(Number(signature.denominator) || 4));
  const unit = 4 / denominator;

  if (denominator === 4 && numerator === 3 && beamLevel === 1) return [3];
  if (denominator >= 8) {
    if (numerator === 3) return [3 * unit];
    if (numerator > 3 && numerator % 3 === 0) return Array.from({ length: numerator / 3 }, () => 3 * unit);
    if (numerator === 5) return [2 * unit, 3 * unit];
    if (numerator === 7) return [2 * unit, 2 * unit, 3 * unit];
  }
  return Array.from({ length: numerator }, () => unit);
}

export function ordinaryBeamGroupKey(measure, at, beamLevel = 1) {
  const value = numericFraction(at);
  const pattern = meterBeamGroupDurations(measure, beamLevel);
  let start = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const end = start + pattern[index];
    if (value < end - EPSILON || index === pattern.length - 1) return `meter:${beamLevel}:${index}`;
    start = end;
  }
  return `meter:${beamLevel}:${Math.max(0, pattern.length - 1)}`;
}

export function rhythmsAreContiguous(left, right) {
  if (!left || !right) return false;
  const leftAt = numericFraction(left.at);
  const rightAt = numericFraction(right.at);
  const duration = Number(left.durationValue);
  return Number.isFinite(duration) && Math.abs(leftAt + duration - rightAt) <= EPSILON;
}

export function rhythmPointsCanBeam(left, right, measure, beamLevel = 1) {
  if (!left || !right || Number(left.beams) < beamLevel || Number(right.beams) < beamLevel) return false;
  const leftGroup = String(left.group?.id || '');
  const rightGroup = String(right.group?.id || '');
  if (leftGroup || rightGroup) return Boolean(leftGroup && leftGroup === rightGroup);
  if (ordinaryBeamGroupKey(measure, left.at, beamLevel) !== ordinaryBeamGroupKey(measure, right.at, beamLevel)) return false;
  return rhythmsAreContiguous(left, right);
}
