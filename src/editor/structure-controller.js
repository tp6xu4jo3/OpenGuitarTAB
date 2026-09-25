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

let installed = false;
let selected = null;
let contextTarget = null;
let dragState = null;
let activeDrop = null;

function editingBlocked() {
  const editorView = document.getElementById('editorView');
  const previewBadge = document.getElementById('previewBadge');
  return Boolean(editorView?.hidden || editorView?.classList.contains('score-view') || (previewBadge && !previewBadge.hidden));
}

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
  window.editorPlayback?.invalidate?.();
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
  if (editingBlocked()) return false;
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
  if (editingBlocked()) return false;
  const store = currentStore();
  if (!store) return false;
  const documentModel = store.getDocument();
  const count = buildSystems(documentModel).length;
  const boundary = Math.max(0, Math.min(count, Math.trunc(Number(index) || 0)));
  return commitResult(insertSystem(documentModel, boundary), `已新增第 ${boundary + 1} 列`, { type: 'row', rowIndex: boundary });
}

function openMenu(target, x, y) {
  if (editingBlocked()) return;
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

function makeRowMoreButton(target) {
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'row-module-more';
  more.textContent = '…';
  more.setAttribute('aria-label', `第 ${Number(target.visualRowIndex) + 1} 列操作`);
  more.addEventListener('click', event => {
    event.stopPropagation();
    const rect = more.getBoundingClientRect();
    openMenu(target, rect.right + 6, rect.top);
  });
  return more;
}

function makeRowHandle(target, { sourceStart = false } = {}) {
  const handle = document.createElement('div');
  handle.className = `system-label ${sourceStart ? 'row-module-handle' : 'visual-row-handle'}`;
  handle.draggable = true;
  handle.dataset.row = String(target.rowIndex);
  handle.dataset.visualRow = String(target.visualRowIndex);
  handle.setAttribute('aria-label', `第 ${Number(target.visualRowIndex) + 1} 列，可拖曳其來源列排序`);
  const grip = document.createElement('span');
  grip.className = 'row-drag-grip';
  grip.textContent = '⠿';
  const label = document.createElement('span');
  label.className = 'row-module-label';
  label.textContent = `第 ${Number(target.visualRowIndex) + 1} 列`;
  handle.append(grip, label, makeRowMoreButton(target));
  handle.addEventListener('click', event => { if (!event.target.closest('button')) setSelected(target); });
  handle.addEventListener('contextmenu', event => { event.preventDefault(); openMenu(target, event.clientX, event.clientY); });
  handle.addEventListener('dragstart', event => {
    dragState = { type: 'row', rowIndex: target.rowIndex };
    event.dataTransfer?.setData('text/plain', `row:${target.rowIndex}`);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
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
    hitbox.draggable = true;
    hitbox.addEventListener('click', () => setSelected({ type: 'measure', rowIndex, measureIndex }));
    hitbox.addEventListener('contextmenu', event => { event.preventDefault(); openMenu({ type: 'measure', rowIndex, measureIndex }, event.clientX, event.clientY); });
    hitbox.addEventListener('dragstart', event => {
      dragState = { type: 'measure', rowIndex, measureIndex };
      event.dataTransfer?.setData('text/plain', `measure:${rowIndex}:${measureIndex}`);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
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

function decorateEditor() {
  if (editingBlocked()) return;
  const tabArea = document.getElementById('tabArea');
  if (!tabArea) return;
  tabArea.querySelectorAll('.row-insert-zone').forEach(node => node.remove());
  const systems = [...tabArea.querySelectorAll(':scope > .tab-system')];
  let logicalRowCount = 0;
  systems.forEach((system, visualRowIndex) => {
    const rowIndex = Number(system.dataset.sourceRow ?? system.dataset.row);
    const sourceStart = system.dataset.sourceStart !== 'false';
    if (!Number.isInteger(rowIndex)) return;
    logicalRowCount = Math.max(logicalRowCount, rowIndex + 1);
    system.classList.add('editor-row-module');
    system.dataset.row = String(rowIndex);
    system.dataset.visualRow = String(visualRowIndex);
    system.querySelector('.row-module-handle,.visual-row-handle')?.remove();
    system.querySelector('.layout-rail-placeholder')?.remove();
    const target = { type: 'row', rowIndex, visualRowIndex, measureIds: measureIdsForSystem(system) };
    system.prepend(makeRowHandle(target, { sourceStart }));
    system.querySelectorAll('.v3-grid').forEach(grid => addMeasureUi(grid, rowIndex));
    if (sourceStart) tabArea.insertBefore(makeInsertZone(rowIndex), system);
  });
  tabArea.appendChild(makeInsertZone(logicalRowCount));
  if (selected) setSelected(selected);
}

function rowBoundaryFromPoint(y) {
  const zones = [...document.querySelectorAll('.row-insert-zone')];
  let best = null;
  zones.forEach(zone => {
    const rect = zone.getBoundingClientRect();
    const distance = Math.abs(y - (rect.top + rect.height / 2));
    if (!best || distance < best.distance) best = { index: Number(zone.dataset.insertIndex), zone, distance };
  });
  return best && best.distance <= 42 ? best : null;
}

function measureBoundaryFromPoint(x, y) {
  const pointed = document.elementFromPoint(x, y);
  const grid = pointed?.closest?.('.v3-grid[data-row]');
  if (!grid) return null;
  const rect = grid.getBoundingClientRect();
  const rowIndex = Number(grid.dataset.row);
  const start = Math.max(0, Number(grid.dataset.measureStart) || 0);
  const count = Math.max(1, Number(grid.dataset.measureCount) || 1);
  const ratio = Math.max(0, Math.min(100, ((x - rect.left) / Math.max(1, rect.width)) * 100));
  let bestLocal = 0;
  let bestDistance = Infinity;
  for (let localBoundary = 0; localBoundary <= count; localBoundary++) {
    const distance = Math.abs(ratio - boundaryPercent(grid, localBoundary));
    if (distance < bestDistance) { bestDistance = distance; bestLocal = localBoundary; }
  }
  return { rowIndex, boundary: start + bestLocal, grid };
}

function clearDropUi() {
  document.querySelectorAll('.measure-insert-boundary.is-active,.row-insert-zone.is-drag-target').forEach(node => node.classList.remove('is-active', 'is-drag-target'));
  activeDrop = null;
}

function updateDropUi(event) {
  clearDropUi();
  if (!dragState) return;
  if (dragState.type === 'row') {
    const target = rowBoundaryFromPoint(event.clientY);
    if (!target) return;
    target.zone.classList.add('is-drag-target');
    activeDrop = { type: 'row', index: target.index };
    return;
  }
  const target = measureBoundaryFromPoint(event.clientX, event.clientY);
  if (!target) return;
  target.grid.querySelector(`.measure-insert-boundary[data-boundary="${target.boundary}"]`)?.classList.add('is-active');
  activeDrop = { type: 'measure', rowIndex: target.rowIndex, boundary: target.boundary };
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

function installDragHandlers() {
  document.addEventListener('dragover', event => {
    if (!dragState || editingBlocked()) return;
    event.preventDefault();
    updateDropUi(event);
  }, true);
  document.addEventListener('drop', event => {
    if (!dragState || editingBlocked()) return;
    event.preventDefault();
    event.stopPropagation();
    updateDropUi(event);
    commitDrop();
    dragState = null;
    clearDropUi();
  }, true);
  window.addEventListener('dragend', () => { dragState = null; clearDropUi(); }, true);
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
    if (editingBlocked() || !(event.ctrlKey || event.metaKey) || !selected) return;
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
  window.addEventListener('opentab:editor-rendered', decorateEditor);
  decorateEditor();
  if (window.editorV3) window.editorV3.structure = { decorate: decorateEditor, selected: () => selected };
}
