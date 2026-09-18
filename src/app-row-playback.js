(() => {
  totalSlots = function variableTotalSlots() {
    const song = currentSong();
    const rowCount = song?.rows?.length || document.querySelectorAll('.tab-grid[data-row]').length || 1;
    let total = 0;
    for (let row = 0; row < rowCount; row++) total += rowPositionCount(row, song);
    return Math.max(1, total);
  };

  slotToIndex = function variableSlotToIndex(row, position) {
    const song = currentSong();
    let index = 0;
    for (let currentRow = 0; currentRow < row; currentRow++) index += rowPositionCount(currentRow, song);
    index += Math.max(0, Math.min(rowPositionCount(row, song) - 1, Number(position) || 0));
    return clamp(index, 0, totalSlots() - 1);
  };

  indexToSlot = function variableIndexToSlot(index) {
    const song = currentSong();
    let remaining = clamp(Number(index) || 0, 0, totalSlots() - 1);
    const rowCount = song?.rows?.length || 1;
    for (let row = 0; row < rowCount; row++) {
      const positions = rowPositionCount(row, song);
      if (remaining < positions) return { row, position: remaining };
      remaining -= positions;
    }
    const lastRow = Math.max(0, rowCount - 1);
    return { row: lastRow, position: Math.max(0, rowPositionCount(lastRow, song) - 1) };
  };

  highlightPlayhead = function variableHighlightPlayhead(row, position) {
    clearPlayhead();
    currentPlayhead = getInputsAt(row, position);
    currentPlayhead.forEach(input => input.classList.add('is-playing'));
    if (!scoreViewEnabled || !isPlaying) return;
    const grid = document.querySelector(`.tab-grid[data-row="${row}"]`);
    if (!grid) return;
    const positions = rowPositionCount(row);
    const playhead = makeDiv('playhead-column');
    playhead.style.left = `${((position + 1) / positions) * 100}%`;
    playhead.style.width = `${Math.max(0.8, (100 / positions) * 1.35)}%`;
    playhead.setAttribute('aria-hidden', 'true');
    grid.appendChild(playhead);
  };
})();