from pathlib import Path
import re


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'missing anchor in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))


def regex_once(path, pattern, replacement, flags=0):
    p = Path(path)
    text = p.read_text()
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'expected one regex match in {path}: {pattern[:120]!r}, got {count}')
    p.write_text(updated)

# 1) Adaptive layout: only the final visual row keeps natural measure widths when partial.
replace_once(
    'src/editor/layout.js',
    'function splitLogicalSystem(measures, sourceSystemIndex, availableWidth, maxMeasuresPerSystem, metrics, minMeasureWidth) {',
    'function splitLogicalSystem(measures, sourceSystemIndex, availableWidth, maxMeasuresPerSystem, metrics, minMeasureWidth, isFinalSourceSystem = false) {'
)
replace_once(
    'src/editor/layout.js',
    "    const slice = measures.slice(cursor, cursor + count);\n    const rowMeasureWidth = Math.max(base.width, availableWidth / Math.max(1, slice.length));\n    const allocation = segmentAllocation(slice, metrics, rowMeasureWidth);",
    "    const slice = measures.slice(cursor, cursor + count);\n    const isFinalSlice = cursor + count >= measures.length;\n    const keepNaturalFinalWidth = isFinalSourceSystem && isFinalSlice && slice.length < base.slots;\n    const rowMeasureWidth = keepNaturalFinalWidth\n      ? base.width\n      : Math.max(base.width, availableWidth / Math.max(1, slice.length));\n    const allocation = segmentAllocation(slice, metrics, rowMeasureWidth);"
)
replace_once(
    'src/editor/layout.js',
    "  const metrics = buildMetricsForMeasures(context, sourceMeasures, minMeasureWidth, index);\n  return splitLogicalSystem(sourceMeasures, Number(sourceSystemIndex) || 0, width, maxMeasuresPerSystem, metrics, minMeasureWidth);",
    "  const metrics = buildMetricsForMeasures(context, sourceMeasures, minMeasureWidth, index);\n  const finalMeasureId = String(context.measures.at(-1)?.id || '');\n  const isFinalSourceSystem = Boolean(finalMeasureId && String(sourceMeasures.at(-1)?.id || '') === finalMeasureId);\n  return splitLogicalSystem(sourceMeasures, Number(sourceSystemIndex) || 0, width, maxMeasuresPerSystem, metrics, minMeasureWidth, isFinalSourceSystem);"
)

# 2) Drag indicators: suppress ordinary hover/selection outlines while drag insertion feedback is active.
modules = Path('styles/editor-modules.css')
text = modules.read_text()
text = text.replace(
    '.content.edit-view .editor-row-module.is-selected{box-shadow:0 0 0 2px rgba(30,215,96,.10)}\n',
    '.content.edit-view .editor-row-module.is-selected{box-shadow:0 0 0 2px rgba(30,215,96,.10)}\n.structure-drag-row-active .content.edit-view .editor-row-module:hover,.structure-drag-row-active .content.edit-view .editor-row-module.is-selected{border-color:transparent;background:transparent;box-shadow:none}\n',
    1
)
text = text.replace(
    '.measure-module-hitbox:hover{background:transparent;border-color:#1ed760}\n',
    '.measure-module-hitbox:hover{background:transparent;border-color:#1ed760}\n.structure-drag-measure-active .measure-module-hitbox:hover,.structure-drag-measure-active .measure-module-hitbox.is-selected{border-color:transparent;box-shadow:none}\n',
    1
)
modules.write_text(text)

# 3a) Canonical ChangeSet merge for notation renderer.
replace_once(
    'src/editor/notation-renderer.js',
    "import { fractionKey, indexDocument, updateDocumentIndex } from './model.js';",
    "import { mergeChangeSets } from './commands.js';\nimport { fractionKey, indexDocument, updateDocumentIndex } from './model.js';"
)
regex_once(
    'src/editor/notation-renderer.js',
    r"    if \(changeSet\) \{\n      const previous = this\.pendingChangeSet \|\| \{\};\n      this\.pendingChangeSet = \{[\s\S]*?\n      \};\n    \}",
    "    if (changeSet) this.pendingChangeSet = mergeChangeSets(this.pendingChangeSet, changeSet);"
)

