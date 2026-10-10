import assert from 'node:assert/strict';
import { applyCommand } from '../src/editor/commands.js';
import { createDocumentV3, normalizeDocumentV3, noteDisplayValue, STRUM_VELOCITIES } from '../src/editor/model.js';
import { cleanSongForWrite } from '../api/index.js';
import { buildPlaybackIndex } from '../src/editor/playback-index.js';
import { resolveTechniqueTarget } from '../src/editor/technique-rules.js';
import { TOOL_TARGET_KINDS, ToolSession, toolTargetKind } from '../src/editor/tool-session.js';
import { ToolRegistry } from '../src/editor/tools.js';

function idFactory() { let sequence = 0; return prefix => `${prefix}-tool-${++sequence}`; }
const definitions = new ToolRegistry();
assert.deepEqual(definitions.list().map(tool => tool.id), ['harmonic','strumUp','strumDown','arpeggioUp','arpeggioDown','arc','arcDown','slide','triplet','triplet16','duration32']);
for (const id of ['triplet','triplet16','duration32']) {
  assert.equal(definitions.get(id).target, 'ColumnTarget');
  assert.equal(toolTargetKind(definitions.get(id)), TOOL_TARGET_KINDS.COLUMN);
}
for (const id of ['arc','arcDown']) {
  assert.equal(definitions.get(id).target, 'RangeTarget');
  assert.equal(toolTargetKind(definitions.get(id)), TOOL_TARGET_KINDS.RANGE);
}

{
  const session = new ToolSession();
  session.activate('harmonic', TOOL_TARGET_KINDS.NOTE);
  assert.equal(session.select({ noteId: 'n-1' }).status, 'complete');
  session.commitSuccess({ keepActive: true });
  assert.equal(session.snapshot().toolId, 'harmonic');
  session.commitSuccess();
  assert.equal(session.snapshot().state, 'idle');
}

const documentModel = createDocumentV3({ measures: [{
  id: 'm-tools', timeSignature:{numerator:4,denominator:4}, groups: [], events: [
    { id:'e-a', at:[0,1], duration:[1,4], marks:[], notes:[{id:'n-bad',string:0,fret:'1',techniques:[]},{id:'n-good',string:2,fret:'5',techniques:[]}] },
    { id:'e-b', at:[1,1], duration:[1,4], marks:[], notes:[{id:'n-next',string:2,fret:'7',techniques:[]}] }
  ]
}]});
assert.equal(resolveTechniqueTarget('harmonic',{noteId:'n-bad'},documentModel).ok,false);
assert.equal(resolveTechniqueTarget('harmonic',{noteId:'n-good'},documentModel).ok,true);
assert.equal(resolveTechniqueTarget('strumUp',{eventId:'e-a'},documentModel).ok,true);
assert.deepEqual(STRUM_VELOCITIES, { strong: 104, normal: 84, weak: 64 });
const strumCommand = definitions.createCommand('strumDown',{ eventId: 'e-a' });
assert.deepEqual(strumCommand.mark, { type:'strum', direction:'down', strength:'normal', velocity:84 });
const strongCommand = definitions.createCommand('strumUp',{ eventId: 'e-a' });
assert.deepEqual(strongCommand.mark, { type:'strum', direction:'up', strength:'normal', velocity:84 });
const strumAdded = applyCommand(documentModel, strumCommand, {idFactory:idFactory()}).document;
const addedMark = strumAdded.measures[0].events[0].marks[0];
assert.equal(addedMark.strength, 'normal');
assert.equal(addedMark.velocity, 84);
for (const [strength, velocity] of Object.entries(STRUM_VELOCITIES)) {
  const updated = applyCommand(strumAdded,
    {type:'mark/strength/set',markId:addedMark.id,strength}, {idFactory:idFactory()});
  const updatedMark = updated.document.measures[0].events[0].marks[0];
  assert.equal(updatedMark.id, addedMark.id, 'strength edits preserve the owned mark ID');
  assert.equal(updatedMark.direction, 'down');
  assert.equal(updatedMark.strength, strength);
  assert.equal(updatedMark.velocity, velocity);
  assert.ok(updated.changeSet.playback.length, 'a new velocity invalidates cached playback');
  const saved = cleanSongForWrite({id:'strum-test',name:'測試',playStyle:'chord',document:updated.document});
  const persisted = saved.document.measures[0].events[0].marks[0];
  assert.equal(persisted.strength, strength, 'strength must be in song.json event.marks');
  assert.equal(persisted.velocity, velocity, 'velocity must be in song.json event.marks');
  assert.equal(saved.document.measures[0].events[0].notes.length, 2);
}
const invalidStrength = applyCommand(strumAdded, {type:'mark/strength/set',markId:addedMark.id,strength:'extra'});
assert.equal(invalidStrength.document, strumAdded, 'invalid strength must leave the model unchanged');
const legacy = normalizeDocumentV3({
  ...documentModel, measures: documentModel.measures.map(measure => ({
    ...measure, events: measure.events.map(event => event.id === 'e-a' ? {
      ...event, marks: [{id:'legacy-strum',type:'strum',direction:'down'}]
    } : event)
  }))
});
assert.deepEqual(legacy.measures[0].events[0].marks[0],
  {id:'legacy-strum',type:'strum',direction:'down',strength:'normal',velocity:84},
  'legacy strum marks without strength gain a deterministic normal default');
