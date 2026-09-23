import { isScoreViewActive } from './view-state.js';

const STRINGS = 6;
const MAX_MEASURES_PER_SYSTEM = 4;
const SLOTS_PER_BEAT = 4;

let installed = false;

function currentSongSafe() {
  return typeof window.currentSong === 'function' ? window.currentSong() : null;
}

function beatsPerMeasure(song = currentSongSafe()) {
  return Number(song?.beatsPerMeasure) === 3 ? 3 : 4;
}

function makeDiv(className) {
  const node = document.createElement('div');
  node.className = className;
  return node;
}

function normalizeMeasureCount(value) {
  const count = Number(value);
  return Number.isInteger(count)
    ? Math.max(1, Math.min(MAX_MEASURES_PER_SYSTEM, count))
    : MAX_MEASURES_PER_SYSTEM;
}

function normalizeMeasureCounts(rawCounts, rowCount) {
  return Array.from({ length: rowCount }, (_, index) => normalizeMeasureCount(rawCounts?.[index]));
}

function ensureRowMeasureCounts(song = currentSongSafe()) {
  if (!song) return [];
  const rowCount = song.rows?.length || 1;
  song.rowMeasureCounts = normalizeMeasureCounts(song.rowMeasureCounts, rowCount);
  return song.rowMeasureCounts;
}

function rowMeasureCount(rowIndex, song = currentSongSafe()) {
  if (!song) return MAX_MEASURES_PER_SYSTEM;
  const counts = ensureRowMeasureCounts(song);
  return normalizeMeasureCount(counts[rowIndex]);
}

function rowPositionCount(rowIndex, song = currentSongSafe()) {
  const beats = beatsPerMeasure(song);
  return rowMeasureCount(rowIndex, song) * beats * SLOTS_PER_BEAT;
}

function rowStepCount(rowIndex, song = currentSongSafe()) {
  return rowMeasureCount(rowIndex, song) * beatsPerMeasure(song) * 2;
}

function createInput({ rowIndex, string, position, originalStep = null, isSmall = false }) {
  const input = document.createElement('input');
  input.className = 'note-input';

  if (!isSmall && originalStep != null) {
    const localStep = originalStep % (beatsPerMeasure() * 2);
    const shadeInterval = beatsPerMeasure() === 3 ? 3 : 2;
    if (localStep % shadeInterval === 0) input.classList.add('odd-step');
  }
  if (isSmall) input.classList.add('small-step');

  input.type = 'text';
  input.inputMode = 'numeric';
  input.pattern = '[0-9xX]*';
  input.maxLength = 2;
  input.autocomplete = 'off';
  input.dataset.row = String(rowIndex);
  input.dataset.string = String(string);
  input.dataset.position = String(position);
  input.dataset.size = isSmall ? 'small' : 'normal';
  if (originalStep != null) input.dataset.step = String(originalStep);

  input.ariaLabel = isSmall
    ? `第 ${rowIndex + 1} 列，第 ${string + 1} 弦，中間小輸入點 ${position + 1}`
    : `第 ${rowIndex + 1} 列，第 ${string + 1} 弦，第 ${(originalStep ?? 0) + 1} 個輸入點`;

  if (isScoreViewActive()) {
    input.readOnly = true;
    input.tabIndex = -1;
    input.setAttribute('aria-readonly', 'true');
  }

  return input;
}