# 3b) Playback invalidation + true no-op helpers.
commands = Path('src/editor/commands.js')
text = commands.read_text()
old_update_event = """function updateEvent(document, eventId, updater, { playback = true, layoutKind = null } = {}) {
  for (let measureIndex = 0; measureIndex < document.measures.length; measureIndex++) {
    const sourceMeasure = document.measures[measureIndex];
    const eventIndex = sourceMeasure.events.findIndex(event => event.id === eventId);
    if (eventIndex < 0) continue;
    const measure = cloneValue(sourceMeasure);
    measure.events[eventIndex] = updater(measure.events[eventIndex]);
    return {
      document: withMeasure(document, measureIndex, measure),
      changeSet: changedMeasure(measure.id, { playback, layoutFrom: layoutKind ? measure.id : null, layoutKind })
    };
  }
  return { document, changeSet: createChangeSet() };
}

function updateNote(document, noteId, updater, { playback = false, layoutKind = null } = {}) {
  for (let measureIndex = 0; measureIndex < document.measures.length; measureIndex++) {
    const sourceMeasure = document.measures[measureIndex];
    for (let eventIndex = 0; eventIndex < sourceMeasure.events.length; eventIndex++) {
      const noteIndex = sourceMeasure.events[eventIndex].notes.findIndex(note => note.id === noteId);
      if (noteIndex < 0) continue;
      const measure = cloneValue(sourceMeasure);
      measure.events[eventIndex].notes[noteIndex] = updater(measure.events[eventIndex].notes[noteIndex]);
      return {
        document: withMeasure(document, measureIndex, measure),
        changeSet: changedMeasure(measure.id, { playback, layoutFrom: layoutKind ? measure.id : null, layoutKind })
      };
    }
  }
  return { document, changeSet: createChangeSet() };
}
"""
new_update_event = """function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function updateEvent(document, eventId, updater, { playback = true, layoutKind = null } = {}) {
  for (let measureIndex = 0; measureIndex < document.measures.length; measureIndex++) {
    const sourceMeasure = document.measures[measureIndex];
    const eventIndex = sourceMeasure.events.findIndex(event => event.id === eventId);
    if (eventIndex < 0) continue;
    const sourceEvent = sourceMeasure.events[eventIndex];
    const updatedEvent = updater(cloneValue(sourceEvent));
    if (!updatedEvent || sameValue(sourceEvent, updatedEvent)) return { document, changeSet: createChangeSet() };
    const measure = cloneValue(sourceMeasure);
    measure.events[eventIndex] = updatedEvent;
    return {
      document: withMeasure(document, measureIndex, measure),
      changeSet: changedMeasure(measure.id, { playback, layoutFrom: layoutKind ? measure.id : null, layoutKind })
    };
  }
  return { document, changeSet: createChangeSet() };
}

function updateNote(document, noteId, updater, { playback = false, layoutKind = null } = {}) {
  for (let measureIndex = 0; measureIndex < document.measures.length; measureIndex++) {
    const sourceMeasure = document.measures[measureIndex];
    for (let eventIndex = 0; eventIndex < sourceMeasure.events.length; eventIndex++) {
      const noteIndex = sourceMeasure.events[eventIndex].notes.findIndex(note => note.id === noteId);
      if (noteIndex < 0) continue;
      const sourceNote = sourceMeasure.events[eventIndex].notes[noteIndex];
      const updatedNote = updater(cloneValue(sourceNote));
      if (!updatedNote || sameValue(sourceNote, updatedNote)) return { document, changeSet: createChangeSet() };
      const measure = cloneValue(sourceMeasure);
      measure.events[eventIndex].notes[noteIndex] = updatedNote;
      return {
        document: withMeasure(document, measureIndex, measure),
        changeSet: changedMeasure(measure.id, { playback, layoutFrom: layoutKind ? measure.id : null, layoutKind })
      };
    }
  }
  return { document, changeSet: createChangeSet() };
}
"""
if old_update_event not in text:
    raise SystemExit('updateEvent/updateNote block missing')
