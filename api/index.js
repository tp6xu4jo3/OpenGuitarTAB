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
const PUBLIC_INDEX_FILE_ID = process.env.PUBLIC_CATALOG_INDEX_FILE_ID || '1hbyL7_aRjNWrelkW_sa8RYyCapyr3-5n';
const TEST_INDEX_FILE_ID = process.env.TEST_CATALOG_INDEX_FILE_ID || '1pqT4bV07da__637W7p5MikzQqvcpXVrb';
const PERMISSIONS_FILE_ID = process.env.PERMISSIONS_DRIVE_FILE_ID || '1uP5xzGVOZv6oTZAK_GoqkwoDIrhfXTIR';
const SESSION_COOKIE = 'opentab_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const INDEX_FILE_NAME = 'index.json';
const ARTIST_MEDIA_FILE_NAME = 'artists.json';
const PERMISSIONS_FILE_NAME = 'permissions.json';
const RESERVED_JSON_NAMES = new Set([INDEX_FILE_NAME, ARTIST_MEDIA_FILE_NAME, PERMISSIONS_FILE_NAME]);
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
const DRIVE_READ_CONCURRENCY = 8;
const STANDARD_TUNING = 'standard';
const PERMISSION_EVENT_SCHEMA = 'opentab-permission-event-v1';
const CATALOG_EVENT_SCHEMA = 'opentab-catalog-event-v1';
const COMMENT_PAGE_SIZE = 100;
const COMMENT_WRITE_ATTEMPTS = 3;

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
  try { return JSON.parse(raw); } catch { throw new Error('INVALID_JSON_BODY'); }
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
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`);
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
  if (username === 'admin') return {
    username: 'admin', role: 'admin',
    passwordHash: process.env.ADMIN_PASSWORD_HASH,
    password: process.env.ADMIN_PASSWORD
  };
  if (username === 'test') return {
    username: 'test', role: 'test',
    passwordHash: process.env.TEST_PASSWORD_HASH,
    password: process.env.TEST_PASSWORD
  };
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
  if (!response.ok || !payload.access_token) throw new Error(`DRIVE_TOKEN_FAILED:${payload.error || response.status}`);
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

async function listJsonFiles(folderId) {
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
    const response = await driveFetch(`/files?${params}`);
    const payload = await response.json();
    files.push(...(payload.files || []));
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  return files.filter(file => !RESERVED_JSON_NAMES.has(file.name));
}

async function findNamedJsonFile(folderId, name) {
  const safeName = String(name).replace(/'/g, "\\'");
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false and mimeType = 'application/json' and name = '${safeName}'`,
    fields: 'files(id,name,mimeType,modifiedTime,size,parents)',
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
  try { value = JSON.parse(text); } catch { throw new Error(invalidCode); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(invalidCode);
  return value;
}

