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

function playbackEvent(event, beatStart) {
  const atBeats = eventTime(event);
  return {
    eventId: String(event.id || ''),
    at: cloneValue(event.at),
    duration: cloneValue(event.duration),
    atBeats,
    offsetBeats: Math.max(0, atBeats - beatStart),
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
    const wholeBeatCount = Math.max(1, Math.ceil(measureDurationBeats - 1e-9));
    const location = locations.get(measure.id) || { rowIndex: 0, measureIndex };
    const events = [...(measure.events || [])].sort((a, b) => eventTime(a) - eventTime(b));

    for (let beatIndex = 0; beatIndex < wholeBeatCount; beatIndex++) {
      const beatStart = beatIndex;
      const beatEnd = Math.min(measureDurationBeats, beatIndex + 1);
      const beatEvents = events
        .filter(event => {
          const at = eventTime(event);
          return at >= beatStart - 1e-9 && at < beatEnd - 1e-9;
        })
        .map(event => playbackEvent(event, beatStart));
      entries.push({
        index: entries.length,
        measureId: String(measure.id),
        measureIndex,
        rowIndex: location.rowIndex,
        measureIndexInSystem: location.measureIndex,
        at: [beatIndex, 1],
        atBeats: beatIndex,
        durationBeats: Math.max(0, beatEnd - beatStart),
        measureDurationBeats,
        absoluteBeat: measureStartBeat + beatStart,
        events: beatEvents
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
