import { EditorClipboard } from './clipboard.js';
import { createChangeSet } from './commands.js';
import { installEditorInputController } from './input-controller.js';
import { buildSystems } from './layout.js';
import { SparseScoreRenderer } from './renderer.js';
import { EditorStateSync } from './state-sync.js';
import { StoreRegistry } from './store.js';
import { readToolDragData, ToolRegistry, writeToolDragData } from './tools.js';
import { installViewState, isPreviewActive, isScoreViewActive } from './view-state.js';

const registry = new StoreRegistry();
const stateSync = new EditorStateSync(registry);
const clipboardState = new EditorClipboard();
const toolRegistry = new ToolRegistry();

let installed = false;
let pendingLinkTool = null;

function toast(message) {
  window.showToast?.(message);
}

function ensureStore(options) {
  return stateSync.ensureStore(options);
}

function editingBlocked() {
  return isPreviewActive() || isScoreViewActive();
}

function dispatchCommand(command) {
  const store = ensureStore();
  if (!store) return { document: null, changeSet: createChangeSet() };
  const result = store.dispatch(command);
  stateSync.markCurrent(store);
  return result;
}

function systemMeasures(store, rowIndex) {
  return buildSystems(store.getDocument())?.[rowIndex] || [];
}

function copyModule(target) {
  if (!target || editingBlocked()) return false;
  const store = ensureStore();
  if (!store) return false;

  if (target.type === 'measure') {
    const measure = systemMeasures(store, target.rowIndex)?.[target.measureIndex];
    if (!measure) return false;
    clipboardState.copyMeasure(store.getDocument(), measure.id);
    toast(`已複製第 ${target.rowIndex + 1} 列第 ${target.measureIndex + 1} 小節`);
    return true;
  }

  if (target.type === 'row') {
    const measures = systemMeasures(store, target.rowIndex);
    if (!measures.length) return false;
    clipboardState.copySystem(store.getDocument(), measures.map(measure => measure.id));
    toast(`已複製第 ${target.rowIndex + 1} 列`);
    return true;
  }

  return false;
}

function pasteModule(target) {
  if (!target || editingBlocked()) return false;
  const store = ensureStore();
  if (!store) return false;

  const song = store.getSong();
  const previousCounts = [...(song.rowMeasureCounts || [])];

  if (target.type === 'measure') {
    if (!clipboardState.has('measure')) {
      toast('目前沒有可貼上的小節');
      return true;
    }
    const measure = systemMeasures(store, target.rowIndex)?.[target.measureIndex];
    if (!measure) return false;
    const result = clipboardState.pasteMeasure(store.getDocument(), measure.id);
    if (!result) return false;
    store.commit(result.document, result.changeSet);
    stateSync.projectStoreToView(store, target, previousCounts);
    toast(`已貼到第 ${target.rowIndex + 1} 列第 ${target.measureIndex + 1} 小節`);
    return true;
  }

  if (target.type === 'row') {
    if (!clipboardState.has('system')) {
      toast('目前沒有可貼上的列');
      return true;
    }
    const measures = systemMeasures(store, target.rowIndex);
    if (!measures.length) return false;
    const result = clipboardState.pasteSystem(store.getDocument(), measures.map(measure => measure.id));
    if (!result) return false;
    store.commit(result.document, result.changeSet);
    stateSync.projectStoreToView(store, target, previousCounts);
    toast(`已貼到第 ${target.rowIndex + 1} 列`);
    return true;
  }

  return false;
}

function toolTargetFromNode(definition, node) {
  if (!definition || !node) return null;
  if (definition.target === 'note') {
    return { noteId: node.closest('[data-note-id]')?.dataset.noteId };
  }
  if (definition.target === 'event') {
    return { eventId: node.closest('[data-event-id]')?.dataset.eventId };
  }
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
    dispatchCommand(command);
    return true;
  }

  dispatchCommand(toolRegistry.createCommand(toolId, target, options));
  return true;
}

function installToolDragDrop() {
  document.addEventListener('dragstart', event => {
    const source = event.target?.closest?.('[data-editor-tool]');
    if (!source) return;
    let options = {};
    if (source.dataset.toolOptions) {
      try { options = JSON.parse(source.dataset.toolOptions); } catch { options = {}; }
    }
    writeToolDragData(event.dataTransfer, source.dataset.editorTool, options);
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
  if (typeof window === 'undefined') return null;
  if (installed) return window.editorV3 || null;
  installed = true;

  installViewState();
  stateSync.installPersistenceAdapters();
  installToolDragDrop();

  const api = {
    version: 3,
    stores: registry,
    tools: toolRegistry,
    getStore: options => ensureStore(options),
    reconcileCurrentSong: () => stateSync.reconcileCurrentSong(),
    sync: {
      markCurrent: store => stateSync.markCurrent(store),
      projectStoreToView: (store, target, previousCounts) => stateSync.projectStoreToView(store, target, previousCounts)
    },
    clipboard: {
      copyModule,
      pasteModule,
      clear: () => clipboardState.clear(),
      state: clipboardState
    },
    dispatch: dispatchCommand,
    dispatchTool,
    createSparseRenderer(root, options = {}) {
      const renderer = new SparseScoreRenderer(root, {
        ...options,
        onCommitNote: payload => {
          const result = dispatchCommand({ type: 'note/set', ...payload });
          const store = ensureStore({ reconcile: false });
          if (store) renderer.render(store.getDocument(), result.changeSet);
        }
      });
      return renderer;
    }
  };

  window.editorV3 = api;
  ensureStore();
  installEditorInputController({
    getStore: () => ensureStore({ reconcile: false }),
    markStoreCurrent: store => stateSync.markCurrent(store)
  });

  window.addEventListener('hashchange', () => queueMicrotask(() => ensureStore()));
  return api;
}
