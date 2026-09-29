import { buildSystems } from './layout.js';
import {
  deleteMeasureAt,
  deleteMeasures,
  deleteSystem,
  insertMeasureAt,
  insertSystem,
  moveMeasureAt,
  moveSystem
} from './structure-commands.js';
import { isEditingBlocked } from './view-state.js';

let installed = false;
let selected = null;
let contextTarget = null;
let dragState = null;
let activeDrop = null;
let dragPointer = null;

function toast(message) { window.showToast?.(message); }
function currentStore() { return window.editorV3?.getStore?.() || null; }

function focusNode(node) {
  if (!node) return;
  node.tabIndex = -1;
  try { node.focus({ preventScroll: true }); } catch { node.focus(); }
}

function setSelected(target) {
  selected = target || null;
  document.querySelectorAll('.editor-row-module.is-selected,.measure-module-hitbox.is-selected').forEach(node => node.classList.remove('is-selected'));
  if (!selected) return;
  if (selected.type === 'row') {
    const visualRow = Number(selected.visualRowIndex);
    const selector = Number.isInteger(visualRow)
      ? `.editor-row-module[data-visual-row="${visualRow}"]`
      : `.editor-row-module[data-row="${selected.rowIndex}"]`;
    const nodes = [...document.querySelectorAll(selector)];
    nodes.forEach(node => node.classList.add('is-selected'));
    const focusTarget = nodes[0];
    focusNode(focusTarget?.querySelector('.row-module-handle,.visual-row-handle') || focusTarget);
    return;
  }
  const node = document.querySelector(`.measure-module-hitbox[data-row="${selected.rowIndex}"][data-measure="${selected.measureIndex}"]`);
  node?.classList.add('is-selected');
  focusNode(node);
}

function closeMenu() {
  document.getElementById('editorModuleMenu')?.classList.remove('open');
  contextTarget = null;
}

function ensureMenu() {
  let menu = document.getElementById('editorModuleMenu');
  if (menu) return menu;
  menu = document.createElement('div');
  menu.id = 'editorModuleMenu';
  menu.className = 'editor-module-menu';
  menu.setAttribute('role', 'menu');
  document.body.appendChild(menu);
  return menu;
}

function commitResult(result, message, nextSelection = null) {
  const store = currentStore();
  if (!store || !result || result.document === store.getDocument()) return false;
  store.commit(result.document, result.changeSet);
  if (message) toast(message);
  if (nextSelection) requestAnimationFrame(() => setSelected(nextSelection));
  return true;
}

function copyTarget(target) { return window.editorV3?.clipboard?.copyModule?.(target) || false; }

function pasteTarget(target) {
  const ok = window.editorV3?.clipboard?.pasteModule?.(target) || false;
  if (ok) requestAnimationFrame(() => setSelected(target));
  return ok;
}

function structuralAction(target, action) {
  if (isEditingBlocked()) return false;
  const store = currentStore();
  if (!store) return false;
  const documentModel = store.getDocument();

  if (target.type === 'row') {
    if (action === 'insert-before') return commitResult(insertSystem(documentModel, target.rowIndex), `已新增第 ${target.rowIndex + 1} 列`, { type: 'row', rowIndex: target.rowIndex });
    if (action === 'insert-after') return commitResult(insertSystem(documentModel, target.rowIndex + 1), `已新增第 ${target.rowIndex + 2} 列`, { type: 'row', rowIndex: target.rowIndex + 1 });
    if (action === 'delete') {
      const result = target.measureIds?.length
        ? deleteMeasures(documentModel, target.measureIds)
        : deleteSystem(documentModel, target.rowIndex);
      return commitResult(result, `已刪除第 ${Number(target.visualRowIndex ?? target.rowIndex) + 1} 列`);
    }
  }

  if (target.type === 'measure') {
    const system = buildSystems(documentModel)[target.rowIndex] || [];
    if (action === 'delete' && system.length <= 1) {
      toast('每列至少保留1個小節');
      return false;
    }
    if (action === 'insert-before') {
      return commitResult(
        insertMeasureAt(documentModel, target.rowIndex, target.measureIndex, { overflowDirection: 'backward' }),
        '已在左方新增小節',
        target
      );
    }
    if (action === 'insert-after') {
      return commitResult(
        insertMeasureAt(documentModel, target.rowIndex, target.measureIndex + 1, { overflowDirection: 'forward' }),
        '已在右方新增小節',
        { ...target, measureIndex: target.measureIndex + 1 }
      );
    }
    if (action === 'delete') return commitResult(deleteMeasureAt(documentModel, target.rowIndex, target.measureIndex), '已刪除小節');
  }
  return false;
}

