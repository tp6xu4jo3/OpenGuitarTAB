import crypto from 'node:crypto';
import {
  songOwner,
  songWasPublished,
  songIsPublic,
  canEditSong,
  canUnlistSong,
  canDeleteSong
} from '../src/core/song-permissions.js';
import {
  aggregateCatalogWorks,
  createCatalogId,
  ensureArrangementIdentity
} from '../src/catalog/work-model.js';
import { enrichSongMedia, normalizeArtistMedia } from '../src/catalog/media.js';
import { isDocumentV3, normalizeDocumentV3 } from '../src/editor/model.js';

const PUBLIC_FOLDER_ID = process.env.PUBLIC_DRIVE_FOLDER_ID || '1_SZt4WOMakWa3aD54W2tYHtdOk44WUUP';
const TEST_FOLDER_ID = process.env.TEST_DRIVE_FOLDER_ID || '1k11xZcK1irQ5fNtitcLHCq5sgAZoDW0g';
const PERMISSION_RECORDS_FOLDER_ID = process.env.PERMISSION_RECORDS_FOLDER_ID || '1RQMJwYqcqNi58VRZF_HlA8-Az6yIwfK6';
const SESSION_COOKIE = 'opentab_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const INDEX_FILE_NAME = 'index.json';
const ARTIST_MEDIA_FILE_NAME = 'artists.json';
const LEGACY_PERMISSIONS_FILE_NAME = 'permissions.json';
const RESERVED_JSON_NAMES = new Set([INDEX_FILE_NAME, ARTIST_MEDIA_FILE_NAME, LEGACY_PERMISSIONS_FILE_NAME]);
const DRIVE_READ_CONCURRENCY = 8;
const STANDARD_TUNING = 'standard';
const PERMISSION_FILE_PREFIX = 'permission-';
const SONG_FIELD_ORDER = [
  'id',
  'workId',
  'arrangementId',
  'name',
  'tempo',
  'capo',
  'beatsPerMeasure',
  'meter',
  'tuning',
  'source',
  'playStyle',
  'difficulty',
  'createdAt',
  'updatedAt',
  'artist',
  'album',
  'document'
];

let driveTokenCache = null;

export async function settledMapWithConcurrency(items, limit, mapper) {
  const source = Array.isArray(items) ? items : [];
  if (!source.length) return [];
  const concurrency = Math.max(1, Math.trunc(Number(limit) || 1));
  const results = new Array(source.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= source.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await mapper(source[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, source.length) }, () => worker()));
  return results;
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('INVALID_JSON_BODY');
  }
}

function parseCookies(header = '') {
  const result = {};
  String(header).split(';').forEach(part => {
    const index = part.indexOf('=');
    if (index < 0) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  });
  return result;
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signSession(payload) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET_MISSING');
  const encoded = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifySessionToken(token) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !token || !token.includes('.')) return null;
  const [encoded, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  const a = Buffer.from(signature || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload?.username || !payload?.role || Number(payload.exp) <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function currentSession(req) {
  return verifySessionToken(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
}

function setSessionCookie(res, session) {
  const token = signSession(session);
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

function verifyPbkdf2(password, encoded) {
  const parts = String(encoded || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 100000) return false;
  const salt = Buffer.from(parts[2], 'base64url');
  const expected = Buffer.from(parts[3], 'base64url');
  const actual = crypto.pbkdf2Sync(String(password), salt, iterations, expected.length, 'sha256');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function safeStringEqual(a, b) {
  const aa = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function userConfig(username) {
  if (username === 'admin') {
    return {
      username: 'admin',
      role: 'admin',
      passwordHash: process.env.ADMIN_PASSWORD_HASH,
      password: process.env.ADMIN_PASSWORD
    };
  }
  if (username === 'test') {
    return {
      username: 'test',
      role: 'test',
      passwordHash: process.env.TEST_PASSWORD_HASH,
      password: process.env.TEST_PASSWORD
    };
  }
  return null;
}

function verifyCredentials(username, password) {
  const user = userConfig(String(username || '').trim());
  if (!user) return null;
  const valid = user.passwordHash
    ? verifyPbkdf2(password, user.passwordHash)
    : user.password != null && safeStringEqual(password, user.password);
  return valid ? { username: user.username, role: user.role } : null;
}

function requireSession(req, res) {
  const session = currentSession(req);
  if (!session) {
    json(res, 401, { error: 'AUTH_REQUIRED' });
    return null;
  }
  return session;
}

function requireSameOrigin(req, res) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return true;
  try {
    if (new URL(origin).host === host) return true;
  } catch {}
  json(res, 403, { error: 'ORIGIN_NOT_ALLOWED' });
  return false;
}

async function getDriveToken() {
  if (driveTokenCache && driveTokenCache.expiresAt > Date.now() + 60_000) return driveTokenCache.token;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) throw new Error('DRIVE_OAUTH_NOT_CONFIGURED');

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`DRIVE_TOKEN_FAILED:${payload.error || response.status}`);
  }
  driveTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000
  };
  return driveTokenCache.token;
}

async function driveFetch(path, { method = 'GET', headers = {}, body, upload = false } = {}) {
  const token = await getDriveToken();
  const base = upload ? 'https://www.googleapis.com/upload/drive/v3' : 'https://www.googleapis.com/drive/v3';
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...headers },
    body
  });
  if (response.ok) return response;
  const detail = await response.text().catch(() => '');
  throw new Error(`DRIVE_${method}_${response.status}:${detail.slice(0, 300)}`);
}

