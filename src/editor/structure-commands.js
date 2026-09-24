import { cloneValue, createId, normalizeDocumentV3, relationNoteIds } from './model.js';
import { createChangeSet, LAYOUT_INVALIDATION } from './commands.js';
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
    layout: { ...(cloneValue(document.layout) || {}), systemBreakAfter }
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

function structureChange(measures, layoutFrom, extra = {}) {
  return createChangeSet({
    measures,
    playback: measures,
    layoutFrom,
    layoutKind: LAYOUT_INVALIDATION.STRUCTURE,
    ...extra
  });
}

export function insertSystem(inputDocument, index, { measureCount = 4, idFactory = createId } = {}) {
  const document = normalizeDocumentV3(inputDocument);
  const systems = normalizeSystems(document);
  const safe = Math.max(0, Math.min(systems.length, Math.trunc(Number(index) || 0)));
  const reference = systems[Math.max(0, Math.min(systems.length - 1, safe - 1))]?.at(-1) || document.measures[0];
  const count = Math.max(1, Math.min(4, Math.trunc(Number(measureCount) || 4)));
  const inserted = Array.from({ length: count }, () => blankMeasure(reference, idFactory));
  systems.splice(safe, 0, inserted);
  return {
    document: flattenSystems(document, systems),
    changeSet: structureChange(inserted.map(measure => measure.id), inserted[0]?.id)
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
    changeSet: structureChange(removedMeasures.map(measure => measure.id), layoutFrom, { relations: pruned.removed })
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
  return {
    document: flattenSystems(document, systems),
    changeSet: structureChange(moved.map(measure => measure.id), moved[0]?.id)
  };
}

function cascadeForward(systems, startIndex, initialOverflow) {
  let overflow = initialOverflow;
  let index = startIndex + 1;
  while (overflow) {
    if (!systems[index]) systems[index] = [];
    systems[index].unshift(overflow);
    if (systems[index].length <= 4) return;
    overflow = systems[index].pop();
    index += 1;
  }
}

function cascadeBackward(systems, startIndex, initialOverflow) {
  let overflow = initialOverflow;
  let index = startIndex - 1;
  while (overflow) {
    if (index < 0) {
      systems.unshift([overflow]);
      return;
    }
    systems[index].push(overflow);
    if (systems[index].length <= 4) return;
    overflow = systems[index].shift();
    index -= 1;
  }
}

export function insertMeasureAt(inputDocument, systemIndex, measureIndex, {
  idFactory = createId,
  overflowDirection = 'forward'
} = {}) {
  const document = normalizeDocumentV3(inputDocument);
  const systems = normalizeSystems(document);
  const system = systems[systemIndex];
  if (!system) return { document, changeSet: createChangeSet() };
  const safe = Math.max(0, Math.min(system.length, Math.trunc(Number(measureIndex) || 0)));
  const reference = system[Math.max(0, Math.min(system.length - 1, safe - 1))] || document.measures[0];
  const measure = blankMeasure(reference, idFactory);
  const before = systems.map(row => [...row]);
  system.splice(safe, 0, measure);

  if (system.length > 4) {
    if (overflowDirection === 'backward') {
      const spillIndex = safe === 0 ? 1 : 0;
      const [overflow] = system.splice(spillIndex, 1);
      cascadeBackward(systems, systemIndex, overflow);
    } else {
      const spillIndex = safe === system.length - 1 ? system.length - 2 : system.length - 1;
      const [overflow] = system.splice(spillIndex, 1);
      cascadeForward(systems, systemIndex, overflow);
    }
  }

  const changed = affectedMeasureIds(before, systems, [[measure]]);
  return {
    document: flattenSystems(document, systems),
    changeSet: structureChange(changed, measure.id)
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
    changeSet: structureChange([removed.id], system[Math.max(0, safe - 1)]?.id || system[0]?.id, { relations: pruned.removed })
  };
}

export function moveMeasureAt(inputDocument, sourceSystemIndex, sourceMeasureIndex, targetSystemIndex, targetBoundary) {
  const document = normalizeDocumentV3(inputDocument);
  const systems = normalizeSystems(document);
  const source = systems[sourceSystemIndex];
  const targetSystem = systems[targetSystemIndex];
  if (!source || !targetSystem || sourceMeasureIndex < 0 || sourceMeasureIndex >= source.length) {
    return { document, changeSet: createChangeSet() };
  }

  if (sourceSystemIndex === targetSystemIndex) {
    const [moved] = source.splice(sourceMeasureIndex, 1);
    let target = Math.max(0, Math.min(source.length + 1, Math.trunc(Number(targetBoundary) || 0)));
    if (sourceMeasureIndex < target) target -= 1;
    target = Math.max(0, Math.min(source.length, target));
    source.splice(target, 0, moved);
    if (target === sourceMeasureIndex) return { document, changeSet: createChangeSet() };
    return {
      document: flattenSystems(document, systems),
      changeSet: structureChange([moved.id], moved.id)
    };
  }

  const beforeSource = cloneValue(source);
  const beforeTarget = cloneValue(targetSystem);
  const [moved] = source.splice(sourceMeasureIndex, 1);
  const requestedBoundary = Math.max(0, Math.min(targetSystem.length, Math.trunc(Number(targetBoundary) || 0)));
  if (sourceSystemIndex < targetSystemIndex) {
    const exchanged = targetSystem.shift();
    const adjustedBoundary = Math.max(0, Math.min(targetSystem.length, requestedBoundary > 0 ? requestedBoundary - 1 : 0));
    targetSystem.splice(adjustedBoundary, 0, moved);
    if (exchanged) source.push(exchanged);
  } else {
    const exchanged = targetSystem.pop();
    const adjustedBoundary = Math.max(0, Math.min(targetSystem.length, requestedBoundary));
    targetSystem.splice(adjustedBoundary, 0, moved);
    if (exchanged) source.unshift(exchanged);
  }

  const changed = affectedMeasureIds(beforeSource, beforeTarget, source, targetSystem);
  return {
    document: flattenSystems(document, systems),
    changeSet: structureChange(changed, source[0]?.id || moved.id)
  };
}
