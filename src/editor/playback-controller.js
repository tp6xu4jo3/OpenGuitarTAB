import { getAudioEngine } from './audio-engine.js';
import { ensureSongDocumentV3 } from './migrate-v2.js';
import { buildPlaybackIndex } from './playback-index.js';

let installed = false;
const state = {
  playing: false,
  timer: null,
  currentIndex: 0,
  playbackIndex: null,
  document: null,
  dirty: true,
  currentNodes: [],
  currentColumn: null,
  lastCenteredKey: null
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function currentSongSafe() {
  return typeof window.currentSong === 'function' ? window.currentSong() : null;
}

function currentDocument() {
  const storeDocument = window.editorV3?.getStore?.()?.getDocument?.();
  if (storeDocument) return storeDocument;
  const song = currentSongSafe();
  return song ? ensureSongDocumentV3(song) : null;
}

function ensureIndex({ force = false } = {}) {
  const documentModel = currentDocument();
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

function clearPlayhead() {
  state.currentNodes.forEach(node => node.classList?.remove('is-playing'));
  state.currentNodes = [];
  state.currentColumn?.classList?.remove('is-playing-column');
  state.currentColumn = null;
  document.querySelectorAll('.playhead-column').forEach(node => node.remove());
}

function followPlaybackLine(node, key) {
  if (!node || key === state.lastCenteredKey) return;
  const sheet = node.closest('.sheet');
  if (!sheet || sheet.clientHeight <= 0) return;
  const sheetRect = sheet.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const nodeCenter = nodeRect.top + nodeRect.height / 2;
  const centerInContent = sheet.scrollTop + (nodeCenter - sheetRect.top);
  const maxScrollTop = Math.max(0, sheet.scrollHeight - sheet.clientHeight);
  if (nodeRect.top < sheetRect.top || nodeRect.bottom > sheetRect.bottom) {
    sheet.scrollTo({ top: clamp(centerInContent - sheet.clientHeight / 2, 0, maxScrollTop), behavior: 'smooth' });
  }
  state.lastCenteredKey = key;
}

function entryColumn(entry) {
  const eventId = CSS.escape(String(entry.eventId || ''));
  const byEvent = document.querySelector(`.v3-column-target[data-event-id="${eventId}"]`);
  if (byEvent) return byEvent;
  const measureId = CSS.escape(String(entry.measureId || ''));
  const at = CSS.escape(`${entry.at?.[0] ?? 0}/${entry.at?.[1] ?? 1}`);
  return document.querySelector(`.v3-column-target[data-measure-id="${measureId}"][data-at="${at}"]`);
}

function highlightEntry(entry) {
  clearPlayhead();
  if (!entry) return;
  const eventNode = document.querySelector(`.v3-event[data-event-id="${CSS.escape(String(entry.eventId))}"]`);
  state.currentNodes = eventNode ? [...eventNode.querySelectorAll('.v3-note')] : [];
  state.currentNodes.forEach(node => node.classList.add('is-playing'));
  const column = entryColumn(entry);
  if (column) {
    column.classList.add('is-playing-column');
    state.currentColumn = column;
  }
  followPlaybackLine(eventNode?.closest('.tab-system') || column?.closest('.tab-system') || eventNode || column, `event:${entry.eventId}`);
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
  const column = entryColumn(entry);
  const system = column?.closest?.('.tab-system');
  const visualRow = Number(system?.dataset.visualRow);
  const grid = column?.closest?.('.v3-grid');
  const ids = String(grid?.dataset.measureIds || '').split(',').filter(Boolean);
  const localMeasure = ids.indexOf(String(entry.measureId));
  return {
    rowIndex: Number.isInteger(visualRow) ? visualRow : entry.rowIndex,
    measureIndex: localMeasure >= 0 ? localMeasure : entry.measureIndexInSystem
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

function jumpToTarget(target, highlight = true) {
  if (!target) return;
  const measureId = String(target.dataset?.measureId || '');
  const at = String(target.dataset?.at || '');
  if (!measureId || !at) return;
  const playback = ensureIndex();
  const exact = playback.entries.find(entry =>
    String(entry.measureId) === measureId && `${entry.at?.[0] ?? 0}/${entry.at?.[1] ?? 1}` === at
  );
  if (exact) setProgressIndex(exact.index, true, highlight);
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
  const playback = ensureIndex({ force: true });
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
      state.timer = window.setTimeout(() => stopPlayback(true, false), Math.max(0.25, entry.durationBeats || 0.25) * beatMs);
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
}

export function installPlaybackController() {
  if (typeof window === 'undefined') return null;
  if (installed) return window.editorPlayback || null;
  installed = true;
  Object.assign(window, {
    totalSlots,
    updateProgressRange,
    updateProgressLabel,
    jumpToInput: jumpToTarget,
    setProgressIndex,
    clearPlayhead,
    startPlayback,
    stopPlayback,
    invalidateRowPlaybackLayout: invalidatePlaybackIndex
  });
  const api = {
    rebuild: () => ensureIndex({ force: true }),
    invalidate: invalidatePlaybackIndex,
    start: startPlayback,
    stop: stopPlayback,
    getIndex: () => state.currentIndex,
    setIndex: (index, { updateSlider = true, highlight = true } = {}) => setProgressIndex(index, updateSlider, highlight),
    getPlaybackIndex: () => ensureIndex(),
    get isPlaying() { return state.playing; }
  };
  window.editorPlayback = api;
  document.getElementById('playButton')?.addEventListener('click', event => {
    event.preventDefault();
    if (state.playing) stopPlayback();
    else void startPlayback();
  });
  updateProgressRange();
  return api;
}
