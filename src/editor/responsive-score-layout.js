import { isScoreViewActive } from './view-state.js';

const COMPACT_QUERY = '(max-width: 980px)';
const SCORE_LAYOUT_KEY = 'openguitartab:score-measures-per-line:v2';
const SCORE_LAYOUT_VALUES = [8, 4];

let installed = false;

function currentSongSafe() {
  return typeof window.currentSong === 'function' ? window.currentSong() : null;
}

function currentBeats() {
  return Number(currentSongSafe()?.beatsPerMeasure) === 3 ? 3 : 4;
}

function makeDiv(className) {
  const node = document.createElement('div');
  node.className = className;
  return node;
}

function hydrateGrid(grid, rowValues) {
  grid.querySelectorAll('.note-input').forEach(input => {
    const string = Number(input.dataset.string);
    const position = Number(input.dataset.position);
    const value = String(rowValues?.[string]?.[position] ?? '');
    input.value = value;
    input.classList.toggle('has-value', value.length > 0);
    input.dataset.noteLength = value.length ? String(Math.min(2, value.length)) : '0';
  });
}

function installAdaptiveMeasureLayout() {
  const compactQuery = window.matchMedia(COMPACT_QUERY);
  const baseRenderRows = window.renderRows;
  const baseCreateTabSystem = window.createTabSystem;

  function segmentWindows(rowIndex) {
    const total = window.rowMeasureCount(rowIndex);
    const windows = [];
    for (let start = 0; start < total; start += 2) {
      windows.push({ startMeasure: start, measureCount: Math.min(2, total - start) });
    }
    return windows.length ? windows : [{ startMeasure: 0, measureCount: 1 }];
  }

  function rebuildBeatGuides(grid, measureCount) {
    grid.querySelectorAll('.beat-guide').forEach(line => line.remove());
    const beats = currentBeats();
    const totalBeats = measureCount * beats;
    for (let guide = 1; guide < totalBeats; guide++) {
      if (guide % beats === 0) continue;
      const line = makeDiv('beat-guide');
      line.style.setProperty('--guide-percent', `${(guide / totalBeats) * 100}%`);
      grid.appendChild(line);
    }
  }

  function trimGridToSegment(grid, rowIndex, startMeasure, measureCount) {
    const measureSlots = currentBeats() * 4;
    const measureSteps = currentBeats() * 2;
    const startPosition = startMeasure * measureSlots;
    const positionCount = measureCount * measureSlots;
    const endPosition = startPosition + positionCount;
    const startStep = startMeasure * measureSteps;
    const visibleSteps = measureCount * measureSteps;

    grid.dataset.measureStart = String(startMeasure);
    grid.dataset.measureCount = String(measureCount);
    grid.dataset.positionStart = String(startPosition);
    grid.dataset.positionCount = String(positionCount);
    grid.dataset.responsiveSplit = 'true';
    grid.style.setProperty('--steps', String(visibleSteps));
    grid.style.width = measureCount === 1 ? '50%' : '100%';

    grid.querySelectorAll('.cell').forEach(cell => {
      const input = cell.querySelector('.note-input');
      if (!input) return;
      const position = Number(input.dataset.position);
      if (position < startPosition || position >= endPosition) {
        cell.remove();
        return;
      }
      const originalStep = Number(input.dataset.step);
      if (Number.isFinite(originalStep)) cell.style.gridColumn = String(originalStep - startStep + 1);
    });

    grid.querySelectorAll('.small-cell').forEach(cell => {
      const input = cell.querySelector('.note-input');
      if (!input) return;
      const position = Number(input.dataset.position);
      if (position < startPosition || position >= endPosition) {
        cell.remove();
        return;
      }
      const localPosition = position - startPosition;
      const localStep = Math.floor(localPosition / 2);
      cell.style.left = `${((localStep + 1) / visibleSteps) * 100}%`;
    });

    grid.querySelectorAll('.measure-line').forEach(line => {
      const index = Number(line.style.getPropertyValue('--measure-index'));
      if (!Number.isFinite(index) || index < startMeasure || index > startMeasure + measureCount) {
        line.remove();
        return;
      }
      const localIndex = index - startMeasure;
      line.style.left = `${(localIndex / measureCount) * 100}%`;
      line.classList.toggle('first', localIndex === 0);
      line.classList.toggle('last', localIndex === measureCount);
    });

    grid.querySelectorAll('.measure-module-hitbox').forEach(hitbox => {
      const measureIndex = Number(hitbox.dataset.measure);
      if (measureIndex < startMeasure || measureIndex >= startMeasure + measureCount) {
        hitbox.remove();
        return;
      }
      const localIndex = measureIndex - startMeasure;
      hitbox.style.left = `${(localIndex / measureCount) * 100}%`;
      hitbox.style.width = `${100 / measureCount}%`;
    });

    rebuildBeatGuides(grid, measureCount);
  }

  function makeExtraGrid(rowIndex, rowCount, rowValues, segment, scoreTemplate = null) {
    const grid = scoreTemplate && isScoreViewActive()
      ? scoreTemplate.cloneNode(true)
      : baseCreateTabSystem(rowIndex, rowCount).querySelector('.tab-grid');
    if (!grid) return null;
    trimGridToSegment(grid, rowIndex, segment.startMeasure, segment.measureCount);
    hydrateGrid(grid, rowValues);
    return grid;
  }

  function splitExistingGrid(grid, rowIndex, rowCount, rowValues) {
    const windows = segmentWindows(rowIndex);
    const scoreTemplate = isScoreViewActive() && windows.length > 1 ? grid.cloneNode(true) : null;
    trimGridToSegment(grid, rowIndex, windows[0].startMeasure, windows[0].measureCount);
    hydrateGrid(grid, rowValues);
    if (windows.length === 1) return;

    const stack = makeDiv('responsive-measure-stack');
    grid.replaceWith(stack);
    stack.appendChild(grid);
    windows.slice(1).forEach(segment => {
      const extraGrid = makeExtraGrid(rowIndex, rowCount, rowValues, segment, scoreTemplate);
      if (extraGrid) stack.appendChild(extraGrid);
    });
  }

  window.renderRows = function renderRowsResponsive(rows) {
    baseRenderRows(rows);
    if (!compactQuery.matches) return;

    const song = currentSongSafe();
    const normalized = typeof window.normalizeRows === 'function'
      ? window.normalizeRows(rows, currentBeats())
      : rows;
    const rowCount = normalized.length;
    const seenRows = new Set();
    const tabArea = document.getElementById('tabArea');

    tabArea?.querySelectorAll('.tab-grid[data-row]').forEach(grid => {
      const rowIndex = Number(grid.dataset.row);
      if (!Number.isInteger(rowIndex) || seenRows.has(rowIndex)) return;
      seenRows.add(rowIndex);
      splitExistingGrid(grid, rowIndex, rowCount, normalized[rowIndex]);
    });

    normalized.forEach((_, rowIndex) => window.renderRhythmNotation?.(rowIndex));
    window.scheduleDensityFitAll?.(true);
    if (song) window.editorPlayback?.invalidate?.();
  };

  compactQuery.addEventListener('change', () => {
    const editorView = document.getElementById('editorView');
    if (editorView?.hidden) return;
    const song = currentSongSafe();
    if (song?.rows) window.renderRows(song.rows);
  });
}

