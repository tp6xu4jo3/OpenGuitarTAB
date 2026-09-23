import { createChangeSet } from './commands.js';
import {
  cloneValue,
  createId,
  indexDocument,
  isDocumentV3,
  normalizeDocumentV3,
  relationNoteIds
} from './model.js';

function sourceDocument(document) {
  return isDocumentV3(document) ? document : normalizeDocumentV3(document);
}

function noteIdsInMeasures(measures) {
  const ids = new Set();
  for (const measure of measures || []) {
    for (const event of measure.events || []) {
      for (const note of event.notes || []) ids.add(String(note.id));
    }
  }
  return ids;
}

function internalRelations(document, noteIds) {
  return (document.relations || [])
    .filter(relation => {
      const ids = relationNoteIds(relation);
      return ids.length > 0 && ids.every(id => noteIds.has(id));
    })
    .map(cloneValue);
}

function cloneMeasureWithFreshIds(sourceMeasure, idFactory, { measureId = null } = {}) {
  const eventIdMap = new Map();
  const noteIdMap = new Map();
  const groupIdMap = new Map();

  const measure = cloneValue(sourceMeasure);
  measure.id = String(measureId || idFactory('m'));
  measure.events = (sourceMeasure.events || []).map(sourceEvent => {
    const event = cloneValue(sourceEvent);
    event.id = idFactory('e');
    eventIdMap.set(String(sourceEvent.id), event.id);
    event.marks = (sourceEvent.marks || []).map(sourceMark => ({
      ...cloneValue(sourceMark),
      id: idFactory('mk')
    }));
    event.notes = (sourceEvent.notes || []).map(sourceNote => {
      const note = cloneValue(sourceNote);
      note.id = idFactory('n');
      noteIdMap.set(String(sourceNote.id), note.id);
      note.techniques = (sourceNote.techniques || []).map(sourceTechnique => ({
        ...cloneValue(sourceTechnique),
        id: idFactory('t')
      }));
      return note;
    });
    return event;
  });
  measure.groups = (sourceMeasure.groups || []).map(sourceGroup => {
    const group = cloneValue(sourceGroup);
    group.id = idFactory('g');
    groupIdMap.set(String(sourceGroup.id || ''), group.id);
    if (Array.isArray(group.eventIds)) {
      group.eventIds = group.eventIds.map(id => eventIdMap.get(String(id))).filter(Boolean);
    }
    return group;
  });

  return { measure, eventIdMap, noteIdMap, groupIdMap };
}

function cloneRelationsWithMap(relations, noteIdMap, idFactory) {
  const copied = [];
  for (const source of relations || []) {
    const ids = relationNoteIds(source);
    if (!ids.length || ids.some(id => !noteIdMap.has(id))) continue;
    const relation = cloneValue(source);
    relation.id = idFactory('r');
    if (relation.fromNoteId) relation.fromNoteId = noteIdMap.get(String(relation.fromNoteId));
    if (relation.toNoteId) relation.toNoteId = noteIdMap.get(String(relation.toNoteId));
    if (Array.isArray(relation.noteIds)) relation.noteIds = relation.noteIds.map(id => noteIdMap.get(String(id))).filter(Boolean);
    copied.push(relation);
  }
  return copied;
}

function relationsWithoutNotes(document, removedNoteIds) {
  const removedRelationIds = [];
  const relations = (document.relations || []).filter(relation => {
    const remove = relationNoteIds(relation).some(id => removedNoteIds.has(id));
    if (remove && relation.id) removedRelationIds.push(String(relation.id));
    return !remove;
  });
  return { relations, removedRelationIds };
}

export class EditorClipboard {
  constructor() {
    this.payload = null;
  }

  clear() {
    this.payload = null;
  }

  has(type = null) {
    return Boolean(this.payload && (!type || this.payload.type === type));
  }

  copyMeasure(document, measureId) {
    const source = sourceDocument(document);
    const measure = source.measures.find(item => item.id === measureId);
    if (!measure) return null;
    const noteIds = noteIdsInMeasures([measure]);
    this.payload = {
      type: 'measure',
      measure: cloneValue(measure),
      relations: internalRelations(source, noteIds)
    };
    return cloneValue(this.payload);
  }

