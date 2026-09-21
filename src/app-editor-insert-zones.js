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
        for (let position = 0; position < width; position++) {
          rows[rowIndex][string][offset + position] = normalizeTabValue(values[position]);
        }
      }
      for (const [rawPosition, rawDuration] of Object.entries(measure.rhythm || {})) {
        const localPosition = Number(rawPosition);
        if (localPosition >= 0 && localPosition < width) rhythmRows[rowIndex][offset + localPosition] = Number(rawDuration);
      }
    });
  }

  function measureHasNotes(measure) {
    return (measure?.notes || []).some(stringValues =>
      (stringValues || []).some(value => String(value || '').trim() !== '')
    );
  }

  function insertMeasureWithOverflow(rows, rhythmRows, counts, rowIndex, boundary, measure) {
    if (rowIndex >= rows.length) {
      rows.push(blankRow());
      rhythmRows.push({});
      counts.push(1);
      writeMeasuresToRow(rows, rhythmRows, rowIndex, [measure]);
      return;
    }

    const count = Math.max(1, Math.min(MEASURES, Number(counts[rowIndex]) || MEASURES));
    const measures = activeMeasures(rows, rhythmRows, rowIndex, count);

    // If the next row is only a generated blank placeholder, use that slot instead
    // of pushing an extra empty measure through the rest of the song.
    if (measures.length === 1 && !measureHasNotes(measures[0]) && boundary === 0) {
      measures[0] = measure;
    } else {
      const target = Math.max(0, Math.min(measures.length, boundary));
      measures.splice(target, 0, measure);
    }

    const overflow = measures.length > MEASURES ? measures.pop() : null;
    counts[rowIndex] = Math.max(1, measures.length);
    writeMeasuresToRow(rows, rhythmRows, rowIndex, measures);

    if (overflow) insertMeasureWithOverflow(rows, rhythmRows, counts, rowIndex + 1, 0, overflow);
  }

  function commitStructure(rows, counts, message) {
    const song = currentSong();
    if (!song || previewSong) return;

    // Structural editing is local/in-memory. Drive is updated only when the user
    // presses Save (or performs an explicit cloud action such as Publish).
    song.rows = normalizeRows(rows, song.beatsPerMeasure);
    song.rhythmRows = song.rows.map(row => rhythmRowFromRow(row, song.beatsPerMeasure));
    song.rowMeasureCounts = Array.from(
      { length: song.rows.length },
      (_, index) => Math.max(1, Math.min(MEASURES, Number(counts[index]) || MEASURES))
    );
    song.updatedAt = Date.now();

    renderRows(song.rows);
    if (message) showToast(message);
  }

  function moveMeasureAtBoundary(sourceRow, sourceMeasure, targetRow, targetBoundary) {
    const rows = readRowsFromDom();
    const rhythmRows = rhythmRowsFor(rows.length);
    const counts = countsFor(rows.length);
    if (!rows[sourceRow] || !rows[targetRow]) return;

    const sourceCount = counts[sourceRow];
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
      commitStructure(rows, counts, '已移動小節');
      return;
    }

    const sourceMeasures = activeMeasures(rows, rhythmRows, sourceRow, sourceCount);
    const [moved] = sourceMeasures.splice(sourceMeasure, 1);

    if (sourceMeasures.length === 0) {
      sourceMeasures.push(blankMeasureModule());
      counts[sourceRow] = 1;
    } else {
      counts[sourceRow] = sourceMeasures.length;
    }

    writeMeasuresToRow(rows, rhythmRows, sourceRow, sourceMeasures);
    insertMeasureWithOverflow(rows, rhythmRows, counts, targetRow, targetBoundary, moved);
    commitStructure(rows, counts, '已插入小節');
  }

  function moveRowAtBoundary(sourceIndex, insertionIndex) {
    const rows = readRowsFromDom();
    const rhythmRows = rhythmRowsFor(rows.length);
    const counts = countsFor(rows.length);
    if (!rows[sourceIndex]) return;

    const [row] = rows.splice(sourceIndex, 1);
    rhythmRows.splice(sourceIndex, 1);
    const [count] = counts.splice(sourceIndex, 1);
    let target = insertionIndex;
    if (sourceIndex < target) target -= 1;
    target = Math.max(0, Math.min(rows.length, target));
    if (target === sourceIndex) return;

    rows.splice(target, 0, row);
    counts.splice(target, 0, count || MEASURES);
    commitStructure(rows, counts, '已移動列');
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
      const relative = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const boundary = Math.max(0, Math.min(count, Math.round(relative * count)));
      return { grid, boundary };
    }
    return null;
  }

  function findRowBoundary(clientX, clientY) {
    const areaRect = tabArea.getBoundingClientRect();
    if (clientX < areaRect.left - 24 || clientX > areaRect.right + 24) return null;

    let best = null;
    document.querySelectorAll('.row-insert-zone').forEach(zone => {
      const rect = zone.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      const distance = Math.abs(clientY - centerY);
      if (distance <= 36 && (!best || distance < best.distance)) {
        best = { zone, index: Number(zone.dataset.insertIndex), distance };
      }
    });
    return best;
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

  function measureSourceFromTarget(target) {
    const grip = target.closest?.('.measure-drag-grip');
    if (grip) {
      return {
        type: 'measure',
        sourceRow: Number(grip.dataset.row),
        sourceMeasure: Number(grip.dataset.measure)
      };
    }

    const measure = target.closest?.('.measure-module-hitbox');
    if (!measure) return null;
    return {
      type: 'measure',
      sourceRow: Number(measure.dataset.row),
      sourceMeasure: Number(measure.dataset.measure)
    };
  }

  renderRows = function renderRowsWithBoundaries(rows) {
    previousRenderRows(rows);
    installVisualBoundaries();
  };

  document.addEventListener('dragstart', event => {
    if (scoreViewEnabled) return;

    const measureSource = measureSourceFromTarget(event.target);
    if (measureSource) {
      dragState = measureSource;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', `measure:${dragState.sourceRow}:${dragState.sourceMeasure}`);
      }
      document.body.classList.add('measure-drag-active');
      clearFeedback();
      return;
    }

    const rowHandle = event.target.closest?.('.row-module-handle');
    if (rowHandle) {
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
    if (!dragState) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    if (dragState.type === 'measure') {
      showMeasureBoundary(findMeasureBoundary(event.clientX, event.clientY));
    } else {
      showRowBoundary(findRowBoundary(event.clientX, event.clientY));
    }
  }, true);

  document.addEventListener('drop', event => {
    if (!dragState) return;
    event.preventDefault();

    const state = dragState;
    const measureTarget = state.type === 'measure'
      ? (activeMeasureTarget || findMeasureBoundary(event.clientX, event.clientY))
      : null;
    const rowTarget = state.type === 'row'
      ? (activeRowTarget || findRowBoundary(event.clientX, event.clientY))
      : null;

    dragState = null;
    document.body.classList.remove('measure-drag-active', 'row-drag-active');
    clearFeedback();

    if (state.type === 'measure' && measureTarget) {
      moveMeasureAtBoundary(
        state.sourceRow,
        state.sourceMeasure,
        Number(measureTarget.grid.dataset.row),
        measureTarget.boundary
      );
      return;
    }

    if (state.type === 'row' && rowTarget) moveRowAtBoundary(state.sourceRow, rowTarget.index);
  }, true);

  document.addEventListener('dragend', () => {
    dragState = null;
    document.body.classList.remove('measure-drag-active', 'row-drag-active');
    clearFeedback();
  }, true);

  installVisualBoundaries();
})();