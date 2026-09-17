const STRINGS = 6;
const MEASURES_PER_ROW = 4;
const SLOTS_PER_BEAT = 4;

export function normalizeBeatsPerMeasure(value) {
  return Number(value) === 3 ? 3 : 4;
}

export function positionsPerRow(songOrBeats) {
  const beats = typeof songOrBeats === 'object'
    ? normalizeBeatsPerMeasure(songOrBeats?.beatsPerMeasure)
    : normalizeBeatsPerMeasure(songOrBeats);
  return MEASURES_PER_ROW * beats * SLOTS_PER_BEAT;
}

export function isSparseSong(song) {
  return Array.isArray(song?.rows) && song.rows.some(row => row && !Array.isArray(row));
}

export function expandSong(song) {
  if (!song || typeof song !== 'object' || Array.isArray(song)) {
    throw new Error('曲譜 JSON 必須是物件');
  }

  const hasLegacyNotes = Array.isArray(song.notes);
  const hasSparseRows = isSparseSong(song);
  if (!hasLegacyNotes && !hasSparseRows) return structuredCloneSafe(song);

  const rowCount = hasLegacyNotes
    ? Math.max(1, Number(song.rowCount) || 1)
    : Math.max(1, song.rows.length);
  const positions = positionsPerRow(song);
  const rows = Array.from({ length: rowCount }, () =>
    Array.from({ length: STRINGS }, () => Array(positions).fill(''))
  );

  if (hasLegacyNotes) {
    for (const note of song.notes) {
      if (!Array.isArray(note) || note.length < 4) continue;
      const [row, string, position, fret] = note;
      if (rows[row]?.[string] && position >= 0 && position < positions) {
        rows[row][string][position] = String(fret);
      }
    }
  } else {
    song.rows.forEach((sparseRow, rowIndex) => {
      for (const [location, fret] of Object.entries(sparseRow || {})) {
        const [string, position] = location.split(',').map(Number);
        if (rows[rowIndex]?.[string] && position >= 0 && position < positions) {
          rows[rowIndex][string][position] = String(fret);
        }
      }
    });
  }

  const { notes, rowCount: ignoredRowCount, rows: ignoredRows, ...metadata } = song;
  return { ...structuredCloneSafe(metadata), rows };
}

export function compactSong(song) {
  if (!song || typeof song !== 'object' || Array.isArray(song)) {
    throw new Error('曲譜資料必須是物件');
  }
  if (!Array.isArray(song.rows)) return structuredCloneSafe(song);
  if (isSparseSong(song)) return structuredCloneSafe(song);

  const positions = positionsPerRow(song);
  const sparseRows = song.rows.map(row => {
    const sparseRow = {};
    for (let string = 0; string < STRINGS; string++) {
      const values = Array.isArray(row?.[string]) ? row[string] : [];
      for (let position = 0; position < Math.min(positions, values.length); position++) {
        const fret = String(values[position] ?? '');
        if (fret !== '') sparseRow[`${string},${position}`] = fret;
      }
    }
    return sparseRow;
  });

  const { rows, oceanEyesContinuationVersion: obsoleteMigrationMarker, ...metadata } = song;
  return { ...structuredCloneSafe(metadata), rows: sparseRows };
}

export function validateSongObject(song) {
  if (!song || typeof song !== 'object' || Array.isArray(song)) {
    throw new Error('JSON 內容不是有效的單曲物件');
  }
  if (!Array.isArray(song.rows) && !Array.isArray(song.notes)) {
    throw new Error('找不到曲譜 rows/notes 資料');
  }
  if (song.name != null && typeof song.name !== 'string') {
    throw new Error('name 欄位必須是文字');
  }
  return true;
}

export function serializeSong(song, spacing = 2) {
  validateSongObject(song);
  return JSON.stringify(compactSong(song), null, spacing);
}

export function deserializeSong(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON 格式錯誤');
  }
  validateSongObject(parsed);
  return expandSong(parsed);
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
