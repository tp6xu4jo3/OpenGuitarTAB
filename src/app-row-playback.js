(() => {
  const baseUpdateProgressRange = updateProgressRange;
  const rowInputCache = new Map();
  let playbackLayout = {
    song: null,
    rowCount: 0,
    beatsPerMeasure: 0,
    offsets: [0, 1],
    total: 1
  };

  function logicalRowCount(song = currentSong()) {
    return song?.rows?.length || document.querySelectorAll('.tab-grid[data-row]').length || 1;
  }

  function rebuildPlaybackLayout(song = currentSong()) {
    const rowCount = logicalRowCount(song);
    const offsets = new Array(rowCount + 1);
    offsets[0] = 0;
    for (let row = 0; row < rowCount; row++) {
      offsets[row + 1] = offsets[row] + rowPositionCount(row, song);
    }
    playbackLayout = {
      song,
      rowCount,
      beatsPerMeasure: Number(song?.beatsPerMeasure) || activeBeatsPerMeasure,
      offsets,
      total: Math.max(1, offsets[rowCount] || 0)
    };
    rowInputCache.clear();
    return playbackLayout;
  }

  function ensurePlaybackLayout() {
    const song = currentSong();
    const rowCount = logicalRowCount(song);
    const beatsPerMeasure = Number(song?.beatsPerMeasure) || activeBeatsPerMeasure;
    if (
      playbackLayout.song !== song ||
      playbackLayout.rowCount !== rowCount ||
      playbackLayout.beatsPerMeasure !== beatsPerMeasure
    ) {
      return rebuildPlaybackLayout(song);
    }
    return playbackLayout;
  }

  function inputIndexForRow(row) {
    const safeRow = Math.max(0, Number(row) || 0);
    let index = rowInputCache.get(safeRow);
    if (index) return index;

    index = new Map();
    tabArea.querySelectorAll(`.note-input[data-row="${safeRow}"]`).forEach(input => {
      const position = Number(input.dataset.position);
      if (!Number.isInteger(position)) return;
      let inputs = index.get(position);
      if (!inputs) {
        inputs = [];
        index.set(position, inputs);
      }
      inputs.push(input);
    });
    rowInputCache.set(safeRow, index);
    return index;
  }

  window.invalidateRowPlaybackLayout = function invalidateRowPlaybackLayout() {
    playbackLayout.song = null;
    rowInputCache.clear();
  };

  totalSlots = function cachedVariableTotalSlots() {
    return ensurePlaybackLayout().total;
  };

  slotToIndex = function cachedVariableSlotToIndex(row, position) {
    const layout = ensurePlaybackLayout();
    const safeRow = Math.max(0, Math.min(layout.rowCount - 1, Number(row) || 0));
    const rowStart = layout.offsets[safeRow];
    const rowEnd = layout.offsets[safeRow + 1];
    const rowPositions = Math.max(1, rowEnd - rowStart);
    const safePosition = Math.max(0, Math.min(rowPositions - 1, Number(position) || 0));
    return clamp(rowStart + safePosition, 0, layout.total - 1);
  };

  indexToSlot = function cachedVariableIndexToSlot(index) {
    const layout = ensurePlaybackLayout();
    const cleanIndex = clamp(Number(index) || 0, 0, layout.total - 1);
    let low = 0;
    let high = layout.rowCount - 1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const start = layout.offsets[mid];
      const end = layout.offsets[mid + 1];
      if (cleanIndex < start) {
        high = mid - 1;
      } else if (cleanIndex >= end) {
        low = mid + 1;
      } else {
        return { row: mid, position: cleanIndex - start };
      }
    }

    const lastRow = Math.max(0, layout.rowCount - 1);
    return {
      row: lastRow,
      position: Math.max(0, layout.offsets[lastRow + 1] - layout.offsets[lastRow] - 1)
    };
  };

  getInputsAt = function cachedInputsAt(row, position) {
    const inputs = inputIndexForRow(row).get(Number(position) || 0);
    return inputs ? inputs.slice() : [];
  };

  getFilledInputsAt = function cachedFilledInputsAt(row, position) {
    return getInputsAt(row, position).filter(input => input.value.trim() !== '');
  };

  updateProgressRange = function updateCachedProgressRange() {
    rebuildPlaybackLayout();
    return baseUpdateProgressRange();
  };

  highlightPlayhead = function variableHighlightPlayhead(row, position) {
    clearPlayhead();
    currentPlayhead = getInputsAt(row, position);
    currentPlayhead.forEach(input => input.classList.add('is-playing'));
    if (!scoreViewEnabled || !isPlaying) return;
    const grid = currentPlayhead[0]?.closest('.tab-grid') || document.querySelector(`.tab-grid[data-row="${row}"]`);
    if (!grid) return;
    const positions = Number(grid.dataset.positionCount) || rowPositionCount(row);
    const startPosition = Number(grid.dataset.positionStart) || 0;
    const localPosition = Math.max(0, position - startPosition);
    const playhead = makeDiv('playhead-column');
    playhead.style.left = `${((localPosition + 1) / positions) * 100}%`;
    playhead.style.width = `${Math.max(0.8, (100 / positions) * 1.35)}%`;
    playhead.setAttribute('aria-hidden', 'true');
    grid.appendChild(playhead);
  };
})();