text = text.replace(old_update_event, new_update_event, 1)
text = text.replace("  }, { playback: false, layoutKind });\n}\n\nfunction deleteMark", "  }, { playback: Boolean(layoutKind), layoutKind });\n}\n\nfunction deleteMark", 1)
text = text.replace("  }), { playback: false, layoutKind });\n}\n\nfunction applyRhythmAt", "  }), { playback: Boolean(layoutKind), layoutKind });\n}\n\nfunction applyRhythmAt", 1)
text = text.replace(
    "      measures,\n      relations: [relation.id],\n      layoutFrom,",
    "      measures,\n      playback: relation.type === 'slide' ? measures : [],\n      relations: [relation.id],\n      layoutFrom,",
    1
)
text = text.replace(
    "      measures,\n      relations: [relationId],\n      layoutFrom,",
    "      measures,\n      playback: relation.type === 'slide' ? measures : [],\n      relations: [relationId],\n      layoutFrom,",
    1
)
text = text.replace(
    "  const breaks = (document.layout?.systemBreakAfter || []).filter(id => id !== measureId);\n  next = { ...next, relations: pruned.relations, layout: { ...(document.layout || {}), systemBreakAfter: breaks } };",
    "  next = { ...next, relations: pruned.relations };",
    1
)
commands.write_text(text)

# Store: empty command result must not dirty updatedAt or notify renderers.
store = Path('src/editor/store.js')
text = store.read_text()
text = text.replace(
    "import { ensureSongDocumentV3 } from './migrate-v2.js';\n\nexport class ScoreStore",
    "import { ensureSongDocumentV3 } from './migrate-v2.js';\n\nfunction changeSetHasChanges(changeSet = {}) {\n  return Boolean(\n    changeSet.document\n    || changeSet.layoutFrom\n    || (changeSet.measures || []).length\n    || (changeSet.playback || []).length\n    || (changeSet.relations || []).length\n  );\n}\n\nexport class ScoreStore",
    1
)
text = text.replace(
    "  commit(nextDocument, changeSet = createChangeSet(), { touch = true, silent = false } = {}) {\n    if (!nextDocument) return { document: this.document, changeSet };\n    this.document = isDocumentV3(nextDocument) ? nextDocument : normalizeDocumentV3(nextDocument);",
    "  commit(nextDocument, changeSet = createChangeSet(), { touch = true, silent = false } = {}) {\n    if (!nextDocument) return { document: this.document, changeSet };\n    if (nextDocument === this.document && !changeSetHasChanges(changeSet)) return { document: this.document, changeSet };\n    this.document = isDocumentV3(nextDocument) ? nextDocument : normalizeDocumentV3(nextDocument);",
    1
)
store.write_text(text)

# 3c) Retire systemBreakAfter: fixed packed groups of four are the only canonical row structure.
model = Path('src/editor/model.js')
text = model.read_text()
text = text.replace("  const systemBreakAfter = [];\n", '', 1)
text = text.replace("    systemBreakAfter.push(measures.at(-1).id);\n", '', 1)
text = text.replace("  return createDocumentV3({ measures, layout: { systemBreakAfter }, idFactory });", "  return createDocumentV3({ measures, idFactory });", 1)
old_norm = """  const measureIds = new Set(measures.map(measure => measure.id));
  const rawBreaks = Array.isArray(source.layout?.systemBreakAfter) ? source.layout.systemBreakAfter : [];
  const systemBreakAfter = [...new Set(rawBreaks.map(String).filter(id => measureIds.has(id)))];
  return {
    ...source,
    version: DOCUMENT_VERSION,
    measures,
    relations: Array.isArray(source.relations) ? source.relations.map(relation => normalizeRelation(relation, idFactory)) : [],
    layout: {
      ...(source.layout && typeof source.layout === 'object' ? source.layout : {}),
      systemBreakAfter
    }
  };
"""
new_norm = """  const layout = source.layout && typeof source.layout === 'object' ? cloneValue(source.layout) : {};
  delete layout.systemBreakAfter;
  return {
    ...source,
    version: DOCUMENT_VERSION,
    measures,
    relations: Array.isArray(source.relations) ? source.relations.map(relation => normalizeRelation(relation, idFactory)) : [],
    layout
  };
"""
if old_norm not in text:
    raise SystemExit('model normalize systemBreakAfter block missing')
