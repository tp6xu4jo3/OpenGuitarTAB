const STRING_COUNT = 6;

const dirtyRows = new Set();
const dirtyInputs = new Set();
const dirtyGrids = new Set();
let editorFrame = 0;
let installed = false;

function currentSongSafe() {
  return typeof window.currentSong === 'function' ? window.currentSong() : null;
}

function scoreViewActive() {
  return Boolean(document.getElementById('editorView')?.classList.contains('score-view'));
}

function previewActive() {
  const badge = document.getElementById('previewBadge');
  return Boolean(badge && !badge.hidden);
}

function flushEditorDirtyState() {
  editorFrame = 0;
  const song = currentSongSafe();
  if (!song || previewActive()) {
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
}

function scheduleEditorFlush() {
  if (editorFrame) return;
  editorFrame = requestAnimationFrame(flushEditorDirtyState);
}

function markInputDirty(input, rowIndex) {
  dirtyInputs.add(input);
  dirtyRows.add(rowIndex);
  const grid = input.closest('.tab-grid');
  if (grid) dirtyGrids.add(grid);
  scheduleEditorFlush();
}

function ensureLegacyRow(song, rowIndex) {
  if (!Array.isArray(song.rows)) song.rows = [];
  while (song.rows.length <= rowIndex) {
    const row = typeof window.blankRow === 'function'
      ? window.blankRow(song.beatsPerMeasure)
      : Array.from({ length: STRING_COUNT }, () => []);
    song.rows.push(row);
  }
  if (!Array.isArray(song.rows[rowIndex]) || song.rows[rowIndex].length !== STRING_COUNT) {
    song.rows[rowIndex] = typeof window.blankRow === 'function'
      ? window.blankRow(song.beatsPerMeasure)
      : Array.from({ length: STRING_COUNT }, () => []);
  }
  return song.rows[rowIndex];
}

function handleEditorInput(event) {
  const input = event.target.closest?.('.note-input');
  if (!input || previewActive() || scoreViewActive()) return;

  const normalized = typeof window.normalizeTabValue === 'function'
    ? window.normalizeTabValue(input.value)
    : String(input.value ?? '').trim();
  input.value = normalized;
  input.classList.toggle('has-value', normalized.length > 0);

  const song = currentSongSafe();
  if (!song) return;

  const rowIndex = Number(input.dataset.row);
  const stringIndex = Number(input.dataset.string);
  const position = Number(input.dataset.position);
  if (!Number.isInteger(rowIndex) || !Number.isInteger(stringIndex) || !Number.isInteger(position)) return;

  const row = ensureLegacyRow(song, rowIndex);
  if (!Array.isArray(row[stringIndex])) row[stringIndex] = [];
  row[stringIndex][position] = normalized;
  song.updatedAt = Date.now();

  window.jumpToInput?.(input, false);
  markInputDirty(input, rowIndex);
  if (normalized.length === 2) window.focusRelative?.(input, 0, 1);
}

function handleEditorKeydown(event) {
  const input = event.target.closest?.('.note-input');
  if (!input || previewActive() || scoreViewActive()) return;
  window.handleKeydown?.(event);
}

function handleEditorFocus(event) {
  const input = event.target.closest?.('.note-input');
  if (!input || previewActive() || scoreViewActive()) return;
  input.select();
  window.jumpToInput?.(input, false);
}

function handleEditorClick(event) {
  const input = event.target.closest?.('.note-input');
  if (!input || previewActive() || scoreViewActive()) return;
  window.jumpToInput?.(input, true);
}

function installScoreModeState() {
  const legacySetScoreViewEnabled = window.setScoreViewEnabled;
  window.setScoreViewEnabled = enabled => {
    const active = Boolean(enabled);
    legacySetScoreViewEnabled?.(active);

    const editorView = document.getElementById('editorView');
    const toggle = document.getElementById('rhythmToggleButton');
    if (!editorView || !toggle) return;

    editorView.classList.toggle('edit-view', !active);
    editorView.classList.toggle('score-view', active);
    toggle.setAttribute('aria-pressed', String(active));
    const label = toggle.querySelector('.mode-toggle-label');
    if (label) label.textContent = '看譜模式';
    toggle.setAttribute('aria-label', active ? '看譜模式已開啟，關閉看譜模式' : '看譜模式已關閉，開啟看譜模式');
  };
}

export function installLegacyUiBridge() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  installScoreModeState();

  const tabArea = document.getElementById('tabArea');
  if (!tabArea) return;
  tabArea.addEventListener('input', handleEditorInput);
  tabArea.addEventListener('keydown', handleEditorKeydown);
  tabArea.addEventListener('focusin', handleEditorFocus);
  tabArea.addEventListener('click', handleEditorClick);
}
