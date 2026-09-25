import {
  addFractions,
  cloneValue,
  compareFractions,
  fractionKey,
  normalizeFraction
} from './model.js';

export const SIXTEENTH = Object.freeze([1, 4]);
export const THIRTY_SECOND = Object.freeze([1, 8]);
export const EIGHTH_TRIPLET = Object.freeze([1, 3]);
export const SIXTEENTH_TRIPLET = Object.freeze([1, 6]);

function subtractFractions(left, right) {
  const [a, b] = normalizeFraction(left);
  const [c, d] = normalizeFraction(right);
  return normalizeFraction([a * d - c * b, b * d]);
}

function multiplyFraction(value, numerator, denominator = 1) {
  const [a, b] = normalizeFraction(value);
  return normalizeFraction([a * Number(numerator), b * Number(denominator)]);
}

function divisionSlots(startAt, duration, count) {
  return Array.from({ length: count }, (_, index) => addFractions(startAt, multiplyFraction(duration, index)));
}

function measureDurationFraction(measure) {
  const numerator = Math.max(1, Math.trunc(Number(measure?.timeSignature?.numerator) || 4));
  const denominator = Math.max(1, Math.trunc(Number(measure?.timeSignature?.denominator) || 4));
  return normalizeFraction([numerator * 4, denominator]);
}

export function inHalfOpenRange(at, startAt, endExclusive) {
  return compareFractions(at, startAt) >= 0 && compareFractions(at, endExclusive) < 0;
}

export function tripletFromStart(startAt, subdivision = 'eighth') {
  const start = normalizeFraction(startAt);
  const fast = subdivision === 'sixteenth';
  const span = fast ? [1, 2] : [1, 1];
  const duration = fast ? SIXTEENTH_TRIPLET : EIGHTH_TRIPLET;
  return {
    startAt: start,
    endExclusive: addFractions(start, span),
    duration: [...duration],
    subdivision: fast ? 'sixteenth' : 'eighth',
    beamCount: fast ? 2 : 1,
    slots: divisionSlots(start, duration, 3)
  };
}

export function thirtySecondFromStart(startAt) {
  const start = normalizeFraction(startAt);
  return {
    startAt: start,
    endExclusive: addFractions(start, SIXTEENTH),
    duration: [...THIRTY_SECOND],
    subdivision: 'thirty-second',
    beamCount: 3,
    slots: [start, addFractions(start, THIRTY_SECOND)]
  };
}

export function eventsInTimeRange(measure, startAt, endExclusive) {
  return (measure?.events || [])
    .filter(event => inHalfOpenRange(event.at, startAt, endExclusive))
    .sort((left, right) => compareFractions(left.at, right.at) || String(left.id).localeCompare(String(right.id)));
}

function rangesOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  return compareFractions(leftStart, rightEnd) < 0 && compareFractions(rightStart, leftEnd) < 0;
}

function groupSpan(group) {
  if (Array.isArray(group?.startAt) && Array.isArray(group?.endExclusive)) {
    return { startAt: group.startAt, endExclusive: group.endExclusive };
  }
  if (Array.isArray(group?.slots) && group.slots.length) {
    const startAt = group.slots[0];
    const last = group.slots[group.slots.length - 1];
    const duration = Array.isArray(group?.duration) ? group.duration : SIXTEENTH;
    return { startAt, endExclusive: addFractions(last, duration) };
  }
  return null;
}

function removeOverlappingRhythmGroups(groups, startAt, endExclusive) {
  return (groups || []).filter(group => {
    if (!['tuplet', 'subdivision'].includes(group?.type)) return true;
    const span = groupSpan(group);
    return !span || !rangesOverlap(span.startAt, span.endExclusive, startAt, endExclusive);
  });
}

function mapEventsToSlots(measure, range, maxEvents) {
  const selected = eventsInTimeRange(measure, range.startAt, range.endExclusive)
    .filter(event => (event.notes || []).length || (event.marks || []).length || !event.rhythmOnly);
  if (selected.length > maxEvents) return null;
  const selectedIds = new Set(selected.map(event => String(event.id)));
  const slotIndexes = selected.length === 2 && maxEvents === 3 ? [0, 2] : selected.map((_, index) => index);
  const events = [];

  for (const source of measure.events || []) {
    if (!inHalfOpenRange(source.at, range.startAt, range.endExclusive)) {
      events.push(cloneValue(source));
      continue;
    }
    const selectedIndex = selected.findIndex(event => String(event.id) === String(source.id));
    if (selectedIndex < 0) continue;
    const slot = range.slots[slotIndexes[selectedIndex]];
    events.push({
      ...cloneValue(source),
      at: [...slot],
      duration: [...range.duration],
      rhythmAnchor: false,
      rhythmOnly: false
    });
  }

  events.sort((left, right) => compareFractions(left.at, right.at) || String(left.id).localeCompare(String(right.id)));
  return { events, selectedIds };
}

