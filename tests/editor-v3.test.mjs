import assert from 'node:assert/strict';
import { EditorClipboard } from '../src/editor/clipboard.js';
import { applyCommand } from '../src/editor/commands.js';
import { buildSystems } from '../src/editor/layout.js';
import { createBlankDocumentV3, fractionToNumber } from '../src/editor/model.js';
import { ensureSongDocumentV3, migrateSongToDocumentV3 } from '../src/editor/migrate-v2.js';
import { EditorStateSync } from '../src/editor/state-sync.js';
import { ScoreStore, StoreRegistry } from '../src/editor/store.js';
import { deleteMeasureAt, deleteSystem, insertMeasureAt, insertSystem, moveMeasureAt, moveSystem } from '../src/editor/structure-commands.js';
import { ToolRegistry } from '../src/editor/tools.js';
import { deserializeSong, serializeSong } from '../src/core/song-codec.js';

function row(beats=4){return Array.from({length:6},()=>Array(4*beats*4).fill(''));}
function idFactory(){let sequence=0;return prefix=>`${prefix}-test-${++sequence}`;}
const legacyRow=row();
legacyRow[0][0]='5';legacyRow[1][0]='7';legacyRow[0][4]='8';legacyRow[2][16]='12';
const legacySong={id:'legacy-song',name:'Legacy',beatsPerMeasure:4,meter:'4/4',rows:[legacyRow],rowMeasureCounts:[2],rhythmRows:[{0:4,4:2,16:8}]};

const migrated=migrateSongToDocumentV3(legacySong);
assert.equal(migrated.version,3);
assert.equal(migrated.measures.length,2);
assert.equal(buildSystems(migrated)[0].length,2);
assert.equal(migrated.measures[0].events.length,2);
assert.deepEqual(migrated.measures[0].events[0].at,[0,1]);
assert.deepEqual(migrated.measures[0].events[0].duration,[1,1]);
assert.deepEqual(migrated.measures[0].events[1].at,[1,1]);
assert.deepEqual(migrated.measures[0].events[1].duration,[1,2]);
assert.equal(migrated.measures[0].events[0].notes.length,2);

{
  const legacy=structuredClone(legacySong);
  const documentModel=ensureSongDocumentV3(legacy);
  assert.equal(documentModel.version,3);
  assert.equal('rows' in legacy,false);
  assert.equal('rhythmRows' in legacy,false);
  assert.equal('rowMeasureCounts' in legacy,false);
}
{
  const blank=createBlankDocumentV3({beats:3,systems:4,measuresPerSystem:4,idFactory:idFactory()});
  assert.equal(blank.measures.length,16);
  assert.deepEqual(buildSystems(blank).map(system=>system.length),[4,4,4,4]);
}

