import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyCommand, createChangeSet, LAYOUT_INVALIDATION } from '../src/editor/commands.js';
import { createDocumentV3, indexDocument, updateDocumentIndex } from '../src/editor/model.js';
import { NotationRenderer } from '../src/editor/notation-renderer.js';

const rendererSource=await readFile(new URL('../src/editor/renderer.js',import.meta.url),'utf8');
const notationSource=await readFile(new URL('../src/editor/notation-renderer.js',import.meta.url),'utf8');
const relationSource=await readFile(new URL('../src/editor/relation-renderer.js',import.meta.url),'utf8');
const controllerSource=await readFile(new URL('../src/editor/controller.js',import.meta.url),'utf8');
const commandsSource=await readFile(new URL('../src/editor/commands.js',import.meta.url),'utf8');

assert.match(rendererSource,/rebuildNavigationIndex\(\)[\s\S]*editableTimesForMeasure\(measure\)[\s\S]*navigationLookup/s,'navigation should be indexed from document rhythmic times when grid structure changes');
assert.match(rendererSource,/navigateCursor\([\s\S]*navigationLookup\.get/s,'arrow navigation should use the cached rhythmic navigation index');
assert.doesNotMatch(rendererSource,/navigateCursor\([\s\S]*querySelectorAll\('\.v3-column-target/s,'arrow navigation must not rescan and sort every DOM column per key press');
assert.match(rendererSource,/const navigation = \{ measureId:[\s\S]*requestAnimationFrame\(\(\) => \{\s*const next = this\.navigateCursor\(navigation\)/s,'arrow navigation should resolve its destination after commit rerenders');

assert.doesNotMatch(rendererSource,/editorPlayback\?\.invalidate|updateProgressRange/,'renderer completion must not own playback invalidation or playback-index rebuilding');
assert.match(controllerSource,/changeSet\?\.document \|\| changeSet\?\.playback\?\.length[\s\S]*editorPlayback\?\.invalidate/s,'store ChangeSet playback scope should own playback invalidation');

assert.match(rendererSource,/buildAdaptiveSystemLayout\(sourceMeasures,[\s\S]*sourceSystemIndex,[\s\S]*availableWidth/s,'local layout changes must recalculate only the affected source-system measures');
const applyLayoutChangeSource=rendererSource.slice(rendererSource.indexOf('  applyLayoutChange(changeSet) {'),rendererSource.indexOf('  updateGridWidths(grid, segment) {'));
assert.doesNotMatch(applyLayoutChangeSource,/buildAdaptiveLayout\(/,'local layout changes must not rebuild the full adaptive document plan');
assert.match(rendererSource,/replaceAdaptiveSourcePlan\([\s\S]*logicalSystems\[sourceSystemIndex\] = sourceMeasures/s,'the renderer should replace only the affected source-system slice in its existing plan');
assert.match(applyLayoutChangeSource,/const segmentationChanged = !sameShape;/,'renderer completion must report whether adaptive visual segmentation actually changed');
assert.match(applyLayoutChangeSource,/const visualRowStart = nextPlan\.systems\.findIndex\([\s\S]*const visualRowCount = nextSegments\.length/s,'renderer must derive the affected visual-row range from its layout plan');
assert.match(applyLayoutChangeSource,/createSystem\(segment, visualRowStart \+ index\)/,'replacement systems must receive global visual-row indices from the layout plan');
assert.match(applyLayoutChangeSource,/publishRendered\(\{[\s\S]*sourceSystemIndex,[\s\S]*segmentationChanged,[\s\S]*visualRowStart,[\s\S]*visualRowCount/s,'render completion metadata must carry segmentation scope to structure ownership');
assert.doesNotMatch(applyLayoutChangeSource,/querySelectorAll\(':scope > \.tab-system'\)[\s\S]*dataset\.visualRow/s,'renderer must not rescan every visual system to rewrite row metadata after a local layout change');

assert.match(notationSource,/import \{ mergeChangeSets \} from '.\/commands\.js';/,'notation scheduling must reuse the canonical ChangeSet merge');
const notationScheduleSource=notationSource.slice(notationSource.indexOf('  schedule(documentModel, changeSet = null) {'),notationSource.indexOf('  previewRelation('));
assert.match(notationScheduleSource,/this\.pendingChangeSet = mergeChangeSets\(this\.pendingChangeSet, changeSet \|\| \{ document: true \}\);/,'pending notation work must merge through the canonical ChangeSet path');
assert.doesNotMatch(notationScheduleSource,/fullRenderPending|new Set|\.\.\.previous|\.\.\.changeSet/,'notation scheduling must not retain a second manual ChangeSet merge implementation');
assert.match(notationSource,/this\.documentIndex = updateDocumentIndex\(this\.documentIndex, this\.document,[\s\S]*measures: changeSet\?\.measures[\s\S]*relations: changeSet\?\.relations/s,'notation should incrementally refresh its persistent document index');
assert.match(notationSource,/const systems = new Set\(\)[\s\S]*for \(const measureId of dirty\)[\s\S]*closest\?\.\('\.tab-system'\)[\s\S]*for \(const sourceRow of layoutRows\)/s,'partial notation redraw should collect only dirty measure and affected source-row systems');
assert.doesNotMatch(notationSource,/this\.document\.measures\.filter/,'notation partial rendering must not scan the full measure list');
assert.doesNotMatch(notationSource,/for \(const relation of this\.document\.relations/,'notation technique markers must use the per-measure relation index');
assert.match(relationSource,/render\(documentModel, systemElement, measureIds, documentIndex = null\)[\s\S]*documentIndex \|\| indexDocument\(documentModel\)/s,'relation rendering should reuse the notation pass index when provided');
assert.match(commandsSource,/measureMetricsChanged\([\s\S]*layoutFrom: layoutChanged \? measure\.id : null/s,'note commands should derive layout invalidation from actual measure complexity');

{
  const documentStub={version:3,measures:[],relations:[],layout:{systemBreakAfter:[]}};
  const metrics=createChangeSet({
    measures:['m-metrics'],playback:['p-metrics'],relations:['r-metrics'],
    layoutFrom:'m-metrics',layoutKind:LAYOUT_INVALIDATION.METRICS
  });
  const grid=createChangeSet({
    measures:['m-grid'],playback:['p-grid'],relations:['r-grid'],
    layoutFrom:'m-grid',layoutKind:LAYOUT_INVALIDATION.GRID
  });
  const structure=createChangeSet({
    measures:['m-structure'],playback:['p-structure'],relations:['r-structure'],
    layoutFrom:'m-structure',layoutKind:LAYOUT_INVALIDATION.STRUCTURE
  });
  const partial=createChangeSet({measures:['m-partial'],playback:['p-partial'],relations:['r-partial']});
  const full=createChangeSet({measures:['m-full'],playback:['p-full'],relations:['r-full'],document:true});
  const originalRequestAnimationFrame=globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame=()=>1;
  try{
    const metricsThenGrid=new NotationRenderer({});
    metricsThenGrid.schedule(documentStub,metrics);
    metricsThenGrid.schedule(documentStub,grid);
    assert.equal(metricsThenGrid.pendingChangeSet.layoutKind,LAYOUT_INVALIDATION.GRID,'metrics + grid in one RAF must retain grid priority');
    assert.deepEqual(new Set(metricsThenGrid.pendingChangeSet.measures),new Set(['m-metrics','m-grid']));
    assert.deepEqual(new Set(metricsThenGrid.pendingChangeSet.playback),new Set(['p-metrics','p-grid']),'pending playback scope must union across the RAF');
    assert.deepEqual(new Set(metricsThenGrid.pendingChangeSet.relations),new Set(['r-metrics','r-grid']),'pending relation scope must union across the RAF');

    const gridThenStructure=new NotationRenderer({});
    gridThenStructure.schedule(documentStub,grid);
    gridThenStructure.schedule(documentStub,structure);
    assert.equal(gridThenStructure.pendingChangeSet.layoutKind,LAYOUT_INVALIDATION.STRUCTURE,'grid + structure in one RAF must retain structure priority');

    const structureThenPartial=new NotationRenderer({});
    structureThenPartial.schedule(documentStub,structure);
    structureThenPartial.schedule(documentStub,partial);
    assert.equal(structureThenPartial.pendingChangeSet.layoutKind,LAYOUT_INVALIDATION.STRUCTURE,'a later ordinary measure update must not erase pending structure scope');
    assert.equal(structureThenPartial.pendingChangeSet.layoutFrom,'m-structure');
    assert.deepEqual(new Set(structureThenPartial.pendingChangeSet.measures),new Set(['m-structure','m-partial']));

    const fullThenPartial=new NotationRenderer({});
    fullThenPartial.schedule(documentStub,full);
    fullThenPartial.schedule(documentStub,partial);
    assert.equal(fullThenPartial.pendingChangeSet.document,true,'document=true must survive later partial work in the same RAF');
    assert.deepEqual(new Set(fullThenPartial.pendingChangeSet.measures),new Set(['m-full','m-partial']));
  }finally{
    if(originalRequestAnimationFrame===undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame=originalRequestAnimationFrame;
  }
}

{
  const indexedDocument=createDocumentV3({measures:[
    {id:'m-index-a',timeSignature:{numerator:4,denominator:4},groups:[],events:[{id:'e-index-a',at:[0,1],duration:[1,4],marks:[],notes:[{id:'n-index-a',string:0,fret:'5',techniques:[]}]}]},
    {id:'m-index-b',timeSignature:{numerator:4,denominator:4},groups:[],events:[{id:'e-index-b',at:[0,1],duration:[1,4],marks:[],notes:[{id:'n-index-b',string:1,fret:'7',techniques:[]}]}]}
  ],relations:[{id:'r-index',type:'slide',fromNoteId:'n-index-a',toNoteId:'n-index-b'}]});
  const index=indexDocument(indexedDocument);
  const changedMeasure={
    ...indexedDocument.measures[0],
    events:[{...indexedDocument.measures[0].events[0],notes:[{...indexedDocument.measures[0].events[0].notes[0],fret:'9'}]}]
  };
  const afterMeasure={...indexedDocument,measures:[changedMeasure,indexedDocument.measures[1]]};
  updateDocumentIndex(index,afterMeasure,{measures:['m-index-a']});
  assert.equal(index.noteById.get('n-index-a').fret,'9','partial measure refresh should update indexed note payloads without rebuilding unrelated measures');
  assert.equal(index.measureById.get('m-index-b').measure,indexedDocument.measures[1],'unrelated measure index entries should be retained');
  assert.equal(index.relationsByMeasure.get('m-index-a')?.[0]?.id,'r-index','unchanged relations should remain indexed after a local measure refresh');

  const withoutRelation={...afterMeasure,relations:[]};
  updateDocumentIndex(index,withoutRelation,{relations:['r-index']});
  assert.equal(index.relationById.has('r-index'),false,'deleted relations should be removed incrementally');
  assert.equal(index.relationsByMeasure.get('m-index-a')?.some(relation=>relation.id==='r-index')||false,false,'relation measure buckets should release deleted relations');
}

function idFactory(){let sequence=0;return prefix=>`${prefix}-invalidation-${++sequence}`;}
const ids=idFactory();
let documentModel=createDocumentV3({measures:[
  {id:'m-technique',timeSignature:{numerator:4,denominator:4},groups:[],events:[
    {id:'e-chord',at:[0,1],duration:[1,4],marks:[],notes:[{id:'n-a',string:0,fret:'5',techniques:[]},{id:'n-b',string:2,fret:'5',techniques:[]}]},
    {id:'e-next',at:[1,1],duration:[1,4],marks:[],notes:[{id:'n-next',string:0,fret:'7',techniques:[]}]}
  ]},
  {id:'m-rhythm',timeSignature:{numerator:4,denominator:4},events:[],groups:[]}
],relations:[],layout:{systemBreakAfter:[]}},{idFactory:ids});
function apply(command){const result=applyCommand(documentModel,command,{idFactory:ids});documentModel=result.document;return result;}

{
  const harmonic=apply({type:'note/technique/add',noteId:'n-a',technique:{type:'harmonic'}});
  assert.equal(harmonic.changeSet.layoutFrom,'m-technique','harmonic score text should update its local spacing immediately');
  assert.equal(harmonic.changeSet.layoutKind,'metrics');
  const strum=apply({type:'event/mark/add',eventId:'e-chord',mark:{type:'strum',direction:'up'}});
  assert.equal(strum.changeSet.layoutFrom,'m-technique');
  assert.equal(strum.changeSet.layoutKind,'metrics','left-side sweep needs metric recalculation');
  const relation=apply({type:'relation/add',relation:{type:'slide',fromNoteId:'n-a',toNoteId:'n-next'}});
  assert.equal(relation.changeSet.layoutFrom,'m-technique','slide source columns should reserve right-side spacing immediately');
  assert.equal(relation.changeSet.layoutKind,'metrics');
  const removed=apply({type:'relation/delete',relationId:relation.document.relations[0].id});
  assert.equal(removed.changeSet.layoutFrom,'m-technique','removing a slide should release its local spacing immediately');
  assert.equal(removed.changeSet.layoutKind,'metrics');
}

{
  const ordinary=apply({type:'note/set',measureId:'m-technique',at:[1,4],duration:[1,4],string:1,fret:'12'});
  assert.equal(ordinary.changeSet.layoutFrom,'m-technique','a two-digit fret must trigger local spacing on its own');
  assert.equal(ordinary.changeSet.layoutKind,'metrics');
  const secondTwoDigit=apply({type:'note/set',measureId:'m-technique',at:[0,1],duration:[1,4],string:0,fret:'12'});
  assert.equal(secondTwoDigit.changeSet.layoutFrom,null,'a two-digit fret needs no extra reflow when that column already reserves more space for harmonic notation');
  assert.equal(secondTwoDigit.changeSet.layoutKind,null);
}

{
  const triplet=apply({type:'rhythm/triplet/apply',measureId:'m-rhythm',startAt:[0,1],subdivision:'eighth'});
  assert.equal(triplet.changeSet.layoutKind,'grid');
  const groupId=triplet.document.measures[1].groups[0].id;
  const removedGroup=apply({type:'group/delete',groupId});
  assert.equal(removedGroup.changeSet.layoutKind,'grid');
}

{
  const thirtySecond=apply({type:'rhythm/32nd/apply',measureId:'m-rhythm',startAt:[1,1]});
  assert.equal(thirtySecond.changeSet.layoutFrom,'m-rhythm');
  assert.equal(thirtySecond.changeSet.layoutKind,'grid');
}

{
  const replacement=apply({type:'measure/replace-content',measureId:'m-rhythm',measure:{timeSignature:{numerator:4,denominator:4},events:[],groups:[]}});
  assert.equal(replacement.changeSet.layoutKind,'grid');
}

console.log('editor render invalidation tests passed');