function insertSystemAtBoundary(index) {
  if (isEditingBlocked()) return false;
  const store = currentStore();
  if (!store) return false;
  const documentModel = store.getDocument();
  const count = buildSystems(documentModel).length;
  const boundary = Math.max(0, Math.min(count, Math.trunc(Number(index) || 0)));
  return commitResult(insertSystem(documentModel, boundary), `已新增第 ${boundary + 1} 列`, { type: 'row', rowIndex: boundary });
}

function openMenu(target, x, y) {
  if (isEditingBlocked()) return;
  setSelected(target);
  contextTarget = target;
  const menu = ensureMenu();
  menu.replaceChildren();
  const add = (label, fn, danger = false) => {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = `editor-module-menu-action${danger ? ' danger' : ''}`;
    action.textContent = label;
    action.addEventListener('click', () => { closeMenu(); fn(); });
    menu.appendChild(action);
  };
  add('複製', () => copyTarget(target));
  add('貼上', () => pasteTarget(target));
  if (target.type === 'measure') {
    add('在左方新增', () => structuralAction(target, 'insert-before'));
    add('在右方新增', () => structuralAction(target, 'insert-after'));
    add('刪除', () => structuralAction(target, 'delete'), true);
  } else {
    add('在上方新增列', () => structuralAction(target, 'insert-before'));
    add('在下方新增列', () => structuralAction(target, 'insert-after'));
    add('刪除列', () => structuralAction(target, 'delete'), true);
  }
  menu.classList.add('open');
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
}

function makeRowMoreButton(handle) {
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'row-module-more';
  more.textContent = '…';
  more.addEventListener('click', event => {
    event.stopPropagation();
    const target = rowTargetForSystem(handle.closest('.tab-system'));
    if (!target) return;
    const rect = more.getBoundingClientRect();
    openMenu(target, rect.right + 6, rect.top);
  });
  return more;
}

function makeRowHandle(target, { sourceStart = false } = {}) {
  const handle = document.createElement('div');
  handle.className = `system-label ${sourceStart ? 'row-module-handle' : 'visual-row-handle'}`;
  handle.dataset.row = String(target.rowIndex);
  handle.dataset.visualRow = String(target.visualRowIndex);
  const grip = document.createElement('span');
  grip.className = 'row-drag-grip';
  grip.textContent = '⠿';
  const label = document.createElement('span');
  label.className = 'row-module-label';
  const more = makeRowMoreButton(handle);
  handle.append(grip, label, more);
  syncHandleMetadata(handle, target);
  handle.addEventListener('pointerdown', event => {
    if (event.target.closest('button')) return;
    const current = rowTargetForSystem(handle.closest('.tab-system'));
    if (!current) return;
    beginPointerDrag(event, { type: 'row', rowIndex: current.rowIndex }, handle);
  });
  handle.addEventListener('contextmenu', event => {
    event.preventDefault();
    const current = rowTargetForSystem(handle.closest('.tab-system'));
    if (current) openMenu(current, event.clientX, event.clientY);
  });
  return handle;
}

function measureWidths(grid) {
  const count = Math.max(1, Number(grid?.dataset?.measureCount) || 1);
  const raw = String(grid?.dataset?.measureWidths || '').split(',').map(Number);
  if (raw.length === count && raw.every(value => Number.isFinite(value) && value > 0)) {
    const total = raw.reduce((sum, value) => sum + value, 0) || 100;
    return raw.map(value => value / total * 100);
  }
  return Array.from({ length: count }, () => 100 / count);
}

function boundaryPercent(grid, localBoundary) {
  const widths = measureWidths(grid);
  const safe = Math.max(0, Math.min(widths.length, Number(localBoundary) || 0));
  return widths.slice(0, safe).reduce((sum, value) => sum + value, 0);
}