let documentModel=migrated;
const firstMeasure=documentModel.measures[0];
const firstEvent=firstMeasure.events[0];
const firstNote=firstEvent.notes[0];
const secondNote=firstEvent.notes[1];
{
  const result=applyCommand(documentModel,{type:'note/technique/add',noteId:firstNote.id,technique:{type:'harmonic'}},{idFactory:idFactory()});
  documentModel=result.document;
  const harmonic=documentModel.measures[0].events[0].notes[0];
  assert.deepEqual(result.changeSet.measures,[firstMeasure.id]);
  assert.equal(harmonic.fret,'5');
  assert.equal(harmonic.techniques[0].touchFret,17,'harmonic pitch metadata remains separate from the visible fret');
}
{
  const result=applyCommand(documentModel,{type:'event/duration/set',eventId:firstEvent.id,duration:[1,8]});
  documentModel=result.document;
  assert.equal(fractionToNumber(documentModel.measures[0].events[0].duration),.125);
}
{
  const result=applyCommand(documentModel,{type:'group/add',measureId:firstMeasure.id,group:{type:'tuplet',ratio:[3,2],eventIds:documentModel.measures[0].events.slice(0,2).map(event=>event.id)}},{idFactory:idFactory()});
  documentModel=result.document;
  assert.equal(documentModel.measures[0].groups[0].type,'tuplet');
}
let slideId;
{
  const result=applyCommand(documentModel,{type:'relation/add',relation:{type:'slide',fromNoteId:firstNote.id,toNoteId:secondNote.id}},{idFactory:idFactory()});
  documentModel=result.document;slideId=documentModel.relations.at(-1).id;
  assert.equal(documentModel.relations.at(-1).type,'slide');
}
{
  const result=applyCommand(documentModel,{type:'note/delete',noteId:secondNote.id});
  documentModel=result.document;
  assert.equal(documentModel.relations.some(relation=>relation.id===slideId),false);
}
{
  const tools=new ToolRegistry();
  assert.equal(tools.get('harmonic').target,'note');
  const duration32=tools.createCommand('duration32',{measureId:firstMeasure.id,at:[0,1]});
  assert.deepEqual(duration32,{type:'rhythm/32nd/apply',measureId:firstMeasure.id,startAt:[0,1]});
  assert.equal(tools.createCommand('slide',{fromNoteId:'a',toNoteId:'b'}).relation.type,'slide');
}
{
  const clipboardDocument=migrateSongToDocumentV3(legacySong);
  const noteA=clipboardDocument.measures[0].events[0].notes[0];
  const noteB=clipboardDocument.measures[0].events[0].notes[1];
  const sourceMeasureId=clipboardDocument.measures[0].id;
  const sourceEventA=clipboardDocument.measures[0].events[0].id;
  const sourceEventB=clipboardDocument.measures[0].events[1].id;
  const ids=(()=>{let sequence=0;return prefix=>`${prefix}-source-${++sequence}`;})();
  let decorated=applyCommand(clipboardDocument,{type:'note/technique/add',noteId:noteA.id,technique:{type:'harmonic'}},{idFactory:ids}).document;
  decorated=applyCommand(decorated,{type:'event/mark/add',eventId:sourceEventA,mark:{type:'strum',direction:'up'}},{idFactory:ids}).document;
  decorated=applyCommand(decorated,{type:'event/mark/add',eventId:sourceEventB,mark:{type:'arpeggio',direction:'down'}},{idFactory:ids}).document;
  decorated=applyCommand(decorated,{type:'relation/add',relation:{type:'tie',fromNoteId:noteA.id,toNoteId:noteB.id}},{idFactory:ids}).document;
  decorated=applyCommand(decorated,{type:'relation/add',relation:{type:'arc',direction:'up',fromNoteId:noteA.id,fromPosition:{measureId:sourceMeasureId,at:[0,1]},toPosition:{measureId:sourceMeasureId,at:[1,1]}}},{idFactory:ids}).document;
  decorated=applyCommand(decorated,{type:'relation/add',relation:{type:'arc',direction:'down',fromNoteId:noteB.id,fromPosition:{measureId:sourceMeasureId,at:[0,1]},toPosition:{measureId:sourceMeasureId,at:[1,1]}}},{idFactory:ids}).document;
  decorated=applyCommand(decorated,{type:'relation/add',relation:{type:'slide',fromNoteId:noteA.id,toNoteId:noteB.id}},{idFactory:ids}).document;
  decorated=applyCommand(decorated,{type:'group/add',measureId:sourceMeasureId,group:{type:'tuplet',ratio:[3,2],subdivision:'eighth',slots:[[0,1],[1,3],[2,3]],duration:[1,3],eventIds:[sourceEventA,sourceEventB]}},{idFactory:ids}).document;
  decorated=applyCommand(decorated,{type:'group/add',measureId:sourceMeasureId,group:{type:'subdivision',subdivision:'thirty-second',slots:[[2,1],[17,8]],duration:[1,8],eventIds:[sourceEventB]}},{idFactory:ids}).document;
  const sourceTechniqueId=decorated.measures[0].events[0].notes[0].techniques[0].id;
  const sourceMarkIds=decorated.measures[0].events.flatMap(event=>event.marks||[]).map(mark=>mark.id);
  const sourceGroupIds=decorated.measures[0].groups.map(group=>group.id);
  const clipboard=new EditorClipboard();
  clipboard.copyMeasure(decorated,sourceMeasureId);
  const targetMeasureId=decorated.measures[1].id;
  const pasted=clipboard.pasteMeasure(decorated,targetMeasureId,{idFactory:(()=>{let sequence=0;return prefix=>`${prefix}-measure-paste-${++sequence}`;})()});
  assert.ok(pasted);
  assert.equal(pasted.changeSet.layoutKind,'grid','pasting rhythm topology must invalidate the editable grid');
  assert.equal(pasted.changeSet.layoutFrom,targetMeasureId);
  const target=pasted.document.measures[1];
  assert.notEqual(target.events[0].notes[0].techniques[0].id,sourceTechniqueId);
  assert.deepEqual(target.events.flatMap(event=>event.marks||[]).map(mark=>mark.type).sort(),['arpeggio','strum']);
  assert.equal(target.events.flatMap(event=>event.marks||[]).every(mark=>!sourceMarkIds.includes(mark.id)),true);
  assert.deepEqual(target.groups.map(group=>group.type).sort(),['subdivision','tuplet']);
  assert.equal(target.groups.every(group=>!sourceGroupIds.includes(group.id)),true);
  const targetEventIds=new Set(target.events.map(event=>String(event.id)));
  assert.equal(target.groups.flatMap(group=>group.eventIds||[]).every(id=>targetEventIds.has(String(id))),true,'rhythm group event references must follow cloned events');
  for(const direction of ['up','down']){
    const arc=pasted.document.relations.find(relation=>relation.type==='arc'&&relation.direction===direction&&relation.fromPosition?.measureId===target.id);
    assert.ok(arc,`${direction} positional arc must be copied into the pasted measure`);
    assert.equal(arc.toPosition.measureId,target.id);
    assert.notEqual(arc.fromPosition.measureId,sourceMeasureId);
  }
  assert.ok(pasted.document.relations.find(relation=>relation.type==='tie'&&!decorated.relations.some(source=>source.id===relation.id)));
  assert.ok(pasted.document.relations.find(relation=>relation.type==='slide'&&!decorated.relations.some(source=>source.id===relation.id)));

  const systemClipboard=new EditorClipboard();
  const sourceSystemIds=decorated.measures.map(measure=>measure.id);
  systemClipboard.copySystem(decorated,sourceSystemIds);
  const systemPasted=systemClipboard.pasteSystem(decorated,sourceSystemIds,{idFactory:(()=>{let sequence=0;return prefix=>`${prefix}-system-paste-${++sequence}`;})()});
  assert.ok(systemPasted);
  assert.deepEqual(systemPasted.document.measures.map(measure=>measure.id),sourceSystemIds,'row paste must preserve target measure identity');
  assert.equal(systemPasted.changeSet.layoutKind,'grid','row paste must rebuild navigation/playback topology');
  assert.equal(systemPasted.changeSet.layoutFrom,sourceSystemIds[0]);
  const pastedSystemMeasureId=systemPasted.document.measures[0].id;
  const systemArcs=systemPasted.document.relations.filter(relation=>relation.type==='arc');
  assert.equal(systemArcs.length,2);
  assert.equal(systemArcs.every(relation=>relation.fromPosition?.measureId===pastedSystemMeasureId&&relation.toPosition?.measureId===pastedSystemMeasureId),true,'system paste must remap every positional relation to target measure ids');

  const fourMeasureDocument=createBlankDocumentV3({systems:1,measuresPerSystem:4,idFactory:(()=>{let sequence=0;return prefix=>`${prefix}-shape-${++sequence}`;})()});
  const mismatched=systemClipboard.pasteSystem(fourMeasureDocument,fourMeasureDocument.measures.map(measure=>measure.id));
  assert.equal(mismatched,null,'row paste must reject a different measure count instead of silently repacking the document');
  assert.deepEqual(buildSystems(fourMeasureDocument).map(system=>system.length),[4]);
}
{
  const song=structuredClone(legacySong);
  const store=new ScoreStore(song);
  assert.equal(song.document.version,3);
  assert.equal('rows' in song,false);
  const measureId=store.getDocument().measures[0].id;
  const result=store.dispatch({type:'note/set',measureId,at:[2,1],string:3,fret:'9',duration:[1,4]},{idFactory:idFactory()});
  assert.deepEqual(result.changeSet.measures,[measureId]);
}

