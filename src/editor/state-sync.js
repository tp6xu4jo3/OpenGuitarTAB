import { documentToLegacyProjection } from './migrate-v2.js';

function currentSongDefault() {
  return typeof window.currentSong === 'function' ? window.currentSong() : null;
}

export class EditorStateSync {
  constructor(registry, { currentSong = currentSongDefault } = {}) {
    this.registry = registry;
    this.currentSong = currentSong;
  }

  ensureStore() {
    const song = this.currentSong();
    return song ? this.registry.forSong(song) : null;
  }

  markCurrent(store) {
    return store || null;
  }

  prepareForPersistence(store = this.ensureStore()) {
    const song = store?.getSong();
    if (!store || !song) return null;
    store.prepareForPersistence({
      tempo: typeof window.getTempo === 'function' ? window.getTempo() : song.tempo,
      capo: typeof window.getCapo === 'function' ? window.getCapo() : song.capo
    });
    return song;
  }

  hydrateProjectedRow(rowIndex, { measureIndex = null } = {}) {
    const song = this.currentSong();
    const row = song?.rows?.[rowIndex];
    if (!row) return;

    const width = (Number(song.beatsPerMeasure) === 3 ? 3 : 4) * 4;
    const start = measureIndex == null ? 0 : measureIndex * width;
    const end = measureIndex == null ? row[0]?.length || 0 : start + width;

    document.querySelectorAll(`.note-input[data-row="${rowIndex}"]`).forEach(input => {
      const position = Number(input.dataset.position);
      if (position < start || position >= end) return;
      const string = Number(input.dataset.string);
      const value = String(row?.[string]?.[position] ?? '');
      input.value = value;
      input.classList.toggle('has-value', value.length > 0);
      window.syncNoteInputBackground?.(input);
    });

    window.renderRhythmNotation?.(rowIndex);
    const grid = document.querySelector(`.tab-grid[data-row="${rowIndex}"]`);
    if (grid) window.scheduleDensityFitGrid?.(grid, true);
    window.editorPlayback?.invalidate?.();
    window.updateProgressRange?.();
  }

  projectStoreToView(store, target = null, previousCounts = null) {
    const song = store?.getSong();
    if (!song) return false;
    const projection = documentToLegacyProjection(store.getDocument());
    if (projection.lossy) return false;

    song.rows = projection.rows;
    song.rhythmRows = projection.rhythmRows;
    song.rowMeasureCounts = projection.rowMeasureCounts;
    song.beatsPerMeasure = projection.beatsPerMeasure;
    song.meter = projection.meter;
    song.updatedAt = Date.now();

    const sameShape = Array.isArray(previousCounts)
      && previousCounts.length === projection.rowMeasureCounts.length
      && previousCounts.every((count, index) => Number(count) === Number(projection.rowMeasureCounts[index]));

    if (target?.type === 'measure' && sameShape) {
      this.hydrateProjectedRow(target.rowIndex, { measureIndex: target.measureIndex });
      return true;
    }
    if (target?.type === 'row' && sameShape) {
      this.hydrateProjectedRow(target.rowIndex);
      return true;
    }

    window.renderRows?.(song.rows);
    return true;
  }

  reconcileCurrentSong() {
    const store = this.ensureStore();
    if (!store) return null;
    return store.reconcileLegacySong(store.getSong(), { silent: true });
  }
}
