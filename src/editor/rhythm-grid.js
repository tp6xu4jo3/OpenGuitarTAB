import {
  addFractions,
  cloneValue,
  compareFractions,
  fractionKey,
  normalizeFraction
} from './model.js';

export const SIXTEENTH = Object.freeze([1, 4]);
export const THIRTY_SECOND = Object.freeze([1, 8]);

function subtractFractions(left, right) {
  const [a, b] = normalizeFraction(left);
  const [c, d] = normalizeFraction(right);
  return normalizeFraction([a * d - c * b, b * d]);
}

function multiplyFraction(value, numerator, denominator = 1) {
  const [a, b] = normalizeFraction(value);
  return normalizeFraction([a * Number(numerator), b * Number(denominator)]);
}

export function rangeEndExclusive(endAt, cellDuration = SIXTEENTH) {
  return addFractions(normalizeFraction(endAt), normalizeFraction(cellDuration));
}

export function inHalfOpenRange(at, startAt, endExclusive) {
  return compareFractions(at, startAt) >= 0 && compareFractions(at, endExclusive) < 0;
}

export function tripletRange(startAt, endAt) {
  const start = compareFractions(startAt, endAt) <= 0 ? normalizeFraction(startAt) : normalizeFraction(endAt);
  const end = compareFractions(startAt, endAt) <= 0 ? normalizeFraction(endAt) : normalizeFraction(startAt);
  const endExclusive = rangeEndExclusive(end);
  const span = subtractFractions(endExclusive, start);
  const duration = multiplyFraction(span, 1, 3);
  return {
    startAt: start,
    endAt: end,
    endExclusive,
    duration,
    slots: [
      start,
      addFractions(start, duration),
      addFractions(start, multiplyFraction(duration, 2))
    ]
  };
}

export function thirtySecondRange(startAt, endAt) {
  const start = compareFractions(startAt, endAt) <= 0 ? normalizeFraction(startAt) : normalizeFraction(endAt);
  const end = compareFractions(startAt, endAt) <= 0 ? normalizeFraction(endAt) : normalizeFraction(startAt);
  if (compareFractions(subtractFractions(end, start), SIXTEENTH) !== 0) return null;
  return {
    startAt: start,
    endAt: end,
    endExclusive: end,
    duration: [...THIRTY_SECOND],
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

function tupletSpan(group) {
  if (Array.isArray(group?.startAt) && Array.isArray(group?.endExclusive)) {
    return { startAt: group.startAt, endExclusive: group.endExclusive };
  }
  if (Array.isArray(group?.slots) && group.slots.length) {
    const startAt = group.slots[0];
    const last = group.slots[group.slots.length - 1];
    const duration = Array.isArray(group?.duration) ? group.duration : [1, 3];
    return { startAt, endExclusive: addFractions(last, duration) };
  }
  return null;
}

function removeOverlappingTuplets(groups, startAt, endExclusive) {
  return (groups || []).filter(group => {
    if (group?.type !== 'tuplet') return true;
    const span = tupletSpan(group);
    return !span || !rangesOverlap(span.startAt, span.endExclusive, startAt, endExclusive);
  });
}

export function applyTripletRangeToMeasure(measure, { startAt, endAt }, idFactory) {
  const range = tripletRange(startAt, endAt);
  const selected = eventsInTimeRange(measure, range.startAt, range.endExclusive);
  if (selected.length > 3) return { ok: false, reason: 'too-many-events', measure };

  const slotIndexes = selected.length === 2 ? [0, 2] : selected.map((_, index) => index);
  const remappedIds = new Set(selected.map(event => String(event.id)));
  const events = (measure.events || []).map(event => {
    const selectedIndex = selected.findIndex(item => String(item.id) === String(event.id));
    if (selectedIndex < 0) return cloneValue(event);
    return {
      ...cloneValue(event),
      at: [...range.slots[slotIndexes[selectedIndex]]],
      duration: [...range.duration],
      rhythmOnly: Boolean(event.rhythmOnly && !(event.notes || []).length)
    };
  });
  events.sort((left, right) => compareFractions(left.at, right.at) || String(left.id).localeCompare(String(right.id)));

  const group = {
    id: String(idFactory('g')),
    type: 'tuplet',
    ratio: [3, 2],
    startAt: [...range.startAt],
    endAt: [...range.endAt],
    endExclusive: [...range.endExclusive],
    duration: [...range.duration],
    slots: range.slots.map(slot => [...slot]),
    eventIds: events.filter(event => remappedIds.has(String(event.id))).map(event => String(event.id))
  };

  return {
    ok: true,
    range,
    measure: {
      ...cloneValue(measure),
      events,
      groups: [...removeOverlappingTuplets(measure.groups, range.startAt, range.endExclusive), group]
    },
    group
  };
}

export function applyThirtySecondRangeToMeasure(measure, { startAt, endAt }, idFactory) {
  const range = thirtySecondRange(startAt, endAt);
  if (!range) return { ok: false, reason: 'adjacent-sixteenth-required', measure };

  const byAt = new Map((measure.events || []).map(event => [fractionKey(event.at), cloneValue(event)]));
  for (const slot of range.slots) {
    const key = fractionKey(slot);
    const existing = byAt.get(key);
    if (existing) {
      byAt.set(key, {
        ...existing,
        at: [...slot],
        duration: [...THIRTY_SECOND],
        rhythmOnly: Boolean(existing.rhythmOnly && !(existing.notes || []).length)
      });
    } else {
      byAt.set(key, {
        id: String(idFactory('e')),
        at: [...slot],
        duration: [...THIRTY_SECOND],
        notes: [],
        marks: [],
        rhythmOnly: true
      });
    }
  }

  const events = [...byAt.values()]
    .sort((left, right) => compareFractions(left.at, right.at) || String(left.id).localeCompare(String(right.id)));

  return {
    ok: true,
    range,
    measure: { ...cloneValue(measure), events }
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
    if ((numerator * 4) % denominator !== 0 || event.rhythmOnly) add(event.at, 'event', event.duration);
  }
  for (const group of measure?.groups || []) {
    if (group?.type !== 'tuplet') continue;
    for (const slot of group.slots || []) add(slot, 'tuplet', group.duration);
  }

  return [...result.values()]
    .sort((left, right) => compareFractions(left.at, right.at))
    .map(item => ({ at: item.at, kinds: [...item.kinds], duration: item.duration }));
}

export function isTimeInsideTupletReplacement(measure, at) {
  for (const group of measure?.groups || []) {
    if (group?.type !== 'tuplet' || !Array.isArray(group.startAt) || !Array.isArray(group.endExclusive)) continue;
    if (!inHalfOpenRange(at, group.startAt, group.endExclusive)) continue;
    if ((group.slots || []).some(slot => compareFractions(slot, at) === 0)) return false;
    return true;
  }
  return false;
}
