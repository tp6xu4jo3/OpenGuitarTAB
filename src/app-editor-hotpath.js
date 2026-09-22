(() => {
  const compactQuery = window.matchMedia('(max-width: 980px)');
  const fallbackRenderRows = renderRows;
  let rhythmRenderToken = 0;

  function normalizedCount(value) {
    const count = Number(value);
    return Number.isInteger(count) ? Math.max(1, Math.min(MEASURES, count)) : MEASURES;
  }

  function cloneRow(row, beats = currentSong()?.beatsPerMeasure || activeBeatsPerMeasure) {
    const positions = positionsPerRow(beats);
    return Array.from({ length: STRINGS }, (_, string) => {
      const source = Array.isArray(row?.[string]) ? row[string] : [];
      const values = Array(positions).fill('');
      for (let position = 0; position < Math.min(positions, source.length); position++) {
        values[position] = normalizeTabValue(source[position]);
      }
      return values;
    });
  }

  function ensureRhythmRows(song) {
    if (!Array.isArray(song.rhythmRows)) song.rhythmRows = [];
    while (song.rhythmRows.length < song.rows.length) song.rhythmRows.push({});
    if (song.rhythmRows.length > song.rows.length) song.rhythmRows.length = song.rows.length;
    return song.rhythmRows;
  }

  function makeInsertZone(index) {
    const zone = makeDiv('row-insert-zone');
    zone.dataset.insertIndex = index;
    const controls = makeDiv('row-insert-controls');
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'row-boundary-button row-boundary-add';
    add.setAttribute('aria-label', `在第 ${index + 1} 列位置新增列`);
    add.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13"/></svg>';
    controls.appendChild(add);
    zone.appendChild(controls);
    return zone;
  }

  function installDragUi(grid, rowIndex) {
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

  function hydrateSystem(system, rowValues) {
    system.querySelectorAll('.note-input').forEach(input => {
      const string = Number(input.dataset.string);
      const position = Number(input.dataset.position);
      const value = String(rowValues?.[string]?.[position] ?? '');
      input.value = value;
      input.classList.toggle('has-value', value.length > 0);
    });
  }

  function buildSystem(rowIndex, rowCount, rowValues) {
    const system = createTabSystem(rowIndex, rowCount);
    system.dataset.centerKey = `row-${rowIndex}`;
    hydrateSystem(system, rowValues);
    const grid = system.querySelector('.tab-grid');
    if (grid) {
      installDragUi(grid, rowIndex);
      window.scheduleDensityFitGrid?.(grid, true);
    }
    return system;
  }

  function scheduleRhythmRows(rowCount, startIndex = 0) {
    const token = ++rhythmRenderToken;
    let row = Math.max(0, Math.min(rowCount, Number(startIndex) || 0));
    const work = deadline => {
      if (token !== rhythmRenderToken) return;
      let rendered = 0;
      while (row < rowCount && (rendered < 2 || !deadline || deadline.timeRemaining() > 3)) {
        renderRhythmNotation(row++);
        rendered += 1;
      }
      if (row >= rowCount || token !== rhythmRenderToken) return;
      if ('requestIdleCallback' in window) requestIdleCallback(work, { timeout: 80 });
      else setTimeout(() => work(null), 0);
    };
    if ('requestIdleCallback' in window) requestIdleCallback(work, { timeout: 40 });
    else requestAnimationFrame(() => work(null));
  }

  function finishStructureRender(rowCount, rhythmStart = 0) {
    updateRemoveRowButton();
    updateProgressRange();
    setProgressIndex(Math.min(playIndex, Math.max(0, totalSlots() - 1)), true, true);
    scheduleRhythmRows(rowCount, rhythmStart);
  }

  function renderRowsFast(rows, startIndex = 0) {
    if (scoreViewEnabled || compactQuery.matches) {
      fallbackRenderRows(rows);
      return;
    }

    stopPlayback();
    const song = currentSong();
    const normalized = rows === song?.rows ? rows : normalizeRows(rows, activeBeatsPerMeasure);
    ensureRowMeasureCounts(song);
    const rowCount = normalized.length;
    const safeStart = Math.max(0, Math.min(rowCount, Number(startIndex) || 0));

    const existingStartZone = safeStart > 0
      ? tabArea.querySelector(`.row-insert-zone[data-insert-index="${safeStart}"]`)
      : null;

    if (safeStart === 0 || !existingStartZone) {
      const fragment = document.createDocumentFragment();
      normalized.forEach((rowValues, rowIndex) => {
        fragment.appendChild(makeInsertZone(rowIndex));
        fragment.appendChild(buildSystem(rowIndex, rowCount, rowValues));
      });
      fragment.appendChild(makeInsertZone(rowCount));
      tabArea.replaceChildren(fragment);
      finishStructureRender(rowCount, 0);
      return;
    }

    let node = existingStartZone;
    while (node) {
      const next = node.nextSibling;
      node.remove();
      node = next;
    }

    const fragment = document.createDocumentFragment();
    for (let rowIndex = safeStart; rowIndex < rowCount; rowIndex++) {
      fragment.appendChild(makeInsertZone(rowIndex));
      fragment.appendChild(buildSystem(rowIndex, rowCount, normalized[rowIndex]));
    }
    fragment.appendChild(makeInsertZone(rowCount));
    tabArea.appendChild(fragment);
    finishStructureRender(rowCount, safeStart);
  }

  function replaceRowFast(rowIndex) {
    const song = currentSong();
    if (!song || !song.rows?.[rowIndex]) return;
    if (scoreViewEnabled || compactQuery.matches) {
      fallbackRenderRows(song.rows);
      return;
    }

    const existing = tabArea.querySelector(`.tab-system[data-row="${rowIndex}"]`);
    if (!existing) {
      renderRowsFast(song.rows, rowIndex);
      return;
    }

    const replacement = buildSystem(rowIndex, song.rows.length, song.rows[rowIndex]);
    existing.replaceWith(replacement);
    updateRemoveRowButton();
    updateProgressRange();
    setProgressIndex(Math.min(playIndex, Math.max(0, totalSlots() - 1)), true, true);
    requestAnimationFrame(() => renderRhythmNotation(rowIndex));
  }

  renderRows = rows => renderRowsFast(rows, 0);

  function insertRowFast(index) {
    if (previewSong || scoreViewEnabled) return;
    const song = currentSong();
    if (!song || !Array.isArray(song.rows)) return;
    const counts = ensureRowMeasureCounts(song);
    const rhythms = ensureRhythmRows(song);
    const safe = Math.max(0, Math.min(song.rows.length, Number(index) || 0));

    song.rows.splice(safe, 0, blankRow(song.beatsPerMeasure));
    counts.splice(safe, 0, MEASURES);
    rhythms.splice(safe, 0, {});
    song.updatedAt = Date.now();

    renderRowsFast(song.rows, safe);
    showToast(`已新增第 ${safe + 1} 列`);
  }

  function deleteRowFast(index) {
    if (previewSong || scoreViewEnabled) return;
    const song = currentSong();
    if (!song || !Array.isArray(song.rows)) return;
    if (song.rows.length <= 1) {
      showToast('至少保留一列');
      return;
    }

    const counts = ensureRowMeasureCounts(song);
    const rhythms = ensureRhythmRows(song);
    const safe = Math.max(0, Math.min(song.rows.length - 1, Number(index) || 0));
    song.rows.splice(safe, 1);
    counts.splice(safe, 1);
    rhythms.splice(safe, 1);
    song.updatedAt = Date.now();

    renderRowsFast(song.rows, safe);
    showToast(`已刪除第 ${safe + 1} 列`);
  }

  addTabSystem = function fastAddTabSystem() {
    insertRowFast(currentSong()?.rows?.length || 0);
  };

  removeLastTabSystem = function fastRemoveLastTabSystem() {
    const count = currentSong()?.rows?.length || 0;
    if (count > 1) deleteRowFast(count - 1);
  };

  function measureFromRow(row, measureIndex) {
    const width = slotsPerMeasure();
    const start = measureIndex * width;
    return {
      notes: Array.from({ length: STRINGS }, (_, string) =>
        (Array.isArray(row?.[string]) ? row[string] : []).slice(start, start + width)
      )
    };
  }

  function measuresForRow(row, count) {
    return Array.from({ length: count }, (_, index) => measureFromRow(row, index));
  }

  function blankMeasure() {
    return { notes: Array.from({ length: STRINGS }, () => Array(slotsPerMeasure()).fill('')) };
  }

  function rowFromMeasures(measures, beats = currentSong()?.beatsPerMeasure || activeBeatsPerMeasure) {
    const width = slotsPerMeasure(beats);
    const row = blankRow(beats);
    measures.slice(0, MEASURES).forEach((measure, measureIndex) => {
      const offset = measureIndex * width;
      for (let string = 0; string < STRINGS; string++) {
        const values = measure.notes?.[string] || [];
        for (let position = 0; position < width; position++) {
          row[string][offset + position] = normalizeTabValue(values[position]);
        }
      }
    });
    return row;
  }

  function commitSingleRow(rowIndex, row, count, message) {
    const song = currentSong();
    if (!song || previewSong || !song.rows?.[rowIndex]) return;
    const counts = ensureRowMeasureCounts(song);
    const rhythms = ensureRhythmRows(song);
    song.rows[rowIndex] = row;
    counts[rowIndex] = normalizedCount(count);
    rhythms[rowIndex] = rhythmRowFromRow(row, song.beatsPerMeasure);
    song.updatedAt = Date.now();
    replaceRowFast(rowIndex);
    if (message) showToast(message);
  }

  function insertMeasureFast(rowIndex, measureIndex) {
    if (previewSong || scoreViewEnabled) return;
    const song = currentSong();
    if (!song?.rows?.[rowIndex]) return;
    const count = rowMeasureCount(rowIndex, song);
    if (count >= MEASURES) {
      showToast('每列最多 4 個小節');
      return;
    }

    const measures = measuresForRow(song.rows[rowIndex], count);
    const safe = Math.max(0, Math.min(count, Number(measureIndex) || 0));
    measures.splice(safe, 0, blankMeasure());
    commitSingleRow(rowIndex, rowFromMeasures(measures, song.beatsPerMeasure), measures.length, '已新增小節');
  }

  function deleteMeasureFast(rowIndex, measureIndex) {
    if (previewSong || scoreViewEnabled) return;
    const song = currentSong();
    if (!song?.rows?.[rowIndex]) return;
    const count = rowMeasureCount(rowIndex, song);
    if (count <= 1) {
      showToast('每列至少保留 1 個小節');
      return;
    }

    const measures = measuresForRow(song.rows[rowIndex], count);
    const safe = Math.max(0, Math.min(count - 1, Number(measureIndex) || 0));
    measures.splice(safe, 1);
    commitSingleRow(rowIndex, rowFromMeasures(measures, song.beatsPerMeasure), measures.length, '已刪除小節');
  }

  window.addEventListener('click', event => {
    if (scoreViewEnabled || previewSong) return;

    const boundaryButton = event.target.closest?.('.row-boundary-add,.row-insert-button');
    const zone = boundaryButton?.closest?.('.row-insert-zone');
    if (zone) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      insertRowFast(Number(zone.dataset.insertIndex));
      return;
    }

    const addButton = event.target.closest?.('#addRow');
    if (addButton) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      insertRowFast(currentSong()?.rows?.length || 0);
      return;
    }

    const removeButton = event.target.closest?.('#removeRow');
    if (removeButton) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const count = currentSong()?.rows?.length || 0;
      if (count > 1) deleteRowFast(count - 1);
      return;
    }

    const action = event.target.closest?.('.editor-module-menu-action');
    if (!action) return;
    const label = action.textContent.trim();

    const selectedRow = document.querySelector('.editor-row-module.is-selected');
    if (selectedRow && ['在上方新增列', '在下方新增列', '刪除列'].includes(label)) {
      const rowIndex = Number(selectedRow.dataset.row);
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      document.getElementById('editorModuleMenu')?.classList.remove('open');
      if (label === '在上方新增列') insertRowFast(rowIndex);
      else if (label === '在下方新增列') insertRowFast(rowIndex + 1);
      else deleteRowFast(rowIndex);
      return;
    }

    const selectedMeasure = document.querySelector('.measure-module-hitbox.is-selected');
    if (selectedMeasure && ['在左方新增', '在右方新增', '刪除'].includes(label)) {
      const rowIndex = Number(selectedMeasure.dataset.row);
      const measureIndex = Number(selectedMeasure.dataset.measure);
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      document.getElementById('editorModuleMenu')?.classList.remove('open');
      if (label === '在左方新增') insertMeasureFast(rowIndex, measureIndex);
      else if (label === '在右方新增') insertMeasureFast(rowIndex, measureIndex + 1);
      else deleteMeasureFast(rowIndex, measureIndex);
    }
  }, true);

  let drag = null;
  let activeTarget = null;
  let activeLine = null;
  let shifted = [];
  let dragFrame = 0;
  let pendingPoint = null;
  let lastHitGrid = null;
  let lastHitRect = null;

  function measureHasNotes(measure) {
    return (measure?.notes || []).some(values =>
      (values || []).some(value => String(value || '').trim() !== '')
    );
  }

  function createWorkingState(song) {
    const rows = new Map();
    const counts = new Map();
    const dirty = new Set();

    return {
      song,
      rows,
      counts,
      dirty,
      row(index) {
        if (!rows.has(index)) {
          const source = index < song.rows.length ? song.rows[index] : blankRow(song.beatsPerMeasure);
          rows.set(index, cloneRow(source, song.beatsPerMeasure));
        }
        return rows.get(index);
      },
      count(index) {
        if (!counts.has(index)) counts.set(index, index < song.rows.length ? rowMeasureCount(index, song) : 1);
        return counts.get(index);
      },
      setRow(index, row, count) {
        rows.set(index, row);
        counts.set(index, normalizedCount(count));
        dirty.add(index);
      }
    };
  }

  function cascadeInsertWorking(state, rowIndex, boundary, measure, replaceEmpty = false) {
    if (rowIndex >= state.song.rows.length && !state.rows.has(rowIndex)) {
      state.setRow(rowIndex, rowFromMeasures([measure], state.song.beatsPerMeasure), 1);
      return;
    }

    const count = state.count(rowIndex);
    const measures = measuresForRow(state.row(rowIndex), count);
    if (replaceEmpty && measures.length === 1 && !measureHasNotes(measures[0])) {
      measures[0] = measure;
    } else {
      measures.splice(Math.max(0, Math.min(measures.length, boundary)), 0, measure);
    }

    const overflow = measures.length > MEASURES ? measures.pop() : null;
    state.setRow(rowIndex, rowFromMeasures(measures, state.song.beatsPerMeasure), Math.max(1, measures.length));
    if (overflow) cascadeInsertWorking(state, rowIndex + 1, 0, overflow, true);
  }

  function commitWorkingRows(state, message) {
    const song = state.song;
    if (!state.dirty.size) return;
    const counts = ensureRowMeasureCounts(song);
    const rhythms = ensureRhythmRows(song);
    const oldLength = song.rows.length;
    const dirty = Array.from(state.dirty).sort((a, b) => a - b);
    const maxIndex = dirty[dirty.length - 1];

    while (song.rows.length <= maxIndex) {
      song.rows.push(blankRow(song.beatsPerMeasure));
      counts.push(MEASURES);
      rhythms.push({});
    }

    dirty.forEach(index => {
      const row = state.rows.get(index);
      if (!row) return;
      song.rows[index] = row;
      counts[index] = normalizedCount(state.counts.get(index));
      rhythms[index] = rhythmRowFromRow(row, song.beatsPerMeasure);
    });
    song.updatedAt = Date.now();

    if (song.rows.length !== oldLength) {
      renderRowsFast(song.rows, Math.min(dirty[0], Math.max(0, oldLength - 1)));
    } else {
      dirty.forEach(replaceRowFast);
    }
    if (message) showToast(message);
  }

  function clearDragVisual() {
    activeLine?.classList.remove('is-active');
    activeLine = null;
    shifted.forEach(node => node.classList.remove('measure-insert-shift'));
    shifted = [];
  }

  function gridAtPoint(x, y) {
    const pointed = document.elementFromPoint(x, y);
    const direct = pointed?.closest?.('.tab-grid[data-row]');
    if (direct) return direct;

    for (const grid of tabArea.querySelectorAll('.tab-grid[data-row]')) {
      const rect = grid.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom && x >= rect.left && x <= rect.right) return grid;
    }
    return null;
  }

  function dragTargetAt(x, y) {
    const grid = gridAtPoint(x, y);
    if (!grid) {
      lastHitGrid = null;
      lastHitRect = null;
      return null;
    }

    let rect = lastHitRect;
    if (grid !== lastHitGrid || !rect) {
      rect = grid.getBoundingClientRect();
      lastHitGrid = grid;
      lastHitRect = rect;
    }

    const row = Number(grid.dataset.row);
    const count = Number(grid.dataset.measureCount) || rowMeasureCount(row);
    const ratio = Math.max(0, Math.min(1, (x - rect.left) / Math.max(1, rect.right - rect.left)));
    return {
      grid,
      row,
      count,
      boundary: Math.max(0, Math.min(count, Math.round(ratio * count)))
    };
  }

  function showDragTarget(next) {
    if (activeTarget && next && activeTarget.row === next.row && activeTarget.boundary === next.boundary) return;
    clearDragVisual();
    activeTarget = next;
    if (!next) return;
    activeLine = next.grid.querySelector(`.measure-insert-boundary[data-boundary="${next.boundary}"]`);
    activeLine?.classList.add('is-active');
    shifted = Array.from(next.grid.querySelectorAll('.measure-module-hitbox'))
      .filter(node => Number(node.dataset.measure) >= next.boundary);
    shifted.forEach(node => node.classList.add('measure-insert-shift'));
  }

  function scheduleDragTarget(x, y) {
    pendingPoint = { x, y };
    if (dragFrame) return;
    dragFrame = requestAnimationFrame(() => {
      dragFrame = 0;
      const point = pendingPoint;
      pendingPoint = null;
      if (point) showDragTarget(dragTargetAt(point.x, point.y));
    });
  }

  function commitMeasureMove() {
    if (!drag || !activeTarget) return;
    const song = currentSong();
    if (!song || previewSong || !song.rows?.[drag.row]) return;
    const sourceCount = rowMeasureCount(drag.row, song);
    if (drag.measure < 0 || drag.measure >= sourceCount) return;

    if (drag.row === activeTarget.row) {
      const measures = measuresForRow(song.rows[drag.row], sourceCount);
      const [moved] = measures.splice(drag.measure, 1);
      let insertAt = activeTarget.boundary;
      if (drag.measure < insertAt) insertAt -= 1;
      insertAt = Math.max(0, Math.min(measures.length, insertAt));
      if (insertAt === drag.measure) return;
      measures.splice(insertAt, 0, moved);
      commitSingleRow(drag.row, rowFromMeasures(measures, song.beatsPerMeasure), measures.length, '已移動小節');
      return;
    }

    const state = createWorkingState(song);
    const sourceMeasures = measuresForRow(state.row(drag.row), sourceCount);
    const [moved] = sourceMeasures.splice(drag.measure, 1);
    if (!moved) return;

    if (sourceMeasures.length === 0) sourceMeasures.push(blankMeasure());
    state.setRow(
      drag.row,
      rowFromMeasures(sourceMeasures, song.beatsPerMeasure),
      Math.max(1, sourceMeasures.length)
    );
    cascadeInsertWorking(state, activeTarget.row, activeTarget.boundary, moved, true);
    commitWorkingRows(state, '已移動小節');
  }

  function resetDragState() {
    drag = null;
    activeTarget = null;
    pendingPoint = null;
    lastHitGrid = null;
    lastHitRect = null;
    if (dragFrame) {
      cancelAnimationFrame(dragFrame);
      dragFrame = 0;
    }
    clearDragVisual();
    document.body.classList.remove('measure-drag-active');
  }

  window.addEventListener('dragstart', event => {
    if (scoreViewEnabled || previewSong || compactQuery.matches) return;
    const source = event.target.closest?.('.measure-drag-grip,.measure-module-hitbox');
    if (!source) return;
    event.stopPropagation();
    drag = { row: Number(source.dataset.row), measure: Number(source.dataset.measure) };
    activeTarget = null;
    clearDragVisual();
    lastHitGrid = null;
    lastHitRect = null;
    document.body.classList.add('measure-drag-active');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', `measure:${drag.row}:${drag.measure}`);
    }
  }, true);

  window.addEventListener('dragenter', event => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    scheduleDragTarget(event.clientX, event.clientY);
  }, true);

  window.addEventListener('dragover', event => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    scheduleDragTarget(event.clientX, event.clientY);
  }, true);

  window.addEventListener('drop', event => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    if (dragFrame) {
      cancelAnimationFrame(dragFrame);
      dragFrame = 0;
    }
    const point = pendingPoint || { x: event.clientX, y: event.clientY };
    activeTarget = dragTargetAt(point.x, point.y) || activeTarget;
    pendingPoint = null;
    commitMeasureMove();
    resetDragState();
  }, true);

  window.addEventListener('dragend', () => {
    if (!drag) return;
    resetDragState();
  }, true);
})();