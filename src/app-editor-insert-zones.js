(() => {
  let dragState = null;
  let activeMeasureTarget = null;
  let activeRowTarget = null;
  const previousRenderRows = renderRows;

  function rhythmRowsFor(rowCount) {
    const source = currentSong()?.rhythmRows;
    return Array.from({ length: rowCount }, (_, index) => deepClone(source?.[index] || {}));
  }

  function countsFor(rowCount) {
    const counts = ensureRowMeasureCounts(currentSong());
    return Array.from({ length: rowCount }, (_, index) => counts[index] || MEASURES);
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

  function activeMeasures(rows, rhythmRows, rowIndex, count) {
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
    song.rowMeasureCounts = Array.from({ length: song.rows.length }, (_, index) => Math.max(1, Math.min(MEASURES, Number(counts[index]) || MEASURES)));
    song.updatedAt = Date.now();
    writeStorage();
    renderRows(song.rows);
    renderSongList();
    renderLibraryGrid();
    if (message) showToast(message);
  }

  function moveMeasureAtBoundary(sourceRow, sourceMeasure, targetRow, targetBoundary) {
    const rows = readRowsFromDom();
    const rhythmRows = rhythmRowsFor(rows.length);
    const counts = countsFor(rows.length);
    if (!rows[sourceRow] || !rows[targetRow]) return;

    const sourceCount = counts[sourceRow];
    const targetCount = counts[targetRow];
    if (sourceMeasure < 0 || sourceMeasure >= sourceCount) return;

    if (sourceRow === targetRow) {
      const measures = activeMeasures(rows, rhythmRows, sourceRow, sourceCount);
      const [moved] = measures.splice(sourceMeasure, 1);
      let target = Math.max(0, Math.min(sourceCount, targetBoundary));
      if (sourceMeasure < target) target -= 1;
      target = Math.max(0, Math.min(measures.length, target));
      if (target === sourceMeasure) return;
      measures.splice(target, 0, moved);
      writeMeasuresToRow(rows, rhythmRows, sourceRow, measures);
      commitStructure(rows, rhythmRows, counts, '已移動小節模塊');
      return;
    }

    if (targetCount >= MEASURES) {
      showToast('目標列已滿 4 個小節');
      return;
    }

    const sourceMeasures = activeMeasures(rows, rhythmRows, sourceRow, sourceCount);
    const targetMeasures = activeMeasures(rows, rhythmRows, targetRow, targetCount);
    const [moved] = sourceMeasures.splice(sourceMeasure, 1);
    const target = Math.max(0, Math.min(targetMeasures.length, targetBoundary));
    targetMeasures.splice(target, 0, moved);

    if (sourceMeasures.length === 0) {
      sourceMeasures.push(blankMeasureModule());
      counts[sourceRow] = 1;
    } else counts[sourceRow] = sourceMeasures.length;
    counts[targetRow] = targetMeasures.length;

    writeMeasuresToRow(rows, rhythmRows, sourceRow, sourceMeasures);
    writeMeasuresToRow(rows, rhythmRows, targetRow, targetMeasures);
    commitStructure(rows, rhythmRows, counts, '已移動小節模塊');
  }

  function moveRowAtBoundary(sourceIndex, insertionIndex) {
    const rows = readRowsFromDom();
    const rhythmRows = rhythmRowsFor(rows.length);
    const counts = countsFor(rows.length);
    if (!rows[sourceIndex]) return;

    const [row] = rows.splice(sourceIndex, 1);
    const [rhythm] = rhythmRows.splice(sourceIndex, 1);
    const [count] = counts.splice(sourceIndex, 1);
    let target = insertionIndex;
    if (sourceIndex < target) target -= 1;
    target = Math.max(0, Math.min(rows.length, target));
    if (target === sourceIndex) return;

    rows.splice(target, 0, row);
    rhythmRows.splice(target, 0, rhythm || {});
    counts.splice(target, 0, count || MEASURES);
    commitStructure(rows, rhythmRows, counts, '已移動列模塊');
  }

  function installVisualBoundaries() {
    if (scoreViewEnabled) return;
    document.querySelectorAll('.tab-grid[data-row]').forEach(grid => {
      grid.querySelectorAll('.measure-insert-boundary').forEach(node => node.remove());
      const count = Number(grid.dataset.measureCount) || rowMeasureCount(Number(grid.dataset.row));
      for (let boundary = 0; boundary <= count; boundary++) {
        const line = makeDiv('measure-insert-boundary');
        line.dataset.boundary = boundary;
        line.style.left = `${(boundary / count) * 100}%`;
        grid.appendChild(line);
      }
    });
  }

  function installRowDropZones() {
    document.querySelectorAll('.row-insert-zone').forEach(zone => {
      if (zone.dataset.rowDropReady === 'true') return;
      zone.dataset.rowDropReady = 'true';
      zone.addEventListener('dragover', event => {
        if (dragState?.type !== 'row') return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        showRowBoundary({ zone, index: Number(zone.dataset.insertIndex), distance: 0 });
      });
      zone.addEventListener('drop', event => {
        if (dragState?.type !== 'row') return;
        event.preventDefault();
        event.stopPropagation();
        const state = dragState;
        dragState = null;
        document.body.classList.remove('row-drag-active');
        const insertionIndex = Number(zone.dataset.insertIndex);
        clearFeedback();
        moveRowAtBoundary(state.sourceRow, insertionIndex);
      });
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
    for (const grid of document.querySelectorAll('.tab-grid[data-row]')) {
      const rect = grid.getBoundingClientRect();
      if (clientY < rect.top || clientY > rect.bottom || clientX < rect.left || clientX > rect.right) continue;
      const count = Number(grid.dataset.measureCount) || rowMeasureCount(Number(grid.dataset.row));
      const beatPx = rect.width / (count * activeBeatsPerMeasure);
      let best = null;
      for (let boundary = 0; boundary <= count; boundary++) {
        const x = rect.left + rect.width * (boundary / count);
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

  function showRowBoundary(target) {
    clearFeedback();
    if (!target) return;
    activeRowTarget = target;
    target.zone.classList.add('is-drag-target');
  }

  renderRows = function renderRowsWithBoundaries(rows) {
    previousRenderRows(rows);
    installVisualBoundaries();
    installRowDropZones();
  };

  document.addEventListener('dragstart', event => {
    const measure = event.target.closest?.('.measure-module-hitbox');
    if (measure && !scoreViewEnabled) {
      dragState = { type: 'measure', sourceRow: Number(measure.dataset.row), sourceMeasure: Number(measure.dataset.measure) };
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', `measure:${dragState.sourceRow}:${dragState.sourceMeasure}`);
      }
      document.body.classList.add('measure-drag-active');
      clearFeedback();
      return;
    }

    const rowHandle = event.target.closest?.('.row-module-handle');
    if (rowHandle && !scoreViewEnabled) {
      dragState = { type: 'row', sourceRow: Number(rowHandle.dataset.row) };
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', `row:${dragState.sourceRow}`);
      }
      document.body.classList.add('row-drag-active');
      clearFeedback();
    }
  }, true);

  document.addEventListener('dragover', event => {
    if (dragState?.type !== 'measure') return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    showMeasureBoundary(findMeasureBoundary(event.clientX, event.clientY));
  }, true);

  document.addEventListener('drop', event => {
    if (dragState?.type !== 'measure') return;
    event.preventDefault();
    event.stopPropagation();
    const state = dragState;
    const target = activeMeasureTarget;
    dragState = null;
    document.body.classList.remove('measure-drag-active');
    clearFeedback();
    if (!target) return;
    moveMeasureAtBoundary(state.sourceRow, state.sourceMeasure, Number(target.grid.dataset.row), target.boundary);
  }, true);

  document.addEventListener('dragend', () => {
    dragState = null;
    document.body.classList.remove('measure-drag-active', 'row-drag-active');
    clearFeedback();
  }, true);

  installVisualBoundaries();
  installRowDropZones();
})();