export function applyTripletAtToMeasure(measure, { startAt, subdivision = 'eighth' }, idFactory) {
  const range = tripletFromStart(startAt, subdivision);
  const mapped = mapEventsToSlots(measure, range, 3);
  if (!mapped) return { ok: false, reason: 'too-many-events', measure };
  const group = {
    id: String(idFactory('g')),
    type: 'tuplet',
    ratio: [3, 2],
    subdivision: range.subdivision,
    beamCount: range.beamCount,
    startAt: [...range.startAt],
    endExclusive: [...range.endExclusive],
    duration: [...range.duration],
    slots: range.slots.map(slot => [...slot]),
    eventIds: mapped.events
      .filter(event => mapped.selectedIds.has(String(event.id)))
      .map(event => String(event.id))
  };

  return {
    ok: true,
    range,
    group,
    measure: {
      ...cloneValue(measure),
      events: mapped.events,
      groups: [...removeOverlappingRhythmGroups(measure.groups, range.startAt, range.endExclusive), group]
    }
  };
}

export function applyThirtySecondAtToMeasure(measure, { startAt }, idFactory) {
  const range = thirtySecondFromStart(startAt);
  const mapped = mapEventsToSlots(measure, range, 2);
  if (!mapped) return { ok: false, reason: 'too-many-events', measure };
  const group = {
    id: String(idFactory('g')),
    type: 'subdivision',
    subdivision: 'thirty-second',
    beamCount: 3,
    startAt: [...range.startAt],
    endExclusive: [...range.endExclusive],
    duration: [...range.duration],
    slots: range.slots.map(slot => [...slot]),
    eventIds: mapped.events
      .filter(event => mapped.selectedIds.has(String(event.id)))
      .map(event => String(event.id))
  };

  return {
    ok: true,
    range,
    group,
    measure: {
      ...cloneValue(measure),
      events: mapped.events,
      groups: [...removeOverlappingRhythmGroups(measure.groups, range.startAt, range.endExclusive), group]
    }
  };
}

export function fractionalGridTimes(measure) {
  const result = new Map();
  const add = (at, kind, duration = null) => {
    if (!Array.isArray(at)) return;
    const key = fractionKey(at);
    const existing = result.get(key) || { at: normalizeFraction(at), kinds: new Set(), duration: null };
    existing.kinds.add(kind);
    if (duration) existing.duration = normalizeFraction(duration);
    result.set(key, existing);
  };

  for (const event of measure?.events || []) {
    const [numerator, denominator] = normalizeFraction(event.at);
    if ((numerator * 4) % denominator !== 0 || event.rhythmAnchor || event.rhythmOnly) add(event.at, 'event', event.duration);
  }
  for (const group of measure?.groups || []) {
    if (!['tuplet', 'subdivision'].includes(group?.type)) continue;
    const kind = group.type === 'tuplet' ? 'tuplet' : String(group.subdivision || 'subdivision');
    for (const slot of group.slots || []) add(slot, kind, group.duration);
  }

  return [...result.values()]
    .sort((left, right) => compareFractions(left.at, right.at))
    .map(item => ({ at: item.at, kinds: [...item.kinds], duration: item.duration }));
}

export function isTimeReplacedByFractionalGrid(measure, at) {
  for (const group of measure?.groups || []) {
    if (!['tuplet', 'subdivision'].includes(group?.type)) continue;
    const span = groupSpan(group);
    if (span && inHalfOpenRange(at, span.startAt, span.endExclusive)) return true;
  }
  for (const event of measure?.events || []) {
    if (event?.rhythmAnchor && compareFractions(event.at, at) === 0) return true;
  }
  return false;
}

export function editableTimesForMeasure(measure, { baseStep = SIXTEENTH } = {}) {
  const step = normalizeFraction(baseStep, SIXTEENTH);
  const end = measureDurationFraction(measure);
  const result = new Map();
  const add = (at, duration = step) => {
    if (!Array.isArray(at) || compareFractions(at, [0, 1]) < 0 || compareFractions(at, end) >= 0) return;
    const normalizedAt = normalizeFraction(at);
    const key = fractionKey(normalizedAt);
    if (!result.has(key)) result.set(key, { at: normalizedAt, duration: normalizeFraction(duration || step, step) });
  };

  for (let at = [0, 1]; compareFractions(at, end) < 0; at = addFractions(at, step)) {
    if (!isTimeReplacedByFractionalGrid(measure, at)) add(at, step);
  }
  for (const time of fractionalGridTimes(measure)) add(time.at, time.duration || step);
  for (const event of measure?.events || []) add(event.at, event.duration || step);

  return [...result.values()].sort((left, right) => compareFractions(left.at, right.at));
}

export function rhythmRangeFitsMeasure(measure, range) {
  const beats = Number(measure?.timeSignature?.numerator || 4) * (4 / Number(measure?.timeSignature?.denominator || 4));
  return compareFractions(range.startAt, [0, 1]) >= 0 && compareFractions(range.endExclusive, [beats, 1]) <= 0;
}

export function rhythmicDistance(left, right) {
  return subtractFractions(right, left);
}