function createTabSystem(rowIndex, rowCount) {
  const song = currentSongSafe();
  const measureCount = rowMeasureCount(rowIndex, song);
  const beats = beatsPerMeasure(song);
  const measureSteps = beats * 2;
  const measureSlots = beats * SLOTS_PER_BEAT;
  const visibleSteps = measureCount * measureSteps;
  const visiblePositions = measureCount * measureSlots;

  const system = makeDiv('tab-system');
  system.dataset.row = String(rowIndex);

  const grid = makeDiv('tab-grid');
  grid.dataset.row = String(rowIndex);
  grid.dataset.measureStart = '0';
  grid.dataset.measureCount = String(measureCount);
  grid.dataset.positionStart = '0';
  grid.dataset.positionCount = String(visiblePositions);
  grid.style.setProperty('--steps', String(visibleSteps));
  grid.style.width = `${measureCount * 25}%`;

  for (let string = 0; string < STRINGS; string++) {
    const line = makeDiv('string-line');
    line.style.setProperty('--string-index', String(string));
    grid.appendChild(line);
  }

  for (let measure = 0; measure <= measureCount; measure++) {
    const line = makeDiv('measure-line');
    line.style.setProperty('--measure-index', String(measure));
    line.style.left = `${(measure / measureCount) * 100}%`;
    if (measure === 0) line.classList.add('first');
    if (measure === measureCount) line.classList.add('last');
    grid.appendChild(line);
  }

  const totalBeats = measureCount * beats;
  for (let guide = 1; guide < totalBeats; guide++) {
    if (guide % beats === 0) continue;
    const line = makeDiv('beat-guide');
    line.style.setProperty('--guide-percent', `${(guide / totalBeats) * 100}%`);
    grid.appendChild(line);
  }

  for (let string = 0; string < STRINGS; string++) {
    for (let step = 0; step < visibleSteps; step++) {
      const measure = Math.floor(step / measureSteps);
      const localStep = step % measureSteps;
      const position = measure * measureSlots + localStep * 2;
      const cell = makeDiv('cell');
      cell.style.gridColumn = String(step + 1);
      cell.style.gridRow = String(string + 1);
      cell.appendChild(createInput({ rowIndex, string, position, originalStep: step }));
      grid.appendChild(cell);
    }
  }

  for (let string = 0; string < STRINGS; string++) {
    for (let measure = 0; measure < measureCount; measure++) {
      for (let localStep = 0; localStep < measureSteps; localStep++) {
        const absoluteStep = measure * measureSteps + localStep;
        const cell = makeDiv('small-cell');
        cell.style.left = `${((absoluteStep + 1) / visibleSteps) * 100}%`;
        cell.style.top = `calc(${string} * var(--row-height) + (var(--row-height) / 2))`;
        cell.appendChild(createInput({
          rowIndex,
          string,
          position: measure * measureSlots + localStep * 2 + 1,
          isSmall: true
        }));
        grid.appendChild(cell);
      }
    }
  }

  const rhythmLayer = makeDiv('rhythm-layer');
  rhythmLayer.dataset.row = String(rowIndex);
  rhythmLayer.setAttribute('aria-hidden', 'true');
  grid.appendChild(rhythmLayer);
  system.appendChild(grid);
  return system;
}

function rhythmOnsetsFromRow(row, beats = beatsPerMeasure()) {
  const measureSlots = beats * SLOTS_PER_BEAT;
  const positions = Math.max(...(row || []).map(values => values?.length || 0), measureSlots);
  const onsets = [];

  for (let position = 0; position < positions; position++) {
    let lowestString = -1;
    for (let string = 0; string < STRINGS; string++) {
      if (String(row?.[string]?.[position] ?? '').trim() !== '') lowestString = string;
    }
    if (lowestString >= 0) onsets.push({ position, duration: 1, lowestString });
  }

  onsets.forEach((onset, index) => {
    const measureEnd = (Math.floor(onset.position / measureSlots) + 1) * measureSlots;
    const next = onsets[index + 1];
    onset.duration = Math.max(
      1,
      Math.min(next && next.position < measureEnd ? next.position - onset.position : measureEnd - onset.position, measureSlots)
    );
  });
  return onsets;
}

function rhythmRowFromRow(row, beats = beatsPerMeasure()) {
  const rhythm = {};
  rhythmOnsetsFromRow(row, beats).forEach(onset => {
    rhythm[onset.position] = onset.duration;
  });
  return rhythm;
}

function filledPositions(rowIndex, maxPosition) {
  const result = new Map();
  const song = currentSongSafe();
  const row = song?.rows?.[rowIndex];
  for (let position = 0; position < maxPosition; position++) {
    let lowestString = -1;
    for (let string = 0; string < STRINGS; string++) {
      if (String(row?.[string]?.[position] ?? '').trim() !== '') lowestString = string;
    }
    if (lowestString >= 0) result.set(position, lowestString);
  }
  return result;
}

