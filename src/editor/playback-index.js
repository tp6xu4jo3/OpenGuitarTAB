import { buildSystems, measureDurationInBeats } from './layout.js';
import { cloneValue, fractionToNumber, normalizeDocumentV3, noteSoundingFret } from './model.js';

function eventTime(event) {
  return Math.max(0, fractionToNumber(event?.at || [0, 1]));
}

function eventDuration(event) {
  return Math.max(0, fractionToNumber(event?.duration || [0, 1]));
}

function locationMap(documentModel) {
  const locations = new Map();
  buildSystems(documentModel).forEach((system, rowIndex) => {
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

export function buildPlaybackIndex(documentModel) {
  const document = normalizeDocumentV3(documentModel);
  const locations = locationMap(document);
  const entries = [];
  let measureStartBeat = 0;

  document.measures.forEach((measure, measureIndex) => {
    const measureDurationBeats = measureDurationInBeats(measure);
    const location = locations.get(measure.id) || { rowIndex: 0, measureIndex };
    const events = [...(measure.events || [])].sort((a, b) => eventTime(a) - eventTime(b));

    events.forEach(event => {
      const atBeats = Math.min(measureDurationBeats, eventTime(event));
      entries.push({
        index: entries.length,
        eventId: event.id,
        measureId: measure.id,
        measureIndex,
        rowIndex: location.rowIndex,
        measureIndexInSystem: location.measureIndex,
        at: cloneValue(event.at),
        duration: cloneValue(event.duration),
        atBeats,
        durationBeats: eventDuration(event),
        measureDurationBeats,
        absoluteBeat: measureStartBeat + atBeats,
        notes: playbackNotes(event.notes),
        marks: cloneValue(event.marks || [])
      });
    });

    measureStartBeat += measureDurationBeats;
  });

  entries.sort((a, b) => a.absoluteBeat - b.absoluteBeat || a.measureIndex - b.measureIndex || a.atBeats - b.atBeats);
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