text = text.replace(old_norm, new_norm, 1)
model.write_text(text)

migrate = Path('src/editor/migrate-v2.js')
text = migrate.read_text()
text = text.replace("  const systemBreakAfter = [];\n", '', 1)
text = text.replace("    if (measures.length) systemBreakAfter.push(measures.at(-1).id);\n", '', 1)
text = text.replace("  return createDocumentV3({ measures, relations: [], layout: { systemBreakAfter } });", "  return createDocumentV3({ measures, relations: [] });", 1)
migrate.write_text(text)

structure_commands = Path('src/editor/structure-commands.js')
text = structure_commands.read_text()
text = text.replace("  const systemBreakAfter = systems.map(system => system.at(-1)?.id).filter(Boolean);\n", '', 1)
text = text.replace(
    "    relations: cloneValue(relations),\n    layout: { ...(cloneValue(document.layout) || {}), systemBreakAfter }",
    "    relations: cloneValue(relations)",
    1
)
structure_commands.write_text(text)

clipboard = Path('src/editor/clipboard.js')
text = clipboard.read_text()
old = """    const liveMeasureIds = new Set(measures.map(measure => measure.id));
    const existingBreaks = (source.layout?.systemBreakAfter || []).filter(id => liveMeasureIds.has(id));
    const newBreak = clonedMeasures.at(-1)?.id || null;
    const systemBreakAfter = [...new Set([...existingBreaks, ...(newBreak ? [newBreak] : [])])];
    const next = {
      ...source,
      measures,
      relations: [...cleaned.relations, ...addedRelations],
      layout: { ...(source.layout || {}), systemBreakAfter }
    };
"""
new = """    const next = {
      ...source,
      measures,
      relations: [...cleaned.relations, ...addedRelations]
    };
"""
if old not in text:
    raise SystemExit('clipboard systemBreakAfter block missing')
clipboard.write_text(text.replace(old, new, 1))

# 3d) Make row semantics consistently logical-source-system, and resolve touch/pen drop only once on pointerup.
structure = Path('src/editor/structure-controller.js')
text = structure.read_text()
text = text.replace("  deleteMeasures,\n", '', 1)
old = """  if (selected.type === 'row') {
    const visualRow = Number(selected.visualRowIndex);
    const selector = Number.isInteger(visualRow)
      ? `.editor-row-module[data-visual-row=\"${visualRow}\"]`
      : `.editor-row-module[data-row=\"${selected.rowIndex}\"]`;
    const nodes = [...document.querySelectorAll(selector)];
"""
new = """  if (selected.type === 'row') {
    const nodes = [...document.querySelectorAll(`.editor-row-module[data-row=\"${selected.rowIndex}\"]`)];
"""
if old not in text:
    raise SystemExit('row selection block missing')
text = text.replace(old, new, 1)
old = """    if (action === 'delete') {
      const result = target.measureIds?.length
        ? deleteMeasures(documentModel, target.measureIds)
        : deleteSystem(documentModel, target.rowIndex);
      return commitResult(result, `已刪除第 ${Number(target.visualRowIndex ?? target.rowIndex) + 1} 列`);
    }
"""
new = """    if (action === 'delete') {
      return commitResult(deleteSystem(documentModel, target.rowIndex), `已刪除第 ${target.rowIndex + 1} 列`);
    }
"""
if old not in text:
    raise SystemExit('row delete block missing')
