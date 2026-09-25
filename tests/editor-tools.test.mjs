import assert from 'node:assert/strict';
import { applyCommand } from '../src/editor/commands.js';
import { createDocumentV3, noteDisplayValue } from '../src/editor/model.js';
import { buildPlaybackIndex } from '../src/editor/playback-index.js';
import { resolveTechniqueTarget } from '../src/editor/technique-rules.js';
import { TOOL_TARGET_KINDS, ToolSession, toolTargetKind } from '../src/editor/tool-session.js';
import { ToolRegistry } from '../src/editor/tools.js';

function idFactory() { let sequence = 0; return prefix => `${prefix}-tool-${++sequence}`; }
const definitions = new ToolRegistry();
assert.deepEqual(definitions.list().map(tool => tool.id), ['harmonic','strumUp','strumDown','arpeggioUp','arpeggioDown','arc','slide','triplet','triplet16','duration32']);
for (const id of ['triplet','triplet16','duration32']) {
  assert.equal(definitions.get(id).target, 'ColumnTarget');
  assert.equal(toolTargetKind(definitions.get(id)), TOOL_TARGET_KINDS.COLUMN);
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
assert.equal(resolveTechniqueTarget('slide',{fromNoteId:'n-good',toNoteId:'n-next'},documentModel).ok,true);

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
