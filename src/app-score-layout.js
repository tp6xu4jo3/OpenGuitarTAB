(() => {
  const SCORE_LAYOUT_KEY = 'openguitartab:score-measures-per-line';
  const SCORE_LAYOUT_VALUES = [8, 4, 2];
  const baseRenderRows = renderRows;
  const baseSetScoreViewEnabled = setScoreViewEnabled;
  const baseHighlightPlayhead = highlightPlayhead;

  let scoreMeasuresPerLine = Number(localStorage.getItem(SCORE_LAYOUT_KEY));
  if (!SCORE_LAYOUT_VALUES.includes(scoreMeasuresPerLine)) {
    scoreMeasuresPerLine = window.matchMedia('(max-width: 980px)').matches ? 2 : 4;
  }

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

  function rebuildBeatGuides(grid, measureCount) {
    grid.querySelectorAll('.beat-guide').forEach(line => line.remove());
    const totalBeats = measureCount * activeBeatsPerMeasure;
    for (let guide = 1; guide < totalBeats; guide++) {
      if (guide % activeBeatsPerMeasure === 0) continue;
      const line = makeDiv('beat-guide');
      line.style.setProperty('--guide-percent', `${(guide / totalBeats) * 100}%`);
      grid.appendChild(line);
    }
  }

  function trimGrid(grid, rowIndex, startMeasure, measureCount) {
    const measureSlots = slotsPerMeasure();
    const measureSteps = stepsPerMeasure();
    const startPosition = startMeasure * measureSlots;
    const positionCount = measureCount * measureSlots;
    const endPosition = startPosition + positionCount;
    const startStep = startMeasure * measureSteps;
    const visibleSteps = measureCount * measureSteps;

    grid.dataset.measureStart = String(startMeasure);
    grid.dataset.measureCount = String(measureCount);
    grid.dataset.positionStart = String(startPosition);
    grid.dataset.positionCount = String(positionCount);
    grid.dataset.scoreSegment = 'true';
    grid.style.setProperty('--steps', visibleSteps);
    grid.style.width = '100%';

    grid.querySelectorAll('.cell').forEach(cell => {
      const input = cell.querySelector('.note-input');
      if (!input) return;
      const position = Number(input.dataset.position);
      if (position < startPosition || position >= endPosition) {
        cell.remove();
        return;
      }
      const originalStep = Number(input.dataset.step);
      if (Number.isFinite(originalStep)) cell.style.gridColumn = String(originalStep - startStep + 1);
    });

    grid.querySelectorAll('.small-cell').forEach(cell => {
      const input = cell.querySelector('.note-input');
      if (!input) return;
      const position = Number(input.dataset.position);
      if (position < startPosition || position >= endPosition) {
        cell.remove();
        return;
      }
      const localPosition = position - startPosition;
      const localStep = Math.floor(localPosition / 2);
      cell.style.left = `${((localStep + 1) / visibleSteps) * 100}%`;
    });

    grid.querySelectorAll('.measure-line').forEach(line => line.remove());
    for (let index = 0; index <= measureCount; index++) {
      const line = makeDiv('measure-line');
      line.style.setProperty('--measure-index', String(index));
      line.style.left = `${(index / measureCount) * 100}%`;
      if (index === 0) line.classList.add('first');
      if (index === measureCount) line.classList.add('last');
      grid.appendChild(line);
    }

    grid.querySelectorAll('.measure-module-hitbox,.measure-insert-boundary').forEach(node => node.remove());
    rebuildBeatGuides(grid, measureCount);
    grid.dataset.row = String(rowIndex);
  }

  function makeScoreGrid(rowIndex, rowCount, rowValues, startMeasure = 0, measureCount = rowMeasureCount(rowIndex)) {
    const system = createTabSystem(rowIndex, rowCount);
    const grid = system.querySelector('.tab-grid');
    if (!grid) return null;
    if (startMeasure !== 0 || measureCount !== rowMeasureCount(rowIndex)) {
      trimGrid(grid, rowIndex, startMeasure, measureCount);
    } else {
      grid.dataset.measureStart = '0';
      grid.dataset.measureCount = String(measureCount);
      grid.dataset.positionStart = '0';
      grid.dataset.positionCount = String(measureCount * slotsPerMeasure());
      grid.style.width = '100%';
    }
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
    } else if (scoreMeasuresPerLine === 4) {
      normalized.forEach((row, rowIndex) => {
        appendScoreSystem([makeScoreGrid(rowIndex, rowCount, row)], `score-4-${rowIndex}`, 4);
      });
    } else {
      normalized.forEach((row, rowIndex) => {
        const count = rowMeasureCount(rowIndex);
        for (let start = 0; start < count; start += 2) {
          const countHere = Math.min(2, count - start);
          appendScoreSystem(
            [makeScoreGrid(rowIndex, rowCount, row, start, countHere)],
            `score-2-${rowIndex}-${start}`,
            2
          );
        }
      });
    }

    normalized.forEach((_, rowIndex) => renderRhythmNotation(rowIndex));
    updateRemoveRowButton();
    updateProgressRange();
    setProgressIndex(Math.min(playIndex, totalSlots() - 1), true, true);
    requestAnimationFrame(scaleAllGrids);
  }

  function getGridPositionCount(grid) {
    const explicit = Number(grid.dataset.positionCount);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const row = Number(grid.dataset.row);
    return typeof rowPositionCount === 'function' && Number.isInteger(row)
      ? rowPositionCount(row)
      : positionsPerRow();
  }

  function scaleGridNotes(grid) {
    if (!(grid instanceof HTMLElement)) return;
    const positionCount = getGridPositionCount(grid);
    const width = grid.getBoundingClientRect().width;
    if (!width || !positionCount) return;

    const baseSize = scoreViewEnabled ? 30 : 24;
    const pitch = width / positionCount;
    // Two-digit TAB values are roughly 1.25–1.35em wide. Keep a small gap so adjacent values never touch.
    const fitted = Math.floor((pitch - 2) / 1.32);
    const fontSize = Math.max(10, Math.min(baseSize, fitted));
    grid.style.setProperty('--adaptive-note-size', `${fontSize}px`);

    // Below the legibility floor, preserve readable text and let the sheet scroll instead of overlapping notes.
    const minimumPitch = 10 * 1.32 + 2;
    const minimumWidth = Math.ceil(positionCount * minimumPitch);
    grid.style.minWidth = width < minimumWidth ? `${minimumWidth}px` : '';
  }

  function scaleAllGrids() {
    tabArea.querySelectorAll('.tab-grid').forEach(scaleGridNotes);
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
    requestAnimationFrame(scaleAllGrids);
  };

  setScoreViewEnabled = function setScoreViewEnabledWithLayout(enabled) {
    baseSetScoreViewEnabled(enabled);
    ensureScoreLayoutControl();
    updateScoreLayoutControl();
  };

  highlightPlayhead = function highlightPlayheadWithScoreSegments(row, position) {
    baseHighlightPlayhead(row, position);
    if (!scoreViewEnabled || !isPlaying) return;

    document.querySelectorAll('.playhead-column').forEach(node => node.remove());
    const candidates = Array.from(document.querySelectorAll(`.note-input[data-row="${row}"][data-position="${position}"]`));
    const input = candidates.find(node => node.closest('.tab-grid'));
    const grid = input?.closest('.tab-grid');
    if (!grid) return;

    const startPosition = Number(grid.dataset.positionStart) || 0;
    const positionCount = getGridPositionCount(grid);
    const localPosition = position - startPosition;
    if (localPosition < 0 || localPosition >= positionCount) return;

    const playhead = makeDiv('playhead-column');
    playhead.style.left = `${((localPosition + 1) / positionCount) * 100}%`;
    playhead.style.width = `${Math.max(0.8, (100 / positionCount) * 1.35)}%`;
    playhead.setAttribute('aria-hidden', 'true');
    grid.appendChild(playhead);
  };

  const resizeObserver = new ResizeObserver(() => scaleAllGrids());
  resizeObserver.observe(document.querySelector('.sheet') || tabArea);

  ensureScoreLayoutControl();
  updateScoreLayoutControl();
  requestAnimationFrame(scaleAllGrids);
})();
