import {
  ARTIFICIAL_HARMONIC_OFFSET,
  cloneValue,
  compareFractions,
  createId,
  fractionKey,
  harmonicTechnique,
  indexDocument,
  isDocumentV3,
  normalizeDocumentV3,
  normalizeFraction,
  noteBaseFret,
  relationNoteIds
} from './model.js';
import { applyThirtySecondRangeToMeasure, applyTripletRangeToMeasure } from './rhythm-grid.js';

export function createChangeSet({ measures = [], playback = [], relations = [], layoutFrom = null, document = false } = {}) {
  return {
    measures: [...new Set(measures.filter(Boolean).map(String))],
    playback: [...new Set(playback.filter(Boolean).map(String))],
    relations: [...new Set(relations.filter(Boolean).map(String))],
    layoutFrom: layoutFrom ? String(layoutFrom) : null,
    document: Boolean(document)
  };
}

export function mergeChangeSets(...sets) {
  const measures = [];
  const playback = [];
  const relations = [];
  let layoutFrom = null;
  let document = false;
  for (const set of sets.filter(Boolean)) {
    measures.push(...(set.measures || []));
    playback.push(...(set.playback || []));
    relations.push(...(set.relations || []));
    if (!layoutFrom && set.layoutFrom) layoutFrom = set.layoutFrom;
    document ||= Boolean(set.document);
  }
  return createChangeSet({ measures, playback, relations, layoutFrom, document });
}

function sourceDocument(document) {
  return isDocumentV3(document) ? document : normalizeDocumentV3(document);
}

function withMeasure(document, measureIndex, measure, extra = {}) {
  const measures = document.measures.slice();
  measures[measureIndex] = measure;
  return { ...document, measures, ...extra };
}

function findMeasureIndex(document, measureId) {
  return document.measures.findIndex(measure => measure.id === measureId);
}

function eventAt(measure, at) {
  const key = fractionKey(at);
  return measure.events.findIndex(event => fractionKey(event.at) === key);
}

function sortEvents(events) {
  events.sort((left, right) => compareFractions(left.at, right.at) || String(left.id).localeCompare(String(right.id)));
  return events;
}

function changedMeasure(measureId, { playback = true, relations = [], layoutFrom = null } = {}) {
  return createChangeSet({
    measures: [measureId],
    playback: playback ? [measureId] : [],
    relations,
    layoutFrom
  });
}

function pruneRelationsForMissingNotes(document, noteIds) {
  if (!noteIds?.size) return { relations: document.relations, removedRelationIds: [] };
  const removedRelationIds = [];
  const relations = (document.relations || []).filter(relation => {
    const remove = relationNoteIds(relation).some(id => noteIds.has(id));
    if (remove && relation.id) removedRelationIds.push(String(relation.id));
    return !remove;
  });
  return { relations, removedRelationIds };
}

function setExistingNoteFret(note, fret) {
  const harmonic = harmonicTechnique(note);
  if (!harmonic) return { ...note, fret };

  const numericFret = Number(fret);
  if (!Number.isFinite(numericFret)) {
    return {
      ...note,
      fret,
      techniques: (note.techniques || []).filter(technique => technique.id !== harmonic.id)
    };
  }

  return {
    ...note,
    fret: '',
    techniques: (note.techniques || []).map(technique => technique.id === harmonic.id
      ? { ...technique, touchFret: Math.trunc(numericFret) + ARTIFICIAL_HARMONIC_OFFSET }
      : technique)
  };
}

