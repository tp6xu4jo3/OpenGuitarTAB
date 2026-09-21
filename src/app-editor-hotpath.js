(() => {
  const compactQuery = window.matchMedia('(max-width: 980px)');
  const fallbackRenderRows = renderRows;
  let rhythmRenderToken = 0;

  function rowsSnapshot() {
    return deepClone(currentSong()?.rows || []);
  }

  function countsSnapshot(rowCount) {
    const counts = ensureRowMeasureCounts(currentSong());
    return Array.from({ length: rowCount }, (_, index) => counts[index] || MEASURES);
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
    add.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      insertRowFast(index);
    });
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

  function scheduleRhythmRows(rowCount) {
    const token = ++rhythmRenderToken;
    let row = 0;
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

  function renderRowsFast(rows) {
    if (scoreViewEnabled || compactQuery.matches) {
      fallbackRenderRows(rows);
      return;
    }

    stopPlayback();
    const normalized = normalizeRows(rows, activeBeatsPerMeasure);
    ensureRowMeasureCounts(currentSong());
    const fragment = document.createDocumentFragment();

    normalized.forEach((rowValues, rowIndex) => {
      fragment.appendChild(makeInsertZone(rowIndex));
      const system = createTabSystem(rowIndex, normalized.length);
      system.dataset.centerKey = `row-${rowIndex}`;
      hydrateSystem(system, rowValues);
      const grid = system.querySelector('.tab-grid');
      if (grid) installDragUi(grid, rowIndex);
      fragment.appendChild(system);
    });
    fragment.appendChild(makeInsertZone(normalized.length));
    tabArea.replaceChildren(fragment);

    updateRemoveRowButton();
    updateProgressRange();
    setProgressIndex(Math.min(playIndex, Math.max(0, totalSlots() - 1)), true, true);
    scheduleRhythmRows(normalized.length);
  }

  renderRows = renderRowsFast;

  function commitRowsFast(rows, counts, message) {
    const song = currentSong();
    if (!song || previewSong) return;
    song.rows = normalizeRows(rows, song.beatsPerMeasure);
    song.rhythmRows = song.rows.map(row => rhythmRowFromRow(row, song.beatsPerMeasure));
    song.rowMeasureCounts = Array.from(
      { length: song.rows.length },
      (_, index) => Math.max(1, Math.min(MEASURES, Number(counts?.[index]) || MEASURES))
    );
    song.updatedAt = Date.now();
    renderRowsFast(song.rows);
    if (message) showToast(message);
  }

  function insertRowFast(index) {
    if (previewSong || scoreViewEnabled) return;
    const rows = rowsSnapshot();
    const counts = countsSnapshot(rows.length);
    const safe = Math.max(0, Math.min(rows.length, Number(index) || 0));
    rows.splice(safe, 0, blankRow());
    counts.splice(safe, 0, MEASURES);
    commitRowsFast(rows, counts, `已新增第 ${safe + 1} 列`);
  }

  function deleteRowFast(index) {
    if (previewSong || scoreViewEnabled) return;
    const rows = rowsSnapshot();
    if (rows.length <= 1) {
      showToast('至少保留一列');
      return;
    }
    const safe = Math.max(0, Math.min(rows.length - 1, Number(index) || 0));
    const counts = countsSnapshot(rows.length);
    rows.splice(safe, 1);
    counts.splice(safe, 1);
    commitRowsFast(rows, counts, `已刪除第 ${safe + 1} 列`);
  }

  addTabSystem = function fastAddTabSystem() {
    insertRowFast(currentSong()?.rows?.length || 0);
  };

  removeLastTabSystem = function fastRemoveLastTabSystem() {
    const count = currentSong()?.rows?.length || 0;
    if (count > 1) deleteRowFast(count - 1);
  };

  // Row-menu actions in app-editor-modules close over the older slow structural
  // functions. Intercept only those row actions before their handlers run.
  window.addEventListener('click', event => {
    const action = event.target.closest?.('.editor-module-menu-action');
    if (!action || scoreViewEnabled || previewSong) return;
    const label = action.textContent.trim();
    if (!['在上方新增列', '在下方新增列', '刪除列'].includes(label)) return;
    const selected = document.querySelector('.editor-row-module.is-selected');
    if (!selected) return;
    const rowIndex = Number(selected.dataset.row);
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    document.getElementById('editorModuleMenu')?.classList.remove('open');
    if (label === '在上方新增列') insertRowFast(rowIndex);
    else if (label === '在下方新增列') insertRowFast(rowIndex + 1);
    else deleteRowFast(rowIndex);
  }, true);

  let drag = null;
  let geometry = [];
  let activeTarget = null;
  let activeLine = null;
  let shifted = [];
  let dragFrame = 0;
  let pendingPoint = null;

  function measureFrom(rows, rowIndex, measureIndex) {
    const width = slotsPerMeasure();
    const start = measureIndex * width;
    return { notes: Array.from({ length: STRINGS }, (_, string) => rows[rowIndex][string].slice(start, start + width)) };
  }

  function measuresFor(rows, rowIndex, count) {
    return Array.from({ length: count }, (_, index) => measureFrom(rows, rowIndex, index));
  }

  function writeMeasures(rows, rowIndex, measures) {
    const width = slotsPerMeasure();
    rows[rowIndex] = blankRow();
    measures.slice(0, MEASURES).forEach((measure, measureIndex) => {
      const offset = measureIndex * width;
      for (let string = 0; string < STRINGS; string++) {
        const values = measure.notes?.[string] || [];
        for (let position = 0; position < width; position++) {
          rows[rowIndex][string][offset + position] = normalizeTabValue(values[position]);
        }
      }
    });
  }

  function measureHasNotes(measure) {
    return (measure?.notes || []).some(values =>
      (values || []).some(value => String(value || '').trim() !== '')
    );
  }

  function cascadeInsert(rows, counts, rowIndex, boundary, measure, replaceEmpty = false) {
    if (rowIndex >= rows.length) {
      rows.push(blankRow());
      counts.push(1);
      writeMeasures(rows, rowIndex, [measure]);
      return;
    }

    const count = Math.max(1, Math.min(MEASURES, Number(counts[rowIndex]) || MEASURES));
    const measures = measuresFor(rows, rowIndex, count);
    if (replaceEmpty && measures.length === 1 && !measureHasNotes(measures[0])) {
      measures[0] = measure;
    } else {
      measures.splice(Math.max(0, Math.min(measures.length, boundary)), 0, measure);
    }
    const overflow = measures.length > MEASURES ? measures.pop() : null;
    counts[rowIndex] = Math.max(1, measures.length);
    writeMeasures(rows, rowIndex, measures);
    if (overflow) cascadeInsert(rows, counts, rowIndex + 1, 0, overflow, true);
  }

  function clearDragVisual() {
    activeLine?.classList.remove('is-active');
    activeLine = null;
    shifted.forEach(node => node.classList.remove('measure-insert-shift'));
    shifted = [];
  }

  function cacheDragGeometry() {
    geometry = Array.from(tabArea.querySelectorAll('.tab-grid[data-row]')).map(grid => {
      const rect = grid.getBoundingClientRect();
      const row = Number(grid.dataset.row);
      const count = Number(grid.dataset.measureCount) || rowMeasureCount(row);
      return {
        row,
        count,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        boundaries: Array.from(grid.querySelectorAll('.measure-insert-boundary')),
        hitboxes: Array.from(grid.querySelectorAll('.measure-module-hitbox'))
      };
    });
  }

  function dragTargetAt(x, y) {
    const grid = geometry.find(item => y >= item.top && y <= item.bottom && x >= item.left && x <= item.right);
    if (!grid) return null;
    const ratio = Math.max(0, Math.min(1, (x - grid.left) / Math.max(1, grid.right - grid.left)));
    return {
      ...grid,
      boundary: Math.max(0, Math.min(grid.count, Math.round(ratio * grid.count)))
    };
  }

  function showDragTarget(next) {
    if (activeTarget && next && activeTarget.row === next.row && activeTarget.boundary === next.boundary) return;
    clearDragVisual();
    activeTarget = next;
    if (!next) return;
    activeLine = next.boundaries.find(node => Number(node.dataset.boundary) === next.boundary) || null;
    activeLine?.classList.add('is-active');
    shifted = next.hitboxes.filter(node => Number(node.dataset.measure) >= next.boundary);
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
    if (!song || previewSong) return;
    const rows = rowsSnapshot();
    const counts = countsSnapshot(rows.length);
    if (!rows[drag.row] || drag.measure < 0 || drag.measure >= counts[drag.row]) return;

    if (drag.row === activeTarget.row) {
      const measures = measuresFor(rows, drag.row, counts[drag.row]);
      const [moved] = measures.splice(drag.measure, 1);
      let insertAt = activeTarget.boundary;
      if (drag.measure < insertAt) insertAt -= 1;
      insertAt = Math.max(0, Math.min(measures.length, insertAt));
      if (insertAt === drag.measure) return;
      measures.splice(insertAt, 0, moved);
      writeMeasures(rows, drag.row, measures);
    } else {
      const sourceMeasures = measuresFor(rows, drag.row, counts[drag.row]);
      const [moved] = sourceMeasures.splice(drag.measure, 1);
      if (sourceMeasures.length === 0) {
        sourceMeasures.push({ notes: Array.from({ length: STRINGS }, () => Array(slotsPerMeasure()).fill('')) });
        counts[drag.row] = 1;
      } else {
        counts[drag.row] = sourceMeasures.length;
      }
      writeMeasures(rows, drag.row, sourceMeasures);
      cascadeInsert(rows, counts, activeTarget.row, activeTarget.boundary, moved, true);
    }

    commitRowsFast(rows, counts, '已移動小節');
  }

  // Run before the older document-level drag handlers. Geometry is measured once
  // at drag start and hover feedback is limited to one update per animation frame.
  window.addEventListener('dragstart', event => {
    if (scoreViewEnabled || previewSong || compactQuery.matches) return;
    const source = event.target.closest?.('.measure-drag-grip,.measure-module-hitbox');
    if (!source) return;
    event.stopPropagation();
    drag = { row: Number(source.dataset.row), measure: Number(source.dataset.measure) };
    activeTarget = null;
    clearDragVisual();
    cacheDragGeometry();
    document.body.classList.add('measure-drag-active');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', `measure:${drag.row}:${drag.measure}`);
    }
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
    if (pendingPoint) {
      activeTarget = dragTargetAt(pendingPoint.x, pendingPoint.y);
      pendingPoint = null;
    }
    commitMeasureMove();
    drag = null;
    activeTarget = null;
    geometry = [];
    clearDragVisual();
    document.body.classList.remove('measure-drag-active');
  }, true);

  window.addEventListener('dragend', () => {
    if (!drag) return;
    drag = null;
    activeTarget = null;
    geometry = [];
    pendingPoint = null;
    if (dragFrame) {
      cancelAnimationFrame(dragFrame);
      dragFrame = 0;
    }
    clearDragVisual();
    document.body.classList.remove('measure-drag-active');
  }, true);
})();