text = text.replace(old, new, 1)
# Remove visual-segment measure list from row identity.
text = re.sub(r"\nfunction measureIdsForSystem\(system\) \{[\s\S]*?\n\}\n\nfunction rowTargetForSystem", "\nfunction rowTargetForSystem", text, count=1)
text = text.replace(
    "  return { type: 'row', rowIndex, visualRowIndex, measureIds: measureIdsForSystem(system) };",
    "  return { type: 'row', rowIndex, visualRowIndex };",
    1
)
text = text.replace(
    "  const target = { type: 'row', rowIndex, visualRowIndex, measureIds: measureIdsForSystem(system) };",
    "  const target = { type: 'row', rowIndex, visualRowIndex };",
    1
)
text = text.replace(
    "  handle.setAttribute('aria-label', `第 ${target.visualRowIndex + 1} 列，可拖曳其來源列排序`);\n  const label = handle.querySelector('.row-module-label');\n  if (label) label.textContent = `第 ${target.visualRowIndex + 1} 列`;\n  handle.querySelector('.row-module-more')?.setAttribute('aria-label', `第 ${target.visualRowIndex + 1} 列操作`);",
    "  handle.setAttribute('aria-label', `第 ${target.rowIndex + 1} 列，可拖曳排序`);\n  const label = handle.querySelector('.row-module-label');\n  if (label) label.textContent = `第 ${target.rowIndex + 1} 列`;\n  handle.querySelector('.row-module-more')?.setAttribute('aria-label', `第 ${target.rowIndex + 1} 列操作`);",
    1
)
text = text.replace(
    "    commitDropFromElement(event.target);",
    "    const dropElement = document.elementFromPoint(event.clientX, event.clientY) || event.target;\n    commitDropFromElement(dropElement);",
    1
)
structure.write_text(text)

# Chord pointerup uses one final coordinate hit-test, while hover remains pure CSS.
chord = Path('src/editor/chord-drag-controller.js')
text = chord.read_text()
text = text.replace(
    "  const target = state.active && !cancelled && !isEditingBlocked() ? targetFromNode(event.target) : null;",
    "  const dropElement = state.active && !cancelled && !isEditingBlocked()\n    ? document.elementFromPoint(event.clientX, event.clientY) || event.target\n    : null;\n  const target = dropElement ? targetFromNode(dropElement) : null;",
    1
)
chord.write_text(text)

# Preserve horizontal ribbon scrolling on touch while allowing vertical chord drags.
tools_css = Path('styles/editor-tools.css')
text = tools_css.read_text()
text = text.replace(
    '.editor-chord-button{min-height:34px;',
    '.editor-chord-button{min-height:34px;touch-action:pan-x;',
    1
)
tools_css.write_text(text)

# 3e) Renderer shares the canonical incremental document-index lifecycle.
renderer = Path('src/editor/renderer.js')
text = renderer.read_text()
text = text.replace(
    "  indexDocument,\n  isDocumentV3,",
    "  indexDocument,\n  isDocumentV3,\n  updateDocumentIndex,",
    1
)
old = """    if (!this.documentIndex || structureChanged || (changeSet?.relations || []).length) {
      this.documentIndex = indexDocument(this.document);
    }
"""
new = """    this.documentIndex = updateDocumentIndex(this.documentIndex, this.document, {
      measures: changeSet?.measures || [],
      relations: changeSet?.relations || [],
      structure: structureChanged
    });
"""
if old not in text:
    raise SystemExit('renderer document index block missing')
renderer.write_text(text.replace(old, new, 1))

