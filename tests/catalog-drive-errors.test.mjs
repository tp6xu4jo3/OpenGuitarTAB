import assert from 'node:assert/strict';

process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh';

const { default: handler } = await import('../api/index.js');

const PUBLIC_FOLDER_ID = '1_SZt4WOMakWa3aD54W2tYHtdOk44WUUP';
const TEST_FOLDER_ID = '1k11xZcK1irQ5fNtitcLHCq5sgAZoDW0g';

function mockResponse(body, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return JSON.parse(text); },
    async text() { return text; }
  };
}

function createHttpResponse() {
  return {
    statusCode: 0,
    body: '',
    headers: new Map(),
    setHeader(name, value) { this.headers.set(String(name).toLowerCase(), value); },
    end(value = '') { this.body = String(value); }
  };
}

async function invoke(url) {
  const res = createHttpResponse();
  await handler({
    url,
    method: 'GET',
    headers: { host: 'localhost' }
  }, res);
  return {
    status: res.statusCode,
    body: res.body ? JSON.parse(res.body) : {}
  };
}

async function invokeCatalog() {
  return invoke('/api?action=catalog');
}

async function invokeCatalogSong(fileId) {
  return invoke(`/api?action=catalog-song&fileId=${encodeURIComponent(fileId)}`);
}

function song(id, name) {
  return {
    id,
    name,
    tempo: 80,
    capo: 0,
    beatsPerMeasure: 4,
    artist: 'Test Artist',
    album: 'Test Album',
    _opentab: { owner: 'attacker', public: true, uploadedBy: 'attacker' }
  };
}

function permissions(secondPublic = true) {
  return {
    version: 1,
    songs: {
      'song-good': { owner: 'admin', public: true, uploadedBy: 'admin' },
      'song-second': { owner: 'admin', public: secondPublic, uploadedBy: 'admin' }
    }
  };
}

function installDriveMock({ failSecondSong = false, invalidSecondSong = false, secondPublic = true } = {}) {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();

    if (url.hostname === 'oauth2.googleapis.com') {
      return mockResponse({ access_token: 'drive-token', expires_in: 3600 });
    }

    if (url.hostname !== 'www.googleapis.com') {
      throw new Error(`Unexpected host: ${url.hostname}`);
    }

    const q = url.searchParams.get('q') || '';
    const isPublicQuery = q.includes(`'${PUBLIC_FOLDER_ID}' in parents`);
    const isTestQuery = q.includes(`'${TEST_FOLDER_ID}' in parents`);

    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      if (isPublicQuery && q.includes("name = 'index.json'")) {
        return mockResponse({ files: [] });
      }
      if (isPublicQuery && q.includes("name = 'artists.json'")) {
        return mockResponse({ files: [] });
      }
      if (isPublicQuery && q.includes("name = 'permissions.json'")) {
        return mockResponse({
          files: [{ id: 'permissions-file', name: 'permissions.json', modifiedTime: '2026-09-30T00:00:00.000Z' }]
        });
      }
      if (isTestQuery && q.includes("name = 'index.json'")) {
        return mockResponse({
          files: [{ id: 'test-index', name: 'index.json', modifiedTime: '2026-09-30T00:00:00.000Z' }]
        });
      }
      if (isPublicQuery) {
        return mockResponse({
          files: [
            { id: 'song-good', name: 'song-good.json', modifiedTime: '2026-09-30T00:00:01.000Z' },
            { id: 'song-second', name: 'song-second.json', modifiedTime: '2026-09-30T00:00:02.000Z' }
          ]
        });
      }
    }

    if (url.pathname === '/drive/v3/files/permissions-file' && url.searchParams.get('alt') === 'media') {
      return mockResponse(permissions(secondPublic));
    }

    if (url.pathname === '/drive/v3/files/test-index' && url.searchParams.get('alt') === 'media') {
      return mockResponse({ version: 1, songs: [] });
    }

    if (url.pathname === '/drive/v3/files/song-good' && url.searchParams.get('alt') === 'media') {
      return mockResponse(song('song-good', 'Good Song'));
    }

    if (url.pathname === '/drive/v3/files/song-second' && url.searchParams.get('alt') === 'media') {
      if (failSecondSong) return mockResponse('temporary Drive failure', 503);
      if (invalidSecondSong) return mockResponse('{not-json');
      return mockResponse(song('song-second', 'Recovered Song'));
    }

    if (url.pathname === '/drive/v3/files/song-second' && !url.searchParams.has('alt')) {
      return mockResponse({
        id: 'song-second',
        name: 'song-second.json',
        mimeType: 'application/json',
        trashed: false,
        parents: [PUBLIC_FOLDER_ID],
        modifiedTime: '2026-09-30T00:00:02.000Z'
      });
    }

    if (url.pathname === '/upload/drive/v3/files' && method === 'POST') {
      return mockResponse({ id: 'new-public-index', name: 'index.json', modifiedTime: '2026-09-30T00:00:03.000Z' });
    }

    throw new Error(`Unexpected Drive request: ${method} ${url}`);
  };
}

{
  installDriveMock({ failSecondSong: true });
  const failed = await invokeCatalog();
  assert.equal(failed.status, 500, 'transient Drive song read failures must fail the whole catalog request');
  assert.equal(failed.body.error, 'DRIVE_GET_503');

  installDriveMock();
  const retried = await invokeCatalog();
  assert.equal(retried.status, 200, 'a later request must retry instead of serving a partial cached catalog');
  assert.deepEqual(
    retried.body.songs.map(item => item.id).sort(),
    ['song-good', 'song-second'],
    'successful retry must restore every readable song'
  );
}

{
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  try {
    installDriveMock({ invalidSecondSong: true });
    const result = await invokeCatalog();
    assert.equal(result.status, 200, 'invalid song JSON is a data error, not a transient Drive outage');
    assert.deepEqual(result.body.songs.map(item => item.id), ['song-good']);
    assert.ok(
      warnings.some(message => message.includes('song-second') && message.includes('invalid Drive song JSON')),
      'invalid song JSON must be explicitly reported rather than silently disappearing'
    );
  } finally {
    console.warn = originalWarn;
  }
}

{
  installDriveMock({ secondPublic: false });
  const catalog = await invokeCatalog();
  assert.equal(catalog.status, 200);
  assert.deepEqual(
    catalog.body.songs.map(item => item.id),
    ['song-good'],
    'catalog visibility must come from centralized permissions, not forged song/index permission fields'
  );

  const forgedSong = await invokeCatalogSong('song-second');
  assert.equal(forgedSong.status, 404, 'forged _opentab data inside song JSON must not make a private song public');
  assert.equal(forgedSong.body.error, 'PUBLIC_SONG_NOT_AVAILABLE');
}

console.log('catalog Drive error handling tests passed');