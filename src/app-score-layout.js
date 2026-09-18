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

  function filledInputsByString(grid) {
    const groups = new Map();
    grid.querySelectorAll('.note-input.has-value').forEach(input => {
      const string = Number(input.dataset.string);
      if (!groups.has(string)) groups.set(string, []);
      groups.get(string).push(input);
    });
    groups.forEach(inputs => inputs.sort((a, b) => Number(a.dataset.position) - Number(b.dataset.position)));
    return groups;
  }

  function gridHasCollision(grid, gap = 2) {
    for (const inputs of filledInputsByString(grid).values()) {
      for (let index = 1; index < inputs.length; index++) {
        const previous = inputs[index - 1].getBoundingClientRect();
        const current = inputs[index].getBoundingClientRect();
        if (previous.right + gap > current.left) return true;
      }
    }
    return false;
  }

  function fitGridNoteCollisions(grid) {
    if (!(grid instanceof HTMLElement)) return;
    const filled = grid.querySelectorAll('.note-input.has-value');
    const baseSize = scoreViewEnabled ? 30 : 24;
    const minimumSize = scoreViewEnabled ? 9 : 10;

    grid.style.removeProperty('min-width');
    grid.style.setProperty('--adaptive-note-size', `${baseSize}px`);
    grid.dataset.noteCollisionScaled = 'false';
    if (filled.length < 2) return;

    let size = baseSize;
    while (size > minimumSize && gridHasCollision(grid)) {
      size -= 1;
      grid.style.setProperty('--adaptive-note-size', `${size}px`);
    }

    if (size < baseSize) grid.dataset.noteCollisionScaled = 'true';

    if (gridHasCollision(grid)) {
      const width = grid.getBoundingClientRect().width;
      let growth = 1;
      while (growth < 2.2 && gridHasCollision(grid)) {
        growth += 0.05;
        grid.style.minWidth = `${Math.ceil(width * growth)}px`;
      }
    }
  }

  function fitAllNoteCollisions() {
    tabArea.querySelectorAll('.tab-grid').forEach(fitGridNoteCollisions);
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

  const resizeObserver = new ResizeObserver(() => requestAnimationFrame(fitAllNoteCollisions));
  resizeObserver.observe(document.querySelector('.sheet') || tabArea);

  ensureScoreLayoutControl();
  updateScoreLayoutControl();
  requestAnimationFrame(fitAllNoteCollisions);
})();
