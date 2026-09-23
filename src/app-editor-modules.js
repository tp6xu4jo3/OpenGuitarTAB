(() => {
  let selectedModule = null;
  let contextTarget = null;

  const originalCreateTabSystem = createTabSystem;
  const originalRenderRows = renderRows;

  function focusSelectedNode(node) {
    if (!node) return;
    node.tabIndex = -1;
    try { node.focus({ preventScroll: true }); } catch { node.focus(); }
  }

  function setSelectedModule(type, rowIndex, measureIndex = null) {
    selectedModule = { type, rowIndex, measureIndex };
    document.querySelectorAll('.editor-row-module.is-selected,.measure-module-hitbox.is-selected').forEach(node => node.classList.remove('is-selected'));
    const node = type === 'row'
      ? document.querySelector(`.editor-row-module[data-row="${rowIndex}"]`)
      : document.querySelector(`.measure-module-hitbox[data-row="${rowIndex}"][data-measure="${measureIndex}"]`);
    node?.classList.add('is-selected');
    focusSelectedNode(type === 'row' ? node?.querySelector('.row-module-handle') || node : node);
  }

  function clearDragVisuals() {
    document.querySelectorAll('.is-dragging').forEach(node => node.classList.remove('is-dragging'));
  }

  function ensureRhythmRows(song) {
    if (!Array.isArray(song.rhythmRows)) song.rhythmRows = [];
    while (song.rhythmRows.length < song.rows.length) song.rhythmRows.push({});
    if (song.rhythmRows.length > song.rows.length) song.rhythmRows.length = song.rows.length;
    return song.rhythmRows;
  }

  function currentCounts(song) {
    return ensureRowMeasureCounts(song);
  }

  function cloneMeasure(row, measureIndex, beats = activeBeatsPerMeasure) {
    const width = slotsPerMeasure(beats);
    const start = measureIndex * width;
    return Array.from({ length: STRINGS }, (_, string) =>
      Array.from({ length: width }, (_, offset) => normalizeTabValue(row?.[string]?.[start + offset] ?? ''))
    );
  }

  function rowFromMeasures(measures, beats = activeBeatsPerMeasure) {
    const width = slotsPerMeasure(beats);
    const row = blankRow(beats);
    measures.slice(0, MEASURES).forEach((measure, measureIndex) => {
      const offset = measureIndex * width;
      for (let string = 0; string < STRINGS; string++) {
        for (let position = 0; position < width; position++) {
          row[string][offset + position] = normalizeTabValue(measure?.[string]?.[position] ?? '');
        }
      }
    });
    return row;
  }

  function blankMeasure(beats = activeBeatsPerMeasure) {
    return Array.from({ length: STRINGS }, () => Array(slotsPerMeasure(beats)).fill(''));
  }

  function syncLegacyStructure(song, startRow = 0) {
    const rhythms = ensureRhythmRows(song);
    for (let rowIndex = Math.max(0, startRow); rowIndex < song.rows.length; rowIndex++) {
      rhythms[rowIndex] = rhythmRowFromRow(song.rows[rowIndex], song.beatsPerMeasure);
    }
    song.updatedAt = Date.now();
    window.editorV3?.reconcileCurrentSong?.();
  }

  function insertMeasureBeside(target, side) {
    if (!target || target.type !== 'measure' || previewSong || scoreViewEnabled) return;
    const song = currentSong();
    if (!song?.rows?.[target.rowIndex]) return;
    const counts = currentCounts(song);
    const count = rowMeasureCount(target.rowIndex, song);
    if (count >= MEASURES) {
      showToast('每列最多 4 個小節');
      return;
    }
    const measures = Array.from({ length: count }, (_, index) => cloneMeasure(song.rows[target.rowIndex], index, song.beatsPerMeasure));
    const insertIndex = Math.max(0, Math.min(count, target.measureIndex + (side === 'right' ? 1 : 0)));
    measures.splice(insertIndex, 0, blankMeasure(song.beatsPerMeasure));
    song.rows[target.rowIndex] = rowFromMeasures(measures, song.beatsPerMeasure);
    counts[target.rowIndex] = measures.length;
    syncLegacyStructure(song, target.rowIndex);
    selectedModule = { type: 'measure', rowIndex: target.rowIndex, measureIndex: insertIndex };
    renderRows(song.rows);
    showToast(side === 'right' ? '已在右方新增小節' : '已在左方新增小節');
  }

  function deleteMeasureModule(target) {
    if (!target || target.type !== 'measure' || previewSong || scoreViewEnabled) return;
    const song = currentSong();
    if (!song?.rows?.[target.rowIndex]) return;
    const counts = currentCounts(song);
    const count = rowMeasureCount(target.rowIndex, song);
    if (count <= 1) {
      showToast('每列至少保留 1 個小節');
      return;
    }
    const measures = Array.from({ length: count }, (_, index) => cloneMeasure(song.rows[target.rowIndex], index, song.beatsPerMeasure));
    measures.splice(target.measureIndex, 1);
    song.rows[target.rowIndex] = rowFromMeasures(measures, song.beatsPerMeasure);
    counts[target.rowIndex] = measures.length;
    syncLegacyStructure(song, target.rowIndex);
    selectedModule = { type: 'measure', rowIndex: target.rowIndex, measureIndex: Math.min(target.measureIndex, measures.length - 1) };
    renderRows(song.rows);
    showToast('已刪除小節');
  }

  function copySelectedModule(target = selectedModule) {
    if (!target || previewSong || scoreViewEnabled) return;
    if (window.editorV3?.clipboard?.copyModule?.(target)) return;
    showToast('Editor V3 尚未完成初始化');
  }

  function pasteSelectedModule(target = selectedModule) {
    if (!target || previewSong || scoreViewEnabled) return;
    if (window.editorV3?.clipboard?.pasteModule?.(target)) return;
    showToast('Editor V3 尚未完成初始化');
  }

  function deleteSelectedRow(rowIndex) {
    if (previewSong || scoreViewEnabled) return;
    const song = currentSong();
    if (!song?.rows?.length) return;
    if (song.rows.length <= 1) {
      showToast('至少保留一列');
      return;
    }
    const counts = currentCounts(song);
    const rhythms = ensureRhythmRows(song);
    const safe = Math.max(0, Math.min(song.rows.length - 1, Number(rowIndex) || 0));
    song.rows.splice(safe, 1);
    counts.splice(safe, 1);
    rhythms.splice(safe, 1);
    selectedModule = null;
    syncLegacyStructure(song, safe);
    renderRows(song.rows);
    showToast(`已刪除第 ${safe + 1} 列`);
  }

  function insertRowAt(index) {
    if (previewSong || scoreViewEnabled) return;
    const song = currentSong();
    if (!song?.rows) return;
    const counts = currentCounts(song);
    const rhythms = ensureRhythmRows(song);
    const safe = Math.max(0, Math.min(song.rows.length, Number(index) || 0));
    song.rows.splice(safe, 0, blankRow(song.beatsPerMeasure));
    counts.splice(safe, 0, MEASURES);
    rhythms.splice(safe, 0, {});
    selectedModule = { type: 'row', rowIndex: safe, measureIndex: null };
    syncLegacyStructure(song, safe);
    renderRows(song.rows);
    showToast(`已新增第 ${safe + 1} 列`);
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
    const normalized = rows === currentSong()?.rows ? rows : normalizeRows(rows, activeBeatsPerMeasure);
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

  copyRow = function v3CopyRow(rowIndex) {
    setSelectedModule('row', rowIndex);
    copySelectedModule();
  };

  pasteRow = function v3PasteRow(rowIndex) {
    setSelectedModule('row', rowIndex);
    pasteSelectedModule();
  };

  addTabSystem = function addEditorRow() { insertRowAt(currentSong()?.rows?.length || 0); };
  removeLastTabSystem = function removeEditorRow() {
    const count = currentSong()?.rows?.length || 0;
    if (count > 1) deleteSelectedRow(count - 1);
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