async function listJsonFiles(folderId, { includeReserved = false } = {}) {
  const files = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and mimeType = 'application/json'`,
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,parents)',
      orderBy: 'modifiedTime desc',
      pageSize: '1000'
    });
    if (pageToken) params.set('pageToken', pageToken);
    const payload = await (await driveFetch(`/files?${params}`)).json();
    files.push(...(payload.files || []));
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  return includeReserved ? files : files.filter(file => !RESERVED_JSON_NAMES.has(file.name));
}

async function findNamedJsonFile(folderId, name) {
  const safeName = String(name).replace(/'/g, "\\'");
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false and mimeType = 'application/json' and name = '${safeName}'`,
    fields: 'files(id,name,mimeType,modifiedTime,size,parents)',
    orderBy: 'modifiedTime desc',
    pageSize: '2'
  });
  const payload = await (await driveFetch(`/files?${params}`)).json();
  return (payload.files || [])[0] || null;
}

async function fileMetadata(fileId) {
  const params = new URLSearchParams({ fields: 'id,name,mimeType,trashed,parents,modifiedTime' });
  return (await driveFetch(`/files/${encodeURIComponent(fileId)}?${params}`)).json();
}

function folderForFile(file) {
  if (Array.isArray(file?.parents) && file.parents.includes(PUBLIC_FOLDER_ID)) return PUBLIC_FOLDER_ID;
  if (Array.isArray(file?.parents) && file.parents.includes(TEST_FOLDER_ID)) return TEST_FOLDER_ID;
  return '';
}

async function assertManagedFile(fileId) {
  const file = await fileMetadata(fileId);
  const folderId = folderForFile(file);
  if (file.trashed || file.mimeType !== 'application/json' || !folderId || RESERVED_JSON_NAMES.has(file.name)) {
    throw new Error('FILE_OUTSIDE_LIBRARY');
  }
  return { file, folderId };
}

async function readDriveJson(fileId, invalidCode = 'INVALID_SONG_JSON') {
  const response = await driveFetch(`/files/${encodeURIComponent(fileId)}?alt=media`);
  const text = (await response.text()).replace(/^\uFEFF/, '');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(invalidCode);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(invalidCode);
  return value;
}

async function writeNamedJsonFile(folderId, name, value, existingFile = null) {
  const body = JSON.stringify(value, null, 2);
  const existing = existingFile || await findNamedJsonFile(folderId, name);
  if (existing) {
    const response = await driveFetch(
      `/files/${encodeURIComponent(existing.id)}?uploadType=media&fields=id,name,modifiedTime`,
      {
        method: 'PATCH',
        upload: true,
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body
      }
    );
    return response.json();
  }

  const boundary = `opentab_${crypto.randomBytes(12).toString('hex')}`;
  const metadata = JSON.stringify({ name, parents: [folderId] });
  const multipart = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${body}\r\n`,
    `--${boundary}--`
  ].join('');
  const response = await driveFetch('/files?uploadType=multipart&fields=id,name,modifiedTime', {
    method: 'POST',
    upload: true,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart
  });
  return response.json();
}

async function updateNamedJsonFile(fileId, name, value) {
  const boundary = `opentab_${crypto.randomBytes(12).toString('hex')}`;
  const metadata = JSON.stringify({ name });
  const media = JSON.stringify(value, null, 2);
  const body = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${media}\r\n`,
    `--${boundary}--`
  ].join('');
  const response = await driveFetch(
    `/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,name,modifiedTime`,
    {
      method: 'PATCH',
      upload: true,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    }
  );
  return response.json();
}

function normalizePermissionRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const owner = String(raw.owner || '').trim();
  if (!owner || typeof raw.public !== 'boolean') return null;
  const normalized = { owner, public: raw.public };
  for (const key of ['uploadedBy', 'updatedBy', 'sourcePublicFileId']) {
    const value = String(raw[key] || '').trim();
    if (value) normalized[key] = value;
  }
  if (raw.publishedAt !== undefined && raw.publishedAt !== null && raw.publishedAt !== '') {
    normalized.publishedAt = structuredClone(raw.publishedAt);
  }
  return normalized;
}

export function permissionRecordFileName(songFileId) {
  const id = String(songFileId || '').trim();
  if (!id) throw new Error('PERMISSION_FILE_ID_REQUIRED');
  return `${PERMISSION_FILE_PREFIX}${id}.json`;
}

export function normalizePermissionFile(raw) {
  if (!raw || Number(raw.version) !== 1) return null;
  const songFileId = String(raw.songFileId || '').trim();
  const permission = normalizePermissionRecord(raw);
  if (!songFileId || !permission) return null;
  return { version: 1, songFileId, ...permission };
}

function permissionFileValue(songFileId, permission) {
  const normalized = normalizePermissionRecord(permission);
  if (!normalized) throw new Error('INVALID_PERMISSION_RECORD');
  return { version: 1, songFileId: String(songFileId), ...normalized };
}

function normalizeLegacyPermissions(raw) {
  if (!raw || Number(raw.version) !== 1 || !raw.songs || typeof raw.songs !== 'object' || Array.isArray(raw.songs)) {
    return null;
  }
  const songs = {};
  for (const [fileId, rawPermission] of Object.entries(raw.songs)) {
    const id = String(fileId || '').trim();
    const permission = normalizePermissionRecord(rawPermission);
    if (id && permission) songs[id] = permission;
  }
  return { version: 1, songs };
}