# 3f) Playback follow: use row metadata first; only look ahead when the row actually changes.
playback = Path('src/editor/playback-controller.js')
text = playback.read_text()
pattern = r"function playbackVisualRows\(\) \{[\s\S]*?\n\}\n\nfunction followPlaybackLine\(node\) \{[\s\S]*?\n\}\n\nfunction measureNodeForEntry"
replacement = """function hasLaterVisualRow(visualRow) {
  const selector = visualRow?.classList?.contains('score-density-line') ? '.score-density-line' : '.tab-system';
  for (let sibling = visualRow?.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
    if (sibling.matches?.(selector)) return true;
  }
  return false;
}

function followPlaybackLine(node) {
  if (!node) return;
  const visualRow = node.closest?.('.score-density-line') || node.closest?.('.tab-system') || node;
  const rowIndex = Number(visualRow?.dataset?.visualRow ?? visualRow?.dataset?.scoreLine);
  if (!Number.isInteger(rowIndex) || rowIndex < 0) return;
  const key = `row:${rowIndex}`;
  if (key === state.lastCenteredKey) return;
  state.lastCenteredKey = key;
  if (rowIndex === 0 || !hasLaterVisualRow(visualRow)) return;
  const sheet = visualRow.closest('.sheet');
  if (!sheet || sheet.clientHeight <= 0) return;
  const sheetRect = sheet.getBoundingClientRect();
  const rowRect = visualRow.getBoundingClientRect();
  const rowCenter = rowRect.top + rowRect.height / 2;
  const centerInContent = sheet.scrollTop + (rowCenter - sheetRect.top);
  const maxScrollTop = Math.max(0, sheet.scrollHeight - sheet.clientHeight);
  sheet.scrollTo({ top: clamp(centerInContent - sheet.clientHeight / 2, 0, maxScrollTop), behavior: 'smooth' });
}

function measureNodeForEntry"""
updated, count = re.subn(pattern, replacement, text, count=1)
if count != 1:
    raise SystemExit('playback follow block missing')
playback.write_text(updated)

# Tests: final partial adaptive row natural width.
layout_test = Path('tests/editor-layout.test.mjs')
text = layout_test.read_text()
anchor = """{
  const plain=measure('plain');
"""
block = """{
  const documentModel=createDocumentV3({measures:['last-m1','last-m2','last-m3','last-m4','last-m5','last-m6'].map(id=>measure(id))});
  const layout=buildAdaptiveLayout(documentModel,{availableWidth:1200});
  assert.deepEqual(layout.systems.map(system=>system.measures.length),[4,2]);
  assert.ok(Math.abs(layout.systems[0].widthPx-1200)<0.001,'non-final full rows must still fill the available width');
  assert.ok(Math.abs(layout.systems[1].widthPx-600)<0.001,'only the final partial row should keep two natural 300px measure slots');
  assert.ok(layout.systems[1].measureWidthsPx.every(width=>Math.abs(width-300)<0.001),'final-row measures must keep the same natural width as a full-row slot');
}

"""
if anchor not in text:
    raise SystemExit('layout test insertion anchor missing')
layout_test.write_text(text.replace(anchor, block + anchor, 1))

# Tests: playback invalidation, canonical merge/index, no-op behavior, retired breaks.
render_test = Path('tests/editor-render-invalidation.test.mjs')
text = render_test.read_text()
text = text.replace(
    "assert.match(notationSource,/this\\.documentIndex = updateDocumentIndex",
    "assert.match(notationSource,/mergeChangeSets\\(this\\.pendingChangeSet, changeSet\\)/,'notation scheduling must use the canonical ChangeSet merge priority');\nassert.match(rendererSource,/this\\.documentIndex = updateDocumentIndex\\(this\\.documentIndex, this\\.document/,'score renderer must share the canonical incremental document-index lifecycle');\nassert.match(notationSource,/this\\.documentIndex = updateDocumentIndex",
    1
)
text = text.replace(
    "  assert.equal(strum.changeSet.layoutKind,'metrics','left-side sweep needs metric recalculation');",
    "  assert.equal(strum.changeSet.layoutKind,'metrics','left-side sweep needs metric recalculation');\n  assert.deepEqual(strum.changeSet.playback,['m-technique'],'strum changes must invalidate the cached playback event');",
    1
)
text = text.replace(
    "  assert.equal(relation.changeSet.layoutKind,'metrics');",
    "  assert.equal(relation.changeSet.layoutKind,'metrics');\n  assert.deepEqual(relation.changeSet.playback,['m-technique'],'slide creation must invalidate playback for its affected measure');",
    1
)
text = text.replace(
    "  assert.equal(removed.changeSet.layoutKind,'metrics');",
    "  assert.equal(removed.changeSet.layoutKind,'metrics');\n  assert.deepEqual(removed.changeSet.playback,['m-technique'],'slide deletion must invalidate playback for its affected measure');",
    1
)
render_test.write_text(text)

