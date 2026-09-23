import { buildAdaptiveLayout, buildSystems, DEFAULT_LAYOUT_WIDTH } from './layout.js';
import {
  fractionalPercentForGrid,
  legacyPositionPercentForGrid,
  legacyPositionStepPercentForGrid,
  measureBoundaryPercentForGrid
} from './grid-geometry.js';
import {
  LEGACY_LEGACY_SLOTS_PER_BEAT,
  LEGACY_STRING_COUNT,
  legacyBeatsPerMeasure,
  legacyRowMeasureCount,
  legacyRowPositionCount,
  legacyRowStepCount,
  normalizeLegacyMeasureCount,
  projectSystemCountsToLegacySong,
  rhythmOnsetsFromLegacyRow,
  rhythmRowFromLegacyRow
} from './legacy-grid-compat.js';
import { fractionKey, normalizeFraction, noteBaseFret } from './model.js';
import { fractionalGridTimes, isTimeReplacedByFractionalGrid } from './rhythm-grid.js';
import { isScoreViewActive } from './view-state.js';

const STRINGS = LEGACY_STRING_COUNT;
const EDITOR_RAIL_WIDTH = 102;

let installed = false;
let layoutFrame = 0;
let observedLayoutWidth = -1;

function currentSongSafe() {
  return typeof window.currentSong === 'function' ? window.currentSong() : null;
}

function currentDocumentSafe(song = currentSongSafe()) {
  return window.editorV3?.getStore?.({ reconcile: false })?.getDocument?.() || song?.document || null;
}

function beatsPerMeasure(song = currentSongSafe()) {
  return legacyBeatsPerMeasure(song);
}

function makeDiv(className) {
  const node = document.createElement('div');
  node.className = className;
  return node;
}

function ensureRowMeasureCounts(song = currentSongSafe()) {
  return projectSystemCountsToLegacySong(song, currentDocumentSafe(song));
}

function rowMeasureCount(rowIndex, song = currentSongSafe()) {
  return legacyRowMeasureCount(song, currentDocumentSafe(song), rowIndex);
}

function rowPositionCount(rowIndex, song = currentSongSafe()) {
  return legacyRowPositionCount(song, currentDocumentSafe(song), rowIndex);
}

function rowStepCount(rowIndex, song = currentSongSafe()) {
  return legacyRowStepCount(song, currentDocumentSafe(song), rowIndex);
}

function positionPercentForGrid(grid, absolutePosition) {
  return legacyPositionPercentForGrid(grid, absolutePosition, {
    beatsPerMeasure: beatsPerMeasure(),
    slotsPerBeat: LEGACY_LEGACY_SLOTS_PER_BEAT
  });
}

function positionStepPercentForGrid(grid, absolutePosition) {
  return legacyPositionStepPercentForGrid(grid, absolutePosition, {
    beatsPerMeasure: beatsPerMeasure(),
    slotsPerBeat: LEGACY_LEGACY_SLOTS_PER_BEAT
  });
}

function createInput({
  rowIndex,
  string,
  position,
  measureId = '',
  at = [0, 1],
  duration = [1, 4],
  originalStep = null,
  isSmall = false,
  v3Only = false
}) {
  const input = document.createElement('input');
  input.className = 'note-input';

  if (!isSmall && originalStep != null) {
    const localStep = originalStep % (beatsPerMeasure() * 2);
    const shadeInterval = beatsPerMeasure() === 3 ? 3 : 2;
    if (localStep % shadeInterval === 0) input.classList.add('odd-step');
  }
  if (isSmall) input.classList.add('small-step');
  if (v3Only) input.classList.add('fractional-step');

  input.type = 'text';
  input.inputMode = 'numeric';
  input.pattern = '[0-9xX]*';
  input.maxLength = 2;
  input.autocomplete = 'off';
  input.dataset.row = String(rowIndex);
  input.dataset.string = String(string);
  input.dataset.position = String(position);
  input.dataset.size = isSmall ? 'small' : 'normal';
  input.dataset.at = fractionKey(normalizeFraction(at));
  input.dataset.duration = fractionKey(normalizeFraction(duration));
  if (measureId) input.dataset.measureId = String(measureId);
  if (originalStep != null) input.dataset.step = String(originalStep);
  if (v3Only) input.dataset.v3Only = 'true';

  input.ariaLabel = v3Only
    ? `第 ${rowIndex + 1} 列，第 ${string + 1} 弦，細分時間位置 ${input.dataset.at}`
    : isSmall
      ? `第 ${rowIndex + 1} 列，第 ${string + 1} 弦，中間小輸入點 ${Number(position) + 1}`
      : `第 ${rowIndex + 1} 列，第 ${string + 1} 弦，第 ${(originalStep ?? 0) + 1} 個輸入點`;

  if (isScoreViewActive()) {
    input.readOnly = true;
    input.tabIndex = -1;
    input.setAttribute('aria-readonly', 'true');
  }

  return input;
}

