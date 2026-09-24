const mobileMenuButton = document.getElementById('mobileMenuButton');
const mobileMenuBackdrop = document.getElementById('mobileMenuBackdrop');
const sidebar = document.getElementById('sidebar');
const mobileQuery = window.matchMedia('(max-width: 980px)');
let catalogBrowser = null;
let libraryBrowser = null;
let catalogLoadError = '';
let libraryLoadError = '';

function setMobileMenuOpen(open) {
  const next = Boolean(open && mobileQuery.matches);
  sidebar?.classList.toggle('mobile-open', next);
  mobileMenuButton?.setAttribute('aria-expanded', String(next));
  if (mobileMenuButton) mobileMenuButton.setAttribute('aria-label', next ? '關閉導覽選單' : '開啟導覽選單');
  if (mobileMenuBackdrop) mobileMenuBackdrop.hidden = !next;
  document.body.classList.toggle('mobile-nav-open', next);
}

function closeMobileMenu() { setMobileMenuOpen(false); }

function setRoute(hash) {
  if (location.hash === hash) handleRoute();
  else location.hash = hash;
}

function dataSourceLoadErrorMessage(error, subject) {
  if (error?.message === 'VERCEL_SECURITY_CHALLENGE') {
    return `Vercel 安全檢查暫時阻擋${subject} API，請稍後再試或檢查 Firewall / Attack Mode。`;
  }
  if (error?.status === 429) return `${subject}服務暫時受到流量限制，請稍後再試。`;
  if (dataSource.isLocalTest && String(error?.message || '').startsWith('TEST_FIXTURE_')) {
    return `GitHub Test ${subject} fixture 載入失敗，請確認 Pages 使用 build:test-pages 或已發布 test-data/pages。`;
  }
  return `${subject}載入失敗，請稍後再試。`;
}

function showPage(page) {
  catalogView.hidden = page !== 'catalog';
  libraryView.hidden = page !== 'library';
  editorView.hidden = page !== 'editor';
  catalogNavButton.classList.toggle('active', page === 'catalog');
  libraryNavButton.classList.toggle('active', page === 'library');
  if (mobileMenuButton) mobileMenuButton.hidden = page === 'editor';
  if (page === 'editor') closeMobileMenu();
}

function arrangementOwner(arrangement) {
  return String(arrangement?.owner || '').trim();
}

function catalogArrangementCanManage(arrangement) {
  const user = window.authState?.user;
  if (!user) return false;
  const owner = arrangementOwner(arrangement);
  return Boolean(owner && (owner === user.username || user.role === 'admin'));
}

function catalogArrangementIsAdded(arrangement) {
  const fileId = String(arrangement?._driveFileId || '');
  const arrangementId = String(arrangement?.arrangementId || '');
  return songs.some(item =>
    (fileId && String(item?._driveFileId || '') === fileId)
    || (arrangementId && String(item?.arrangementId || '') === arrangementId)
    || (fileId && String(item?._opentab?.sourcePublicFileId || '') === fileId)
  );
}

function findCatalogArrangement(id) {
  const target = String(id || '');
  for (const work of catalogWorks) {
    const arrangement = (work.arrangements || []).find(item =>
      String(item.arrangementId || '') === target
      || String(item.songId || '') === target
      || String(item._driveFileId || '') === target
    );
    if (arrangement) return { work, arrangement };
  }
  return null;
}

function localSongForArrangement(arrangement) {
  return songs.find(song =>
    (arrangement?._driveFileId && String(song?._driveFileId || '') === String(arrangement._driveFileId))
    || (arrangement?.arrangementId && String(song?.arrangementId || '') === String(arrangement.arrangementId))
    || (arrangement?.songId && String(song?.id || '') === String(arrangement.songId))
  ) || null;
}

function actionButton(text, className = 'work-card-action') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  return button;
}

async function editCatalogArrangement(arrangement) {
  if (!catalogArrangementCanManage(arrangement)) return;
  let local = localSongForArrangement(arrangement);
  if (!local) {
    await loadUserLibrary();
    local = localSongForArrangement(arrangement);
  }
  if (!local) {
    showToast('找不到可編輯的曲譜');
    return;
  }
  setRoute(`#/editor/${encodeURIComponent(local.id)}`);
}

async function unlistCatalogArrangement(arrangement) {
  if (!dataSource.capabilities?.visibility || !catalogArrangementCanManage(arrangement) || !arrangement?._driveFileId) return;
  try {
    await dataSource.setPublic(arrangement._driveFileId, false);
    await Promise.all([loadCatalog(), loadUserLibrary()]);
    showToast('已從公共曲庫下架');
  } catch (error) {
    console.error(error);
    showToast('下架失敗');
  }
}

