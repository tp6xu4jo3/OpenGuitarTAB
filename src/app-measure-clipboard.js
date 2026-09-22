(() => {
  let measureClipboard = null;

  function selectedMeasureNode() {
    return document.querySelector('.measure-module-hitbox.is-selected');
  }

  function measureTarget(node = selectedMeasureNode()) {
    if (!node) return null;
    const rowIndex = Number(node.dataset.row);
    const measureIndex = Number(node.dataset.measure);
    if (!Number.isInteger(rowIndex) || !Number.isInteger(measureIndex)) return null;
    return { node, rowIndex, measureIndex };
  }

  function focusMeasure(node) {
    if (!node) return;
    node.tabIndex = -1;
    try {
      node.focus({ preventScroll: true });
    } catch {
      node.focus();
    }
  }

  function copyMeasure(target = measureTarget()) {
    if (!target || previewSong || scoreViewEnabled) return false;
    const rows = readRowsFromDom();
    const row = rows[target.rowIndex];
    if (!row) return false;

    const width = slotsPerMeasure();
    const start = target.measureIndex * width;
    measureClipboard = {
      notes: Array.from({ length: STRINGS }, (_, string) =>
        Array.from({ length: width }, (_, offset) =>
          normalizeTabValue(row?.[string]?.[start + offset] ?? '')
        )
      )
    };
    showToast(`已複製第 ${target.rowIndex + 1} 列第 ${target.measureIndex + 1} 小節`);
    return true;
  }

  function restoreMeasureSelection(rowIndex, measureIndex) {
    requestAnimationFrame(() => {
      document.querySelectorAll('.measure-module-hitbox.is-selected').forEach(node => node.classList.remove('is-selected'));
      const node = document.querySelector(`.measure-module-hitbox[data-row="${rowIndex}"][data-measure="${measureIndex}"]`);
      if (!node) return;
      node.classList.add('is-selected');
      focusMeasure(node);
    });
  }

  function pasteMeasure(target = measureTarget()) {
    if (!target || previewSong || scoreViewEnabled) return false;
    if (!measureClipboard) {
      showToast('目前沒有可貼上的小節');
      return true;
    }

    const song = currentSong();
    if (!song) return false;
    const count = rowMeasureCount(target.rowIndex, song);
    if (target.measureIndex < 0 || target.measureIndex >= count) {
      showToast('貼上位置無效');
      return true;
    }

    const rows = readRowsFromDom();
    const row = rows[target.rowIndex];
    if (!row) return false;

    const width = slotsPerMeasure(song.beatsPerMeasure);
    const start = target.measureIndex * width;
    for (let string = 0; string < STRINGS; string++) {
      const source = measureClipboard.notes?.[string] || [];
      for (let offset = 0; offset < width; offset++) {
        row[string][start + offset] = normalizeTabValue(source[offset] ?? '');
      }
    }

    song.rows = normalizeRows(rows, song.beatsPerMeasure);
    song.rhythmRows = song.rows.map(currentRow => rhythmRowFromRow(currentRow, song.beatsPerMeasure));
    song.updatedAt = Date.now();
    renderRows(song.rows);
    restoreMeasureSelection(target.rowIndex, target.measureIndex);
    showToast(`已貼到第 ${target.rowIndex + 1} 列第 ${target.measureIndex + 1} 小節`);
    return true;
  }

  document.addEventListener('pointerdown', event => {
    const node = event.target.closest?.('.measure-module-hitbox');
    if (node) focusMeasure(node);
  }, true);

  document.addEventListener('contextmenu', event => {
    const node = event.target.closest?.('.measure-module-hitbox');
    if (node) focusMeasure(node);
  }, true);

  window.addEventListener('click', event => {
    const action = event.target.closest?.('.editor-module-menu-action');
    if (!action) return;
    const target = measureTarget();
    if (!target) return;

    const label = action.textContent.trim();
    if (label !== '複製' && label !== '貼上') return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    document.getElementById('editorModuleMenu')?.classList.remove('open');
    if (label === '複製') copyMeasure(target);
    else pasteMeasure(target);
  }, true);

  document.addEventListener('keydown', event => {
    if (previewSong || scoreViewEnabled || editorView.hidden) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.target.closest?.('input,textarea,[contenteditable="true"]')) return;

    const target = measureTarget();
    if (!target) return;
    const key = event.key.toLowerCase();
    if (key !== 'c' && key !== 'v') return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (key === 'c') copyMeasure(target);
    else pasteMeasure(target);
  }, true);
})();
