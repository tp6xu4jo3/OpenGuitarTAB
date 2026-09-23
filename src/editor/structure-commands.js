import { cloneValue, createId, normalizeDocumentV3, relationNoteIds } from './model.js';
import { createChangeSet } from './commands.js';
import { buildSystems } from './layout.js';

function blankMeasure(reference, idFactory = createId) {
  return {
    id: idFactory('m'),
    timeSignature: cloneValue(reference?.timeSignature || { numerator: 4, denominator: 4 }),
    events: [],
    groups: []
  };
}

function normalizeSystems(document) {
  return buildSystems(normalizeDocumentV3(document)).map(system => system.map(cloneValue));
}

function flattenSystems(document, systems, { relations = document.relations || [] } = {}) {
  const measures = systems.flat();
  const systemBreakAfter = systems.map(system => system.at(-1)?.id).filter(Boolean);
  return normalizeDocumentV3({
    ...cloneValue(document),
    measures,
    relations: cloneValue(relations),
    layout: {
      ...(cloneValue(document.layout) || {}),
      systemBreakAfter
    }
  });
}

function notesInMeasures(measures) {
  const ids = new Set();
  for (const measure of measures || []) {
    for (const event of measure.events || []) {
      for (const note of event.notes || []) ids.add(String(note.id));
    }
  }
  return ids;
}

function pruneRelations(relations, removedNoteIds) {
  if (!removedNoteIds.size) return { relations, removed: [] };
  const removed = [];
  const kept = (relations || []).filter(relation => {
    const hit = relationNoteIds(relation).some(id => removedNoteIds.has(String(id)));
    if (hit && relation.id) removed.push(String(relation.id));
    return !hit;
  });
  return { relations: kept, removed };
}

function affectedMeasureIds(...systems) {
  return [...new Set(systems.flat(2).map(measure => measure?.id).filter(Boolean).map(String))];
}

export function insertSystem(inputDocument, index, { measureCount = 4, idFactory = createId } = {}) {
  const document = normalizeDocumentV3(inputDocument);
  const systems = normalizeSystems(document);
  const safe = Math.max(0, Math.min(systems.length, Math.trunc(Number(index) || 0)));
  const reference = systems[Math.max(0, Math.min(systems.length - 1, safe - 1))]?.at(-1) || document.measures[0];
  const count = Math.max(1, Math.min(4, Math.trunc(Number(measureCount) || 4)));
  const inserted = Array.from({ length: count }, () => blankMeasure(reference, idFactory));
  systems.splice(safe, 0, inserted);
  const next = flattenSystems(document, systems);
  return {
    document: next,
    changeSet: createChangeSet({
      measures: inserted.map(measure => measure.id),
      playback: inserted.map(measure => measure.id),
      layoutFrom: inserted[0]?.id
    })
  };
}

export function deleteSystem(inputDocument, index) {
  const document = normalizeDocumentV3(inputDocument);
  const systems = normalizeSystems(document);
  if (systems.length <= 1) return { document, changeSet: createChangeSet() };
  const safe = Math.max(0, Math.min(systems.length - 1, Math.trunc(Number(index) || 0)));
  const removedMeasures = systems.splice(safe, 1)[0] || [];
  const pruned = pruneRelations(document.relations, notesInMeasures(removedMeasures));
  const next = flattenSystems(document, systems, { relations: pruned.relations });
  const layoutFrom = systems[Math.max(0, safe - 1)]?.[0]?.id || systems[0]?.[0]?.id || null;
  return {
    document: next,
    changeSet: createChangeSet({
      measures: removedMeasures.map(measure => measure.id),
      playback: removedMeasures.map(measure => measure.id),
      relations: pruned.removed,
      layoutFrom
    })
  };
}

export function moveSystem(inputDocument, fromIndex, insertionIndex) {
  const document = normalizeDocumentV3(inputDocument);
  const systems = normalizeSystems(document);
  const from = Math.trunc(Number(fromIndex));
  if (!Number.isInteger(from) || from < 0 || from >= systems.length) return { document, changeSet: createChangeSet() };
  const [moved] = systems.splice(from, 1);
  let to = Math.trunc(Number(insertionIndex));
  if (!Number.isInteger(to)) to = systems.length;
  if (from < to) to -= 1;
  to = Math.max(0, Math.min(systems.length, to));
  systems.splice(to, 0, moved);
  if (to === from) return { document, changeSet: createChangeSet() };
  const next = flattenSystems(document, systems);
  return {
    document: next,
    changeSet: createChangeSet({
      measures: moved.map(measure => measure.id),
      playback: moved.map(measure => measure.id),
      layoutFrom: moved[0]?.id
    })
  };
}

