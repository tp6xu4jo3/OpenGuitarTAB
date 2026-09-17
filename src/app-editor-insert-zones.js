(() => {
  let dragState = null;
  let activeMeasureTarget = null;
  let activeRowTarget = null;
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
    if (target === sourceFlatIndex) return;
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
    if (target === sourceIndex) return;
    rows.splice(target, 0, row);
    rhythmRows.splice(target, 0, rhythm || {});
    commitInsertStructure(rows, rhythmRows, '已移動列模塊');
  }

  function installVisualBoundaries() {
    document.querySelectorAll('.measure-module-badge').forEach(badge => badge.remove());
    if (scoreViewEnabled) return;
    document.querySelectorAll('.tab-grid[data-row]').forEach(grid => {
      grid.querySelectorAll('.measure-insert-boundary').forEach(zone => zone.remove());
      for (let boundaryIndex = 0; boundaryIndex <= MEASURES; boundaryIndex++) {
        const line = makeDiv('measure-insert-boundary');
        line.dataset.boundary = boundaryIndex;
        line.style.left = `${boundaryIndex * 25}%`;
        grid.appendChild(line);
      }
    });
  }

  function clearFeedback() {
    document.querySelectorAll('.measure-insert-boundary.is-active').forEach(node => node.classList.remove('is-active'));
    document.querySelectorAll('.measure-module-hitbox.measure-insert-shift').forEach(node => node.classList.remove('measure-insert-shift'));
    document.querySelectorAll('.row-insert-zone.is-drag-target').forEach(node => node.classList.remove('is-drag-target'));
    activeMeasureTarget = null;
    activeRowTarget = null;
  }

  function findMeasureBoundary(clientX, clientY) {
    const grids = Array.from(document.querySelectorAll('.tab-grid[data-row]'));
    for (const grid of grids) {
      const rect = grid.getBoundingClientRect();
      if (clientY < rect.top || clientY > rect.bottom || clientX < rect.left || clientX > rect.right) continue;
      const beatPx = rect.width / (MEASURES * activeBeatsPerMeasure);
      let best = null;
      for (let boundary = 0; boundary <= MEASURES; boundary++) {
        const x = rect.left + rect.width * (boundary / MEASURES);
        const distance = Math.abs(clientX - x);
        if (distance <= beatPx && (!best || distance < best.distance)) best = { grid, boundary, distance };
      }
      if (best) return best;
    }
    return null;
  }

  function showMeasureBoundary(target) {
    clearFeedback();
    if (!target) return;
    activeMeasureTarget = target;
    target.grid.querySelector(`.measure-insert-boundary[data-boundary="${target.boundary}"]`)?.classList.add('is-active');
    target.grid.querySelectorAll('.measure-module-hitbox').forEach(hitbox => {
      if (Number(hitbox.dataset.measure) >= target.boundary) hitbox.classList.add('measure-insert-shift');
    });
  }

  function findRowBoundary(clientX, clientY) {
    const tabRect = tabArea.getBoundingClientRect();
    if (clientX < tabRect.left || clientX > tabRect.right) return null;
    let best = null;
    document.querySelectorAll('.row-insert-zone').forEach(zone => {
      const rect = zone.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      const distance = Math.abs(clientY - centerY);
      if (distance <= 24 && (!best || distance < best.distance)) {
        best = { zone, index: Number(zone.dataset.insertIndex), distance };
      }
    });
    return best;
  }

  function showRowBoundary(target) {
    clearFeedback();
    if (!target) return;
    activeRowTarget = target;
    target.zone.classList.add('is-drag-target');
  }

  renderRows = function renderRowsWithBoundaryZones(rows) {
    previousRenderRows(rows);
    installVisualBoundaries();
  };

  document.addEventListener('dragstart', event => {
    const measure = event.target.closest?.('.measure-module-hitbox');
    if (measure && !scoreViewEnabled) {
      dragState = {
        type: 'measure',
        source: Number(measure.dataset.row) * MEASURES + Number(measure.dataset.measure)
      };
      event.dataTransfer?.setData('text/plain', `measure:${dragState.source}`);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      document.body.classList.add('measure-drag-active');
      clearFeedback();
      return;
    }

    const rowHandle = event.target.closest?.('.row-module-handle');
    if (rowHandle && !scoreViewEnabled) {
      dragState = { type: 'row', source: Number(rowHandle.dataset.row) };
      event.dataTransfer?.setData('text/plain', `row:${dragState.source}`);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      document.body.classList.add('row-drag-active');
      clearFeedback();
    }
  }, true);

  document.addEventListener('dragover', event => {
    if (!dragState) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (dragState.type === 'measure') showMeasureBoundary(findMeasureBoundary(event.clientX, event.clientY));
    else showRowBoundary(findRowBoundary(event.clientX, event.clientY));
  }, true);

  document.addEventListener('drop', event => {
    if (!dragState) return;
    event.preventDefault();
    event.stopPropagation();
    const state = dragState;
    dragState = null;
    document.body.classList.remove('measure-drag-active', 'row-drag-active');

    if (state.type === 'measure' && activeMeasureTarget) {
      const rowIndex = Number(activeMeasureTarget.grid.dataset.row);
      const insertionIndex = rowIndex * MEASURES + activeMeasureTarget.boundary;
      clearFeedback();
      moveMeasureAtBoundary(state.source, insertionIndex);
      return;
    }

    if (state.type === 'row' && activeRowTarget) {
      const insertionIndex = activeRowTarget.index;
      clearFeedback();
      moveRowAtBoundary(state.source, insertionIndex);
      return;
    }
    clearFeedback();
  }, true);

  document.addEventListener('dragend', () => {
    dragState = null;
    document.body.classList.remove('measure-drag-active', 'row-drag-active');
    clearFeedback();
  }, true);

  installVisualBoundaries();
})();