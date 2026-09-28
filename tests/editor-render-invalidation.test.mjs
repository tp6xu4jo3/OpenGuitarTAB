import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyCommand } from '../src/editor/commands.js';
import { createDocumentV3, indexDocument, updateDocumentIndex } from '../src/editor/model.js';

const rendererSource=await readFile(new URL('../src/editor/renderer.js',import.meta.url),'utf8');
const notationSource=await readFile(new URL('../src/editor/notation-renderer.js',import.meta.url),'utf8');
const relationSource=await readFile(new URL('../src/editor/relation-renderer.js',import.meta.url),'utf8');
const controllerSource=await readFile(new URL('../src/editor/controller.js',import.meta.url),'utf8');
const commandsSource=await readFile(new URL('../src/editor/commands.js',import.meta.url),'utf8');

assert.match(rendererSource,/rebuildNavigationIndex\(\)[\s\S]*editableTimesForMeasure\(measure\)[\s\S]*navigationLookup/s,'navigation should be indexed from document rhythmic times when grid structure changes');
assert.match(rendererSource,/navigateCursor\([\s\S]*navigationLookup\.get/s,'arrow navigation should use the cached rhythmic navigation index');
assert.doesNotMatch(rendererSource,/navigateCursor\([\s\S]*querySelectorAll\('\.v3-column-target/s,'arrow navigation must not rescan and sort every DOM column per key press');
assert.match(rendererSource,/const navigation = \{ measureId:[\s\S]*const next = this\.navigateCursor\(navigation\);[\s\S]*commit\(\);[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*this\.showCursor\(next\)/s,'arrow navigation should resolve its destination before commit replaces the current measure DOM');
assert.match(rendererSource,/event\.key === 'Delete' \|\| event\.key === 'Backspace'[\s\S]*input\.value = '';[\s\S]*commit\(\);[\s\S]*this\.hideCursor\(\)/s,'Delete and Backspace should commit note removal immediately');
assert.match(rendererSource,/this\.cursor = input;\s*input\.focus\(\{ preventScroll: true \}\);\s*input\.select\(\);/s,'cursor focus should be synchronous so repeated arrow keys are not lost between animation frames');

assert.doesNotMatch(rendererSource,/editorPlayback\?\.invalidate|updateProgressRange/,'renderer completion must not own playback invalidation or playback-index rebuilding');
assert.match(controllerSource,/changeSet\?\.document \|\| changeSet\?\.playback\?\.length[\s\S]*editorPlayback\?\.invalidate/s,'store ChangeSet playback scope should own playback invalidation');

assert.match(rendererSource,/buildAdaptiveSystemLayout\(sourceMeasures,[\s\S]*sourceSystemIndex,[\s\S]*availableWidth/s,'local layout changes must recalculate only the affected source-system measures');
const applyLayoutChangeSource=rendererSource.slice(rendererSource.indexOf('  applyLayoutChange(changeSet) {'),rendererSource.indexOf('  updateGridWidths(grid, segment) {'));
assert.doesNotMatch(applyLayoutChangeSource,/buildAdaptiveLayout\(/,'local layout changes must not rebuild the full adaptive document plan');
assert.match(rendererSource,/replaceAdaptiveSourcePlan\([\s\S]*logicalSystems\[sourceSystemIndex\] = sourceMeasures/s,'the renderer should replace only the affected source-system slice in its existing plan');
assert.match(applyLayoutChangeSource,/const segmentationChanged = !sameShape;/,'renderer completion must report whether adaptive visual segmentation actually changed');
assert.match(applyLayoutChangeSource,/const visualRowStart = nextPlan\.systems\.findIndex\([\s\S]*const visualRowCount = nextSegments\.length/s,'renderer must derive the affected visual-row range from its layout plan');
assert.doesNotMatch(applyLayoutChangeSource,/querySelectorAll\(':scope > \.tab-system'\)[\s\S]*dataset\.visualRow/s,'local layout replacement must not rescan every visual system to rewrite row metadata');

assert.match(notationSource,/this\.documentIndex = updateDocumentIndex\(this\.documentIndex, this\.document,[\s\S]*measures: changeSet\?\.measures[\s\S]*relations: changeSet\?\.relations/s,'notation should incrementally refresh its persistent document index');
assert.match(notationSource,/const systems = new Set\(\)[\s\S]*for \(const measureId of dirty\)[\s\S]*closest\?\.\('\.tab-system'\)[\s\S]*for \(const sourceRow of layoutRows\)/s,'partial notation redraw should collect only dirty measure and affected source-row systems');
assert.doesNotMatch(notationSource,/this\.document\.measures\.filter/,'notation partial rendering must not scan the full measure list');
assert.doesNotMatch(notationSource,/for \(const relation of this\.document\.relations/,'notation technique markers must use the per-measure relation index');
assert.match(relationSource,/render\(documentModel, systemElement, measureIds, documentIndex = null\)[\s\S]*documentIndex \|\| indexDocument\(documentModel\)/s,'relation rendering should reuse the notation pass index when provided');
assert.match(commandsSource,/measureMetricsChanged\([\s\S]*layoutFrom: layoutChanged \? measure\.id : null/s,'note commands should derive layout invalidation from actual measure complexity');

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
