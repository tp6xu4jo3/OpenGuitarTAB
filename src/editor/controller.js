import { EditorClipboard } from './clipboard.js';
import { createChangeSet } from './commands.js';
import { scheduleLayoutRender } from './grid-renderer.js';
import { installEditorInputController } from './input-controller.js';
import { buildSystems } from './layout.js';
import { compareFractions, fractionKey, normalizeFraction } from './model.js';
import { NotationRenderer } from './notation-renderer.js';
import { SparseScoreRenderer } from './renderer.js';
import { EditorStateSync } from './state-sync.js';
import { StoreRegistry } from './store.js';
import { resolveTechniqueTarget } from './technique-rules.js';
import { TOOL_TARGET_KINDS, ToolSession, toolTargetKind } from './tool-session.js';
import { ToolRegistry } from './tools.js';
import { installViewState, isPreviewActive, isScoreViewActive } from './view-state.js';

const registry = new StoreRegistry();
const stateSync = new EditorStateSync(registry);
const clipboardState = new EditorClipboard();
const toolRegistry = new ToolRegistry();
const toolSession = new ToolSession();
const boundStores = new WeakSet();

let installed = false;
let notationRenderer = null;
let toolPalette = null;
let toolboxCollapsed = false;
let selectedTechniqueRef = null;
let techniqueContextMenu = null;

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
  if (result.changeSet.document || result.changeSet.layoutFrom) scheduleLayoutRender();
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

function atFromNode(node) {
  const input = node?.closest?.('.note-input[data-measure-id][data-at]');
  if (!input) return null;
  const [numerator, denominator] = String(input.dataset.at || '').split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return {
    measureId: String(input.dataset.measureId || ''),
    at: normalizeFraction([numerator, denominator])
  };
}

function toolTargetFromNode(definition, node) {
  if (!definition || !node) return null;
  const kind = toolTargetKind(definition);

  if (kind === TOOL_TARGET_KINDS.NOTE || kind === TOOL_TARGET_KINDS.NOTE_PAIR) {
    const noteId = node.closest?.('[data-note-id]')?.dataset.noteId;
    return noteId ? { noteId: String(noteId) } : null;
  }

  if (kind === TOOL_TARGET_KINDS.COLUMN || kind === TOOL_TARGET_KINDS.RANGE) {
    return atFromNode(node);
  }

  return null;
}

function eventAtColumn(documentModel, target) {
  const measure = (documentModel?.measures || []).find(item => String(item.id) === String(target?.measureId || ''));
  if (!measure || !Array.isArray(target?.at)) return null;
  const key = fractionKey(target.at);
  return (measure.events || []).find(event => fractionKey(event.at) === key) || null;
}

function eventsInRange(documentModel, target) {
  const measure = (documentModel?.measures || []).find(item => String(item.id) === String(target?.measureId || ''));
  if (!measure || !Array.isArray(target?.startAt) || !Array.isArray(target?.endAt)) return [];
  return (measure.events || []).filter(event =>
    compareFractions(event.at, target.startAt) >= 0 && compareFractions(event.at, target.endAt) <= 0
  );
}

function commandTarget(definition, target, documentModel) {
  if (definition.target === 'note') return target;
  if (definition.target === 'notePair') return target;

  if (definition.target === 'event') {
    const event = eventAtColumn(documentModel, target);
    return event ? { eventId: event.id, measureId: target.measureId, at: target.at } : null;
  }

  if (definition.target === 'eventRange') {
    const events = eventsInRange(documentModel, target);
    return {
      measureId: target.measureId,
      startAt: target.startAt,
      endAt: target.endAt,
      eventIds: events.map(event => event.id)
    };
  }

  return target;
}

function clearToolSource() {
  document.querySelectorAll('.note-input.tool-link-source,.note-input.tool-range-source').forEach(node => {
    node.classList.remove('tool-link-source', 'tool-range-source');
  });
}

function markToolSource(kind, target) {
  clearToolSource();

  if (kind === TOOL_TARGET_KINDS.NOTE_PAIR && target?.noteId) {
    document.querySelectorAll(`[data-note-id="${escapeSelector(target.noteId)}"]`).forEach(node => {
      node.classList.add('tool-link-source');
    });
    return;
  }

  if (kind === TOOL_TARGET_KINDS.RANGE && target?.measureId && Array.isArray(target.at)) {
    const measureId = escapeSelector(target.measureId);
    const at = escapeSelector(fractionKey(target.at));
    document.querySelectorAll(`.note-input[data-measure-id="${measureId}"][data-at="${at}"]`).forEach(node => {
      node.classList.add('tool-range-source');
    });
  }
}

