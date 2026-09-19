function setRoute(hash) {
  if (location.hash === hash) handleRoute();
  else location.hash = hash;
}

function showPage(page) {
  catalogView.hidden = page !== 'catalog';
  libraryView.hidden = page !== 'library';
  editorView.hidden = page !== 'editor';
  catalogNavButton.classList.toggle('active', page === 'catalog');
  libraryNavButton.classList.toggle('active', page === 'library');
}

function catalogSongIsAdded(song) {
  const user = window.authState?.user;
  if (!user) return false;
  if (user.role === 'admin') return true;
  const publicFileId = String(song?._driveFileId || '');
  if (!publicFileId) return false;
  return songs.some(item =>
    String(item?._opentab?.sourcePublicFileId || '') === publicFileId ||
    String(item?._opentab?.publicFileId || '') === publicFileId
  );
}

function markCatalogAddButtonAdded(button, { animate = false } = {}) {
  if (!button) return;
  button.classList.remove('is-adding', 'just-added');
  button.classList.add('is-added');
  button.textContent = '✓';
  button.setAttribute('aria-label', '已在我的曲譜');
  button.title = '已在我的曲譜';
  button.disabled = true;
  if (animate) {
    requestAnimationFrame(() => {
      button.classList.add('just-added');
      button.addEventListener('animationend', () => button.classList.remove('just-added'), { once: true });
    });
  }
}

function songCard(song, { publicSong = false } = {}) {
  const card = document.createElement('article');
  card.className = 'song-card';
  const art = document.createElement('div');
  art.className = 'song-card-art';
  const fallbackArt = document.createElement('span');
  fallbackArt.className = 'song-card-art-fallback';
  fallbackArt.textContent = (song.name || 'TAB').trim().slice(0, 2).toUpperCase();
  art.appendChild(fallbackArt);
  if (song.cover) {
    const image = document.createElement('img');
    image.className = 'song-card-art-image';
    image.src = song.cover;
    image.alt = song.album ? `${song.album} 封面` : `${song.name || '曲譜'} 封面`;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('load', () => art.classList.add('has-image'));
    image.addEventListener('error', () => image.remove());
    art.appendChild(image);
  }
  const body = document.createElement('div');
  body.className = 'song-card-body';
  const title = document.createElement('h3');
  title.textContent = song.name || '未命名曲譜';
  if (!publicSong && song?._opentab?.hidden === true && window.authState?.user?.role === 'admin') {
    const hidden = document.createElement('span');
    hidden.className = 'song-hidden-badge';
    hidden.textContent = '隱藏';
    title.appendChild(hidden);
  }
  const artist = document.createElement('p');
  artist.className = 'song-card-artist';
  artist.textContent = song.artist || (publicSong ? 'OpenGuitarTAB 公共曲譜' : '我的曲譜');
  if (song.album) artist.title = song.album;
  const source = document.createElement('p');
  source.className = 'song-card-source';
  source.textContent = `由 ${song.uploadedBy || song?._opentab?.uploadedBy || 'OpenGuitarTAB'} 上傳`;
  const meta = document.createElement('div');
  meta.className = 'song-card-meta';
  meta.innerHTML = `<span>${Number(song.tempo) || 120} BPM</span><span>Capo ${Number(song.capo) || 0}</span>`;
  const actions = document.createElement('div');
  actions.className = 'song-card-actions';
  const open = document.createElement('button');
  open.className = 'card-primary-button';
  open.type = 'button';
  open.textContent = publicSong ? '預覽' : '編輯';
  open.addEventListener('click', () => publicSong ? setRoute(`#/preview/${encodeURIComponent(song.id)}`) : setRoute(`#/editor/${encodeURIComponent(song.id)}`));
  actions.appendChild(open);
  if (publicSong) {
    const add = document.createElement('button');
    add.className = 'card-secondary-button';
    add.type = 'button';
    if (catalogSongIsAdded(song)) {
      markCatalogAddButtonAdded(add);
    } else {
      add.textContent = '＋ 加入';
      add.addEventListener('click', () => addCatalogSong(song, add));
    }
    actions.appendChild(add);
  }
  body.append(title, artist);
  if (publicSong) body.appendChild(source);
  body.append(meta, actions);
  card.append(art, body);
  return card;
}

