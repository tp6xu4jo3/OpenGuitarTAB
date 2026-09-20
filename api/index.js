import crypto from 'node:crypto';
import {
  songOwner,
  songWasPublished,
  songIsPublic,
  canEditSong,
  canUnlistSong,
  canDeleteSong
} from '../src/core/song-permissions.js';


const PUBLIC_FOLDER_ID = process.env.PUBLIC_DRIVE_FOLDER_ID || '1_SZt4WOMakWa3aD54W2tYHtdOk44WUUP';
const TEST_FOLDER_ID = process.env.TEST_DRIVE_FOLDER_ID || '1k11xZcK1irQ5fNtitcLHCq5sgAZoDW0g';
const SESSION_COOKIE = 'opentab_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const LEGACY_PUBLIC_FILE_IDS = new Set([
  '1AptDYqj0eRlNfJMoCNC1S8w0aeRtg_YQ',
  '1fa3wj6LUS6eYVuRd2blabOwDtGp0Oo4o',
  '1QpF3mzrPK7_m4OQqTY1olbig_4K1a2Bm',
  '1Cl74m-kBUkvnAypa1bKMmCvC5YRuAPSj',
  '17rR9Swj8HW5E8MIRnWISyMI1eBBzwHqz',
  '1gelZK32Fuv0NlrBcqQJw46MKl116FI7M',
  '1w_KeZDd6x29ZVtL39Bj_oH_KL4uXcZER',
  '1htz7NXkFB_nnJRa4_5f03UkxmWWFfEsX',
  '14F27Z3kpMXcQOdAbnB4_yq0pntKVSxXD',
  '1TpAIiVECHOcNrq9efq1J-REdsnjEn1IQ',
  '1b37F5O_LceufBt8K7Ld6MBoVg5D-UkJp',
  '10D4jBuaMMppX9E_DNVPyNx_UwTo1gOL6',
  '1nZVTVOyHFNMZRP9WHIZuUEBegctXcibo',
  '1TGcK8lJIs6kghCGITjXboxtXOLTpHfI4',
  '13pRbD-Wu5fjuMAyUcqQ4NhLhHNWNUKcY',
  '1-OPPY3PvQQ9ksvRyXsR1FvyjeU9vBVyS'
]);

let driveTokenCache = null;

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
  return files.filter(file => file.name !== 'index.json');
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
  if (file.trashed || file.mimeType !== 'application/json' || !folderId) throw new Error('FILE_OUTSIDE_LIBRARY');
  return { file, folderId };
}

async function readDriveJson(fileId) {
  const response = await driveFetch(`/files/${encodeURIComponent(fileId)}?alt=media`);
  const text = (await response.text()).replace(/^\uFEFF/, '');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_SONG_JSON');
  return value;
}

function legacyAdminFile(file, folderId) {
  return folderId === PUBLIC_FOLDER_ID && LEGACY_PUBLIC_FILE_IDS.has(file.id);
}

function authoritativeSong(song, file, folderId) {
  const source = song && typeof song === 'object' && !Array.isArray(song) ? structuredClone(song) : {};
  const legacy = legacyAdminFile(file, folderId);
  const fallbackOwner = folderId === TEST_FOLDER_ID ? 'test' : (legacy ? 'admin' : '');
  const owner = songOwner(source, fallbackOwner);
  const existing = source._opentab && typeof source._opentab === 'object' ? source._opentab : {};
  const publicState = typeof existing.public === 'boolean'
    ? existing.public
    : legacy ? existing.hidden !== true : false;
  const meta = {
    ...existing,
    ...(owner ? { owner } : {}),
    public: publicState
  };
  if (owner && (publicState || existing.publishedAt || legacy)) meta.uploadedBy = owner;
  if (!meta.publishedAt && legacy) meta.publishedAt = file.modifiedTime || 'legacy';
  delete meta.hidden;
  delete meta.publicFileId;
  delete meta.sourceUser;
  delete meta.sourceFileId;
  source._opentab = meta;
  return source;
}

function isManagedSong(song, file, folderId) {
  if (legacyAdminFile(file, folderId)) return true;
  const owner = songOwner(song);
  if (!owner) return false;
  if (folderId === TEST_FOLDER_ID) return owner === 'test';
  return owner === 'admin' || songWasPublished(song);
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
  const enriched = song || {};
  const owner = songOwner(enriched);
  return {
    id: String(enriched.id || file.id),
    name: enriched.name || file.name.replace(/\.json$/i, ''),
    artist: enriched.artist,
    album: enriched.album,
    cover: enriched.cover,
    owner,
    uploadedBy: owner || 'OpenGuitarTAB',
    public: songIsPublic(enriched),
    tempo: Number(enriched.tempo) || 120,
    capo: Number.isFinite(Number(enriched.capo)) ? Number(enriched.capo) : 0,
    beatsPerMeasure: Number(enriched.beatsPerMeasure) === 3 ? 3 : 4,
    _driveFileId: file.id,
    _driveFileName: file.name,
    _driveModifiedTime: file.modifiedTime || ''
  };
}

