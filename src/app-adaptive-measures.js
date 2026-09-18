(() => {
  const compactQuery = window.matchMedia('(max-width: 980px)');
  const baseRenderRows = renderRows;
  const baseCreateTabSystem = createTabSystem;
  const baseHighlightPlayhead = highlightPlayhead;

  function isCompactMeasureLayout() {
    return compactQuery.matches;
  }

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
    });
  }

  function makeExtraGrid(rowIndex, rowCount, rowValues, segment) {
    const extraSystem = baseCreateTabSystem(rowIndex, rowCount);
    const grid = extraSystem.querySelector('.tab-grid');
    if (!grid) return null;
    trimGridToSegment(grid, rowIndex, segment.startMeasure, segment.measureCount);
    hydrateGrid(grid, rowValues);
    return grid;
  }

  function splitExistingGrid(grid, rowIndex, rowCount, rowValues) {
    const windows = segmentWindows(rowIndex);
    const first = windows[0];
    trimGridToSegment(grid, rowIndex, first.startMeasure, first.measureCount);
    hydrateGrid(grid, rowValues);

    if (windows.length === 1) return;

    const stack = makeDiv('responsive-measure-stack');
    grid.replaceWith(stack);
    stack.appendChild(grid);

    windows.slice(1).forEach(segment => {
      const extraGrid = makeExtraGrid(rowIndex, rowCount, rowValues, segment);
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

    if (explicitRhythm && Object.keys(explicitRhythm).length > 0) {
      for (const [rawPosition, rawDuration] of Object.entries(explicitRhythm)) {
        const position = Number(rawPosition);
        if (position < startPosition || position >= endPosition) continue;
        const notes = getFilledInputsAt(rowIndex, position);
        const lowestString = notes.length > 0 ? Math.max(...notes.map(input => Number(input.dataset.string))) : STRINGS - 1;
        onsets.push({ position, duration: Number(rawDuration), lowestString });
      }
      onsets.sort((a, b) => a.position - b.position);
    } else {
      for (let position = startPosition; position < endPosition; position++) {
        const notes = getFilledInputsAt(rowIndex, position);
        if (notes.length > 0) onsets.push({ position, duration: 1, lowestString: Math.max(...notes.map(input => Number(input.dataset.string))) });
      }
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
        } else if (primary.length === 1) {
          appendMark('rhythm-flag primary', percent(primary[0].position));
        }

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
            if (primary.length === 1) {
              appendMark('rhythm-flag secondary', percent(onset.position));
            } else {
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
    const layers = Array.from(document.querySelectorAll(`.rhythm-layer[data-row="${rowIndex}"]`));
    if (!layers.length) return;
    layers.forEach(layer => renderRhythmLayer(layer, rowIndex));
  };

  renderRows = function adaptiveRenderRows(rows) {
    baseRenderRows(rows);
    if (!isCompactMeasureLayout()) return;

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
    if (!isCompactMeasureLayout() || !scoreViewEnabled || !isPlaying) return;

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

    let rows = song.rows;
    if (tabArea.querySelector('.note-input')) {
      try {
        rows = readRowsFromDom();
        if (!previewSong) song.rows = normalizeRows(rows, song.beatsPerMeasure);
      } catch (_) {}
    }
    renderRows(rows);
  });
})();
