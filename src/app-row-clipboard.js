(() => {
  const compactQuery = window.matchMedia('(max-width: 980px)');
  let rowModuleClipboard = null;

  function selectedRowNode() {
    return document.querySelector('.editor-row-module.is-selected');
  }

  function rowTarget(node = selectedRowNode()) {
    if (!node) return null;
    const rowIndex = Number(node.dataset.row);
    if (!Number.isInteger(rowIndex)) return null;
    return { node, rowIndex };
  }

  function focusRow(node) {
    const handle = node?.querySelector('.row-module-handle') || node;
    if (!handle) return;
    handle.tabIndex = -1;
    try {
      handle.focus({ preventScroll: true });
    } catch {
      handle.focus();
    }
  }

  function cloneRow(row, beats) {
    const positions = positionsPerRow(beats);
    return Array.from({ length: STRINGS }, (_, string) => {
      const source = Array.isArray(row?.[string]) ? row[string] : [];
      return Array.from({ length: positions }, (_, position) => normalizeTabValue(source[position] ?? ''));
    });
  }

  function ensureRhythmRows(song) {
    if (!Array.isArray(song.rhythmRows)) song.rhythmRows = [];
    while (song.rhythmRows.length < song.rows.length) song.rhythmRows.push({});
    if (song.rhythmRows.length > song.rows.length) song.rhythmRows.length = song.rows.length;
    return song.rhythmRows;
  }

  function installDragUi(grid, rowIndex) {
    if (!grid) return;
    const count = Number(grid.dataset.measureCount) || rowMeasureCount(rowIndex);
    grid.querySelectorAll('.measure-insert-boundary,.measure-drag-grip').forEach(node => node.remove());

    for (let boundary = 0; boundary <= count; boundary++) {
      const line = makeDiv('measure-insert-boundary');
      line.dataset.boundary = boundary;
      line.style.left = `${(boundary / count) * 100}%`;
      grid.appendChild(line);
    }

    for (let measure = 0; measure < count; measure++) {
      const grip = document.createElement('span');
      grip.className = 'measure-drag-grip';
      grip.draggable = true;
      grip.dataset.row = rowIndex;
      grip.dataset.measure = measure;
      grip.style.left = `${((measure + 0.5) / count) * 100}%`;
      grip.title = '拖曳小節';
      grip.setAttribute('aria-label', `拖曳第 ${rowIndex + 1} 列第 ${measure + 1} 小節`);
      grid.appendChild(grip);
    }
  }

  function hydrateSystem(system, row) {
    system.querySelectorAll('.note-input').forEach(input => {
      const string = Number(input.dataset.string);
      const position = Number(input.dataset.position);
      const value = String(row?.[string]?.[position] ?? '');
      input.value = value;
      input.classList.toggle('has-value', value.length > 0);
      window.syncNoteInputBackground?.(input);
    });
  }

  function restoreRowSelection(rowIndex) {
    requestAnimationFrame(() => {
      document.querySelectorAll('.editor-row-module.is-selected,.measure-module-hitbox.is-selected').forEach(node => node.classList.remove('is-selected'));
      const node = document.querySelector(`.editor-row-module[data-row="${rowIndex}"]`);
      if (!node) return;
      node.classList.add('is-selected');
      focusRow(node);
    });
  }

  function refreshSingleRow(rowIndex) {
    const song = currentSong();
    if (!song?.rows?.[rowIndex]) return;

    if (compactQuery.matches) {
      renderRows(song.rows);
      restoreRowSelection(rowIndex);
      return;
    }

    const existing = tabArea.querySelector(`.tab-system[data-row="${rowIndex}"]`);
    if (!existing) {
      renderRows(song.rows);
      restoreRowSelection(rowIndex);
      return;
    }

    const replacement = createTabSystem(rowIndex, song.rows.length);
    replacement.dataset.centerKey = `row-${rowIndex}`;
    hydrateSystem(replacement, song.rows[rowIndex]);
    const grid = replacement.querySelector('.tab-grid');
    installDragUi(grid, rowIndex);
    if (grid) window.scheduleDensityFitGrid?.(grid, true);
    existing.replaceWith(replacement);

    updateRemoveRowButton();
    updateProgressRange();
    setProgressIndex(Math.min(playIndex, Math.max(0, totalSlots() - 1)), true, true);
    requestAnimationFrame(() => renderRhythmNotation(rowIndex));
    restoreRowSelection(rowIndex);
  }

  function copyRowFast(target = rowTarget()) {
    if (!target || previewSong || scoreViewEnabled) return false;
    const song = currentSong();
    const row = song?.rows?.[target.rowIndex];
    if (!row) return false;

    rowModuleClipboard = {
      row: cloneRow(row, song.beatsPerMeasure),
      measureCount: rowMeasureCount(target.rowIndex, song)
    };
    showToast(`已複製第 ${target.rowIndex + 1} 列`);
    return true;
  }

  function pasteRowFast(target = rowTarget()) {
    if (!target || previewSong || scoreViewEnabled) return false;
    if (!rowModuleClipboard) {
      showToast('目前沒有可貼上的列');
      return true;
    }

    const song = currentSong();
    if (!song?.rows?.[target.rowIndex]) return false;

    song.rows[target.rowIndex] = cloneRow(rowModuleClipboard.row, song.beatsPerMeasure);
    const counts = ensureRowMeasureCounts(song);
    counts[target.rowIndex] = Math.max(1, Math.min(MEASURES, Number(rowModuleClipboard.measureCount) || MEASURES));
    const rhythms = ensureRhythmRows(song);
    rhythms[target.rowIndex] = rhythmRowFromRow(song.rows[target.rowIndex], song.beatsPerMeasure);
    song.updatedAt = Date.now();

    refreshSingleRow(target.rowIndex);
    showToast(`已貼到第 ${target.rowIndex + 1} 列`);
    return true;
  }

  document.addEventListener('pointerdown', event => {
    const handle = event.target.closest?.('.row-module-handle');
    if (!handle) return;
    const node = handle.closest('.editor-row-module');
    if (node) focusRow(node);
  }, true);

  document.addEventListener('contextmenu', event => {
    const node = event.target.closest?.('.editor-row-module');
    if (node && !event.target.closest?.('.measure-module-hitbox')) focusRow(node);
  }, true);

  window.addEventListener('click', event => {
    const action = event.target.closest?.('.editor-module-menu-action');
    if (!action) return;
    const target = rowTarget();
    if (!target) return;

    const label = action.textContent.trim();
    if (label !== '複製' && label !== '貼上') return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    document.getElementById('editorModuleMenu')?.classList.remove('open');
    if (label === '複製') copyRowFast(target);
    else pasteRowFast(target);
  }, true);

  window.addEventListener('keydown', event => {
    if (previewSong || scoreViewEnabled || editorView.hidden) return;
    if (!(event.ctrlKey || event.metaKey)) return;

    const target = rowTarget();
    if (!target) return;
    const key = event.key.toLowerCase();
    if (key !== 'c' && key !== 'v') return;

    const editingField = event.target.closest?.('input,textarea,[contenteditable="true"]');
    if (editingField && !event.target.closest?.('.row-module-handle')) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (key === 'c') copyRowFast(target);
    else pasteRowFast(target);
  }, true);
})();