function addMeasureUi(grid, rowIndex) {
  grid.querySelectorAll('.measure-module-hitbox,.measure-insert-boundary').forEach(node => node.remove());
  const start = Math.max(0, Number(grid.dataset.measureStart) || 0);
  const count = Math.max(1, Number(grid.dataset.measureCount) || 1);
  for (let localBoundary = 0; localBoundary <= count; localBoundary++) {
    const line = document.createElement('div');
    line.className = 'measure-insert-boundary';
    line.dataset.boundary = String(start + localBoundary);
    line.style.left = `${boundaryPercent(grid, localBoundary)}%`;
    grid.appendChild(line);
  }
  for (let localMeasure = 0; localMeasure < count; localMeasure++) {
    const measureIndex = start + localMeasure;
    const left = boundaryPercent(grid, localMeasure);
    const right = boundaryPercent(grid, localMeasure + 1);
    const hitbox = document.createElement('div');
    hitbox.className = 'measure-module-hitbox';
    hitbox.dataset.row = String(rowIndex);
    hitbox.dataset.measure = String(measureIndex);
    hitbox.style.left = `${left}%`;
    hitbox.style.width = `${Math.max(0, right - left)}%`;
    hitbox.addEventListener('pointerdown', event => beginPointerDrag(event, { type: 'measure', rowIndex, measureIndex }, hitbox));
    hitbox.addEventListener('contextmenu', event => { event.preventDefault(); openMenu({ type: 'measure', rowIndex, measureIndex }, event.clientX, event.clientY); });
    grid.appendChild(hitbox);
  }
}

function makeInsertZone(index) {
  const zone = document.createElement('div');
  zone.className = 'row-insert-zone';
  zone.dataset.insertIndex = String(index);
  const controls = document.createElement('div');
  controls.className = 'row-insert-controls';
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'row-boundary-button row-boundary-add';
  add.setAttribute('aria-label', `在第 ${index + 1} 列位置新增列`);
  add.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13"/></svg>';
  add.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    insertSystemAtBoundary(index);
  });
  controls.appendChild(add);
  zone.appendChild(controls);
  return zone;
}

function measureIdsForSystem(system) {
  return [...system.querySelectorAll('.v3-grid')]
    .flatMap(grid => String(grid.dataset.measureIds || '').split(',').filter(Boolean));
}

function rowTargetForSystem(system) {
  if (!system) return null;
  const rowIndex = Number(system.dataset.sourceRow ?? system.dataset.row);
  const visualRowIndex = Number(system.dataset.visualRow);
  if (!Number.isInteger(rowIndex) || !Number.isInteger(visualRowIndex)) return null;
  return { type: 'row', rowIndex, visualRowIndex, measureIds: measureIdsForSystem(system) };
}

function syncHandleMetadata(handle, target) {
  if (!handle || !target) return;
  handle.dataset.row = String(target.rowIndex);
  handle.dataset.visualRow = String(target.visualRowIndex);
  handle.setAttribute('aria-label', `第 ${target.visualRowIndex + 1} 列，可拖曳其來源列排序`);
  const label = handle.querySelector('.row-module-label');
  if (label) label.textContent = `第 ${target.visualRowIndex + 1} 列`;
  handle.querySelector('.row-module-more')?.setAttribute('aria-label', `第 ${target.visualRowIndex + 1} 列操作`);
}

function syncVisualRowMetadata(system, visualRowIndex) {
  system.dataset.visualRow = String(visualRowIndex);
  const target = rowTargetForSystem(system);
  if (!target) return;
  syncHandleMetadata(system.querySelector('.row-module-handle,.visual-row-handle'), target);
}

function syncSelectedRow(systems) {
  if (selected?.type !== 'row') return;
  const matching = systems.filter(system => Number(system.dataset.sourceRow ?? system.dataset.row) === Number(selected.rowIndex));
  if (!matching.length) return;
  const current = matching.find(system => Number(system.dataset.visualRow) === Number(selected.visualRowIndex)) || matching[0];
  const target = rowTargetForSystem(current);
  if (target) selected = target;
}

function decorateSystem(system, visualRowIndex) {
  const rowIndex = Number(system.dataset.sourceRow ?? system.dataset.row);
  const sourceStart = system.dataset.sourceStart !== 'false';
  if (!Number.isInteger(rowIndex)) return null;
  system.classList.add('editor-row-module');
  system.dataset.row = String(rowIndex);
  system.dataset.visualRow = String(visualRowIndex);
  system.querySelector('.row-module-handle,.visual-row-handle')?.remove();
  system.querySelector('.layout-rail-placeholder')?.remove();
  const target = { type: 'row', rowIndex, visualRowIndex, measureIds: measureIdsForSystem(system) };
  system.prepend(makeRowHandle(target, { sourceStart }));
  system.querySelectorAll('.v3-grid').forEach(grid => addMeasureUi(grid, rowIndex));
  return { rowIndex, sourceStart };
}

