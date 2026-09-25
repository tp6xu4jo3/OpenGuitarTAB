import assert from 'node:assert/strict';
import { applyCommand } from '../src/editor/commands.js';
import { createDocumentV3, fractionKey } from '../src/editor/model.js';
import { buildPlaybackIndex } from '../src/editor/playback-index.js';
import {
  applyThirtySecondAtToMeasure,
  applyTripletAtToMeasure,
  fractionalGridTimes,
  isTimeReplacedByFractionalGrid,
  thirtySecondFromStart,
  tripletFromStart
} from '../src/editor/rhythm-grid.js';

function ids() { let n=0; return prefix => `${prefix}-rhythm-${++n}`; }
const idFactory = ids();

assert.deepEqual(tripletFromStart([0,1],'eighth').slots, [[0,1],[1,3],[2,3]]);
assert.deepEqual(tripletFromStart([0,1],'eighth').duration,[1,3]);
assert.equal(tripletFromStart([0,1],'eighth').beamCount,1);
assert.deepEqual(tripletFromStart([0,1],'sixteenth').slots, [[0,1],[1,6],[1,3]]);
assert.deepEqual(tripletFromStart([0,1],'sixteenth').endExclusive,[1,2]);
assert.equal(tripletFromStart([0,1],'sixteenth').beamCount,2);
assert.deepEqual(thirtySecondFromStart([1,1]).slots, [[1,1],[9,8]]);
assert.deepEqual(thirtySecondFromStart([1,1]).endExclusive,[5,4]);

const empty = { id:'m-empty', timeSignature:{numerator:4,denominator:4}, events:[], groups:[] };
{
  const result = applyTripletAtToMeasure(empty,{startAt:[0,1],subdivision:'eighth'},idFactory);
  assert.equal(result.ok,true);
  assert.equal(result.measure.events.length,0,'empty triplet must not create dummy events');
  assert.equal(result.measure.groups[0].type,'tuplet');
  assert.equal(isTimeReplacedByFractionalGrid(result.measure,[1,4]),true,'regular grid inside triplet span must be replaced');
  assert.deepEqual(fractionalGridTimes(result.measure).map(item => fractionKey(item.at)),['0/1','1/3','2/3']);
}

{
  const result = applyThirtySecondAtToMeasure(empty,{startAt:[1,1]},idFactory);
  assert.equal(result.ok,true);
  assert.equal(result.measure.events.length,0,'32nd grid must not accumulate rhythm-only events');
  assert.equal(result.measure.groups[0].subdivision,'thirty-second');
  assert.deepEqual(fractionalGridTimes(result.measure).map(item => fractionKey(item.at)),['1/1','9/8']);
}

{
  let doc = createDocumentV3({ measures:[empty] });
  doc = applyCommand(doc,{type:'rhythm/32nd/apply',measureId:'m-empty',startAt:[1,1]},{idFactory}).document;
  doc = applyCommand(doc,{type:'note/set',measureId:'m-empty',at:[9,8],duration:[1,8],string:0,fret:'3'},{idFactory}).document;
  const playback = buildPlaybackIndex(doc);
  const event = playback.entries.flatMap(entry => entry.events).find(item => fractionKey(item.at)==='9/8');
  assert.ok(event,'32nd midpoint must be playable after filling it');
  assert.equal(event.offsetBeats,1/8,'32nd midpoint must retain its exact fractional timing inside the beat');
}

{
  const source={id:'m-map',timeSignature:{numerator:4,denominator:4},groups:[],events:[
    {id:'e1',at:[0,1],duration:[1,4],marks:[],notes:[{id:'n1',string:0,fret:'3'}]},
    {id:'e2',at:[1,2],duration:[1,4],marks:[],notes:[{id:'n2',string:0,fret:'5'}]}
  ]};
  const result=applyTripletAtToMeasure(source,{startAt:[0,1],subdivision:'eighth'},idFactory);
  assert.deepEqual(result.measure.events.map(event=>fractionKey(event.at)),['0/1','2/3'],'two existing notes map to triplet outer slots');
}

console.log('fractional rhythm grid tests passed');