const conflicting = normalizeDocumentV3({
  ...documentModel, measures: documentModel.measures.map(measure => ({
    ...measure, events: measure.events.map(event => event.id === 'e-a' ? {
      ...event, marks: [{id:'conflicting',type:'strum',direction:'up',strength:'weak',velocity:104}]
    } : event)
  }))
});
assert.equal(conflicting.measures[0].events[0].marks[0].velocity, 64,
  'strength remains authoritative if imported JSON has inconsistent velocity');
assert.equal(resolveTechniqueTarget('slide',{fromNoteId:'n-good',toNoteId:'n-next'},documentModel).ok,true);

{
  const range={measureId:'m-tools',startAt:[0,1],endAt:[1,2]};
  const upper=resolveTechniqueTarget('arc',range,documentModel);
  const lower=resolveTechniqueTarget('arcDown',range,documentModel);
  assert.equal(upper.ok,true,'upper arc may finish on an empty rhythmic column');
  assert.equal(lower.ok,true,'lower arc may finish on an empty rhythmic column');
  const upperCommand=definitions.createCommand('arc',upper.target);
  const lowerCommand=definitions.createCommand('arcDown',lower.target);
  assert.deepEqual(upperCommand.relation.toPosition,{measureId:'m-tools',at:[1,2]});
  assert.equal(upperCommand.relation.direction,'up');
  assert.equal(lowerCommand.relation.direction,'down');
  const applied=applyCommand(documentModel,upperCommand,{idFactory:idFactory()});
  assert.equal(applied.document.relations.length,1,'positional arc remains a normal relation owned by its source note');
  assert.deepEqual(applied.document.relations[0].toPosition,{measureId:'m-tools',at:[1,2]});
}

{
  const ids = idFactory();
  const result = applyCommand(documentModel, definitions.createCommand('harmonic',{noteId:'n-good'}), {idFactory:ids});
  const note = result.document.measures[0].events[0].notes.find(item => item.id === 'n-good');
  assert.equal(noteDisplayValue(note),'5','harmonic must not expand the inline tab number');
  assert.equal(note.techniques[0].touchFret,17);
  assert.equal(buildPlaybackIndex(result.document).entries[0].notes.find(item => item.id === 'n-good').fret,'17');
}

{
  const normal = definitions.createCommand('triplet',{measureId:'m',at:[0,1]});
  assert.deepEqual(normal,{type:'rhythm/triplet/apply',measureId:'m',startAt:[0,1],subdivision:'eighth'});
  const fast = definitions.createCommand('triplet16',{measureId:'m',at:[0,1]});
  assert.equal(fast.subdivision,'sixteenth');
  const thirtySecond = definitions.createCommand('duration32',{measureId:'m',at:[1,1]});
  assert.deepEqual(thirtySecond,{type:'rhythm/32nd/apply',measureId:'m',startAt:[1,1]});
}

console.log('editor tool tests passed');
