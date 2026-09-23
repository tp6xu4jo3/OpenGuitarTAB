import assert from 'node:assert/strict';
import {
  fractionalPercentForGrid,
  legacyPositionPercentForGrid,
  measureBoundaryPercentForGrid,
  measureWidthsForGrid
} from '../src/editor/grid-geometry.js';
import { focusRelativeInput, handleGridNavigationKeydown } from '../src/editor/grid-navigation.js';
import { createDocumentV3 } from '../src/editor/model.js';
import {
  LEGACY_SLOTS_PER_BEAT,
  legacyRowPositionCount,
  projectDocumentToLegacySong,
  rhythmRowFromLegacyRow
} from '../src/editor/legacy-grid-compat.js';

{
  const grid = {
    dataset: {
      measureCount: '2',
      measureStart: '0',
      measureWidths: '40,60',
      positionCount: '32'
    }
  };
  assert.deepEqual(measureWidthsForGrid(grid), [40, 60]);
  assert.equal(measureBoundaryPercentForGrid(grid, 1), 40);
  assert.equal(legacyPositionPercentForGrid(grid, 0, { beatsPerMeasure: 4, slotsPerBeat: 4 }), 2.5);
  assert.equal(
    fractionalPercentForGrid(
      grid,
      0,
      [0, 1],
      [1, 8],
      { timeSignature: { numerator: 4, denominator: 4 } }
    ),
    1.25
  );
}

{
  const song = { id: 'projection', rows: [], rhythmRows: [], rowMeasureCounts: [] };
  const documentModel = createDocumentV3({
    measures: [{
      id: 'm-projection',
      timeSignature: { numerator: 4, denominator: 4 },
      events: [{
        id: 'e-projection',
        at: [0, 1],
        duration: [1, 4],
        notes: [{ id: 'n-projection', string: 0, fret: '3', techniques: [] }],
        marks: []
      }],
      groups: []
    }]
  });
  const result = projectDocumentToLegacySong(song, documentModel, { touch: false });
  assert.equal(result.ok, true);
  assert.equal(song.rows[0][0][0], '3');
  assert.deepEqual(song.rowMeasureCounts, [1]);
}

{
  const song = { beatsPerMeasure: 4, rows: [Array.from({ length: 6 }, () => Array(16).fill(''))] };
  assert.equal(LEGACY_SLOTS_PER_BEAT, 4);
  assert.equal(legacyRowPositionCount(song, null, 0), 64, 'legacy fallback remains isolated and explicit');

  const row = Array.from({ length: 6 }, () => Array(16).fill(''));
  row[0][0] = '3';
  row[1][2] = '5';
  assert.deepEqual(rhythmRowFromLegacyRow(row, 4), { 0: 2, 2: 14 });
}

function fakeInput({ string, measureId, at }) {
  return {
    dataset: { string: String(string), measureId, at },
    focused: false,
    selected: false,
    focus() { this.focused = true; },
    select() { this.selected = true; },
    closest(selector) { return selector === '.note-input' ? this : null; }
  };
}

{
  const inputs = [
    fakeInput({ string: 0, measureId: 'm-1', at: '0/1' }),
    fakeInput({ string: 0, measureId: 'm-1', at: '1/8' }),
    fakeInput({ string: 0, measureId: 'm-1', at: '1/4' }),
    fakeInput({ string: 1, measureId: 'm-1', at: '1/8' }),
    fakeInput({ string: 0, measureId: 'm-2', at: '0/1' })
  ];
  const root = {
    querySelectorAll(selector) {
      const match = selector.match(/data-string="(\d+)"/);
      return match ? inputs.filter(input => input.dataset.string === match[1]) : inputs;
    }
  };
  const documentModel = { measures: [{ id: 'm-1' }, { id: 'm-2' }] };

  assert.equal(focusRelativeInput(inputs[1], { documentModel, root, timeDelta: 1 }), true);
  assert.equal(inputs[2].focused, true, 'Right arrow order must include fractional positions');

  assert.equal(focusRelativeInput(inputs[1], { documentModel, root, stringDelta: 1 }), true);
  assert.equal(inputs[3].focused, true, 'vertical navigation must keep the same fractional time');

  let prevented = false;
  const enterEvent = {
    key: 'Enter',
    ctrlKey: false,
    metaKey: false,
    target: inputs[1],
    preventDefault() { prevented = true; }
  };
  assert.equal(handleGridNavigationKeydown(enterEvent, { documentModel, root }), true);
  assert.equal(prevented, true);
  assert.equal(inputs[0].focused, false, 'Enter must not move to another score position');
}

console.log('editor structure cleanup tests passed');