function noteSet(document, command, idFactory) {
  const measureIndex = findMeasureIndex(document, command.measureId);
  if (measureIndex < 0) return { document, changeSet: createChangeSet() };
  const measure = cloneValue(document.measures[measureIndex]);
  const at = normalizeFraction(command.at, [0, 1]);
  let eventIndex = eventAt(measure, at);
  const fret = String(command.fret ?? '').trim();
  const string = Math.max(0, Math.min(5, Math.trunc(Number(command.string) || 0)));
  const removedNotes = new Set();

  if (eventIndex < 0 && fret !== '') {
    measure.events.push({
      id: idFactory('e'),
      at,
      duration: normalizeFraction(command.duration, [1, 4]),
      notes: [],
      marks: []
    });
    sortEvents(measure.events);
    eventIndex = eventAt(measure, at);
  }

  if (eventIndex >= 0) {
    const event = { ...measure.events[eventIndex], notes: cloneValue(measure.events[eventIndex].notes || []) };
    const noteIndex = event.notes.findIndex(note => Number(note.string) === string);
    if (fret === '') {
      if (noteIndex >= 0) {
        removedNotes.add(String(event.notes[noteIndex].id));
        event.notes.splice(noteIndex, 1);
      }
    } else if (noteIndex >= 0) {
      event.notes[noteIndex] = setExistingNoteFret(event.notes[noteIndex], fret);
    } else {
      event.notes.push({ id: idFactory('n'), string, fret, techniques: [] });
      event.notes.sort((left, right) => Number(left.string) - Number(right.string));
    }

    if (event.notes.length) event.rhythmOnly = false;
    else if (event.rhythmAnchor) event.rhythmOnly = true;

    if (!event.notes.length && !(event.marks || []).length && !event.rhythmAnchor) measure.events.splice(eventIndex, 1);
    else measure.events[eventIndex] = event;
  }

  let next = withMeasure(document, measureIndex, measure);
  const pruned = pruneRelationsForMissingNotes(next, removedNotes);
  if (pruned.relations !== next.relations) next = { ...next, relations: pruned.relations };
  return {
    document: next,
    changeSet: changedMeasure(measure.id, { relations: pruned.removedRelationIds })
  };
}

function updateEvent(document, eventId, updater, { playback = true } = {}) {
  for (let measureIndex = 0; measureIndex < document.measures.length; measureIndex++) {
    const sourceMeasure = document.measures[measureIndex];
    const eventIndex = sourceMeasure.events.findIndex(event => event.id === eventId);
    if (eventIndex < 0) continue;
    const measure = cloneValue(sourceMeasure);
    measure.events[eventIndex] = updater(measure.events[eventIndex]);
    return {
      document: withMeasure(document, measureIndex, measure),
      changeSet: changedMeasure(measure.id, { playback })
    };
  }
  return { document, changeSet: createChangeSet() };
}

function updateNote(document, noteId, updater, { playback = false } = {}) {
  for (let measureIndex = 0; measureIndex < document.measures.length; measureIndex++) {
    const sourceMeasure = document.measures[measureIndex];
    for (let eventIndex = 0; eventIndex < sourceMeasure.events.length; eventIndex++) {
      const noteIndex = sourceMeasure.events[eventIndex].notes.findIndex(note => note.id === noteId);
      if (noteIndex < 0) continue;
      const measure = cloneValue(sourceMeasure);
      measure.events[eventIndex].notes[noteIndex] = updater(measure.events[eventIndex].notes[noteIndex]);
      return {
        document: withMeasure(document, measureIndex, measure),
        changeSet: changedMeasure(measure.id, { playback })
      };
    }
  }
  return { document, changeSet: createChangeSet() };
}

function deleteNote(document, noteId) {
  for (let measureIndex = 0; measureIndex < document.measures.length; measureIndex++) {
    const sourceMeasure = document.measures[measureIndex];
    for (let eventIndex = 0; eventIndex < sourceMeasure.events.length; eventIndex++) {
      const noteIndex = sourceMeasure.events[eventIndex].notes.findIndex(note => note.id === noteId);
      if (noteIndex < 0) continue;
      const measure = cloneValue(sourceMeasure);
      const event = measure.events[eventIndex];
      event.notes.splice(noteIndex, 1);
      if (!event.notes.length && !(event.marks || []).length) measure.events.splice(eventIndex, 1);
      let next = withMeasure(document, measureIndex, measure);
      const pruned = pruneRelationsForMissingNotes(next, new Set([String(noteId)]));
      next = { ...next, relations: pruned.relations };
      return {
        document: next,
        changeSet: changedMeasure(measure.id, { playback: true, relations: pruned.removedRelationIds })
      };
    }
  }
  return { document, changeSet: createChangeSet() };
}