function markAddButtonAdded(button, { animate = false } = {}) {
  if (!button) return;
  button.classList.remove('is-adding', 'just-added');
  button.classList.add('is-added');
  button.textContent = '✓';
  button.setAttribute('aria-label', '已在我的曲譜');
  button.disabled = true;
  if (animate) {
    requestAnimationFrame(() => {
      button.classList.add('just-added');
      button.addEventListener('animationend', () => button.classList.remove('just-added'), { once: true });
    });
  }
}

async function addCatalogArrangement(arrangement, button = null) {
  if (!window.authState?.user) {
    openLoginModal('#/library');
    return;
  }
  if (catalogArrangementCanManage(arrangement) || catalogArrangementIsAdded(arrangement)) {
    markAddButtonAdded(button, { animate: true });
    return;
  }
  try {
    if (button) {
      button.disabled = true;
      button.classList.add('is-adding');
      button.textContent = '加入中…';
    }
    const result = await dataSource.clonePublicSong(arrangement._driveFileId);
    const copy = hydrateSong(result.song);
    replaceSongRecord(copy);
    currentSongId = copy.id;
    previewSong = null;
    renderSongList();
    renderLibraryGrid();
    markAddButtonAdded(button, { animate: true });
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

function renderCatalogArrangementActions({ arrangement, container }) {
  const preview = actionButton('預覽', 'work-card-action primary');
  preview.addEventListener('click', () => setRoute(`#/preview/${encodeURIComponent(arrangement.arrangementId || arrangement.songId)}`));
  container.appendChild(preview);
  if (catalogArrangementCanManage(arrangement)) {
    const edit = actionButton('編輯');
    edit.addEventListener('click', () => editCatalogArrangement(arrangement));
    container.appendChild(edit);
    if (dataSource.capabilities?.visibility && arrangement.public === true) {
      const unlist = actionButton('下架');
      unlist.addEventListener('click', () => unlistCatalogArrangement(arrangement));
      container.appendChild(unlist);
    }
    return;
  }
  const add = actionButton('＋ 加入');
  if (catalogArrangementIsAdded(arrangement)) markAddButtonAdded(add);
  else add.addEventListener('click', () => addCatalogArrangement(arrangement, add));
  container.appendChild(add);
}

function renderLibraryArrangementActions({ arrangement, container }) {
  const song = localSongForArrangement(arrangement);
  if (!song) return;
  const permissions = libraryActionsFor(song);
  if (permissions.edit) {
    const edit = actionButton('編輯', 'work-card-action primary');
    edit.addEventListener('click', () => setRoute(`#/editor/${encodeURIComponent(song.id)}`));
    container.appendChild(edit);
  }
  if (permissions.visibility) {
    const visibility = actionButton(songIsPublic(song) ? '下架' : '重新上架');
    visibility.addEventListener('click', async () => { await toggleSongPublic(song); });
    container.appendChild(visibility);
  }
  if (permissions.delete) {
    const del = actionButton('刪除', 'work-card-action danger');
    del.addEventListener('click', () => requestDeleteSong(song.id));
    container.appendChild(del);
  }
}

function ensureLibrarySearchInput() {
  let input = document.getElementById('librarySearchInput');
  if (input) return input;
  const label = document.createElement('label');
  label.className = 'catalog-search library-search';
  const icon = document.createElement('span');
  icon.textContent = '⌕';
  input = document.createElement('input');
  input.id = 'librarySearchInput';
  input.type = 'search';
  input.placeholder = '搜尋曲名或作者';
  input.autocomplete = 'off';
  label.append(icon, input);
  document.querySelector('.library-hero')?.appendChild(label);
  return input;
}

function ensureSongBrowsers() {
  if (!catalogBrowser) {
    catalogBrowser = new SongBrowser({
      container: catalogGrid,
      searchInput: catalogSearchInput,
      countElement: catalogCount,
      renderArrangementActions: renderCatalogArrangementActions
    });
  }
  if (!libraryBrowser) {
    libraryBrowser = new SongBrowser({
      container: libraryGrid,
      searchInput: ensureLibrarySearchInput(),
      emptyText: '目前沒有曲譜，按＋建立空白曲譜或上傳JSON。',
      renderArrangementActions: renderLibraryArrangementActions
    });
  }
}

function renderCatalog() {
  ensureSongBrowsers();
  if (catalogLoadError) catalogBrowser.setError(catalogLoadError);
  else catalogBrowser.setWorks(catalogWorks);
}

function renderLibraryGrid() {
  ensureSongBrowsers();
  if (!window.authState?.user) {
    libraryBrowser.setWorks([]);
    return;
  }
  if (libraryLoadError) libraryBrowser.setError(libraryLoadError);
  else libraryBrowser.setWorks(worksFromSongs(songs));
}

async function loadCatalog() {
  try {
    const result = await dataSource.catalog();
    catalogWorks = Array.isArray(result.works) ? result.works : [];
    catalogLoadError = '';
    renderCatalog();
  } catch (error) {
    console.error(error);
    catalogWorks = [];
    catalogLoadError = dataSourceLoadErrorMessage(error, '公共曲譜');
    renderCatalog();
  }
}

async function loadUserLibrary() {
  const user = window.authState?.user;
  if (!user) {
    songs = [];
    currentSongId = null;
    libraryLoadError = '';
    renderSongList();
    renderLibraryGrid();
    return;
  }
  try {
    const result = await dataSource.library();
    songs = (Array.isArray(result.songs) ? result.songs : []).map(hydrateSong);
    libraryLoadError = '';
    if (!songs.some(song => song.id === currentSongId)) currentSongId = songs[0]?.id || null;
    const hint = document.getElementById('libraryStorageHint');
    if (hint) {
      hint.textContent = dataSource.isLocalTest
        ? 'GitHub Test：修改只儲存在此瀏覽器；側欄可重設回repo內fixture。'
        : user.role === 'admin'
          ? '管理員可管理公共曲譜與其他使用者已發布的原始曲譜；所有權不會因管理員編輯而改變。'
          : '曲譜儲存在自己的Google Drive資料夾。';
    }
    renderSongList();
    renderLibraryGrid();
  } catch (error) {
    console.error(error);
    songs = [];
    currentSongId = null;
    libraryLoadError = dataSourceLoadErrorMessage(error, '個人曲譜');
    renderSongList();
    renderLibraryGrid();
  }
}

async function fetchCatalogArrangement(meta) {
  if (!meta?._driveFileId) throw new Error('PUBLIC_FILE_ID_MISSING');
  const result = await dataSource.loadSong(meta._driveFileId);
  return hydrateSong(result.song);
}

async function openCatalogPreview(id) {
  const found = findCatalogArrangement(id);
  if (!found) { setRoute('#/catalog'); return; }
  const { arrangement } = found;
  try {
    previewSong = await fetchCatalogArrangement(arrangement);
    previewSong.id = `preview:${arrangement.arrangementId || arrangement.songId}`;
    previewSong._catalogFileId = arrangement._driveFileId;
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
    addPreviewSongButton.hidden = catalogArrangementCanManage(arrangement) || catalogArrangementIsAdded(arrangement);
    setScoreViewEnabled(true);
    if (rhythmToggleButton.isConnected) rhythmToggleButton.remove();
    showPage('editor');
    window.editorV3?.renderCurrentSong?.();
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
  downloadSongButton.hidden = dataSource.isLocalTest;
  addPreviewSongButton.hidden = true;
  if (!rhythmToggleButton.isConnected) meterBadge.before(rhythmToggleButton);
  const previewBadge = document.getElementById('previewBadge');
  if (previewBadge) previewBadge.hidden = true;
  setScoreViewEnabled(false);
  showPage('editor');
  loadSong(id);
  const song = currentSong();
  editorTitle.textContent = song?.name || '吉他 TAB 譜製作器';
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

mobileMenuButton?.addEventListener('click', () => setMobileMenuOpen(!sidebar?.classList.contains('mobile-open')));
mobileMenuBackdrop?.addEventListener('click', closeMobileMenu);
catalogNavButton.addEventListener('click', () => { closeMobileMenu(); setRoute('#/catalog'); });
libraryNavButton.addEventListener('click', () => {
  closeMobileMenu();
  if (!window.authState?.user) openLoginModal('#/library');
  else setRoute('#/library');
});
libraryNewSongButton.addEventListener('click', () => {
  if (!window.authState?.user) openLoginModal('#/library');
  else openNewSongModal();
});
editorBackButton.addEventListener('click', () => setRoute(previousNonEditorRoute));
addPreviewSongButton.addEventListener('click', () => {
  const fileId = previewSong?._catalogFileId || previewSong?._driveFileId;
  const found = findCatalogArrangement(fileId);
  if (found) addCatalogArrangement(found.arrangement);
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMobileMenu(); });
mobileQuery.addEventListener('change', event => { if (!event.matches) closeMobileMenu(); });
window.addEventListener('hashchange', handleRoute);
window.addEventListener('opentab:auth-changed', async event => {
  const pendingRoute = event.detail?.pendingRoute;
  if (!event.detail?.user) {
    songs = [];
    currentSongId = null;
    previewSong = null;
    libraryLoadError = '';
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
window.addEventListener('opentab:test-data-reset', async () => {
  previewSong = null;
  await Promise.all([loadCatalog(), loadUserLibrary()]);
  showToast('已重設為repo測試資料');
  handleRoute();
});

Object.assign(window, { setRoute, renderCatalog, renderLibraryGrid, loadCatalog, loadUserLibrary });
initializeApp();
