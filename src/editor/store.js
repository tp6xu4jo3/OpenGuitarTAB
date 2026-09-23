import { applyCommand, createChangeSet } from './commands.js';
import { cloneValue, isDocumentV3, normalizeDocumentV3 } from './model.js';
import {
  ensureSongDocumentV3,
  reconcileLegacyMeasure,
  reconcileLegacySongToDocument
} from './migrate-v2.js';

export class ScoreStore {
  constructor(song = null) {
    this.song = null;
    this.document = null;
    this.listeners = new Set();
    if (song) this.setSong(song, { silent: true });
  }

  setSong(song, { silent = false } = {}) {
    this.song = song || null;
    this.document = song ? ensureSongDocumentV3(song) : null;
    if (!silent) this.emit(createChangeSet({ document: true }));
    return this.document;
  }

  getSong() {
    return this.song;
  }

  getDocument() {
    return this.document;
  }

  snapshot() {
    return this.document ? cloneValue(this.document) : null;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(changeSet) {
    for (const listener of this.listeners) listener(this.document, changeSet, this.song);
  }

  commit(nextDocument, changeSet = createChangeSet(), { touch = true, silent = false } = {}) {
    if (!nextDocument) return { document: this.document, changeSet };
    this.document = isDocumentV3(nextDocument) ? nextDocument : normalizeDocumentV3(nextDocument);
    if (this.song) {
      this.song.document = this.document;
      if (touch) this.song.updatedAt = Date.now();
    }
    if (!silent) this.emit(changeSet);
    return { document: this.document, changeSet };
  }

  dispatch(command, options = {}) {
    if (!this.document) return { document: null, changeSet: createChangeSet() };
    const result = applyCommand(this.document, command, options);
    return this.commit(result.document, result.changeSet, { touch: options.touch !== false });
  }

  reconcileLegacySong(song = this.song, { silent = false } = {}) {
    if (!song) return { document: this.document, changeSet: createChangeSet() };
    if (song !== this.song) this.song = song;
    const next = reconcileLegacySongToDocument(song, this.document || song.document);
    const changeSet = createChangeSet({
      document: true,
      measures: next.measures.map(measure => measure.id),
      playback: next.measures.map(measure => measure.id)
    });
    return this.commit(next, changeSet, { touch: false, silent });
  }

  reconcileLegacyMeasure(rowIndex, measureIndex, { silent = false } = {}) {
    if (!this.song || !this.document) return { document: this.document, changeSet: createChangeSet() };
    const before = this.document;
    const next = reconcileLegacyMeasure(this.song, before, rowIndex, measureIndex);
    const changed = next.measures.find((measure, index) => measure !== before.measures[index]) || null;
    const changeSet = createChangeSet({
      measures: changed ? [changed.id] : [],
      playback: changed ? [changed.id] : []
    });
    return this.commit(next, changeSet, { touch: false, silent });
  }

  prepareForPersistence({ tempo, capo } = {}) {
    if (!this.song) return null;
    this.song.document = this.document || ensureSongDocumentV3(this.song);
    if (tempo != null && Number.isFinite(Number(tempo))) this.song.tempo = Number(tempo);
    if (capo != null && Number.isFinite(Number(capo))) this.song.capo = Number(capo);
    this.song.updatedAt = Date.now();
    return this.song;
  }
}

export class StoreRegistry {
  constructor() {
    this.bySongId = new Map();
    this.weak = new WeakMap();
  }

  forSong(song) {
    if (!song || typeof song !== 'object') return null;
    const id = String(song.id || '');
    let store = this.weak.get(song);
    if (store) return store;
    if (id) {
      const existing = this.bySongId.get(id);
      if (existing && existing.getSong() === song) return existing;
    }
    store = new ScoreStore(song);
    this.weak.set(song, store);
    if (id) this.bySongId.set(id, store);
    return store;
  }

  replaceSong(song) {
    if (!song || typeof song !== 'object') return null;
    const id = String(song.id || '');
    const existing = id ? this.bySongId.get(id) : null;
    if (existing) existing.setSong(song, { silent: true });
    const store = existing || new ScoreStore(song);
    this.weak.set(song, store);
    if (id) this.bySongId.set(id, store);
    return store;
  }
}