async function writeNamedJsonFile(folderId, name, value, existingFile = null) {
  const body = JSON.stringify(value, null, 2);
  const existing = existingFile || await findNamedJsonFile(folderId, name);
  if (existing) {
    const response = await driveFetch(`/files/${encodeURIComponent(existing.id)}?uploadType=media&fields=id,name,modifiedTime`, {
      method: 'PATCH',
      upload: true,
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body
    });
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

function normalizeEventCursor(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const createdTime = String(raw.createdTime || '').trim();
  const id = String(raw.id || '').trim();
  return createdTime && id ? { createdTime, id } : null;
}

function compareEventPosition(left, right) {
  const leftTime = String(left?.createdTime || '');
  const rightTime = String(right?.createdTime || '');
  const byTime = leftTime.localeCompare(rightTime);
  if (byTime) return byTime;
  return String(left?.id || '').localeCompare(String(right?.id || ''));
}

function latestEventCursor(comments) {
  const source = (Array.isArray(comments) ? comments : [])
    .filter(comment => comment?.id && comment?.createdTime && !comment?.deleted)
    .sort(compareEventPosition);
  const latest = source[source.length - 1];
  return latest ? { createdTime: String(latest.createdTime), id: String(latest.id) } : null;
}

function commentsAfterCursor(comments, cursor) {
  const normalizedCursor = normalizeEventCursor(cursor);
  return (Array.isArray(comments) ? comments : [])
    .filter(comment => comment?.id && comment?.createdTime && !comment?.deleted)
    .filter(comment => !normalizedCursor || compareEventPosition(comment, normalizedCursor) > 0)
    .sort(compareEventPosition);
}

async function listDriveComments(fileId) {
  const comments = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      pageSize: String(COMMENT_PAGE_SIZE),
      includeDeleted: 'false',
      fields: 'nextPageToken,comments(id,createdTime,modifiedTime,deleted,content)'
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await driveFetch(`/files/${encodeURIComponent(fileId)}/comments?${params}`);
    const payload = await response.json();
    comments.push(...(payload.comments || []));
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  return comments;
}

async function appendDriveEvent(fileId, event) {
  const content = JSON.stringify(event);
  let lastError = null;
  for (let attempt = 0; attempt < COMMENT_WRITE_ATTEMPTS; attempt += 1) {
    try {
      const params = new URLSearchParams({ fields: 'id,createdTime' });
      const response = await driveFetch(`/files/${encodeURIComponent(fileId)}/comments?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ content })
      });
      return response.json();
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      if (!/DRIVE_POST_(429|5\d\d)/.test(message)) break;
    }
  }
  throw lastError || new Error('DRIVE_EVENT_APPEND_FAILED');
}

function parseSidecarEvents(comments, schema, cursor = null) {
  const events = [];
  const seenEventIds = new Set();
  for (const comment of commentsAfterCursor(comments, cursor)) {
    let event;
    try { event = JSON.parse(String(comment.content || '')); } catch { continue; }
    if (!event || event.schema !== schema) continue;
    const eventId = String(event.eventId || '').trim();
    if (!eventId || seenEventIds.has(eventId)) continue;
    seenEventIds.add(eventId);
    events.push({ ...event, _commentId: String(comment.id), _createdTime: String(comment.createdTime) });
  }
  return events;
}

function normalizePermissionRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const owner = String(raw.owner || '').trim();
  if (!owner || typeof raw.public !== 'boolean') return null;
  const normalized = { owner, public: raw.public };
  for (const key of ['uploadedBy', 'sourcePublicFileId']) {
    const value = String(raw[key] || '').trim();
    if (value) normalized[key] = value;
  }
  if (raw.publishedAt !== undefined && raw.publishedAt !== null && raw.publishedAt !== '') {
    normalized.publishedAt = structuredClone(raw.publishedAt);
  }
  return normalized;
}

export function normalizeSongPermissions(raw) {
  if (!raw || Number(raw.version) !== 1 || !raw.songs || typeof raw.songs !== 'object' || Array.isArray(raw.songs)) {
    return null;
  }
  const songs = {};
  for (const [fileId, rawPermission] of Object.entries(raw.songs)) {
    const id = String(fileId || '').trim();
    const permission = normalizePermissionRecord(rawPermission);
    if (id && permission) songs[id] = permission;
  }
  const normalized = { version: 1, songs };
  const eventCursor = normalizeEventCursor(raw.eventCursor);
  if (eventCursor) normalized.eventCursor = eventCursor;
  return normalized;
}

export function applyPermissionEvents(basePermissions, comments) {
  const normalized = normalizeSongPermissions(basePermissions);
  if (!normalized) throw new Error('INVALID_PERMISSIONS');
  const songs = structuredClone(normalized.songs);
  for (const event of parseSidecarEvents(comments, PERMISSION_EVENT_SCHEMA, normalized.eventCursor)) {
    const fileId = String(event.fileId || '').trim();
    if (!fileId) continue;
    if (event.op === 'delete') {
      delete songs[fileId];
      continue;
    }
    if (event.op !== 'upsert') continue;
    const permission = normalizePermissionRecord(event.permission);
    if (permission) songs[fileId] = permission;
  }
  return { version: 1, songs };
}

async function readPermissions() {
  const [raw, comments] = await Promise.all([
    readDriveJson(PERMISSIONS_FILE_ID, 'INVALID_PERMISSIONS'),
    listDriveComments(PERMISSIONS_FILE_ID)
  ]);
  const normalized = normalizeSongPermissions(raw);
  if (!normalized) throw new Error('INVALID_PERMISSIONS');
  return applyPermissionEvents(normalized, comments);
}

function permissionForFile(permissions, fileId) {
  return normalizePermissionRecord(permissions?.songs?.[String(fileId || '')]);
}

async function appendPermissionEvent(fileId, permission = null) {
  const id = String(fileId || '').trim();
  if (!id) throw new Error('PERMISSION_FILE_ID_REQUIRED');
  const event = {
    schema: PERMISSION_EVENT_SCHEMA,
    eventId: crypto.randomUUID(),
    op: permission ? 'upsert' : 'delete',
    fileId: id
  };
  if (permission) {
    const normalized = normalizePermissionRecord(permission);
    if (!normalized) throw new Error('INVALID_PERMISSION_RECORD');
    event.permission = normalized;
  }
  await appendDriveEvent(PERMISSIONS_FILE_ID, event);
  return permission ? normalizePermissionRecord(permission) : null;
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

function catalogMeta(song, file) {
  const enriched = ensureArrangementIdentity(song, { fileId: file.id });
  return {
    id: String(enriched.id || file.id),
    workId: enriched.workId,
    arrangementId: enriched.arrangementId,
    name: enriched.name || file.name.replace(/\.json$/i, ''),
    artist: String(enriched.artist || ''),
    album: String(enriched.album || ''),
    source: String(enriched.source || ''),
    playStyle: enriched.playStyle === 'chord' ? 'chord' : enriched.playStyle === 'fingerstyle' ? 'fingerstyle' : '',
    difficulty: Number.isFinite(Number(enriched.difficulty)) ? Math.min(5, Math.max(1, Math.round(Number(enriched.difficulty)))) : null,
    tempo: Number(enriched.tempo) || 120,
    capo: Number.isFinite(Number(enriched.capo)) ? Number(enriched.capo) : 0,
    beatsPerMeasure: Number(enriched.beatsPerMeasure) === 3 ? 3 : 4,
    _driveFileId: file.id,
    _driveFileName: file.name,
    _driveModifiedTime: file.modifiedTime || ''
  };
}

function sanitizeCatalogMetadata(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const metadata = structuredClone(raw);
  delete metadata.owner;
  delete metadata.uploadedBy;
  delete metadata.public;
  const fileId = String(metadata._driveFileId || '').trim();
  if (!fileId) return null;
  metadata._driveFileId = fileId;
  metadata._driveFileName = String(metadata._driveFileName || '');
  metadata._driveModifiedTime = String(metadata._driveModifiedTime || '');
  return metadata;
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
    difficulty: Number.isFinite(Number(input.difficulty)) ? Math.min(5, Math.max(1, Math.round(Number(input.difficulty)))) : undefined,
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

function songFileName(song) {
  const id = String(song?.id || `song-${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
  return `${id || 'song'}.json`;
}

async function entriesFromFolder(folderId, permissionsInput = null) {
  const [files, permissions] = await Promise.all([
    listJsonFiles(folderId),
    permissionsInput ? Promise.resolve(permissionsInput) : readPermissions()
  ]);
  const results = await settledMapWithConcurrency(files, DRIVE_READ_CONCURRENCY, async file => {
    const permission = permissionForFile(permissions, file.id);
    if (!permission) {
      console.warn('Skipping Drive song without centralized permission:', file.id, file.name);
      return null;
    }
    const song = authoritativeSong(await readDriveJson(file.id), file, permission);
    return isManagedSong(song, folderId) ? { file, folderId, song } : null;
  });
  const fatal = results.find(result =>
    result.status === 'rejected'
    && String(result.reason?.message || result.reason) !== 'INVALID_SONG_JSON'
  );
  if (fatal) throw fatal.reason;
  results.forEach((result, index) => {
    if (result.status === 'rejected') console.warn('Skipping invalid Drive song JSON:', files[index]?.id, files[index]?.name);
  });
  return results
    .filter(result => result.status === 'fulfilled' && result.value)
    .map(result => result.value);
}

export function normalizeCatalogIndex(raw) {
  if (!raw || Number(raw.version) !== 1 || !Array.isArray(raw.songs)) return null;
  const songs = raw.songs.map(sanitizeCatalogMetadata).filter(Boolean);
  const normalized = { version: 1, songs };
  const eventCursor = normalizeEventCursor(raw.eventCursor);
  if (eventCursor) normalized.eventCursor = eventCursor;
  return normalized;
}

export function applyCatalogEvents(baseIndex, comments) {
  const normalized = normalizeCatalogIndex(baseIndex);
  if (!normalized) throw new Error('INVALID_CATALOG_INDEX');
  const byFileId = new Map(normalized.songs.map(item => [String(item._driveFileId), item]));
  for (const event of parseSidecarEvents(comments, CATALOG_EVENT_SCHEMA, normalized.eventCursor)) {
    const fileId = String(event.fileId || '').trim();
    if (!fileId) continue;
    if (event.op === 'delete') {
      byFileId.delete(fileId);
      continue;
    }
    if (event.op !== 'upsert') continue;
    const metadata = sanitizeCatalogMetadata(event.metadata);
    if (!metadata || metadata._driveFileId !== fileId) continue;
    const existing = byFileId.get(fileId);
    const existingTime = String(existing?._driveModifiedTime || '');
    const nextTime = String(metadata._driveModifiedTime || '');
    if (!existing || !existingTime || !nextTime || nextTime >= existingTime) byFileId.set(fileId, metadata);
  }
  return { version: 1, songs: [...byFileId.values()] };
}

function catalogIndexFileId(folderId) {
  if (folderId === PUBLIC_FOLDER_ID) return PUBLIC_INDEX_FILE_ID;
  if (folderId === TEST_FOLDER_ID) return TEST_INDEX_FILE_ID;
  throw new Error('CATALOG_FOLDER_NOT_MANAGED');
}

async function rebuildCatalogIndex(folderId) {
  const indexFileId = catalogIndexFileId(folderId);
  const [permissions, comments] = await Promise.all([
    readPermissions(),
    listDriveComments(indexFileId)
  ]);
  const entries = await entriesFromFolder(folderId, permissions);
  const eventCursor = latestEventCursor(comments);
  const index = {
    version: 1,
    ...(eventCursor ? { eventCursor } : {}),
    songs: entries.map(entry => catalogMeta(entry.song, entry.file))
  };
  await writeNamedJsonFile(folderId, INDEX_FILE_NAME, index, { id: indexFileId });
  return readCatalogIndex(folderId);
}

async function readCatalogIndex(folderId) {
  const indexFileId = catalogIndexFileId(folderId);
  try {
    const [raw, comments] = await Promise.all([
      readDriveJson(indexFileId, 'INVALID_CATALOG_INDEX'),
      listDriveComments(indexFileId)
    ]);
    const normalized = normalizeCatalogIndex(raw);
    if (normalized) return applyCatalogEvents(normalized, comments);
  } catch (error) {
    const message = String(error?.message || error);
    if (message !== 'INVALID_CATALOG_INDEX' && !message.startsWith('DRIVE_GET_404')) throw error;
  }
  return rebuildCatalogIndex(folderId);
}

async function appendCatalogEvent(folderId, metadata = null, fileIdInput = '') {
  const indexFileId = catalogIndexFileId(folderId);
  const metadataValue = metadata ? sanitizeCatalogMetadata(metadata) : null;
  const fileId = String(metadataValue?._driveFileId || fileIdInput || '').trim();
  if (!fileId) throw new Error('CATALOG_FILE_ID_REQUIRED');
  const event = {
    schema: CATALOG_EVENT_SCHEMA,
    eventId: crypto.randomUUID(),
    op: metadataValue ? 'upsert' : 'delete',
    fileId
  };
  if (metadataValue) event.metadata = metadataValue;
  await appendDriveEvent(indexFileId, event);
}

async function readArtistMedia() {
  const file = await findNamedJsonFile(PUBLIC_FOLDER_ID, ARTIST_MEDIA_FILE_NAME);
  if (!file) return normalizeArtistMedia({ version: 2, artists: {} });
  return normalizeArtistMedia(await readDriveJson(file.id, 'INVALID_ARTIST_MEDIA'));
}

async function createJsonFile(folderId, song, meta) {
  const persisted = cleanSongForWrite(song);
  const permission = normalizePermissionRecord(meta);
  if (!permission) throw new Error('INVALID_PERMISSION_RECORD');
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
  let permissionApplied = false;
  try {
    await appendPermissionEvent(file.id, permission);
    permissionApplied = true;
    await appendCatalogEvent(folderId, catalogMeta(persisted, file));
  } catch (error) {
    if (permissionApplied) await appendPermissionEvent(file.id, null).catch(() => null);
    await driveFetch(`/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' }).catch(() => null);
    throw error;
  }
  return attachFileMeta(authoritativeSong(persisted, file, permission), file);
}

async function updateJsonFile(fileId, song, folderId, permission) {
  const persisted = cleanSongForWrite(song);
  const response = await driveFetch(`/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,modifiedTime`, {
    method: 'PATCH',
    upload: true,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(persisted, null, 2)
  });
  const file = await response.json();
  await appendCatalogEvent(folderId, catalogMeta(persisted, file));
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
  const [publicIndex, testIndex, media, permissions] = await Promise.all([
    readCatalogIndex(PUBLIC_FOLDER_ID),
    readCatalogIndex(TEST_FOLDER_ID),
    readArtistMedia(),
    readPermissions()
  ]);
  const songs = [...publicIndex.songs, ...testIndex.songs]
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

function permissionMeta(existingSong, patch = {}) {
  const owner = songOwner(existingSong);
  if (!owner) throw new Error('OWNER_REQUIRED');
  const existing = normalizePermissionRecord(existingSong?._opentab);
  if (!existing) throw new Error('INVALID_PERMISSION_RECORD');
  const meta = { ...existing, ...patch, owner };
  if (meta.public === true || meta.publishedAt) meta.uploadedBy = owner;
  return normalizePermissionRecord(meta);
}

async function saveUserSong(session, song) {
  const fileId = String(song?._driveFileId || '').trim();
  if (!fileId) {
    const owner = session.username;
    const isAdmin = session.role === 'admin';
    const meta = {
      owner,
      public: isAdmin,
      ...(isAdmin ? { uploadedBy: owner, publishedAt: Date.now() } : {})
    };
    const folderId = isAdmin ? PUBLIC_FOLDER_ID : TEST_FOLDER_ID;
    return createJsonFile(folderId, song, meta);
  }

  const entry = await readManagedEntry(fileId);
  if (!canEditSong(session, entry.song)) throw new Error('EDIT_FORBIDDEN');
  const permission = normalizePermissionRecord(entry.song?._opentab);
  return updateJsonFile(fileId, song, entry.folderId, permission);
}

async function publishSong(session, song) {
  const artist = String(song?.artist || '').trim();
  if (!artist) throw new Error('ARTIST_REQUIRED');
  const fileId = String(song?._driveFileId || '').trim();
  if (!fileId) throw new Error('SAVE_BEFORE_PUBLISH');
  const entry = await readManagedEntry(fileId);
  if (!canEditSong(session, entry.song)) throw new Error('EDIT_FORBIDDEN');
  const meta = permissionMeta(entry.song, {
    public: true,
    publishedAt: entry.song?._opentab?.publishedAt || Date.now()
  });
  const saved = await updateJsonFile(fileId, { ...song, artist }, entry.folderId, entry.song?._opentab);
  await appendPermissionEvent(fileId, meta);
  return authoritativeSong(saved, entry.file, meta);
}

async function setPublicState(session, fileId, isPublic) {
  const entry = await readManagedEntry(fileId);
  if (!canUnlistSong(session, entry.song)) throw new Error('VISIBILITY_FORBIDDEN');
  const patch = { public: Boolean(isPublic) };
  if (patch.public) patch.publishedAt = entry.song?._opentab?.publishedAt || Date.now();
  const meta = permissionMeta(entry.song, patch);
  await appendPermissionEvent(fileId, meta);
  return attachFileMeta(authoritativeSong(entry.song, entry.file, meta), entry.file);
}

async function deleteUserSong(session, fileId) {
  const entry = await readManagedEntry(fileId);
  if (!canDeleteSong(session, entry.song)) throw new Error('DELETE_FORBIDDEN');
  const previousPermission = normalizePermissionRecord(entry.song?._opentab);
  await appendPermissionEvent(fileId, null);
  try {
    await driveFetch(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
  } catch (error) {
    if (previousPermission) await appendPermissionEvent(fileId, previousPermission).catch(() => null);
    throw error;
  }
  await appendCatalogEvent(entry.folderId, null, fileId);
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
  const meta = {
    owner: session.username,
    public: false,
    sourcePublicFileId: fileId
  };
  return createJsonFile(TEST_FOLDER_ID, copy, meta);
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
      return json(res, 200, { song: enrichSongMedia(attachFileMeta(entry.song, entry.file), media) });
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
    const badRequest = message.includes('_REQUIRED') || message.includes('INVALID_') || message === 'V3_DOCUMENT_REQUIRED';
    const status = forbidden ? 403 : notFound ? 404 : badRequest ? 400 : message === 'ADMIN_LIBRARY_IS_PUBLIC_LIBRARY' ? 409 : 500;
    if (status >= 500) console.error(error);
    return json(res, status, { error: message.split(':')[0] });
  }
}
