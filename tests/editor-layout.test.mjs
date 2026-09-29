import assert from 'node:assert/strict';
import { createDocumentV3 } from '../src/editor/model.js';
import {
  buildAdaptiveLayout,
  buildAdaptiveSystemLayout,
  buildCompactScoreLayout,
  buildSystems,
  columnGeometryForMeasure,
  measureColumnSpacing,
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
  assert.deepEqual(buildAdaptiveLayout(documentModel,{availableWidth:650}).systems.map(system=>system.measures.length),[3,1],'natural-width layout should keep a one-measure final row instead of redistributing it');
  assert.deepEqual(buildAdaptiveLayout(documentModel,{availableWidth:400}).systems.map(system=>system.measures.length),[1,1,1,1]);
}

{
  const plain=measure('plain');
  const harmonic=measure('harmonic',{harmonic:true});
  const shortChord=measure('short-chord',{chordSymbol:'C'});
  const wideChord=measure('wide-chord',{chordSymbol:'F#m7add11'});
  const triplet=measure('triplet',{group:{type:'tuplet',ratio:[3,2],slots:[[0,1],[1,3],[2,3]],duration:[1,3]}});
  const doc=createDocumentV3({measures:[plain,harmonic,shortChord,wideChord,triplet]});
  assert.ok(measureComplexity(doc,harmonic)>measureComplexity(doc,plain),'score-view harmonic text must reserve local horizontal space');
  assert.equal(measureComplexity(doc,shortChord),measureComplexity(doc,plain),'chord symbols must not trigger elastic score layout');
  assert.equal(measureComplexity(doc,wideChord),measureComplexity(doc,plain),'long chord symbols must not widen the score layout');
  assert.equal(measureComplexity(doc,plain),measureComplexity(doc,triplet),'triplet bracket alone must not widen adaptive measure metrics');
}

{
  const repeated={
    id:'repeated-chord',timeSignature:{numerator:4,denominator:4},groups:[],events:[0,1,2].map((beat,index)=>({
      id:`repeat-e${index}`,at:[beat,1],duration:[1,4],marks:[],
      chord:{symbol:'C',voicingId:'c-v'},
      notes:[{id:`repeat-n${index}`,string:0,fret:'3',techniques:[]}]
    }))
  };
  const single=measure('single-chord',{chordSymbol:'C'});
  const doc=createDocumentV3({measures:[single,repeated]});
  assert.equal(measureComplexity(doc,repeated),measureComplexity(doc,single),'repeated chord labels must not create spacing pressure');
}

{
  const stressed=measure('stressed',{mark:'strum'});
  const plain=measure('plain');
  const doc=createDocumentV3({measures:[stressed,plain]});
  assert.ok(measureComplexity(doc,stressed)>measureComplexity(doc,plain),'left-side sweep notation needs local space');
  const spacing=measureColumnSpacing(doc,doc.measures[0]);
  assert.ok(spacing.entries[0].left>0,'strum spacing belongs to its source column');
  const layout=buildAdaptiveLayout(doc,{availableWidth:900});
  assert.ok(Math.abs(layout.systems[0].measureWidthsPx[0]-layout.systems[0].measureWidthsPx[1])<0.001,'available row slack should not be redistributed across whole measures');
  const stressedGeometry=columnGeometryForMeasure(doc,doc.measures[0],layout.systems[0].measureWidthsPx[0]);
  const plainGeometry=columnGeometryForMeasure(doc,doc.measures[1],layout.systems[0].measureWidthsPx[1]);
  assert.ok(stressedGeometry.percentForKey('0/1')>plainGeometry.percentForKey('0/1'),'only the affected column should shift to make room for left-side notation');
}

{
  const thirty=measure('thirty',{group:{type:'subdivision',subdivision:'thirty-second',slots:[[0,1],[1,8]],duration:[1,8]}});
  const digits=measure('digits',{doubleDigits:true});
  const plain=measure('plain');
  const doc=createDocumentV3({measures:[thirty,digits,plain]});
  assert.ok(measureComplexity(doc,thirty)>measureComplexity(doc,plain),'32nd subdivision needs local width');
  assert.ok(measureComplexity(doc,digits)>measureComplexity(doc,plain),'two-digit frets must trigger local spacing');
  const digitSpacing=measureColumnSpacing(doc,doc.measures[1]);
  assert.ok(digitSpacing.entries.some(entry=>entry.left>0&&entry.right>0),'two-digit fret spacing must be attached to its note columns');
}