export function insertMeasureAt(inputDocument, systemIndex, measureIndex, { idFactory = createId } = {}) {
  const document = normalizeDocumentV3(inputDocument);
  const systems = normalizeSystems(document);
  const system = systems[systemIndex];
  if (!system || system.length >= 4) return { document, changeSet: createChangeSet() };
  const safe = Math.max(0, Math.min(system.length, Math.trunc(Number(measureIndex) || 0)));
  const reference = system[Math.max(0, Math.min(system.length - 1, safe - 1))] || document.measures[0];
  const measure = blankMeasure(reference, idFactory);
  system.splice(safe, 0, measure);
  const next = flattenSystems(document, systems);
  return {
    document: next,
    changeSet: createChangeSet({ measures: [measure.id], playback: [measure.id], layoutFrom: measure.id })
  };
}

export function deleteMeasureAt(inputDocument, systemIndex, measureIndex) {
  const document = normalizeDocumentV3(inputDocument);
  const systems = normalizeSystems(document);
  const system = systems[systemIndex];
  if (!system || system.length <= 1) return { document, changeSet: createChangeSet() };
  const safe = Math.max(0, Math.min(system.length - 1, Math.trunc(Number(measureIndex) || 0)));
  const [removed] = system.splice(safe, 1);
  const pruned = pruneRelations(document.relations, notesInMeasures([removed]));
  const next = flattenSystems(document, systems, { relations: pruned.relations });
  return {
    document: next,
    changeSet: createChangeSet({
      measures: [removed.id],
      playback: [removed.id],
      relations: pruned.removed,
      layoutFrom: system[Math.max(0, safe - 1)]?.id || system[0]?.id
    })
  };
}

function measureHasContent(measure) {
  return (measure?.events || []).length > 0 || (measure?.groups || []).length > 0;
}

function cascadeInsert(systems, systemIndex, boundary, measure, idFactory) {
  while (systems.length <= systemIndex) systems.push([]);
  const system = systems[systemIndex];
  if (system.length === 1 && !measureHasContent(system[0]) && boundary === 0) {
    system[0] = measure;
    return;
  }
  const safe = Math.max(0, Math.min(system.length, boundary));
  system.splice(safe, 0, measure);
  if (system.length <= 4) return;
  const overflow = system.pop();
  if (!systems[systemIndex + 1]) systems.push([blankMeasure(measure, idFactory)]);
  cascadeInsert(systems, systemIndex + 1, 0, overflow, idFactory);
}

export function moveMeasureAt(inputDocument, sourceSystemIndex, sourceMeasureIndex, targetSystemIndex, targetBoundary, { idFactory = createId } = {}) {
  const document = normalizeDocumentV3(inputDocument);
  const systems = normalizeSystems(document);
  const source = systems[sourceSystemIndex];
  if (!source || sourceMeasureIndex < 0 || sourceMeasureIndex >= source.length) return { document, changeSet: createChangeSet() };

  if (sourceSystemIndex === targetSystemIndex) {
    const [moved] = source.splice(sourceMeasureIndex, 1);
    let target = Math.max(0, Math.min(source.length + 1, Math.trunc(Number(targetBoundary) || 0)));
    if (sourceMeasureIndex < target) target -= 1;
    target = Math.max(0, Math.min(source.length, target));
    source.splice(target, 0, moved);
    if (target === sourceMeasureIndex) return { document, changeSet: createChangeSet() };
    const next = flattenSystems(document, systems);
    return {
      document: next,
      changeSet: createChangeSet({ measures: [moved.id], playback: [moved.id], layoutFrom: moved.id })
    };
  }

  const [moved] = source.splice(sourceMeasureIndex, 1);
  if (!source.length) source.push(blankMeasure(moved, idFactory));
  const beforeTarget = cloneValue(systems[targetSystemIndex] || []);
  cascadeInsert(systems, targetSystemIndex, Math.trunc(Number(targetBoundary) || 0), moved, idFactory);
  const next = flattenSystems(document, systems);
  return {
    document: next,
    changeSet: createChangeSet({
      measures: affectedMeasureIds(source, beforeTarget, systems[targetSystemIndex] || [], [moved]),
      playback: affectedMeasureIds(source, beforeTarget, systems[targetSystemIndex] || [], [moved]),
      layoutFrom: source[0]?.id || moved.id
    })
  };
}
