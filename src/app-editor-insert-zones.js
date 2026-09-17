(() => {
  let measureDragSource = null;
  let rowDragSource = null;
  const previousRenderRows = renderRows;

  function rhythmRowsFor(rowCount) {
    const source = currentSong()?.rhythmRows;
    return Array.from({ length: rowCount }, (_, index) => deepClone(source?.[index] || {}));
  }

  function extractMeasureForInsert(rows, rhythmRows, rowIndex, measureIndex) {
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

  function rebuildRowsFromMeasures(measures, rowCount) {
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
        for (let position = 0; position < width; position++) {
          rows[rowIndex][string][offset + position] = normalizeTabValue(values[position]);
        }
      }

      for (const [rawPosition, rawDuration] of Object.entries(measure.rhythm || {})) {
        const localPosition = Number(rawPosition);
        if (localPosition >= 0 && localPosition < width) {
          rhythmRows[rowIndex][offset + localPosition] = Number(rawDuration);
        }
      }
    });

    return { rows, rhythmRows };
  }

  function commitInsertStructure(rows, rhythmRows, message) {
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

  function moveMeasureAtBoundary(sourceFlatIndex, insertionIndex) {
    const rows = readRowsFromDom();
    const rhythmRows = rhythmRowsFor(rows.length);
    const measures = [];

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      for (let measureIndex = 0; measureIndex < MEASURES; measureIndex++) {
        measures.push(extractMeasureForInsert(rows, rhythmRows, rowIndex, measureIndex));
      }
    }

    if (!measures[sourceFlatIndex]) return;
    const [measure] = measures.splice(sourceFlatIndex, 1);
    let target = insertionIndex;
    if (sourceFlatIndex < target) target -= 1;
    target = Math.max(0, Math.min(measures.length, target));
    measures.splice(target, 0, measure);

    const rebuilt = rebuildRowsFromMeasures(measures, rows.length);
    commitInsertStructure(rebuilt.rows, rebuilt.rhythmRows, '已移動小節模塊');
  }

  function moveRowAtBoundary(sourceIndex, insertionIndex) {
    const rows = readRowsFromDom();
    const rhythmRows = rhythmRowsFor(rows.length);
    if (!rows[sourceIndex]) return;

    const [row] = rows.splice(sourceIndex, 1);
    const [rhythm] = rhythmRows.splice(sourceIndex, 1);
    let target = insertionIndex;
    if (sourceIndex < target) target -= 1;
    target = Math.max(0, Math.min(rows.length, target));
    rows.splice(target, 0, row);
    rhythmRows.splice(target, 0, rhythm || {});

    commitInsertStructure(rows, rhythmRows, '已移動列模塊');
  }

  function clearMeasureBoundaryFeedback() {
    document.querySelectorAll('.measure-insert-boundary.is-active').forEach(zone => zone.classList.remove('is-active'));
    document.querySelectorAll('.measure-module-hitbox.measure-insert-shift').forEach(hitbox => hitbox.classList.remove('measure-insert-shift'));
    document.querySelectorAll('.measure-module-hitbox.drop-before,.measure-module-hitbox.drop-after').forEach(hitbox => hitbox.classList.remove('drop-before', 'drop-after'));
  }

  function clearRowBoundaryFeedback() {
    document.querySelectorAll('.row-insert-zone.is-drag-target').forEach(zone => zone.classList.remove('is-drag-target'));
  }

  function activateMeasureBoundary(grid, boundaryIndex) {
    clearMeasureBoundaryFeedback();
    grid.querySelector(`.measure-insert-boundary[data-boundary="${boundaryIndex}"]`)?.classList.add('is-active');
    grid.querySelectorAll('.measure-module-hitbox').forEach(hitbox => {
      if (Number(hitbox.dataset.measure) >= boundaryIndex) hitbox.classList.add('measure-insert-shift');
    });
  }

  function installMeasureBoundaryZones() {
    document.querySelectorAll('.measure-module-badge').forEach(badge => badge.remove());
    if (scoreViewEnabled) return;

    document.querySelectorAll('.tab-grid[data-row]').forEach(grid => {
      grid.querySelectorAll('.measure-insert-boundary').forEach(zone => zone.remove());
      const beatPercent = 25 / activeBeatsPerMeasure;

      for (let boundaryIndex = 0; boundaryIndex <= MEASURES; boundaryIndex++) {
        const zone = makeDiv('measure-insert-boundary');
        zone.dataset.boundary = boundaryIndex;
        zone.dataset.row = grid.dataset.row;

        if (boundaryIndex === 0) {
          zone.style.left = '0%';
          zone.style.width = `${beatPercent}%`;
          zone.style.setProperty('--boundary-line-x', '0%');
        } else if (boundaryIndex === MEASURES) {
          zone.style.left = `${100 - beatPercent}%`;
          zone.style.width = `${beatPercent}%`;
          zone.style.setProperty('--boundary-line-x', '100%');
        } else {
          zone.style.left = `${boundaryIndex * 25 - beatPercent}%`;
          zone.style.width = `${beatPercent * 2}%`;
          zone.style.setProperty('--boundary-line-x', '50%');
        }

        zone.addEventListener('dragenter', event => {
          if (measureDragSource === null) return;
          event.preventDefault();
          event.stopPropagation();
          activateMeasureBoundary(grid, boundaryIndex);
        });

        zone.addEventListener('dragover', event => {
          if (measureDragSource === null) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
          activateMeasureBoundary(grid, boundaryIndex);
        });

        zone.addEventListener('dragleave', event => {
          if (measureDragSource === null || zone.contains(event.relatedTarget)) return;
          zone.classList.remove('is-active');
        });

        zone.addEventListener('drop', event => {
          if (measureDragSource === null) return;
          event.preventDefault();
          event.stopPropagation();
          const rowIndex = Number(grid.dataset.row);
          const targetFlat = rowIndex * MEASURES + boundaryIndex;
          const sourceFlat = measureDragSource;
          measureDragSource = null;
          document.body.classList.remove('measure-drag-active');
          clearMeasureBoundaryFeedback();
          moveMeasureAtBoundary(sourceFlat, targetFlat);
        });

        grid.appendChild(zone);
      }
    });
  }

  function installRowBoundaryZones() {
    document.querySelectorAll('.row-insert-zone').forEach(zone => {
      if (zone.dataset.dragBoundaryReady === 'true') return;
      zone.dataset.dragBoundaryReady = 'true';

      zone.addEventListener('dragenter', event => {
        if (rowDragSource === null) return;
        event.preventDefault();
        event.stopPropagation();
        clearRowBoundaryFeedback();
        zone.classList.add('is-drag-target');
      });

      zone.addEventListener('dragover', event => {
        if (rowDragSource === null) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        clearRowBoundaryFeedback();
        zone.classList.add('is-drag-target');
      });

      zone.addEventListener('dragleave', event => {
        if (rowDragSource === null || zone.contains(event.relatedTarget)) return;
        zone.classList.remove('is-drag-target');
      });

      zone.addEventListener('drop', event => {
        if (rowDragSource === null) return;
        event.preventDefault();
        event.stopPropagation();
        const insertionIndex = Number(zone.dataset.insertIndex);
        const sourceIndex = rowDragSource;
        rowDragSource = null;
        document.body.classList.remove('row-drag-active');
        clearRowBoundaryFeedback();
        moveRowAtBoundary(sourceIndex, insertionIndex);
      });
    });
  }

  function installAllBoundaryZones() {
    installMeasureBoundaryZones();
    installRowBoundaryZones();
  }

  renderRows = function renderRowsWithBoundaryZones(rows) {
    previousRenderRows(rows);
    installAllBoundaryZones();
  };

  document.addEventListener('dragstart', event => {
    const measure = event.target.closest?.('.measure-module-hitbox');
    if (measure && !scoreViewEnabled) {
      measureDragSource = Number(measure.dataset.row) * MEASURES + Number(measure.dataset.measure);
      rowDragSource = null;
      document.body.classList.add('measure-drag-active');
      document.body.classList.remove('row-drag-active');
      clearMeasureBoundaryFeedback();
      return;
    }

    const rowHandle = event.target.closest?.('.row-module-handle');
    if (rowHandle && !scoreViewEnabled) {
      rowDragSource = Number(rowHandle.dataset.row);
      measureDragSource = null;
      document.body.classList.add('row-drag-active');
      document.body.classList.remove('measure-drag-active');
      clearRowBoundaryFeedback();
    }
  }, true);

  document.addEventListener('dragend', () => {
    measureDragSource = null;
    rowDragSource = null;
    document.body.classList.remove('measure-drag-active', 'row-drag-active');
    clearMeasureBoundaryFeedback();
    clearRowBoundaryFeedback();
  }, true);

  installAllBoundaryZones();
})();