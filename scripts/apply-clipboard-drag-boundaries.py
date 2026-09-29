from pathlib import Path
import re


def replace(path, old, new):
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise SystemExit(f'pattern not found in {path}: {old[:160]!r}')
    target.write_text(text.replace(old, new, 1))


def replace_regex(path, pattern, new):
    target = Path(path)
    text = target.read_text()
    next_text, count = re.subn(pattern, new, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'regex replacement count {count} in {path}: {pattern[:160]!r}')
    target.write_text(next_text)


clipboard = 'src/editor/clipboard.js'
replace_regex(
    clipboard,
    r"function cloneRelationsWithMap\(relations, noteIdMap, idFactory\) \{.*?\n\}\n\nfunction relationsWithoutNotes",
    """function relationMeasureIds(relation) {
  const ids = [];
  for (const position of [relation?.fromPosition, relation?.toPosition]) {
    if (position?.measureId) ids.push(String(position.measureId));
  }
  return [...new Set(ids)];
}

function cloneRelationsWithMap(relations, noteIdMap, measureIdMap, idFactory) {
  const copied = [];
  for (const source of relations || []) {
    const ids = relationNoteIds(source);
    if (!ids.length || ids.some(id => !noteIdMap.has(id))) continue;
    const measureIds = relationMeasureIds(source);
    if (measureIds.some(id => !measureIdMap.has(id))) continue;
    const relation = cloneValue(source);
    relation.id = idFactory('r');
    if (relation.fromNoteId) relation.fromNoteId = noteIdMap.get(String(relation.fromNoteId));
    if (relation.toNoteId) relation.toNoteId = noteIdMap.get(String(relation.toNoteId));
    if (Array.isArray(relation.noteIds)) relation.noteIds = relation.noteIds.map(id => noteIdMap.get(String(id))).filter(Boolean);
    for (const key of ['fromPosition', 'toPosition']) {
      if (!relation[key]?.measureId) continue;
      relation[key] = {
        ...relation[key],
        measureId: measureIdMap.get(String(relation[key].measureId))
      };
    }
    copied.push(relation);
  }
  return copied;
}

function relationsWithoutNotes"""
)
replace(
    clipboard,
    "    const cloned = cloneMeasureWithFreshIds(this.payload.measure, idFactory, { measureId: target.id });\n    const addedRelations = cloneRelationsWithMap(this.payload.relations, cloned.noteIdMap, idFactory);",
    "    const cloned = cloneMeasureWithFreshIds(this.payload.measure, idFactory, { measureId: target.id });\n    const measureIdMap = new Map([[String(this.payload.measure.id), String(target.id)]]);\n    const addedRelations = cloneRelationsWithMap(this.payload.relations, cloned.noteIdMap, measureIdMap, idFactory);"
)
replace(
    clipboard,
    "    const noteIdMap = new Map();\n    const clonedMeasures = this.payload.measures.map(sourceMeasure => {\n      const cloned = cloneMeasureWithFreshIds(sourceMeasure, idFactory);\n      cloned.noteIdMap.forEach((value, key) => noteIdMap.set(key, value));\n      return cloned.measure;\n    });\n    const addedRelations = cloneRelationsWithMap(this.payload.relations, noteIdMap, idFactory);",
    "    const noteIdMap = new Map();\n    const measureIdMap = new Map();\n    const clonedMeasures = this.payload.measures.map(sourceMeasure => {\n      const cloned = cloneMeasureWithFreshIds(sourceMeasure, idFactory);\n      cloned.noteIdMap.forEach((value, key) => noteIdMap.set(key, value));\n      measureIdMap.set(String(sourceMeasure.id), String(cloned.measure.id));\n      return cloned.measure;\n    });\n    const addedRelations = cloneRelationsWithMap(this.payload.relations, noteIdMap, measureIdMap, idFactory);"
)

