import { getAudioEngine } from './audio-engine.js';
import { ensureSongDocumentV3 } from './migrate-v2.js';
import { playbackNoteSchedule } from './playback-articulation.js';
import { buildPlaybackIndex } from './playback-index.js';
import { readMidiTracks, melodyFromMidiTrack, resolveMidiBeatScale, validateMidiBeatScale } from './melody-midi.js';

const MUSIC_ENABLED_KEY = 'openguitartab:playback-music';
const METRONOME_ENABLED_KEY = 'openguitartab:playback-metronome';

let installed = false;
const state = {
  playing: false,
  preparing: false,
  timer: null,
  eventTimers: [],
  nextStringDelayMs: new Map(),
  currentIndex: 0,
  startOffsetBeats: 0,
  playbackIndex: null,
  document: null,
  dirty: true,
  timelineDirty: true,
  beatBar: null,
  lastCenteredKey: null,
  musicEnabled: true,
  metronomeEnabled: false,
  melodyEnabled: false,
  melodySongId: null,
  melodyTimer: null,
  melodyCursor: 0,
  playbackClock: null
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function storedBoolean(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    if (value === 'true') return true;
    if (value === 'false') return false;
  } catch {}
  return fallback;
}

function persistBoolean(key, value) {
  try { localStorage.setItem(key, String(Boolean(value))); } catch {}
}

function syncProgressRangeFromIndex(playback) {
  const entries = playback?.entries || [];
  state.currentIndex = clamp(state.currentIndex, 0, Math.max(0, entries.length - 1));
  const slider = document.getElementById('playProgress');
  if (!slider) return;
  slider.min = '0';
  slider.max = String(Math.max(0, entries.length - 1));
  slider.step = '1';
  slider.value = String(state.currentIndex);
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
    state.timelineDirty = false;
    syncProgressRangeFromIndex(state.playbackIndex);
    return state.playbackIndex;
  }
  if (!force && !state.dirty && state.document === documentModel && state.playbackIndex) return state.playbackIndex;
  state.playbackIndex = buildPlaybackIndex(documentModel);
  state.document = documentModel;
  state.dirty = false;
  state.timelineDirty = false;
  state.currentIndex = clamp(state.currentIndex, 0, Math.max(0, state.playbackIndex.entries.length - 1));
  syncProgressRangeFromIndex(state.playbackIndex);
  return state.playbackIndex;
}

function navigationPlaybackIndex() {
  if (state.playbackIndex && !state.timelineDirty) return state.playbackIndex;
  return ensureIndex();
}

function clearPlayhead() {
  state.beatBar?.remove?.();
  state.beatBar = null;
}

function clearEventTimers() {
  state.eventTimers.forEach(timer => clearTimeout(timer));
  state.eventTimers = [];
}

function hasLaterVisualRow(visualRow) {
  const selector = visualRow?.classList?.contains('score-density-line') ? '.score-density-line' : '.tab-system';
  for (let sibling = visualRow?.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
    if (sibling.matches?.(selector)) return true;
  }
  return false;
}

function followPlaybackLine(node) {
  if (!node) return;
  const visualRow = node.closest?.('.score-density-line') || node.closest?.('.tab-system') || node;
  const rowIndex = Number(visualRow?.dataset?.visualRow ?? visualRow?.dataset?.scoreLine);
  if (!Number.isInteger(rowIndex) || rowIndex < 0) return;
  const key = `row:${rowIndex}`;
  if (key === state.lastCenteredKey) return;
  state.lastCenteredKey = key;
  if (rowIndex === 0 || !hasLaterVisualRow(visualRow)) return;
  const sheet = visualRow.closest('.sheet');
  if (!sheet || sheet.clientHeight <= 0) return;
  const sheetRect = sheet.getBoundingClientRect();
  const rowRect = visualRow.getBoundingClientRect();
  const rowCenter = rowRect.top + rowRect.height / 2;
  const centerInContent = sheet.scrollTop + (rowCenter - sheetRect.top);
  const maxScrollTop = Math.max(0, sheet.scrollHeight - sheet.clientHeight);
  sheet.scrollTo({ top: clamp(centerInContent - sheet.clientHeight / 2, 0, maxScrollTop), behavior: 'smooth' });
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
  const column = entryColumn(entry);
  const measureNode = measureNodeForEntry(entry);
  const staff = column?.closest('.v3-staff') || measureNode?.querySelector('.v3-staff');
  if (!staff) return;
  const bar = document.createElement('div');
  bar.className = 'v3-playback-beat';
  if (column) {
    bar.style.left = column.style.left || '0%';
    bar.style.width = column.style.width || '0%';
  } else {
    const duration = Math.max(0.001, Number(entry.measureDurationBeats) || 1);
    const left = clamp(Number(entry.atBeats) || 0, 0, duration) / duration * 100;
    const width = clamp(Number(entry.durationBeats) || 0.25, 0, duration) / duration * 100;
    bar.style.left = `${left}%`;
    bar.style.width = `${width}%`;
  }
  staff.appendChild(bar);
  state.beatBar = bar;
  followPlaybackLine(measureNode?.closest('.tab-system') || measureNode);
}