{
  const metadataOnly = {
    id: 'song-晴る',
    arrangementId: 'arr-df7982ca-6c5d-4007-a12c-0f94548dd081',
    name: '晴る',
    _driveFileId: '19_2iK2gOwcf2-L8Yk128T9VLS_09QQFz'
  };
  const registry = new StoreRegistry();
  const sync = new EditorStateSync(registry, { currentSong: () => metadataOnly });
  assert.equal(sync.ensureStore(), null, 'metadata-only library records must not mount an editor store before Drive hydration');
  assert.equal('document' in metadataOnly, false, 'opening an editor route must not synthesize a blank document onto library metadata');

  const hydrated = {
    ...metadataOnly,
    document: createBlankDocumentV3({ beats: 4, systems: 1, measuresPerSystem: 1, idFactory: idFactory() })
  };
  const hydratedSync = new EditorStateSync(registry, { currentSong: () => hydrated });
  assert.ok(hydratedSync.ensureStore(), 'a fully hydrated score may mount an editor store');
}
{
  const ids=idFactory();
  let structure=migrateSongToDocumentV3(legacySong);
  structure=insertSystem(structure,1,{measureCount:2,idFactory:ids}).document;
  assert.deepEqual(buildSystems(structure).map(system=>system.length),[4],'partial inserted rows should immediately pack into the current four-measure row');
  structure=insertMeasureAt(structure,0,1,{idFactory:ids}).document;
  assert.deepEqual(buildSystems(structure).map(system=>system.length),[4,1],'measure insertion should keep every non-final row full');
  const movedMeasureId=buildSystems(structure)[0][0].id;
  structure=moveMeasureAt(structure,0,0,1,1).document;
  assert.equal(buildSystems(structure)[1].some(measure=>measure.id===movedMeasureId),true);
  structure=moveSystem(structure,1,0).document;
  assert.equal(buildSystems(structure)[0].some(measure=>measure.id===movedMeasureId),true);
  structure=deleteMeasureAt(structure,0,0).document;
  structure=deleteSystem(structure,1).document;
  assert.equal(buildSystems(structure).length,1);
}
{
  const pureV3Song={id:'v3-only',name:'V3 only',document:migrated};
  const decoded=deserializeSong(serializeSong(pureV3Song));
  assert.equal(decoded.document.version,3);
  assert.equal(decoded.document.measures.length,2);
}
console.log('editor v3 tests passed');
