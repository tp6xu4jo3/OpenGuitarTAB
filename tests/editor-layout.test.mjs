import assert from 'node:assert/strict';
import { createDocumentV3 } from '../src/editor/model.js';
import { buildAdaptiveLayout, buildCompactScoreLayout, buildSystems, measureComplexity } from '../src/editor/layout.js';

function measure(id,{mark=null,harmonic=false,group=null,doubleDigits=false}={}) {
  const events = doubleDigits ? [
    {id:`${id}-e1`,at:[0,1],duration:[1,4],marks:[],notes:[{id:`${id}-n1`,string:0,fret:'12',techniques:[]}]},
    {id:`${id}-e2`,at:[1,4],duration:[1,4],marks:[],notes:[{id:`${id}-n2`,string:1,fret:'14',techniques:[]}]}
  ] : [{id:`${id}-e`,at:[0,1],duration:[1,4],marks:mark?[{id:`${id}-mk`,type:mark,direction:'up'}]:[],notes:[{id:`${id}-n`,string:0,fret:'5',techniques:harmonic?[{id:`${id}-h`,type:'harmonic',touchFret:17}]:[]}]}];
  return {id,timeSignature:{numerator:4,denominator:4},events,groups:group?[{id:`${id}-g`,...group}]:[]};
}

{
  const documentModel=createDocumentV3({measures:['m1','m2','m3','m4'].map(id=>measure(id))});
  const wide=buildAdaptiveLayout(documentModel,{availableWidth:1200});
  assert.deepEqual(wide.systems.map(system=>system.measures.length),[4]);
  assert.ok(wide.systems[0].measureWidths.every(width=>Math.abs(width-25)<0.001),'ordinary measures remain equal width');
  assert.deepEqual(buildAdaptiveLayout(documentModel,{availableWidth:650}).systems.map(system=>system.measures.length),[2,2]);
  assert.deepEqual(buildAdaptiveLayout(documentModel,{availableWidth:400}).systems.map(system=>system.measures.length),[1,1,1,1]);
}

{
  const plain=measure('plain');
  const harmonic=measure('harmonic',{harmonic:true});
  const triplet=measure('triplet',{group:{type:'tuplet',ratio:[3,2],slots:[[0,1],[1,3],[2,3]],duration:[1,3]}});
  const doc=createDocumentV3({measures:[plain,harmonic,triplet]});
  assert.equal(measureComplexity(doc,plain),measureComplexity(doc,harmonic),'harmonic must not widen layout');
  assert.equal(measureComplexity(doc,plain),measureComplexity(doc,triplet),'triplet must not widen layout');
}

{
  const stressed=measure('stressed',{mark:'strum'});
  const plain=measure('plain');
  const doc=createDocumentV3({measures:[stressed,plain]});
  assert.ok(measureComplexity(doc,stressed)>measureComplexity(doc,plain),'left-side sweep notation needs more width');
  const layout=buildAdaptiveLayout(doc,{availableWidth:900});
  assert.ok(layout.systems[0].measureWidths[0]>layout.systems[0].measureWidths[1]);
}

{
  const thirty=measure('thirty',{group:{type:'subdivision',subdivision:'thirty-second',slots:[[0,1],[1,8]],duration:[1,8]}});
  const digits=measure('digits',{doubleDigits:true});
  const plain=measure('plain');
  const doc=createDocumentV3({measures:[thirty,digits,plain]});
  assert.ok(measureComplexity(doc,thirty)>measureComplexity(doc,plain),'32nd subdivision needs more width');
  assert.ok(measureComplexity(doc,digits)>measureComplexity(doc,plain),'adjacent two-digit frets need more width');
}

{
  const documentModel=createDocumentV3({measures:['m1','m2','m3','m4'].map(id=>measure(id)),layout:{systemBreakAfter:['m2']}});
  assert.deepEqual(buildSystems(documentModel).map(system=>system.map(item=>item.id)),[['m1','m2'],['m3','m4']]);
  assert.deepEqual(buildAdaptiveLayout(documentModel,{availableWidth:1200}).systems.map(system=>system.measureIds),[['m1','m2'],['m3','m4']]);
}

{
  const documentModel=createDocumentV3({measures:['m1','m2','m3','m4','m5','m6','m7','m8'].map(id=>measure(id)),layout:{systemBreakAfter:['m4']}});
  const wide=buildCompactScoreLayout(documentModel,{availableWidth:1000,minMeasureWidth:100});
  assert.equal(wide.rows.length,1);
  assert.equal(wide.rows[0].measureCount,8);
  const narrow=buildCompactScoreLayout(documentModel,{availableWidth:460,minMeasureWidth:100});
  assert.ok(narrow.rows.length>=2);
}

console.log('editor layout tests passed');