function normalizeLegacyPermissionEvent(raw) {
  if (!raw || Number(raw.version) !== 1) return null;
  const fileId = String(raw.fileId || '').trim();
  if (!fileId) return null;
  const sequence = Number(raw.sequence);
  const deleted = raw.deleted === true;
  const permission = deleted ? null : normalizePermissionRecord(raw.permission);
  if (!deleted && !permission) return null;
  return {
    version: 1,
    fileId,
    sequence: Number.isFinite(sequence) ? sequence : 0,
    deleted,
    permission
  };
}

export function materializeLegacyPermissions(seed, events) {
  const normalizedSeed = normalizeLegacyPermissions(seed) || { version: 1, songs: {} };
  const songs = structuredClone(normalizedSeed.songs);
  const ordered = (Array.isArray(events) ? events : [])
    .filter(item => normalizeLegacyPermissionEvent(item?.event || item))
    .sort((left, right) => {
      const byTime = String(left?.modifiedTime || '').localeCompare(String(right?.modifiedTime || ''));
      if (byTime) return byTime;
      const a = normalizeLegacyPermissionEvent(left?.event || left);
      const b = normalizeLegacyPermissionEvent(right?.event || right);
      return (Number(a?.sequence) || 0) - (Number(b?.sequence) || 0);
    });
  for (const item of ordered) {
    const event = normalizeLegacyPermissionEvent(item?.event || item);
    if (!event) continue;
    if (event.deleted) delete songs[event.fileId];
    else songs[event.fileId] = event.permission;
  }
  return { version: 1, songs };
}

async function writePermissionRecord(songFileId, permission) {
  const id = String(songFileId || '').trim();
  if (!id) throw new Error('PERMISSION_FILE_ID_REQUIRED');
  const value = permissionFileValue(id, permission);
  await writeNamedJsonFile(PERMISSION_RECORDS_FOLDER_ID, permissionRecordFileName(id), value);
  return normalizePermissionRecord(value);
}

async function deletePermissionRecord(songFileId) {
  const file = await findNamedJsonFile(PERMISSION_RECORDS_FOLDER_ID, permissionRecordFileName(songFileId));
  if (!file) return;
  await driveFetch(`/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
}

async function migrateLegacyPermissions() {
  const seedFile = await findNamedJsonFile(PUBLIC_FOLDER_ID, LEGACY_PERMISSIONS_FILE_NAME);
  if (!seedFile) return;
  const seed = normalizeLegacyPermissions(await readDriveJson(seedFile.id, 'INVALID_PERMISSIONS'));
  if (!seed) throw new Error('INVALID_PERMISSIONS');

  const permissionFiles = await listJsonFiles(PERMISSION_RECORDS_FOLDER_ID, { includeReserved: true });
  const legacyFiles = permissionFiles.filter(file => !String(file.name || '').startsWith(PERMISSION_FILE_PREFIX));
  const results = await settledMapWithConcurrency(legacyFiles, DRIVE_READ_CONCURRENCY, async file => ({
    modifiedTime: String(file.modifiedTime || ''),
    event: normalizeLegacyPermissionEvent(await readDriveJson(file.id, 'INVALID_PERMISSION_RECORD'))
  }));
  const failed = results.find(result => result.status === 'rejected' || !result.value?.event);
  if (failed) throw failed.reason || new Error('INVALID_PERMISSION_RECORD');

  const permissions = materializeLegacyPermissions(seed, results.map(result => result.value));
  const writes = await settledMapWithConcurrency(
    Object.entries(permissions.songs),
    DRIVE_READ_CONCURRENCY,
    ([fileId, permission]) => writePermissionRecord(fileId, permission)
  );
  const writeFailure = writes.find(result => result.status === 'rejected');
  if (writeFailure) throw writeFailure.reason;

  await Promise.all([
    ...legacyFiles.map(file => driveFetch(`/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' })),
    driveFetch(`/files/${encodeURIComponent(seedFile.id)}`, { method: 'DELETE' })
  ]);
}

async function readPermissions() {
  await migrateLegacyPermissions();
  const files = (await listJsonFiles(PERMISSION_RECORDS_FOLDER_ID, { includeReserved: true }))
    .filter(file => String(file.name || '').startsWith(PERMISSION_FILE_PREFIX));
  const results = await settledMapWithConcurrency(files, DRIVE_READ_CONCURRENCY, async file => {
    const value = normalizePermissionFile(await readDriveJson(file.id, 'INVALID_PERMISSION_RECORD'));
    if (!value) throw new Error('INVALID_PERMISSION_RECORD');
    return value;
  });
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  const songs = {};
  for (const result of results) {
    const value = result.value;
    songs[value.songFileId] = normalizePermissionRecord(value);
  }
  return { version: 1, songs };
}

function permissionForFile(permissions, fileId) {
  return normalizePermissionRecord(permissions?.songs?.[String(fileId || '')]);
}

function authoritativeSong(song, file, permission) {
  const source = song && typeof song === 'object' && !Array.isArray(song) ? structuredClone(song) : {};
  delete source._opentab;
  const normalizedPermission = normalizePermissionRecord(permission);
  if (normalizedPermission) source._opentab = normalizedPermission;
  return ensureArrangementIdentity(source, { fileId: file.id });
}

function isManagedSong(song, folderId) {
  const owner = songOwner(song);
  if (!owner) return false;
  if (folderId === PUBLIC_FOLDER_ID) return owner === 'admin';
  if (folderId === TEST_FOLDER_ID) return owner === 'test';
  return false;
}

