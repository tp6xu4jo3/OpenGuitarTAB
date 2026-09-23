import { focusRelativeInput, handleGridNavigationKeydown } from './grid-navigation.js';
import { renderRhythmNotation } from './grid-renderer.js';
import { ensureCompatibilityRow, legacyBeatsPerMeasure, rhythmRowFromLegacyRow } from './legacy-grid-compat.js';
import { legacyGridLocationToV3 } from './migrate-v2.js';
import { normalizeFraction } from './model.js';
import { scheduleGridFit, syncInputBackground } from './presentation.js';
import { isPreviewActive, isScoreViewActive } from './view-state.js';

let installed = false;
const dirtyRows = new Set();
const dirtyInputs = new Set();
const dirtyGrids = new Set();
let editorFrame = 0;

function currentSongSafe() {
  return typeof window.currentSong === 'function' ? window.currentSong() : null;
}

function flushDirtyUi() {
  editorFrame = 0;
  const song = currentSongSafe();
  if (!song || isPreviewActive()) {
    dirtyRows.clear();
    dirtyInputs.clear();
    dirtyGrids.clear();
    return;
  }

  const inputs = [...dirtyInputs];
  const rows = [...dirtyRows];
  const grids = [...dirtyGrids];
  dirtyInputs.clear();
  dirtyRows.clear();
  dirtyGrids.clear();

  inputs.forEach(input => syncInputBackground(input));

  if (!Array.isArray(song.rhythmRows)) song.rhythmRows = [];
  rows.forEach(rowIndex => {
    while (song.rhythmRows.length <= rowIndex) song.rhythmRows.push({});
    const row = song.rows?.[rowIndex];
    if (!row) return;
    song.rhythmRows[rowIndex] = rhythmRowFromLegacyRow(row, legacyBeatsPerMeasure(song));
    renderRhythmNotation(rowIndex);
  });

  grids.forEach(grid => scheduleGridFit(grid, false));
  window.editorPlayback?.invalidate?.();
}

function markDirty(input, rowIndex, { compatibility = true } = {}) {
  dirtyInputs.add(input);
  if (compatibility) dirtyRows.add(rowIndex);
  const grid = input.closest('.tab-grid');
  if (grid) dirtyGrids.add(grid);
  if (!editorFrame) editorFrame = requestAnimationFrame(flushDirtyUi);
}

function fractionFromDataset(value) {
  const match = String(value || '').match(/^(-?\d+)\/(\d+)$/);
  if (!match) return null;
  return normalizeFraction([Number(match[1]), Number(match[2])]);
}

function inputLocation(input, store, rowIndex, position) {
  const measureId = String(input.dataset.measureId || '');
  const at = fractionFromDataset(input.dataset.at);
  if (measureId && at) return { measureId, at };
  return legacyGridLocationToV3(store.getDocument(), rowIndex, position);
}

function handleInput(event, { getStore, markStoreCurrent }) {
  const input = event.target.closest?.('.note-input');
  if (!input || isPreviewActive() || isScoreViewActive()) return;

  const normalized = typeof window.normalizeTabValue === 'function'
    ? window.normalizeTabValue(input.value)
    : String(input.value ?? '').trim();
  input.value = normalized;
  input.classList.toggle('has-value', normalized.length > 0);
  input.dataset.noteLength = normalized.length ? String(Math.min(2, normalized.length)) : '0';

  const rowIndex = Number(input.dataset.row);
  const stringIndex = Number(input.dataset.string);
  const position = Number(input.dataset.position);
  const v3Only = input.dataset.v3Only === 'true';
  if (!Number.isInteger(rowIndex) || !Number.isInteger(stringIndex)) return;
  if (!v3Only && !Number.isInteger(position)) return;

  const store = getStore();
  const song = currentSongSafe();
  if (!store || !song) return;
  const location = inputLocation(input, store, rowIndex, position);
  if (!location) return;

  const duration = fractionFromDataset(input.dataset.duration) || [1, 4];
  store.dispatch({
    type: 'note/set',
    measureId: location.measureId,
    at: location.at,
    duration,
    string: stringIndex,
    fret: normalized
  });
  markStoreCurrent(store);

  if (!v3Only) {
    const row = ensureCompatibilityRow(song, rowIndex);
    if (!Array.isArray(row[stringIndex])) row[stringIndex] = [];
    row[stringIndex][position] = normalized;
  }

  window.jumpToInput?.(input, false);
  markDirty(input, rowIndex, { compatibility: !v3Only });
  if (normalized.length === 2) {
    focusRelativeInput(input, { documentModel: store.getDocument(), timeDelta: 1 });
  }
}

function handleKeydown(event, { getStore }) {
  const input = event.target.closest?.('.note-input');
  if (!input || isPreviewActive() || isScoreViewActive()) return;
  handleGridNavigationKeydown(event, { documentModel: getStore()?.getDocument?.() });
}

function handleFocus(event) {
  const input = event.target.closest?.('.note-input');
  if (!input || isPreviewActive() || isScoreViewActive()) return;
  input.select();
  window.jumpToInput?.(input, false);
}

function handleClick(event) {
  const input = event.target.closest?.('.note-input');
  if (!input || isPreviewActive() || isScoreViewActive()) return;
  window.jumpToInput?.(input, true);
}

export function installEditorInputController({ getStore, markStoreCurrent }) {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const tabArea = document.getElementById('tabArea');
  if (!tabArea) return;

  tabArea.addEventListener('input', event => handleInput(event, { getStore, markStoreCurrent }));
  tabArea.addEventListener('keydown', event => handleKeydown(event, { getStore }));
  tabArea.addEventListener('focusin', handleFocus);
  tabArea.addEventListener('click', handleClick);
}