function dispatchTool(toolId, target, options = {}) {
  const definition = toolRegistry.get(toolId);
  if (!definition || editingBlocked()) return false;
  const store = ensureStore({ reconcile: false });
  if (!store) return false;

  const resolved = commandTarget(definition, target, store.getDocument());
  if (!resolved) {
    toast('這個時間位置沒有可套用技巧的目標');
    return false;
  }

  const validation = resolveTechniqueTarget(toolId, resolved, store.getDocument());
  if (!validation.ok) {
    toast(validation.message || '這個目標無法套用此技巧');
    return false;
  }

  dispatchCommand(toolRegistry.createCommand(toolId, validation.target, options));
  return true;
}

function clearTechniqueSelection() {
  document.querySelectorAll('.technique-marker.is-selected').forEach(marker => marker.classList.remove('is-selected'));
  selectedTechniqueRef = null;
}

function hideTechniqueContextMenu() {
  if (techniqueContextMenu) techniqueContextMenu.hidden = true;
}

function ensureTechniqueContextMenu() {
  if (techniqueContextMenu?.isConnected) return techniqueContextMenu;
  const menu = document.createElement('div');
  menu.className = 'technique-context-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.dataset.deleteTechnique = 'true';
  remove.setAttribute('role', 'menuitem');
  remove.textContent = '刪除技巧';
  menu.appendChild(remove);
  document.body.appendChild(menu);
  techniqueContextMenu = menu;
  return menu;
}

function selectTechniqueMarker(marker) {
  if (!marker) return null;
  clearTechniqueSelection();
  marker.classList.add('is-selected');
  marker.focus({ preventScroll: true });
  selectedTechniqueRef = {
    kind: String(marker.dataset.techniqueKind || ''),
    id: String(marker.dataset.techniqueId || '')
  };
  return selectedTechniqueRef;
}

function deleteSelectedTechnique() {
  const reference = selectedTechniqueRef;
  if (!reference?.id) return false;
  const commandByKind = {
    technique: { type: 'technique/delete', techniqueId: reference.id },
    mark: { type: 'mark/delete', markId: reference.id },
    group: { type: 'group/delete', groupId: reference.id },
    relation: { type: 'relation/delete', relationId: reference.id }
  };
  const command = commandByKind[reference.kind];
  if (!command) return false;
  dispatchCommand(command);
  clearTechniqueSelection();
  hideTechniqueContextMenu();
  toast('已刪除技巧');
  return true;
}

function showTechniqueContextMenu(marker, event) {
  selectTechniqueMarker(marker);
  const menu = ensureTechniqueContextMenu();
  menu.style.left = `${Math.max(8, event.clientX)}px`;
  menu.style.top = `${Math.max(8, event.clientY)}px`;
  menu.hidden = false;
}

