const RESERVED_JSON_NAMES = new Set(['index.json', 'artists.json']);
const DEFAULT_CONCURRENCY = 5;

function required(value, name) {
  const clean = String(value || '').trim();
  if (!clean) throw new Error(`${name}_REQUIRED`);
  return clean;
}

async function getDriveAccessToken({ clientId, clientSecret, refreshToken }) {
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
  return payload.access_token;
}

function driveClient(accessToken) {
  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers || {})
      }
    });
    if (response.ok) return response;
    const detail = await response.text().catch(() => '');
    throw new Error(`DRIVE_${options.method || 'GET'}_${response.status}:${detail.slice(0, 240)}`);
  }

  return {
    async listSongJsonFiles(folderId) {
      const files = [];
      let pageToken = '';
      do {
        const params = new URLSearchParams({
          q: `'${folderId}' in parents and trashed = false and mimeType = 'application/json'`,
          fields: 'nextPageToken,files(id,name)',
          orderBy: 'modifiedTime desc',
          pageSize: '1000'
        });
        if (pageToken) params.set('pageToken', pageToken);
        const payload = await (await request(`https://www.googleapis.com/drive/v3/files?${params}`)).json();
        files.push(...(payload.files || []));
        pageToken = payload.nextPageToken || '';
      } while (pageToken);
      return files.filter(file => !RESERVED_JSON_NAMES.has(file.name));
    },

    async readJson(fileId) {
      return (await request(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`
      )).json();
    },

    async replaceJson(fileId, value) {
      const params = new URLSearchParams({ uploadType: 'media', fields: 'id,name,modifiedTime' });
      return (await request(
        `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?${params}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: `${JSON.stringify(value, null, 2)}\n`
        }
      )).json();
    }
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) },
    () => run()
  ));
  return results;
}

function backfillSongIdentity(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { song: raw, changed: false, unresolved: true };
  }

  const song = structuredClone(raw);
  let changed = false;
  const name = String(song.name || '').trim();
  const legacyTitle = String(song.title || '').trim();

  if (!name && legacyTitle) {
    song.name = legacyTitle;
    changed = true;
  }

  const resolvedName = String(song.name || '').trim();
  if (!String(song.arrangementName || '').trim() && resolvedName) {
    song.arrangementName = resolvedName;
    changed = true;
  }

  return {
    song,
    changed,
    unresolved: !String(song.name || '').trim() || !String(song.arrangementName || '').trim()
  };
}

export async function backfillDriveArrangementNames({
  folderId = process.env.PUBLIC_DRIVE_FOLDER_ID,
  clientId = process.env.GOOGLE_CLIENT_ID,
  clientSecret = process.env.GOOGLE_CLIENT_SECRET,
  refreshToken = process.env.GOOGLE_REFRESH_TOKEN,
  concurrency = DEFAULT_CONCURRENCY
} = {}) {
  const config = {
    folderId: required(folderId, 'PUBLIC_DRIVE_FOLDER_ID'),
    clientId: required(clientId, 'GOOGLE_CLIENT_ID'),
    clientSecret: required(clientSecret, 'GOOGLE_CLIENT_SECRET'),
    refreshToken: required(refreshToken, 'GOOGLE_REFRESH_TOKEN')
  };
  const accessToken = await getDriveAccessToken(config);
  const drive = driveClient(accessToken);
  const files = await drive.listSongJsonFiles(config.folderId);

  const results = await mapWithConcurrency(files, concurrency, async file => {
    const raw = await drive.readJson(file.id);
    const normalized = backfillSongIdentity(raw);
    if (normalized.unresolved) return { file, state: 'unresolved' };
    if (!normalized.changed) return { file, state: 'unchanged' };
    await drive.replaceJson(file.id, normalized.song);
    return { file, state: 'updated' };
  });

  const summary = {
    total: files.length,
    updated: [],
    unchanged: [],
    unresolved: [],
    errors: []
  };

  results.forEach((result, index) => {
    const file = files[index];
    if (result.status === 'rejected') {
      summary.errors.push({
        id: file?.id || '',
        name: file?.name || '',
        error: String(result.reason?.message || result.reason || 'UNKNOWN_ERROR')
      });
      return;
    }
    const state = result.value?.state;
    const target = state === 'updated'
      ? summary.updated
      : state === 'unresolved'
        ? summary.unresolved
        : summary.unchanged;
    target.push({ id: file.id, name: file.name });
  });

  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const summary = await backfillDriveArrangementNames();
  console.log(JSON.stringify(summary, null, 2));
  if (summary.unresolved.length || summary.errors.length) process.exitCode = 1;
}