function sameEntityPayload(left, right) {
  const clean = value => {
    const copy = cloneValue(value || {});
    delete copy.id;
    return copy;
  };
  return JSON.stringify(clean(left)) === JSON.stringify(clean(right));
}

function addTechnique(document, command, idFactory) {
  return updateNote(document, String(command.noteId || ''), note => {
    const raw = cloneValue(command.technique || {});
    const techniques = Array.isArray(note.techniques) ? cloneValue(note.techniques) : [];

    if (raw.type === 'harmonic') {
      const baseFret = Number(noteBaseFret(note));
      const requestedTouch = Number(raw.touchFret);
      const touchFret = Number.isFinite(requestedTouch)
        ? Math.trunc(requestedTouch)
        : Number.isFinite(baseFret)
          ? Math.trunc(baseFret) + ARTIFICIAL_HARMONIC_OFFSET
          : NaN;
      if (!Number.isFinite(touchFret) || touchFret < ARTIFICIAL_HARMONIC_OFFSET) return note;
      const technique = {
        id: String(raw.id || idFactory('t')),
        type: 'harmonic',
        touchFret
      };
      return {
        ...note,
        fret: '',
        techniques: [...techniques.filter(item => item.type !== 'harmonic'), technique]
      };
    }

    const technique = { ...raw, id: String(raw.id || idFactory('t')) };
    if (techniques.some(item => sameEntityPayload(item, technique))) return note;
    return { ...note, techniques: [...techniques, technique] };
  }, { playback: true });
}

function deleteTechnique(document, techniqueId) {
  const location = indexDocument(document).techniqueById.get(String(techniqueId || ''));
  if (!location) return { document, changeSet: createChangeSet() };
  return updateNote(document, location.noteId, note => {
    const removed = (note.techniques || []).find(item => item.id === techniqueId);
    const techniques = (note.techniques || []).filter(item => item.id !== techniqueId);
    if (removed?.type === 'harmonic') return { ...note, fret: noteBaseFret(note), techniques };
    return { ...note, techniques };
  }, { playback: true });
}

function deleteTechniqueByType(document, noteId, techniqueType) {
  return updateNote(document, String(noteId || ''), note => {
    const removed = (note.techniques || []).filter(item => item.type === techniqueType);
    const techniques = (note.techniques || []).filter(item => item.type !== techniqueType);
    if (removed.some(item => item.type === 'harmonic')) return { ...note, fret: noteBaseFret(note), techniques };
    return { ...note, techniques };
  }, { playback: true });
}

function addMark(document, command, idFactory) {
  return updateEvent(document, String(command.eventId || ''), event => {
    const raw = cloneValue(command.mark || {});
    const marks = Array.isArray(event.marks) ? cloneValue(event.marks) : [];
    const mark = { ...raw, id: String(raw.id || idFactory('mk')) };
    if (marks.some(item => sameEntityPayload(item, mark))) return event;

    const isSweep = ['strum', 'arpeggio'].includes(mark.type);
    const retained = isSweep
      ? marks.filter(item => !['strum', 'arpeggio'].includes(item.type))
      : marks;
    return { ...event, marks: [...retained, mark] };
  }, { playback: false });
}

function deleteMark(document, markId) {
  const location = indexDocument(document).markById.get(String(markId || ''));
  if (!location) return { document, changeSet: createChangeSet() };
  return updateEvent(document, location.eventId, event => ({
    ...event,
    marks: (event.marks || []).filter(mark => mark.id !== markId)
  }), { playback: false });
}

function applyRhythmRange(document, command, idFactory, transformer) {
  const measureIndex = findMeasureIndex(document, command.measureId);
  if (measureIndex < 0) return { document, changeSet: createChangeSet() };
  const sourceMeasure = document.measures[measureIndex];
  const transformed = transformer(sourceMeasure, {
    startAt: normalizeFraction(command.startAt, [0, 1]),
    endAt: normalizeFraction(command.endAt, [0, 1])
  }, idFactory);
  if (!transformed.ok) return { document, changeSet: createChangeSet() };
  return {
    document: withMeasure(document, measureIndex, transformed.measure),
    changeSet: changedMeasure(sourceMeasure.id, { playback: true })
  };
}

