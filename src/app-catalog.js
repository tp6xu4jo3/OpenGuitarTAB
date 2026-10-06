const mobileMenuButton = document.getElementById('mobileMenuButton');
const mobileMenuBackdrop = document.getElementById('mobileMenuBackdrop');
const sidebar = document.getElementById('sidebar');
const mobileQuery = window.matchMedia('(max-width: 980px)');
let catalogBrowser = null;
let libraryBrowser = null;
let catalogLoadError = '';
let libraryLoadError = '';
let catalogLoadGeneration = 0;
let libraryLoadGeneration = 0;
let previewLoadGeneration = 0;
let libraryLoadedUsername = '';
let libraryLoadRequest = null;
let libraryLoadRequestUsername = '';
const librarySongLoadRequests = new Map();

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
    return `GitHub Test ${subject} fixture 載入失敗，請確認 Pages 已發布 test-data/pages。`;
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

function iconButton(className, label, svg) {
  const button = actionButton('', className);
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = svg;
  return button;
}

function closeArrangementMenus(except = null) {
  document.querySelectorAll('.work-card-action-menu.open').forEach(menu => {
    if (menu !== except) menu.classList.remove('open');
  });
}

function arrangementDifficultyText(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 5 ? `☆${Math.round(number)}` : '☆-';
}

function arrangementPlayStyleText(value) {
  if (value === 'fingerstyle') return '指彈';
  if (value === 'chord') return '和弦';
  return '未設定';
}

function appendArrangementMenuInfo(menu, arrangement) {
  if (!arrangement) return;
  menu.classList.add('with-info');
  const info = document.createElement('div');
  info.className = 'work-card-action-menu-info';

  const title = document.createElement('strong');
  title.className = 'work-card-action-menu-info-title';
  title.textContent = '資訊';
  info.appendChild(title);

  [
    ['難度', arrangementDifficultyText(arrangement.difficulty)],
    ['類型', arrangementPlayStyleText(arrangement.playStyle)],
    ['來源', String(arrangement.source || '-')]
  ].forEach(([labelText, valueText]) => {
    const row = document.createElement('div');
    row.className = 'work-card-action-menu-info-row';
    const label = document.createElement('span');
    label.className = 'work-card-action-menu-info-label';
    label.textContent = `${labelText}：`;
    const value = document.createElement('span');
    value.className = 'work-card-action-menu-info-value';
    value.textContent = valueText;
    row.append(label, value);
    info.appendChild(row);
  });

  menu.appendChild(info);
}

function createArrangementMenu(items, arrangement = null) {
  const shell = document.createElement('div');
  shell.className = 'work-card-action-menu-shell';
  const trigger = iconButton(
    'work-card-action work-card-action-icon work-card-action-more',
    '更多操作',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>'
  );
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div');
  menu.className = 'work-card-action-menu';
  menu.setAttribute('role', 'menu');
  items.forEach(item => {
    const button = actionButton(item.label, `work-card-action-menu-item${item.danger ? ' danger' : ''}`);
    button.setAttribute('role', 'menuitem');
    button.addEventListener('click', async event => {
      event.stopPropagation();
      menu.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      await item.run();
    });
    menu.appendChild(button);
  });
  appendArrangementMenuInfo(menu, arrangement);
  trigger.addEventListener('click', event => {
    event.stopPropagation();
    const opening = !menu.classList.contains('open');
    closeArrangementMenus(menu);
    menu.classList.toggle('open', opening);
    trigger.setAttribute('aria-expanded', String(opening));
  });
  shell.append(trigger, menu);
  return shell;
}