structure = 'src/editor/structure-controller.js'
replace_regex(
    structure,
    r"function makeMeasureDropZone\(rowIndex, boundary, edge\) \{.*?\n\}\n\nfunction makeRowDropZone\(boundary, edge\) \{.*?\n\}\n\nfunction addMeasureUi\(grid, rowIndex\) \{.*?\n\}\n\nfunction makeInsertZone",
    """function makeMeasureDropBoundary(rowIndex, boundary, left, width, anchor) {
  const zone = document.createElement('div');
  zone.className = 'measure-drop-boundary';
  zone.dataset.row = String(rowIndex);
  zone.dataset.dropMeasureBoundary = String(boundary);
  zone.setAttribute('aria-hidden', 'true');
  zone.style.left = `${left}%`;
  zone.style.width = `${width}%`;
  zone.style.setProperty('--drop-indicator-x', `${anchor}%`);
  return zone;
}

function addMeasureUi(grid, rowIndex) {
  grid.querySelectorAll('.measure-module-hitbox,.measure-drop-boundary').forEach(node => node.remove());
  const start = Math.max(0, Number(grid.dataset.measureStart) || 0);
  const count = Math.max(1, Number(grid.dataset.measureCount) || 1);
  for (let localMeasure = 0; localMeasure < count; localMeasure++) {
    const measureIndex = start + localMeasure;
    const left = boundaryPercent(grid, localMeasure);
    const right = boundaryPercent(grid, localMeasure + 1);
    const hitbox = document.createElement('div');
    hitbox.className = 'measure-module-hitbox';
    hitbox.dataset.row = String(rowIndex);
    hitbox.dataset.measure = String(measureIndex);
    hitbox.style.left = `${left}%`;
    hitbox.style.width = `${Math.max(0, right - left)}%`;
    hitbox.addEventListener('pointerdown', event => beginPointerDrag(event, { type: 'measure', rowIndex, measureIndex }, hitbox));
    hitbox.addEventListener('contextmenu', event => { event.preventDefault(); openMenu({ type: 'measure', rowIndex, measureIndex }, event.clientX, event.clientY); });
    grid.appendChild(hitbox);
  }
  for (let localBoundary = 0; localBoundary <= count; localBoundary++) {
    const boundary = boundaryPercent(grid, localBoundary);
    const previous = localBoundary > 0 ? boundaryPercent(grid, localBoundary - 1) : boundary;
    const next = localBoundary < count ? boundaryPercent(grid, localBoundary + 1) : boundary;
    const zoneStart = localBoundary === 0 ? 0 : (previous + boundary) / 2;
    const zoneEnd = localBoundary === count ? 100 : (boundary + next) / 2;
    const width = Math.max(0.001, zoneEnd - zoneStart);
    const anchor = Math.max(0, Math.min(100, (boundary - zoneStart) / width * 100));
    grid.appendChild(makeMeasureDropBoundary(rowIndex, start + localBoundary, zoneStart, width, anchor));
  }
}

function makeInsertZone"""
)
replace(
    structure,
    "  zone.className = 'row-insert-zone';\n  zone.dataset.insertIndex = String(index);\n  zone.dataset.dropRowBoundary = String(index);\n  const controls = document.createElement('div');",
    "  zone.className = 'row-insert-zone';\n  zone.dataset.insertIndex = String(index);\n  const dropTarget = document.createElement('div');\n  dropTarget.className = 'row-boundary-drop-target';\n  dropTarget.dataset.dropRowBoundary = String(index);\n  dropTarget.setAttribute('aria-hidden', 'true');\n  const controls = document.createElement('div');"
)
replace(
    structure,
    "  controls.appendChild(add);\n  zone.appendChild(controls);",
    "  controls.appendChild(add);\n  zone.append(dropTarget, controls);"
)
replace(
    structure,
    "  system.querySelectorAll('.row-drop-zone').forEach(node => node.remove());\n  system.querySelector('.layout-rail-placeholder')?.remove();",
    "  system.querySelector('.layout-rail-placeholder')?.remove();"
)
replace(
    structure,
    "  system.prepend(makeRowHandle(target, { sourceStart }));\n  system.append(makeRowDropZone(rowIndex, 'before'), makeRowDropZone(rowIndex + 1, 'after'));\n  system.querySelectorAll('.v3-grid').forEach(grid => addMeasureUi(grid, rowIndex));",
    "  system.prepend(makeRowHandle(target, { sourceStart }));\n  system.querySelectorAll('.v3-grid').forEach(grid => addMeasureUi(grid, rowIndex));"
)
replace(
    structure,
    "function rowDropTargetFromElement(element) {\n  const zone = element?.closest?.('[data-drop-row-boundary]');",
    "function rowDropTargetFromElement(element) {\n  const zone = element?.closest?.('.row-boundary-drop-target[data-drop-row-boundary]');"
)
replace(
    structure,
    "function measureDropTargetFromElement(element) {\n  const zone = element?.closest?.('.measure-drop-zone[data-row][data-drop-measure-boundary]');",
    "function measureDropTargetFromElement(element) {\n  const zone = element?.closest?.('.measure-drop-boundary[data-row][data-drop-measure-boundary]');"
)
replace(
    structure,
    "  if (dragState.type === 'row') return element.closest?.('[data-drop-row-boundary]') || null;\n  if (dragState.type === 'measure') return element.closest?.('.measure-drop-zone[data-row][data-drop-measure-boundary]') || null;",
    "  if (dragState.type === 'row') return element.closest?.('.row-boundary-drop-target[data-drop-row-boundary]') || null;\n  if (dragState.type === 'measure') return element.closest?.('.measure-drop-boundary[data-row][data-drop-measure-boundary]') || null;"
)