function eventAtFraction(measure, at) {
  const key = fractionKey(at);
  return (measure?.events || []).find(event => fractionKey(event.at) === key) || null;
}

function gridTemplateColumns(measureWidths, measureSteps) {
  return measureWidths.flatMap(width => Array.from({ length: measureSteps }, () => width / measureSteps))
    .map(width => `${width.toFixed(6)}%`)
    .join(' ');
}

function createTabGrid(rowIndex, rowValues, logicalSystem, segment) {
  const song = currentSongSafe();
  const beats = beatsPerMeasure(song);
  const measureSteps = beats * 2;
  const measureSlots = beats * LEGACY_SLOTS_PER_BEAT;
  const measureCount = Math.max(1, segment.measures.length);
  const startMeasure = Math.max(0, Number(segment.startMeasure) || 0);
  const visibleSteps = measureCount * measureSteps;
  const visiblePositions = measureCount * measureSlots;
  const widths = segment.measureWidths?.length === measureCount
    ? segment.measureWidths
    : Array(measureCount).fill(100 / measureCount);

  const grid = makeDiv('tab-grid adaptive-tab-grid');
  grid.dataset.row = String(rowIndex);
  grid.dataset.measureStart = String(startMeasure);
  grid.dataset.measureCount = String(measureCount);
  grid.dataset.positionStart = String(startMeasure * measureSlots);
  grid.dataset.positionCount = String(visiblePositions);
  grid.dataset.measureIds = segment.measureIds.join(',');
  grid.dataset.measureWidths = widths.map(value => Number(value).toFixed(6)).join(',');
  grid.style.setProperty('--steps', String(visibleSteps));
  grid.style.gridTemplateColumns = gridTemplateColumns(widths, measureSteps);
  grid.style.width = '100%';

  for (let string = 0; string < STRINGS; string++) {
    const line = makeDiv('string-line');
    line.style.setProperty('--string-index', String(string));
    grid.appendChild(line);
  }

  for (let boundary = 0; boundary <= measureCount; boundary++) {
    const line = makeDiv('measure-line');
    line.style.setProperty('--measure-index', String(startMeasure + boundary));
    line.style.left = `${measureBoundaryPercentForGrid(grid, boundary)}%`;
    if (boundary === 0) line.classList.add('first');
    if (boundary === measureCount) line.classList.add('last');
    grid.appendChild(line);
  }

  for (let localMeasure = 0; localMeasure < measureCount; localMeasure++) {
    const measureLeft = measureBoundaryPercentForGrid(grid, localMeasure);
    const width = widths[localMeasure];
    for (let beat = 1; beat < beats; beat++) {
      const line = makeDiv('beat-guide');
      line.style.setProperty('--guide-percent', `${measureLeft + width * (beat / beats)}%`);
      grid.appendChild(line);
    }
  }

  let localGridStep = 0;
  for (let localMeasure = 0; localMeasure < measureCount; localMeasure++) {
    const absoluteMeasure = startMeasure + localMeasure;
    const measure = logicalSystem[absoluteMeasure] || segment.measures[localMeasure];
    for (let localStep = 0; localStep < measureSteps; localStep++, localGridStep++) {
      const position = absoluteMeasure * measureSlots + localStep * 2;
      const at = normalizeFraction([localStep * 2, LEGACY_SLOTS_PER_BEAT]);
      const replaced = isTimeReplacedByFractionalGrid(measure, at);
      for (let string = 0; string < STRINGS; string++) {
        const cell = makeDiv('cell');
        cell.style.gridColumn = String(localGridStep + 1);
        cell.style.gridRow = String(string + 1);
        if (!replaced) {
          const input = createInput({
            rowIndex,
            string,
            position,
            measureId: measure?.id,
            at,
            duration: [1, 4],
            originalStep: absoluteMeasure * measureSteps + localStep
          });
          const value = String(rowValues?.[string]?.[position] ?? '');
          input.value = value;
          input.classList.toggle('has-value', value.length > 0);
          cell.appendChild(input);
        } else {
          cell.classList.add('fractional-replaced-cell');
        }
        grid.appendChild(cell);
      }
    }
  }

  for (let localMeasure = 0; localMeasure < measureCount; localMeasure++) {
    const absoluteMeasure = startMeasure + localMeasure;
    const measure = logicalSystem[absoluteMeasure] || segment.measures[localMeasure];
    for (let localStep = 0; localStep < measureSteps; localStep++) {
      const position = absoluteMeasure * measureSlots + localStep * 2 + 1;
      const at = normalizeFraction([localStep * 2 + 1, LEGACY_SLOTS_PER_BEAT]);
      if (isTimeReplacedByFractionalGrid(measure, at)) continue;
      for (let string = 0; string < STRINGS; string++) {
        const cell = makeDiv('small-cell');
        cell.style.left = `${positionPercentForGrid(grid, position)}%`;
        cell.style.top = `calc(${string} * var(--row-height) + (var(--row-height) / 2))`;
        const input = createInput({
          rowIndex,
          string,
          position,
          measureId: measure?.id,
          at,
          duration: [1, 4],
          isSmall: true
        });
        const value = String(rowValues?.[string]?.[position] ?? '');
        input.value = value;
        input.classList.toggle('has-value', value.length > 0);
        cell.appendChild(input);
        grid.appendChild(cell);
      }
    }
  }

  for (let localMeasure = 0; localMeasure < measureCount; localMeasure++) {
    const absoluteMeasure = startMeasure + localMeasure;
    const measure = logicalSystem[absoluteMeasure] || segment.measures[localMeasure];
    for (const time of fractionalGridTimes(measure)) {
      const duration = time.duration || [1, 4];
      const event = eventAtFraction(measure, time.at);
      const left = fractionalPercentForGrid(grid, absoluteMeasure, time.at, duration, measure);
      for (let string = 0; string < STRINGS; string++) {
        const cell = makeDiv('small-cell fractional-cell');
        cell.style.left = `${left}%`;
        cell.style.top = `calc(${string} * var(--row-height) + (var(--row-height) / 2))`;
        const input = createInput({
          rowIndex,
          string,
          position: -1,
          measureId: measure?.id,
          at: time.at,
          duration,
          isSmall: true,
          v3Only: true
        });
        const note = (event?.notes || []).find(item => Number(item.string) === string);
        const value = note ? noteBaseFret(note) : '';
        input.value = value;
        input.classList.toggle('has-value', value.length > 0);
        if (event?.id) input.dataset.eventId = String(event.id);
        if (note?.id) input.dataset.noteId = String(note.id);
        cell.appendChild(input);
        grid.appendChild(cell);
      }
    }
  }

  const rhythmLayer = makeDiv('rhythm-layer');
  rhythmLayer.dataset.row = String(rowIndex);
  rhythmLayer.setAttribute('aria-hidden', 'true');
  grid.appendChild(rhythmLayer);
  return grid;
}

