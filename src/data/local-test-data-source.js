import { aggregateCatalogWorks, createCatalogId, ensureArrangementIdentity } from '../catalog/work-model.js';

export const LOCAL_TEST_STORAGE_KEY = 'openguitartab:github-test:v1';
const TEST_USER = Object.freeze({ username: 'admin', role: 'admin', localTest: true });

function cloneValue(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function emptyState() {
  return { version: 1, records: {}, deleted: [] };
}

function safeFileId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9_-]+$/.test(id) ? id : '';
}

function catalogMetaFromSong(song) {
  return {
    ...song,
    owner: String(song?._opentab?.owner || song?.owner || TEST_USER.username),
    uploadedBy: String(song?._opentab?.uploadedBy || song?.uploadedBy || TEST_USER.username),
    public: song?._opentab?.public === true,
    _driveFileId: String(song?._driveFileId || ''),
    _driveFileName: String(song?._driveFileName || ''),
    _driveModifiedTime: String(song?._driveModifiedTime || '')
  };
}

export class LocalTestDataSource {
  constructor({
    fetchImpl = globalThis.fetch,
    storage = globalThis.localStorage,
    baseHref = globalThis.document?.baseURI || 'http://localhost/',
    now = () => new Date()
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.storage = storage;
    this.baseHref = baseHref;
    this.now = now;
    this.kind = 'local-test';
    this.isLocalTest = true;
    this.capabilities = Object.freeze({ publish: false, visibility: false, reset: true });
    this.fixtureCatalogPromise = null;
    this.fixtureSongPromises = new Map();
  }

  assetUrl(path) { return new URL(path, this.baseHref).toString(); }

  async readJson(path) {
    const response = await this.fetchImpl(this.assetUrl(path), { cache: 'no-store' });
    if (!response.ok) throw new Error(`TEST_FIXTURE_${response.status}`);
    return response.json();
  }

  fixtureCatalog() {
    if (!this.fixtureCatalogPromise) {
      this.fixtureCatalogPromise = this.readJson('./test-data/pages/catalog.json');
    }
    return this.fixtureCatalogPromise;
  }

  async fixtureMetadata() {
    const catalog = await this.fixtureCatalog();
    const metadata = [];
    for (const work of Array.isArray(catalog?.works) ? catalog.works : []) {
      for (const arrangement of Array.isArray(work?.arrangements) ? work.arrangements : []) {
        metadata.push({ ...arrangement, name: work.name, artist: work.artist, album: work.album, cover: work.cover });
      }
    }
    if (metadata.length) return metadata;
    return Array.isArray(catalog?.songs) ? catalog.songs : [];
  }

  readState() {
    if (!this.storage) return emptyState();
    try {
      const parsed = JSON.parse(this.storage.getItem(LOCAL_TEST_STORAGE_KEY) || 'null');
      if (!parsed || parsed.version !== 1 || typeof parsed.records !== 'object') return emptyState();
      return { version: 1, records: parsed.records || {}, deleted: Array.isArray(parsed.deleted) ? parsed.deleted : [] };
    } catch {
      return emptyState();
    }
  }

  writeState(state) {
    this.storage?.setItem(LOCAL_TEST_STORAGE_KEY, JSON.stringify(state));
  }

  async fixtureSong(meta) {
    const fileId = safeFileId(meta?._driveFileId);
    if (!fileId) throw new Error('TEST_FIXTURE_INVALID_ID');
    if (!this.fixtureSongPromises.has(fileId)) {
      const pending = this.readJson(`./test-data/pages/songs/${fileId}.json`).then(raw => ensureArrangementIdentity({
        ...raw,
        workId: meta.workId || raw.workId,
        arrangementId: meta.arrangementId || raw.arrangementId,
        name: raw.name || meta.name,
        artist: raw.artist || meta.artist,
        album: raw.album || meta.album,
        cover: raw.cover || meta.cover,
        playStyle: raw.playStyle || meta.playStyle,
        difficulty: raw.difficulty ?? meta.difficulty,
        source: raw.source || meta.source,
        _driveFileId: fileId,
        _driveFileName: meta._driveFileName || `${fileId}.json`,
        _driveModifiedTime: meta._driveModifiedTime || 'fixture',
        _opentab: {
          ...(raw._opentab || {}),
          owner: meta.owner || raw?._opentab?.owner || TEST_USER.username,
          uploadedBy: meta.uploadedBy || raw?._opentab?.uploadedBy || TEST_USER.username,
          updatedBy: raw?._opentab?.updatedBy || TEST_USER.username,
          public: meta.public !== false,
          publishedAt: raw?._opentab?.publishedAt || 'test-fixture'
        }
      }, { fileId }));
      this.fixtureSongPromises.set(fileId, pending);
    }
    return cloneValue(await this.fixtureSongPromises.get(fileId));
  }

  async allSongs() {
    const metadata = await this.fixtureMetadata();
    const fixtures = await Promise.all(metadata.map(meta => this.fixtureSong(meta)));
    const state = this.readState();
    const deleted = new Set(state.deleted.map(String));
    const records = new Map();
    for (const song of fixtures) {
      const fileId = String(song._driveFileId || '');
      if (!deleted.has(fileId)) records.set(fileId, song);
    }
    for (const [fileId, song] of Object.entries(state.records)) {
      if (!deleted.has(fileId)) records.set(fileId, cloneValue(song));
    }
    return [...records.values()].sort((a, b) =>
      String(b._driveModifiedTime || b.updatedAt || '').localeCompare(String(a._driveModifiedTime || a.updatedAt || ''))
      || String(a.id || '').localeCompare(String(b.id || ''))
    );
  }

  session() { return Promise.resolve({ user: cloneValue(TEST_USER), preview: true, localTest: true }); }
  login() { return this.session(); }
  logout() { return this.session(); }
  async library() { return { songs: await this.allSongs(), localTest: true }; }

  async loadSong(identifier) {
    const id = String(identifier || '');
    const songs = await this.allSongs();
    const song = songs.find(item =>
      String(item._driveFileId || '') === id
      || String(item.arrangementId || '') === id
      || String(item.id || '') === id
    );
    if (!song) throw new Error('TEST_SONG_NOT_FOUND');
    return { song: cloneValue(song), localTest: true };
  }

  async saveSong(rawSong) {
    const state = this.readState();
    const incoming = cloneValue(rawSong || {});
    const existing = (await this.allSongs()).find(item =>
      (incoming._driveFileId && String(item._driveFileId || '') === String(incoming._driveFileId))
      || (incoming.arrangementId && String(item.arrangementId || '') === String(incoming.arrangementId))
      || (incoming.id && String(item.id || '') === String(incoming.id))
    );
    const fileId = safeFileId(incoming._driveFileId)
      || safeFileId(existing?._driveFileId)
      || `local-${safeFileId(incoming.id) || createCatalogId('song')}`;
    const timestamp = this.now().toISOString();
    const song = ensureArrangementIdentity({
      ...(existing || {}),
      ...incoming,
      _driveFileId: fileId,
      _driveFileName: incoming._driveFileName || `${fileId}.json`,
      _driveModifiedTime: timestamp,
      updatedAt: Date.now(),
      _opentab: {
        ...(incoming._opentab || existing?._opentab || {}),
        owner: incoming?._opentab?.owner || existing?._opentab?.owner || TEST_USER.username,
        updatedBy: TEST_USER.username,
        uploadedBy: incoming?._opentab?.uploadedBy || existing?._opentab?.uploadedBy || TEST_USER.username,
        public: incoming?._opentab?.public === true || existing?._opentab?.public === true
      }
    }, { fileId });
    state.records[fileId] = cloneValue(song);
    state.deleted = state.deleted.filter(value => String(value) !== fileId);
    this.writeState(state);
    return { song: cloneValue(song), localTest: true };
  }

  async deleteSong(fileId) {
    const id = safeFileId(fileId);
    if (!id) throw new Error('TEST_SONG_NOT_FOUND');
    const state = this.readState();
    delete state.records[id];
    if (!state.deleted.includes(id)) state.deleted.push(id);
    this.writeState(state);
    return { ok: true, localTest: true };
  }

  async catalog() {
    const songs = (await this.allSongs()).filter(song => song?._opentab?.public === true);
    const metadata = songs.map(catalogMetaFromSong);
    return { works: aggregateCatalogWorks(metadata), songs: metadata, localTest: true };
  }

  async setPublic() { throw new Error('LOCAL_TEST_VISIBILITY_UNSUPPORTED'); }
  async publishSong() { throw new Error('LOCAL_TEST_PUBLISH_UNSUPPORTED'); }

  async clonePublicSong(fileId) {
    const source = (await this.loadSong(fileId)).song;
    const copy = {
      ...cloneValue(source),
      id: createCatalogId('song'),
      arrangementId: createCatalogId('arr'),
      _driveFileId: '',
      _driveFileName: '',
      _driveModifiedTime: '',
      _opentab: {
        ...(source._opentab || {}),
        owner: TEST_USER.username,
        uploadedBy: TEST_USER.username,
        updatedBy: TEST_USER.username,
        public: false,
        publishedAt: '',
        sourcePublicFileId: String(fileId || '')
      }
    };
    return this.saveSong(copy);
  }

  async reset() {
    this.storage?.removeItem(LOCAL_TEST_STORAGE_KEY);
    return { ok: true, localTest: true };
  }
}
