function cloneValue(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function identityText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US');
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value ?? '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function createCatalogId(prefix = 'id') {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return `${prefix}-${random}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function deriveLegacyWorkId(song) {
  const explicit = String(song?.workId || '').trim();
  if (explicit) return explicit;
  const artist = identityText(song?.artist);
  const name = identityText(song?.name || song?.title || '未命名曲譜');
  return `work-${stableHash(`${artist}\u0000${name}`)}`;
}

export function ensureArrangementIdentity(song, { fileId = '', idFactory = createCatalogId } = {}) {
  const source = song && typeof song === 'object' && !Array.isArray(song) ? cloneValue(song) : {};
  source.workId = deriveLegacyWorkId(source);
  const explicitArrangementId = String(source.arrangementId || '').trim();
  source.arrangementId = explicitArrangementId
    || (fileId ? `arr-drive-${String(fileId)}` : idFactory('arr'));
  return source;
}

function arrangementFromCatalogMeta(meta) {
  const source = ensureArrangementIdentity(meta, { fileId: meta?._driveFileId || '' });
  return {
    id: source.arrangementId,
    arrangementId: source.arrangementId,
    workId: source.workId,
    songId: String(source.id || ''),
    source: String(source.source || ''),
    playStyle: source.playStyle === 'chord' ? 'chord' : source.playStyle === 'fingerstyle' ? 'fingerstyle' : '',
    difficulty: Number.isFinite(Number(source.difficulty)) ? Math.min(5, Math.max(1, Math.round(Number(source.difficulty)))) : null,
    owner: String(source.owner || ''),
    uploadedBy: String(source.uploadedBy || source.owner || 'OpenGuitarTAB'),
    public: source.public === true,
    tempo: Number(source.tempo) || 120,
    capo: Number.isFinite(Number(source.capo)) ? Number(source.capo) : 0,
    beatsPerMeasure: Number(source.beatsPerMeasure) === 3 ? 3 : 4,
    _driveFileId: String(source._driveFileId || ''),
    _driveFileName: String(source._driveFileName || ''),
    _driveModifiedTime: String(source._driveModifiedTime || '')
  };
}

function latestModifiedTime(work) {
  return work?.arrangements?.[0]?._driveModifiedTime || '';
}

export function aggregateCatalogWorks(arrangements = []) {
  const works = new Map();

  for (const raw of arrangements) {
    if (!raw || typeof raw !== 'object') continue;
    const source = ensureArrangementIdentity(raw, { fileId: raw._driveFileId || '' });
    let work = works.get(source.workId);
    if (!work) {
      work = {
        id: source.workId,
        workId: source.workId,
        name: String(source.name || '未命名曲譜'),
        artist: String(source.artist || ''),
        album: String(source.album || ''),
        cover: String(source.cover || ''),
        arrangements: []
      };
      works.set(source.workId, work);
    } else {
      if (!work.name && source.name) work.name = String(source.name);
      if (!work.artist && source.artist) work.artist = String(source.artist);
      if (!work.album && source.album) work.album = String(source.album);
      if (!work.cover && source.cover) work.cover = String(source.cover);
    }
    work.arrangements.push(arrangementFromCatalogMeta(source));
  }

  const result = [...works.values()];
  result.forEach(work => {
    work.arrangements.sort((left, right) =>
      String(right._driveModifiedTime || '').localeCompare(String(left._driveModifiedTime || ''))
      || String(left.arrangementId).localeCompare(String(right.arrangementId))
    );
  });
  result.sort((left, right) =>
    String(latestModifiedTime(right)).localeCompare(String(latestModifiedTime(left)))
    || String(left.workId).localeCompare(String(right.workId))
  );
  return result;
}
