(() => {
  const originalNormalizeSongRecord = normalizeSongRecord;

  function normalizeCount(value) {
    const count = Number(value);
    return Number.isInteger(count) ? Math.max(1, Math.min(MEASURES, count)) : MEASURES;
  }

  function normalizeCounts(rawCounts, rowCount) {
    return Array.from({ length: rowCount }, (_, index) => normalizeCount(rawCounts?.[index]));
  }

  window.ensureRowMeasureCounts = function ensureRowMeasureCounts(song = currentSong()) {
    if (!song) return [];
    const rowCount = song.rows?.length || 1;
    if (!Array.isArray(song.rowMeasureCounts) || song.rowMeasureCounts.length !== rowCount) {
      song.rowMeasureCounts = normalizeCounts(song.rowMeasureCounts, rowCount);
      return song.rowMeasureCounts;
    }
    for (let index = 0; index < rowCount; index++) song.rowMeasureCounts[index] = normalizeCount(song.rowMeasureCounts[index]);
    return song.rowMeasureCounts;
  };

  window.rowMeasureCount = function rowMeasureCount(rowIndex, song = currentSong()) {
    if (!song) return MEASURES;
    return normalizeCount(song.rowMeasureCounts?.[rowIndex]);
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

  function createLeanInput({ rowIndex, string, position, originalStep = null, isSmall = false }) {
    const input = document.createElement('input');
    input.className = 'note-input';
    if (!isSmall) {
      const localStep = originalStep % stepsPerMeasure();
      const shadeInterval = activeBeatsPerMeasure === 3 ? 3 : 2;
      if (localStep % shadeInterval === 0) input.classList.add('odd-step');
    }
    if (isSmall) input.classList.add('small-step');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.pattern = '[0-9xX]*';
    input.maxLength = 2;
    input.autocomplete = 'off';
    input.ariaLabel = isSmall
      ? `第 ${rowIndex + 1} 列，第 ${string + 1} 弦，中間小輸入點 ${position + 1}`
      : `第 ${rowIndex + 1} 列，第 ${string + 1} 弦，第 ${originalStep + 1} 個原本輸入點`;
    input.dataset.row = rowIndex;
    input.dataset.string = string;
    input.dataset.position = position;
    if (originalStep !== null) input.dataset.step = originalStep;
    input.dataset.size = isSmall ? 'small' : 'normal';
    input.readOnly = scoreViewEnabled;
    if (scoreViewEnabled) {
      input.tabIndex = -1;
      input.setAttribute('aria-readonly', 'true');
    }
    return input;
  }

  function appendEditorRowTools(system, rowIndex, rowCount) {
    if (scoreViewEnabled) return;
    const label = makeDiv('system-label');
    const labelText = document.createElement('div');
    labelText.textContent = `第 ${rowIndex + 1} 列`;
    label.appendChild(labelText);

    const tools = makeDiv('row-tool-group');
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'row-tool';
    copyButton.textContent = '複製';
    copyButton.addEventListener('click', () => copyRow(rowIndex));

    const pasteButton = document.createElement('button');
    pasteButton.type = 'button';
    pasteButton.className = 'row-tool';
    pasteButton.textContent = '貼上';
    pasteButton.addEventListener('click', () => pasteRow(rowIndex));

    const moveUpButton = document.createElement('button');
    moveUpButton.type = 'button';
    moveUpButton.className = 'row-tool';
    moveUpButton.textContent = '↑';
    moveUpButton.title = '與上一列交換';
    moveUpButton.setAttribute('aria-label', `第 ${rowIndex + 1} 列與上一列交換`);
    moveUpButton.disabled = rowIndex === 0;
    moveUpButton.addEventListener('click', () => swapRow(rowIndex, rowIndex - 1));

    const moveDownButton = document.createElement('button');
    moveDownButton.type = 'button';
    moveDownButton.className = 'row-tool';
    moveDownButton.textContent = '↓';
    moveDownButton.title = '與下一列交換';
    moveDownButton.setAttribute('aria-label', `第 ${rowIndex + 1} 列與下一列交換`);
    moveDownButton.disabled = rowIndex === rowCount - 1;
    moveDownButton.addEventListener('click', () => swapRow(rowIndex, rowIndex + 1));

    tools.append(copyButton, pasteButton, moveUpButton, moveDownButton);
    label.appendChild(tools);
    system.appendChild(label);
  }

  createTabSystem = function createVariableMeasureTabSystem(rowIndex, rowCount) {
    const measureCount = rowMeasureCount(rowIndex);
    const visibleSteps = measureCount * stepsPerMeasure();
    const visiblePositions = measureCount * slotsPerMeasure();
    const measureSteps = stepsPerMeasure();
    const measureSlots = slotsPerMeasure();

    const system = makeDiv('tab-system');
    system.dataset.row = rowIndex;
    appendEditorRowTools(system, rowIndex, rowCount);

    const grid = makeDiv('tab-grid');
    grid.dataset.row = rowIndex;
    grid.dataset.measureCount = String(measureCount);
    grid.dataset.positionStart = '0';
    grid.dataset.positionCount = String(visiblePositions);
    grid.style.setProperty('--steps', visibleSteps);
    grid.style.width = `${measureCount * 25}%`;

    for (let string = 0; string < STRINGS; string++) {
      const line = makeDiv('string-line');
      line.style.setProperty('--string-index', string);
      grid.appendChild(line);
    }

    for (let measure = 0; measure <= measureCount; measure++) {
      const line = makeDiv('measure-line');
      line.style.setProperty('--measure-index', measure);
      line.style.left = `${(measure / measureCount) * 100}%`;
      if (measure === 0) line.classList.add('first');
      if (measure === measureCount) line.classList.add('last');
      grid.appendChild(line);
    }

    const totalBeats = measureCount * activeBeatsPerMeasure;
    for (let guide = 1; guide < totalBeats; guide++) {
      if (guide % activeBeatsPerMeasure === 0) continue;
      const line = makeDiv('beat-guide');
      line.style.setProperty('--guide-percent', `${(guide / totalBeats) * 100}%`);
      grid.appendChild(line);
    }

    for (let string = 0; string < STRINGS; string++) {
      for (let step = 0; step < visibleSteps; step++) {
        const measure = Math.floor(step / measureSteps);
        const localStep = step % measureSteps;
        const position = measure * measureSlots + localStep * 2;
        const cell = makeDiv('cell');
        cell.style.gridColumn = step + 1;
        cell.style.gridRow = string + 1;
        cell.appendChild(createLeanInput({ rowIndex, string, position, originalStep: step, isSmall: false }));
        grid.appendChild(cell);
      }
    }

    for (let string = 0; string < STRINGS; string++) {
      for (let measure = 0; measure < measureCount; measure++) {
        for (let localStep = 0; localStep < measureSteps; localStep++) {
          const absoluteOriginalStep = measure * measureSteps + localStep;
          const cell = makeDiv('small-cell');
          cell.style.left = `${((absoluteOriginalStep + 1) / visibleSteps) * 100}%`;
          cell.style.top = `calc(${string} * var(--row-height) + (var(--row-height) / 2))`;
          cell.appendChild(createLeanInput({
            rowIndex,
            string,
            position: measure * measureSlots + localStep * 2 + 1,
            isSmall: true
          }));
          grid.appendChild(cell);
        }
      }
    }

    const rhythmLayer = makeDiv('rhythm-layer');
    rhythmLayer.dataset.row = rowIndex;
    rhythmLayer.setAttribute('aria-hidden', 'true');
    grid.appendChild(rhythmLayer);
    system.appendChild(grid);
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