function entryForIndex(index, playback = null) {
  const source = playback || ensureIndex();
  if (!source.entries.length) return null;
  return source.entries[clamp(Number(index) || 0, 0, source.entries.length - 1)] || null;
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

function updateProgressLabel(index, playback = null) {
  const label = document.getElementById('progressLabel');
  if (!label) return;
  const entry = entryForIndex(index, playback);
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

function applyProgressIndex(playback, index, updateSlider = true, highlight = true) {
  state.currentIndex = clamp(Number(index) || 0, 0, Math.max(0, playback.entries.length - 1));
  state.startOffsetBeats = 0;
  const slider = document.getElementById('playProgress');
  if (slider && updateSlider) slider.value = String(state.currentIndex);
  updateProgressLabel(state.currentIndex, playback);
  if (highlight) highlightEntry(playback.entries[state.currentIndex] || null);
}

function setProgressIndex(index, updateSlider = true, highlight = true) {
  applyProgressIndex(ensureIndex(), index, updateSlider, highlight);
  syncSoundControls();
}

function updateProgressRange() {
  syncSoundControls();
  const playback = ensureIndex();
  syncProgressRangeFromIndex(playback);
  applyProgressIndex(playback, state.currentIndex, true, false);
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
  const playback = navigationPlaybackIndex();
  const exact = playback.entries.find(item => String(item.measureId) === measureId && Math.abs((Number(item.atBeats) || 0) - targetBeat) < 1e-9);
  const entry = exact || playback.entries.find(item => {
    if (String(item.measureId) !== measureId) return false;
    const start = Number(item.atBeats) || 0;
    const end = start + Math.max(0.001, Number(item.durationBeats) || 0.25);
    return targetBeat >= start - 1e-9 && targetBeat < end - 1e-9;
  });
  if (!entry) return;
  applyProgressIndex(playback, entry.index, true, highlight);
  state.startOffsetBeats = exact ? 0 : clamp(targetBeat - entry.atBeats, 0, Math.max(0, entry.durationBeats - 0.001));
}

function updatePlayButton() {
  const button = document.getElementById('playButton');
  if (!button) return;
  button.classList.toggle('is-playing', state.playing);
  button.classList.toggle('is-busy', state.preparing);
  button.disabled = state.preparing;
  if (state.preparing) {
    const spinner = document.createElement('span');
    spinner.className = 'button-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = '準備中';
    button.replaceChildren(spinner, text);
    button.setAttribute('aria-label', '正在準備播放 TAB 譜');
    return;
  }
  button.textContent = state.playing ? '停止' : '播放';
  button.setAttribute('aria-label', state.playing ? '停止播放 TAB 譜' : '播放 TAB 譜');
}

function soundControlButton(kind, label, enabled) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'playback-sound-toggle';
  button.dataset.playbackSound = kind;
  button.setAttribute('aria-pressed', String(enabled));
  button.setAttribute('aria-label', `${label}${enabled ? '已開啟' : '已靜音'}`);
  const text = document.createElement('span');
  text.className = 'playback-sound-label';
  text.textContent = label;
  const indicator = document.createElement('span');
  indicator.className = 'playback-sound-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  button.append(text, indicator);
  return button;
}

function currentIsChordScore() {
  return currentSongSafe()?.playStyle === 'chord';
}

function hasMelody(song = currentSongSafe()) {
  return Array.isArray(song?.melody?.notes) && song.melody.notes.length > 0;
}

async function importMelodyMidi(file) {
  const song = currentSongSafe();
  if (!song || song.playStyle !== 'chord' || document.getElementById('saveSongButton')?.hidden) return;
  if (state.playing || state.preparing) {
    window.showToast?.('請先停止播放，再匯入旋律');
    return;
  }
  try {
    const tracks = readMidiTracks(await file.arrayBuffer());
    if (!tracks.length) throw new Error('MIDI內沒有旋律音符');
    if (tracks.some(track => track.tempoStatus === 'variable')) {
      throw new Error('MIDI內含變速，請先匯出固定 BPM 的主旋律 MIDI');
    }
    const channels = tracks.flatMap(track => track.channels.map(channel => ({
      label: `${track.name} · MIDI通道${channel + 1}`,
      notes: track.notes.filter(note => note.channel === channel),
      midiBpm: track.midiBpm
    }))).filter(item => item.notes.length);
    let selection = channels[0];
    if (channels.length > 1) {
      const choices = channels.map((item, index) => `${index + 1}. ${item.label}（${item.notes.length}音）`).join('\n');
      const selected = window.prompt(`請選擇主旋律軌道／通道編號：\n${choices}`, '1');
      if (selected === null) return;
      const index = Number(selected) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= channels.length) throw new Error('請選擇有效的旋律軌道');
      selection = channels[index];
    }
    const scoreBpm = typeof window.getTempo === 'function' ? window.getTempo() : Number(song.tempo);
    const inferred = resolveMidiBeatScale({
      markedScale: song.midiBeatScale,
      midiBpm: selection.midiBpm,
      scoreBpm
    });
    let beatScale = inferred.scale;
    if (beatScale === null) {
      const choice = window.prompt(
        `無法確定MIDI與曲譜的拍點比例（MIDI ${selection.midiBpm ?? '?'} BPM／曲譜 ${scoreBpm} BPM）。請輸入MIDI每拍對應的曲譜拍數：0.5、1或2`,
        '1'
      );
      if (choice === null) return;
      beatScale = validateMidiBeatScale(choice.trim());
      if (beatScale === undefined) throw new Error('請選擇有效的節奏比例');
    }
    const melody = melodyFromMidiTrack(selection, file.name, beatScale);
    const originalMelody = song.melody;
    const originalBeatScale = song.midiBeatScale;
    song.melody = melody;
    song.midiBeatScale = beatScale;
    try {
      if (typeof window.persistSong !== 'function') throw new Error('目前無法儲存旋律');
      await window.persistSong(song);
    } catch (error) {
      song.melody = originalMelody;
      if (originalBeatScale === undefined) delete song.midiBeatScale;
      else song.midiBeatScale = originalBeatScale;
      throw error;
    }
    state.melodyEnabled = false;
    syncSoundControls(true);
    const resolution = inferred.reason === 'auto' ? '自動辨識' : inferred.reason === 'marked' ? '沿用JSON標記' : '手動選擇';
    window.showToast?.(`已匯入 ${melody.notes.length} 個旋律音符（${resolution}，拍數×${beatScale}）；播放旋律預設關閉`);
  } catch (error) {
    console.error('Melody MIDI import failed', error);
    window.showToast?.(error?.message || '旋律 MIDI 匯入失敗');
  }
}