function cleanSongForWrite(song, meta) {
  const source = song && typeof song === 'object' && !Array.isArray(song) ? structuredClone(song) : {};
  delete source._driveFileId;
  delete source._driveFileName;
  delete source._driveModifiedTime;
  source._opentab = { ...meta };
  delete source._opentab.hidden;
  delete source._opentab.publicFileId;
  delete source._opentab.sourceUser;
  delete source._opentab.sourceFileId;
  return source;
}

function songFileName(song) {
  const id = String(song?.id || `song-${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
  return `${id || 'song'}.json`;
}

async function createJsonFile(folderId, song, meta) {
  const persisted = cleanSongForWrite(song, meta);
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
  return attachFileMeta(persisted, file);
}

async function updateJsonFile(fileId, song, meta) {
  const persisted = cleanSongForWrite(song, meta);
  const response = await driveFetch(`/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,modifiedTime`, {
    method: 'PATCH',
    upload: true,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(persisted, null, 2)
  });
  const file = await response.json();
  return attachFileMeta(persisted, file);
}

async function deleteDriveFile(fileId) {
  await driveFetch(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
}

async function readManagedEntry(fileId) {
  const { file, folderId } = await assertManagedFile(fileId);
  const raw = await readDriveJson(fileId);
  const song = authoritativeSong(raw, file, folderId);
  if (!isManagedSong(song, file, folderId)) throw new Error('PUBLIC_SONG_NOT_MANAGED');
  return { file, folderId, song };
}

async function entriesFromFolder(folderId) {
  const files = await listJsonFiles(folderId);
  const results = await Promise.allSettled(files.map(async file => {
    const song = authoritativeSong(await readDriveJson(file.id), file, folderId);
    return isManagedSong(song, file, folderId) ? { file, folderId, song } : null;
  }));
  return results
    .filter(result => result.status === 'fulfilled' && result.value)
    .map(result => result.value);
}

async function managedPublicEntries({ full = false } = {}) {
  const [publicEntries, testEntries] = await Promise.all([
    entriesFromFolder(PUBLIC_FOLDER_ID),
    entriesFromFolder(TEST_FOLDER_ID)
  ]);
  return [...publicEntries, ...testEntries]
    .filter(entry => songIsPublic(entry.song))
    .map(entry => full
      ? attachFileMeta(entry.song, entry.file)
      : catalogMeta(entry.song, entry.file))
    .sort((a, b) => String(b._driveModifiedTime || '').localeCompare(String(a._driveModifiedTime || '')));
}

async function userLibrary(session) {
  if (session.role === 'admin') {
    const [publicEntries, testEntries] = await Promise.all([
      entriesFromFolder(PUBLIC_FOLDER_ID),
      entriesFromFolder(TEST_FOLDER_ID)
    ]);
    return [...publicEntries, ...testEntries.filter(entry => songWasPublished(entry.song))]
      .map(entry => attachFileMeta(entry.song, entry.file))
      .sort((a, b) => String(b._driveModifiedTime || '').localeCompare(String(a._driveModifiedTime || '')));
  }
  const testEntries = await entriesFromFolder(TEST_FOLDER_ID);
  return testEntries
    .filter(entry => songOwner(entry.song) === session.username)
    .map(entry => attachFileMeta(entry.song, entry.file))
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
  delete meta.hidden;
  delete meta.publicFileId;
  delete meta.sourceUser;
  delete meta.sourceFileId;
  return meta;
}

async function saveUserSong(session, song) {
  const fileId = String(song?._driveFileId || '').trim();
  if (!fileId) {
    const owner = session.username;
    const isAdmin = session.role === 'admin';
    const meta = {
      owner,
      public: isAdmin,
      updatedBy: session.username,
      ...(isAdmin ? { uploadedBy: owner, publishedAt: Date.now() } : {})
    };
    const folderId = isAdmin ? PUBLIC_FOLDER_ID : TEST_FOLDER_ID;
    return createJsonFile(folderId, song, meta);
  }

  const entry = await readManagedEntry(fileId);
  if (!canEditSong(session, entry.song)) throw new Error('EDIT_FORBIDDEN');
  const meta = writeMeta(entry.song, session, { public: songIsPublic(entry.song) });
  return updateJsonFile(fileId, song, meta);
}

async function publishSong(session, song) {
  const artist = String(song?.artist || '').trim();
  if (!artist) throw new Error('ARTIST_REQUIRED');
  const fileId = String(song?._driveFileId || '').trim();
  if (!fileId) throw new Error('SAVE_BEFORE_PUBLISH');
  const entry = await readManagedEntry(fileId);
  if (!canEditSong(session, entry.song)) throw new Error('EDIT_FORBIDDEN');
  const meta = writeMeta(entry.song, session, {
    public: true,
    publishedAt: entry.song?._opentab?.publishedAt || Date.now()
  });
  return updateJsonFile(fileId, { ...song, artist }, meta);
}

async function setPublicState(session, fileId, isPublic) {
  const entry = await readManagedEntry(fileId);
  if (!canUnlistSong(session, entry.song)) throw new Error('VISIBILITY_FORBIDDEN');
  const patch = { public: Boolean(isPublic) };
  if (patch.public) patch.publishedAt = entry.song?._opentab?.publishedAt || Date.now();
  const meta = writeMeta(entry.song, session, patch);
  return updateJsonFile(fileId, entry.song, meta);
}

async function deleteUserSong(session, fileId) {
  const entry = await readManagedEntry(fileId);
  if (!canDeleteSong(session, entry.song)) throw new Error('DELETE_FORBIDDEN');
  await deleteDriveFile(fileId);
}

async function clonePublicToTest(fileId, session) {
  if (session.role === 'admin') throw new Error('ADMIN_LIBRARY_IS_PUBLIC_LIBRARY');
  const entry = await readManagedEntry(fileId);
  if (!songIsPublic(entry.song)) throw new Error('PUBLIC_SONG_NOT_AVAILABLE');
  const copy = structuredClone(entry.song);
  delete copy._driveFileId;
  delete copy._driveFileName;
  delete copy._driveModifiedTime;
  copy.id = `song-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  const meta = {
    owner: session.username,
    public: false,
    updatedBy: session.username,
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
      return json(res, 200, { songs: await managedPublicEntries() });
    }

    if (action === 'catalog-song' && req.method === 'GET') {
      const fileId = requestUrl.searchParams.get('fileId');
      if (!fileId) return json(res, 400, { error: 'FILE_ID_REQUIRED' });
      const entry = await readManagedEntry(fileId);
      if (!songIsPublic(entry.song)) return json(res, 404, { error: 'PUBLIC_SONG_NOT_AVAILABLE' });
      return json(res, 200, { song: attachFileMeta(entry.song, entry.file) });
    }

    const session = requireSession(req, res);
    if (!session) return;

    if (action === 'library' && req.method === 'GET') {
      return json(res, 200, { songs: await userLibrary(session) });
    }

    if (action === 'save' && req.method === 'POST') {
      const body = await readBody(req);
      return json(res, 200, { song: await saveUserSong(session, body.song) });
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
      return json(res, 200, { song: await setPublicState(session, body.fileId, body.public) });
    }

    if (action === 'hide' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.fileId) return json(res, 400, { error: 'FILE_ID_REQUIRED' });
      return json(res, 200, { song: await setPublicState(session, body.fileId, !body.hidden) });
    }

    if (action === 'publish' && req.method === 'POST') {
      const body = await readBody(req);
      return json(res, 200, { song: await publishSong(session, body.song) });
    }

    if (action === 'clone' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.fileId) return json(res, 400, { error: 'FILE_ID_REQUIRED' });
      return json(res, 200, { song: await clonePublicToTest(body.fileId, session) });
    }

    return json(res, 404, { error: 'NOT_FOUND' });
  } catch (error) {
    const message = String(error?.message || error || 'UNKNOWN_ERROR');
    const forbidden = message.includes('_FORBIDDEN') || message.includes('OUTSIDE_LIBRARY');
    const notFound = message.includes('NOT_AVAILABLE') || message.includes('NOT_MANAGED');
    const badRequest = message.includes('_REQUIRED') || message.includes('INVALID_');
    const status = forbidden ? 403 : notFound ? 404 : badRequest ? 400 : message === 'ADMIN_LIBRARY_IS_PUBLIC_LIBRARY' ? 409 : 500;
    if (status >= 500) console.error(error);
    return json(res, status, { error: message.split(':')[0] });
  }
}
