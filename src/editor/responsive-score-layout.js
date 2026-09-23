let installed = false;

function installAdaptiveMeasureLayout() {
  const compactQuery = window.matchMedia('(max-width: 980px)');
  const baseRenderRows = renderRows;
  const baseCreateTabSystem = createTabSystem;
  const baseHighlightPlayhead = highlightPlayhead;

  function segmentWindows(rowIndex) {
    const total = rowMeasureCount(rowIndex);
    const windows = [];
    for (let start = 0; start < total; start += 2) {
      windows.push({ startMeasure: start, measureCount: Math.min(2, total - start) });
    }
    return windows.length ? windows : [{ startMeasure: 0, measureCount: 1 }];
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

  function trimGridToSegment(grid, rowIndex, startMeasure, measureCount) {
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
    grid.dataset.responsiveSplit = 'true';
    grid.style.setProperty('--steps', visibleSteps);
    grid.style.width = measureCount === 1 ? '50%' : '100%';

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

    grid.querySelectorAll('.measure-line').forEach(line => {
      const index = Number(line.style.getPropertyValue('--measure-index'));
      if (!Number.isFinite(index) || index < startMeasure || index > startMeasure + measureCount) {
        line.remove();
        return;
      }
      const localIndex = index - startMeasure;
      line.style.left = `${(localIndex / measureCount) * 100}%`;
      line.classList.toggle('first', localIndex === 0);
      line.classList.toggle('last', localIndex === measureCount);
    });

    grid.querySelectorAll('.measure-module-hitbox').forEach(hitbox => {
      const measureIndex = Number(hitbox.dataset.measure);
      if (measureIndex < startMeasure || measureIndex >= startMeasure + measureCount) {
        hitbox.remove();
        return;
      }
      const localIndex = measureIndex - startMeasure;
      hitbox.style.left = `${(localIndex / measureCount) * 100}%`;
      hitbox.style.width = `${100 / measureCount}%`;
    });

    rebuildBeatGuides(grid, measureCount);
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

  function makeExtraGrid(rowIndex, rowCount, rowValues, segment, scoreTemplate = null) {
    let grid = null;
    if (scoreTemplate && scoreViewEnabled) grid = scoreTemplate.cloneNode(true);
    else grid = baseCreateTabSystem(rowIndex, rowCount).querySelector('.tab-grid');
    if (!grid) return null;
    trimGridToSegment(grid, rowIndex, segment.startMeasure, segment.measureCount);
    hydrateGrid(grid, rowValues);
    return grid;
  }

  function splitExistingGrid(grid, rowIndex, rowCount, rowValues) {
    const windows = segmentWindows(rowIndex);
    const scoreTemplate = scoreViewEnabled && windows.length > 1 ? grid.cloneNode(true) : null;
    const first = windows[0];
    trimGridToSegment(grid, rowIndex, first.startMeasure, first.measureCount);
    hydrateGrid(grid, rowValues);
    if (windows.length === 1) return;

    const stack = makeDiv('responsive-measure-stack');
    grid.replaceWith(stack);
    stack.appendChild(grid);
    windows.slice(1).forEach(segment => {
      const extraGrid = makeExtraGrid(rowIndex, rowCount, rowValues, segment, scoreTemplate);
      if (extraGrid) stack.appendChild(extraGrid);
    });
  }

  function segmentMetrics(layer) {
    const grid = layer.closest('.tab-grid');
    const startMeasure = Number(grid?.dataset.measureStart) || 0;
    const measureCount = Number(grid?.dataset.measureCount) || rowMeasureCount(Number(grid?.dataset.row) || 0);
    const startPosition = Number(grid?.dataset.positionStart) || startMeasure * slotsPerMeasure();
    const positionCount = Number(grid?.dataset.positionCount) || measureCount * slotsPerMeasure();
    return { grid, startMeasure, measureCount, startPosition, positionCount };
  }

  function filledPositions(grid, startPosition, endPosition) {
    const map = new Map();
    grid.querySelectorAll('.note-input.has-value').forEach(input => {
      if (!String(input.value || '').length) return;
      const position = Number(input.dataset.position);
      if (position < startPosition || position >= endPosition) return;
      const string = Number(input.dataset.string);
      const current = map.get(position);
      if (current === undefined || string > current) map.set(position, string);
    });
    return map;
  }

  function renderRhythmLayer(layer, rowIndex) {
    layer.innerHTML = '';
    const { grid, startMeasure, measureCount, startPosition, positionCount } = segmentMetrics(layer);
    if (!grid || positionCount <= 0) return;

    const endPosition = startPosition + positionCount;
    const gridStyles = getComputedStyle(grid);
    const rowHeight = parseFloat(gridStyles.getPropertyValue('--row-height')) || 32;
    const valueHeight = parseFloat(gridStyles.getPropertyValue('--value-height')) || 34;
    const stemEnd = parseFloat(gridStyles.getPropertyValue('--stem-end')) || 35;
    const staffHeight = rowHeight * STRINGS;
    const measureSlots = slotsPerMeasure();
    const onsets = [];
    const explicitRhythm = currentSong()?.rhythmRows?.[rowIndex];
    const filled = filledPositions(grid, startPosition, endPosition);

    if (explicitRhythm && Object.keys(explicitRhythm).length > 0) {
      for (const [rawPosition, rawDuration] of Object.entries(explicitRhythm)) {
        const position = Number(rawPosition);
        if (position < startPosition || position >= endPosition) continue;
        onsets.push({ position, duration: Number(rawDuration), lowestString: filled.get(position) ?? STRINGS - 1 });
      }
      onsets.sort((a, b) => a.position - b.position);
    } else {
      Array.from(filled.entries()).sort((a, b) => a[0] - b[0]).forEach(([position, lowestString]) => onsets.push({ position, duration: 1, lowestString }));
      onsets.forEach((onset, index) => {
        const measureEnd = (Math.floor(onset.position / measureSlots) + 1) * measureSlots;
        const next = onsets[index + 1];
        onset.duration = Math.max(1, Math.min(next && next.position < measureEnd ? next.position - onset.position : measureEnd - onset.position, measureSlots));
      });
    }

    const percent = position => ((position - startPosition + 1) / positionCount) * 100;
    const appendMark = (className, leftPercent, widthPercent = null) => {
      const mark = makeDiv(className);
      mark.style.left = `${leftPercent}%`;
      if (widthPercent !== null) mark.style.width = `${Math.max(0.3, widthPercent)}%`;
      layer.appendChild(mark);
      return mark;
    };

    onsets.forEach(onset => {
      const left = percent(onset.position);
      if (onset.duration < measureSlots || activeBeatsPerMeasure === 3) {
        const stem = appendMark('rhythm-stem', left);
        const stemTop = onset.lowestString * rowHeight + rowHeight / 2 + valueHeight / 2 + 2 - staffHeight;
        stem.style.top = `${stemTop}px`;
        stem.style.height = `${stemEnd - stemTop}px`;
      }
      if ([3, 6, 12].includes(onset.duration)) appendMark('rhythm-dot', left);
    });

    const groupSlots = rhythmGroupSlots();
    for (let measure = startMeasure; measure < startMeasure + measureCount; measure++) {
      for (let groupStart = 0; groupStart < measureSlots; groupStart += groupSlots) {
        const beatStart = measure * measureSlots + groupStart;
        const beatEnd = beatStart + groupSlots;
        const beatOnsets = onsets.filter(onset => onset.position >= beatStart && onset.position < beatEnd);
        const primary = beatOnsets.filter(onset => onset.duration <= 3);
        if (primary.length >= 2) {
          const first = percent(primary[0].position);
          const last = percent(primary[primary.length - 1].position);
          appendMark('rhythm-beam primary', first, last - first);
        } else if (primary.length === 1) appendMark('rhythm-flag primary', percent(primary[0].position));

        const sixteenths = primary.filter(onset => onset.duration === 1);
        let run = [];
        const flush = () => {
          if (run.length >= 2) {
            const first = percent(run[0].position);
            const last = percent(run[run.length - 1].position);
            appendMark('rhythm-beam secondary', first, last - first);
          } else if (run.length === 1) {
            const onset = run[0];
            const onsetIndex = primary.indexOf(onset);
            if (primary.length === 1) appendMark('rhythm-flag secondary', percent(onset.position));
            else {
              const previous = primary[onsetIndex - 1];
              const next = primary[onsetIndex + 1];
              let direction = 'right';
              if (!next) direction = 'left';
              else if (previous) direction = onset.position - previous.position < next.position - onset.position ? 'left' : 'right';
              const partialWidth = (0.65 / positionCount) * 100;
              const onsetLeft = percent(onset.position);
              appendMark('rhythm-beam secondary partial', direction === 'left' ? onsetLeft - partialWidth : onsetLeft, partialWidth);
            }
          }
          run = [];
        };
        sixteenths.forEach(onset => {
          if (run.length && onset.position !== run[run.length - 1].position + 1) flush();
          run.push(onset);
        });
        flush();
      }
    }
  }

  renderRhythmNotation = function adaptiveRenderRhythmNotation(rowIndex) {
    const layers = Array.from(tabArea.querySelectorAll(`.rhythm-layer[data-row="${rowIndex}"]`));
    layers.forEach(layer => renderRhythmLayer(layer, rowIndex));
  };

  renderRows = function adaptiveRenderRows(rows) {
    baseRenderRows(rows);
    if (!compactQuery.matches) return;
    const normalized = normalizeRows(rows, activeBeatsPerMeasure);
    const rowCount = normalized.length;
    const seenRows = new Set();
    Array.from(tabArea.querySelectorAll('.tab-grid[data-row]')).forEach(grid => {
      const rowIndex = Number(grid.dataset.row);
      if (!Number.isInteger(rowIndex) || seenRows.has(rowIndex)) return;
      seenRows.add(rowIndex);
      splitExistingGrid(grid, rowIndex, rowCount, normalized[rowIndex]);
    });
    normalized.forEach((_, rowIndex) => renderRhythmNotation(rowIndex));
  };

  highlightPlayhead = function adaptiveHighlightPlayhead(row, position) {
    baseHighlightPlayhead(row, position);
    if (!compactQuery.matches || !scoreViewEnabled || !isPlaying) return;
    document.querySelectorAll('.playhead-column').forEach(node => node.remove());
    const activeInput = getInput(row, 0, position) || document.querySelector(`.note-input[data-row="${row}"][data-position="${position}"]`);
    const grid = activeInput?.closest('.tab-grid');
    if (!grid) return;
    const startPosition = Number(grid.dataset.positionStart) || 0;
    const positionCount = Number(grid.dataset.positionCount) || rowPositionCount(row);
    const localPosition = position - startPosition;
    const playhead = makeDiv('playhead-column');
    playhead.style.left = `${((localPosition + 1) / positionCount) * 100}%`;
    playhead.style.width = `${Math.max(0.8, (100 / positionCount) * 1.35)}%`;
    playhead.setAttribute('aria-hidden', 'true');
    grid.appendChild(playhead);
  };

  compactQuery.addEventListener('change', () => {
    if (editorView.hidden) return;
    const song = currentSong();
    if (!song) return;
    renderRows(song.rows);
  });
}

function installScoreLayout() {
  const SCORE_LAYOUT_KEY = 'openguitartab:score-measures-per-line:v2';
  const SCORE_LAYOUT_VALUES = [8, 4];
  const compactQuery = window.matchMedia('(max-width: 980px)');
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
    const grid = createTabSystem(rowIndex, rowCount).querySelector('.tab-grid');
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
        const grids = [rowIndex, rowIndex + 1].filter(index => index < rowCount).map(index => makeScoreGrid(index, rowCount, normalized[index]));
        appendScoreSystem(grids, `score-8-${Math.floor(rowIndex / 2)}`, 8);
      }
    } else {
      normalized.forEach((row, rowIndex) => appendScoreSystem([makeScoreGrid(rowIndex, rowCount, row)], `score-4-${rowIndex}`, 4));
    }
    normalized.forEach((_, rowIndex) => renderRhythmNotation(rowIndex));
    updateRemoveRowButton();
    updateProgressRange();
    setProgressIndex(Math.min(playIndex, totalSlots() - 1), true, true);
  }

  function updateScoreLayoutControl() {
    const control = document.getElementById('scoreLayoutControl');
    if (!control) return;
    control.hidden = !scoreViewEnabled || compactQuery.matches;
    control.querySelectorAll('.score-layout-option').forEach(button => {
      const active = Number(button.dataset.value) === scoreMeasuresPerLine;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
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

  renderRows = function renderRowsWithScoreLayout(rows) {
    if (scoreViewEnabled) {
      if (compactQuery.matches) return baseRenderRows(rows);
      renderScoreRows(rows);
      return;
    }
    baseRenderRows(rows);
  };

  setScoreViewEnabled = function setScoreViewEnabledWithLayout(enabled) {
    const result = baseSetScoreViewEnabled(enabled);
    ensureScoreLayoutControl();
    updateScoreLayoutControl();
    window.scheduleDensityFitAll?.(true);
    return result;
  };

  highlightPlayhead = function highlightPlayheadWithScoreRows(row, position) {
    baseHighlightPlayhead(row, position);
    if (!scoreViewEnabled || !isPlaying) return;
    document.querySelectorAll('.playhead-column').forEach(node => node.remove());
    const input = Array.from(document.querySelectorAll(`.note-input[data-row="${row}"][data-position="${position}"]`)).find(node => node.closest('.tab-grid'));
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

  compactQuery.addEventListener('change', updateScoreLayoutControl);
  ensureScoreLayoutControl();
  updateScoreLayoutControl();
}

export function installResponsiveScoreLayout() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  installAdaptiveMeasureLayout();
  installScoreLayout();
}
