import assert from 'node:assert/strict';
import { applyCommand } from '../src/editor/commands.js';
import { createDocumentV3 } from '../src/editor/model.js';

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
  assert.equal(harmonic.changeSet.layoutFrom,null,'harmonic symbol below staff must not flex layout');
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
  const note=apply({type:'note/set',measureId:'m-technique',at:[1,4],duration:[1,4],string:1,fret:'12'});
  assert.equal(note.changeSet.layoutFrom,'m-technique','note edits recalc metrics because adjacent double digits may need room');
  assert.equal(note.changeSet.layoutKind,'metrics');
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
