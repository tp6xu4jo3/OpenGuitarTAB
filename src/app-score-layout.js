(() => {
  const SCORE_LAYOUT_KEY = 'openguitartab:score-measures-per-line:v2';
  const SCORE_LAYOUT_VALUES = [8, 4];
  const baseRenderRows = renderRows;
  const baseSetScoreViewEnabled = setScoreViewEnabled;
  const baseHighlightPlayhead = highlightPlayhead;

  let scoreMeasuresPerLine = Number(localStorage.getItem(SCORE_LAYOUT_KEY));
  if (!SCORE_LAYOUT_VALUES.includes(scoreMeasuresPerLine)) scoreMeasuresPerLine = 8;

  function hydrateGrid(grid, rowValues) {
    grid.querySelectorAll('.note-input').forEach(input => {
      const string = Number(input.dataset.string);
      const position = Number(input.dataset.position);
      const value = String(rowValues?.[string]?.[position] ?? '');
      input.value = value;
      input.classList.toggle('has-value', value.length > 0);
      input.dataset.noteLength = value.length ? String(Math.min(2, value.length)) : '0';
    });
  }

  function prepareWholeRowGrid(grid, rowIndex) {
    const measureCount = rowMeasureCount(rowIndex);
    grid.dataset.measureStart = '0';
    grid.dataset.measureCount = String(measureCount);
    grid.dataset.positionStart = '0';
    grid.dataset.positionCount = String(measureCount * slotsPerMeasure());
    grid.dataset.scoreSegment = 'true';
    grid.style.width = '100%';
    grid.style.minWidth = '0';
    grid.style.maxWidth = '100%';
    return grid;
  }

  function makeScoreGrid(rowIndex, rowCount, rowValues) {
    const system = createTabSystem(rowIndex, rowCount);
    const grid = system.querySelector('.tab-grid');
    if (!grid) return null;
    prepareWholeRowGrid(grid, rowIndex);
    hydrateGrid(grid, rowValues);
    return grid;
  }

  function appendScoreSystem(grids, key, measuresPerLine) {
    const system = makeDiv('tab-system score-system score-layout-system');
    system.dataset.centerKey = key;
    const pair = makeDiv('score-grid-pair');
    pair.dataset.measuresPerLine = String(measuresPerLine);
    grids.filter(Boolean).forEach(grid => pair.appendChild(grid));
    system.appendChild(pair);
    tabArea.appendChild(system);
  }

  function renderScoreRows(rows) {
    stopPlayback();
    const normalized = normalizeRows(rows, activeBeatsPerMeasure);
    tabArea.innerHTML = '';
    const rowCount = normalized.length;

    if (scoreMeasuresPerLine === 8) {
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 2) {
        const grids = [rowIndex, rowIndex + 1]
          .filter(index => index < rowCount)
          .map(index => makeScoreGrid(index, rowCount, normalized[index]));
        appendScoreSystem(grids, `score-8-${Math.floor(rowIndex / 2)}`, 8);
      }
    } else {
      normalized.forEach((row, rowIndex) => {
        appendScoreSystem([makeScoreGrid(rowIndex, rowCount, row)], `score-4-${rowIndex}`, 4);
      });
    }

    normalized.forEach((_, rowIndex) => renderRhythmNotation(rowIndex));
    updateRemoveRowButton();
    updateProgressRange();
    setProgressIndex(Math.min(playIndex, totalSlots() - 1), true, true);
    requestAnimationFrame(fitAllNoteCollisions);
  }

  function filledInputsByString(container) {
    const groups = new Map();
    container.querySelectorAll('.note-input.has-value').forEach(input => {
      const string = Number(input.dataset.string);
      if (!groups.has(string)) groups.set(string, []);
      groups.get(string).push(input);
    });
    groups.forEach(inputs => inputs.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left));
    return groups;
  }

  function hasVisualCollision(container, gap = 1.5) {
    for (const inputs of filledInputsByString(container).values()) {
      for (let index = 1; index < inputs.length; index++) {
        const previous = inputs[index - 1].getBoundingClientRect();
        const current = inputs[index].getBoundingClientRect();
        if (previous.right + gap > current.left) return true;
      }
    }
    return false;
  }

  function applyNoteSize(grids, size) {
    grids.forEach(grid => grid.style.setProperty('--adaptive-note-size', `${size}px`));
  }

  function applyNoteScaleX(grids, scale) {
    grids.forEach(grid => grid.style.setProperty('--adaptive-note-scale-x', String(scale)));
  }

  function setCollisionState(grids, scaled) {
    grids.forEach(grid => { grid.dataset.noteCollisionScaled = scaled ? 'true' : 'false'; });
  }

  function fitCollisionContainer(container, grids, baseSize, preferredFloor, hardFloor) {
    if (!(container instanceof HTMLElement) || grids.length === 0) return;

    container.style.removeProperty('min-width');
    container.style.maxWidth = '100%';
    grids.forEach(grid => {
      grid.style.removeProperty('min-width');
      grid.style.maxWidth = '100%';
    });

    let size = baseSize;
    let scaleX = 1;
    applyNoteSize(grids, size);
    applyNoteScaleX(grids, scaleX);
    setCollisionState(grids, false);

    if (container.querySelectorAll('.note-input.has-value').length < 2) return;

    // First preserve normal glyph proportions and only reduce to a readable floor.
    while (size > preferredFloor && hasVisualCollision(container)) {
      size -= 1;
      applyNoteSize(grids, size);
    }

    // If the row is still dense, keep text height readable and condense horizontally.
    while (scaleX > 0.62 && hasVisualCollision(container)) {
      scaleX = Math.max(0.62, Number((scaleX - 0.04).toFixed(2)));
      applyNoteScaleX(grids, scaleX);
    }

    // Only use the lower font-size floor when horizontal condensing alone is not enough.
    while (size > hardFloor && hasVisualCollision(container)) {
      size -= 1;
      applyNoteSize(grids, size);
    }

    // Final fallback stays inside the viewport; never grow the score wider than the sheet.
    while (scaleX > 0.48 && hasVisualCollision(container)) {
      scaleX = Math.max(0.48, Number((scaleX - 0.02).toFixed(2)));
      applyNoteScaleX(grids, scaleX);
    }

    setCollisionState(grids, size < baseSize || scaleX < 1);
  }

  function fitAllNoteCollisions() {
    const scorePairs = new Set();
    if (scoreViewEnabled) {
      tabArea.querySelectorAll('.score-grid-pair').forEach(pair => {
        scorePairs.add(pair);
        fitCollisionContainer(pair, Array.from(pair.querySelectorAll(':scope > .tab-grid')), 30, 18, 14);
      });
    }

    tabArea.querySelectorAll('.tab-grid').forEach(grid => {
      if (scoreViewEnabled && grid.closest('.score-grid-pair') && scorePairs.has(grid.closest('.score-grid-pair'))) return;
      fitCollisionContainer(
        grid,
        [grid],
        scoreViewEnabled ? 30 : 24,
        scoreViewEnabled ? 18 : 16,
        scoreViewEnabled ? 14 : 13
      );
    });
  }

  function ensureScoreLayoutControl() {
    let control = document.getElementById('scoreLayoutControl');
    if (control) return control;

    control = document.createElement('div');
    control.id = 'scoreLayoutControl';
    control.className = 'score-layout-control';
    control.setAttribute('aria-label', '看譜模式每列小節數');

    const label = document.createElement('span');
    label.className = 'score-layout-label';
    label.textContent = '每列';
    control.appendChild(label);

    SCORE_LAYOUT_VALUES.forEach(value => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'score-layout-option';
      button.dataset.value = String(value);
      button.textContent = String(value);
      button.setAttribute('aria-label', `看譜模式每列 ${value} 小節`);
      button.addEventListener('click', () => {
        if (scoreMeasuresPerLine === value) return;
        scoreMeasuresPerLine = value;
        localStorage.setItem(SCORE_LAYOUT_KEY, String(value));
        updateScoreLayoutControl();
        const song = currentSong();
        if (song) renderRows(song.rows);
      });
      control.appendChild(button);
    });

    rhythmToggleButton.insertAdjacentElement('afterend', control);
    updateScoreLayoutControl();
    return control;
  }

  function updateScoreLayoutControl() {
    const control = document.getElementById('scoreLayoutControl');
    if (!control) return;
    control.hidden = !scoreViewEnabled;
    control.querySelectorAll('.score-layout-option').forEach(button => {
      const active = Number(button.dataset.value) === scoreMeasuresPerLine;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  renderRows = function renderRowsWithScoreLayout(rows) {
    if (scoreViewEnabled) {
      renderScoreRows(rows);
      return;
    }
    baseRenderRows(rows);
    requestAnimationFrame(fitAllNoteCollisions);
  };

  setScoreViewEnabled = function setScoreViewEnabledWithLayout(enabled) {
    baseSetScoreViewEnabled(enabled);
    ensureScoreLayoutControl();
    updateScoreLayoutControl();
    requestAnimationFrame(fitAllNoteCollisions);
  };

  highlightPlayhead = function highlightPlayheadWithScoreRows(row, position) {
    baseHighlightPlayhead(row, position);
    if (!scoreViewEnabled || !isPlaying) return;

    document.querySelectorAll('.playhead-column').forEach(node => node.remove());
    const input = Array.from(document.querySelectorAll(`.note-input[data-row="${row}"][data-position="${position}"]`))
      .find(node => node.closest('.tab-grid'));
    const grid = input?.closest('.tab-grid');
    if (!grid) return;

    const positionCount = Number(grid.dataset.positionCount) || rowPositionCount(row);
    const localPosition = position - (Number(grid.dataset.positionStart) || 0);
    if (localPosition < 0 || localPosition >= positionCount) return;

    const playhead = makeDiv('playhead-column');
    playhead.style.left = `${((localPosition + 1) / positionCount) * 100}%`;
    playhead.style.width = `${Math.max(0.8, (100 / positionCount) * 1.35)}%`;
    playhead.setAttribute('aria-hidden', 'true');
    grid.appendChild(playhead);
  };

  const scheduleFit = () => requestAnimationFrame(fitAllNoteCollisions);
  const resizeObserver = new ResizeObserver(scheduleFit);
  resizeObserver.observe(document.querySelector('.sheet') || tabArea);
  window.addEventListener('resize', scheduleFit);

  ensureScoreLayoutControl();
  updateScoreLayoutControl();
  requestAnimationFrame(fitAllNoteCollisions);
})();
