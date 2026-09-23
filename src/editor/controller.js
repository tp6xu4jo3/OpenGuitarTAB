import { EditorClipboard } from './clipboard.js';
import { createChangeSet } from './commands.js';
import { buildSystems } from './layout.js';
import { documentToLegacyProjection } from './migrate-v2.js';
import { SparseScoreRenderer } from './renderer.js';
import { StoreRegistry } from './store.js';
import { readToolDragData, ToolRegistry, writeToolDragData } from './tools.js';

const registry = new StoreRegistry();
const clipboardState = new EditorClipboard();
const toolRegistry = new ToolRegistry();
const syncState = new WeakMap();
let installed = false;
let pendingLinkTool = null;

function currentSongSafe() {
  return typeof window.currentSong === 'function' ? window.currentSong() : null;
}

function toast(message) {
  if (typeof window.showToast === 'function') window.showToast(message);
}

function ensureStore({ reconcile = true } = {}) {
  const song = currentSongSafe();
  if (!song) return null;
  const store = registry.forSong(song);
  let state = syncState.get(store);
  if (!state) {
    state = { legacyUpdatedAt: Number(song.updatedAt) || 0 };
    syncState.set(store, state);
  }
  if (reconcile && state.legacyUpdatedAt !== (Number(song.updatedAt) || 0)) {
    store.reconcileLegacySong(song, { silent: true });
    state.legacyUpdatedAt = Number(song.updatedAt) || 0;
  }
  return store;
}

function markLegacySynced(store) {
  const song = store?.getSong();
  if (!store || !song) return;
  syncState.set(store, { legacyUpdatedAt: Number(song.updatedAt) || 0 });
}

function hydrateLegacyRow(rowIndex, { measureIndex = null } = {}) {
  const song = currentSongSafe();
  const row = song?.rows?.[rowIndex];
  if (!row) return;
  const width = (Number(song.beatsPerMeasure) === 3 ? 3 : 4) * 4;
  const start = measureIndex == null ? 0 : measureIndex * width;
  const end = measureIndex == null ? row[0]?.length || 0 : start + width;

  document.querySelectorAll(`.note-input[data-row="${rowIndex}"]`).forEach(input => {
    const position = Number(input.dataset.position);
    if (position < start || position >= end) return;
    const string = Number(input.dataset.string);
    const value = String(row?.[string]?.[position] ?? '');
    input.value = value;
    input.classList.toggle('has-value', value.length > 0);
    window.syncNoteInputBackground?.(input);
  });
  window.renderRhythmNotation?.(rowIndex);
  const grid = document.querySelector(`.tab-grid[data-row="${rowIndex}"]`);
  if (grid) window.scheduleDensityFitGrid?.(grid, true);
  window.invalidateRowPlaybackLayout?.();
  window.updateProgressRange?.();
}

function projectStoreToLegacy(store, target = null, previousCounts = null) {
  const song = store?.getSong();
  if (!song) return false;
  const projection = documentToLegacyProjection(store.getDocument());
  if (projection.lossy) return false;

  song.rows = projection.rows;
  song.rhythmRows = projection.rhythmRows;
  song.rowMeasureCounts = projection.rowMeasureCounts;
  song.beatsPerMeasure = projection.beatsPerMeasure;
  song.meter = projection.meter;
  song.updatedAt = Date.now();
  markLegacySynced(store);

  const sameShape = Array.isArray(previousCounts)
    && previousCounts.length === projection.rowMeasureCounts.length
    && previousCounts.every((count, index) => Number(count) === Number(projection.rowMeasureCounts[index]));

  if (target?.type === 'measure' && sameShape) {
    hydrateLegacyRow(target.rowIndex, { measureIndex: target.measureIndex });
    return true;
  }
  if (target?.type === 'row' && sameShape) {
    hydrateLegacyRow(target.rowIndex);
    return true;
  }

  if (typeof window.renderRows === 'function') window.renderRows(song.rows);
  return true;
}

function selectedSystemMeasures(store, rowIndex) {
  return buildSystems(store.getDocument())?.[rowIndex] || [];
}