function attachFileMeta(song, file) {
  return {
    ...song,
    _driveFileId: file.id,
    _driveFileName: file.name,
    _driveModifiedTime: file.modifiedTime || ''
  };
}

function catalogIndexSong(song, file) {
  const enriched = ensureArrangementIdentity(song, { fileId: file.id });
  return {
    songId: String(enriched.id || file.id),
    workId: enriched.workId,
    arrangementId: enriched.arrangementId,
    name: enriched.name || file.name.replace(/\.json$/i, ''),
    artist: String(enriched.artist || ''),
    album: String(enriched.album || ''),
    source: String(enriched.source || ''),
    playStyle: enriched.playStyle === 'chord' ? 'chord' : enriched.playStyle === 'fingerstyle' ? 'fingerstyle' : '',
    difficulty: Number.isFinite(Number(enriched.difficulty))
      ? Math.min(5, Math.max(1, Math.round(Number(enriched.difficulty))))
      : null,
    tempo: Number(enriched.tempo) || 120,
    capo: Number.isFinite(Number(enriched.capo)) ? Number(enriched.capo) : 0,
    beatsPerMeasure: Number(enriched.beatsPerMeasure) === 3 ? 3 : 4,
    driveFileId: String(file.id),
    driveFileName: String(file.name || ''),
    driveModifiedTime: String(file.modifiedTime || '')
  };
}

function catalogApiMeta(record) {
  return {
    id: String(record?.songId || ''),
    workId: String(record?.workId || ''),
    arrangementId: String(record?.arrangementId || ''),
    name: String(record?.name || ''),
    artist: String(record?.artist || ''),
    album: String(record?.album || ''),
    source: String(record?.source || ''),
    playStyle: record?.playStyle === 'chord' ? 'chord' : record?.playStyle === 'fingerstyle' ? 'fingerstyle' : '',
    difficulty: record?.difficulty ?? null,
    tempo: Number(record?.tempo) || 120,
    capo: Number.isFinite(Number(record?.capo)) ? Number(record.capo) : 0,
    beatsPerMeasure: Number(record?.beatsPerMeasure) === 3 ? 3 : 4,
    _driveFileId: String(record?.driveFileId || ''),
    _driveFileName: String(record?.driveFileName || ''),
    _driveModifiedTime: String(record?.driveModifiedTime || '')
  };
}

function attachCatalogPermission(metadata, permission) {
  const normalized = normalizePermissionRecord(permission);
  if (!normalized) return null;
  return {
    ...metadata,
    owner: normalized.owner,
    uploadedBy: String(normalized.uploadedBy || normalized.owner || 'OpenGuitarTAB'),
    public: normalized.public
  };
}

export function cleanSongForWrite(song) {
  const input = ensureArrangementIdentity(song);
  if (!isDocumentV3(input.document)) throw new Error('V3_DOCUMENT_REQUIRED');
  const beatsPerMeasure = Number(input.beatsPerMeasure) === 3 ? 3 : 4;
  const defaults = {
    id: String(input.id || `song-${Date.now().toString(36)}`),
    workId: input.workId,
    arrangementId: input.arrangementId,
    name: String(input.name || '未命名曲譜'),
    tempo: Number(input.tempo) || 120,
    capo: Number.isFinite(Number(input.capo)) ? Number(input.capo) : 0,
    beatsPerMeasure,
    meter: String(input.meter || `${beatsPerMeasure}/4`),
    tuning: input.tuning ?? STANDARD_TUNING,
    source: String(input.source || ''),
    playStyle: input.playStyle === 'chord' ? 'chord' : input.playStyle === 'fingerstyle' ? 'fingerstyle' : '',
    difficulty: Number.isFinite(Number(input.difficulty))
      ? Math.min(5, Math.max(1, Math.round(Number(input.difficulty))))
      : undefined,
    createdAt: Number(input.createdAt) || Date.now(),
    updatedAt: Number(input.updatedAt) || Date.now(),
    artist: String(input.artist || ''),
    album: String(input.album || ''),
    document: normalizeDocumentV3(input.document)
  };
  const persisted = {};
  for (const key of SONG_FIELD_ORDER) {
    if (defaults[key] !== undefined) persisted[key] = structuredClone(defaults[key]);
  }
  return persisted;
}

function driveFileNamePart(value, fallback, maxLength) {
  const normalized = String(value || fallback)
    .normalize('NFKC')
    .trim()
    .replace(/[\u0000-\u001f\u007f/\\]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '');
  return [...(normalized || fallback)].slice(0, maxLength).join('');
}

export function songFileName(song) {
  const title = driveFileNamePart(song?.name, '未命名曲譜', 60);
  const arrangementId = driveFileNamePart(song?.arrangementId || song?.id, 'arrangement', 80).replace(/\s+/g, '-');
  return `${title}__${arrangementId}.json`;
}

async function entriesFromFiles(folderId, files, permissions) {
  const sourceFiles = Array.isArray(files) ? files : [];
  const results = await settledMapWithConcurrency(sourceFiles, DRIVE_READ_CONCURRENCY, async file => {
    const permission = permissionForFile(permissions, file.id);
    if (!permission) return null;
    const song = authoritativeSong(await readDriveJson(file.id), file, permission);
    return isManagedSong(song, folderId) ? { file, folderId, song } : null;
  });
  const fatal = results.find(result =>
    result.status === 'rejected' && String(result.reason?.message || result.reason) !== 'INVALID_SONG_JSON'
  );
  if (fatal) throw fatal.reason;
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn('Skipping invalid Drive song JSON:', sourceFiles[index]?.id, sourceFiles[index]?.name);
    }
  });
  return results
    .filter(result => result.status === 'fulfilled' && result.value)
    .map(result => result.value);
}