function renderCatalog() {
  const query = catalogSearchInput.value.trim().toLocaleLowerCase();
  const filtered = catalogSongs.filter(song => !query || [song.name, song.artist, song.album].filter(Boolean).some(value => String(value).toLocaleLowerCase().includes(query)));
  catalogGrid.innerHTML = '';
  filtered.forEach(song => catalogGrid.appendChild(songCard(song, { publicSong: true })));
  catalogCount.textContent = `${filtered.length} 首`;
  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = '找不到符合條件的曲譜。';
    catalogGrid.appendChild(empty);
  }
}

function renderLibraryGrid() {
  libraryGrid.innerHTML = '';
  if (!window.authState?.user) {
    const login = document.createElement('button');
    login.type = 'button';
    login.className = 'sidebar-login-button';
    login.textContent = '登入';
    login.addEventListener('click', () => openLoginModal('#/library'));
    libraryGrid.appendChild(login);
    return;
  }
  songs.forEach(song => libraryGrid.appendChild(songCard(song)));
  if (!songs.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = '目前沒有曲譜，按＋建立空白曲譜或上傳JSON。';
    libraryGrid.appendChild(empty);
  }
}

async function loadCatalog() {
  try {
    const result = await cloudApi.catalog();
    catalogSongs = Array.isArray(result.songs) ? result.songs : [];
    renderCatalog();
  } catch (error) {
    console.error(error);
    catalogSongs = [];
    catalogGrid.innerHTML = '<p class="empty-state">公共曲庫目前無法載入，請確認Vercel後端與Google Drive設定。</p>';
    catalogCount.textContent = '';
  }
}

async function loadUserLibrary() {
  const user = window.authState?.user;
  if (!user) {
    songs = [];
    currentSongId = null;
    renderSongList();
    renderLibraryGrid();
    return;
  }
  try {
    const result = await cloudApi.library();
    songs = (Array.isArray(result.songs) ? result.songs : []).map(hydrateCloudSong);
    if (!songs.some(song => song.id === currentSongId)) currentSongId = songs[0]?.id || null;
    const hint = document.getElementById('libraryStorageHint');
    if (hint) hint.textContent = user.role === 'admin'
      ? '管理員曲譜櫃與公共曲庫使用同一批Google Drive檔案。'
      : '測試帳號曲譜儲存在自己的Google Drive測試資料夾。';
    renderSongList();
    renderLibraryGrid();
  } catch (error) {
    console.error(error);
    songs = [];
    currentSongId = null;
    renderSongList();
    libraryGrid.innerHTML = '<p class="empty-state">個人曲譜目前無法載入。</p>';
  }
}

async function fetchCatalogSong(meta) {
  if (!meta?._driveFileId) throw new Error('PUBLIC_FILE_ID_MISSING');
  const result = await cloudApi.catalogSong(meta._driveFileId);
  return hydrateCloudSong(result.song);
}

async function addCatalogSong(meta, button = null) {
  const user = window.authState?.user;
  if (!user) {
    openLoginModal('#/library');
    return;
  }
  if (user.role === 'admin') {
    markCatalogAddButtonAdded(button, { animate: true });
    showToast('管理員的我的曲譜已直接連通公共曲庫');
    return;
  }
  try {
    if (button) {
      button.disabled = true;
      button.classList.add('is-adding');
      button.textContent = '加入中…';
    }
    const result = await cloudApi.clonePublicSong(meta._driveFileId);
    const copy = hydrateCloudSong(result.song);
    songs.unshift(copy);
    currentSongId = copy.id;
    previewSong = null;
    renderSongList();
    renderLibraryGrid();
    markCatalogAddButtonAdded(button, { animate: true });
    showToast(`已將 ${copy.name || '曲譜'} 加入個人曲譜櫃`);
  } catch (error) {
    console.error(error);
    if (button) {
      button.disabled = false;
      button.classList.remove('is-adding');
      button.textContent = '＋ 加入';
    }
    showToast('加入曲譜櫃失敗');
  }
}

