import { isGitHubPagesPreview, pagesPreviewRequest } from './pages-preview-source.js';

const CATALOG_CACHE_TTL_MS = 5_000;

let catalogCacheValue = null;
let catalogCacheExpiresAt = 0;
let catalogRequest = null;
let catalogGeneration = 0;

function apiUrl(action, params = {}) {
  const url = new URL('/api', window.location.origin);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url;
}

async function request(action, { method = 'GET', body, params } = {}) {
  if (isGitHubPagesPreview(window.location.hostname)) {
    return pagesPreviewRequest(action, { method, params });
  }

  const response = await fetch(apiUrl(action, params), {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store'
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {}

  if (response.ok) return payload;

  const error = new Error(payload?.error || `API_${response.status}`);
  error.status = response.status;
  throw error;
}

function clearCatalogCache() {
  catalogGeneration += 1;
  catalogCacheValue = null;
  catalogCacheExpiresAt = 0;
  catalogRequest = null;
}

function getCatalog() {
  const now = Date.now();
  if (catalogCacheValue && now < catalogCacheExpiresAt) {
    return Promise.resolve(catalogCacheValue);
  }
  if (catalogRequest) return catalogRequest;

  const requestGeneration = catalogGeneration;
  const pending = request('catalog')
    .then(result => {
      if (requestGeneration === catalogGeneration) {
        catalogCacheValue = result;
        catalogCacheExpiresAt = Date.now() + CATALOG_CACHE_TTL_MS;
      }
      return result;
    })
    .finally(() => {
      if (catalogRequest === pending) catalogRequest = null;
    });

  catalogRequest = pending;
  return pending;
}

async function requestWithCatalogInvalidation(action, options) {
  const result = await request(action, options);
  clearCatalogCache();
  return result;
}

async function saveSong(song) {
  const result = await request('save', { method: 'POST', body: { song } });
  // Private test songs cannot change the public catalog, so keep any still-valid
  // catalog cache. Public/admin saves invalidate it immediately.
  if (result.song?._opentab?.public === true) clearCatalogCache();
  return result;
}

async function publishSong(song) {
  const result = await requestWithCatalogInvalidation('publish', {
    method: 'POST',
    body: { song }
  });
  return { ...result, privateSong: result.privateSong || result.song };
}

export const cloudApi = Object.freeze({
  session: () => request('session'),
  login: (username, password) => request('login', { method: 'POST', body: { username, password } }),
  logout: () => request('logout', { method: 'POST', body: {} }),
  catalog: getCatalog,
  catalogSong: fileId => request('catalog-song', { params: { fileId } }),
  library: () => request('library'),
  saveSong,
  deleteSong: fileId => requestWithCatalogInvalidation('delete', { method: 'POST', body: { fileId } }),
  setPublic: (fileId, isPublic) => requestWithCatalogInvalidation('visibility', {
    method: 'POST',
    body: { fileId, public: Boolean(isPublic) }
  }),
  publishSong,
  clonePublicSong: fileId => request('clone', { method: 'POST', body: { fileId } })
});
