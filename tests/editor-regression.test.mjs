import assert from 'node:assert/strict';
import { serializeSong, deserializeSong } from '../src/core/song-codec.js';
import { applyCommand } from '../src/editor/commands.js';
import { buildSystems } from '../src/editor/layout.js';
import { createDocumentV3, fractionKey, indexDocument, noteDisplayValue } from '../src/editor/model.js';
import { buildPlaybackIndex } from '../src/editor/playback-index.js';
import { ScoreStore } from '../src/editor/store.js';
import { deleteMeasureAt, insertMeasureAt } from '../src/editor/structure-commands.js';
import { resolveTechniqueTarget } from '../src/editor/technique-rules.js';
import { ToolRegistry } from '../src/editor/tools.js';

function ids(){let sequence=0;return prefix=>`${prefix}-regression-${++sequence}`;}
const idFactory=ids();
const registry=new ToolRegistry();
let documentModel=createDocumentV3({measures:[
  {id:'m-regression-1',timeSignature:{numerator:4,denominator:4},groups:[],events:[
    {id:'e-chord',at:[0,1],duration:[1,4],marks:[],notes:[{id:'n-harmonic',string:0,fret:'5',techniques:[]},{id:'n-chord',string:3,fret:'5',techniques:[]}]},
    {id:'e-tie',at:[1,1],duration:[1,4],marks:[],notes:[{id:'n-tie',string:0,fret:'5',techniques:[]}]},
    {id:'e-slide',at:[2,1],duration:[1,4],marks:[],notes:[{id:'n-slide',string:0,fret:'7',techniques:[]}]}
  ]},
  {id:'m-regression-2',timeSignature:{numerator:4,denominator:4},events:[],groups:[]}
],relations:[],layout:{systemBreakAfter:['m-regression-1']}},{idFactory});
function dispatch(command){documentModel=applyCommand(documentModel,command,{idFactory}).document;}

dispatch(registry.createCommand('harmonic',{noteId:'n-harmonic'}));
dispatch(registry.createCommand('strumUp',{eventId:'e-chord'}));
const arc=resolveTechniqueTarget('arc',{fromNoteId:'n-harmonic',toNoteId:'n-tie'},documentModel);
assert.equal(arc.target.relationType,'tie');
dispatch(registry.createCommand('arc',arc.target));
const slide=resolveTechniqueTarget('slide',{fromNoteId:'n-tie',toNoteId:'n-slide'},documentModel);
assert.equal(slide.ok,true);
dispatch(registry.createCommand('slide',slide.target));
dispatch(registry.createCommand('triplet',{measureId:'m-regression-2',at:[0,1]}));
dispatch(registry.createCommand('duration32',{measureId:'m-regression-2',at:[1,1]}));
dispatch({type:'note/set',measureId:'m-regression-2',at:[9,8],duration:[1,8],string:0,fret:'3'});

{
  const index=indexDocument(documentModel);
  const harmonic=index.noteById.get('n-harmonic');
  assert.equal(noteDisplayValue(harmonic),'5');
  assert.equal(harmonic.techniques[0].touchFret,17);
  assert.equal(index.eventById.get('e-chord').marks[0].type,'strum');
  assert.deepEqual(documentModel.relations.map(relation=>relation.type).sort(),['slide','tie']);
  assert.deepEqual(documentModel.measures[1].groups.map(group=>group.type).sort(),['subdivision','tuplet']);
}

{
  const playback=buildPlaybackIndex(documentModel);
  const harmonicEntry=playback.entries.find(entry=>entry.eventId==='e-chord');
  assert.equal(harmonicEntry.notes.find(note=>note.id==='n-harmonic').fret,'17');
  assert.ok(playback.entries.flatMap(entry=>entry.events).some(event=>fractionKey(event.at)==='9/8'));
}

const song={id:'song-regression',name:'Regression',tempo:120,capo:0,document:documentModel};
const store=new ScoreStore(song);
store.prepareForPersistence({tempo:132,capo:2});
const reloadedSong=deserializeSong(serializeSong(song));
const reloaded=new ScoreStore(reloadedSong).getDocument();
{
  const index=indexDocument(reloaded);
  assert.equal(index.noteById.get('n-harmonic').fret,'5');
  assert.equal(noteDisplayValue(index.noteById.get('n-harmonic')),'5');
  assert.equal(index.noteById.get('n-harmonic').techniques[0].touchFret,17);
  assert.deepEqual(reloaded.relations.map(relation=>relation.type).sort(),['slide','tie']);
  assert.equal(reloadedSong.tempo,132);
  assert.equal(reloadedSong.capo,2);
}

{
  const inserted=insertMeasureAt(reloaded,1,1,{idFactory});
  assert.deepEqual(buildSystems(inserted.document).map(system=>system.length),[1,2]);
  const restored=deleteMeasureAt(inserted.document,1,1).document;
  assert.deepEqual(buildSystems(restored).map(system=>system.length),[1,1]);
  assert.deepEqual(restored.relations.map(relation=>relation.type).sort(),['slide','tie']);
}

console.log('editor integration regression tests passed');