async function openCatalogPreview(id) {
  const meta = catalogSongs.find(song => song.id === id);
  if (!meta) { setRoute('#/catalog'); return; }
  try {
    previewSong = await fetchCatalogSong(meta);
    previewSong.id = `preview:${meta.id}`;
    previewSong._catalogFileId = meta._driveFileId;
    currentSongId = previewSong.id;
    activeBeatsPerMeasure = normalizeBeatsPerMeasure(previewSong.beatsPerMeasure);
    tempoInput.value = clamp(Number(previewSong.tempo) || 120, 30, 300);
    capoInput.value = clamp(Math.round(Number(previewSong.capo) || 0), 0, 12);
    meterBadge.textContent = `每小節 ${activeBeatsPerMeasure} 拍`;
    editorTitle.textContent = previewSong.name || '曲譜';
    const previewBadge = document.getElementById('previewBadge');
    if (previewBadge) previewBadge.hidden = false;
    saveSongButton.hidden = true;
    downloadSongButton.hidden = true;
    addPreviewSongButton.hidden = false;
    setScoreViewEnabled(true);
    if (rhythmToggleButton.isConnected) rhythmToggleButton.remove();
    renderRows(previewSong.rows);
    showPage('editor');
  } catch (error) {
    console.error(error);
    showToast('曲譜預覽載入失敗');
    setRoute('#/catalog');
  }
}

function openLocalEditor(id) {
  if (!window.authState?.user) { openLoginModal(`#/editor/${encodeURIComponent(id)}`); return; }
  previewSong = null;
  saveSongButton.hidden = false;
  downloadSongButton.hidden = false;
  addPreviewSongButton.hidden = true;
  if (!rhythmToggleButton.isConnected) meterBadge.before(rhythmToggleButton);
  const previewBadge = document.getElementById('previewBadge');
  if (previewBadge) previewBadge.hidden = true;
  setScoreViewEnabled(false);
  loadSong(id);
  const song = currentSong();
  editorTitle.textContent = song?.name || '吉他 TAB 譜製作器';
  showPage('editor');
}

function handleRoute() {
  const hash = location.hash || '#/catalog';
  const parts = hash.slice(2).split('/');
  const route = parts[0] || 'catalog';
  const id = parts[1] ? decodeURIComponent(parts.slice(1).join('/')) : null;
  if (route === 'catalog') {
    previewSong = null;
    previousNonEditorRoute = '#/catalog';
    showPage('catalog');
    renderCatalog();
    return;
  }
  if (route === 'library') {
    if (!window.authState?.user) {
      previousNonEditorRoute = '#/catalog';
      showPage('catalog');
      openLoginModal('#/library');
      return;
    }
    previewSong = null;
    previousNonEditorRoute = '#/library';
    renderLibraryGrid();
    showPage('library');
    return;
  }
  if (route === 'editor' && id) {
    if (!window.authState?.user) {
      showPage('catalog');
      openLoginModal(`#/editor/${encodeURIComponent(id)}`);
      return;
    }
    if (songs.some(song => song.id === id)) { openLocalEditor(id); return; }
  }
  if (route === 'preview' && id) { openCatalogPreview(id); return; }
  setRoute('#/catalog');
}

async function initializeApp() {
  await initializeAuth();
  await Promise.all([loadCatalog(), loadUserLibrary()]);
  if (!location.hash) location.hash = '#/catalog';
  handleRoute();
}

catalogNavButton.addEventListener('click', () => setRoute('#/catalog'));
libraryNavButton.addEventListener('click', () => {
  if (!window.authState?.user) openLoginModal('#/library');
  else setRoute('#/library');
});
catalogSearchInput.addEventListener('input', renderCatalog);
libraryNewSongButton.addEventListener('click', () => {
  if (!window.authState?.user) openLoginModal('#/library');
  else openNewSongModal();
});
editorBackButton.addEventListener('click', () => setRoute(previousNonEditorRoute));
addPreviewSongButton.addEventListener('click', () => {
  const fileId = previewSong?._catalogFileId || previewSong?._driveFileId;
  const meta = catalogSongs.find(song => song._driveFileId === fileId) || catalogSongs.find(song => `preview:${song.id}` === currentSongId);
  if (meta) addCatalogSong(meta);
});
window.addEventListener('hashchange', handleRoute);
window.addEventListener('opentab:auth-changed', async event => {
  const pendingRoute = event.detail?.pendingRoute;
  if (!event.detail?.user) {
    songs = [];
    currentSongId = null;
    previewSong = null;
    renderSongList();
    renderLibraryGrid();
    renderCatalog();
    setRoute('#/catalog');
    return;
  }
  await loadUserLibrary();
  renderCatalog();
  if (pendingRoute) setRoute(pendingRoute);
});
initializeApp();
