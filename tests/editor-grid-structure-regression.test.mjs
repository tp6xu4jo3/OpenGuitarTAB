import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDocumentV3 } from '../src/editor/model.js';
import { buildAdaptiveLayout, buildSystems, measureComplexity } from '../src/editor/layout.js';
import { insertSystem, moveMeasureAt } from '../src/editor/structure-commands.js';

function plainMeasure(id, { eventCount = 1, technique = false } = {}) {
  const events = Array.from({ length: eventCount }, (_, index) => ({
    id: `${id}-e${index}`,
    at: [index, Math.max(1, eventCount)],
    duration: [1, 4],
    notes: [{
      id: `${id}-n${index}`,
      string: index % 6,
      fret: String((index % 9) + 1),
      techniques: technique && index === 0
        ? [{ id: `${id}-tech`, type: 'harmonic', touchFret: 12 }]
        : []
    }],
    marks: []
  }));
  return {
    id,
    timeSignature: { numerator: 4, denominator: 4 },
    events,
    groups: []
  };
}

{
  const documentModel = createDocumentV3({
    measures: [plainMeasure('dense-plain', { eventCount: 8 }), plainMeasure('simple')]
  });
  assert.equal(
    measureComplexity(documentModel, documentModel.measures[0]),
    measureComplexity(documentModel, documentModel.measures[1]),
    'ordinary note density must not make a measure elastically wider'
  );
  const layout = buildAdaptiveLayout(documentModel, { availableWidth: 900 });
  assert.ok(
    Math.abs(layout.systems[0].measureWidths[0] - layout.systems[0].measureWidths[1]) < 0.001,
    'measures without techniques must receive equal widths on the same visual row'
  );
}

{
  const documentModel = createDocumentV3({
    measures: [plainMeasure('technique', { technique: true }), plainMeasure('plain')]
  });
  assert.ok(
    measureComplexity(documentModel, documentModel.measures[0]) > measureComplexity(documentModel, documentModel.measures[1]),
    'technique notation may request extra measure width'
  );
  const layout = buildAdaptiveLayout(documentModel, { availableWidth: 900 });
  assert.ok(layout.systems[0].measureWidths[0] > layout.systems[0].measureWidths[1]);
}

function twoRows() {
  return createDocumentV3({
    measures: Array.from({ length: 8 }, (_, index) => plainMeasure(`m${index + 1}`)),
    layout: { systemBreakAfter: ['m4', 'm8'] }
  });
}

{
  const movedDown = moveMeasureAt(twoRows(), 0, 1, 1, 2).document;
  assert.deepEqual(
    buildSystems(movedDown).map(system => system.map(measure => measure.id)),
    [
      ['m1', 'm3', 'm4', 'm5'],
      ['m6', 'm2', 'm7', 'm8']
    ],
    'moving a measure downward must exchange the target row first measure back to the source row end'
  );
}

{
  const movedUp = moveMeasureAt(twoRows(), 1, 2, 0, 2).document;
  assert.deepEqual(
    buildSystems(movedUp).map(system => system.map(measure => measure.id)),
    [
      ['m1', 'm2', 'm7', 'm3'],
      ['m4', 'm5', 'm6', 'm8']
    ],
    'moving a measure upward must exchange the target row last measure back to the source row front'
  );
}

{
  const documentModel = twoRows();
  const inserted = insertSystem(documentModel, 1).document;
  assert.equal(buildSystems(inserted).length, 3, 'row boundary insertion must create a real logical system');
  assert.equal(buildSystems(inserted)[1].length, 4);
}

const rendererSource = await readFile(new URL('../src/editor/renderer.js', import.meta.url), 'utf8');
const editorCss = await readFile(new URL('../styles/editor-v3.css', import.meta.url), 'utf8');
const chordDragSource = await readFile(new URL('../src/editor/chord-drag-controller.js', import.meta.url), 'utf8');
const structureSource = await readFile(new URL('../src/editor/structure-controller.js', import.meta.url), 'utf8');
const structureCommandsSource = await readFile(new URL('../src/editor/structure-commands.js', import.meta.url), 'utf8');

assert.match(rendererSource, /addFractions\(at, duration \|\| BASE_GRID_STEP\)/, 'sparse columns must align to the legacy visual subdivision position');
assert.match(rendererSource, /--v3-anchor-x/, 'each sparse hit target must expose its exact visual circle anchor');
assert.match(editorCss, /data-at\$="\/1"[^}]*--v3-dot-radius:6px[^}]*--v3-dot-fill:#e8e8e8/s, 'quarter-note circles must be large gray');
assert.match(editorCss, /data-at\$="\/2"[^}]*--v3-dot-radius:6px[^}]*--v3-dot-fill:#fff/s, 'eighth-note circles must be large white');
assert.match(editorCss, /data-at\$="\/4"[^}]*--v3-dot-radius:3px[^}]*--v3-dot-fill:#fff/s, 'sixteenth-note circles must be small white');
assert.match(chordDragSource, /let activeDragPayload = null/);
const dragOverSource = chordDragSource.slice(chordDragSource.indexOf('function handleDragOver'), chordDragSource.indexOf('function handleDrop'));
assert.match(dragOverSource, /activeDragPayload/, 'dragover must use the payload captured at dragstart');
assert.doesNotMatch(dragOverSource, /payloadFromTransfer/, 'dragover must not depend on DataTransfer.getData, which browsers can hide until drop');
assert.match(structureSource, /function insertSystemAtBoundary\(index\)/);
assert.match(structureSource, /event\.stopPropagation\(\);\s*insertSystemAtBoundary\(index\)/s, 'between-row add button must call the row boundary insertion path directly');
assert.doesNotMatch(structureCommandsSource, /cascadeInsert/, 'cross-row measure moves must use edge exchange, not cascade overflow');

console.log('editor grid and structure regression tests passed');
