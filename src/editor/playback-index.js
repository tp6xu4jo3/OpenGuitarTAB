import { buildSystems, measureDurationInBeats } from './layout.js';
import { cloneValue, fractionKey, fractionToNumber, normalizeDocumentV3, noteSoundingFret } from './model.js';
import { editableTimesForMeasure } from './rhythm-grid.js';

function eventTime(event) {
  return Math.max(0, fractionToNumber(event?.at || [0, 1]));
}

function eventDuration(event) {
  return Math.max(0, fractionToNumber(event?.duration || [0, 1]));
}

function locationMap(document) {
  const locations = new Map();
  buildSystems(document).forEach((system, rowIndex) => {
    system.forEach((measure, measureIndex) => {
      locations.set(measure.id, { rowIndex, measureIndex });
    });
  });
  return locations;
}

function playbackNotes(notes) {
  return (notes || []).map(note => ({
    ...cloneValue(note),
    fret: noteSoundingFret(note)
  }));
}

function playbackEvent(event, slotStart) {
  const atBeats = eventTime(event);
  return {
    eventId: String(event.id || ''),
    at: cloneValue(event.at),
    duration: cloneValue(event.duration),
    atBeats,
    offsetBeats: Math.max(0, atBeats - slotStart),
    durationBeats: eventDuration(event),
    notes: playbackNotes(event.notes),
    marks: cloneValue(event.marks || [])
  };
}

export function buildPlaybackIndex(documentModel) {
  const document = normalizeDocumentV3(documentModel);
  const locations = locationMap(document);
  const entries = [];
  let measureStartBeat = 0;

  document.measures.forEach((measure, measureIndex) => {
    const measureDurationBeats = measureDurationInBeats(measure);
    const location = locations.get(measure.id) || { rowIndex: 0, measureIndex };
    const eventsByTime = new Map();
    for (const event of measure.events || []) {
      const key = fractionKey(event.at);
      if (!eventsByTime.has(key)) eventsByTime.set(key, []);
      eventsByTime.get(key).push(event);
    }

    for (const time of editableTimesForMeasure(measure)) {
      const atBeats = Math.max(0, fractionToNumber(time.at));
      const durationBeats = Math.max(0.001, fractionToNumber(time.duration));
      const slotEvents = (eventsByTime.get(fractionKey(time.at)) || []).map(event => playbackEvent(event, atBeats));
      entries.push({
        index: entries.length,
        eventId: slotEvents[0]?.eventId || '',
        measureId: String(measure.id),
        measureIndex,
        rowIndex: location.rowIndex,
        measureIndexInSystem: location.measureIndex,
        at: cloneValue(time.at),
        atBeats,
        durationBeats,
        measureDurationBeats,
        absoluteBeat: measureStartBeat + atBeats,
        events: slotEvents,
        notes: slotEvents.flatMap(event => event.notes),
        marks: slotEvents.flatMap(event => event.marks)
      });
    }

    measureStartBeat += measureDurationBeats;
  });

  entries.forEach((entry, index) => { entry.index = index; });

  return {
    document,
    entries,
    totalBeats: measureStartBeat
  };
}

export function legacyPositionForEntry(entry, slotsPerBeat = 4) {
  if (!entry) return 0;
  const measureSlots = entry.measureDurationBeats * slotsPerBeat;
  return entry.measureIndexInSystem * measureSlots + entry.atBeats * slotsPerBeat;
}

export function nearestPlaybackIndex(playbackIndex, rowIndex, legacyPosition, slotsPerBeat = 4) {
  const entries = playbackIndex?.entries || [];
  if (!entries.length) return 0;
  const rowEntries = entries.filter(entry => entry.rowIndex === Number(rowIndex));
  const candidates = rowEntries.length ? rowEntries : entries;
  let best = candidates[0];
  let bestDistance = Infinity;
  candidates.forEach(entry => {
    const distance = Math.abs(legacyPositionForEntry(entry, slotsPerBeat) - Number(legacyPosition || 0));
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  });
  return best?.index || 0;
}
