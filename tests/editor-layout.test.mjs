import assert from 'node:assert/strict';
import { createDocumentV3 } from '../src/editor/model.js';
import {
  buildAdaptiveLayout,
  buildAdaptiveSystemLayout,
  buildCompactScoreLayout,
  buildSystems,
  measureComplexity
} from '../src/editor/layout.js';

function measure(id,{mark=null,harmonic=false,group=null,doubleDigits=false,chordSymbol=''}={}) {
  const events = doubleDigits ? [
    {id:`${id}-e1`,at:[0,1],duration:[1,4],marks:[],notes:[{id:`${id}-n1`,string:0,fret:'12',techniques:[]}]},
    {id:`${id}-e2`,at:[1,4],duration:[1,4],marks:[],notes:[{id:`${id}-n2`,string:1,fret:'14',techniques:[]}]}
  ] : [{
    id:`${id}-e`,
    at:[0,1],
    duration:[1,4],
    marks:mark?[{id:`${id}-mk`,type:mark,direction:'up'}]:[],
    notes:[{id:`${id}-n`,string:0,fret:harmonic?'12':'5',techniques:harmonic?[{id:`${id}-h`,type:'harmonic',touchFret:24}]:[]}],
    ...(chordSymbol ? { chord:{symbol:chordSymbol,voicingId:`${id}-v`} } : {})
  }];
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
  const shortChord=measure('short-chord',{chordSymbol:'C'});
  const wideChord=measure('wide-chord',{chordSymbol:'F#m7add11'});
  const triplet=measure('triplet',{group:{type:'tuplet',ratio:[3,2],slots:[[0,1],[1,3],[2,3]],duration:[1,3]}});
  const doc=createDocumentV3({measures:[plain,harmonic,shortChord,wideChord,triplet]});
  assert.ok(measureComplexity(doc,harmonic)>measureComplexity(doc,plain),'score-view <12> harmonic text must reserve horizontal space');
  assert.ok(measureComplexity(doc,shortChord)>measureComplexity(doc,plain),'a chord symbol must contribute notation width');
  assert.ok(measureComplexity(doc,wideChord)>measureComplexity(doc,shortChord),'longer chord symbols must reserve more width');
  assert.equal(measureComplexity(doc,plain),measureComplexity(doc,triplet),'triplet bracket alone must not widen adaptive measure metrics');
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
  const documentModel=createDocumentV3({
    measures:['m1','m2','m3','m4','m5','m6','m7','m8'].map(id=>measure(id)),
    layout:{systemBreakAfter:['m4']}
  });
  const full=buildAdaptiveLayout(documentModel,{availableWidth:650});
  const local=buildAdaptiveSystemLayout(full.logicalSystems[1],{sourceSystemIndex:1,availableWidth:650});
  const expected=full.systems.filter(system=>system.sourceSystemIndex===1);
  const shape=systems=>systems.map(system=>({
    sourceSystemIndex:system.sourceSystemIndex,
    sourceMeasureCount:system.sourceMeasureCount,
    startMeasure:system.startMeasure,
    measureIds:system.measureIds,
    measureWidths:system.measureWidths.map(width=>Number(width.toFixed(6)))
  }));
  assert.deepEqual(shape(local),shape(expected),'source-system layout must match the equivalent slice of a full adaptive layout');
  assert.ok(local.every(segment=>segment.sourceMeasureCount===4),'local segments carry logical-system size without rescanning the document');
}

{
  const documentModel=createDocumentV3({measures:['m1','m2','m3','m4','m5','m6','m7','m8'].map(id=>measure(id)),layout:{systemBreakAfter:['m4']}});
  const wide=buildCompactScoreLayout(documentModel,{availableWidth:1000,minMeasureWidth:100});
  assert.equal(wide.rows.length,1);
  assert.equal(wide.rows[0].measureCount,8);
  assert.ok(wide.rows[0].segments.every(segment=>segment.sourceMeasureCount===4));
  const narrow=buildCompactScoreLayout(documentModel,{availableWidth:460,minMeasureWidth:100});
  assert.ok(narrow.rows.length>=2);
}

console.log('editor layout tests passed');