modules = 'styles/editor-modules.css'
replace_regex(
    modules,
    r"\.measure-drop-zone\{.*?\.measure-drop-zone-after \.structure-drop-indicator\{right:0;transform:translateX\(50%\)\}",
    ".measure-drop-boundary{position:absolute;top:0;height:var(--staff-height);z-index:21;pointer-events:none;cursor:grabbing}.structure-drag-measure-active .measure-drop-boundary{pointer-events:auto}.structure-drop-indicator{position:absolute;z-index:2;border-radius:2px;background:#1ed760;pointer-events:none}.measure-drop-boundary .structure-drop-indicator{left:var(--drop-indicator-x);top:0;bottom:0;width:3px;transform:translateX(-50%)}"
)

rows = 'styles/editor-row-controls.css'
replace_regex(
    rows,
    r"\.row-drop-zone\{.*?@media\(max-width:900px\)\{\.row-insert-zone::before,\.row-drop-zone \.structure-drop-indicator,\.row-insert-zone>\.structure-drop-indicator\{left:50px\}\}",
    ".row-boundary-drop-target{position:absolute;left:0;right:0;top:-12px;bottom:-12px;z-index:60;pointer-events:none}.structure-drag-row-active .row-boundary-drop-target{pointer-events:auto;cursor:grabbing}.structure-drag-row-active .row-insert-controls{opacity:0!important;pointer-events:none!important}.row-boundary-drop-target .structure-drop-indicator{left:50px;right:8px;top:50%;height:3px;transform:translateY(-50%)}@media(max-width:900px){.row-insert-zone::before,.row-boundary-drop-target .structure-drop-indicator{left:50px}}"
)

