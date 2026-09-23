import { documentToLegacyProjection } from './migrate-v2.js';

function currentSongDefault() {
  return typeof window.currentSong === 'function' ? window.currentSong() : null;
}

export class EditorStateSync {
  constructor(registry, { currentSong = currentSongDefault } = {}) {
    this.registry = registry;
    this.currentSong = currentSong;
    this.syncState = new WeakMap();
    this.adaptersInstalled = false;
  }

  ensureStore({ reconcile = true } = {}) {
    const song = this.currentSong();
    if (!song) return null;
    const store = this.registry.forSong(song);
    let state = this.syncState.get(store);
    if (!state) {
      state = { sourceUpdatedAt: Number(song.updatedAt) || 0 };
      this.syncState.set(store, state);
    }
    if (reconcile && state.sourceUpdatedAt !== (Number(song.updatedAt) || 0)) {
      store.reconcileLegacySong(song, { silent: true });
      this.markCurrent(store);
    }
    return store;
  }

  markCurrent(store) {
    const song = store?.getSong();
    if (!store || !song) return;
    this.syncState.set(store, { sourceUpdatedAt: Number(song.updatedAt) || 0 });
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
    this.markCurrent(store);

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
    const store = this.ensureStore({ reconcile: false });
    if (!store) return null;
    const result = store.reconcileLegacySong(store.getSong(), { silent: true });
    this.markCurrent(store);
    return result;
  }

  installPersistenceAdapters() {
    if (this.adaptersInstalled || typeof window === 'undefined') return;
    this.adaptersInstalled = true;

    const baseReadRows = window.readRowsFromDom;
    const baseSaveRows = window.saveRowsToCurrentSong;
    const basePersistSong = window.persistSongToCloud;

    window.readRowsFromDom = () => {
      const song = this.currentSong();
      if (song && Array.isArray(song.rows)) return song.rows;
      return typeof baseReadRows === 'function' ? baseReadRows() : [];
    };

    window.saveRowsToCurrentSong = rows => {
      const song = this.currentSong();
      if (!song) return;
      const store = this.ensureStore({ reconcile: false });
      if (!store) {
        baseSaveRows?.(rows);
        return;
      }

      if (Array.isArray(rows) && rows !== song.rows) {
        song.rows = typeof window.normalizeRows === 'function'
          ? window.normalizeRows(rows, song.beatsPerMeasure)
          : rows;
        if (typeof window.rhythmRowFromRow === 'function') {
          song.rhythmRows = song.rows.map(row => window.rhythmRowFromRow(row, song.beatsPerMeasure));
        }
        song.updatedAt = Date.now();
        store.reconcileLegacySong(song, { silent: true });
      }

      store.prepareForPersistence({
        tempo: typeof window.getTempo === 'function' ? window.getTempo() : song.tempo,
        capo: typeof window.getCapo === 'function' ? window.getCapo() : song.capo
      });
      this.markCurrent(store);
    };

    if (typeof basePersistSong === 'function') {
      window.persistSongToCloud = async song => {
        const current = this.currentSong();
        const store = song === current ? this.ensureStore() : this.registry.forSong(song);
        store?.prepareForPersistence({
          tempo: song === current && typeof window.getTempo === 'function' ? window.getTempo() : song?.tempo,
          capo: song === current && typeof window.getCapo === 'function' ? window.getCapo() : song?.capo
        });
        if (store) this.markCurrent(store);
        return basePersistSong(song);
      };
    }
  }
}