regression = Path('tests/editor-regression.test.mjs')
text = regression.read_text()
text = text.replace(
    "const store=new ScoreStore(song);",
    "const store=new ScoreStore(song);\n{\n  const beforeUpdatedAt=song.updatedAt;\n  let emits=0;\n  const unsubscribe=store.subscribe(()=>{emits+=1;});\n  const noOp=store.dispatch({type:'note/technique/remove',noteId:'n-harmonic',techniqueType:'does-not-exist'});\n  unsubscribe();\n  assert.equal(noOp.document,store.getDocument(),'no-op commands must keep the same canonical document object');\n  assert.equal(song.updatedAt,beforeUpdatedAt,'no-op commands must not dirty persistence timestamps');\n  assert.equal(emits,0,'no-op commands must not notify renderers');\n}\nassert.equal(Object.hasOwn(store.getDocument().layout,'systemBreakAfter'),false,'obsolete systemBreakAfter must be stripped at the V3 normalization boundary');",
    1
)
regression.write_text(text)

# Structure tests: logical-row semantics + single insertion indicator + final-only drop hit-test.
grid_test = Path('tests/editor-grid-structure-regression.test.mjs')
text = grid_test.read_text()
text = text.replace(
    "assert.match(structureSource,/deleteMeasures\\(documentModel, target\\.measureIds\\)/);",
    "assert.match(structureSource,/deleteSystem\\(documentModel, target\\.rowIndex\\)/,'row delete must use the same logical source-system semantics as copy/paste/drag');\nassert.doesNotMatch(structureSource,/measureIdsForSystem|target\\.measureIds/,'visual segment measure lists must not redefine row identity');",
    1
)
grid_test.write_text(text)

cleanup = Path('tests/editor-structure-cleanup.test.mjs')
text = cleanup.read_text()
# Replace the #85 direct-event-target assertions with one final coordinate hit-test assertions.
text = text.replace(
    "assert.doesNotMatch(dropResolution,/getBoundingClientRect|querySelector|elementsFromPoint/,'final structure drop resolution must read only the hovered drop-zone dataset');",
    "assert.doesNotMatch(dropResolution,/getBoundingClientRect|querySelector|elementsFromPoint/,'final structure drop resolution must read only drop-zone datasets');",
    1
)
text = text.replace(
    "assert.match(structureSource,/function finishPointerDrag\\(event[\\s\\S]*commitDropFromElement\\(event\\.target\\)/s,'document mutation should happen only on pointer release');",
    "assert.match(structureSource,/function finishPointerDrag\\(event[\\s\\S]*document\\.elementFromPoint\\(event\\.clientX, event\\.clientY\\)[\\s\\S]*commitDropFromElement/s,'structure drop should do one coordinate hit-test only on pointer release');",
    1
)
text = text.replace(
    "assert.doesNotMatch(structureSource,/activeDrop|clearDropUi|setActiveDrop|updateDropUi|elementsFromPoint|setPointerCapture|releasePointerCapture|measure-insert-boundary|row-drag-active|measure-drag-active|addEventListener\\('dragover'/,'legacy hover-target and native DnD paths must be deleted');",
    "assert.doesNotMatch(structureSource,/activeDrop|clearDropUi|setActiveDrop|updateDropUi|elementsFromPoint|setPointerCapture|releasePointerCapture|measure-insert-boundary|row-drag-active|measure-drag-active|addEventListener\\('dragover'/,'legacy hover-target and native DnD paths must be deleted');\nassert.equal((structureSource.match(/document\\.elementFromPoint\\(/g)||[]).length,1,'structure drag may hit-test only once at final pointerup');",
    1
)
text = text.replace(
    "assert.match(chordDragSource,/function finishPointerDrag\\(event[\\s\\S]*targetFromNode\\(event\\.target\\)[\\s\\S]*applyChordDrop/s,'chord target resolution and mutation must happen only on pointerup');",
    "assert.match(chordDragSource,/function finishPointerDrag\\(event[\\s\\S]*document\\.elementFromPoint\\(event\\.clientX, event\\.clientY\\)[\\s\\S]*targetFromNode\\(dropElement\\)[\\s\\S]*applyChordDrop/s,'chord target resolution must use one final coordinate hit-test on pointerup');\nassert.equal((chordDragSource.match(/document\\.elementFromPoint\\(/g)||[]).length,1,'chord drag may hit-test only once at final pointerup');",
    1
)
# Add CSS checks for one visible insertion line only.
text = text.replace(
    "assert.match(rowControlsCss,/structure-drag-row-active \\.row-drop-zone:hover::after/,'row drag feedback must follow native hover over full-row drop zones');",
    "assert.match(rowControlsCss,/structure-drag-row-active \\.row-drop-zone:hover::after/,'row drag feedback must follow native hover over full-row drop zones');\nassert.match(editorCss,/structure-drag-row-active \\.content\\.edit-view \\.editor-row-module:hover[^}]*border-color:transparent/s,'row drag must suppress the ordinary green row outline so only one insertion bar remains');\nassert.match(editorCss,/structure-drag-measure-active \\.measure-module-hitbox:hover[^}]*border-color:transparent/s,'measure drag must suppress the ordinary green measure outline so only one insertion bar remains');",
    1
)
cleanup.write_text(text)