async function entriesFromFolder(folderId, permissionsInput = null) {
  const [files, permissions] = await Promise.all([
    listJsonFiles(folderId),
    permissionsInput ? Promise.resolve(permissionsInput) : readPermissions()
  ]);
  return entriesFromFiles(folderId, files, permissions);
}

function manifestEntry(file) {
  return {
    driveFileId: String(file?.driveFileId || file?.id || ''),
    fileName: String(file?.fileName || file?.name || ''),
    modifiedTime: String(file?.modifiedTime || '')
  };
}

function catalogFileManifest(files) {
  return (Array.isArray(files) ? files : [])
    .filter(file => file && typeof file === 'object' && !Array.isArray(file) && (file.driveFileId || file.id))
    .map(manifestEntry)
    .sort((left, right) => left.driveFileId.localeCompare(right.driveFileId));
}

export function normalizeCatalogIndex(raw) {
  if (!raw || Number(raw.version) !== 2 || !Array.isArray(raw.manifest) || !Array.isArray(raw.songs)) return null;
  const manifest = catalogFileManifest(raw.manifest);
  const omittedDriveFileIds = Array.isArray(raw.omittedDriveFileIds)
    ? raw.omittedDriveFileIds.map(fileId => String(fileId || '').trim()).filter(Boolean).sort()
    : null;
  const songs = raw.songs
    .filter(item => item && typeof item === 'object' && !Array.isArray(item))
    .map(item => ({
      songId: String(item.songId || ''),
      workId: String(item.workId || ''),
      arrangementId: String(item.arrangementId || ''),
      name: String(item.name || ''),
      artist: String(item.artist || ''),
      album: String(item.album || ''),
      source: String(item.source || ''),
      playStyle: item.playStyle === 'chord' ? 'chord' : item.playStyle === 'fingerstyle' ? 'fingerstyle' : '',
      difficulty: Number.isFinite(Number(item.difficulty)) ? Math.min(5, Math.max(1, Math.round(Number(item.difficulty)))) : null,
      tempo: Number(item.tempo) || 120,
      capo: Number.isFinite(Number(item.capo)) ? Number(item.capo) : 0,
      beatsPerMeasure: Number(item.beatsPerMeasure) === 3 ? 3 : 4,
      driveFileId: String(item.driveFileId || ''),
      driveFileName: String(item.driveFileName || ''),
      driveModifiedTime: String(item.driveModifiedTime || '')
    }));
  return { version: 2, manifest, omittedDriveFileIds, songs };
}

function catalogManifestEntryMatches(left, right) {
  const a = manifestEntry(left);
  const b = manifestEntry(right);
  return (
    a.driveFileId === b.driveFileId &&
    a.fileName === b.fileName &&
    a.modifiedTime === b.modifiedTime
  );
}

function catalogSongMatchesFile(song, file) {
  return (
    String(song?.driveFileId || '') === String(file?.id || '') &&
    String(song?.driveFileName || '') === String(file?.name || '') &&
    String(song?.driveModifiedTime || '') === String(file?.modifiedTime || '')
  );
}

function catalogIndexCoverageIsValid(index) {
  if (!index || !Array.isArray(index.manifest) || !Array.isArray(index.songs) || !Array.isArray(index.omittedDriveFileIds)) {
    return false;
  }

  const fileIds = new Set();
  for (const file of index.manifest) {
    const fileId = String(file?.driveFileId || '');
    if (!fileId || fileIds.has(fileId)) return false;
    fileIds.add(fileId);
  }

  const coveredFileIds = new Set();
  for (const song of index.songs) {
    const fileId = String(song?.driveFileId || '');
    if (!fileIds.has(fileId) || coveredFileIds.has(fileId)) return false;
    coveredFileIds.add(fileId);
  }
  for (const rawFileId of index.omittedDriveFileIds) {
    const fileId = String(rawFileId || '');
    if (!fileIds.has(fileId) || coveredFileIds.has(fileId)) return false;
    coveredFileIds.add(fileId);
  }
  return coveredFileIds.size === fileIds.size;
}

export function catalogIndexRefreshPlan(index, files) {
  const sourceFiles = Array.isArray(files) ? files : [];
  const manifest = catalogFileManifest(sourceFiles);
  const normalized = normalizeCatalogIndex(index);
  if (!catalogIndexCoverageIsValid(normalized)) {
    return {
      manifest,
      reusableSongs: [],
      retainedOmittedDriveFileIds: [],
      filesToRead: sourceFiles
    };
  }

  const indexedFiles = new Map(normalized.manifest.map(file => [file.driveFileId, file]));
  const cachedSongs = new Map(normalized.songs.map(song => [String(song?.driveFileId || ''), song]));
  const omittedFileIds = new Set(normalized.omittedDriveFileIds);
  const reusableSongs = [];
  const retainedOmittedDriveFileIds = [];
  const filesToRead = [];

  for (const file of sourceFiles) {
    const fileId = String(file?.id || '');
    const previousFile = indexedFiles.get(fileId);
    if (!previousFile || !catalogManifestEntryMatches(previousFile, file)) {
      filesToRead.push(file);
      continue;
    }

    const cachedSong = cachedSongs.get(fileId);
    if (cachedSong && catalogSongMatchesFile(cachedSong, file)) {
      reusableSongs.push(cachedSong);
      continue;
    }
    if (omittedFileIds.has(fileId)) {
      retainedOmittedDriveFileIds.push(fileId);
      continue;
    }
    filesToRead.push(file);
  }

  return { manifest, reusableSongs, retainedOmittedDriveFileIds, filesToRead };
}

