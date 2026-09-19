import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const STATIC_CATALOG = new Map(
  JSON.parse(readFileSync(new URL('../public/catalog/index.json', import.meta.url), 'utf8'))
    .map(song => [String(song.id), song])
);

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
    username: 'admin',
    role: 'admin',
    passwordHash: process.env.ADMIN_PASSWORD_HASH,
    password: process.env.ADMIN_PASSWORD
  };
  if (username === 'test') return {
    username: 'test',
    role: 'test',
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
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
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

async function assertFileInFolder(fileId, folderId) {
  const file = await fileMetadata(fileId);
  if (file.trashed || file.mimeType !== 'application/json' || !Array.isArray(file.parents) || !file.parents.includes(folderId)) {
    throw new Error('FILE_OUTSIDE_LIBRARY');
  }
  return file;
}

async function readDriveJson(fileId) {
  const response = await driveFetch(`/files/${encodeURIComponent(fileId)}?alt=media`);
  const text = (await response.text()).replace(/^\uFEFF/, '');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_SONG_JSON');
  return value;
}

function sanitizedSongForDrive(song, opentabPatch = {}) {
  const source = song && typeof song === 'object' && !Array.isArray(song) ? structuredClone(song) : {};
  delete source._driveFileId;
  delete source._driveFileName;
  delete source._driveModifiedTime;
  source._opentab = { ...(source._opentab || {}), ...opentabPatch };
  return source;
}

function songFileName(song) {
  const id = String(song?.id || `song-${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
  return `${id || 'song'}.json`;
}

async function createJsonFile(folderId, song, opentabPatch = {}) {
  const persisted = sanitizedSongForDrive(song, opentabPatch);
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
  return { ...persisted, _driveFileId: file.id, _driveFileName: file.name, _driveModifiedTime: file.modifiedTime || '' };
}

async function updateJsonFile(fileId, song, opentabPatch = {}) {
  const persisted = sanitizedSongForDrive(song, opentabPatch);
  const response = await driveFetch(`/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,modifiedTime`, {
    method: 'PATCH',
    upload: true,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(persisted, null, 2)
  });
  const file = await response.json();
  return { ...persisted, _driveFileId: file.id, _driveFileName: file.name, _driveModifiedTime: file.modifiedTime || '' };
}

async function deleteDriveFile(fileId) {
  await driveFetch(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
}

function isManagedPublic(file, song) {
  return LEGACY_PUBLIC_FILE_IDS.has(file.id) || song?._opentab?.public === true;
}

function isHidden(song) {
  return song?._opentab?.hidden === true;
}

function attachFileMeta(song, file) {
  return {
    ...song,
    _driveFileId: file.id,
    _driveFileName: file.name,
    _driveModifiedTime: file.modifiedTime || ''
  };
}

function withStaticCatalogMetadata(song) {
  const fallback = STATIC_CATALOG.get(String(song?.id || '')) || {};
  return {
    ...song,
    artist: song?.artist || fallback.artist || '',
    album: song?.album || fallback.album || '',
    cover: song?.cover || fallback.cover || ''
  };
}

function catalogMeta(song, file) {
  const enriched = withStaticCatalogMetadata(song);
  return {
    id: String(enriched.id || file.id),
    name: enriched.name || file.name.replace(/\.json$/i, ''),
    artist: enriched.artist,
    album: enriched.album,
    cover: enriched.cover,
    uploadedBy: enriched?._opentab?.uploadedBy || 'OpenGuitarTAB',
    tempo: Number(enriched.tempo) || 120,
    capo: Number.isFinite(Number(enriched.capo)) ? Number(enriched.capo) : 0,
    beatsPerMeasure: Number(enriched.beatsPerMeasure) === 3 ? 3 : 4,
    _driveFileId: file.id,
    _driveFileName: file.name,
    _driveModifiedTime: file.modifiedTime || ''
  };
}

async function managedPublicEntries({ includeHidden = false, full = false } = {}) {
  const files = await listJsonFiles(PUBLIC_FOLDER_ID);
  const results = await Promise.allSettled(files.map(async file => {
    const song = await readDriveJson(file.id);
    if (!isManagedPublic(file, song)) return null;
    if (!includeHidden && isHidden(song)) return null;
    return full ? attachFileMeta(withStaticCatalogMetadata(song), file) : catalogMeta(song, file);
  }));
  return results
    .filter(result => result.status === 'fulfilled' && result.value)
    .map(result => result.value)
    .sort((a, b) => String(b._driveModifiedTime || '').localeCompare(String(a._driveModifiedTime || '')));
}

async function userLibrary(session) {
  if (session.role === 'admin') return managedPublicEntries({ includeHidden: true, full: true });
  const files = await listJsonFiles(TEST_FOLDER_ID);
  const results = await Promise.allSettled(files.map(async file => attachFileMeta(await readDriveJson(file.id), file)));
  return results
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value)
    .sort((a, b) => String(b._driveModifiedTime || '').localeCompare(String(a._driveModifiedTime || '')));
}

async function saveUserSong(session, song) {
  const folderId = session.role === 'admin' ? PUBLIC_FOLDER_ID : TEST_FOLDER_ID;
  const fileId = String(song?._driveFileId || '').trim();
  const patch = session.role === 'admin'
    ? { public: true, hidden: song?._opentab?.hidden === true }
    : { owner: 'test' };
  if (fileId) {
    await assertFileInFolder(fileId, folderId);
    return updateJsonFile(fileId, song, patch);
  }
  return createJsonFile(folderId, song, patch);
}

async function publishSong(session, song) {
  const artist = String(song?.artist || '').trim();
  if (!artist) throw new Error('ARTIST_REQUIRED');
  const publishableSong = { ...song, artist };
  if (session.role === 'admin') {
    const fileId = String(publishableSong?._driveFileId || '').trim();
    const patch = {
      public: true,
      hidden: publishableSong?._opentab?.hidden === true,
      uploadedBy: session.username
    };
    if (fileId) {
      await assertFileInFolder(fileId, PUBLIC_FOLDER_ID);
      return updateJsonFile(fileId, publishableSong, patch);
    }
    return createJsonFile(PUBLIC_FOLDER_ID, publishableSong, patch);
  }
  const privateFileId = String(publishableSong?._driveFileId || '').trim();
  if (!privateFileId) throw new Error('SAVE_BEFORE_PUBLISH');
  await assertFileInFolder(privateFileId, TEST_FOLDER_ID);

  let publicFileId = String(song?._opentab?.publicFileId || '').trim();
  let published;
  if (publicFileId) {
    try {
      await assertFileInFolder(publicFileId, PUBLIC_FOLDER_ID);
      const existing = await readDriveJson(publicFileId);
      const linked = existing?._opentab?.sourceUser === session.username && existing?._opentab?.sourceFileId === privateFileId;
      if (!linked) publicFileId = '';
    } catch {
      publicFileId = '';
    }
  }

  const publicPatch = { public: true, hidden: false, sourceUser: session.username, sourceFileId: privateFileId, uploadedBy: session.username };
  if (publicFileId) published = await updateJsonFile(publicFileId, publishableSong, publicPatch);
  else published = await createJsonFile(PUBLIC_FOLDER_ID, publishableSong, publicPatch);

  const privatePatch = { owner: 'test', publicFileId: published._driveFileId };
  const updatedPrivate = await updateJsonFile(privateFileId, publishableSong, privatePatch);
  return { privateSong: updatedPrivate, publicFileId: published._driveFileId };
}

async function clonePublicToTest(fileId) {
  const file = await assertFileInFolder(fileId, PUBLIC_FOLDER_ID);
  const source = withStaticCatalogMetadata(await readDriveJson(fileId));
  if (!isManagedPublic(file, source) || isHidden(source)) throw new Error('PUBLIC_SONG_NOT_AVAILABLE');
  const copy = structuredClone(source);
  delete copy._driveFileId;
  delete copy._driveFileName;
  copy.id = `song-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  copy._opentab = { owner: 'test', sourcePublicFileId: fileId };
  return createJsonFile(TEST_FOLDER_ID, copy, { owner: 'test', sourcePublicFileId: fileId });
}

async function setHidden(fileId, hidden) {
  const file = await assertFileInFolder(fileId, PUBLIC_FOLDER_ID);
  const song = await readDriveJson(fileId);
  if (!isManagedPublic(file, song)) throw new Error('PUBLIC_SONG_NOT_MANAGED');
  return updateJsonFile(fileId, song, { public: true, hidden: Boolean(hidden) });
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
      const file = await assertFileInFolder(fileId, PUBLIC_FOLDER_ID);
      const song = await readDriveJson(fileId);
      if (!isManagedPublic(file, song) || isHidden(song)) return json(res, 404, { error: 'PUBLIC_SONG_NOT_AVAILABLE' });
      return json(res, 200, { song: attachFileMeta(withStaticCatalogMetadata(song), file) });
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
      const folderId = session.role === 'admin' ? PUBLIC_FOLDER_ID : TEST_FOLDER_ID;
      await assertFileInFolder(body.fileId, folderId);
      await deleteDriveFile(body.fileId);
      return json(res, 200, { ok: true });
    }

    if (action === 'hide' && req.method === 'POST') {
      if (session.role !== 'admin') return json(res, 403, { error: 'ADMIN_REQUIRED' });
      const body = await readBody(req);
      return json(res, 200, { song: await setHidden(body.fileId, body.hidden) });
    }

    if (action === 'publish' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await publishSong(session, body.song);
      return json(res, 200, session.role === 'admin' ? { song: result } : result);
    }

    if (action === 'clone' && req.method === 'POST') {
      if (session.role === 'admin') return json(res, 409, { error: 'ADMIN_LIBRARY_IS_PUBLIC_LIBRARY' });
      const body = await readBody(req);
      return json(res, 200, { song: await clonePublicToTest(body.fileId) });
    }

    return json(res, 404, { error: 'NOT_FOUND' });
  } catch (error) {
    const message = String(error?.message || error || 'UNKNOWN_ERROR');
    const status = message.includes('OUTSIDE_LIBRARY') ? 403 : message.includes('NOT_AVAILABLE') ? 404 : message.includes('_REQUIRED') ? 400 : 500;
    if (status >= 500) console.error(error);
    return json(res, status, { error: message.split(':')[0] });
  }
}