function copyModule(target) {
  if (!target || window.previewSong || window.scoreViewEnabled) return false;
  const store = ensureStore();
  if (!store) return false;
  if (target.type === 'measure') {
    const measure = selectedSystemMeasures(store, target.rowIndex)?.[target.measureIndex];
    if (!measure) return false;
    clipboardState.copyMeasure(store.getDocument(), measure.id);
    toast(`已複製第 ${target.rowIndex + 1} 列第 ${target.measureIndex + 1} 小節`);
    return true;
  }
  if (target.type === 'row') {
    const measures = selectedSystemMeasures(store, target.rowIndex);
    if (!measures.length) return false;
    clipboardState.copySystem(store.getDocument(), measures.map(measure => measure.id));
    toast(`已複製第 ${target.rowIndex + 1} 列`);
    return true;
  }
  return false;
}

function pasteModule(target) {
  if (!target || window.previewSong || window.scoreViewEnabled) return false;
  const store = ensureStore();
  if (!store) return false;
  const song = store.getSong();
  const previousCounts = [...(song.rowMeasureCounts || [])];

  if (target.type === 'measure') {
    if (!clipboardState.has('measure')) {
      toast('目前沒有可貼上的小節');
      return true;
    }
    const measure = selectedSystemMeasures(store, target.rowIndex)?.[target.measureIndex];
    if (!measure) return false;
    const result = clipboardState.pasteMeasure(store.getDocument(), measure.id);
    if (!result) return false;
    store.commit(result.document, result.changeSet);
    projectStoreToLegacy(store, target, previousCounts);
    toast(`已貼到第 ${target.rowIndex + 1} 列第 ${target.measureIndex + 1} 小節`);
    return true;
  }

  if (target.type === 'row') {
    if (!clipboardState.has('system')) {
      toast('目前沒有可貼上的列');
      return true;
    }
    const measures = selectedSystemMeasures(store, target.rowIndex);
    if (!measures.length) return false;
    const result = clipboardState.pasteSystem(store.getDocument(), measures.map(measure => measure.id));
    if (!result) return false;
    store.commit(result.document, result.changeSet);
    projectStoreToLegacy(store, target, previousCounts);
    toast(`已貼到第 ${target.rowIndex + 1} 列`);
    return true;
  }
  return false;
}

function syncInputMeasure(event) {
  const input = event.target?.closest?.('.note-input');
  if (!input || window.previewSong || window.scoreViewEnabled) return;
  const song = currentSongSafe();
  const store = ensureStore({ reconcile: false });
  if (!song || !store) return;
  const rowIndex = Number(input.dataset.row);
  const position = Number(input.dataset.position);
  const beats = Number(song.beatsPerMeasure) === 3 ? 3 : 4;
  const measureIndex = Math.floor(position / (beats * 4));
  store.reconcileLegacyMeasure(rowIndex, measureIndex, { silent: true });
  markLegacySynced(store);
}

function installStateSourceBridge() {
  const legacyReadRows = window.readRowsFromDom;
  const legacySaveRows = window.saveRowsToCurrentSong;

  window.readRowsFromDom = function readRowsFromStore() {
    const song = currentSongSafe();
    if (song && Array.isArray(song.rows)) return song.rows;
    return typeof legacyReadRows === 'function' ? legacyReadRows() : [];
  };

  window.saveRowsToCurrentSong = function saveRowsToV3State(rows) {
    const song = currentSongSafe();
    if (!song) return;
    const store = ensureStore({ reconcile: false });
    if (!store) {
      if (typeof legacySaveRows === 'function') legacySaveRows(rows);
      return;
    }

    if (Array.isArray(rows) && rows !== song.rows) {
      song.rows = typeof window.normalizeRows === 'function'
        ? window.normalizeRows(rows, song.beatsPerMeasure)
        : rows;
      if (typeof window.rhythmRowFromRow === 'function') {
        song.rhythmRows = song.rows.map(row => window.rhythmRowFromRow(row, song.beatsPerMeasure));
      }
      song.updatedAt = Date.now();
      store.reconcileLegacySong(song, { silent: true });
      markLegacySynced(store);
    } else {
      const state = syncState.get(store);
      if (!state || state.legacyUpdatedAt !== (Number(song.updatedAt) || 0)) {
        store.reconcileLegacySong(song, { silent: true });
        markLegacySynced(store);
      }
    }

    store.prepareForPersistence({
      tempo: typeof window.getTempo === 'function' ? window.getTempo() : song.tempo,
      capo: typeof window.getCapo === 'function' ? window.getCapo() : song.capo
    });
    markLegacySynced(store);
  };

  document.getElementById('tabArea')?.addEventListener('input', syncInputMeasure);
}

