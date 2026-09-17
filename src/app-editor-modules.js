(() => {
  let selectedModule = null;
  let moduleClipboard = null;
  let dragPayload = null;
  let contextTarget = null;

  const originalCreateTabSystem = createTabSystem;
  const originalRenderRows = renderRows;

  function currentRhythmRows(rowCount) {
    const source = currentSong()?.rhythmRows;
    return Array.from({ length: rowCount }, (_, index) => deepClone(source?.[index] || {}));
  }

  function setSelectedModule(type, rowIndex, measureIndex = null) {
    selectedModule = { type, rowIndex, measureIndex };
    document.querySelectorAll('.editor-row-module.is-selected,.measure-module-hitbox.is-selected').forEach(node => node.classList.remove('is-selected'));
    if (type === 'row') {
      document.querySelector(`.editor-row-module[data-row="${rowIndex}"]`)?.classList.add('is-selected');
    } else {
      document.querySelector(`.measure-module-hitbox[data-row="${rowIndex}"][data-measure="${measureIndex}"]`)?.classList.add('is-selected');
    }
  }

  function clearDragFeedback() {
    document.querySelectorAll('.drop-before,.drop-after,.is-dragging').forEach(node => node.classList.remove('drop-before', 'drop-after', 'is-dragging'));
  }

  function extractMeasure(rows, rhythmRows, rowIndex, measureIndex) {
    const width = slotsPerMeasure();
    const start = measureIndex * width;
    const end = start + width;
    const notes = Array.from({ length: STRINGS }, (_, string) => rows[rowIndex][string].slice(start, end));
    const rhythm = {};
    for (const [rawPosition, rawDuration] of Object.entries(rhythmRows[rowIndex] || {})) {
      const position = Number(rawPosition);
      if (position >= start && position < end) rhythm[position - start] = Number(rawDuration);
    }
    return { notes, rhythm };
  }

  function buildRowsFromMeasures(measures, rowCount) {
    const width = slotsPerMeasure();
    const rows = Array.from({ length: rowCount }, () => blankRow());
    const rhythmRows = Array.from({ length: rowCount }, () => ({}));
    measures.forEach((measure, flatIndex) => {
      const rowIndex = Math.floor(flatIndex / MEASURES);
      const measureIndex = flatIndex % MEASURES;
      if (rowIndex >= rowCount) return;
      const offset = measureIndex * width;
      for (let string = 0; string < STRINGS; string++) {
        const values = measure.notes?.[string] || [];
        for (let position = 0; position < width; position++) rows[rowIndex][string][offset + position] = normalizeTabValue(values[position]);
      }
      for (const [rawPosition, rawDuration] of Object.entries(measure.rhythm || {})) {
        const localPosition = Number(rawPosition);
        if (localPosition >= 0 && localPosition < width) rhythmRows[rowIndex][offset + localPosition] = Number(rawDuration);
      }
    });
    return { rows, rhythmRows };
  }

  function blankMeasureModule() {
    const width = slotsPerMeasure();
    return {
      notes: Array.from({ length: STRINGS }, () => Array(width).fill('')),
      rhythm: {}
    };
  }

  function flattenMeasureModules(rows, rhythmRows) {
    const measures = [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      for (let measureIndex = 0; measureIndex < MEASURES; measureIndex++) {
        measures.push(extractMeasure(rows, rhythmRows, rowIndex, measureIndex));
      }
    }
    return measures;
  }

  function commitMeasureModules(measures, message, selectedFlatIndex = null) {
    while (measures.length % MEASURES !== 0) measures.push(blankMeasureModule());
    if (measures.length === 0) {
      for (let i = 0; i < MEASURES; i++) measures.push(blankMeasureModule());
    }
    const rowCount = Math.max(1, Math.ceil(measures.length / MEASURES));
    const rebuilt = buildRowsFromMeasures(measures, rowCount);
    if (selectedFlatIndex !== null) {
      const safeFlat = Math.max(0, Math.min(measures.length - 1, selectedFlatIndex));
      selectedModule = {
        type: 'measure',
        rowIndex: Math.floor(safeFlat / MEASURES),
        measureIndex: safeFlat % MEASURES
      };
    }
    commitStructure(rebuilt.rows, rebuilt.rhythmRows, message);
  }

  function insertMeasureBeside(target, side) {
    if (!target || target.type !== 'measure' || previewSong || scoreViewEnabled) return;
    const rows = readRowsFromDom();
    const rhythmRows = currentRhythmRows(rows.length);
    const measures = flattenMeasureModules(rows, rhythmRows);
    const flatIndex = target.rowIndex * MEASURES + target.measureIndex;
    const insertIndex = flatIndex + (side === 'right' ? 1 : 0);
    measures.splice(insertIndex, 0, blankMeasureModule());
    commitMeasureModules(measures, side === 'right' ? '已在右方新增小節' : '已在左方新增小節', insertIndex);
  }

  function deleteMeasureModule(target) {
    if (!target || target.type !== 'measure' || previewSong || scoreViewEnabled) return;
    const rows = readRowsFromDom();
    const rhythmRows = currentRhythmRows(rows.length);
    const measures = flattenMeasureModules(rows, rhythmRows);
    const flatIndex = target.rowIndex * MEASURES + target.measureIndex;
    if (!measures[flatIndex]) return;
    measures.splice(flatIndex, 1);
    commitMeasureModules(measures, '已刪除小節', Math.min(flatIndex, Math.max(0, measures.length - 1)));
  }

  function commitStructure(rows, rhythmRows, message) {
    const song = currentSong();
    if (!song || previewSong) return;
    song.rows = normalizeRows(rows, song.beatsPerMeasure);
    song.rhythmRows = rhythmRows;
    song.updatedAt = Date.now();
    writeStorage();
    renderRows(song.rows);
    renderSongList();
    renderLibraryGrid();
    if (message) showToast(message);
  }

  function copySelectedModule(target = selectedModule) {
    if (!target || previewSong || scoreViewEnabled) return;
    const rows = readRowsFromDom();
    const rhythmRows = currentRhythmRows(rows.length);
    if (target.type === 'row') {
      moduleClipboard = { type: 'row', row: deepClone(rows[target.rowIndex]), rhythm: deepClone(rhythmRows[target.rowIndex] || {}) };
      rowClipboard = deepClone(rows[target.rowIndex]);
      showToast(`已複製第 ${target.rowIndex + 1} 列`);
      return;
    }
    moduleClipboard = { type: 'measure', measure: extractMeasure(rows, rhythmRows, target.rowIndex, target.measureIndex) };
    showToast(`已複製第 ${target.rowIndex + 1} 列第 ${target.measureIndex + 1} 小節`);
  }

  function pasteSelectedModule(target = selectedModule) {
    if (!target || !moduleClipboard || previewSong || scoreViewEnabled) {
      if (!moduleClipboard) showToast('目前沒有可貼上的模塊');
      return;
    }
    const rows = readRowsFromDom();
    const rhythmRows = currentRhythmRows(rows.length);
    if (target.type === 'row' && moduleClipboard.type === 'row') {
      rows[target.rowIndex] = deepClone(moduleClipboard.row);
      rhythmRows[target.rowIndex] = deepClone(moduleClipboard.rhythm || {});
      commitStructure(rows, rhythmRows, `已貼到第 ${target.rowIndex + 1} 列`);
      return;
    }
    if (target.type === 'measure' && moduleClipboard.type === 'measure') {
      const width = slotsPerMeasure();
      const offset = target.measureIndex * width;
      for (let string = 0; string < STRINGS; string++) {
        for (let position = 0; position < width; position++) rows[target.rowIndex][string][offset + position] = normalizeTabValue(moduleClipboard.measure.notes?.[string]?.[position]);
      }
      const nextRhythm = {};
      for (const [rawPosition, rawDuration] of Object.entries(rhythmRows[target.rowIndex] || {})) {
        const position = Number(rawPosition);
        if (position < offset || position >= offset + width) nextRhythm[position] = rawDuration;
      }
      for (const [rawPosition, rawDuration] of Object.entries(moduleClipboard.measure.rhythm || {})) nextRhythm[offset + Number(rawPosition)] = Number(rawDuration);
      rhythmRows[target.rowIndex] = nextRhythm;
      commitStructure(rows, rhythmRows, `已貼到第 ${target.rowIndex + 1} 列第 ${target.measureIndex + 1} 小節`);
      return;
    }
    showToast(target.type === 'row' ? '請先複製整列模塊' : '請先複製小節模塊');
  }

  function deleteSelectedRow(rowIndex) {
    const rows = readRowsFromDom();
    if (rows.length <= 1) { showToast('至少保留一列'); return; }
    const rhythmRows = currentRhythmRows(rows.length);
    rows.splice(rowIndex, 1);
    rhythmRows.splice(rowIndex, 1);
    selectedModule = null;
    commitStructure(rows, rhythmRows, `已刪除第 ${rowIndex + 1} 列`);
  }

  function insertRowAt(index) {
    if (previewSong || scoreViewEnabled) return;
    const rows = readRowsFromDom();
    const rhythmRows = currentRhythmRows(rows.length);
    const safeIndex = Math.max(0, Math.min(rows.length, index));
    rows.splice(safeIndex, 0, blankRow());
    rhythmRows.splice(safeIndex, 0, {});
    selectedModule = { type: 'row', rowIndex: safeIndex, measureIndex: null };
    commitStructure(rows, rhythmRows, `已新增第 ${safeIndex + 1} 列`);
  }

  function moveRow(fromIndex, insertionIndex) {
    const rows = readRowsFromDom();
    const rhythmRows = currentRhythmRows(rows.length);
    if (!rows[fromIndex]) return;
    const [row] = rows.splice(fromIndex, 1);
    const [rhythm] = rhythmRows.splice(fromIndex, 1);
    let target = insertionIndex;
    if (fromIndex < target) target -= 1;
    target = Math.max(0, Math.min(rows.length, target));
    rows.splice(target, 0, row);
    rhythmRows.splice(target, 0, rhythm);
    selectedModule = { type: 'row', rowIndex: target, measureIndex: null };
    commitStructure(rows, rhythmRows, '已移動列模塊');
  }

  function moveMeasure(sourceFlatIndex, insertionIndex) {
    const rows = readRowsFromDom();
    const rhythmRows = currentRhythmRows(rows.length);
    const measures = [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      for (let measureIndex = 0; measureIndex < MEASURES; measureIndex++) measures.push(extractMeasure(rows, rhythmRows, rowIndex, measureIndex));
    }
    if (!measures[sourceFlatIndex]) return;
    const [measure] = measures.splice(sourceFlatIndex, 1);
    let target = insertionIndex;
    if (sourceFlatIndex < target) target -= 1;
    target = Math.max(0, Math.min(measures.length, target));
    measures.splice(target, 0, measure);
    const rebuilt = buildRowsFromMeasures(measures, rows.length);
    selectedModule = { type: 'measure', rowIndex: Math.floor(target / MEASURES), measureIndex: target % MEASURES };
    commitStructure(rebuilt.rows, rebuilt.rhythmRows, '已移動小節模塊');
  }

  function ensureContextMenu() {
    let menu = document.getElementById('editorModuleMenu');
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'editorModuleMenu';
    menu.className = 'editor-module-menu';
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
    return menu;
  }

  function closeContextMenu() {
    const menu = document.getElementById('editorModuleMenu');
    if (menu) menu.classList.remove('open');
    contextTarget = null;
  }

  function openContextMenu(target, x, y) {
    if (previewSong || scoreViewEnabled) return;
    setSelectedModule(target.type, target.rowIndex, target.measureIndex);
    contextTarget = target;
    const menu = ensureContextMenu();
    menu.innerHTML = '';
    const makeAction = (label, action, danger = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `editor-module-menu-action${danger ? ' danger' : ''}`;
      button.textContent = label;
      button.addEventListener('click', () => { closeContextMenu(); action(); });
      menu.appendChild(button);
    };
    makeAction('複製', () => copySelectedModule(target));
    makeAction('貼上', () => pasteSelectedModule(target));
    if (target.type === 'measure') {
      makeAction('在左方新增', () => insertMeasureBeside(target, 'left'));
      makeAction('在右方新增', () => insertMeasureBeside(target, 'right'));
      makeAction('刪除', () => deleteMeasureModule(target), true);
    } else if (target.type === 'row') {
      makeAction('在上方新增列', () => insertRowAt(target.rowIndex));
      makeAction('在下方新增列', () => insertRowAt(target.rowIndex + 1));
      makeAction('刪除列', () => deleteSelectedRow(target.rowIndex), true);
    }
    menu.classList.add('open');
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
  }

  function createRowHandle(rowIndex) {
    const label = makeDiv('system-label row-module-handle');
    label.draggable = true;
    label.dataset.row = rowIndex;
    label.setAttribute('aria-label', `第 ${rowIndex + 1} 列，可拖曳排序`);
    const grip = document.createElement('span');
    grip.className = 'row-drag-grip';
    grip.textContent = '⠿';
    const labelText = document.createElement('span');
    labelText.className = 'row-module-label';
    labelText.textContent = `第 ${rowIndex + 1} 列`;
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'row-module-more';
    more.textContent = '…';
    more.setAttribute('aria-label', `第 ${rowIndex + 1} 列操作`);
    more.addEventListener('click', event => {
      event.stopPropagation();
      const rect = more.getBoundingClientRect();
      openContextMenu({ type: 'row', rowIndex, measureIndex: null }, rect.right + 6, rect.top);
    });
    label.append(grip, labelText, more);
    label.addEventListener('click', event => { if (!event.target.closest('button')) setSelectedModule('row', rowIndex); });
    label.addEventListener('contextmenu', event => { event.preventDefault(); openContextMenu({ type: 'row', rowIndex, measureIndex: null }, event.clientX, event.clientY); });
    label.addEventListener('dragstart', event => {
      dragPayload = { type: 'row', rowIndex };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', `row:${rowIndex}`);
      label.closest('.editor-row-module')?.classList.add('is-dragging');
    });
    label.addEventListener('dragend', () => { dragPayload = null; clearDragFeedback(); });
    return label;
  }

  function installMeasureHitboxes(grid, rowIndex) {
    for (let measureIndex = 0; measureIndex < MEASURES; measureIndex++) {
      const hitbox = makeDiv('measure-module-hitbox');
      hitbox.dataset.row = rowIndex;
      hitbox.dataset.measure = measureIndex;
      hitbox.style.left = `${measureIndex * 25}%`;
      hitbox.style.width = '25%';
      hitbox.draggable = true;
      const badge = document.createElement('span');
      badge.className = 'measure-module-badge';
      badge.textContent = `${measureIndex + 1}`;
      hitbox.appendChild(badge);
      hitbox.addEventListener('click', () => setSelectedModule('measure', rowIndex, measureIndex));
      hitbox.addEventListener('contextmenu', event => { event.preventDefault(); openContextMenu({ type: 'measure', rowIndex, measureIndex }, event.clientX, event.clientY); });
      hitbox.addEventListener('dragstart', event => {
        const flatIndex = rowIndex * MEASURES + measureIndex;
        dragPayload = { type: 'measure', flatIndex };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', `measure:${flatIndex}`);
        hitbox.classList.add('is-dragging');
      });
      hitbox.addEventListener('dragover', event => {
        if (dragPayload?.type !== 'measure') return;
        event.preventDefault();
        const rect = hitbox.getBoundingClientRect();
        const after = event.clientX > rect.left + rect.width / 2;
        hitbox.classList.toggle('drop-before', !after);
        hitbox.classList.toggle('drop-after', after);
      });
      hitbox.addEventListener('dragleave', () => hitbox.classList.remove('drop-before', 'drop-after'));
      hitbox.addEventListener('drop', event => {
        if (dragPayload?.type !== 'measure') return;
        event.preventDefault();
        const rect = hitbox.getBoundingClientRect();
        const after = event.clientX > rect.left + rect.width / 2;
        const targetFlat = rowIndex * MEASURES + measureIndex + (after ? 1 : 0);
        const sourceFlat = dragPayload.flatIndex;
        dragPayload = null;
        clearDragFeedback();
        moveMeasure(sourceFlat, targetFlat);
      });
      hitbox.addEventListener('dragend', () => { dragPayload = null; clearDragFeedback(); });
      grid.appendChild(hitbox);
    }
  }

  function createEditorTabSystem(rowIndex, rowCount) {
    const system = makeDiv('tab-system editor-row-module');
    system.dataset.row = rowIndex;
    system.appendChild(createRowHandle(rowIndex));

    const baseSystem = originalCreateTabSystem(rowIndex, rowCount);
    const grid = baseSystem.querySelector('.tab-grid');
    installMeasureHitboxes(grid, rowIndex);
    system.appendChild(grid);

    system.addEventListener('dragover', event => {
      if (dragPayload?.type !== 'row') return;
      event.preventDefault();
      const rect = system.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      system.classList.toggle('drop-before', !after);
      system.classList.toggle('drop-after', after);
    });
    system.addEventListener('dragleave', event => {
      if (!system.contains(event.relatedTarget)) system.classList.remove('drop-before', 'drop-after');
    });
    system.addEventListener('drop', event => {
      if (dragPayload?.type !== 'row') return;
      event.preventDefault();
      const rect = system.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      const insertionIndex = rowIndex + (after ? 1 : 0);
      const sourceIndex = dragPayload.rowIndex;
      dragPayload = null;
      clearDragFeedback();
      moveRow(sourceIndex, insertionIndex);
    });
    return system;
  }

  function createInsertZone(index) {
    const zone = makeDiv('row-insert-zone');
    zone.dataset.insertIndex = index;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-insert-button';
    button.textContent = '+';
    button.setAttribute('aria-label', `在第 ${index + 1} 列位置新增列`);
    button.addEventListener('click', () => insertRowAt(index));
    zone.appendChild(button);
    return zone;
  }

  createTabSystem = function enhancedCreateTabSystem(rowIndex, rowCount) {
    if (scoreViewEnabled) return originalCreateTabSystem(rowIndex, rowCount);
    return createEditorTabSystem(rowIndex, rowCount);
  };

  renderRows = function enhancedRenderRows(rows) {
    if (scoreViewEnabled) {
      originalRenderRows(rows);
      return;
    }
    stopPlayback();
    const normalized = normalizeRows(rows, activeBeatsPerMeasure);
    tabArea.innerHTML = '';
    normalized.forEach((_, rowIndex) => {
      tabArea.appendChild(createInsertZone(rowIndex));
      const system = createEditorTabSystem(rowIndex, normalized.length);
      system.dataset.centerKey = `row-${rowIndex}`;
      tabArea.appendChild(system);
    });
    tabArea.appendChild(createInsertZone(normalized.length));
    normalized.forEach((row, rowIndex) => {
      row.forEach((stringValues, string) => {
        stringValues.forEach((value, position) => {
          const input = getInput(rowIndex, string, position);
          if (!input) return;
          input.value = value;
          input.classList.toggle('has-value', value.length > 0);
        });
      });
      renderRhythmNotation(rowIndex);
    });
    updateRemoveRowButton();
    updateProgressRange();
    setProgressIndex(Math.min(playIndex, totalSlots() - 1), true, true);
    if (selectedModule) setSelectedModule(selectedModule.type, selectedModule.rowIndex, selectedModule.measureIndex);
  };

  copyRow = function enhancedCopyRow(rowIndex) {
    setSelectedModule('row', rowIndex);
    copySelectedModule();
  };

  pasteRow = function enhancedPasteRow(rowIndex) {
    setSelectedModule('row', rowIndex);
    if (!moduleClipboard && rowClipboard) moduleClipboard = { type: 'row', row: deepClone(rowClipboard), rhythm: {} };
    pasteSelectedModule();
  };

  addTabSystem = function enhancedAddTabSystem() {
    insertRowAt(readRowsFromDom().length);
  };

  removeLastTabSystem = function enhancedRemoveLastTabSystem() {
    const rows = readRowsFromDom();
    if (rows.length <= 1) return;
    deleteSelectedRow(rows.length - 1);
  };

  document.addEventListener('keydown', event => {
    if (previewSong || scoreViewEnabled || editorView.hidden) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.target.closest('input,textarea,[contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    if (key === 'c' && selectedModule) { event.preventDefault(); copySelectedModule(); }
    if (key === 'v' && selectedModule) { event.preventDefault(); pasteSelectedModule(); }
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('#editorModuleMenu,.row-module-more')) closeContextMenu();
  });
  document.addEventListener('contextmenu', event => {
    if (!event.target.closest('.editor-row-module,.measure-module-hitbox')) closeContextMenu();
  });
  window.addEventListener('resize', closeContextMenu);
  window.addEventListener('scroll', closeContextMenu, true);
})();
