(() => {
  const previousRenderRows = renderRows;

  function rhythmRowsFor(rowCount) {
    const source = currentSong()?.rhythmRows;
    return Array.from({ length: rowCount }, (_, index) => deepClone(source?.[index] || {}));
  }

  function commitRows(rows, rhythmRows, message) {
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

  function insertRowAtBoundary(index) {
    if (previewSong || scoreViewEnabled) return;
    const rows = readRowsFromDom();
    const rhythmRows = rhythmRowsFor(rows.length);
    const safeIndex = Math.max(0, Math.min(rows.length, index));
    rows.splice(safeIndex, 0, blankRow());
    rhythmRows.splice(safeIndex, 0, {});
    commitRows(rows, rhythmRows, `已新增第 ${safeIndex + 1} 列`);
  }

  function deleteRowAboveBoundary(index) {
    if (previewSong || scoreViewEnabled) return;
    const rows = readRowsFromDom();
    if (rows.length <= 1) {
      showToast('至少保留一列');
      return;
    }
    const rowIndex = Math.max(0, Math.min(rows.length - 1, index - 1));
    const rhythmRows = rhythmRowsFor(rows.length);
    rows.splice(rowIndex, 1);
    rhythmRows.splice(rowIndex, 1);
    commitRows(rows, rhythmRows, `已刪除第 ${rowIndex + 1} 列`);
  }

  function iconButton(kind, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `row-boundary-button row-boundary-${kind}`;
    button.setAttribute('aria-label', label);
    button.innerHTML = kind === 'add'
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12h13"/></svg>';
    return button;
  }

  function decorateRowInsertZones() {
    if (scoreViewEnabled) return;
    document.querySelectorAll('.row-insert-zone').forEach(zone => {
      const index = Number(zone.dataset.insertIndex);
      zone.querySelectorAll('.row-insert-button,.row-insert-controls').forEach(node => node.remove());

      const controls = document.createElement('div');
      controls.className = 'row-insert-controls';

      const add = iconButton('add', `在第 ${index + 1} 列位置新增列`);
      add.addEventListener('click', event => {
        event.stopPropagation();
        insertRowAtBoundary(index);
      });
      controls.appendChild(add);

      if (index > 0) {
        const remove = iconButton('remove', `刪除上方第 ${index} 列`);
        remove.addEventListener('click', event => {
          event.stopPropagation();
          deleteRowAboveBoundary(index);
        });
        controls.appendChild(remove);
      }

      zone.appendChild(controls);
    });
  }

  renderRows = function renderRowsWithRowControls(rows) {
    previousRenderRows(rows);
    decorateRowInsertZones();
  };

  decorateRowInsertZones();
})();
