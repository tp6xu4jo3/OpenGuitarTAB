import { getAudioEngine } from './audio-engine.js';
import { measureWidthsForGrid } from './grid-geometry.js';
import { LEGACY_SLOTS_PER_BEAT } from './legacy-grid-compat.js';
import { ensureSongDocumentV3 } from './migrate-v2.js';
import { buildPlaybackIndex, legacyPositionForEntry, nearestPlaybackIndex } from './playback-index.js';
let installed = false;

const state = {
  playing: false,
  timer: null,
  currentIndex: 0,
  playbackIndex: null,
  document: null,
  dirty: true,
  currentNodes: [],
  currentLine: null,
  lastCenteredKey: null
};

const rowInputCache = new Map();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function currentSongSafe() {
  return typeof window.currentSong === 'function' ? window.currentSong() : null;
}

function currentDocument({ reconcile = false } = {}) {
  if (reconcile) window.editorV3?.reconcileCurrentSong?.();
  const storeDocument = window.editorV3?.getStore?.()?.getDocument?.();
  if (storeDocument) return storeDocument;
  const song = currentSongSafe();
  return song ? ensureSongDocumentV3(song) : null;
}

function ensureIndex({ force = false, reconcile = false } = {}) {
  const documentModel = currentDocument({ reconcile });
  if (!documentModel) {
    state.playbackIndex = { document: null, entries: [], totalBeats: 0 };
    state.document = null;
    state.dirty = false;
    return state.playbackIndex;
  }
  if (!force && !state.dirty && state.document === documentModel && state.playbackIndex) return state.playbackIndex;
  state.playbackIndex = buildPlaybackIndex(documentModel);
  state.document = documentModel;
  state.dirty = false;
  state.currentIndex = clamp(state.currentIndex, 0, Math.max(0, state.playbackIndex.entries.length - 1));
  return state.playbackIndex;
}

function inputIndexForRow(row) {
  const safeRow = Math.max(0, Number(row) || 0);
  let index = rowInputCache.get(safeRow);
  if (index) return index;
  index = new Map();
  document.querySelectorAll(`.note-input[data-row="${safeRow}"]`).forEach(input => {
    const position = Number(input.dataset.position);
    if (!Number.isInteger(position)) return;
    if (!index.has(position)) index.set(position, []);
    index.get(position).push(input);
  });
  rowInputCache.set(safeRow, index);
  return index;
}

function getInputsAt(row, position) {
  const inputs = inputIndexForRow(row).get(Number(position));
  return inputs ? inputs.slice() : [];
}

function getFilledInputsAt(row, position) {
  return getInputsAt(row, position).filter(input => String(input.value || '').trim() !== '');
}

function clearPlayhead() {
  state.currentNodes.forEach(node => node.classList?.remove('is-playing'));
  state.currentNodes = [];
  state.currentLine?.remove();
  state.currentLine = null;
  document.querySelectorAll('.playhead-column').forEach(node => node.remove());
}

function scoreViewActive() {
  return Boolean(document.getElementById('editorView')?.classList.contains('score-view'));
}

function gridForEntry(entry) {
  const grids = [...document.querySelectorAll(`.tab-grid[data-row="${entry.rowIndex}"]`)];
  return grids.find(grid => {
    const start = Number(grid.dataset.measureStart) || 0;
    const count = Number(grid.dataset.measureCount) || 1;
    return entry.measureIndexInSystem >= start && entry.measureIndexInSystem < start + count;
  }) || grids[0] || null;
}

function playheadGeometry(entry, grid) {
  const startMeasure = Number(grid.dataset.measureStart) || 0;
  const widths = measureWidthsForGrid(grid);
  const localMeasure = Math.max(0, Math.min(widths.length - 1, entry.measureIndexInSystem - startMeasure));
  const withinMeasure = entry.measureDurationBeats > 0
    ? clamp(entry.atBeats / entry.measureDurationBeats, 0, 1)
    : 0;
  const measureLeft = widths.slice(0, localMeasure).reduce((sum, value) => sum + value, 0);
  const measureWidth = widths[localMeasure] || 100 / widths.length;
  return {
    left: measureLeft + measureWidth * withinMeasure,
    width: Math.max(0.8, measureWidth / Math.max(16, entry.measureDurationBeats * LEGACY_SLOTS_PER_BEAT))
  };
}

function followPlaybackLine(node, key) {
  if (!node || key === state.lastCenteredKey) return;
  const sheet = node.closest('.sheet');
  if (!sheet || sheet.clientHeight <= 0) return;
  const sheetRect = sheet.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const sheetCenter = sheetRect.top + sheet.clientHeight / 2;
  const nodeCenter = nodeRect.top + nodeRect.height / 2;
  if (nodeCenter <= sheetCenter + 1 && nodeRect.bottom >= sheetRect.top) return;
  const centerInContent = sheet.scrollTop + (nodeCenter - sheetRect.top);
  const maxScrollTop = Math.max(0, sheet.scrollHeight - sheet.clientHeight);
  sheet.scrollTo({ top: clamp(centerInContent - sheet.clientHeight / 2, 0, maxScrollTop), behavior: 'smooth' });
  state.lastCenteredKey = key;
}

