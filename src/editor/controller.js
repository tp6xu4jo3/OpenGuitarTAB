import { EditorClipboard } from './clipboard.js';
import { createChangeSet } from './commands.js';
import { installEditorInputController } from './input-controller.js';
import { buildSystems } from './layout.js';
import { NotationRenderer } from './notation-renderer.js';
import { SparseScoreRenderer } from './renderer.js';
import { EditorStateSync } from './state-sync.js';
import { StoreRegistry } from './store.js';
import { eventRangeFromEvent, readToolDragData, ToolRegistry, writeToolDragData } from './tools.js';
import { installViewState, isPreviewActive, isScoreViewActive } from './view-state.js';

const registry = new StoreRegistry();
const stateSync = new EditorStateSync(registry);
const clipboardState = new EditorClipboard();
const toolRegistry = new ToolRegistry();
const boundStores = new WeakSet();

let installed = false;
let pendingLinkTool = null;
let activeToolId = null;
let notationRenderer = null;
let toolPalette = null;

function toast(message) {
  window.showToast?.(message);
}

function escapeSelector(value) {
  const text = String(value ?? '');
  return globalThis.CSS?.escape ? CSS.escape(text) : text.replace(/["\\]/g, '\\$&');
}

function bindStore(store) {
  if (!store || boundStores.has(store)) return store;
  boundStores.add(store);
  store.subscribe((documentModel, changeSet) => notationRenderer?.schedule(documentModel, changeSet));
  notationRenderer?.schedule(store.getDocument(), { document: true });
  return store;
}

function ensureStore(options) {
  return bindStore(stateSync.ensureStore(options));
}

function editingBlocked() {
  return isPreviewActive() || isScoreViewActive();
}

function dispatchCommand(command) {
  const store = ensureStore();
  if (!store) return { document: null, changeSet: createChangeSet() };
  const result = store.dispatch(command);
  stateSync.markCurrent(store);
  window.scheduleEditorLayout?.();
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

function toolTargetFromNode(definition, node, documentModel) {
  if (!definition || !node) return null;
  const noteNode = node.closest?.('[data-note-id]');
  const eventNode = node.closest?.('[data-event-id]');

  if (definition.target === 'note' || definition.target === 'notePair') {
    const noteId = noteNode?.dataset.noteId;
    return noteId ? { noteId } : null;
  }
  if (definition.target === 'event') {
    const eventId = eventNode?.dataset.eventId;
    return eventId ? { eventId } : null;
  }
  if (definition.target === 'eventRange') {
    const eventId = eventNode?.dataset.eventId;
    return eventId ? eventRangeFromEvent(documentModel, eventId, 3) : null;
  }
  return null;
}

function clearLinkSource() {
  document.querySelectorAll('.note-input.tool-link-source').forEach(node => node.classList.remove('tool-link-source'));
}

function markLinkSource(noteId) {
  clearLinkSource();
  document.querySelectorAll(`[data-note-id="${escapeSelector(noteId)}"]`).forEach(node => node.classList.add('tool-link-source'));
}

function dispatchTool(toolId, target, options = {}) {
  const definition = toolRegistry.get(toolId);
  if (!definition || editingBlocked()) return false;

  if (definition.target === 'notePair') {
    const noteId = target?.noteId;
    if (!noteId) return false;
    if (!pendingLinkTool || pendingLinkTool.toolId !== toolId) {
      pendingLinkTool = { toolId, fromNoteId: noteId, options };
      markLinkSource(noteId);
      toast('已選擇第一個音符，請選擇第二個音符');
      return true;
    }
    if (pendingLinkTool.fromNoteId === noteId) {
      toast('第二個音符需與第一個不同');
      return true;
    }

    const command = toolRegistry.createCommand(toolId, {
      fromNoteId: pendingLinkTool.fromNoteId,
      toNoteId: noteId
    }, pendingLinkTool.options);
    pendingLinkTool = null;
    clearLinkSource();
    dispatchCommand(command);
    return true;
  }

  dispatchCommand(toolRegistry.createCommand(toolId, target, options));
  return true;
}

function setActiveTool(toolId) {
  activeToolId = toolRegistry.get(toolId) ? String(toolId) : null;
  pendingLinkTool = null;
  clearLinkSource();
  toolPalette?.querySelectorAll('[data-editor-tool]').forEach(button => {
    const active = button.dataset.editorTool === activeToolId;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  return activeToolId;
}

function ensureToolPalette() {
  if (toolPalette?.isConnected) return toolPalette;
  const tabArea = document.getElementById('tabArea');
  if (!tabArea) return null;

  const palette = document.createElement('div');
  palette.className = 'editor-toolbox';
  palette.id = 'editorToolbox';
  palette.setAttribute('aria-label', '吉他技巧工具');

  const label = document.createElement('span');
  label.className = 'editor-toolbox-label';
  label.textContent = '技巧';
  palette.appendChild(label);

  toolRegistry.list().forEach(definition => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'editor-tool-button';
    button.dataset.editorTool = definition.id;
    button.draggable = true;
    button.title = definition.hint || definition.label || definition.id;
    button.setAttribute('aria-pressed', 'false');

    const glyph = document.createElement('span');
    glyph.className = 'editor-tool-glyph';
    glyph.textContent = definition.glyph || definition.label || definition.id;
    glyph.setAttribute('aria-hidden', 'true');

    const name = document.createElement('span');
    name.className = 'editor-tool-name';
    name.textContent = definition.label || definition.id;
    button.append(glyph, name);
    palette.appendChild(button);
  });

  tabArea.before(palette);
  toolPalette = palette;
  syncToolPalette();
  return palette;
}

function syncToolPalette() {
  const palette = ensureToolPalette();
  if (!palette) return;
  const editorView = document.getElementById('editorView');
  const hidden = Boolean(editorView?.hidden || editingBlocked());
  palette.hidden = hidden;
  if (hidden && (activeToolId || pendingLinkTool)) setActiveTool(null);
}

function installToolInteractions() {
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
    if (editingBlocked()) return;
    const payload = readToolDragData(event.dataTransfer);
    if (!payload) return;
    const definition = toolRegistry.get(payload.toolId);
    const store = ensureStore({ reconcile: false });
    if (!definition || !store) return;
    if (toolTargetFromNode(definition, event.target, store.getDocument())) event.preventDefault();
  });

  document.addEventListener('drop', event => {
    if (editingBlocked()) return;
    const payload = readToolDragData(event.dataTransfer);
    if (!payload) return;
    const definition = toolRegistry.get(payload.toolId);
    const store = ensureStore({ reconcile: false });
    if (!definition || !store) return;
    const target = toolTargetFromNode(definition, event.target, store.getDocument());
    if (!target) return;
    event.preventDefault();
    dispatchTool(payload.toolId, target, payload.options || {});
  });

  document.addEventListener('click', event => {
    const toolButton = event.target?.closest?.('[data-editor-tool]');
    if (toolButton) {
      event.preventDefault();
      setActiveTool(activeToolId === toolButton.dataset.editorTool ? null : toolButton.dataset.editorTool);
      return;
    }

    if (!activeToolId || editingBlocked()) return;
    const definition = toolRegistry.get(activeToolId);
    const store = ensureStore({ reconcile: false });
    if (!definition || !store) return;
    const target = toolTargetFromNode(definition, event.target, store.getDocument());
    if (target) dispatchTool(activeToolId, target);
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (activeToolId || pendingLinkTool)) setActiveTool(null);
  });
}

function installNotationSync() {
  const tabArea = document.getElementById('tabArea');
  if (!tabArea) return;
  notationRenderer = new NotationRenderer(tabArea);

  const gridObserver = new MutationObserver(mutations => {
    const hasGridMutation = mutations.some(mutation => {
      const target = mutation.target;
      return !(target instanceof Element && target.closest('.notation-overlay'));
    });
    if (!hasGridMutation) return;
    const store = ensureStore({ reconcile: false });
    if (store) notationRenderer.schedule(store.getDocument(), { document: true });
  });
  gridObserver.observe(tabArea, { childList: true, subtree: true });

  const editorView = document.getElementById('editorView');
  const previewBadge = document.getElementById('previewBadge');
  const modeObserver = new MutationObserver(() => syncToolPalette());
  if (editorView) modeObserver.observe(editorView, { attributes: true, attributeFilter: ['class', 'hidden'] });
  if (previewBadge) modeObserver.observe(previewBadge, { attributes: true, attributeFilter: ['hidden'] });
}

export function installEditorV3() {
  if (typeof window === 'undefined') return null;
  if (installed) return window.editorV3 || null;
  installed = true;

  installViewState();
  ensureToolPalette();
  installNotationSync();
  installToolInteractions();

  const api = {
    version: 3,
    stores: registry,
    tools: toolRegistry,
    getStore: options => ensureStore(options),
    reconcileCurrentSong: () => stateSync.reconcileCurrentSong(),
    sync: {
      markCurrent: store => stateSync.markCurrent(store),
      prepareForPersistence: store => stateSync.prepareForPersistence(store),
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
    setActiveTool,
    refreshNotation(changeSet = { document: true }) {
      const store = ensureStore({ reconcile: false });
      if (store) notationRenderer?.schedule(store.getDocument(), changeSet);
    },
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

  window.addEventListener('hashchange', () => queueMicrotask(() => {
    ensureStore();
    syncToolPalette();
  }));
  return api;
}
