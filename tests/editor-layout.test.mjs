import assert from 'node:assert/strict';
import { createDocumentV3 } from '../src/editor/model.js';
import { buildAdaptiveLayout, buildCompactScoreLayout, buildSystems, measureComplexity } from '../src/editor/layout.js';

function measure(id, { dense = false } = {}) {
  const events = dense
    ? Array.from({ length: 8 }, (_, index) => ({
        id: `${id}-e${index}`,
        at: [index, 2],
        duration: [1, 2],
        marks: index === 0 ? [{ id: `${id}-mark`, type: 'strum', direction: 'up' }] : [],
        notes: [
          { id: `${id}-n${index}-1`, string: 0, fret: String(12 + index), techniques: index === 0 ? [{ id: `${id}-tech`, type: 'harmonic', touchFret: 24 }] : [] },
          { id: `${id}-n${index}-2`, string: 3, fret: '7', techniques: [] }
        ]
      }))
    : [{ id: `${id}-e0`, at: [0, 1], duration: [1, 1], marks: [], notes: [{ id: `${id}-n0`, string: 0, fret: '3', techniques: [] }] }];
  return { id, timeSignature: { numerator: 4, denominator: 4 }, events, groups: [] };
}

{
  const documentModel = createDocumentV3({ measures: ['m1', 'm2', 'm3', 'm4'].map(id => measure(id)) });
  const wide = buildAdaptiveLayout(documentModel, { availableWidth: 1200 });
  assert.equal(wide.systems.length, 1);
  assert.equal(wide.systems[0].measures.length, 4, 'wide simple score should keep four measures on one line');
  assert.ok(Math.abs(wide.systems[0].measureWidths.reduce((sum, value) => sum + value, 0) - 100) < 0.001);

  const medium = buildAdaptiveLayout(documentModel, { availableWidth: 650 });
  assert.deepEqual(medium.systems.map(system => system.measures.length), [3, 1], 'narrower score should split four measures into 3+1');

  const narrow = buildAdaptiveLayout(documentModel, { availableWidth: 400 });
  assert.deepEqual(narrow.systems.map(system => system.measures.length), [1, 1, 1, 1], 'very narrow score should fall back to one measure per line');
}

{
  const documentModel = createDocumentV3({ measures: [measure('dense', { dense: true }), measure('a'), measure('b'), measure('c')] });
  assert.ok(measureComplexity(documentModel, documentModel.measures[0]) > measureComplexity(documentModel, documentModel.measures[1]));

  const layout = buildAdaptiveLayout(documentModel, { availableWidth: 900 });
  assert.deepEqual(layout.systems.map(system => system.measures.length), [3, 1], 'dense notation should reserve enough width to reduce measures per line');
  assert.ok(layout.systems[0].measureWidths[0] > layout.systems[0].measureWidths[1], 'denser measure should receive more width inside a line');
}

{
  const documentModel = createDocumentV3({
    measures: ['m1', 'm2', 'm3', 'm4'].map(id => measure(id)),
    layout: { systemBreakAfter: ['m2'] }
  });
  assert.deepEqual(buildSystems(documentModel).map(system => system.map(item => item.id)), [['m1', 'm2'], ['m3', 'm4']]);
  const layout = buildAdaptiveLayout(documentModel, { availableWidth: 1200 });
  assert.deepEqual(layout.systems.map(system => system.measureIds), [['m1', 'm2'], ['m3', 'm4']], 'manual system boundaries must remain hard layout boundaries');
}

{
  const documentModel = createDocumentV3({
    measures: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'].map(id => measure(id)),
    layout: { systemBreakAfter: ['m4'] }
  });
  const wide = buildCompactScoreLayout(documentModel, { availableWidth: 1000, minMeasureWidth: 100 });
  assert.equal(wide.rows.length, 1, 'compact score layout should visually combine logical systems when width allows');
  assert.equal(wide.rows[0].measureCount, 8);
  assert.deepEqual(wide.rows[0].segments.map(segment => segment.sourceSystemIndex), [0, 1], 'combined score rows must retain source-system identity');

  const narrow = buildCompactScoreLayout(documentModel, { availableWidth: 460, minMeasureWidth: 100 });
  assert.ok(narrow.rows.length >= 2, 'compact score density must reflow instead of forcing a fixed 8-measure count');
  assert.ok(narrow.rows.every(row => row.measureCount <= 4), 'narrow compact rows must adapt to available width');
}

{
  const documentModel = createDocumentV3({
    measures: [
      measure('simple-1'),
      measure('simple-2'),
      measure('dense', { dense: true }),
      measure('simple-3'),
      measure('simple-4')
    ],
    layout: { systemBreakAfter: [] }
  });
  const layout = buildCompactScoreLayout(documentModel, { availableWidth: 560, minMeasureWidth: 90 });
  assert.ok(layout.rows.length >= 2, 'notation complexity must reduce compact row density before glyphs collide');
  assert.ok(layout.rows.some(row => row.measureCount < 5), 'compact mode must be complexity-aware rather than a fixed measure preset');
}

console.log('editor layout tests passed');