function addGroup(document, command, idFactory) {
  const measureIndex = findMeasureIndex(document, command.measureId);
  if (measureIndex < 0) return { document, changeSet: createChangeSet() };
  const measure = cloneValue(document.measures[measureIndex]);
  const raw = cloneValue(command.group || {});
  const group = { ...raw, id: String(raw.id || idFactory('g')) };
  if (measure.groups.some(item => sameEntityPayload(item, group))) {
    return { document, changeSet: createChangeSet() };
  }
  measure.groups.push(group);
  return { document: withMeasure(document, measureIndex, measure), changeSet: changedMeasure(measure.id) };
}

function deleteGroup(document, groupId) {
  const location = indexDocument(document).groupById.get(String(groupId || ''));
  if (!location) return { document, changeSet: createChangeSet() };
  const measure = cloneValue(document.measures[location.measureIndex]);
  measure.groups = (measure.groups || []).filter(group => group.id !== groupId);
  return {
    document: withMeasure(document, location.measureIndex, measure),
    changeSet: changedMeasure(measure.id)
  };
}

function replaceMeasureContent(document, command) {
  const measureIndex = findMeasureIndex(document, command.measureId);
  if (measureIndex < 0) return { document, changeSet: createChangeSet() };
  const source = command.measure || {};
  const target = document.measures[measureIndex];
  const replacement = {
    ...cloneValue(target),
    ...cloneValue(source),
    id: target.id
  };
  const removedNotes = new Set();
  for (const event of target.events || []) for (const note of event.notes || []) removedNotes.add(String(note.id));
  let next = withMeasure(document, measureIndex, replacement);
  const pruned = pruneRelationsForMissingNotes(next, removedNotes);
  next = { ...next, relations: pruned.relations };
  return {
    document: next,
    changeSet: changedMeasure(target.id, { relations: pruned.removedRelationIds })
  };
}

function addRelation(document, command, idFactory) {
  const index = indexDocument(document);
  const relation = { ...cloneValue(command.relation || {}) };
  relation.id = String(relation.id || idFactory('r'));
  const noteIds = relationNoteIds(relation);
  if (!noteIds.length || noteIds.some(id => !index.noteById.has(id))) return { document, changeSet: createChangeSet() };
  if ((document.relations || []).some(item => sameEntityPayload(item, relation))) return { document, changeSet: createChangeSet() };
  const measures = [...new Set(noteIds.map(id => index.noteLocation.get(id)?.measureId).filter(Boolean))];
  return {
    document: { ...document, relations: [...(document.relations || []), relation] },
    changeSet: createChangeSet({ measures, relations: [relation.id] })
  };
}

function deleteRelation(document, relationId) {
  const relation = (document.relations || []).find(item => item.id === relationId);
  if (!relation) return { document, changeSet: createChangeSet() };
  const index = indexDocument(document);
  const measures = [...new Set(relationNoteIds(relation).map(id => index.noteLocation.get(id)?.measureId).filter(Boolean))];
  return {
    document: { ...document, relations: document.relations.filter(item => item.id !== relationId) },
    changeSet: createChangeSet({ measures, relations: [relationId] })
  };
}

function insertMeasure(document, command, idFactory) {
  const targetIndex = command.index != null
    ? Math.max(0, Math.min(document.measures.length, Math.trunc(Number(command.index))))
    : Math.max(0, findMeasureIndex(document, command.measureId) + (command.side === 'before' ? 0 : 1));
  const reference = document.measures[Math.max(0, Math.min(document.measures.length - 1, targetIndex - 1))];
  const measure = {
    id: idFactory('m'),
    timeSignature: cloneValue(command.timeSignature || reference?.timeSignature || { numerator: 4, denominator: 4 }),
    events: [],
    groups: []
  };
  const measures = document.measures.slice();
  measures.splice(targetIndex, 0, measure);
  return {
    document: { ...document, measures },
    changeSet: createChangeSet({ measures: [measure.id], playback: [measure.id], layoutFrom: measure.id })
  };
}

