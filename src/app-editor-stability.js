(() => {
  setScoreViewEnabled = function safeSetScoreViewEnabled(enabled) {
    scoreViewEnabled = Boolean(enabled);
    editorView.classList.toggle('edit-view', !scoreViewEnabled);
    editorView.classList.toggle('score-view', scoreViewEnabled);
    rhythmToggleButton.setAttribute('aria-pressed', String(scoreViewEnabled));
    const label = rhythmToggleButton.querySelector('.mode-toggle-label');
    if (label) label.textContent = '看譜模式';
    rhythmToggleButton.setAttribute('aria-label', scoreViewEnabled ? '看譜模式已開啟，關閉看譜模式' : '看譜模式已關閉，開啟看譜模式');
  };

  // Keep rhythm data synchronized with TAB input without rebuilding the rhythm
  // layer twice for every keystroke. The latest row snapshot is rendered once per
  // animation frame, which keeps fast typing responsive on larger scores.
  const baseReadTabRowFromDom = readTabRowFromDom;
  const baseRenderRhythmNotation = renderRhythmNotation;
  const rhythmSnapshots = new Map();
  const rhythmFrames = new Map();

  function readEditedRow(rowIndex) {
    const row = blankRow();
    const grid = document.querySelector(`.tab-grid[data-row="${rowIndex}"]`);
    grid?.querySelectorAll('.note-input').forEach(input => {
      const string = Number(input.dataset.string);
      const position = Number(input.dataset.position);
      if (!row[string] || position < 0 || position >= row[string].length) return;
      row[string][position] = normalizeTabValue(input.value);
    });
    return row;
  }

  readTabRowFromDom = function cachedReadTabRowFromDom(rowIndex) {
    return rhythmSnapshots.get(Number(rowIndex)) || baseReadTabRowFromDom(rowIndex);
  };

  function scheduleRhythmRender(rowIndex) {
    if (rhythmFrames.has(rowIndex)) return;
    const frame = requestAnimationFrame(() => {
      rhythmFrames.delete(rowIndex);
      baseRenderRhythmNotation(rowIndex);
      rhythmSnapshots.delete(rowIndex);
    });
    rhythmFrames.set(rowIndex, frame);
  }

  handleInput = function optimizedHandleInput(event) {
    const input = event.target;
    input.value = normalizeTabValue(input.value);
    input.classList.toggle('has-value', input.value.length > 0);

    const rowIndex = Number(input.dataset.row);
    const row = readEditedRow(rowIndex);
    rhythmSnapshots.set(rowIndex, row);

    const song = currentSong();
    if (song && !previewSong) {
      const rowCount = Math.max(song.rows?.length || 0, rowIndex + 1);
      if (!Array.isArray(song.rhythmRows)) song.rhythmRows = [];
      while (song.rhythmRows.length < rowCount) song.rhythmRows.push({});
      song.rhythmRows[rowIndex] = rhythmRowFromRow(row, song.beatsPerMeasure);
    }

    jumpToInput(input, false);
    scheduleRhythmRender(rowIndex);
    if (input.value.length === 2) focusRelative(input, 0, 1);
  };

  const playPanel = document.querySelector('.play-panel');
  if (playPanel) {
    const observer = new MutationObserver(() => {
      if (rhythmToggleButton.isConnected && rhythmToggleButton.parentElement !== playPanel) playPanel.prepend(rhythmToggleButton);
    });
    observer.observe(editorView, { childList: true, subtree: true });
  }
})();