function ensureSoundControls() {
  let controls = document.getElementById('playbackSoundControls');
  if (controls) return controls;
  const panel = document.querySelector('.play-panel');
  const progress = document.querySelector('.play-panel .progress-box');
  if (!panel || !progress) return null;
  controls = document.createElement('div');
  controls.id = 'playbackSoundControls';
  controls.className = 'playback-sound-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', '播放聲音');
  controls.addEventListener('click', event => {
    const importButton = event.target.closest?.('[data-melody-upload]');
    if (importButton) {
      event.preventDefault();
      controls.querySelector('#melodyMidiInput')?.click();
      return;
    }
    const button = event.target.closest?.('[data-playback-sound]');
    if (!button) return;
    event.preventDefault();
    const kind = button.dataset.playbackSound;
    if (kind === 'music') setMusicEnabled(!state.musicEnabled);
    if (kind === 'metronome') setMetronomeEnabled(!state.metronomeEnabled);
    if (kind === 'melody') setMelodyEnabled(!state.melodyEnabled);
  });
  controls.addEventListener('change', event => {
    if (event.target?.id !== 'melodyMidiInput') return;
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void importMelodyMidi(file);
  });
  progress.before(controls);
  return controls;
}

function syncSoundControls(force = false) {
  const controls = ensureSoundControls();
  if (!controls) return;
  const song = currentSongSafe();
  const songId = String(song?.arrangementId || song?.id || '');
  if (state.melodySongId !== songId) {
    if (state.melodySongId !== null && (state.playing || state.preparing)) stopPlayback();
    state.melodyEnabled = false;
    getAudioEngine()?.stopMelody();
    state.melodySongId = songId;
    force = true;
  }
  const chord = currentIsChordScore();
  const editable = chord && !document.getElementById('saveSongButton')?.hidden;
  const mode = chord ? (editable ? 'chord-edit' : 'chord-preview') : 'normal';
  if (force || controls.dataset.mode !== mode) {
    controls.dataset.mode = mode;
    const buttons = [];
    if (chord) {
      const melodyGroup = document.createElement('div');
      melodyGroup.className = 'playback-melody-group';
      melodyGroup.setAttribute('role', 'group');
      melodyGroup.setAttribute('aria-label', '旋律與 MIDI 匯入');
      if (editable) {
        const upload = document.createElement('button');
        upload.type = 'button';
        upload.className = 'playback-melody-upload';
        upload.dataset.melodyUpload = 'true';
        upload.textContent = '+';
        upload.title = hasMelody(song) ? '替換主旋律 MIDI' : '匯入主旋律 MIDI';
        upload.setAttribute('aria-label', upload.title);
        const input = document.createElement('input');
        input.id = 'melodyMidiInput';
        input.type = 'file';
        input.accept = '.mid,.midi,audio/midi,audio/x-midi';
        input.hidden = true;
        melodyGroup.append(upload, input);
      }
      melodyGroup.appendChild(soundControlButton('melody', '旋律', state.melodyEnabled));
      buttons.push(melodyGroup);
    }
    buttons.push(soundControlButton('music', '模擬', state.musicEnabled));
    buttons.push(soundControlButton('metronome', '節拍器', state.metronomeEnabled));
    controls.replaceChildren(...buttons);
  }
  controls.querySelectorAll('[data-playback-sound]').forEach(button => {
    const kind = button.dataset.playbackSound;
    const enabled = kind === 'music' ? state.musicEnabled : kind === 'metronome' ? state.metronomeEnabled : state.melodyEnabled;
    const label = kind === 'music' ? '模擬' : kind === 'metronome' ? '節拍器' : '旋律';
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', `${label}${enabled ? '已開啟' : '已靜音'}`);
    if (kind === 'melody') button.title = hasMelody(song) ? '播放匯入的旋律 MIDI' : '尚未匯入旋律 MIDI';
  });
}

