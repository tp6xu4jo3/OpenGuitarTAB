function apiUrl(action, params = {}) {
  const url = new URL('/api', window.location.origin);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url;
}

async function request(action, { method = 'GET', body, params } = {}) {
  const response = await fetch(apiUrl(action, params), {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store'
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (response.ok) return payload;
  const error = new Error(payload?.error || `API_${response.status}`);
  error.status = response.status;
  throw error;
}

export const cloudApi = Object.freeze({
  session: () => request('session'),
  login: (username, password) => request('login', { method: 'POST', body: { username, password } }),
  logout: () => request('logout', { method: 'POST', body: {} }),
  catalog: () => request('catalog'),
  catalogSong: fileId => request('catalog-song', { params: { fileId } }),
  library: () => request('library'),
  saveSong: song => request('save', { method: 'POST', body: { song } }),
  deleteSong: fileId => request('delete', { method: 'POST', body: { fileId } }),
  setHidden: (fileId, hidden) => request('hide', { method: 'POST', body: { fileId, hidden } }),
  publishSong: song => request('publish', { method: 'POST', body: { song } }),
  clonePublicSong: fileId => request('clone', { method: 'POST', body: { fileId } })
});