function toolTargetFromNode(definition, node) {
  if (!definition || !node) return null;
  if (definition.target === 'note') return { noteId: node.closest('[data-note-id]')?.dataset.noteId };
  if (definition.target === 'event') return { eventId: node.closest('[data-event-id]')?.dataset.eventId };
  if (definition.target === 'eventRange') {
    const range = node.closest('[data-event-ids]');
    return {
      measureId: range?.dataset.measureId,
      eventIds: String(range?.dataset.eventIds || '').split(',').filter(Boolean)
    };
  }
  return null;
}

function dispatchTool(toolId, target, options = {}) {
  const store = ensureStore();
  if (!store) return false;
  const definition = toolRegistry.get(toolId);
  if (!definition) return false;

  if (definition.target === 'notePair') {
    const noteId = target?.noteId;
    if (!noteId) return false;
    if (!pendingLinkTool || pendingLinkTool.toolId !== toolId) {
      pendingLinkTool = { toolId, fromNoteId: noteId, options };
      toast('已選擇第一個音符，請選擇第二個音符');
      return true;
    }
    const command = toolRegistry.createCommand(toolId, {
      fromNoteId: pendingLinkTool.fromNoteId,
      toNoteId: noteId
    }, pendingLinkTool.options);
    pendingLinkTool = null;
    store.dispatch(command);
    return true;
  }

  store.dispatch(toolRegistry.createCommand(toolId, target, options));
  return true;
}

function installToolDragDrop() {
  document.addEventListener('dragstart', event => {
    const source = event.target?.closest?.('[data-editor-tool]');
    if (!source) return;
    writeToolDragData(event.dataTransfer, source.dataset.editorTool, source.dataset.toolOptions ? JSON.parse(source.dataset.toolOptions) : {});
  });

  document.addEventListener('dragover', event => {
    const payload = readToolDragData(event.dataTransfer);
    if (!payload) return;
    const definition = toolRegistry.get(payload.toolId);
    if (!definition) return;
    const accepted = definition.target === 'notePair'
      ? event.target.closest?.('[data-note-id]')
      : toolTargetFromNode(definition, event.target);
    if (accepted) event.preventDefault();
  });

  document.addEventListener('drop', event => {
    const payload = readToolDragData(event.dataTransfer);
    if (!payload) return;
    const definition = toolRegistry.get(payload.toolId);
    if (!definition) return;
    const target = definition.target === 'notePair'
      ? { noteId: event.target.closest?.('[data-note-id]')?.dataset.noteId }
      : toolTargetFromNode(definition, event.target);
    if (!target || Object.values(target).every(value => value == null || value === '')) return;
    event.preventDefault();
    dispatchTool(payload.toolId, target, payload.options || {});
  });
}

export function installEditorV3() {
  if (installed || typeof window === 'undefined') return window?.editorV3 || null;
  installed = true;
  installStateSourceBridge();
  installToolDragDrop();

  const api = {
    version: 3,
    stores: registry,
    tools: toolRegistry,
    getStore: () => ensureStore(),
    reconcileCurrentSong: () => {
      const store = ensureStore({ reconcile: false });
      if (!store) return null;
      const result = store.reconcileLegacySong(store.getSong(), { silent: true });
      markLegacySynced(store);
      return result;
    },
    clipboard: {
      copyModule,
      pasteModule,
      clear: () => clipboardState.clear(),
      state: clipboardState
    },
    dispatch: command => ensureStore()?.dispatch(command) || { document: null, changeSet: createChangeSet() },
    dispatchTool,
    createSparseRenderer(root, options = {}) {
      const renderer = new SparseScoreRenderer(root, {
        ...options,
        onCommitNote: payload => {
          const store = ensureStore();
          if (!store) return;
          const result = store.dispatch({ type: 'note/set', ...payload });
          renderer.render(store.getDocument(), result.changeSet);
        }
      });
      return renderer;
    }
  };

  window.editorV3 = api;
  ensureStore();
  window.addEventListener('hashchange', () => queueMicrotask(() => ensureStore()));
  return api;
}