function setMelodyEnabled(enabled) {
  if (enabled && !hasMelody()) {
    window.showToast?.('請先用＋MIDI匯入旋律');
    return false;
  }
  state.melodyEnabled = Boolean(enabled && currentIsChordScore());
  if (!state.melodyEnabled) {
    getAudioEngine()?.stopMelody();
    stopMelodyScheduler();
  } else if (state.playing) {
    const audio = getAudioEngine();
    void audio?.ensureMelodyReady().then(ready => {
      if (!ready || !state.playing || !state.melodyEnabled) return;
      const clock = state.playbackClock;
      if (clock && !clock.audioClockActive) {
        clock.audioStartTime = audio.context.currentTime - (performance.now() - clock.wallStart) / 1000;
        clock.audioClockActive = true;
      }
      startMelodyScheduler();
    });
  }
  syncSoundControls();
  return state.melodyEnabled;
}

function setMusicEnabled(enabled) {
  state.musicEnabled = Boolean(enabled);
  persistBoolean(MUSIC_ENABLED_KEY, state.musicEnabled);
  if (!state.musicEnabled) getAudioEngine()?.stopAll();
  if (state.musicEnabled && state.playing) void getAudioEngine()?.ensureReady();
  syncSoundControls();
  return state.musicEnabled;
}