# Retire obsolete break expectations from tests while keeping a migration-boundary regression input.
# Existing layout tests may still provide the old field; normalization stripping it is intentional.

# Architecture lock: no production editor module should maintain the obsolete break list.
arch = Path('tests/editor-architecture.test.mjs')
text = arch.read_text()
insert = "\nfor(const file of ['model.js','migrate-v2.js','commands.js','structure-commands.js','clipboard.js']){\n  const source=await readFile(new URL(`../src/editor/${file}`,import.meta.url),'utf8');\n  assert.equal(source.includes('systemBreakAfter'),false,`${file} must not retain obsolete systemBreakAfter persistence`);\n}\n"
if "must not retain obsolete systemBreakAfter persistence" not in text:
    text = text.replace("console.log('editor architecture tests passed');", insert + "\nconsole.log('editor architecture tests passed');")
arch.write_text(text)

# Playback follow source lock: no per-beat visual-row array scan.
playback_test = Path('tests/playback-layout-regression.test.mjs')
text = playback_test.read_text()
if "playbackVisualRows" in text:
    text = text.replace("assert.match(playbackSource,/playbackVisualRows/", "assert.doesNotMatch(playbackSource,/playbackVisualRows/", 1)
# Append a stable assertion regardless of existing content.
if "must not rebuild an array of every visual row" not in text:
    text = text.replace("console.log('playback layout regression tests passed');", "assert.doesNotMatch(playbackSource,/function playbackVisualRows\\(/,'playback follow must not rebuild an array of every visual row on each beat');\nassert.match(playbackSource,/const rowIndex = Number\\(visualRow\\?\\.dataset\\?\\.visualRow/,'playback follow should use renderer row metadata before doing any scroll work');\n\nconsole.log('playback layout regression tests passed');")
playback_test.write_text(text)

# Documentation: describe the now-canonical packed-row and incremental-index rules.
readme = Path('src/editor/README.md')
text = readme.read_text()
text = text.replace('Notation render pass builds one V3 document index', 'Notation and Sparse render passes keep one incrementally refreshed V3 document index')
if 'systemBreakAfter' in text:
    text = text.replace('systemBreakAfter', 'packed four-measure source systems')
readme.write_text(text)

# Ensure final production editor no longer contains the dead break field.
for path in ['src/editor/model.js','src/editor/migrate-v2.js','src/editor/commands.js','src/editor/structure-commands.js','src/editor/clipboard.js']:
    if 'systemBreakAfter' in Path(path).read_text():
        raise SystemExit(f'obsolete systemBreakAfter remains in {path}')

print('Applied final-row, drag-indicator, and canonical editor cleanup')