function highlightEntry(entry) {
  clearPlayhead();
  if (!entry) return;

  const v3Event = document.querySelector(`.v3-event[data-event-id="${CSS.escape(String(entry.eventId))}"]`);
  if (v3Event) {
    state.currentNodes = [...v3Event.querySelectorAll('.v3-note')];
    state.currentNodes.forEach(node => node.classList.add('is-playing'));
    followPlaybackLine(v3Event.closest('.v3-system') || v3Event, `v3:${entry.measureId}`);
    return;
  }

  const fractionalInputs = [...document.querySelectorAll(`.note-input[data-event-id="${CSS.escape(String(entry.eventId))}"]`)];
  if (fractionalInputs.length) {
    state.currentNodes = fractionalInputs;
    state.currentNodes.forEach(node => node.classList.add('is-playing'));
  }

  const legacyPosition = legacyPositionForEntry(entry, LEGACY_SLOTS_PER_BEAT);
  if (Number.isInteger(legacyPosition)) {
    state.currentNodes = getInputsAt(entry.rowIndex, legacyPosition);
    state.currentNodes.forEach(node => node.classList.add('is-playing'));
  }

  const grid = gridForEntry(entry);
  if (!grid) return;
  followPlaybackLine(grid, `row:${entry.rowIndex}:measure:${entry.measureIndexInSystem}`);
  if (!state.playing || !scoreViewActive()) return;

  const geometry = playheadGeometry(entry, grid);
  const line = document.createElement('div');
  line.className = 'playhead-column';
  line.style.left = `${geometry.left}%`;
  line.style.width = `${geometry.width}%`;
  line.setAttribute('aria-hidden', 'true');
  grid.appendChild(line);
  state.currentLine = line;
}

function entryForIndex(index) {
  const playback = ensureIndex();
  if (!playback.entries.length) return null;
  return playback.entries[clamp(Number(index) || 0, 0, playback.entries.length - 1)] || null;
}

