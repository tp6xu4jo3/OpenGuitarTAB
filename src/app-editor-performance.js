(() => {
  const dirtyRows = new Set();
  const dirtyInputs = new Set();
  const dirtyGrids = new Set();
  let editorFrame = 0;

  function flushEditorDirtyState() {
    editorFrame = 0;
    const song = currentSong();
    if (!song || previewSong) {
      dirtyRows.clear();
      dirtyInputs.clear();
      dirtyGrids.clear();
      return;
    }

    const inputs = Array.from(dirtyInputs);
    const rows = Array.from(dirtyRows);
    const grids = Array.from(dirtyGrids);
    dirtyInputs.clear();
    dirtyRows.clear();
    dirtyGrids.clear();

    inputs.forEach(input => window.syncNoteInputBackground?.(input));

    if (!Array.isArray(song.rhythmRows)) song.rhythmRows = [];
    rows.forEach(rowIndex => {
      while (song.rhythmRows.length <= rowIndex) song.rhythmRows.push({});
      song.rhythmRows[rowIndex] = rhythmRowFromRow(song.rows[rowIndex], song.beatsPerMeasure);
      renderRhythmNotation(rowIndex);
    });

    grids.forEach(grid => window.fitDensityGrid?.(grid, false));
  }

  function scheduleEditorFlush() {
    if (editorFrame) return;
    editorFrame = requestAnimationFrame(flushEditorDirtyState);
  }

  function markInputDirty(input, rowIndex) {
    dirtyInputs.add(input);
    dirtyRows.add(rowIndex);
    const grid = input.closest('.tab-grid');
    if (grid) dirtyGrids.add(grid);
    scheduleEditorFlush();
  }

  // Editing stays in memory. Google Drive is touched only by explicit Save / Publish.
  saveRowsToCurrentSong = function saveRowsLocally(rows) {
    const song = currentSong();
    if (!song) return;
    song.rows = normalizeRows(rows, song.beatsPerMeasure);
    song.rhythmRows = song.rows.map(row => rhythmRowFromRow(row, song.beatsPerMeasure));
    song.tempo = getTempo();
    song.capo = getCapo();
    song.updatedAt = Date.now();
  };

  tabArea.addEventListener('input', event => {
    const input = event.target.closest?.('.note-input');
    if (!input || previewSong || scoreViewEnabled) return;

    input.value = normalizeTabValue(input.value);
    input.classList.toggle('has-value', input.value.length > 0);

    const song = currentSong();
    if (!song) return;

    const rowIndex = Number(input.dataset.row);
    const stringIndex = Number(input.dataset.string);
    const position = Number(input.dataset.position);
    if (!Number.isInteger(rowIndex) || !Number.isInteger(stringIndex) || !Number.isInteger(position)) return;

    if (!Array.isArray(song.rows)) song.rows = [];
    while (song.rows.length <= rowIndex) song.rows.push(blankRow(song.beatsPerMeasure));
    if (!Array.isArray(song.rows[rowIndex]) || song.rows[rowIndex].length !== STRINGS) song.rows[rowIndex] = blankRow(song.beatsPerMeasure);
    if (!Array.isArray(song.rows[rowIndex][stringIndex])) song.rows[rowIndex][stringIndex] = Array(positionsPerRow(song.beatsPerMeasure)).fill('');

    song.rows[rowIndex][stringIndex][position] = input.value;
    song.updatedAt = Date.now();

    jumpToInput(input, false);
    markInputDirty(input, rowIndex);
    if (input.value.length === 2) focusRelative(input, 0, 1);
  });

  tabArea.addEventListener('keydown', event => {
    const input = event.target.closest?.('.note-input');
    if (!input || previewSong || scoreViewEnabled) return;
    handleKeydown(event);
  });

  tabArea.addEventListener('focusin', event => {
    const input = event.target.closest?.('.note-input');
    if (!input || previewSong || scoreViewEnabled) return;
    input.select();
    jumpToInput(input, false);
  });

  tabArea.addEventListener('click', event => {
    const input = event.target.closest?.('.note-input');
    if (!input || previewSong || scoreViewEnabled) return;
    jumpToInput(input, true);
  });
})();