v3test = 'tests/editor-v3.test.mjs'
replace_regex(
    v3test,
    r"\{\n  const clipboardDocument=migrateSongToDocumentV3\(legacySong\);.*?\n\}\n\{\n  const song=structuredClone\(legacySong\);",
    """{
  const clipboardDocument=migrateSongToDocumentV3(legacySong);
  const noteA=clipboardDocument.measures[0].events[0].notes[0];
  const noteB=clipboardDocument.measures[0].events[0].notes[1];
  const sourceMeasureId=clipboardDocument.measures[0].id;
  const sourceEventA=clipboardDocument.measures[0].events[0].id;
  const sourceEventB=clipboardDocument.measures[0].events[1].id;
  const ids=idFactory();
  let decorated=applyCommand(clipboardDocument,{type:'note/technique/add',noteId:noteA.id,technique:{type:'harmonic'}},{idFactory:ids}).document;
  decorated=applyCommand(decorated,{type:'event/mark/add',eventId:sourceEventA,mark:{type:'strum',direction:'up'}},{idFactory:ids}).document;
  decorated=applyCommand(decorated,{type:'event/mark/add',eventId:sourceEventB,mark:{type:'arpeggio',direction:'down'}},{idFactory:ids}).document;
  decorated=applyCommand(decorated,{type:'relation/add',relation:{type:'tie',fromNoteId:noteA.id,toNoteId:noteB.id}},{idFactory:ids}).document;
  decorated=applyCommand(decorated,{type:'relation/add',relation:{type:'arc',direction:'up',fromNoteId:noteA.id,fromPosition:{measureId:sourceMeasureId,at:[0,1]},toPosition:{measureId:sourceMeasureId,at:[1,1]}}},{idFactory:ids}).document;
  decorated=applyCommand(decorated,{type:'relation/add',relation:{type:'arc',direction:'down',fromNoteId:noteB.id,fromPosition:{measureId:sourceMeasureId,at:[0,1]},toPosition:{measureId:sourceMeasureId,at:[1,1]}}},{idFactory:ids}).document;
  decorated=applyCommand(decorated,{type:'relation/add',relation:{type:'slide',fromNoteId:noteA.id,toNoteId:noteB.id}},{idFactory:ids}).document;
  decorated=applyCommand(decorated,{type:'group/add',measureId:sourceMeasureId,group:{type:'tuplet',ratio:[3,2],subdivision:'eighth',slots:[[0,1],[1,3],[2,3]],duration:[1,3],eventIds:[sourceEventA,sourceEventB]}},{idFactory:ids}).document;
  decorated=applyCommand(decorated,{type:'group/add',measureId:sourceMeasureId,group:{type:'subdivision',subdivision:'thirty-second',slots:[[2,1],[17,8]],duration:[1,8],eventIds:[sourceEventB]}},{idFactory:ids}).document;
  const sourceTechniqueId=decorated.measures[0].events[0].notes[0].techniques[0].id;
  const sourceMarkIds=decorated.measures[0].events.flatMap(event=>event.marks||[]).map(mark=>mark.id);
  const sourceGroupIds=decorated.measures[0].groups.map(group=>group.id);
  const clipboard=new EditorClipboard();
  clipboard.copyMeasure(decorated,sourceMeasureId);
  const pasted=clipboard.pasteMeasure(decorated,decorated.measures[1].id,{idFactory:idFactory()});
  assert.ok(pasted);
  const target=pasted.document.measures[1];
  assert.notEqual(target.events[0].notes[0].techniques[0].id,sourceTechniqueId);
  assert.deepEqual(target.events.flatMap(event=>event.marks||[]).map(mark=>mark.type).sort(),['arpeggio','strum']);
  assert.equal(target.events.flatMap(event=>event.marks||[]).every(mark=>!sourceMarkIds.includes(mark.id)),true);
  assert.deepEqual(target.groups.map(group=>group.type).sort(),['subdivision','tuplet']);
  assert.equal(target.groups.every(group=>!sourceGroupIds.includes(group.id)),true);
  const targetEventIds=new Set(target.events.map(event=>String(event.id)));
  assert.equal(target.groups.flatMap(group=>group.eventIds||[]).every(id=>targetEventIds.has(String(id))),true,'rhythm group event references must follow cloned events');
  for(const direction of ['up','down']){
    const arc=pasted.document.relations.find(relation=>relation.type==='arc'&&relation.direction===direction&&relation.fromPosition?.measureId===target.id);
    assert.ok(arc,`${direction} positional arc must be copied into the pasted measure`);
    assert.equal(arc.toPosition.measureId,target.id);
    assert.notEqual(arc.fromPosition.measureId,sourceMeasureId);
  }
  assert.ok(pasted.document.relations.find(relation=>relation.type==='tie'&&!decorated.relations.some(source=>source.id===relation.id)));
  assert.ok(pasted.document.relations.find(relation=>relation.type==='slide'&&!decorated.relations.some(source=>source.id===relation.id)));

  const systemClipboard=new EditorClipboard();
  const sourceSystemIds=decorated.measures.map(measure=>measure.id);
  systemClipboard.copySystem(decorated,sourceSystemIds);
  const systemPasted=systemClipboard.pasteSystem(decorated,sourceSystemIds,{idFactory:idFactory()});
  assert.ok(systemPasted);
  const pastedSystemMeasureId=systemPasted.document.measures[0].id;
  assert.notEqual(pastedSystemMeasureId,sourceMeasureId);
  const systemArcs=systemPasted.document.relations.filter(relation=>relation.type==='arc');
  assert.equal(systemArcs.length,2);
  assert.equal(systemArcs.every(relation=>relation.fromPosition?.measureId===pastedSystemMeasureId&&relation.toPosition?.measureId===pastedSystemMeasureId),true,'system paste must remap every positional relation to cloned measure ids');
}
{
  const song=structuredClone(legacySong);"""
)

