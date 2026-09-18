(() => {
  const previousRenderRows = renderRows;

  function rhythmRowsFor(rowCount) {
    const source = currentSong()?.rhythmRows;
    return Array.from({ length: rowCount }, (_, index) => deepClone(source?.[index] || {}));
  }

  function countsFor(rowCount) {
    const counts = ensureRowMeasureCounts(currentSong());
    return Array.from({ length: rowCount }, (_, index) => counts[index] || MEASURES);
  }

  function commitRows(rows, rhythmRows, counts, message) {
    const song = currentSong();
    if (!song || previewSong) return;
    song.rows = normalizeRows(rows, song.beatsPerMeasure);
    song.rhythmRows = rhythmRows;
    song.rowMeasureCounts = Array.from({ length: song.rows.length }, (_, index) => Math.max(1, Math.min(MEASURES, Number(counts[index]) || MEASURES)));
    song.updatedAt = Date.now();
    writeStorage();
    renderRows(song.rows);
    renderSongList();
    renderLibraryGrid();
    if (message) showToast(message);
  }

  function insertRowAtBoundary(index) {
    if (previewSong || scoreViewEnabled) return;
    const rows = readRowsFromDom();
    const rhythmRows = rhythmRowsFor(rows.length);
    const counts = countsFor(rows.length);
    const safeIndex = Math.max(0, Math.min(rows.length, index));
    rows.splice(safeIndex, 0, blankRow());
    rhythmRows.splice(safeIndex, 0, {});
    counts.splice(safeIndex, 0, MEASURES);
    commitRows(rows, rhythmRows, counts, `已新增第 ${safeIndex + 1} 列`);
  }

  function makeAddButton(label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-boundary-button row-boundary-add';
    button.setAttribute('aria-label', label);
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13"/></svg>';
    return button;
  }

  function decorateRowInsertZones() {
    if (scoreViewEnabled) return;
    document.querySelectorAll('.row-insert-zone').forEach(zone => {
      const index = Number(zone.dataset.insertIndex);
      zone.querySelectorAll('.row-insert-button,.row-insert-controls').forEach(node => node.remove());
      const controls = document.createElement('div');
      controls.className = 'row-insert-controls';
      const add = makeAddButton(`在第 ${index + 1} 列位置新增列`);
      add.addEventListener('click', event => {
        event.stopPropagation();
        insertRowAtBoundary(index);
      });
      controls.appendChild(add);
      zone.appendChild(controls);
    });
  }

  renderRows = function renderRowsWithRowControls(rows) {
    previousRenderRows(rows);
    decorateRowInsertZones();
  };

  decorateRowInsertZones();
})();