function createTabSystem(rowIndex, rowCount, { rowValues = null, logicalSystem = null, segments = null } = {}) {
  const song = currentSongSafe();
  const system = makeDiv('tab-system adaptive-tab-system');
  system.dataset.row = String(rowIndex);
  system.dataset.centerKey = `row-${rowIndex}`;

  const placeholder = makeDiv('system-label layout-rail-placeholder');
  placeholder.setAttribute('aria-hidden', 'true');
  system.appendChild(placeholder);

  const stack = makeDiv('adaptive-layout-stack');
  const logical = logicalSystem || logicalSystems(song)?.[rowIndex] || [];
  const fallbackMeasureCount = rowMeasureCount(rowIndex, song);
  const activeSegments = segments?.length ? segments : [{
    startMeasure: 0,
    measures: logical.length ? logical : Array.from({ length: fallbackMeasureCount }, (_, index) => ({ id: `legacy-${rowIndex}-${index}` })),
    measureIds: logical.map(measure => measure.id),
    measureWidths: Array(fallbackMeasureCount).fill(100 / fallbackMeasureCount)
  }];

  activeSegments.forEach((segment, lineIndex) => {
    const grid = createTabGrid(rowIndex, rowValues, logical, segment);
    grid.dataset.layoutLine = String(lineIndex);
    stack.appendChild(grid);
  });
  system.appendChild(stack);
  return system;
}

function rhythmOnsetsFromRow(row, beats = beatsPerMeasure()) {
  return rhythmOnsetsFromLegacyRow(row, beats);
}

function rhythmRowFromRow(row, beats = beatsPerMeasure()) {
  return rhythmRowFromLegacyRow(row, beats);
}

