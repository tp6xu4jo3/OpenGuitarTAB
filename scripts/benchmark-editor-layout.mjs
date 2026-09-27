import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createDocumentV3, indexDocument, updateDocumentIndex } from '../src/editor/model.js';
import { buildAdaptiveLayout, buildAdaptiveSystemLayout } from '../src/editor/layout.js';

const MEASURE_COUNT = 1600;
const AVAILABLE_WIDTH = 900;

function makeMeasure(index) {
  const harmonic = index % 11 === 0;
  const chord = index % 7 === 0 ? (index % 14 === 0 ? 'F#m7add11' : 'Cmaj7') : '';
  const fret = index % 5 === 0 ? '12' : String(index % 10);
  return {
    id: `m-${index}`,
    timeSignature: { numerator: 4, denominator: 4 },
    groups: index % 13 === 0 ? [{ id: `g-${index}`, type: 'subdivision', subdivision: 'thirty-second', slots: [[0,1],[1,8]], duration: [1,8] }] : [],
    events: [{
      id: `e-${index}`,
      at: [0,1],
      duration: [1,4],
      marks: index % 17 === 0 ? [{ id: `mk-${index}`, type: 'strum', direction: 'down' }] : [],
      notes: [{
        id: `n-${index}`,
        string: index % 6,
        fret,
        techniques: harmonic ? [{ id: `h-${index}`, type: 'harmonic', touchFret: Number(fret) + 12 }] : []
      }],
      ...(chord ? { chord: { symbol: chord, voicingId: `v-${index}` } } : {})
    }]
  };
}

const measures = Array.from({ length: MEASURE_COUNT }, (_, index) => makeMeasure(index));
const relations = [];
for (let index = 0; index + 1 < MEASURE_COUNT; index += 3) {
  relations.push({ id: `slide-${index}`, type: 'slide', fromNoteId: `n-${index}`, toNoteId: `n-${index + 1}` });
}
const documentModel = createDocumentV3({ measures, relations });
const documentIndex = indexDocument(documentModel);
const fullReference = buildAdaptiveLayout(documentModel, { availableWidth: AVAILABLE_WIDTH, documentIndex });
const sourceSystemIndex = Math.floor(fullReference.logicalSystems.length / 2);
const sourceMeasures = fullReference.logicalSystems[sourceSystemIndex];
const expected = fullReference.systems
  .filter(segment => segment.sourceSystemIndex === sourceSystemIndex)
  .map(segment => segment.measureIds.join(','));
const localReference = buildAdaptiveSystemLayout(sourceMeasures, {
  sourceSystemIndex,
  availableWidth: AVAILABLE_WIDTH,
  documentModel,
  documentIndex
});
assert.deepEqual(localReference.map(segment => segment.measureIds.join(',')), expected, 'local benchmark path must produce the same affected-system segmentation as the full layout');

function averageMs(callback, iterations) {
  for (let index = 0; index < Math.min(10, iterations); index++) callback();
  const started = performance.now();
  for (let index = 0; index < iterations; index++) callback();
  return (performance.now() - started) / iterations;
}

const fullMs = averageMs(() => buildAdaptiveLayout(documentModel, { availableWidth: AVAILABLE_WIDTH, documentIndex }), 30);
const localMs = averageMs(() => buildAdaptiveSystemLayout(sourceMeasures, {
  sourceSystemIndex,
  availableWidth: AVAILABLE_WIDTH,
  documentModel,
  documentIndex
}), 1500);
const ratio = fullMs > 0 ? localMs / fullMs : 0;

assert.ok(localMs < fullMs * 0.35, `local source-system layout should remain substantially cheaper than a ${MEASURE_COUNT}-measure relation-heavy full pass (full=${fullMs.toFixed(4)}ms local=${localMs.toFixed(4)}ms)`);

const changedMeasureIndex = documentModel.measures.findIndex(measure => measure.id === sourceMeasures[0]?.id);
const previousMeasure = documentModel.measures[changedMeasureIndex];
const changedMeasure = {
  ...previousMeasure,
  events: previousMeasure.events.map((event, eventIndex) => eventIndex === 0
    ? { ...event, notes: event.notes.map((note, noteIndex) => noteIndex === 0 ? { ...note, fret: note.fret === '12' ? '11' : '12' } : note) }
    : event)
};
const updatedMeasures = documentModel.measures.slice();
updatedMeasures[changedMeasureIndex] = changedMeasure;
const updatedDocument = { ...documentModel, measures: updatedMeasures };
const incrementalIndex = indexDocument(documentModel);
updateDocumentIndex(incrementalIndex, updatedDocument, { measures: [changedMeasure.id] });
assert.equal(incrementalIndex.noteById.get(changedMeasure.events[0].notes[0].id)?.fret, changedMeasure.events[0].notes[0].fret, 'incremental index benchmark must reflect the changed measure');

const fullIndexMs = averageMs(() => indexDocument(updatedDocument), 30);
const localIndexMs = averageMs(() => updateDocumentIndex(incrementalIndex, updatedDocument, { measures: [changedMeasure.id] }), 1500);
const indexRatio = fullIndexMs > 0 ? localIndexMs / fullIndexMs : 0;
assert.ok(localIndexMs < fullIndexMs * 0.35, `single-measure index refresh should remain substantially cheaper than rebuilding a ${MEASURE_COUNT}-measure relation-heavy index (full=${fullIndexMs.toFixed(4)}ms local=${localIndexMs.toFixed(4)}ms)`);

console.log(JSON.stringify({
  benchmark: 'editor-adaptive-layout',
  measures: MEASURE_COUNT,
  relations: relations.length,
  sourceMeasures: sourceMeasures.length,
  fullAverageMs: Number(fullMs.toFixed(4)),
  localAverageMs: Number(localMs.toFixed(4)),
  localToFullRatio: Number(ratio.toFixed(4)),
  fullIndexAverageMs: Number(fullIndexMs.toFixed(4)),
  localIndexAverageMs: Number(localIndexMs.toFixed(4)),
  localIndexToFullRatio: Number(indexRatio.toFixed(4))
}));