function setMetronomeEnabled(enabled) {
  state.metronomeEnabled = Boolean(enabled);
  persistBoolean(METRONOME_ENABLED_KEY, state.metronomeEnabled);
  if (state.metronomeEnabled && state.playing) void getAudioEngine()?.ensureReady();
  syncSoundControls();
  return state.metronomeEnabled;
}

function stopMelodyScheduler() {
  if (state.melodyTimer !== null) {
    clearInterval(state.melodyTimer);
    state.melodyTimer = null;
  }
}

function startMelodyScheduler() {
  stopMelodyScheduler();
  const clock = state.playbackClock;
  const audio = getAudioEngine();
  const notes = currentSongSafe()?.melody?.notes;
  if (!state.playing || !state.melodyEnabled || !clock || !audio?.context || !Array.isArray(notes)) return;
  const offset = clock.startBeat;
  const secondsPerBeat = clock.secondsPerBeat;
  const currentBeat = offset + Math.max(0, audio.context.currentTime - clock.audioStartTime) / secondsPerBeat;
  state.melodyCursor = notes.findIndex(note => Number(note.beat) >= currentBeat - 0.01);
  if (state.melodyCursor < 0) return;
  const schedule = () => {
    if (!state.playing || !state.melodyEnabled || state.playbackClock !== clock) return;
    const currentTime = audio.context.currentTime;
    const horizon = currentTime + 0.28;
    while (state.melodyCursor < notes.length) {
      const note = notes[state.melodyCursor];
      const noteTime = clock.audioStartTime + (Number(note.beat) - offset) * secondsPerBeat;
      if (noteTime > horizon) break;
      state.melodyCursor += 1;
      if (noteTime + 0.01 < currentTime) continue;
      if (Number(note.beat) >= clock.endBeat) continue;
      audio.scheduleMelodyNote(note, noteTime, secondsPerBeat);
    }
    if (state.melodyCursor >= notes.length) stopMelodyScheduler();
  };
  schedule();
  if (state.melodyCursor < notes.length) state.melodyTimer = window.setInterval(schedule, 45);
}

function buildNextStringDelayMap(playback, beatMs) {
  const delays = new Map();
  const notesByString = new Map();
  for (const entry of playback?.entries || []) {
    for (const event of entry.events || []) {
      const eventBaseMs = (Number(entry.absoluteBeat) + Number(event.offsetBeats || 0)) * beatMs;
      for (const { note, delayMs } of playbackNoteSchedule(event, beatMs)) {
        if (!note || /^x$/i.test(String(note.fret))) continue;
        const string = Number(note.string);
        const noteId = String(note.id || '');
        if (!Number.isInteger(string) || !noteId) continue;
        const attackMs = eventBaseMs + Math.max(0, Number(delayMs) || 0);
        const pureSlideArrival = Boolean(note.slideArrivalRelationId && !note.slide?.relationId);
        const continuation = pureSlideArrival || Boolean(note.arcArrivalRelationId);
        const items = notesByString.get(string) || [];
        items.push({ noteId, attackMs, continuation });
        notesByString.set(string, items);
      }
    }
  }

  for (const items of notesByString.values()) {
    for (let index = 0; index < items.length; index += 1) {
      const current = items[index];
      const nextAttack = items.slice(index + 1).find(item => !item.continuation);
      if (nextAttack) delays.set(current.noteId, Math.max(0, nextAttack.attackMs - current.attackMs));
    }
  }
  return delays;
}