function deleteMeasure(document, measureId) {
  if (document.measures.length <= 1) return { document, changeSet: createChangeSet() };
  const measureIndex = findMeasureIndex(document, measureId);
  if (measureIndex < 0) return { document, changeSet: createChangeSet() };
  const removed = document.measures[measureIndex];
  const noteIds = new Set();
  removed.events.forEach(event => event.notes.forEach(note => noteIds.add(String(note.id))));
  const measures = document.measures.slice();
  measures.splice(measureIndex, 1);
  let next = { ...document, measures };
  const pruned = pruneRelationsForMissingNotes(next, noteIds);
  const breaks = (document.layout?.systemBreakAfter || []).filter(id => id !== measureId);
  next = { ...next, relations: pruned.relations, layout: { ...(document.layout || {}), systemBreakAfter: breaks } };
  return {
    document: next,
    changeSet: createChangeSet({
      measures: [measureId],
      playback: [measureId],
      relations: pruned.removedRelationIds,
      layoutFrom: measures[Math.max(0, measureIndex - 1)]?.id || measures[0]?.id
    })
  };
}

function moveMeasure(document, command) {
  const from = findMeasureIndex(document, command.measureId);
  if (from < 0) return { document, changeSet: createChangeSet() };
  const measures = document.measures.slice();
  const [measure] = measures.splice(from, 1);
  let to = command.toIndex != null ? Math.trunc(Number(command.toIndex)) : findMeasureIndex(document, command.beforeMeasureId);
  if (!Number.isInteger(to) || to < 0) to = measures.length;
  if (from < to) to -= 1;
  to = Math.max(0, Math.min(measures.length, to));
  measures.splice(to, 0, measure);
  return {
    document: { ...document, measures },
    changeSet: createChangeSet({ measures: [measure.id], playback: [measure.id], layoutFrom: measure.id })
  };
}

export function applyCommand(inputDocument, command, { idFactory = createId } = {}) {
  const document = sourceDocument(inputDocument);
  if (!command || typeof command !== 'object') return { document, changeSet: createChangeSet() };

  switch (command.type) {
    case 'note/set':
      return noteSet(document, command, idFactory);
    case 'note/delete':
      return deleteNote(document, String(command.noteId || ''));
    case 'note/technique/add':
      return addTechnique(document, command, idFactory);
    case 'technique/delete':
      return deleteTechnique(document, String(command.techniqueId || ''));
    case 'note/technique/remove':
      return command.techniqueId
        ? deleteTechnique(document, String(command.techniqueId))
        : deleteTechniqueByType(document, String(command.noteId || ''), String(command.techniqueType || ''));
    case 'event/duration/set':
      return updateEvent(document, String(command.eventId || ''), event => ({
        ...event,
        duration: normalizeFraction(command.duration, event.duration)
      }));
    case 'rhythm/triplet/apply':
      return applyRhythmRange(document, command, idFactory, applyTripletRangeToMeasure);
    case 'rhythm/32nd/apply':
      return applyRhythmRange(document, command, idFactory, applyThirtySecondRangeToMeasure);
    case 'event/mark/add':
      return addMark(document, command, idFactory);
    case 'mark/delete':
      return deleteMark(document, String(command.markId || ''));
    case 'group/add':
      return addGroup(document, command, idFactory);
    case 'group/delete':
      return deleteGroup(document, String(command.groupId || ''));
    case 'relation/add':
      return addRelation(document, command, idFactory);
    case 'relation/delete':
      return deleteRelation(document, String(command.relationId || ''));
    case 'measure/insert':
      return insertMeasure(document, command, idFactory);
    case 'measure/delete':
      return deleteMeasure(document, String(command.measureId || ''));
    case 'measure/move':
      return moveMeasure(document, command);
    case 'measure/replace-content':
      return replaceMeasureContent(document, command);
    case 'document/replace': {
      const next = normalizeDocumentV3(command.document);
      return {
        document: next,
        changeSet: createChangeSet({
          document: true,
          measures: next.measures.map(measure => measure.id),
          playback: next.measures.map(measure => measure.id)
        })
      };
    }
    default:
      return { document, changeSet: createChangeSet() };
  }
}
