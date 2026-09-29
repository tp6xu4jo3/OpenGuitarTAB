import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDocumentV3, fractionKey } from '../src/editor/model.js';
import { ensureSongDocumentV3 } from '../src/editor/migrate-v2.js';
import { editableTimesForMeasure } from '../src/editor/rhythm-grid.js';

const structureSource=await readFile(new URL('../src/editor/structure-controller.js',import.meta.url),'utf8');
const controllerSource=await readFile(new URL('../src/editor/controller.js',import.meta.url),'utf8');
const chordDragSource=await readFile(new URL('../src/editor/chord-drag-controller.js',import.meta.url),'utf8');
const headerCss=await readFile(new URL('../styles/header.css',import.meta.url),'utf8');

assert.match(structureSource,/function rowTargetForSystem\(system\)[\s\S]*dataset\.visualRow[\s\S]*measureIdsForSystem\(system\)/s,'row actions should resolve their target from live system metadata');
assert.match(structureSource,/makeRowHandle\([\s\S]*rowTargetForSystem\(handle\.closest\('\.tab-system'\)\)[\s\S]*dragState = \{ type: 'row', rowIndex: current\.rowIndex \}/s,'row handle actions must not retain a stale visualRow closure');
assert.match(structureSource,/function decorateSourceSystem\(sourceSystemIndex, \{[\s\S]*segmentationChanged = false,[\s\S]*visualRowStart = 0,[\s\S]*visualRowCount = 0/s,'local structure decoration must consume explicit renderer segmentation metadata');
const localDecoration=structureSource.slice(structureSource.indexOf('function decorateSourceSystem('),structureSource.indexOf('function handleRendered('));
assert.match(localDecoration,/if \(segmentationChanged\) \{[\s\S]*syncVisualRowMetadata\(systems\[visualRowIndex\], visualRowIndex\)/s,'only real segmentation changes should synchronize downstream visual-row metadata');
assert.doesNotMatch(localDecoration,/decorateEditor\(/,'local layout changes must not fall back to full structure decoration');
const dragUpdate=structureSource.slice(structureSource.indexOf('function updateDropUi('),structureSource.indexOf('function commitDrop('));
assert.doesNotMatch(dragUpdate,/querySelectorAll|getBoundingClientRect|elementFromPoint/,'dragover must use the drag-start geometry snapshot without forcing layout reads or document scans');
assert.match(structureSource,/function captureDragGeometry\(type\)[\s\S]*getBoundingClientRect[\s\S]*function beginDrag\(\)[\s\S]*dragGeometry = captureDragGeometry\(dragState\?\.type\)/s,'drag geometry should be measured once and only for the active drag type');
assert.match(structureSource,/document\.addEventListener\('dragover'[\s\S]*updateDropUi\(event\.clientX, event\.clientY\)/s,'every native dragover should immediately refresh the latest geometric drop target');
assert.doesNotMatch(structureSource,/scheduleDropUi|pendingDragPoint|dragFrame/,'structure dragging should not add a frame queue on top of native dragover');
assert.match(chordDragSource,/activeDropLookup = captureDropLookup\(\)/,'chord dragging should cache column targets once at drag start');
const chordDragOver=chordDragSource.slice(chordDragSource.indexOf('function handleDragOver('),chordDragSource.indexOf('function handleDrop('));
assert.doesNotMatch(chordDragOver,/document\.querySelector/,'chord dragover must not perform global document lookups');
assert.match(chordDragOver,/updateChordDropTarget\(event\.target\)/,'chord hover feedback should follow the current native drag target immediately');
assert.doesNotMatch(chordDragSource,/scheduleChordDropTarget|pendingDragNode|dragFrame/,'chord dragging should not queue hover feedback behind requestAnimationFrame');
assert.match(chordDragSource,/function handleDrop\(event\)[\s\S]*payloadFromTransfer\(event\.dataTransfer\)/s,'the chord payload should be read only when the user drops');
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