export function catalogIndexMatchesFiles(index, files) {
  const normalized = normalizeCatalogIndex(index);
  if (!catalogIndexCoverageIsValid(normalized)) return false;
  const currentFiles = catalogFileManifest(files);
  const indexedFiles = catalogFileManifest(normalized.manifest);
  if (currentFiles.length !== indexedFiles.length) return false;
  for (let indexPosition = 0; indexPosition < currentFiles.length; indexPosition += 1) {
    if (!catalogManifestEntryMatches(currentFiles[indexPosition], indexedFiles[indexPosition])) return false;
  }

  const currentById = new Map((Array.isArray(files) ? files : []).map(file => [String(file?.id || ''), file]));
  for (const song of normalized.songs) {
    const file = currentById.get(String(song?.driveFileId || ''));
    if (!file || !catalogSongMatchesFile(song, file)) return false;
  }
  return true;
}

function catalogIndexFromEntries(sourceFiles, entries) {
  const includedFileIds = new Set(entries.map(entry => String(entry.file.id)));
  return {
    version: 2,
    manifest: catalogFileManifest(sourceFiles),
    omittedDriveFileIds: sourceFiles
      .map(file => String(file?.id || ''))
      .filter(fileId => fileId && !includedFileIds.has(fileId))
      .sort(),
    songs: entries
      .map(entry => catalogIndexSong(entry.song, entry.file))
      .sort((left, right) => String(left.driveFileId || '').localeCompare(String(right.driveFileId || '')))
  };
}

async function rebuildCatalogIndex(folderId, files = null, permissionsInput = null, existingFile = null) {
  const [sourceFiles, permissions] = await Promise.all([
    Array.isArray(files) ? Promise.resolve(files) : listJsonFiles(folderId),
    permissionsInput ? Promise.resolve(permissionsInput) : readPermissions()
  ]);
  const entries = await entriesFromFiles(folderId, sourceFiles, permissions);
  const index = catalogIndexFromEntries(sourceFiles, entries);
  await writeNamedJsonFile(folderId, INDEX_FILE_NAME, index, existingFile);
  return index;
}

async function refreshCatalogIndex(folderId, indexFile, index, files, permissionsInput = null) {
  const sourceFiles = Array.isArray(files) ? files : [];
  const plan = catalogIndexRefreshPlan(index, sourceFiles);
  const permissions = permissionsInput || await readPermissions();
  const refreshedEntries = await entriesFromFiles(folderId, plan.filesToRead, permissions);
  const refreshedFileIds = new Set(refreshedEntries.map(entry => String(entry.file.id)));
  const omittedDriveFileIds = new Set(plan.retainedOmittedDriveFileIds);
  for (const file of plan.filesToRead) {
    const fileId = String(file?.id || '');
    if (fileId && !refreshedFileIds.has(fileId)) omittedDriveFileIds.add(fileId);
  }

  const nextIndex = {
    version: 2,
    manifest: plan.manifest,
    omittedDriveFileIds: [...omittedDriveFileIds].sort(),
    songs: [
      ...plan.reusableSongs,
      ...refreshedEntries.map(entry => catalogIndexSong(entry.song, entry.file))
    ].sort((left, right) => String(left.driveFileId || '').localeCompare(String(right.driveFileId || '')))
  };
  await writeNamedJsonFile(folderId, INDEX_FILE_NAME, nextIndex, indexFile);
  return nextIndex;
}

async function readCatalogIndex(folderId, permissionsInput = null) {
  const [file, files] = await Promise.all([
    findNamedJsonFile(folderId, INDEX_FILE_NAME),
    listJsonFiles(folderId)
  ]);
  if (!file) return rebuildCatalogIndex(folderId, files, permissionsInput);
  try {
    const normalized = normalizeCatalogIndex(await readDriveJson(file.id, 'INVALID_CATALOG_INDEX'));
    if (normalized && catalogIndexMatchesFiles(normalized, files)) return normalized;
    if (catalogIndexCoverageIsValid(normalized)) {
      return refreshCatalogIndex(folderId, file, normalized, files, permissionsInput);
    }
  } catch (error) {
    if (String(error?.message || error) !== 'INVALID_CATALOG_INDEX') throw error;
  }
  return rebuildCatalogIndex(folderId, files, permissionsInput, file);
}

async function readArtistMedia() {
  const file = await findNamedJsonFile(PUBLIC_FOLDER_ID, ARTIST_MEDIA_FILE_NAME);
  if (!file) return normalizeArtistMedia({ version: 2, artists: {} });
  return normalizeArtistMedia(await readDriveJson(file.id, 'INVALID_ARTIST_MEDIA'));
}

async function createSongFile(folderId, song, permission) {
  const persisted = cleanSongForWrite(song);
  const normalizedPermission = normalizePermissionRecord(permission);
  if (!normalizedPermission) throw new Error('INVALID_PERMISSION_RECORD');

  const boundary = `opentab_${crypto.randomBytes(12).toString('hex')}`;
  const metadata = JSON.stringify({ name: songFileName(persisted), parents: [folderId] });
  const media = JSON.stringify(persisted, null, 2);
  const body = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${media}\r\n`,
    `--${boundary}--`
  ].join('');
  const response = await driveFetch('/files?uploadType=multipart&fields=id,name,modifiedTime', {
    method: 'POST',
    upload: true,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
  const file = await response.json();
  try {
    await writePermissionRecord(file.id, normalizedPermission);
  } catch (error) {
    await driveFetch(`/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' }).catch(() => null);
    throw error;
  }
  return attachFileMeta(authoritativeSong(persisted, file, normalizedPermission), file);
}

