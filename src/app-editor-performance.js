(() => {
  const rhythmFrames = new Map();

  function scheduleRhythmRender(rowIndex) {
    if (rhythmFrames.has(rowIndex)) return;
    const frame = requestAnimationFrame(() => {
      rhythmFrames.delete(rowIndex);
      renderRhythmNotation(rowIndex);
    });
    rhythmFrames.set(rowIndex, frame);
  }

  // Editor state stays in memory while editing. Google Drive is only touched by
  // explicit cloud actions such as Save / Publish / rename / visibility / delete.
  saveRowsToCurrentSong = function saveRowsLocally(rows) {
    const song = currentSong();
    if (!song) return;
    song.rows = normalizeRows(rows, song.beatsPerMeasure);
    song.rhythmRows = song.rows.map(row => rhythmRowFromRow(row, song.beatsPerMeasure));
    song.tempo = getTempo();
    song.capo = getCapo();
    song.updatedAt = Date.now();
  };

  // The original input handler re-scans the row and redraws rhythm notation for
  // every key event. Handle note input once in capture phase, update only the
  // touched cell, then redraw rhythm notation at most once per animation frame.
  tabArea.addEventListener('input', event => {
    const input = event.target.closest?.('.note-input');
    if (!input || previewSong) return;

    event.stopImmediatePropagation();

    input.value = normalizeTabValue(input.value);
    input.classList.toggle('has-value', input.value.length > 0);

    const song = currentSong();
    if (!song) return;

    const rowIndex = Number(input.dataset.row);
    const stringIndex = Number(input.dataset.string);
    const position = Number(input.dataset.position);

    if (!Array.isArray(song.rows)) song.rows = [];
    while (song.rows.length <= rowIndex) song.rows.push(blankRow());
    if (!Array.isArray(song.rows[rowIndex]) || song.rows[rowIndex].length !== STRINGS) song.rows[rowIndex] = blankRow();
    if (!Array.isArray(song.rows[rowIndex][stringIndex])) song.rows[rowIndex][stringIndex] = Array(positionsPerRow(song.beatsPerMeasure)).fill('');

    song.rows[rowIndex][stringIndex][position] = input.value;

    if (!Array.isArray(song.rhythmRows)) song.rhythmRows = [];
    while (song.rhythmRows.length <= rowIndex) song.rhythmRows.push({});
    song.rhythmRows[rowIndex] = rhythmRowFromRow(song.rows[rowIndex], song.beatsPerMeasure);

    jumpToInput(input, false);
    scheduleRhythmRender(rowIndex);
    if (input.value.length === 2) focusRelative(input, 0, 1);
  }, true);
})();