function decorateEditor() {
  if (isEditingBlocked()) return;
  const tabArea = document.getElementById('tabArea');
  if (!tabArea) return;
  tabArea.querySelectorAll('.row-insert-zone').forEach(node => node.remove());
  const systems = [...tabArea.querySelectorAll(':scope > .tab-system')];
  let logicalRowCount = 0;
  systems.forEach((system, visualRowIndex) => {
    const decorated = decorateSystem(system, visualRowIndex);
    if (!decorated) return;
    logicalRowCount = Math.max(logicalRowCount, decorated.rowIndex + 1);
    if (decorated.sourceStart) tabArea.insertBefore(makeInsertZone(decorated.rowIndex), system);
  });
  tabArea.appendChild(makeInsertZone(logicalRowCount));
  syncSelectedRow(systems);
  if (selected) setSelected(selected);
}

function decorateSourceSystem(sourceSystemIndex, {
  segmentationChanged = false,
  visualRowStart = 0,
  visualRowCount = 0
} = {}) {
  if (isEditingBlocked()) return;
  const tabArea = document.getElementById('tabArea');
  if (!tabArea) return;
  const start = Math.max(0, Math.trunc(Number(visualRowStart) || 0));
  const count = Math.max(0, Math.trunc(Number(visualRowCount) || 0));

  if (segmentationChanged) {
    const systems = [...tabArea.querySelectorAll(':scope > .tab-system')];
    const affected = systems.slice(start, start + count);
    affected.forEach((system, index) => decorateSystem(system, start + index));
    for (let visualRowIndex = start + affected.length; visualRowIndex < systems.length; visualRowIndex++) {
      syncVisualRowMetadata(systems[visualRowIndex], visualRowIndex);
    }
    syncSelectedRow(systems);
    if (selected) setSelected(selected);
    return;
  }

  const affected = [...tabArea.querySelectorAll(`:scope > .tab-system[data-source-row="${sourceSystemIndex}"]`)];
  affected.forEach((system, index) => decorateSystem(system, start + index));
  syncSelectedRow(affected);
  if (selected) setSelected(selected);
}

function handleRendered(event) {
  const detail = event?.detail || {};
  if (detail.full) {
    decorateEditor();
    return;
  }
  if (detail.sourceSystemIndex == null) return;
  const sourceSystemIndex = Number(detail.sourceSystemIndex);
  if (Number.isInteger(sourceSystemIndex)) {
    decorateSourceSystem(sourceSystemIndex, {
      segmentationChanged: Boolean(detail.segmentationChanged),
      visualRowStart: detail.visualRowStart,
      visualRowCount: detail.visualRowCount
    });
  }
}

function beginPointerDrag(event, state, sourceNode) {
  if (isEditingBlocked() || event.button !== 0 || dragPointer) return;
  event.preventDefault();
  dragState = state;
  dragPointer = {
    pointerId: event.pointerId,
    sourceNode,
    visualNode: state.type === 'row' ? sourceNode.closest('.editor-row-module') : sourceNode,
    startX: event.clientX,
    startY: event.clientY,
    active: false
  };
  clearDropUi();
  try { sourceNode.setPointerCapture?.(event.pointerId); } catch {}
}

function hitAtPoint(selector, x, y) {
  for (const node of document.elementsFromPoint(x, y)) {
    const match = node.closest?.(selector);
    if (match) return match;
  }
  return null;
}

function rowDropTarget(x, y) {
  const zone = hitAtPoint('.row-insert-zone', x, y);
  if (zone) {
    const index = Number(zone.dataset.insertIndex);
    return Number.isInteger(index) ? { type: 'row', index, node: zone } : null;
  }
  const row = hitAtPoint('.editor-row-module', x, y);
  if (!row) return null;
  const rowIndex = Number(row.dataset.sourceRow ?? row.dataset.row);
  if (!Number.isInteger(rowIndex)) return null;
  const rect = row.getBoundingClientRect();
  const index = rowIndex + (y >= rect.top + rect.height / 2 ? 1 : 0);
  const node = document.querySelector(`.row-insert-zone[data-insert-index="${index}"]`) || row;
  return { type: 'row', index, node };
}

function measureDropTarget(x, y) {
  const hitbox = hitAtPoint('.measure-module-hitbox', x, y);
  if (!hitbox) return null;
  const rowIndex = Number(hitbox.dataset.row);
  const measureIndex = Number(hitbox.dataset.measure);
  if (!Number.isInteger(rowIndex) || !Number.isInteger(measureIndex)) return null;
  const rect = hitbox.getBoundingClientRect();
  const boundary = measureIndex + (x >= rect.left + rect.width / 2 ? 1 : 0);
  const grid = hitbox.closest('.v3-grid');
  const node = grid?.querySelector(`.measure-insert-boundary[data-boundary="${boundary}"]`) || hitbox;
  return { type: 'measure', rowIndex, boundary, node };
}