function installScoreLayout() {
  const compactQuery = window.matchMedia(COMPACT_QUERY);
  const baseRenderRows = window.renderRows;
  const baseSetScoreViewEnabled = window.setScoreViewEnabled;
  let scoreMeasuresPerLine = Number(localStorage.getItem(SCORE_LAYOUT_KEY));
  if (!SCORE_LAYOUT_VALUES.includes(scoreMeasuresPerLine)) scoreMeasuresPerLine = 8;

  function prepareWholeRowGrid(grid, rowIndex) {
    const measureCount = window.rowMeasureCount(rowIndex);
    grid.dataset.measureStart = '0';
    grid.dataset.measureCount = String(measureCount);
    grid.dataset.positionStart = '0';
    grid.dataset.positionCount = String(measureCount * currentBeats() * 4);
    grid.dataset.scoreSegment = 'true';
    grid.style.width = '100%';
    grid.style.minWidth = '0';
    grid.style.maxWidth = '100%';
    return grid;
  }

  function makeScoreGrid(rowIndex, rowCount, rowValues) {
    const grid = window.createTabSystem(rowIndex, rowCount).querySelector('.tab-grid');
    if (!grid) return null;
    prepareWholeRowGrid(grid, rowIndex);
    hydrateGrid(grid, rowValues);
    return grid;
  }

  function appendScoreSystem(grids, key, measuresPerLine) {
    const system = makeDiv('tab-system score-system score-layout-system');
    system.dataset.centerKey = key;
    const pair = makeDiv('score-grid-pair');
    pair.dataset.measuresPerLine = String(measuresPerLine);
    grids.filter(Boolean).forEach(grid => pair.appendChild(grid));
    system.appendChild(pair);
    document.getElementById('tabArea')?.appendChild(system);
  }

  function renderScoreRows(rows) {
    window.editorPlayback?.stop?.(false, true);
    const normalized = typeof window.normalizeRows === 'function'
      ? window.normalizeRows(rows, currentBeats())
      : rows;
    const tabArea = document.getElementById('tabArea');
    if (!tabArea) return;
    tabArea.replaceChildren();

    const rowCount = normalized.length;
    if (scoreMeasuresPerLine === 8) {
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 2) {
        const grids = [rowIndex, rowIndex + 1]
          .filter(index => index < rowCount)
          .map(index => makeScoreGrid(index, rowCount, normalized[index]));
        appendScoreSystem(grids, `score-8-${Math.floor(rowIndex / 2)}`, 8);
      }
    } else {
      normalized.forEach((row, rowIndex) => {
        appendScoreSystem([makeScoreGrid(rowIndex, rowCount, row)], `score-4-${rowIndex}`, 4);
      });
    }

    normalized.forEach((_, rowIndex) => window.renderRhythmNotation?.(rowIndex));
    window.updateRemoveRowButton?.();
    window.editorPlayback?.invalidate?.();
    window.updateProgressRange?.();
    window.scheduleDensityFitAll?.(true);
  }

  function updateScoreLayoutControl() {
    const control = document.getElementById('scoreLayoutControl');
    if (!control) return;
    control.hidden = !isScoreViewActive() || compactQuery.matches;
    control.querySelectorAll('.score-layout-option').forEach(button => {
      const active = Number(button.dataset.value) === scoreMeasuresPerLine;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function ensureScoreLayoutControl() {
    let control = document.getElementById('scoreLayoutControl');
    if (control) return control;

    control = document.createElement('div');
    control.id = 'scoreLayoutControl';
    control.className = 'score-layout-control';
    control.setAttribute('aria-label', '看譜模式每列小節數');

    const label = document.createElement('span');
    label.className = 'score-layout-label';
    label.textContent = '每列';
    control.appendChild(label);

    SCORE_LAYOUT_VALUES.forEach(value => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'score-layout-option';
      button.dataset.value = String(value);
      button.textContent = String(value);
      button.setAttribute('aria-label', `看譜模式每列 ${value} 小節`);
      button.addEventListener('click', () => {
        if (scoreMeasuresPerLine === value) return;
        scoreMeasuresPerLine = value;
        localStorage.setItem(SCORE_LAYOUT_KEY, String(value));
        updateScoreLayoutControl();
        const song = currentSongSafe();
        if (song?.rows) window.renderRows(song.rows);
      });
      control.appendChild(button);
    });

    document.getElementById('rhythmToggleButton')?.insertAdjacentElement('afterend', control);
    updateScoreLayoutControl();
    return control;
  }

  window.renderRows = function renderRowsWithScoreLayout(rows) {
    if (isScoreViewActive()) {
      if (compactQuery.matches) return baseRenderRows(rows);
      return renderScoreRows(rows);
    }
    return baseRenderRows(rows);
  };

  window.setScoreViewEnabled = function setScoreViewEnabledWithLayout(enabled) {
    const result = baseSetScoreViewEnabled(enabled);
    ensureScoreLayoutControl();
    updateScoreLayoutControl();
    window.scheduleDensityFitAll?.(true);
    return result;
  };

  compactQuery.addEventListener('change', updateScoreLayoutControl);
  ensureScoreLayoutControl();
  updateScoreLayoutControl();
}

export function installResponsiveScoreLayout() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  installAdaptiveMeasureLayout();
  installScoreLayout();
}