function playNote(note, beatMs) {
  if (!state.musicEnabled || !note || /^x$/i.test(String(note.fret))) return;
  const audio = getAudioEngine();
  if (!audio) return;
  const string = Number(note.string);
  const slide = note.slide || null;
  const arc = note.arcSustain || null;
  if (note.arcArrivalRelationId && audio.hasActiveArc(note.arcArrivalRelationId)) {
    if (arc?.relationId) audio.continueArc(note.arcArrivalRelationId, arc.relationId);
    return;
  }
  const hasOutgoingSlide = Boolean(slide?.relationId && slide?.toFret != null);
  if (note.slideArrivalRelationId && !hasOutgoingSlide && audio.hasActiveSlide(string, note.slideArrivalRelationId)) return;
  const harmonic = (note.techniques || []).some(technique => technique?.type === 'harmonic');
  audio.playNote(string, note.fret, {
    harmonic,
    slideToFret: slide?.toFret ?? null,
    slideSeconds: slide ? Math.max(0.015, Number(slide.durationBeats || 0) * beatMs / 1000) : 0,
    slideRelationId: slide?.relationId || '',
    arcRelationId: arc?.relationId || '',
    nextSameStringSeconds: (state.nextStringDelayMs.get(String(note.id || '')) ?? Number.NaN) / 1000,
    dampPrevious: false
  });
}

function playEvent(event, beatMs) {
  if (!state.musicEnabled) return;
  playbackNoteSchedule(event, beatMs).forEach(({ note, delayMs }) => {
    if (delayMs <= 2) playNote(note, beatMs);
    else state.eventTimers.push(window.setTimeout(() => playNote(note, beatMs), delayMs));
  });
}

function playMetronome(entry, fromOffset) {
  if (!state.metronomeEnabled || fromOffset > 1e-9) return;
  const absoluteBeat = Number(entry?.absoluteBeat);
  if (!Number.isFinite(absoluteBeat) || Math.abs(absoluteBeat - Math.round(absoluteBeat)) > 1e-9) return;
  const accent = Math.abs(Number(entry?.atBeats) || 0) < 1e-9;
  getAudioEngine()?.playMetronomeClick({ accent });
}

function playBeat(entry, beatMs, fromOffset = 0) {
  if (!entry) return;
  clearEventTimers();
  state.currentIndex = entry.index;
  const slider = document.getElementById('playProgress');
  if (slider) slider.value = String(entry.index);
  updateProgressLabel(entry.index, state.playbackIndex);
  highlightEntry(entry);
  playMetronome(entry, fromOffset);
  (entry.events || []).forEach(event => {
    if (event.offsetBeats < fromOffset - 1e-9) return;
    const delay = Math.max(0, (event.offsetBeats - fromOffset) * beatMs);
    if (delay <= 2) playEvent(event, beatMs);
    else state.eventTimers.push(window.setTimeout(() => playEvent(event, beatMs), delay));
  });
}

async function startPlayback() {
  if (state.playing || state.preparing) return;
  stopPlayback(false, true, false);
  state.preparing = true;
  updatePlayButton();
  try {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const audio = getAudioEngine();
    syncSoundControls();
    const needsMelody = state.melodyEnabled && currentIsChordScore() && hasMelody();
    const needsAudio = state.musicEnabled || state.metronomeEnabled || needsMelody;
    if (needsAudio && (!audio || !(state.musicEnabled ? await audio.ensureReady() : await audio.ensureMelodyReady()))) return;
    if (!state.preparing) return;

    const playback = ensureIndex();
    if (!playback.entries.length) {
      window.showToast?.('目前沒有可播放的拍子');
      updateProgressRange();
      return;
    }
    const slider = document.getElementById('playProgress');
    const sliderIndex = Number(slider?.value);
    if (Number.isFinite(sliderIndex)) state.currentIndex = clamp(sliderIndex, 0, playback.entries.length - 1);
    state.preparing = false;
    state.playing = true;
    state.lastCenteredKey = null;
    updatePlayButton();
    if (state.currentIndex === 0 && state.startOffsetBeats === 0) {
      const sheet = document.getElementById('editorView')?.querySelector('.sheet');
      if (sheet) sheet.scrollTop = 0;
    }
    const tempo = typeof window.getTempo === 'function' ? window.getTempo() : 120;
    const beatMs = 60000 / tempo;
    state.nextStringDelayMs = buildNextStringDelayMap(playback, beatMs);
    const firstIndex = state.currentIndex;
    const firstOffset = state.startOffsetBeats;
    state.startOffsetBeats = 0;

    // Simulation, MIDI melody and metronome share the same absolute playback origin.
    // Each visual tick is based on the origin, not accumulated setTimeout delays.
    const startBeat = Number(playback.entries[firstIndex].absoluteBeat) + firstOffset;
    const leadMs = needsAudio ? 70 : 0;
    const wallStart = performance.now() + leadMs;
    state.playbackClock = {
      startBeat,
      endBeat: playback.totalBeats,
      secondsPerBeat: beatMs / 1000,
      wallStart,
      audioClockActive: needsAudio,
      audioStartTime: (audio?.context?.currentTime || 0) + leadMs / 1000
    };
    if (needsMelody) startMelodyScheduler();

    const tick = index => {
      if (!state.playing) return;
      const entry = playback.entries[index];
      if (!entry) { stopPlayback(); return; }
      const fromOffset = index === firstIndex ? firstOffset : 0;
      playBeat(entry, beatMs, fromOffset);
      if (index + 1 >= playback.entries.length) {
        const endAt = wallStart + (playback.totalBeats - startBeat) * beatMs;
        state.timer = window.setTimeout(() => stopPlayback(true, false), Math.max(0, endAt - performance.now()));
        return;
      }
      const nextBeat = Number(playback.entries[index + 1].absoluteBeat);
      const nextAt = wallStart + (nextBeat - startBeat) * beatMs;
      state.timer = window.setTimeout(() => tick(index + 1), Math.max(0, nextAt - performance.now()));
    };
    state.timer = window.setTimeout(() => tick(firstIndex), leadMs);
  } catch (error) {
    console.error('Playback preparation failed.', error);
    window.showToast?.('播放準備失敗，請再試一次');
  } finally {
    if (!state.playing) {
      state.preparing = false;
      updatePlayButton();
    }
  }
}

