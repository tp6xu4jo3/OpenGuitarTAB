import { getAudioEngine } from './audio-engine.js';
import { ensureSongDocumentV3 } from './migrate-v2.js';
import { buildPlaybackIndex } from './playback-index.js';

let installed = false;
const state = {
  playing: false,
  timer: null,
  eventTimers: [],
  currentIndex: 0,
  startOffsetBeats: 0,
  playbackIndex: null,
  document: null,
  dirty: true,
  beatBar: null,
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
  state.beatBar?.remove?.();
  state.beatBar = null;
}

function clearEventTimers() {
  state.eventTimers.forEach(timer => clearTimeout(timer));
  state.eventTimers = [];
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

function measureNodeForEntry(entry) {
  if (!entry?.measureId) return null;
  return document.querySelector(`.v3-measure[data-measure-id="${CSS.escape(String(entry.measureId))}"]`);
}

function entryColumn(entry) {
  if (!entry?.measureId) return null;
  const measureId = CSS.escape(String(entry.measureId));
  const at = CSS.escape(`${entry.at?.[0] ?? 0}/${entry.at?.[1] ?? 1}`);
  return document.querySelector(`.v3-column-target[data-measure-id="${measureId}"][data-at="${at}"]`);
}

function highlightEntry(entry) {
  clearPlayhead();
  if (!entry) return;
  const measureNode = measureNodeForEntry(entry);
  const staff = measureNode?.querySelector('.v3-staff');
  if (!staff) return;
  const duration = Math.max(0.001, Number(entry.measureDurationBeats) || 1);
  const left = clamp(Number(entry.atBeats) || 0, 0, duration) / duration * 100;
  const width = clamp(Number(entry.durationBeats) || 1, 0, duration) / duration * 100;
  const bar = document.createElement('div');
  bar.className = 'v3-playback-beat';
  bar.style.left = `${left}%`;
  bar.style.width = `${width}%`;
  staff.appendChild(bar);
  state.beatBar = bar;
  followPlaybackLine(measureNode.closest('.tab-system') || measureNode, `beat:${entry.measureId}:${entry.atBeats}`);
}

function entryForIndex(index) {
  const playback = ensureIndex();
  if (!playback.entries.length) return null;
  return playback.entries[clamp(Number(index) || 0, 0, playback.entries.length - 1)] || null;
}

function formatBeat(entry) {
  return String(Math.floor(Number(entry?.atBeats) || 0) + 1);
}

function visualLocationForEntry(entry) {
  const column = entryColumn(entry);
  const system = column?.closest?.('.tab-system') || measureNodeForEntry(entry)?.closest?.('.tab-system');
  const visualRow = Number(system?.dataset.visualRow);
  const grid = column?.closest?.('.v3-grid') || measureNodeForEntry(entry)?.closest?.('.v3-grid');
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
    label.textContent = '尚無曲譜';
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
  state.startOffsetBeats = 0;
  const slider = document.getElementById('playProgress');
  if (slider && updateSlider) slider.value = String(state.currentIndex);
  updateProgressLabel(state.currentIndex);
  if (highlight) highlightEntry(playback.entries[state.currentIndex] || null);
}

function updateProgressRange() {
  const playback = ensureIndex();
  const slider = document.getElementById('playProgress');
  if (slider) {
    slider.min = '0';
    slider.max = String(Math.max(0, playback.entries.length - 1));
    slider.step = '1';
  }
  state.currentIndex = clamp(state.currentIndex, 0, Math.max(0, playback.entries.length - 1));
  setProgressIndex(state.currentIndex, true, false);
}

function fractionNumber(value) {
  const [numerator, denominator] = String(value || '').split('/').map(Number);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator ? numerator / denominator : null;
}

function jumpToTarget(target, highlight = true) {
  if (!target) return;
  const measureId = String(target.dataset?.measureId || '');
  const targetBeat = fractionNumber(target.dataset?.at);
  if (!measureId || targetBeat == null) return;
  const playback = ensureIndex();
  const entry = playback.entries.find(item => {
    if (String(item.measureId) !== measureId) return false;
    const start = Number(item.atBeats) || 0;
    const end = start + Math.max(0.001, Number(item.durationBeats) || 1);
    return targetBeat >= start - 1e-9 && targetBeat < end - 1e-9;
  });
  if (!entry) return;
  setProgressIndex(entry.index, true, highlight);
  state.startOffsetBeats = clamp(targetBeat - entry.atBeats, 0, Math.max(0, entry.durationBeats - 0.001));
}

function updatePlayButton(playing) {
  const button = document.getElementById('playButton');
  if (!button) return;
  button.textContent = playing ? '停止' : '播放';
  button.classList.toggle('is-playing', playing);
  button.setAttribute('aria-label', playing ? '停止播放 TAB 譜' : '播放 TAB 譜');
}

function playNotes(notes) {
  const audio = getAudioEngine();
  (notes || []).forEach(note => {
    if (!/^x$/i.test(String(note.fret))) audio?.playNote(Number(note.string), note.fret);
  });
}

function playBeat(entry, beatMs, fromOffset = 0) {
  if (!entry) return;
  clearEventTimers();
  state.currentIndex = entry.index;
  const slider = document.getElementById('playProgress');
  if (slider) slider.value = String(entry.index);
  updateProgressLabel(entry.index);
  highlightEntry(entry);
  (entry.events || []).forEach(event => {
    if (event.offsetBeats < fromOffset - 1e-9) return;
    const delay = Math.max(0, (event.offsetBeats - fromOffset) * beatMs);
    if (delay <= 2) playNotes(event.notes);
    else state.eventTimers.push(window.setTimeout(() => playNotes(event.notes), delay));
  });
}

async function startPlayback() {
  const audio = getAudioEngine();
  if (!audio || !await audio.ensureReady()) return;
  stopPlayback(false, true, false);
  const playback = ensureIndex();
  if (!playback.entries.length) {
    window.showToast?.('目前沒有可播放的拍子');
    updateProgressRange();
    return;
  }
  const slider = document.getElementById('playProgress');
  const sliderIndex = Number(slider?.value);
  if (Number.isFinite(sliderIndex)) state.currentIndex = clamp(sliderIndex, 0, playback.entries.length - 1);
  state.playing = true;
  state.lastCenteredKey = null;
  updatePlayButton(true);
  if (state.currentIndex === 0 && state.startOffsetBeats === 0) {
    const sheet = document.getElementById('editorView')?.querySelector('.sheet');
    if (sheet) sheet.scrollTop = 0;
  }
  const tempo = typeof window.getTempo === 'function' ? window.getTempo() : 120;
  const beatMs = 60000 / tempo;
  const firstIndex = state.currentIndex;
  const firstOffset = state.startOffsetBeats;
  state.startOffsetBeats = 0;

  const tick = index => {
    if (!state.playing) return;
    const entry = playback.entries[index];
    if (!entry) {
      stopPlayback();
      return;
    }
    const fromOffset = index === firstIndex ? firstOffset : 0;
    playBeat(entry, beatMs, fromOffset);
    const remaining = Math.max(0.001, (Number(entry.durationBeats) || 1) - fromOffset);
    state.timer = window.setTimeout(() => {
      if (index + 1 >= playback.entries.length) stopPlayback(true, false);
      else tick(index + 1);
    }, remaining * beatMs);
  };
  tick(firstIndex);
}

function stopPlayback(resetButton = true, stopVoices = true, clearOffset = true) {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  clearEventTimers();
  state.playing = false;
  state.lastCenteredKey = null;
  clearPlayhead();
  if (clearOffset) state.startOffsetBeats = 0;
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
