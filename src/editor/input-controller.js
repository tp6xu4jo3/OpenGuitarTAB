import { legacyGridLocationToV3 } from './migrate-v2.js';
import { normalizeFraction } from './model.js';
import { isPreviewActive, isScoreViewActive } from './view-state.js';

const STRING_COUNT = 6;

let installed = false;
const dirtyRows = new Set();
const dirtyInputs = new Set();
const dirtyGrids = new Set();
let editorFrame = 0;

function currentSongSafe() {
  return typeof window.currentSong === 'function' ? window.currentSong() : null;
}

function ensureCompatibilityRow(song, rowIndex) {
  if (!Array.isArray(song.rows)) song.rows = [];
  while (song.rows.length <= rowIndex) {
    song.rows.push(typeof window.blankRow === 'function'
      ? window.blankRow(song.beatsPerMeasure)
      : Array.from({ length: STRING_COUNT }, () => []));
  }
  if (!Array.isArray(song.rows[rowIndex]) || song.rows[rowIndex].length !== STRING_COUNT) {
    song.rows[rowIndex] = typeof window.blankRow === 'function'
      ? window.blankRow(song.beatsPerMeasure)
      : Array.from({ length: STRING_COUNT }, () => []);
  }
  return song.rows[rowIndex];
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

  inputs.forEach(input => window.syncNoteInputBackground?.(input));

  if (!Array.isArray(song.rhythmRows)) song.rhythmRows = [];
  rows.forEach(rowIndex => {
    while (song.rhythmRows.length <= rowIndex) song.rhythmRows.push({});
    const row = song.rows?.[rowIndex];
    if (!row || typeof window.rhythmRowFromRow !== 'function') return;
    song.rhythmRows[rowIndex] = window.rhythmRowFromRow(row, song.beatsPerMeasure);
    window.renderRhythmNotation?.(rowIndex);
  });

  grids.forEach(grid => window.fitDensityGrid?.(grid, false));
  window.editorPlayback?.invalidate?.();
}

function markDirty(input, rowIndex) {
  dirtyInputs.add(input);
  dirtyRows.add(rowIndex);
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

  const rowIndex = Number(input.dataset.row);
  const stringIndex = Number(input.dataset.string);
  const position = Number(input.dataset.position);
  if (!Number.isInteger(rowIndex) || !Number.isInteger(stringIndex) || !Number.isInteger(position)) return;

  const store = getStore();
  const song = currentSongSafe();
  if (!store || !song) return;
  const location = inputLocation(input, store, rowIndex, position);
  if (!location) return;

  store.dispatch({
    type: 'note/set',
    measureId: location.measureId,
    at: location.at,
    duration: [1, 4],
    string: stringIndex,
    fret: normalized
  });
  markStoreCurrent(store);

  const row = ensureCompatibilityRow(song, rowIndex);
  if (!Array.isArray(row[stringIndex])) row[stringIndex] = [];
  row[stringIndex][position] = normalized;

  window.jumpToInput?.(input, false);
  markDirty(input, rowIndex);
  if (normalized.length === 2) window.focusRelative?.(input, 0, 1);
}

function handleKeydown(event) {
  const input = event.target.closest?.('.note-input');
  if (!input || isPreviewActive() || isScoreViewActive()) return;
  window.handleKeydown?.(event);
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
  tabArea.addEventListener('keydown', handleKeydown);
  tabArea.addEventListener('focusin', handleFocus);
  tabArea.addEventListener('click', handleClick);
}