async function updateSongFile(fileId, song, permission) {
  const persisted = cleanSongForWrite(song);
  const file = await updateNamedJsonFile(fileId, songFileName(persisted), persisted);
  return attachFileMeta(authoritativeSong(persisted, file, permission), file);
}

async function readManagedEntry(fileId, permissionsInput = null) {
  const [{ file, folderId }, permissions] = await Promise.all([
    assertManagedFile(fileId),
    permissionsInput ? Promise.resolve(permissionsInput) : readPermissions()
  ]);
  const permission = permissionForFile(permissions, file.id);
  if (!permission) throw new Error('PUBLIC_SONG_NOT_MANAGED');
  const raw = await readDriveJson(fileId);
  const song = authoritativeSong(raw, file, permission);
  if (!isManagedSong(song, folderId)) throw new Error('PUBLIC_SONG_NOT_MANAGED');
  return { file, folderId, song };
}

async function managedPublicCatalog() {
  const permissions = await readPermissions();
  const [publicIndex, testIndex, media] = await Promise.all([
    readCatalogIndex(PUBLIC_FOLDER_ID, permissions),
    readCatalogIndex(TEST_FOLDER_ID, permissions),
    readArtistMedia()
  ]);
  const songs = [...publicIndex.songs, ...testIndex.songs]
    .map(catalogApiMeta)
    .map(item => attachCatalogPermission(item, permissionForFile(permissions, item?._driveFileId)))
    .filter(item => item?.public === true)
    .map(item => enrichSongMedia(item, media))
    .sort((a, b) => String(b._driveModifiedTime || '').localeCompare(String(a._driveModifiedTime || '')));
  return { works: aggregateCatalogWorks(songs), songs };
}

async function userLibrary(session) {
  const [media, permissions] = await Promise.all([readArtistMedia(), readPermissions()]);
  if (session.role === 'admin') {
    const [publicEntries, testEntries] = await Promise.all([
      entriesFromFolder(PUBLIC_FOLDER_ID, permissions),
      entriesFromFolder(TEST_FOLDER_ID, permissions)
    ]);
    return [...publicEntries, ...testEntries.filter(entry => songWasPublished(entry.song))]
      .map(entry => enrichSongMedia(attachFileMeta(entry.song, entry.file), media))
      .sort((a, b) => String(b._driveModifiedTime || '').localeCompare(String(a._driveModifiedTime || '')));
  }
  const testEntries = await entriesFromFolder(TEST_FOLDER_ID, permissions);
  return testEntries
    .filter(entry => songOwner(entry.song) === session.username)
    .map(entry => enrichSongMedia(attachFileMeta(entry.song, entry.file), media))
    .sort((a, b) => String(b._driveModifiedTime || '').localeCompare(String(a._driveModifiedTime || '')));
}

function writeMeta(existingSong, session, patch = {}) {
  const owner = songOwner(existingSong);
  if (!owner) throw new Error('OWNER_REQUIRED');
  const existing = existingSong._opentab || {};
  const meta = {
    ...existing,
    ...patch,
    owner,
    updatedBy: session.username
  };
  if (meta.public === true || meta.publishedAt) meta.uploadedBy = owner;
  return normalizePermissionRecord(meta);
}

async function saveUserSong(session, song) {
  const fileId = String(song?._driveFileId || '').trim();
  if (!fileId) {
    const owner = session.username;
    const isAdmin = session.role === 'admin';
    const permission = {
      owner,
      public: isAdmin,
      ...(isAdmin ? { uploadedBy: owner, publishedAt: Date.now() } : {})
    };
    const folderId = isAdmin ? PUBLIC_FOLDER_ID : TEST_FOLDER_ID;
    return createSongFile(folderId, song, permission);
  }

  const entry = await readManagedEntry(fileId);
  if (!canEditSong(session, entry.song)) throw new Error('EDIT_FORBIDDEN');
  return updateSongFile(fileId, song, entry.song._opentab);
}

async function publishSong(session, song) {
  const artist = String(song?.artist || '').trim();
  if (!artist) throw new Error('ARTIST_REQUIRED');
  const fileId = String(song?._driveFileId || '').trim();
  if (!fileId) throw new Error('SAVE_BEFORE_PUBLISH');
  const entry = await readManagedEntry(fileId);
  if (!canEditSong(session, entry.song)) throw new Error('EDIT_FORBIDDEN');
  const permission = writeMeta(entry.song, session, {
    public: true,
    publishedAt: entry.song?._opentab?.publishedAt || Date.now()
  });
  const saved = await updateSongFile(fileId, { ...song, artist }, permission);
  await writePermissionRecord(fileId, permission);
  return saved;
}

async function setPublicState(session, fileId, isPublic) {
  const entry = await readManagedEntry(fileId);
  if (!canUnlistSong(session, entry.song)) throw new Error('VISIBILITY_FORBIDDEN');
  const patch = { public: Boolean(isPublic) };
  if (patch.public) patch.publishedAt = entry.song?._opentab?.publishedAt || Date.now();
  const permission = writeMeta(entry.song, session, patch);
  await writePermissionRecord(fileId, permission);
  return attachFileMeta(authoritativeSong(entry.song, entry.file, permission), entry.file);
}