function formatBeat(entry) {
  const beat = entry.atBeats + 1;
  return Number.isInteger(beat) ? String(beat) : beat.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function visualLocationForEntry(entry) {
  const grid = gridForEntry(entry);
  const system = grid?.closest?.('.tab-system');
  const line = system?.closest?.('.score-density-line');
  const visualRow = Number(line?.dataset.visualRow ?? system?.dataset.visualRow);
  const startMeasure = Number(grid?.dataset.measureStart) || 0;
  return {
    rowIndex: Number.isInteger(visualRow) ? visualRow : entry.rowIndex,
    measureIndex: Math.max(0, entry.measureIndexInSystem - startMeasure)
  };
}

function updateProgressLabel(index) {
  const label = document.getElementById('progressLabel');
  if (!label) return;
  const entry = entryForIndex(index);
  if (!entry) {
    label.textContent = '尚無音符';
    return;
  }
  const location = visualLocationForEntry(entry);
  label.textContent = `第 ${location.rowIndex + 1} 列 / 第 ${location.measureIndex + 1} 小節 / 第 ${formatBeat(entry)} 拍`;
}

function totalSlots() {
  return Math.max(1, ensureIndex().entries.length);
}

function indexToSlot(index) {
  const entry = entryForIndex(index);
  if (!entry) return { row: 0, position: 0 };
  return {
    row: entry.rowIndex,
    position: Math.max(0, Math.round(legacyPositionForEntry(entry, LEGACY_SLOTS_PER_BEAT)))
  };
}

function slotToIndex(row, position) {
  return nearestPlaybackIndex(ensureIndex(), row, position, LEGACY_SLOTS_PER_BEAT);
}

function setProgressIndex(index, updateSlider = true, highlight = true) {
  const playback = ensureIndex();
  state.currentIndex = clamp(Number(index) || 0, 0, Math.max(0, playback.entries.length - 1));
  const slider = document.getElementById('playProgress');
  if (slider && updateSlider) slider.value = String(state.currentIndex);
  updateProgressLabel(state.currentIndex);
  if (highlight) highlightEntry(playback.entries[state.currentIndex] || null);
}

function updateProgressRange() {
  const playback = ensureIndex({ force: true });
  const slider = document.getElementById('playProgress');
  if (slider) {
    slider.min = '0';
    slider.max = String(Math.max(0, playback.entries.length - 1));
    slider.step = '1';
  }
  state.currentIndex = clamp(state.currentIndex, 0, Math.max(0, playback.entries.length - 1));
  setProgressIndex(state.currentIndex, true, false);
}

function jumpToInput(input, highlight = true) {
  if (!input) return;
  const measureId = String(input.dataset.measureId || '');
  const at = String(input.dataset.at || '');
  if (measureId && at) {
    const playback = ensureIndex();
    const exact = playback.entries.find(entry =>
      String(entry.measureId) === measureId
      && `${entry.at?.[0] ?? 0}/${entry.at?.[1] ?? 1}` === at
    );
    if (exact) {
      setProgressIndex(exact.index, true, highlight);
      return;
    }
  }
  setProgressIndex(slotToIndex(Number(input.dataset.row), Number(input.dataset.position)), true, highlight);
}

function highlightPlayhead(row, position) {
  const playback = ensureIndex();
  highlightEntry(playback.entries[nearestPlaybackIndex(playback, row, position, LEGACY_SLOTS_PER_BEAT)] || null);
}

function updatePlayButton(playing) {
  const button = document.getElementById('playButton');
  if (!button) return;
  button.textContent = playing ? '停止' : '播放';
  button.classList.toggle('is-playing', playing);
  button.setAttribute('aria-label', playing ? '停止播放 TAB 譜' : '播放 TAB 譜');
}

function playEntry(entry) {
  if (!entry) return;
  const audio = getAudioEngine();
  entry.notes.forEach(note => {
    if (!/^x$/i.test(String(note.fret))) audio?.playNote(Number(note.string), note.fret);
  });
  state.currentIndex = entry.index;
  const slider = document.getElementById('playProgress');
  if (slider) slider.value = String(entry.index);
  updateProgressLabel(entry.index);
  highlightEntry(entry);
}

async function startPlayback() {
  const audio = getAudioEngine();
  if (!audio || !await audio.ensureReady()) return;
  stopPlayback(false, true);
  const playback = ensureIndex({ force: true, reconcile: true });
  if (!playback.entries.length) {
    window.showToast?.('目前沒有可播放的音符');
    updateProgressRange();
    return;
  }

  const slider = document.getElementById('playProgress');
  state.currentIndex = clamp(Number(slider?.value) || state.currentIndex, 0, playback.entries.length - 1);
  state.playing = true;
  state.lastCenteredKey = null;
  updatePlayButton(true);

  if (state.currentIndex === 0) {
    const sheet = document.getElementById('editorView')?.querySelector('.sheet');
    if (sheet) sheet.scrollTop = 0;
  }

  const tempo = typeof window.getTempo === 'function' ? window.getTempo() : 120;
  const beatMs = 60000 / tempo;
  const first = playback.entries[state.currentIndex];
  const anchorBeat = first.absoluteBeat;
  const anchorTime = performance.now();

  const tick = index => {
    if (!state.playing) return;
    const entry = playback.entries[index];
    if (!entry) {
      stopPlayback();
      return;
    }
    playEntry(entry);
    const next = playback.entries[index + 1];
    if (!next) {
      const tailMs = Math.max(0.25, entry.durationBeats || 0.25) * beatMs;
      state.timer = window.setTimeout(() => stopPlayback(true, false), tailMs);
      return;
    }
    const targetTime = anchorTime + (next.absoluteBeat - anchorBeat) * beatMs;
    state.timer = window.setTimeout(() => tick(index + 1), Math.max(0, targetTime - performance.now()));
  };

  tick(state.currentIndex);
}

function stopPlayback(resetButton = true, stopVoices = true) {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.playing = false;
  state.lastCenteredKey = null;
  clearPlayhead();
  if (stopVoices) getAudioEngine()?.stopAll();
  if (resetButton) updatePlayButton(false);
}

function invalidatePlaybackIndex() {
  state.dirty = true;
  rowInputCache.clear();
}

function installPlayButton() {
  const button = document.getElementById('playButton');
  if (!button) return;
  button.addEventListener('click', event => {
    event.preventDefault();
    if (state.playing) stopPlayback();
    else void startPlayback();
  });
}

export function installPlaybackController() {
  if (typeof window === 'undefined') return null;
  if (installed) return window.editorPlayback || null;
  installed = true;

  Object.assign(window, {
    totalSlots,
    slotToIndex,
    indexToSlot,
    updateProgressRange,
    updateProgressLabel,
    jumpToInput,
    setProgressIndex,
    getInputsAt,
    getFilledInputsAt,
    highlightPlayhead,
    clearPlayhead,
    startPlayback,
    stopPlayback,
    invalidateRowPlaybackLayout: invalidatePlaybackIndex
  });

  const api = {
    rebuild: () => ensureIndex({ force: true, reconcile: true }),
    invalidate: invalidatePlaybackIndex,
    start: startPlayback,
    stop: stopPlayback,
    getIndex: () => state.currentIndex,
    getPlaybackIndex: () => ensureIndex(),
    get isPlaying() { return state.playing; }
  };
  window.editorPlayback = api;

  installPlayButton();
  const tabArea = document.getElementById('tabArea');
  tabArea?.addEventListener('input', invalidatePlaybackIndex, true);
  if (tabArea && typeof MutationObserver === 'function') {
    new MutationObserver(() => rowInputCache.clear()).observe(tabArea, { childList: true, subtree: true });
  }
  updateProgressRange();
  return api;
}
