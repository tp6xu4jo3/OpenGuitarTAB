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

  reconcileCurrentSong() {
    const store = this.ensureStore();
    return store ? { document: store.getDocument(), changeSet: null } : null;
  }
}
