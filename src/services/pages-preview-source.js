const GITHUB_PAGES_HOST = /(^|\.)github\.io$/i;

export function isGitHubPagesPreview(hostname = '') {
  return GITHUB_PAGES_HOST.test(String(hostname));
}

export function pagesPreviewAssetUrl(path, baseHref) {
  return new URL(path, baseHref).toString();
}

async function readJson(path, { fetchImpl = fetch, baseHref = document.baseURI } = {}) {
  const response = await fetchImpl(pagesPreviewAssetUrl(path, baseHref), { cache: 'no-store' });
  if (!response.ok) throw new Error(`PAGES_FIXTURE_${response.status}`);
  return response.json();
}

export async function pagesPreviewRequest(action, { method = 'GET', params } = {}, runtime = {}) {
  if (method !== 'GET') throw new Error('GITHUB_PAGES_READ_ONLY');

  if (action === 'session') return { user: null, preview: true };
  if (action === 'catalog') return readJson('./test-data/pages/catalog.json', runtime);
  if (action === 'catalog-song') {
    const fileId = String(params?.fileId || '');
    if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) throw new Error('PAGES_FIXTURE_INVALID_ID');
    const song = await readJson(`./test-data/pages/songs/${fileId}.json`, runtime);
    return { song: { ...song, _driveFileId: fileId } };
  }

  throw new Error('GITHUB_PAGES_READ_ONLY');
}