{
  const slideMeasure={
    id:'slide-measure',timeSignature:{numerator:4,denominator:4},groups:[],events:[
      {id:'slide-e1',at:[0,1],duration:[1,4],marks:[],notes:[{id:'slide-n1',string:2,fret:'5',techniques:[]}]},
      {id:'slide-e2',at:[1,1],duration:[1,4],marks:[],notes:[{id:'slide-n2',string:2,fret:'7',techniques:[]}]}
    ]
  };
  const plainDoc=createDocumentV3({measures:[slideMeasure]});
  const slideDoc=createDocumentV3({
    measures:[slideMeasure],
    relations:[{id:'slide-r',type:'slide',fromNoteId:'slide-n1',toNoteId:'slide-n2'}]
  });
  assert.ok(measureComplexity(slideDoc,slideDoc.measures[0])>measureComplexity(plainDoc,plainDoc.measures[0]),'slide relations must trigger local elastic spacing');
  const spacing=measureColumnSpacing(slideDoc,slideDoc.measures[0]);
  assert.ok(spacing.entries.find(entry=>entry.key==='0/1')?.right>0,'slide spacing must be reserved on the source column right side');
}

{
  const documentModel=createDocumentV3({measures:['m1','m2','m3','m4'].map(id=>measure(id)),layout:{systemBreakAfter:['m2']}});
  assert.deepEqual(buildSystems(documentModel).map(system=>system.map(item=>item.id)),[['m1','m2','m3','m4']],'legacy early breaks must reflow forward into a full row');
  assert.deepEqual(buildAdaptiveLayout(documentModel,{availableWidth:1200}).systems.map(system=>system.measureIds),[['m1','m2','m3','m4']]);
  assert.ok(Math.abs(buildAdaptiveLayout(documentModel,{availableWidth:1200}).systems[0].widthPx-1200)<0.001,'full logical rows must fill the available score width');
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
  const documentModel=createDocumentV3({measures:Array.from({length:12},(_,index)=>measure(`m${index+1}`))});
  const wide=buildCompactScoreLayout(documentModel,{availableWidth:1800,minMeasureWidth:100});
  assert.deepEqual(wide.rows.map(row=>row.measureCount),[8,4],'compact score must never exceed eight measures per visual row');
  assert.equal(wide.rows[0].plainNotation,true,'plain score rows should use non-adaptive equal measure widths');
  const firstRowWidths=wide.rows[0].segments.flatMap(segment=>segment.measureWidthsPx);
  assert.ok(firstRowWidths.every(width=>Math.abs(width-firstRowWidths[0])<0.001),'plain compact measures should remain equal width');
  assert.ok(Math.abs(wide.rows[1].widthPx-wide.rows[0].widthPx)<0.001,'compact rows must stretch their final partial row to the same visual width');
  const narrow=buildCompactScoreLayout(documentModel,{availableWidth:460,minMeasureWidth:100});
  assert.ok(narrow.rows.length>=3);
  assert.ok(narrow.rows.every(row=>row.measureCount<=8));
}

{
  const thirty=measure('compact-thirty',{group:{type:'subdivision',subdivision:'thirty-second',slots:[[0,1],[1,8]],duration:[1,8]}});
  const digits=measure('compact-digits',{doubleDigits:true});
  const doc=createDocumentV3({measures:[measure('compact-plain-1'),digits,thirty,measure('compact-plain-2')]});
  const compact=buildCompactScoreLayout(doc,{availableWidth:1200,minMeasureWidth:100});
  assert.equal(compact.rows.length,1);
  assert.equal(compact.rows[0].plainNotation,false,'two-digit and 32nd columns are local spacing requirements even without chord labels');
  const widths=compact.rows[0].segments.flatMap(segment=>segment.measureWidthsPx);
  assert.ok(widths.every(width=>width>=compact.baseMeasureWidth),'local spacing must never make a compact measure narrower than its base slot');
}

console.log('editor layout tests passed');
