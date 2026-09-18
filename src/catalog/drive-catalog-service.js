(() => {
  const config = window.DRIVE_CATALOG_CONFIG || {};

  function apiKey() {
    const value = String(config.apiKey || '').trim();
    if (!value) throw new Error('DRIVE_API_KEY_MISSING');
    return value;
  }

  function folderId() {
    const value = String(config.folderId || '').trim();
    if (!value) throw new Error('DRIVE_FOLDER_ID_MISSING');
    return value;
  }

  function apiUrl(path, params = {}) {
    const base = String(config.apiBaseUrl || 'https://www.googleapis.com/drive/v3').replace(/\/$/, '');
    const url = new URL(`${base}/${String(path).replace(/^\//, '')}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    url.searchParams.set('key', apiKey());
    return url;
  }

  async function apiFetch(url, label) {
    const response = await fetch(url, { cache: 'no-store' });
    if (response.ok) return response;
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.message ? `: ${body.error.message}` : '';
    } catch (_) {}
    throw new Error(`${label} failed: ${response.status}${detail}`);
  }

  async function listJsonFiles() {
    const files = [];
    let pageToken = '';
    do {
      const response = await apiFetch(apiUrl('files', {
        q: `'${folderId()}' in parents and trashed = false and mimeType = 'application/json'`,
        fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size)',
        orderBy: 'modifiedTime desc',
        pageSize: 1000,
        pageToken
      }), 'Drive file list');
      const payload = await response.json();
      if (Array.isArray(payload.files)) files.push(...payload.files);
      pageToken = payload.nextPageToken || '';
    } while (pageToken);
    return files;
  }

  async function fetchText(fileId) {
    return (await apiFetch(apiUrl(`files/${encodeURIComponent(fileId)}`, { alt: 'media' }), 'Drive file load')).text();
  }

  function fileNameFromIndex(meta) {
    return String(meta?.file || '').split('/').filter(Boolean).pop() || '';
  }

  async function readLegacyIndex(files) {
    const indexFile = files.find(file => file.name === 'index.json');
    if (!indexFile) return { meta: new Map(), order: new Map() };
    try {
      const value = JSON.parse((await fetchText(indexFile.id)).replace(/^\uFEFF/, ''));
      if (!Array.isArray(value)) throw new Error('index.json must be an array');
      const meta = new Map();
      const order = new Map();
      value.forEach((item, index) => {
        const name = fileNameFromIndex(item);
        if (!name) return;
        meta.set(name, item);
        order.set(name, index);
      });
      return { meta, order };
    } catch (error) {
      console.warn('Legacy index.json ignored:', error);
      return { meta: new Map(), order: new Map() };
    }
  }

  async function readSongMeta(file, fallback = {}) {
    const source = normalizeSongRecord(deserializeSong(await fetchText(file.id)));
    return {
      id: String(source.id || fallback.id || file.name.replace(/\.json$/i, '')),
      name: source.name || fallback.name || file.name.replace(/\.json$/i, ''),
      artist: source.artist || fallback.artist || '',
      album: source.album || fallback.album || '',
      cover: source.cover || fallback.cover || '',
      tempo: Number(source.tempo) || Number(fallback.tempo) || 120,
      capo: Number.isFinite(Number(source.capo)) ? Number(source.capo) : (Number(fallback.capo) || 0),
      beatsPerMeasure: normalizeBeatsPerMeasure(source.beatsPerMeasure || fallback.beatsPerMeasure),
      driveFileId: file.id,
      driveFileName: file.name,
      driveModifiedTime: file.modifiedTime || ''
    };
  }

  async function load() {
    const files = await listJsonFiles();
    const legacy = await readLegacyIndex(files);
    const songFiles = files.filter(file => file.name !== 'index.json');
    const results = await Promise.allSettled(songFiles.map(file => readSongMeta(file, legacy.meta.get(file.name))));
    const songs = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') songs.push(result.value);
      else console.warn(`Drive catalog JSON ignored: ${songFiles[index]?.name || 'unknown'}`, result.reason);
    });
    songs.sort((a, b) => {
      const ai = legacy.order.get(a.driveFileName);
      const bi = legacy.order.get(b.driveFileName);
      const aOld = ai !== undefined;
      const bOld = bi !== undefined;
      if (aOld && bOld) return ai - bi;
      if (aOld !== bOld) return aOld ? 1 : -1;
      return String(b.driveModifiedTime).localeCompare(String(a.driveModifiedTime));
    });
    return songs;
  }

  async function fetchSong(meta) {
    if (!meta?.driveFileId) throw new Error(`Drive song file not found: ${meta?.driveFileName || meta?.id || 'unknown'}`);
    const source = normalizeSongRecord(deserializeSong(await fetchText(meta.driveFileId)));
    return normalizeSongRecord({
      ...source,
      name: source.name || meta.name,
      artist: source.artist || meta.artist,
      album: source.album || meta.album,
      cover: source.cover || meta.cover
    });
  }

  window.driveCatalogService = Object.freeze({ load, fetchSong });
})();