async function deleteUserSong(session, fileId) {
  const entry = await readManagedEntry(fileId);
  if (!canDeleteSong(session, entry.song)) throw new Error('DELETE_FORBIDDEN');
  await driveFetch(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
  await deletePermissionRecord(fileId).catch(error => {
    console.error('Failed to delete permission record after score delete', error);
  });
}

async function clonePublicToTest(fileId, session) {
  if (session.role === 'admin') throw new Error('ADMIN_LIBRARY_IS_PUBLIC_LIBRARY');
  const entry = await readManagedEntry(fileId);
  if (!songIsPublic(entry.song)) throw new Error('PUBLIC_SONG_NOT_AVAILABLE');
  const copy = structuredClone(entry.song);
  delete copy._opentab;
  delete copy._driveFileId;
  delete copy._driveFileName;
  delete copy._driveModifiedTime;
  delete copy.cover;
  delete copy.artistImage;
  copy.id = `song-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  copy.arrangementId = createCatalogId('arr');
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  return createSongFile(TEST_FOLDER_ID, copy, {
    owner: session.username,
    public: false,
    sourcePublicFileId: fileId
  });
}

function publicSession(session) {
  return session ? { username: session.username, role: session.role } : null;
}

export default async function handler(req, res) {
  try {
    const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const action = requestUrl.searchParams.get('action') || 'session';

    if (req.method === 'OPTIONS') return json(res, 204, {});
    if (!['GET', 'HEAD'].includes(req.method) && !requireSameOrigin(req, res)) return;

    if (action === 'session' && req.method === 'GET') {
      return json(res, 200, { user: publicSession(currentSession(req)) });
    }

    if (action === 'login' && req.method === 'POST') {
      const body = await readBody(req);
      const user = verifyCredentials(body.username, body.password);
      if (!user) return json(res, 401, { error: 'INVALID_CREDENTIALS' });
      const session = { ...user, exp: Date.now() + SESSION_TTL_SECONDS * 1000 };
      setSessionCookie(res, session);
      return json(res, 200, { user: publicSession(session) });
    }

    if (action === 'logout' && req.method === 'POST') {
      clearSessionCookie(res);
      return json(res, 200, { ok: true });
    }

    if (action === 'catalog' && req.method === 'GET') {
      return json(res, 200, await managedPublicCatalog());
    }

    if (action === 'catalog-song' && req.method === 'GET') {
      const fileId = requestUrl.searchParams.get('fileId');
      if (!fileId) return json(res, 400, { error: 'FILE_ID_REQUIRED' });
      const [entry, media] = await Promise.all([readManagedEntry(fileId), readArtistMedia()]);
      if (!songIsPublic(entry.song)) return json(res, 404, { error: 'PUBLIC_SONG_NOT_AVAILABLE' });
      return json(res, 200, {
        song: enrichSongMedia(attachFileMeta(entry.song, entry.file), media)
      });
    }

    const session = requireSession(req, res);
    if (!session) return;

    if (action === 'library' && req.method === 'GET') {
      return json(res, 200, { songs: await userLibrary(session) });
    }

    if (action === 'save' && req.method === 'POST') {
      const body = await readBody(req);
      const saved = await saveUserSong(session, body.song);
      return json(res, 200, { song: enrichSongMedia(saved, await readArtistMedia()) });
    }

    if (action === 'delete' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.fileId) return json(res, 400, { error: 'FILE_ID_REQUIRED' });
      await deleteUserSong(session, body.fileId);
      return json(res, 200, { ok: true });
    }

    if (action === 'visibility' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.fileId) return json(res, 400, { error: 'FILE_ID_REQUIRED' });
      const saved = await setPublicState(session, body.fileId, body.public);
      return json(res, 200, { song: enrichSongMedia(saved, await readArtistMedia()) });
    }

    if (action === 'hide' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.fileId) return json(res, 400, { error: 'FILE_ID_REQUIRED' });
      const saved = await setPublicState(session, body.fileId, !body.hidden);
      return json(res, 200, { song: enrichSongMedia(saved, await readArtistMedia()) });
    }

    if (action === 'publish' && req.method === 'POST') {
      const body = await readBody(req);
      const saved = await publishSong(session, body.song);
      return json(res, 200, { song: enrichSongMedia(saved, await readArtistMedia()) });
    }

    if (action === 'clone' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.fileId) return json(res, 400, { error: 'FILE_ID_REQUIRED' });
      const saved = await clonePublicToTest(body.fileId, session);
      return json(res, 200, { song: enrichSongMedia(saved, await readArtistMedia()) });
    }

    return json(res, 404, { error: 'NOT_FOUND' });
  } catch (error) {
    const message = String(error?.message || error || 'UNKNOWN_ERROR');
    const forbidden = message.includes('_FORBIDDEN') || message.includes('OUTSIDE_LIBRARY');
    const notFound = message.includes('NOT_AVAILABLE') || message.includes('NOT_MANAGED');
    const badRequest = message.includes('_REQUIRED') || message.includes('INVALID_');
    const status = forbidden
      ? 403
      : notFound
        ? 404
        : badRequest
          ? 400
          : message === 'ADMIN_LIBRARY_IS_PUBLIC_LIBRARY'
            ? 409
            : 500;
    if (status >= 500) console.error(error);
    return json(res, status, { error: message.split(':')[0] });
  }
}