structure_test = 'tests/editor-structure-cleanup.test.mjs'
replace(
    structure_test,
    "assert.match(rowControlsCss,/\\.row-drop-zone \\.structure-drop-indicator/,'row drag feedback must position the shared insertion indicator on row boundaries');\nassert.match(rowControlsCss,/\\.row-insert-zone>\\.structure-drop-indicator/,'row insertion gaps must reuse the same shared indicator');\nassert.doesNotMatch(rowControlsCss,/row-drop-zone::after|row-insert-zone:hover::after/,'row drag must not keep distributed pseudo-element insertion bars');\nassert.match(editorModulesCss,/\\.measure-drop-zone \\.structure-drop-indicator/,'measure drag feedback must position the shared insertion indicator on measure boundaries');\nassert.doesNotMatch(editorModulesCss,/measure-drop-zone::after|measure-drop-zone:hover::after/,'measure drag must not keep distributed pseudo-element insertion bars');",
    "assert.match(structureSource,/dropTarget\\.className = 'row-boundary-drop-target'[\\s\\S]*dropTarget\\.dataset\\.dropRowBoundary = String\\(index\\)/s,'each row insertion boundary must own one canonical browser hit target');\nassert.doesNotMatch(structureSource,/makeRowDropZone|row-drop-zone/,'row dragging must not duplicate one logical boundary across row halves and insertion gaps');\nassert.match(rowControlsCss,/\\.row-boundary-drop-target \\.structure-drop-indicator/,'row drag feedback must anchor the shared insertion indicator to the canonical boundary target');\nassert.doesNotMatch(rowControlsCss,/row-drop-zone|row-insert-zone>\\.structure-drop-indicator/,'row drag CSS must not keep duplicate physical representations of one boundary');\nassert.match(structureSource,/for \\(let localBoundary = 0; localBoundary <= count; localBoundary\\+\\+\\)[\\s\\S]*makeMeasureDropBoundary\\(rowIndex, start \\+ localBoundary/s,'each visual measure grid must create exactly count + 1 canonical boundary targets');\nassert.match(editorModulesCss,/\\.measure-drop-boundary \\.structure-drop-indicator/,'measure drag feedback must anchor the shared insertion indicator to a canonical nearest-boundary target');\nassert.doesNotMatch(structureSource,/measure-drop-zone-before|measure-drop-zone-after|makeMeasureDropZone/,'measure dragging must not duplicate interior boundaries as left and right half-zones');\nassert.doesNotMatch(editorModulesCss,/measure-drop-zone-before|measure-drop-zone-after|\\.measure-drop-zone\\{/,'legacy duplicated measure half-zones must be removed');"
)
replace(
    structure_test,
    "assert.match(structureSource,/dataset\\.dropRowBoundary/,'structure decoration must install explicit row drop boundaries');\nassert.match(structureSource,/dataset\\.dropMeasureBoundary/,'structure decoration must install explicit measure drop boundaries');",
    "assert.match(structureSource,/row-boundary-drop-target\\[data-drop-row-boundary\\]/,'row drop resolution must read the one canonical row-boundary target');\nassert.match(structureSource,/measure-drop-boundary\\[data-row\\]\\[data-drop-measure-boundary\\]/,'measure drop resolution must read the one canonical measure-boundary target');"
)