function syncToolButtons() {
  const activeToolId = toolSession.snapshot().toolId;
  toolPalette?.querySelectorAll('[data-editor-tool]').forEach(button => {
    const active = button.dataset.editorTool === activeToolId;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function setToolboxCollapsed(collapsed) {
  toolboxCollapsed = Boolean(collapsed);
  const palette = toolPalette;
  if (!palette) return toolboxCollapsed;
  palette.classList.toggle('is-collapsed', toolboxCollapsed);
  const toggle = palette.querySelector('[data-editor-toolbox-toggle]');
  if (toggle) {
    toggle.textContent = toolboxCollapsed ? '技巧 ›' : '‹';
    toggle.title = toolboxCollapsed ? '展開技巧' : '收合技巧';
    toggle.setAttribute('aria-expanded', String(!toolboxCollapsed));
  }
  return toolboxCollapsed;
}

function setActiveTool(toolId) {
  const definition = toolRegistry.get(toolId);
  if (!definition) toolSession.cancel();
  else toolSession.activate(definition.id, toolTargetKind(definition));
  notationRenderer?.clearPreview();
  clearToolSource();
  clearTechniqueSelection();
  hideTechniqueContextMenu();
  syncToolButtons();
  return toolSession.snapshot().toolId;
}

function ensureToolPalette() {
  if (toolPalette?.isConnected) return toolPalette;
  const tabArea = document.getElementById('tabArea');
  if (!tabArea) return null;

  const palette = document.createElement('div');
  palette.className = 'editor-toolbox';
  palette.id = 'editorToolbox';
  palette.setAttribute('aria-label', '吉他技巧工具');

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'editor-toolbox-toggle';
  toggle.dataset.editorToolboxToggle = 'true';
  palette.appendChild(toggle);

  const label = document.createElement('span');
  label.className = 'editor-toolbox-label';
  label.textContent = '技巧';
  palette.appendChild(label);

  toolRegistry.list().forEach(definition => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'editor-tool-button';
    button.dataset.editorTool = definition.id;
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
  setToolboxCollapsed(toolboxCollapsed);
  syncToolButtons();
  return palette;
}

function syncToolPalette() {
  const palette = ensureToolPalette();
  if (!palette) return;
  const editorView = document.getElementById('editorView');
  const hidden = Boolean(editorView?.hidden || editingBlocked());
  palette.hidden = hidden;
  if (hidden && toolSession.active) {
    toolSession.cancel();
    clearToolSource();
    syncToolButtons();
  }
}

function invalidSelectionMessage(reason) {
  if (reason === 'same-note') return '第二個音符需與第一個不同';
  if (reason === 'same-measure-required') return '範圍起點與終點需在同一小節';
  if (reason === 'different-position-required') return '範圍終點需與起點不同';
  return '請點選有效的譜面目標';
}

function handleToolSelection(target) {
  const snapshot = toolSession.snapshot();
  if (!snapshot.toolId) return false;
  const result = toolSession.select(target);

  if (result.status === 'invalid') {
    toast(invalidSelectionMessage(result.reason));
    return true;
  }

  if (result.status === 'pending') {
    markToolSource(snapshot.targetKind, result.source);
    toast(snapshot.targetKind === TOOL_TARGET_KINDS.NOTE_PAIR
      ? '已選擇第一個音符，請選擇第二個音符'
      : '已選擇範圍起點，請選擇終點');
    return true;
  }

  if (result.status === 'complete') {
    const committed = dispatchTool(snapshot.toolId, result.target);
    if (committed) {
      toolSession.commitSuccess();
      notationRenderer?.clearPreview();
      clearToolSource();
      syncToolButtons();
    }
    return true;
  }

  return false;
}

function installToolInteractions() {
  document.addEventListener('click', event => {
    const deleteAction = event.target?.closest?.('[data-delete-technique]');
    if (deleteAction) {
      event.preventDefault();
      deleteSelectedTechnique();
      return;
    }

    const techniqueMarker = event.target?.closest?.('.technique-marker');
    if (techniqueMarker) {
      event.preventDefault();
      toolSession.cancel();
      notationRenderer?.clearPreview();
      clearToolSource();
      syncToolButtons();
      selectTechniqueMarker(techniqueMarker);
      hideTechniqueContextMenu();
      return;
    }

    if (!event.target?.closest?.('.technique-context-menu')) {
      clearTechniqueSelection();
      hideTechniqueContextMenu();
    }

    const collapseButton = event.target?.closest?.('[data-editor-toolbox-toggle]');
    if (collapseButton) {
      event.preventDefault();
      setToolboxCollapsed(!toolboxCollapsed);
      return;
    }

    const toolButton = event.target?.closest?.('[data-editor-tool]');
    if (toolButton) {
      event.preventDefault();
      setActiveTool(toolButton.dataset.editorTool);
      return;
    }

    const snapshot = toolSession.snapshot();
    if (!snapshot.toolId || editingBlocked()) return;
    const definition = toolRegistry.get(snapshot.toolId);
    if (!definition) return;

    const target = toolTargetFromNode(definition, event.target);
    const inScore = Boolean(event.target?.closest?.('#tabArea'));
    if (!target) {
      if (inScore) toast('請點選有效的譜面目標');
      return;
    }

    event.preventDefault();
    handleToolSelection(target);
  });

  document.addEventListener('contextmenu', event => {
    const marker = event.target?.closest?.('.technique-marker');
    if (!marker) return;
    event.preventDefault();
    toolSession.cancel();
    notationRenderer?.clearPreview();
    clearToolSource();
    syncToolButtons();
    showTechniqueContextMenu(marker, event);
  });

  document.addEventListener('pointermove', event => {
    const snapshot = toolSession.snapshot();
    if (snapshot.targetKind !== TOOL_TARGET_KINDS.NOTE_PAIR || !snapshot.firstTarget?.noteId) {
      notationRenderer?.clearPreview();
      return;
    }
    notationRenderer?.previewRelation({
      fromNoteId: snapshot.firstTarget.noteId,
      type: snapshot.toolId === 'slide' ? 'slide' : 'slur',
      clientX: event.clientX,
      clientY: event.clientY
    });
  }, { passive: true });

  document.addEventListener('keydown', event => {
    const editable = event.target instanceof HTMLInputElement
      || event.target instanceof HTMLTextAreaElement
      || event.target?.isContentEditable;

    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedTechniqueRef && !editable) {
      event.preventDefault();
      deleteSelectedTechnique();
      return;
    }

    if (event.key !== 'Escape') return;
    if (!toolSession.active && !selectedTechniqueRef && techniqueContextMenu?.hidden !== false) return;
    event.preventDefault();
    toolSession.cancel();
    notationRenderer?.clearPreview();
    clearToolSource();
    clearTechniqueSelection();
    hideTechniqueContextMenu();
    syncToolButtons();
  });
}

function installNotationSync() {
  const tabArea = document.getElementById('tabArea');
  if (!tabArea) return;
  notationRenderer = new NotationRenderer(tabArea);

  const gridObserver = new MutationObserver(mutations => {
    const hasGridMutation = mutations.some(mutation => {
      const target = mutation.target;
      return !(target instanceof Element && target.closest('.notation-overlay,.technique-marker-layer'));
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
    toolSession,
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
