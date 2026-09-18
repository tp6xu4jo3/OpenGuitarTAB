(() => {
  let selectedModule = null;
  let moduleClipboard = null;
  let contextTarget = null;

  const originalCreateTabSystem = createTabSystem;
  const originalRenderRows = renderRows;

  function currentRhythmRows(rowCount) {
    const source = currentSong()?.rhythmRows;
    return Array.from({ length: rowCount }, (_, index) => deepClone(source?.[index] || {}));
  }

  function currentCounts(rowCount) {
    const song = currentSong();
    const counts = ensureRowMeasureCounts(song);
    return Array.from({ length: rowCount }, (_, index) => counts[index] || MEASURES);
  }

  function setSelectedModule(type, rowIndex, measureIndex = null) {
    selectedModule = { type, rowIndex, measureIndex };
    document.querySelectorAll('.editor-row-module.is-selected,.measure-module-hitbox.is-selected').forEach(node => node.classList.remove('is-selected'));
    if (type === 'row') document.querySelector(`.editor-row-module[data-row="${rowIndex}"]`)?.classList.add('is-selected');
    else document.querySelector(`.measure-module-hitbox[data-row="${rowIndex}"][data-measure="${measureIndex}"]`)?.classList.add('is-selected');
  }

  function clearDragVisuals() {
    document.querySelectorAll('.is-dragging').forEach(node => node.classList.remove('is-dragging'));
  }

  function blankMeasureModule() {
    const width = slotsPerMeasure();
    return { notes: Array.from({ length: STRINGS }, () => Array(width).fill('')), rhythm: {} };
  }

  function extractMeasure(rows, rhythmRows, rowIndex, measureIndex) {
    const width = slotsPerMeasure();
    const start = measureIndex * width;
    const notes = Array.from({ length: STRINGS }, (_, string) => rows[rowIndex][string].slice(start, start + width));
    const rhythm = {};
    for (const [rawPosition, rawDuration] of Object.entries(rhythmRows[rowIndex] || {})) {
      const position = Number(rawPosition);
      if (position >= start && position < start + width) rhythm[position - start] = Number(rawDuration);
    }
    return { notes, rhythm };
  }

  function activeMeasuresForRow(rows, rhythmRows, rowIndex, count = rowMeasureCount(rowIndex)) {
    return Array.from({ length: count }, (_, measureIndex) => extractMeasure(rows, rhythmRows, rowIndex, measureIndex));
  }

  function writeMeasuresToRow(rows, rhythmRows, rowIndex, measures) {
    const width = slotsPerMeasure();
    rows[rowIndex] = blankRow();
    rhythmRows[rowIndex] = {};
    measures.slice(0, MEASURES).forEach((measure, measureIndex) => {
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
  }

  function commitStructure(rows, rhythmRows, counts, message) {
    const song = currentSong();
    if (!song || previewSong) return;
    song.rows = normalizeRows(rows, song.beatsPerMeasure);
    song.rhythmRows = rhythmRows;
    song.rowMeasureCounts = Array.from({ length: song.rows.length }, (_, index) => Math.max(1, Math.min(MEASURES, Number(counts?.[index]) || MEASURES)));
    song.updatedAt = Date.now();
    writeStorage();
    renderRows(song.rows);
    renderSongList();
    renderLibraryGrid();
    if (message) showToast(message);
  }

  function insertMeasureBeside(target, side) {
    if (!target || target.type !== 'measure' || previewSong || scoreViewEnabled) return;
    const rows = readRowsFromDom();
    const rhythmRows = currentRhythmRows(rows.length);
    const counts = currentCounts(rows.length);
    const count = counts[target.rowIndex];
    if (count >= MEASURES) {
      showToast('每列最多 4 個小節');
      return;
    }
    const measures = activeMeasuresForRow(rows, rhythmRows, target.rowIndex, count);
    const insertIndex = Math.max(0, Math.min(count, target.measureIndex + (side === 'right' ? 1 : 0)));
    measures.splice(insertIndex, 0, blankMeasureModule());
    counts[target.rowIndex] = measures.length;
    writeMeasuresToRow(rows, rhythmRows, target.rowIndex, measures);
    selectedModule = { type: 'measure', rowIndex: target.rowIndex, measureIndex: insertIndex };
    commitStructure(rows, rhythmRows, counts, side === 'right' ? '已在右方新增小節' : '已在左方新增小節');
  }

  function deleteMeasureModule(target) {
    if (!target || target.type !== 'measure' || previewSong || scoreViewEnabled) return;
    const rows = readRowsFromDom();
    const rhythmRows = currentRhythmRows(rows.length);
    const counts = currentCounts(rows.length);
    const count = counts[target.rowIndex];
    if (count <= 1) {
      showToast('每列至少保留 1 個小節');
      return;
    }
    const measures = activeMeasuresForRow(rows, rhythmRows, target.rowIndex, count);
    measures.splice(target.measureIndex, 1);
    counts[target.rowIndex] = measures.length;
    writeMeasuresToRow(rows, rhythmRows, target.rowIndex, measures);
    selectedModule = { type: 'measure', rowIndex: target.rowIndex, measureIndex: Math.min(target.measureIndex, measures.length - 1) };
    commitStructure(rows, rhythmRows, counts, '已刪除小節');
  }

  function copySelectedModule(target = selectedModule) {
    if (!target || previewSong || scoreViewEnabled) return;
    const rows = readRowsFromDom();
    const rhythmRows = currentRhythmRows(rows.length);
    if (target.type === 'row') {
      moduleClipboard = {
        type: 'row',
        row: deepClone(rows[target.rowIndex]),
        rhythm: deepClone(rhythmRows[target.rowIndex] || {}),
        measureCount: rowMeasureCount(target.rowIndex)
      };
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
    const counts = currentCounts(rows.length);

    if (target.type === 'row' && moduleClipboard.type === 'row') {
      rows[target.rowIndex] = deepClone(moduleClipboard.row);
      rhythmRows[target.rowIndex] = deepClone(moduleClipboard.rhythm || {});
      counts[target.rowIndex] = Math.max(1, Math.min(MEASURES, Number(moduleClipboard.measureCount) || MEASURES));
      commitStructure(rows, rhythmRows, counts, `已貼到第 ${target.rowIndex + 1} 列`);
      return;
    }

    if (target.type === 'measure' && moduleClipboard.type === 'measure') {
      const measures = activeMeasuresForRow(rows, rhythmRows, target.rowIndex, counts[target.rowIndex]);
      if (!measures[target.measureIndex]) return;
      measures[target.measureIndex] = deepClone(moduleClipboard.measure);
      writeMeasuresToRow(rows, rhythmRows, target.rowIndex, measures);
      commitStructure(rows, rhythmRows, counts, `已貼到第 ${target.rowIndex + 1} 列第 ${target.measureIndex + 1} 小節`);
      return;
    }

    showToast(target.type === 'row' ? '請先複製整列模塊' : '請先複製小節模塊');
  }

  function deleteSelectedRow(rowIndex) {
    const rows = readRowsFromDom();
    if (rows.length <= 1) { showToast('至少保留一列'); return; }
    const rhythmRows = currentRhythmRows(rows.length);
    const counts = currentCounts(rows.length);
    rows.splice(rowIndex, 1);
    rhythmRows.splice(rowIndex, 1);
    counts.splice(rowIndex, 1);
    selectedModule = null;
    commitStructure(rows, rhythmRows, counts, `已刪除第 ${rowIndex + 1} 列`);
  }

  function insertRowAt(index) {
    if (previewSong || scoreViewEnabled) return;
    const rows = readRowsFromDom();
    const rhythmRows = currentRhythmRows(rows.length);
    const counts = currentCounts(rows.length);
    const safeIndex = Math.max(0, Math.min(rows.length, index));
    rows.splice(safeIndex, 0, blankRow());
    rhythmRows.splice(safeIndex, 0, {});
    counts.splice(safeIndex, 0, MEASURES);
    selectedModule = { type: 'row', rowIndex: safeIndex, measureIndex: null };
    commitStructure(rows, rhythmRows, counts, `已新增第 ${safeIndex + 1} 列`);
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
    document.getElementById('editorModuleMenu')?.classList.remove('open');
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
    } else {
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
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', `row:${rowIndex}`);
      label.closest('.editor-row-module')?.classList.add('is-dragging');
    });
    label.addEventListener('dragend', clearDragVisuals);
    return label;
  }

  function installMeasureHitboxes(grid, rowIndex) {
    const count = rowMeasureCount(rowIndex);
    for (let measureIndex = 0; measureIndex < count; measureIndex++) {
      const hitbox = makeDiv('measure-module-hitbox');
      hitbox.dataset.row = rowIndex;
      hitbox.dataset.measure = measureIndex;
      hitbox.style.left = `${(measureIndex / count) * 100}%`;
      hitbox.style.width = `${100 / count}%`;
      hitbox.draggable = true;
      hitbox.addEventListener('click', () => setSelectedModule('measure', rowIndex, measureIndex));
      hitbox.addEventListener('contextmenu', event => { event.preventDefault(); openContextMenu({ type: 'measure', rowIndex, measureIndex }, event.clientX, event.clientY); });
      hitbox.addEventListener('dragstart', event => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', `measure:${rowIndex}:${measureIndex}`);
        hitbox.classList.add('is-dragging');
      });
      hitbox.addEventListener('dragend', clearDragVisuals);
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
    ensureRowMeasureCounts(currentSong());
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
    if (!moduleClipboard && rowClipboard) moduleClipboard = { type: 'row', row: deepClone(rowClipboard), rhythm: {}, measureCount: MEASURES };
    pasteSelectedModule();
  };

  addTabSystem = function enhancedAddTabSystem() { insertRowAt(readRowsFromDom().length); };
  removeLastTabSystem = function enhancedRemoveLastTabSystem() {
    const rows = readRowsFromDom();
    if (rows.length > 1) deleteSelectedRow(rows.length - 1);
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
  document.querySelector('.sheet')?.addEventListener('scroll', closeContextMenu);
})();