  copySystem(document, measureIds) {
    const source = sourceDocument(document);
    const requested = new Set((measureIds || []).map(String));
    const measures = source.measures.filter(measure => requested.has(String(measure.id)));
    if (!measures.length) return null;
    const noteIds = noteIdsInMeasures(measures);
    this.payload = {
      type: 'system',
      measures: cloneValue(measures),
      relations: internalRelations(source, noteIds)
    };
    return cloneValue(this.payload);
  }

  pasteMeasure(document, targetMeasureId, { idFactory = createId } = {}) {
    const source = sourceDocument(document);
    if (!this.has('measure')) return null;
    const targetIndex = source.measures.findIndex(measure => measure.id === targetMeasureId);
    if (targetIndex < 0) return null;

    const target = source.measures[targetIndex];
    const removedNoteIds = noteIdsInMeasures([target]);
    const cleaned = relationsWithoutNotes(source, removedNoteIds);
    const cloned = cloneMeasureWithFreshIds(this.payload.measure, idFactory, { measureId: target.id });
    const addedRelations = cloneRelationsWithMap(this.payload.relations, cloned.noteIdMap, idFactory);
    const measures = source.measures.slice();
    measures[targetIndex] = cloned.measure;
    const next = {
      ...source,
      measures,
      relations: [...cleaned.relations, ...addedRelations]
    };
    return {
      document: next,
      changeSet: createChangeSet({
        measures: [target.id],
        playback: [target.id],
        relations: [...cleaned.removedRelationIds, ...addedRelations.map(relation => relation.id)]
      })
    };
  }

  pasteSystem(document, targetMeasureIds, { idFactory = createId } = {}) {
    const source = sourceDocument(document);
    if (!this.has('system')) return null;
    const targetIds = (targetMeasureIds || []).map(String);
    if (!targetIds.length) return null;
    const indexes = targetIds.map(id => source.measures.findIndex(measure => measure.id === id));
    if (indexes.some(index => index < 0)) return null;
    const start = Math.min(...indexes);
    const end = Math.max(...indexes);
    if (end - start + 1 !== targetIds.length) return null;

    const removedMeasures = source.measures.slice(start, end + 1);
    const removedNoteIds = noteIdsInMeasures(removedMeasures);
    const cleaned = relationsWithoutNotes(source, removedNoteIds);
    const noteIdMap = new Map();
    const clonedMeasures = this.payload.measures.map(sourceMeasure => {
      const cloned = cloneMeasureWithFreshIds(sourceMeasure, idFactory);
      cloned.noteIdMap.forEach((value, key) => noteIdMap.set(key, value));
      return cloned.measure;
    });
    const addedRelations = cloneRelationsWithMap(this.payload.relations, noteIdMap, idFactory);

    const measures = source.measures.slice();
    measures.splice(start, targetIds.length, ...clonedMeasures);
    const liveMeasureIds = new Set(measures.map(measure => measure.id));
    const existingBreaks = (source.layout?.systemBreakAfter || []).filter(id => liveMeasureIds.has(id));
    const newBreak = clonedMeasures.at(-1)?.id || null;
    const systemBreakAfter = [...new Set([...existingBreaks, ...(newBreak ? [newBreak] : [])])];
    const next = {
      ...source,
      measures,
      relations: [...cleaned.relations, ...addedRelations],
      layout: { ...(source.layout || {}), systemBreakAfter }
    };
    return {
      document: next,
      changeSet: createChangeSet({
        measures: [...targetIds, ...clonedMeasures.map(measure => measure.id)],
        playback: clonedMeasures.map(measure => measure.id),
        relations: [...cleaned.removedRelationIds, ...addedRelations.map(relation => relation.id)],
        layoutFrom: clonedMeasures[0]?.id || measures[start]?.id
      })
    };
  }
}

export function cloneMeasurePayload(document, measureId) {
  const clipboard = new EditorClipboard();
  return clipboard.copyMeasure(document, measureId);
}

export function documentClipboardIndex(document) {
  return indexDocument(sourceDocument(document));
}
