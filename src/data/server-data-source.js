const CATALOG_CACHE_TTL_MS = 5_000;

function defaultFetch(...args) {
  return globalThis.fetch(...args);
}

export class ServerDataSource {
  constructor({ fetchImpl = defaultFetch, origin = globalThis.location?.origin || 'http://localhost' } = {}) {
    this.fetchImpl = fetchImpl;
    this.origin = origin;
    this.kind = 'server';
    this.isLocalTest = false;
    this.capabilities = Object.freeze({ publish: true, visibility: true, reset: false });
    this.catalogCacheValue = null;
    this.catalogCacheExpiresAt = 0;
    this.catalogRequest = null;
    this.catalogGeneration = 0;
  }

  apiUrl(action, params = {}) {
    const url = new URL('/api', this.origin);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    return url;
  }

  async request(action, { method = 'GET', body, params } = {}) {
    const response = await this.fetchImpl(this.apiUrl(action, params), {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store'
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (response.ok) return payload;

    const mitigation = String(response.headers?.get?.('x-vercel-mitigated') || '').toLowerCase();
    const code = response.status === 429 && mitigation === 'challenge'
      ? 'VERCEL_SECURITY_CHALLENGE'
      : payload?.error || `API_${response.status}`;
    const error = new Error(code);
    error.code = code;
    error.status = response.status;
    error.mitigation = mitigation;
    throw error;
  }

  clearCatalogCache() {
    this.catalogGeneration += 1;
    this.catalogCacheValue = null;
    this.catalogCacheExpiresAt = 0;
    this.catalogRequest = null;
  }

  async catalog() {
    const now = Date.now();
    if (this.catalogCacheValue && now < this.catalogCacheExpiresAt) return this.catalogCacheValue;
    if (this.catalogRequest) return this.catalogRequest;
    const generation = this.catalogGeneration;
    const pending = this.request('catalog')
      .then(result => {
        if (generation === this.catalogGeneration) {
          this.catalogCacheValue = result;
          this.catalogCacheExpiresAt = Date.now() + CATALOG_CACHE_TTL_MS;
        }
        return result;
      })
      .finally(() => { if (this.catalogRequest === pending) this.catalogRequest = null; });
    this.catalogRequest = pending;
    return pending;
  }

  session() { return this.request('session'); }
  login(username, password) { return this.request('login', { method: 'POST', body: { username, password } }); }
  logout() { return this.request('logout', { method: 'POST', body: {} }); }
  loadSong(fileId) { return this.request('catalog-song', { params: { fileId } }); }
  library() { return this.request('library'); }

  async saveSong(song) {
    const result = await this.request('save', { method: 'POST', body: { song } });
    if (result.song?._opentab?.public === true) this.clearCatalogCache();
    return result;
  }

  async deleteSong(fileId) {
    const result = await this.request('delete', { method: 'POST', body: { fileId } });
    this.clearCatalogCache();
    return result;
  }

  async setPublic(fileId, isPublic) {
    const result = await this.request('visibility', { method: 'POST', body: { fileId, public: Boolean(isPublic) } });
    this.clearCatalogCache();
    return result;
  }

  async publishSong(song) {
    const result = await this.request('publish', { method: 'POST', body: { song } });
    this.clearCatalogCache();
    return { ...result, privateSong: result.privateSong || result.song };
  }

  clonePublicSong(fileId) { return this.request('clone', { method: 'POST', body: { fileId } }); }
}
