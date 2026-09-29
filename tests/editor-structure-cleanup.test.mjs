import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDocumentV3, fractionKey } from '../src/editor/model.js';
import { ensureSongDocumentV3 } from '../src/editor/migrate-v2.js';
import { editableTimesForMeasure } from '../src/editor/rhythm-grid.js';

const structureSource=await readFile(new URL('../src/editor/structure-controller.js',import.meta.url),'utf8');
const controllerSource=await readFile(new URL('../src/editor/controller.js',import.meta.url),'utf8');
const chordDragSource=await readFile(new URL('../src/editor/chord-drag-controller.js',import.meta.url),'utf8');
const headerCss=await readFile(new URL('../styles/header.css',import.meta.url),'utf8');
const insertZoneCss=await readFile(new URL('../styles/editor-insert-zones.css',import.meta.url),'utf8');
const rowControlsCss=await readFile(new URL('../styles/editor-row-controls.css',import.meta.url),'utf8');
const editorV3Css=await readFile(new URL('../styles/editor-v3.css',import.meta.url),'utf8');
const editorModulesCss=await readFile(new URL('../styles/editor-modules.css',import.meta.url),'utf8');

assert.match(structureSource,/function rowTargetForSystem\(system\)[\s\S]*dataset\.visualRow[\s\S]*return \{ type: 'row', rowIndex, visualRowIndex \}/s,'row actions should resolve one logical source-row identity from live system metadata');
assert.match(structureSource,/makeRowHandle\([\s\S]*rowTargetForSystem\(handle\.closest\('\.tab-system'\)\)[\s\S]*beginPointerDrag\(event, \{ type: 'row', rowIndex: current\.rowIndex \}/s,'row handle actions must resolve live row metadata before pointer drag starts');
assert.match(structureSource,/function decorateSourceSystem\(sourceSystemIndex, \{[\s\S]*segmentationChanged = false,[\s\S]*visualRowStart = 0,[\s\S]*visualRowCount = 0/s,'local structure decoration must consume explicit renderer segmentation metadata');
const localDecoration=structureSource.slice(structureSource.indexOf('function decorateSourceSystem('),structureSource.indexOf('function handleRendered('));
assert.match(localDecoration,/if \(segmentationChanged\) \{[\s\S]*syncVisualRowMetadata\(systems\[visualRowIndex\], visualRowIndex\)/s,'only real segmentation changes should synchronize downstream visual-row metadata');
assert.doesNotMatch(localDecoration,/decorateEditor\(/,'local layout changes must not fall back to full structure decoration');
const pointerMove=structureSource.slice(structureSource.indexOf('function handlePointerMove('),structureSource.indexOf('function finishPointerDrag('));
assert.doesNotMatch(pointerMove,/elementFromPoint|elementsFromPoint|getBoundingClientRect|querySelector/,'pointermove must only cross the drag threshold and let native hover follow the pointer');
assert.match(pointerMove,/Math\.hypot[\s\S]*classList\.add\('structure-drag-active'/s,'pointermove should only activate the drag state after the movement threshold');
const dropResolution=structureSource.slice(structureSource.indexOf('function rowDropTargetFromElement('),structureSource.indexOf('function resetDrag('));
assert.equal((structureSource.match(/document\.elementFromPoint\(/g)||[]).length,1,'structure dragging may coordinate-hit-test exactly once on pointerup for mouse/touch/pen');
assert.doesNotMatch(structureSource,/document\.elementsFromPoint/,'structure dragging must not scan stacked pointer targets');
assert.match(structureSource,/function finishPointerDrag\(event[\s\S]*document\.elementFromPoint\(event\.clientX, event\.clientY\)[\s\S]*commitDropFromElement\(dropElement\)/s,'structure drop should coordinate-hit-test exactly once only on pointerup');
assert.doesNotMatch(structureSource,/activeDrop|clearDropUi|setActiveDrop|updateDropUi|elementsFromPoint|setPointerCapture|releasePointerCapture|measure-insert-boundary|row-drag-active|measure-drag-active|addEventListener\('dragover'/,'legacy hover-target and native DnD paths must be deleted');
assert.equal((structureSource.match(/document\.elementFromPoint\(/g)||[]).length,1,'structure drag may hit-test only once at final pointerup');
assert.doesNotMatch(insertZoneCss,/drop-before|drop-after|measure-insert-boundary|measure-drag-grip|is-drag-target|measure-insert-shift/,'legacy insertion drag CSS must be removed');
assert.doesNotMatch(rowControlsCss,/\.row-drag-active|is-drag-target|drop-before|drop-after/,'legacy row drop-target CSS must be removed');
assert.match(structureSource,/dragIndicator = document\.createElement\('div'\)[\s\S]*className = 'structure-drop-indicator'/s,'structure dragging must own one reusable DOM insertion indicator');
assert.match(structureSource,/function handlePointerOver\(event\)[\s\S]*showDragIndicatorForElement\(event\.target\)/s,'native pointer target changes should move the single insertion indicator');
assert.match(structureSource,/document\.addEventListener\('pointerover', handlePointerOver, true\)/,'drag indicator updates should be delegated once instead of installed per drop zone');
assert.match(structureSource,/dropTarget\.className = 'row-boundary-drop-target'[\s\S]*dropTarget\.dataset\.dropRowBoundary = String\(index\)/s,'each row insertion boundary must own one canonical browser hit target');
assert.doesNotMatch(structureSource,/makeRowDropZone|row-drop-zone/,'row dragging must not duplicate one logical boundary across row halves and insertion gaps');
assert.match(rowControlsCss,/\.row-boundary-drop-target \.structure-drop-indicator/,'row drag feedback must anchor the shared insertion indicator to the canonical boundary target');
assert.doesNotMatch(rowControlsCss,/row-drop-zone|row-insert-zone>\.structure-drop-indicator/,'row drag CSS must not keep duplicate physical representations of one boundary');
assert.match(structureSource,/for \(let localBoundary = 0; localBoundary <= count; localBoundary\+\+\)[\s\S]*makeMeasureDropBoundary\(rowIndex, start \+ localBoundary/s,'each visual measure grid must create exactly count + 1 canonical boundary targets');
assert.match(editorModulesCss,/\.measure-drop-boundary \.structure-drop-indicator/,'measure drag feedback must anchor the shared insertion indicator to a canonical nearest-boundary target');
assert.doesNotMatch(structureSource,/measure-drop-zone-before|measure-drop-zone-after|makeMeasureDropZone/,'measure dragging must not duplicate interior boundaries as left and right half-zones');
assert.doesNotMatch(editorModulesCss,/measure-drop-zone-before|measure-drop-zone-after|\.measure-drop-zone\{/,'legacy duplicated measure half-zones must be removed');
assert.match(editorModulesCss,/structure-drag-row-active \.content\.edit-view \.editor-row-module:hover[^}]*border-color:transparent/s,'row drag must suppress the ordinary green row outline so only one insertion bar remains');
assert.match(editorModulesCss,/structure-drag-measure-active \.measure-module-hitbox:hover[^}]*border-color:transparent/s,'measure drag must suppress the ordinary green measure outline so only one insertion bar remains');
assert.match(structureSource,/row-boundary-drop-target\[data-drop-row-boundary\]/,'row drop resolution must read the one canonical row-boundary target');
assert.match(structureSource,/measure-drop-boundary\[data-row\]\[data-drop-measure-boundary\]/,'measure drop resolution must read the one canonical measure-boundary target');
assert.doesNotMatch(dropResolution,/getBoundingClientRect|querySelector|elementsFromPoint/,'final structure drop resolution must read only drop-zone datasets');
const chordPointerMove=chordDragSource.slice(chordDragSource.indexOf('function handlePointerMove('),chordDragSource.indexOf('function applyChordDrop('));
assert.doesNotMatch(chordPointerMove,/querySelector|elementFromPoint|elementsFromPoint|getBoundingClientRect|classList\.remove/,'chord pointermove must only cross the drag threshold and activate native hover');
assert.match(chordPointerMove,/Math\.hypot[\s\S]*classList\.add\('chord-drag-active'\)/s,'chord dragging must activate one root hover state after the movement threshold');
assert.match(chordDragSource,/function finishPointerDrag\(event[\s\S]*document\.elementFromPoint\(event\.clientX, event\.clientY\)[\s\S]*targetFromNode\(dropElement\)[\s\S]*applyChordDrop/s,'chord target resolution must use one final coordinate hit-test on pointerup');
assert.equal((chordDragSource.match(/document\.elementFromPoint\(/g)||[]).length,1,'chord drag may hit-test only once at final pointerup');
assert.doesNotMatch(chordDragSource,/dragstart|dragover|dragend|dataTransfer|CHORD_DRAG_MIME|activeDropLookup|activeDropTarget|captureDropLookup|is-chord-drop-target/,'legacy HTML5 chord drag state must be deleted');
assert.match(editorV3Css,/\.chord-drag-active \.v3-column-target:hover::after\{[^}]*width:3px[^}]*background:#1ed760/s,'chord green indicator must be driven directly by native hover');
for(const source of [controllerSource,chordDragSource]){
  assert.equal(source.includes('isEditingBlocked'),true,'editor interactions should use canonical view-state editing blocking');
  assert.equal(source.includes('isPreviewActive'),false,'editor controllers should not duplicate preview/score blocking logic');
  assert.equal(source.includes('isScoreViewActive'),false,'editor controllers should not duplicate preview/score blocking logic');
}
for(const deadSelector of ['.content.edit-view .rhythm-layer','.content.score-view .tab-system.score-system','.score-grid-pair','.measure-line.first']){
  assert.equal(headerCss.includes(deadSelector),false,`obsolete Dense selector should be removed: ${deadSelector}`);
}
assert.equal(headerCss.includes('.content.score-view .tab-grid'),true,'active Sparse tab-grid score rule should be preserved');

{
  const measure = {
    id: 'm-columns',
    timeSignature: { numerator: 4, denominator: 4 },
    events: [{
      id: 'e-triplet',
      at: [1, 3],
      duration: [1, 6],
      notes: [{ id: 'n-triplet', string: 0, fret: '3', techniques: [] }],
      marks: []
    }],
    groups: [{
      id: 'g-triplet',
      type: 'tuplet',
      ratio: [3, 2],
      slots: [[0, 1], [1, 6], [1, 3]],
      duration: [1, 6],
      eventIds: ['e-triplet']
    }]
  };
  const documentModel = createDocumentV3({ measures: [measure] });
  const times = editableTimesForMeasure(documentModel.measures[0]);
  const keys = new Set(times.map(item => fractionKey(item.at)));
  assert.equal(keys.has('0/1'), true, 'base sixteenth columns remain editable');
  assert.equal(keys.has('1/6'), true, 'triplet columns are first-class sparse targets');
  assert.equal(keys.has('1/3'), true, 'fractional event columns are retained');
  assert.equal(times.length < 30, true, 'sparse renderer must not materialize six strings per time column');
}

{
  const row = Array.from({ length: 6 }, () => Array(64).fill(''));
  row[0][0] = '3';
  const song = { id: 'legacy-boundary', beatsPerMeasure: 4, rows: [row], rowMeasureCounts: [1] };
  ensureSongDocumentV3(song);
  assert.equal(song.document.version, 3);
  assert.equal(song.document.measures[0].events[0].notes[0].fret, '3');
  assert.equal('rows' in song, false);
  assert.equal('rhythmRows' in song, false);
  assert.equal('rowMeasureCounts' in song, false);
}

console.log('editor sparse structure cleanup tests passed');
