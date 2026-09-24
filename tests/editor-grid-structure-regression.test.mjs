import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDocumentV3 } from '../src/editor/model.js';
import { buildAdaptiveLayout, buildSystems, measureComplexity } from '../src/editor/layout.js';
import { deleteSystem, insertMeasureAt, insertSystem, moveMeasureAt } from '../src/editor/structure-commands.js';

function plainMeasure(id,{mark=false,harmonic=false}={}){
  return {id,timeSignature:{numerator:4,denominator:4},groups:[],events:[{id:`${id}-e`,at:[0,1],duration:[1,4],marks:mark?[{id:`${id}-mk`,type:'strum',direction:'up'}]:[],notes:[{id:`${id}-n`,string:0,fret:'5',techniques:harmonic?[{id:`${id}-h`,type:'harmonic',touchFret:17}]:[]}]}]};
}
function twoRows(){return createDocumentV3({measures:Array.from({length:8},(_,i)=>plainMeasure(`m${i+1}`)),layout:{systemBreakAfter:['m4','m8']}});}
function ids(){let n=0;return prefix=>`${prefix}-structure-${++n}`;}

{
  const doc=createDocumentV3({measures:[plainMeasure('harmonic',{harmonic:true}),plainMeasure('plain')]});
  assert.equal(measureComplexity(doc,doc.measures[0]),measureComplexity(doc,doc.measures[1]),'harmonic does not flex layout');
  const layout=buildAdaptiveLayout(doc,{availableWidth:900});
  assert.ok(Math.abs(layout.systems[0].measureWidths[0]-layout.systems[0].measureWidths[1])<0.001);
}
{
  const doc=createDocumentV3({measures:[plainMeasure('sweep',{mark:true}),plainMeasure('plain')]});
  assert.ok(measureComplexity(doc,doc.measures[0])>measureComplexity(doc,doc.measures[1]),'left-side sweep may flex layout');
}
{
  const moved=moveMeasureAt(twoRows(),0,1,1,2).document;
  assert.deepEqual(buildSystems(moved).map(row=>row.map(m=>m.id)),[['m1','m3','m4','m5'],['m6','m2','m7','m8']]);
}
{
  const moved=moveMeasureAt(twoRows(),1,2,0,2).document;
  assert.deepEqual(buildSystems(moved).map(row=>row.map(m=>m.id)),[['m1','m2','m7','m3'],['m4','m5','m6','m8']]);
}
{
  const inserted=insertMeasureAt(twoRows(),0,2,{idFactory:ids(),overflowDirection:'forward'}).document;
  const rows=buildSystems(inserted).map(row=>row.map(m=>m.id));
  assert.equal(rows[0].length,4);
  assert.equal(rows[1][0],'m4','right insertion must spill previous row tail to next row front');
  assert.equal(rows.at(-1).length,1,'cascade may create a new final row instead of rejecting insertion');
}
{
  const inserted=insertMeasureAt(twoRows(),1,2,{idFactory:ids(),overflowDirection:'backward'}).document;
  const rows=buildSystems(inserted).map(row=>row.map(m=>m.id));
  assert.equal(rows[1].length,4);
  assert.equal(rows[0].at(-1),'m5','left insertion must spill target row head to previous row tail');
}
{
  const inserted=insertSystem(twoRows(),1).document;
  assert.equal(buildSystems(inserted).length,3);
  const deleted=deleteSystem(inserted,1).document;
  assert.equal(buildSystems(deleted).length,2,'inserted row must also be deletable');
}

const rendererSource=await readFile(new URL('../src/editor/renderer.js',import.meta.url),'utf8');
const editorCss=await readFile(new URL('../styles/editor-v3.css',import.meta.url),'utf8');
const chordDragSource=await readFile(new URL('../src/editor/chord-drag-controller.js',import.meta.url),'utf8');
const structureSource=await readFile(new URL('../src/editor/structure-controller.js',import.meta.url),'utf8');
const rowCss=await readFile(new URL('../styles/editor-row-controls.css',import.meta.url),'utf8');
assert.match(rendererSource,/layoutKind === 'structure'/,'structural edits must rebuild row DOM immediately');
assert.match(editorCss,/data-at\$="\/1"[^}]*--v3-dot-radius:6px[^}]*--v3-dot-fill:#e8e8e8/s);
assert.match(editorCss,/data-at\$="\/2"[^}]*--v3-dot-radius:6px[^}]*--v3-dot-fill:#fff/s);
assert.match(editorCss,/data-at\$="\/4"[^}]*--v3-dot-radius:3px[^}]*--v3-dot-fill:#fff/s);
assert.match(chordDragSource,/let activeDragPayload = null/);
assert.match(structureSource,/insertMeasureAt\(documentModel, target\.rowIndex, target\.measureIndex, \{ overflowDirection: 'backward' \}\)/);
assert.match(structureSource,/insertMeasureAt\(documentModel, target\.rowIndex, target\.measureIndex \+ 1, \{ overflowDirection: 'forward' \}\)/);
assert.doesNotMatch(structureSource,/每列最多4個小節/);
assert.match(rowCss,/\.row-insert-zone\{[^}]*z-index:40/s);
console.log('editor grid and structure regression tests passed');
