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

function song(id, name) {
  return {
    id,
    name,
    tempo: 80,
    capo: 0,
    beatsPerMeasure: 4,
    artist: 'Test Artist',
    album: 'Test Album',
    document: { version: 3, measures: [], relations: [], layout: {} },
    _opentab: { owner: 'attacker', public: true, uploadedBy: 'attacker' }
  };
}

function permissionProps(isPublic = true) {
  return {
    opentabManaged: '1',
    opentabOwner: 'admin',
    opentabPublic: isPublic ? '1' : '0',
    opentabUploadedBy: 'admin'
  };
}

function file(id, modifiedTime, isPublic = true) {
  return {
    id,
    name: `${id}.json`,
    mimeType: 'application/json',
    trashed: false,
    parents: [PUBLIC_FOLDER_ID],
    modifiedTime,
    md5Checksum: `checksum-${id}`,
    description: '',
    appProperties: permissionProps(isPublic)
  };
}

function installDriveMock({ failSecondSong = false, invalidSecondSong = false, secondPublic = true } = {}) {
  const files = new Map([
    ['song-good', file('song-good', '2026-09-30T00:00:01.000Z', true)],
    ['song-second', file('song-second', '2026-09-30T00:00:02.000Z', secondPublic)]
  ]);
  const fullSongReads = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();

    if (url.hostname === 'oauth2.googleapis.com') {
      return mockResponse({ access_token: 'drive-token', expires_in: 3600 });
    }
    if (url.hostname !== 'www.googleapis.com') throw new Error(`Unexpected host: ${url.hostname}`);

    const q = url.searchParams.get('q') || '';
    const isPublicQuery = q.includes(`'${PUBLIC_FOLDER_ID}' in parents`);
    const isTestQuery = q.includes(`'${TEST_FOLDER_ID}' in parents`);

    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      if (isPublicQuery && q.includes("name = 'artists.json'")) return mockResponse({ files: [] });
      if (isPublicQuery) return mockResponse({ files: [...files.values()] });
      if (isTestQuery) return mockResponse({ files: [] });
    }

    const match = url.pathname.match(/^\/drive\/v3\/files\/(song-good|song-second)$/);
    if (match) {
      const id = match[1];
      const current = files.get(id);
      if (method === 'GET' && url.searchParams.get('alt') === 'media') {
        fullSongReads.push(id);
        if (id === 'song-second' && failSecondSong) return mockResponse('temporary Drive failure', 503);
        if (id === 'song-second' && invalidSecondSong) return mockResponse('{not-json');
        return mockResponse(song(id, id === 'song-good' ? 'Good Song' : 'Recovered Song'));
      }
      if (method === 'GET') return mockResponse(current);
      if (method === 'PATCH') {
        const patch = JSON.parse(String(init.body || '{}'));
        const next = { ...current, ...patch, appProperties: { ...current.appProperties, ...(patch.appProperties || {}) } };
        files.set(id, next);
        return mockResponse(next);
      }
    }

    throw new Error(`Unexpected Drive request: ${method} ${url}`);
  };

  return { files, fullSongReads };
}

{
  const first = installDriveMock({ failSecondSong: true });
  const failed = await invoke('/api?action=catalog');
  assert.equal(failed.status, 500, 'transient stale-score reads must fail the whole catalog request');
  assert.equal(failed.body.error, 'DRIVE_GET_503');
  assert.deepEqual(first.fullSongReads.sort(), ['song-good', 'song-second']);

  const retriedState = installDriveMock();
  const retried = await invoke('/api?action=catalog');
  assert.equal(retried.status, 200, 'a later request must retry instead of serving a partial catalog');
  assert.deepEqual(retried.body.songs.map(item => item.id).sort(), ['song-good', 'song-second']);
  assert.deepEqual(retriedState.fullSongReads.sort(), ['song-good', 'song-second']);
}

{
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  try {
    installDriveMock({ invalidSecondSong: true });
    const result = await invoke('/api?action=catalog');
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
  const state = installDriveMock();
  const warm = await invoke('/api?action=catalog');
  assert.equal(warm.status, 200);
  assert.equal(state.fullSongReads.length, 2, 'first read must hydrate missing catalog metadata');

  state.fullSongReads.length = 0;
  const cached = await invoke('/api?action=catalog');
  assert.equal(cached.status, 200);
  assert.equal(state.fullSongReads.length, 0, 'matching Drive checksum metadata must avoid downloading complete scores');
}

{
  installDriveMock({ secondPublic: false });
  const catalog = await invoke('/api?action=catalog');
  assert.equal(catalog.status, 200);
  assert.deepEqual(
    catalog.body.songs.map(item => item.id),
    ['song-good'],
    'catalog visibility must come from private Drive appProperties, not forged song JSON'
  );

  const forgedSong = await invoke('/api?action=catalog-song&fileId=song-second');
  assert.equal(forgedSong.status, 404, 'forged _opentab data inside song JSON must not make a private song public');
  assert.equal(forgedSong.body.error, 'PUBLIC_SONG_NOT_AVAILABLE');
}

console.log('catalog Drive metadata/error handling tests passed');