function renderRhythmNotation(rowIndex) {
  const layers = [...document.querySelectorAll(`.rhythm-layer[data-row="${rowIndex}"]`)];
  if (!layers.length) return;

  const song = currentSongSafe();
  const beats = beatsPerMeasure(song);
  const measureSlots = beats * SLOTS_PER_BEAT;
  const explicit = song?.rhythmRows?.[rowIndex] || {};

  layers.forEach(layer => {
    const grid = layer.closest('.tab-grid');
    if (!grid) return;
    layer.replaceChildren();

    const startPosition = Number(grid.dataset.positionStart) || 0;
    const positionCount = Number(grid.dataset.positionCount) || rowPositionCount(rowIndex, song);
    const endPosition = startPosition + positionCount;
    const styles = getComputedStyle(grid);
    const rowHeight = parseFloat(styles.getPropertyValue('--row-height')) || 32;
    const valueHeight = parseFloat(styles.getPropertyValue('--value-height')) || 34;
    const stemEnd = parseFloat(styles.getPropertyValue('--stem-end')) || 35;
    const staffHeight = rowHeight * STRINGS;
    const values = filledPositions(rowIndex, endPosition);
    const onsets = [];

    if (Object.keys(explicit).length) {
      for (const [rawPosition, rawDuration] of Object.entries(explicit)) {
        const position = Number(rawPosition);
        if (position < startPosition || position >= endPosition) continue;
        onsets.push({
          position,
          duration: Number(rawDuration),
          lowestString: values.get(position) ?? STRINGS - 1
        });
      }
      onsets.sort((a, b) => a.position - b.position);
    } else {
      for (const [position, lowestString] of values) {
        if (position >= startPosition && position < endPosition) onsets.push({ position, duration: 1, lowestString });
      }
      onsets.sort((a, b) => a.position - b.position);
      onsets.forEach((onset, index) => {
        const measureEnd = (Math.floor(onset.position / measureSlots) + 1) * measureSlots;
        const next = onsets[index + 1];
        onset.duration = Math.max(
          1,
          Math.min(next && next.position < measureEnd ? next.position - onset.position : measureEnd - onset.position, measureSlots)
        );
      });
    }

    const percent = position => ((position - startPosition + 1) / positionCount) * 100;
    const appendMark = (className, left, width = null) => {
      const mark = makeDiv(className);
      mark.style.left = `${left}%`;
      if (width != null) mark.style.width = `${Math.max(0.3, width)}%`;
      layer.appendChild(mark);
      return mark;
    };

    onsets.forEach(onset => {
      const left = percent(onset.position);
      if (onset.duration < measureSlots || beats === 3) {
        const stem = appendMark('rhythm-stem', left);
        const stemTop = onset.lowestString * rowHeight + rowHeight / 2 + valueHeight / 2 + 2 - staffHeight;
        stem.style.top = `${stemTop}px`;
        stem.style.height = `${stemEnd - stemTop}px`;
      }
      if ([3, 6, 12].includes(onset.duration)) appendMark('rhythm-dot', left);
    });

    const groupSlots = beats === 3 ? 6 : SLOTS_PER_BEAT;
    const firstMeasure = Math.floor(startPosition / measureSlots);
    const lastMeasure = Math.ceil(endPosition / measureSlots);
    for (let measure = firstMeasure; measure < lastMeasure; measure++) {
      for (let groupStart = 0; groupStart < measureSlots; groupStart += groupSlots) {
        const beatStart = measure * measureSlots + groupStart;
        const beatEnd = beatStart + groupSlots;
        const primary = onsets.filter(onset => onset.position >= beatStart && onset.position < beatEnd && onset.duration <= 3);
        if (primary.length >= 2) {
          const first = percent(primary[0].position);
          const last = percent(primary[primary.length - 1].position);
          appendMark('rhythm-beam primary', first, last - first);
        } else if (primary.length === 1) {
          appendMark('rhythm-flag primary', percent(primary[0].position));
        }

        const sixteenths = primary.filter(onset => onset.duration === 1);
        let run = [];
        const flush = () => {
          if (run.length >= 2) {
            const first = percent(run[0].position);
            const last = percent(run[run.length - 1].position);
            appendMark('rhythm-beam secondary', first, last - first);
          } else if (run.length === 1) {
            const onset = run[0];
            const onsetIndex = primary.indexOf(onset);
            if (primary.length === 1) {
              appendMark('rhythm-flag secondary', percent(onset.position));
            } else {
              const previous = primary[onsetIndex - 1];
              const next = primary[onsetIndex + 1];
              let direction = 'right';
              if (!next) direction = 'left';
              else if (previous && onset.position - previous.position < next.position - onset.position) direction = 'left';
              const width = (0.65 / positionCount) * 100;
              const left = percent(onset.position);
              appendMark('rhythm-beam secondary partial', direction === 'left' ? left - width : left, width);
            }
          }
          run = [];
        };

        sixteenths.forEach(onset => {
          if (run.length && onset.position !== run[run.length - 1].position + 1) flush();
          run.push(onset);
        });
        flush();
      }
    }
  });
}

function getInput(row, string, position) {
  return document.querySelector(
    `.note-input[data-row="${row}"][data-string="${string}"][data-position="${position}"]`
  );
}

