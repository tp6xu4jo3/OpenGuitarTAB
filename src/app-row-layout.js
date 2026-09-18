(() => {
  const originalNormalizeSongRecord = normalizeSongRecord;
  const originalCreateTabSystem = createTabSystem;

  function normalizeCounts(rawCounts, rowCount) {
    return Array.from({ length: rowCount }, (_, index) => {
      const value = Number(rawCounts?.[index]);
      return Number.isInteger(value) ? Math.max(1, Math.min(MEASURES, value)) : MEASURES;
    });
  }

  window.ensureRowMeasureCounts = function ensureRowMeasureCounts(song = currentSong()) {
    if (!song) return [];
    song.rowMeasureCounts = normalizeCounts(song.rowMeasureCounts, song.rows?.length || 1);
    return song.rowMeasureCounts;
  };

  window.rowMeasureCount = function rowMeasureCount(rowIndex, song = currentSong()) {
    if (!song) return MEASURES;
    const counts = normalizeCounts(song.rowMeasureCounts, song.rows?.length || 1);
    return counts[rowIndex] || MEASURES;
  };

  window.rowPositionCount = function rowPositionCount(rowIndex, song = currentSong()) {
    return rowMeasureCount(rowIndex, song) * slotsPerMeasure(song?.beatsPerMeasure || activeBeatsPerMeasure);
  };

  window.rowStepCount = function rowStepCount(rowIndex, song = currentSong()) {
    return rowMeasureCount(rowIndex, song) * stepsPerMeasure(song?.beatsPerMeasure || activeBeatsPerMeasure);
  };

  normalizeSongRecord = function normalizeSongRecordWithLayout(song) {
    const normalized = originalNormalizeSongRecord(song);
    normalized.rowMeasureCounts = normalizeCounts(song?.rowMeasureCounts, normalized.rows.length);
    return normalized;
  };

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

  createTabSystem = function createVariableMeasureTabSystem(rowIndex, rowCount) {
    const system = originalCreateTabSystem(rowIndex, rowCount);
    const grid = system.querySelector('.tab-grid');
    if (!grid) return system;

    const measureCount = rowMeasureCount(rowIndex);
    const visibleSteps = measureCount * stepsPerMeasure();
    const visiblePositions = measureCount * slotsPerMeasure();
    grid.dataset.measureCount = String(measureCount);
    grid.style.setProperty('--steps', visibleSteps);
    grid.style.width = `${measureCount * 25}%`;

    grid.querySelectorAll('.cell').forEach(cell => {
      const input = cell.querySelector('.note-input');
      if (!input || Number(input.dataset.position) >= visiblePositions) cell.remove();
    });

    grid.querySelectorAll('.small-cell').forEach(cell => {
      const input = cell.querySelector('.note-input');
      if (!input || Number(input.dataset.position) >= visiblePositions) {
        cell.remove();
        return;
      }
      const position = Number(input.dataset.position);
      const originalStep = Math.floor(position / 2);
      cell.style.left = `${((originalStep + 1) / visibleSteps) * 100}%`;
    });

    const measureLines = Array.from(grid.querySelectorAll('.measure-line'));
    measureLines.forEach(line => {
      const index = Number(getComputedStyle(line).getPropertyValue('--measure-index'));
      if (Number.isFinite(index) && index > measureCount) {
        line.remove();
        return;
      }
      line.classList.remove('last');
      if (Number.isFinite(index)) line.style.left = `${(index / measureCount) * 100}%`;
      if (index === measureCount) line.classList.add('last');
    });

    rebuildBeatGuides(grid, measureCount);
    return system;
  };

  function rhythmPositionPercentForRow(position, rowIndex) {
    return ((position + 1) / rowPositionCount(rowIndex)) * 100;
  }

  renderRhythmNotation = function renderVariableRhythmNotation(rowIndex) {
    const layer = document.querySelector(`.rhythm-layer[data-row="${rowIndex}"]`);
    if (!layer) return;
    layer.innerHTML = '';
    const gridStyles = getComputedStyle(layer.closest('.tab-grid'));
    const rowHeight = parseFloat(gridStyles.getPropertyValue('--row-height')) || 32;
    const valueHeight = parseFloat(gridStyles.getPropertyValue('--value-height')) || 34;
    const stemEnd = parseFloat(gridStyles.getPropertyValue('--stem-end')) || 35;
    const staffHeight = rowHeight * STRINGS;
    const onsets = [];
    const positions = rowPositionCount(rowIndex);
    const measureSlots = slotsPerMeasure();
    const measureCount = rowMeasureCount(rowIndex);
    const explicitRhythm = currentSong()?.rhythmRows?.[rowIndex];

    if (explicitRhythm && Object.keys(explicitRhythm).length > 0) {
      for (const [rawPosition, rawDuration] of Object.entries(explicitRhythm)) {
        const position = Number(rawPosition);
        if (position < 0 || position >= positions) continue;
        const notes = getFilledInputsAt(rowIndex, position);
        const lowestString = notes.length > 0 ? Math.max(...notes.map(input => Number(input.dataset.string))) : STRINGS - 1;
        onsets.push({ position, duration: Number(rawDuration), lowestString });
      }
      onsets.sort((a, b) => a.position - b.position);
    } else {
      for (let position = 0; position < positions; position++) {
        const notes = getFilledInputsAt(rowIndex, position);
        if (notes.length > 0) onsets.push({ position, duration: 1, lowestString: Math.max(...notes.map(input => Number(input.dataset.string))) });
      }
      onsets.forEach((onset, index) => {
        const measureEnd = (Math.floor(onset.position / measureSlots) + 1) * measureSlots;
        const next = onsets[index + 1];
        onset.duration = Math.max(1, Math.min(next && next.position < measureEnd ? next.position - onset.position : measureEnd - onset.position, measureSlots));
      });
    }

    const appendMark = (className, leftPercent, widthPercent = null) => {
      const mark = makeDiv(className);
      mark.style.left = `${leftPercent}%`;
      if (widthPercent !== null) mark.style.width = `${Math.max(0.3, widthPercent)}%`;
      layer.appendChild(mark);
      return mark;
    };

    onsets.forEach(onset => {
      const left = rhythmPositionPercentForRow(onset.position, rowIndex);
      if (onset.duration < measureSlots || activeBeatsPerMeasure === 3) {
        const stem = appendMark('rhythm-stem', left);
        const stemTop = onset.lowestString * rowHeight + rowHeight / 2 + valueHeight / 2 + 2 - staffHeight;
        stem.style.top = `${stemTop}px`;
        stem.style.height = `${stemEnd - stemTop}px`;
      }
      if ([3, 6, 12].includes(onset.duration)) appendMark('rhythm-dot', left);
    });

    const groupSlots = rhythmGroupSlots();
    for (let measure = 0; measure < measureCount; measure++) {
      for (let groupStart = 0; groupStart < measureSlots; groupStart += groupSlots) {
        const beatStart = measure * measureSlots + groupStart;
        const beatEnd = beatStart + groupSlots;
        const beatOnsets = onsets.filter(onset => onset.position >= beatStart && onset.position < beatEnd);
        const primary = beatOnsets.filter(onset => onset.duration <= 3);
        if (primary.length >= 2) {
          const first = rhythmPositionPercentForRow(primary[0].position, rowIndex);
          const last = rhythmPositionPercentForRow(primary[primary.length - 1].position, rowIndex);
          appendMark('rhythm-beam primary', first, last - first);
        } else if (primary.length === 1) appendMark('rhythm-flag primary', rhythmPositionPercentForRow(primary[0].position, rowIndex));

        const sixteenths = primary.filter(onset => onset.duration === 1);
        let run = [];
        const flush = () => {
          if (run.length >= 2) {
            const first = rhythmPositionPercentForRow(run[0].position, rowIndex);
            const last = rhythmPositionPercentForRow(run[run.length - 1].position, rowIndex);
            appendMark('rhythm-beam secondary', first, last - first);
          } else if (run.length === 1) {
            const onset = run[0];
            const onsetIndex = primary.indexOf(onset);
            if (primary.length === 1) appendMark('rhythm-flag secondary', rhythmPositionPercentForRow(onset.position, rowIndex));
            else {
              const previous = primary[onsetIndex - 1];
              const next = primary[onsetIndex + 1];
              let direction = 'right';
              if (!next) direction = 'left';
              else if (previous) direction = onset.position - previous.position < next.position - onset.position ? 'left' : 'right';
              const partialWidth = (0.65 / positions) * 100;
              const onsetLeft = rhythmPositionPercentForRow(onset.position, rowIndex);
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
  };

  focusRelative = function focusRelativeVariable(current, stringDelta, positionDelta) {
    let row = Number(current.dataset.row);
    let string = Number(current.dataset.string) + stringDelta;
    let position = Number(current.dataset.position) + positionDelta;

    if (positionDelta !== 0) {
      const currentPositions = rowPositionCount(row);
      if (position >= currentPositions) {
        row += 1;
        position = 0;
      } else if (position < 0) {
        row -= 1;
        position = row >= 0 ? rowPositionCount(row) - 1 : 0;
      }
    }

    if (string >= STRINGS) {
      string = 0;
      row += 1;
    } else if (string < 0) {
      string = STRINGS - 1;
      row -= 1;
    }

    if (row < 0) return;
    const maxPosition = rowPositionCount(row) - 1;
    position = Math.max(0, Math.min(maxPosition, position));
    const next = getInput(row, string, position);
    if (next) {
      next.focus();
      next.select();
    }
  };
})();