function stopPlayback(resetButton = true, stopVoices = true, clearOffset = true) {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  clearEventTimers();
  stopMelodyScheduler();
  getAudioEngine()?.stopMelody();
  state.playbackClock = null;
  state.preparing = false;
  state.playing = false;
  state.lastCenteredKey = null;
  clearPlayhead();
  if (clearOffset) state.startOffsetBeats = 0;
  if (stopVoices) getAudioEngine()?.stopAll();
  if (resetButton) updatePlayButton();
}

function invalidatePlaybackIndex({ timeline = false } = {}) {
  state.dirty = true;
  state.timelineDirty ||= Boolean(timeline);
}

export function installPlaybackController() {
  if (typeof window === 'undefined') return null;
  if (installed) return window.editorPlayback || null;
  installed = true;
  state.musicEnabled = storedBoolean(MUSIC_ENABLED_KEY, true);
  state.metronomeEnabled = storedBoolean(METRONOME_ENABLED_KEY, false);
  Object.assign(window, {
    totalSlots,
    updateProgressRange,
    updateProgressLabel,
    jumpToInput: jumpToTarget,
    setProgressIndex,
    clearPlayhead,
    startPlayback,
    stopPlayback,
    invalidateRowPlaybackLayout: () => invalidatePlaybackIndex({ timeline: true })
  });
  const api = {
    rebuild: () => ensureIndex({ force: true }),
    invalidate: invalidatePlaybackIndex,
    start: startPlayback,
    stop: stopPlayback,
    setMusicEnabled,
    setMetronomeEnabled,
    setMelodyEnabled,
    refreshSoundControls: () => syncSoundControls(true),
    getIndex: () => state.currentIndex,
    setIndex: (index, { updateSlider = true, highlight = true } = {}) => setProgressIndex(index, updateSlider, highlight),
    getPlaybackIndex: () => ensureIndex(),
    get isPlaying() { return state.playing; },
    get isPreparing() { return state.preparing; },
    get musicEnabled() { return state.musicEnabled; },
    get metronomeEnabled() { return state.metronomeEnabled; },
    get melodyEnabled() { return state.melodyEnabled; }
  };
  window.editorPlayback = api;
  ensureSoundControls();
  syncSoundControls();
  document.getElementById('playButton')?.addEventListener('click', event => {
    event.preventDefault();
    if (state.playing) stopPlayback();
    else if (!state.preparing) void startPlayback();
  });
  updateProgressRange();
  updatePlayButton();
  return api;
}