function filledPositions(rowIndex, maxPosition) {
  const result = new Map();
  const row = currentSongSafe()?.rows?.[rowIndex];
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
  const measureSlots = beats * LEGACY_SLOTS_PER_BEAT;
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
        onsets.push({ position, duration: Number(rawDuration), lowestString: values.get(position) ?? STRINGS - 1 });
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
        onset.duration = Math.max(1, Math.min(next && next.position < measureEnd ? next.position - onset.position : measureEnd - onset.position, measureSlots));
      });
    }

    const percent = position => positionPercentForGrid(grid, position);
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

    const groupSlots = beats === 3 ? 6 : LEGACY_SLOTS_PER_BEAT;
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
        } else if (primary.length === 1) appendMark('rhythm-flag primary', percent(primary[0].position));

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
            if (primary.length === 1) appendMark('rhythm-flag secondary', percent(onset.position));
            else {
              const previous = primary[onsetIndex - 1];
              const next = primary[onsetIndex + 1];
              let direction = 'right';
              if (!next) direction = 'left';
              else if (previous && onset.position - previous.position < next.position - onset.position) direction = 'left';
              const width = positionStepPercentForGrid(grid, onset.position) * 0.65;
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

function updateRemoveRowButton() {
  const button = document.getElementById('removeRow');
  const song = currentSongSafe();
  if (button) button.disabled = (logicalSystems(song)?.length || song?.rows?.length || 0) <= 1;
}

function layoutAvailableWidth(tabArea) {
  const measured = Number(tabArea?.clientWidth) || Number(tabArea?.getBoundingClientRect?.().width) || 0;
  return Math.max(260, (measured || DEFAULT_LAYOUT_WIDTH + EDITOR_RAIL_WIDTH) - EDITOR_RAIL_WIDTH);
}

function fallbackSegments(rowIndex, count) {
  return [{
    sourceSystemIndex: rowIndex,
    startMeasure: 0,
    measures: Array.from({ length: count }, (_, index) => ({ id: `legacy-${rowIndex}-${index}` })),
    measureIds: [],
    measureWidths: Array(count).fill(100 / count)
  }];
}

function renderRows(rows) {
  window.editorPlayback?.stop?.(false, true);
  const song = currentSongSafe();
  const beats = beatsPerMeasure(song);
  const normalized = typeof window.normalizeRows === 'function' ? window.normalizeRows(rows, beats) : rows;
  const tabArea = document.getElementById('tabArea');
  if (!tabArea) return;

  ensureRowMeasureCounts(song);
  const documentModel = currentDocumentSafe(song);
  const systems = documentModel ? buildSystems(documentModel) : null;
  const adaptive = documentModel ? buildAdaptiveLayout(documentModel, { availableWidth: layoutAvailableWidth(tabArea) }) : null;
  const rowCount = Math.max(normalized?.length || 0, systems?.length || 0, 1);
  tabArea.replaceChildren();

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const logical = systems?.[rowIndex] || [];
    const measureCount = logical.length || rowMeasureCount(rowIndex, song);
    const segments = adaptive?.systems.filter(system => system.sourceSystemIndex === rowIndex) || fallbackSegments(rowIndex, measureCount);
    tabArea.appendChild(createTabSystem(rowIndex, rowCount, {
      rowValues: normalized?.[rowIndex] || Array.from({ length: STRINGS }, () => []),
      logicalSystem: logical,
      segments
    }));
  }

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) renderRhythmNotation(rowIndex);
  updateRemoveRowButton();
  window.editorPlayback?.invalidate?.();
  window.updateProgressRange?.();
  window.editorLayoutPlan = adaptive;
  window.dispatchEvent(new CustomEvent('opentab:editor-rendered', { detail: { layout: adaptive } }));
}

function scheduleLayoutRender() {
  if (layoutFrame) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0;
    const editorView = document.getElementById('editorView');
    const song = currentSongSafe();
    if (editorView?.hidden || !song?.rows) return;
    renderRows(song.rows);
  });
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
    renderRows,
    positionPercentForGrid,
    measureBoundaryPercentForGrid,
    scheduleEditorLayout: scheduleLayoutRender
  });

  const sheet = document.querySelector('.sheet');
  if (sheet && typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect?.width;
      if (!Number.isFinite(width) || width <= 0 || Math.abs(width - observedLayoutWidth) < 2) return;
      observedLayoutWidth = width;
      scheduleLayoutRender();
    });
    observer.observe(sheet);
  } else {
    window.addEventListener('resize', scheduleLayoutRender, { passive: true });
  }
}

export {
  createTabSystem,
  ensureRowMeasureCounts,
  measureBoundaryPercentForGrid,
  positionPercentForGrid,
  renderRhythmNotation,
  renderRows,
  rhythmOnsetsFromRow,
  rhythmRowFromRow,
  rowMeasureCount,
  rowPositionCount,
  rowStepCount,
  scheduleLayoutRender
};