function focusRelative(current, stringDelta, positionDelta) {
  let row = Number(current.dataset.row);
  let string = Number(current.dataset.string) + stringDelta;
  let position = Number(current.dataset.position) + positionDelta;

  if (positionDelta !== 0) {
    const positions = rowPositionCount(row);
    if (position >= positions) {
      row += 1;
      position = 0;
    } else if (position < 0) {
      row -= 1;
      position = row >= 0 ? rowPositionCount(row) - 1 : 0;
    }
  }

  if (string >= STRINGS) {
    string = 0;
    row += 1;
  } else if (string < 0) {
    string = STRINGS - 1;
    row -= 1;
  }

  if (row < 0) return;
  position = Math.max(0, Math.min(rowPositionCount(row) - 1, position));
  const next = getInput(row, string, position);
  if (next) {
    next.focus();
    next.select();
  }
}

function handleKeydown(event) {
  const input = event.target;
  const controlKeys = ['Backspace', 'Delete', 'Tab', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (event.ctrlKey || event.metaKey) return;
  if (event.key === 'ArrowRight') { event.preventDefault(); focusRelative(input, 0, 1); return; }
  if (event.key === 'ArrowLeft') { event.preventDefault(); focusRelative(input, 0, -1); return; }
  if (event.key === 'ArrowDown') { event.preventDefault(); focusRelative(input, 1, 0); return; }
  if (event.key === 'ArrowUp') { event.preventDefault(); focusRelative(input, -1, 0); return; }
  if (event.key === 'Enter') { event.preventDefault(); focusRelative(input, 1, 0); return; }
  if (!controlKeys.includes(event.key) && !/^[\dxX]$/.test(event.key)) event.preventDefault();
}

function hydrateRow(row, rowIndex) {
  row.forEach((values, string) => {
    values.forEach((value, position) => {
      const input = getInput(rowIndex, string, position);
      if (!input) return;
      const text = String(value ?? '');
      input.value = text;
      input.classList.toggle('has-value', text.length > 0);
    });
  });
  renderRhythmNotation(rowIndex);
}

function updateRemoveRowButton() {
  const button = document.getElementById('removeRow');
  const song = currentSongSafe();
  if (button) button.disabled = (song?.rows?.length || 0) <= 1;
}

function renderRows(rows) {
  window.editorPlayback?.stop?.(false, true);
  const song = currentSongSafe();
  const beats = beatsPerMeasure(song);
  const normalized = typeof window.normalizeRows === 'function'
    ? window.normalizeRows(rows, beats)
    : rows;
  const tabArea = document.getElementById('tabArea');
  if (!tabArea) return;

  ensureRowMeasureCounts(song);
  tabArea.replaceChildren();

  if (isScoreViewActive()) {
    for (let rowIndex = 0; rowIndex < normalized.length; rowIndex += 2) {
      const scoreSystem = makeDiv('tab-system score-system');
      scoreSystem.dataset.centerKey = `pair-${Math.floor(rowIndex / 2)}`;
      const pair = makeDiv('score-grid-pair');
      for (const logicalRow of [rowIndex, rowIndex + 1]) {
        if (logicalRow >= normalized.length) continue;
        pair.appendChild(createTabSystem(logicalRow, normalized.length).querySelector('.tab-grid'));
      }
      scoreSystem.appendChild(pair);
      tabArea.appendChild(scoreSystem);
    }
  } else {
    normalized.forEach((_, rowIndex) => {
      const system = createTabSystem(rowIndex, normalized.length);
      system.dataset.centerKey = `row-${rowIndex}`;
      tabArea.appendChild(system);
    });
  }

  normalized.forEach((row, rowIndex) => hydrateRow(row, rowIndex));
  updateRemoveRowButton();
  window.editorPlayback?.invalidate?.();
  window.updateProgressRange?.();
}

export function installGridRenderer() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  Object.assign(window, {
    ensureRowMeasureCounts,
    rowMeasureCount,
    rowPositionCount,
    rowStepCount,
    createTabSystem,
    rhythmOnsetsFromRow,
    rhythmRowFromRow,
    renderRhythmNotation,
    getInput,
    focusRelative,
    handleKeydown,
    updateRemoveRowButton,
    renderRows
  });
}

export {
  createTabSystem,
  ensureRowMeasureCounts,
  focusRelative,
  getInput,
  handleKeydown,
  renderRhythmNotation,
  renderRows,
  rhythmOnsetsFromRow,
  rhythmRowFromRow,
  rowMeasureCount,
  rowPositionCount,
  rowStepCount
};
