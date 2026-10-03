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

const OPEN_STRING_SEMITONES = [64, 59, 55, 50, 45, 40];

function notePitchSemitone(note) {
  const string = Number(note?.string);
  const fret = Number(noteSoundingFret(note));
  if (!Number.isInteger(string) || string < 0 || string >= OPEN_STRING_SEMITONES.length || !Number.isFinite(fret)) return null;
  return OPEN_STRING_SEMITONES[string] + fret;
}

function relationEffects(document) {
  const noteContext = new Map();
  const notesByPosition = new Map();
  let measureStartBeat = 0;
  for (const measure of document.measures || []) {
    for (const event of measure.events || []) {
      const absoluteBeat = measureStartBeat + eventTime(event);
      const positionKey = `${String(measure.id)}|${fractionKey(event.at)}`;
      const contexts = notesByPosition.get(positionKey) || [];
      for (const note of event.notes || []) {
        const context = {
          note,
          event,
          absoluteBeat,
          endBeat: absoluteBeat + eventDuration(event)
        };
        noteContext.set(String(note.id), context);
        contexts.push(context);
      }
      notesByPosition.set(positionKey, contexts);
    }
    measureStartBeat += measureDurationInBeats(measure);
  }

  const effects = new Map();
  for (const relation of document.relations || []) {
    const relationId = String(relation?.id || '');
    if (relation?.type === 'slide' && relation.fromNoteId && relation.toNoteId) {
      const from = noteContext.get(String(relation.fromNoteId));
      const to = noteContext.get(String(relation.toNoteId));
      if (!from || !to || Number(from.note.string) !== Number(to.note.string)) continue;
      const durationBeats = to.absoluteBeat - from.absoluteBeat;
      if (!(durationBeats > 0)) continue;
      const fromEffect = effects.get(String(from.note.id)) || {};
      fromEffect.slide = {
        relationId,
        toFret: noteSoundingFret(to.note),
        durationBeats
      };
      effects.set(String(from.note.id), fromEffect);
      const toEffect = effects.get(String(to.note.id)) || {};
      toEffect.slideArrivalRelationId = relationId;
      effects.set(String(to.note.id), toEffect);
      continue;
    }

    if (relation?.type !== 'arc' || !relation.fromNoteId || !relation.toPosition?.measureId || !relation.toPosition?.at) continue;
    const from = noteContext.get(String(relation.fromNoteId));
    if (!from) continue;
    const targetPositionKey = `${String(relation.toPosition.measureId)}|${fractionKey(relation.toPosition.at)}`;
    const sourcePitch = notePitchSemitone(from.note);
    if (sourcePitch == null) continue;
    const candidates = (notesByPosition.get(targetPositionKey) || [])
      .filter(context => notePitchSemitone(context.note) === sourcePitch && context.absoluteBeat > from.absoluteBeat);
    const to = candidates.find(context => Number(context.note.string) === Number(from.note.string)) || candidates[0];
    if (!to) continue;

    const fromEffect = effects.get(String(from.note.id)) || {};
    fromEffect.arcSustain = {
      relationId,
      toNoteId: String(to.note.id),
      durationBeats: Math.max(0, to.endBeat - from.absoluteBeat)
    };
    effects.set(String(from.note.id), fromEffect);

    const toEffect = effects.get(String(to.note.id)) || {};
    toEffect.arcArrivalRelationId = relationId;
    effects.set(String(to.note.id), toEffect);
  }
  return effects;
}

function playbackNotes(notes, effects) {
  return (notes || []).map(note => {
    const effect = effects.get(String(note.id)) || null;
    return {
      ...cloneValue(note),
      fret: noteSoundingFret(note),
      ...(effect?.slide ? { slide: cloneValue(effect.slide) } : {}),
      ...(effect?.slideArrivalRelationId ? { slideArrivalRelationId: effect.slideArrivalRelationId } : {}),
      ...(effect?.arcSustain ? { arcSustain: cloneValue(effect.arcSustain) } : {}),
      ...(effect?.arcArrivalRelationId ? { arcArrivalRelationId: effect.arcArrivalRelationId } : {})
    };
  });
}

function playbackEvent(event, slotStart, effects) {
  const atBeats = eventTime(event);
  return {
    eventId: String(event.id || ''),
    at: cloneValue(event.at),
    duration: cloneValue(event.duration),
    atBeats,
    offsetBeats: Math.max(0, atBeats - slotStart),
    durationBeats: eventDuration(event),
    notes: playbackNotes(event.notes, effects),
    marks: cloneValue(event.marks || [])
  };
}

export function buildPlaybackIndex(documentModel) {
  const document = normalizeDocumentV3(documentModel);
  const locations = locationMap(document);
  const effects = relationEffects(document);
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
      const slotEvents = (eventsByTime.get(fractionKey(time.at)) || []).map(event => playbackEvent(event, atBeats, effects));
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