function updateDropUi(clientX, clientY) {
  if (!dragState) { clearDropUi(); return; }
  setActiveDrop(dragState.type === 'row'
    ? rowDropTarget(clientX, clientY)
    : measureDropTarget(clientX, clientY));
}

function commitDrop() {
  const store = currentStore();
  if (!store || !dragState || !activeDrop) return;
  const documentModel = store.getDocument();
  if (dragState.type === 'row' && activeDrop.type === 'row') {
    commitResult(moveSystem(documentModel, dragState.rowIndex, activeDrop.index), '已移動列');
  } else if (dragState.type === 'measure' && activeDrop.type === 'measure') {
    commitResult(moveMeasureAt(documentModel, dragState.rowIndex, dragState.measureIndex, activeDrop.rowIndex, activeDrop.boundary), '已移動小節');
  }
}

function resetDrag() {
  if (dragPointer?.visualNode) dragPointer.visualNode.classList.remove('is-dragging');
  if (dragPointer?.sourceNode && dragPointer.pointerId != null) {
    try {
      if (dragPointer.sourceNode.hasPointerCapture?.(dragPointer.pointerId)) dragPointer.sourceNode.releasePointerCapture(dragPointer.pointerId);
    } catch {}
  }
  document.documentElement.classList.remove('row-drag-active');
  dragPointer = null;
  dragState = null;
  clearDropUi();
}

function handlePointerMove(event) {
  if (!dragPointer || event.pointerId !== dragPointer.pointerId || isEditingBlocked()) return;
  if (!dragPointer.active) {
    const distance = Math.hypot(event.clientX - dragPointer.startX, event.clientY - dragPointer.startY);
    if (distance < 5) return;
    dragPointer.active = true;
    dragPointer.visualNode?.classList.add('is-dragging');
    if (dragState?.type === 'row') document.documentElement.classList.add('row-drag-active');
  }
  event.preventDefault();
  updateDropUi(event.clientX, event.clientY);
}

function finishPointerDrag(event, cancelled = false) {
  if (!dragPointer || event.pointerId !== dragPointer.pointerId) return;
  const state = dragState;
  const active = dragPointer.active;
  if (active && !cancelled) {
    updateDropUi(event.clientX, event.clientY);
    commitDrop();
  } else if (!active && !cancelled && state) {
    if (state.type === 'row') setSelected({ type: 'row', rowIndex: state.rowIndex });
    else setSelected({ type: 'measure', rowIndex: state.rowIndex, measureIndex: state.measureIndex });
  }
  resetDrag();
}

function installDragHandlers() {
  document.addEventListener('pointermove', handlePointerMove, { capture: true, passive: false });
  document.addEventListener('pointerup', event => finishPointerDrag(event), true);
  document.addEventListener('pointercancel', event => finishPointerDrag(event, true), true);
  window.addEventListener('blur', resetDrag);
}

function installGlobalActions() {
  window.copyRow = rowIndex => { setSelected({ type: 'row', rowIndex }); copyTarget(selected); };
  window.pasteRow = rowIndex => { setSelected({ type: 'row', rowIndex }); pasteTarget(selected); };
  window.addTabSystem = () => {
    const count = buildSystems(currentStore()?.getDocument() || { measures: [] }).length;
    insertSystemAtBoundary(count);
  };
  window.removeLastTabSystem = () => {
    const count = buildSystems(currentStore()?.getDocument() || { measures: [] }).length;
    if (count > 1) structuralAction({ type: 'row', rowIndex: count - 1 }, 'delete');
  };
}

function installKeyboard() {
  document.addEventListener('keydown', event => {
    if (isEditingBlocked() || !(event.ctrlKey || event.metaKey) || !selected) return;
    if (event.target.closest('input,textarea,[contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    if (key === 'c') { event.preventDefault(); copyTarget(selected); }
    if (key === 'v') { event.preventDefault(); pasteTarget(selected); }
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('#editorModuleMenu,.row-module-more')) closeMenu();
  });
}

export function installStructureController() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  installGlobalActions();
  installKeyboard();
  installDragHandlers();
  window.addEventListener('opentab:editor-rendered', handleRendered);
  decorateEditor();
  if (window.editorV3) window.editorV3.structure = { decorate: decorateEditor, selected: () => selected };
}