async function editCatalogArrangement(arrangement) {
  if (!catalogArrangementCanManage(arrangement)) return;
  let local = localSongForArrangement(arrangement);
  if (!local) {
    await ensureUserLibraryLoaded();
    local = localSongForArrangement(arrangement);
  }
  if (!local) {
    showToast('找不到可編輯的曲譜');
    return;
  }
  setRoute(`#/editor/${encodeURIComponent(local.arrangementId)}`);
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
  if (catalogArrangementCanManage(arrangement)) {
    markAddButtonAdded(button, { animate: true });
    return;
  }
  await ensureUserLibraryLoaded();
  if (catalogArrangementIsAdded(arrangement)) {
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
  const preview = iconButton(
    'work-card-action primary work-card-action-icon work-card-preview-icon',
    '預覽',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12s3.4-5.2 9.2-5.2S21.2 12 21.2 12 17.8 17.2 12 17.2 2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>'
  );
  preview.addEventListener('click', event => {
    event.stopPropagation();
    setRoute(`#/preview/${encodeURIComponent(arrangement.arrangementId)}`);
  });
  container.appendChild(preview);

  if (catalogArrangementCanManage(arrangement)) {
    const menuItems = [{ label: '編輯', run: () => editCatalogArrangement(arrangement) }];
    if (dataSource.capabilities?.visibility && arrangement.public === true) {
      menuItems.push({ label: '下架', danger: true, run: () => unlistCatalogArrangement(arrangement) });
    }
    container.appendChild(createArrangementMenu(menuItems, arrangement));
    return;
  }

  const add = actionButton('＋ 加入');
  if (catalogArrangementIsAdded(arrangement)) markAddButtonAdded(add);
  else add.addEventListener('click', event => { event.stopPropagation(); void addCatalogArrangement(arrangement, add); });
  container.appendChild(add);
}

function renderLibraryArrangementActions({ arrangement, container }) {
  const song = localSongForArrangement(arrangement);
  if (!song) return;
  const permissions = libraryActionsFor(song);
  if (permissions.edit) {
    const edit = iconButton(
      'work-card-action primary work-card-action-icon work-card-edit-icon',
      '編輯',
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5h4l10.2-10.2a2.4 2.4 0 0 0 0-3.4l-.6-.6a2.4 2.4 0 0 0-3.4 0L4.5 15.5v4Z"/><path d="m13.8 6.2 4 4"/></svg>'
    );
    edit.addEventListener('click', event => { event.stopPropagation(); setRoute(`#/editor/${encodeURIComponent(song.arrangementId)}`); });
    container.appendChild(edit);
  }

  const menuItems = [];
  if (permissions.visibility) {
    const isPublic = songIsPublic(song);
    menuItems.push({
      label: isPublic ? '下架' : '重新上架',
      danger: isPublic,
      run: () => toggleSongPublic(song)
    });
  }
  if (permissions.delete) {
    menuItems.push({ label: '刪除', danger: true, run: () => requestDeleteSong(song.id) });
  }
  if (menuItems.length) container.appendChild(createArrangementMenu(menuItems));
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
  const generation = ++catalogLoadGeneration;
  try {
    const result = await dataSource.catalog();
    if (generation !== catalogLoadGeneration) return;
    catalogWorks = Array.isArray(result.works) ? result.works : [];
    catalogLoadError = '';
    renderCatalog();
  } catch (error) {
    if (generation !== catalogLoadGeneration) return;
    console.error(error);
    catalogWorks = [];
    catalogLoadError = dataSourceLoadErrorMessage(error, '公共曲譜');
    renderCatalog();
  }
}

async function loadUserLibrary() {
  const generation = ++libraryLoadGeneration;
  const user = window.authState?.user;
  const username = String(user?.username || '');
  if (!user) {
    libraryLoadedUsername = '';
    songs = [];
    currentSongId = null;
    libraryLoadError = '';
    renderSongList();
    renderLibraryGrid();
    return;
  }
  try {
    const result = await dataSource.library();
    if (generation !== libraryLoadGeneration || String(window.authState?.user?.username || '') !== username) return;
    songs = (Array.isArray(result.songs) ? result.songs : []).map(song => ({ ...song }));
    libraryLoadedUsername = username;
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
    renderCatalog();
  } catch (error) {
    if (generation !== libraryLoadGeneration || String(window.authState?.user?.username || '') !== username) return;
    console.error(error);
    libraryLoadedUsername = '';
    songs = [];
    currentSongId = null;
    libraryLoadError = dataSourceLoadErrorMessage(error, '個人曲譜');
    renderSongList();
    renderLibraryGrid();
  }
}

function ensureUserLibraryLoaded() {
  const username = String(window.authState?.user?.username || '');
  if (!username || libraryLoadedUsername === username) return Promise.resolve();
  if (libraryLoadRequest && libraryLoadRequestUsername === username) return libraryLoadRequest;
  const request = loadUserLibrary().finally(() => {
    if (libraryLoadRequest === request) {
      libraryLoadRequest = null;
      libraryLoadRequestUsername = '';
    }
  });
  libraryLoadRequest = request;
  libraryLoadRequestUsername = username;
  return request;
}

function ensureLibrarySongLoaded(arrangementId) {
  const routeId = String(arrangementId || '');
  const song = songs.find(item => String(item?.arrangementId || '') === routeId);
  if (!song) return Promise.resolve(null);
  if (song.document) return Promise.resolve(song);
  const fileId = String(song._driveFileId || '');
  if (!fileId) return Promise.resolve(null);
  if (librarySongLoadRequests.has(fileId)) return librarySongLoadRequests.get(fileId);
  const request = dataSource.loadSong(fileId)
    .then(result => replaceSongRecord(hydrateSong(result.song)))
    .finally(() => {
      if (librarySongLoadRequests.get(fileId) === request) librarySongLoadRequests.delete(fileId);
    });
  librarySongLoadRequests.set(fileId, request);
  return request;
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
  const generation = ++previewLoadGeneration;
  const routeHash = location.hash;
  try {
    const loaded = await fetchCatalogArrangement(arrangement);
    if (generation !== previewLoadGeneration || location.hash !== routeHash) return;
    previewSong = loaded;
    previewSong.id = `preview:${arrangement.arrangementId}`;
    previewSong._catalogFileId = arrangement._driveFileId;
    currentSongId = previewSong.id;
    activeBeatsPerMeasure = normalizeBeatsPerMeasure(previewSong.beatsPerMeasure);
    tempoInput.value = clamp(Number(previewSong.tempo) || 120, 30, 300);
    capoInput.value = clamp(Math.round(Number(previewSong.capo) || 0), 0, 12);
    meterBadge.textContent = `每小節 ${activeBeatsPerMeasure} 拍`;
    editorTitle.textContent = window.formatArrangementDisplayName?.(previewSong, '曲譜') || previewSong.arrangementName || previewSong.name || '曲譜';
    setPreviewActive(true);
    saveSongButton.hidden = true;
    downloadSongButton.hidden = true;
    addPreviewSongButton.hidden = catalogArrangementCanManage(arrangement) || catalogArrangementIsAdded(arrangement);
    setScoreViewEnabled(true);
    showPage('editor');
    window.editorV3?.renderCurrentSong?.();
  } catch (error) {
    if (generation !== previewLoadGeneration || location.hash !== routeHash) return;
    console.error(error);
    showToast('曲譜預覽載入失敗');
    setRoute('#/catalog');
  }
}

async function openLocalEditor(arrangementId) {
  if (!window.authState?.user) { openLoginModal(`#/editor/${encodeURIComponent(arrangementId)}`); return; }
  const requestedHash = location.hash;
  try {
    const loaded = await ensureLibrarySongLoaded(arrangementId);
    if (location.hash !== requestedHash) return;
    if (!loaded) { setRoute('#/catalog'); return; }
    previewSong = null;
    saveSongButton.hidden = false;
    downloadSongButton.hidden = dataSource.isLocalTest;
    addPreviewSongButton.hidden = true;
    setPreviewActive(false);
    setScoreViewEnabled(false);
    showPage('editor');
    loadSong(loaded.id);
    editorTitle.textContent = window.formatArrangementDisplayName?.(loaded, '吉他 TAB 譜製作器') || loaded.arrangementName || loaded.name || '吉他 TAB 譜製作器';
  } catch (error) {
    if (location.hash !== requestedHash) return;
    console.error(error);
    showToast('曲譜載入失敗');
    setRoute('#/library');
  }
}

function handleRoute() {
  const hash = location.hash || '#/catalog';
  const parts = hash.slice(2).split('/');
  const route = parts[0] || 'catalog';
  const id = parts[1] ? decodeURIComponent(parts.slice(1).join('/')) : null;
  if (route !== 'preview') previewLoadGeneration += 1;
  if (route === 'catalog') {
    previewSong = null;
    setPreviewActive(false);
    previousNonEditorRoute = '#/catalog';
    showPage('catalog');
    renderCatalog();
    return;
  }
  if (route === 'library') {
    setPreviewActive(false);
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
    void ensureUserLibraryLoaded();
    return;
  }
  if (route === 'editor' && id) {
    if (!window.authState?.user) {
      showPage('catalog');
      openLoginModal(`#/editor/${encodeURIComponent(id)}`);
      return;
    }
    if (songs.some(song => song.arrangementId === id)) { void openLocalEditor(id); return; }
    const requestedHash = location.hash;
    void ensureUserLibraryLoaded().then(() => {
      if (location.hash !== requestedHash) return;
      if (songs.some(song => song.arrangementId === id)) void openLocalEditor(id);
      else setRoute('#/catalog');
    });
    return;
  }
  if (route === 'preview' && id) { openCatalogPreview(id); return; }
  setRoute('#/catalog');
}

async function initializeApp() {
  await initializeAuth();
  await loadCatalog();
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
document.addEventListener('click', event => { if (!event.target.closest('.work-card-action-menu-shell')) closeArrangementMenus(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeMobileMenu();
    closeArrangementMenus();
  }
});
mobileQuery.addEventListener('change', event => { if (!event.matches) closeMobileMenu(); });
window.addEventListener('hashchange', handleRoute);
window.addEventListener('opentab:auth-changed', async event => {
  const pendingRoute = event.detail?.pendingRoute;
  libraryLoadedUsername = '';
  librarySongLoadRequests.clear();
  if (!event.detail?.user) {
    libraryLoadGeneration += 1;
    previewLoadGeneration += 1;
    songs = [];
    currentSongId = null;
    previewSong = null;
    setPreviewActive(false);
    libraryLoadError = '';
    renderSongList();
    renderLibraryGrid();
    renderCatalog();
    setRoute('#/catalog');
    return;
  }
  renderCatalog();
  if (pendingRoute) setRoute(pendingRoute);
});
window.addEventListener('opentab:test-data-reset', async () => {
  previewLoadGeneration += 1;
  previewSong = null;
  setPreviewActive(false);
  libraryLoadedUsername = '';
  librarySongLoadRequests.clear();
  await Promise.all([loadCatalog(), loadUserLibrary()]);
  showToast('已重設為repo測試資料');
  handleRoute();
});

Object.assign(window, { setRoute, renderCatalog, renderLibraryGrid, loadCatalog, loadUserLibrary });
initializeApp();