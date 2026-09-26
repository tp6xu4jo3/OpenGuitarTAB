import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyCommand } from '../src/editor/commands.js';
import { createDocumentV3 } from '../src/editor/model.js';

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

assert.match(notationSource,/const full = !changeSet \|\| changeSet\.document;/,'layoutFrom must not promote notation to a full-document redraw');
assert.match(notationSource,/const layoutRows = new Set\(\)[\s\S]*dataset\.sourceRow[\s\S]*layoutRows\.has\(sourceRow\)/s,'layout changes should redraw only visual systems belonging to the affected source system');
assert.match(notationSource,/const index = indexDocument\(this\.document\)[\s\S]*this\.renderSystem\(systemElement, measureIds, index\)/s,'notation should build one document index per render pass');
assert.match(relationSource,/render\(documentModel, systemElement, measureIds, documentIndex = null\)[\s\S]*documentIndex \|\| indexDocument\(documentModel\)/s,'relation rendering should reuse the notation pass index when provided');
assert.match(commandsSource,/measureMetricsChanged\([\s\S]*layoutFrom: layoutChanged \? measure\.id : null/s,'note commands should derive layout invalidation from actual measure complexity');

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
  assert.equal(harmonic.changeSet.layoutFrom,null,'edit-mode harmonic marker does not require immediate adaptive reflow');
  const strum=apply({type:'event/mark/add',eventId:'e-chord',mark:{type:'strum',direction:'up'}});
  assert.equal(strum.changeSet.layoutFrom,'m-technique');
  assert.equal(strum.changeSet.layoutKind,'metrics','left-side sweep needs metric recalculation');
  const relation=apply({type:'relation/add',relation:{type:'slide',fromNoteId:'n-a',toNoteId:'n-next'}});
  assert.equal(relation.changeSet.layoutFrom,null,'slide must not flex layout');
  assert.equal(relation.changeSet.layoutKind,null);
  const removed=apply({type:'relation/delete',relationId:relation.document.relations[0].id});
  assert.equal(removed.changeSet.layoutFrom,null);
}

{
  const ordinary=apply({type:'note/set',measureId:'m-technique',at:[1,4],duration:[1,4],string:1,fret:'12'});
  assert.equal(ordinary.changeSet.layoutFrom,null,'a multi-digit fret alone must not trigger layout when spacing complexity is unchanged');
  assert.equal(ordinary.changeSet.layoutKind,null);
  const closePair=apply({type:'note/set',measureId:'m-technique',at:[0,1],duration:[1,4],string:0,fret:'12'});
  assert.equal(closePair.changeSet.layoutFrom,'m-technique','creating a close pair of multi-digit fret events should recalc layout metrics');
  assert.equal(closePair.changeSet.layoutKind,'metrics');
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
