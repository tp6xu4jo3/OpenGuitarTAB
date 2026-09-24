let expandedCatalogWorkId = null;

const mobileMenuButton = document.getElementById('mobileMenuButton');
const mobileMenuBackdrop = document.getElementById('mobileMenuBackdrop');
const sidebar = document.getElementById('sidebar');
const mobileQuery = window.matchMedia('(max-width: 980px)');

function setMobileMenuOpen(open) {
  const next = Boolean(open && mobileQuery.matches);
  sidebar?.classList.toggle('mobile-open', next);
  mobileMenuButton?.setAttribute('aria-expanded', String(next));
  if (mobileMenuButton) mobileMenuButton.setAttribute('aria-label', next ? '關閉導覽選單' : '開啟導覽選單');
  if (mobileMenuBackdrop) mobileMenuBackdrop.hidden = !next;
  document.body.classList.toggle('mobile-nav-open', next);
}

function closeMobileMenu() {
  setMobileMenuOpen(false);
}

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
  if (mobileMenuButton) mobileMenuButton.hidden = page === 'editor';
  if (page === 'editor') closeMobileMenu();
}

function catalogSongOwner(song) {
  return String(song?.owner || song?._opentab?.owner || '').trim();
}

function catalogSongCanManage(song) {
  const user = window.authState?.user;
  if (!user) return false;
  const owner = catalogSongOwner(song);
  return Boolean(owner && (owner === user.username || user.role === 'admin'));
}

function catalogSongIsAdded(song) {
  const user = window.authState?.user;
  if (!user) return false;
  if (user.role === 'admin') return true;
  const publicFileId = String(song?._driveFileId || '');
  if (!publicFileId) return false;
  return songs.some(item =>
    String(item?._driveFileId || '') === publicFileId ||
    String(item?._opentab?.sourcePublicFileId || '') === publicFileId
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

function catalogArrangements() {
  return catalogWorks.flatMap(work => Array.isArray(work?.arrangements) ? work.arrangements : []);
}

function findCatalogArrangement(id) {
  const key = String(id || '');
  return catalogArrangements().find(arrangement =>
    String(arrangement.arrangementId || arrangement.id || '') === key ||
    String(arrangement.songId || '') === key
  ) || null;
}

function playStyleLabel(playStyle) {
  if (playStyle === 'fingerstyle') return '指彈';
  if (playStyle === 'chord') return '和弦';
  return '未設定';
}

function createCoverArt(item) {
  const art = document.createElement('div');
  art.className = 'song-card-art';
  const fallbackArt = document.createElement('span');
  fallbackArt.className = 'song-card-art-fallback';
  fallbackArt.textContent = (item?.name || 'TAB').trim().slice(0, 2).toUpperCase();
  art.appendChild(fallbackArt);
  if (item?.cover) {
    const image = document.createElement('img');
    image.className = 'song-card-art-image';
    image.src = item.cover;
    image.alt = item.album ? `${item.album} 封面` : `${item.name || '曲譜'} 封面`;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('load', () => art.classList.add('has-image'));
    image.addEventListener('error', () => image.remove());
    art.appendChild(image);
  }
  return art;
}

function createPlayStyleBadge(playStyle) {
  if (!['fingerstyle', 'chord'].includes(playStyle)) return null;
  const badge = document.createElement('span');
  badge.className = `work-card-play-style is-${playStyle}`;
  badge.textContent = playStyleLabel(playStyle);
  return badge;
}

async function editCatalogSong(song) {
  if (!catalogSongCanManage(song)) return;
  let local = songs.find(item => String(item?._driveFileId || '') === String(song?._driveFileId || ''));
  if (!local) {
    await loadUserLibrary();
    local = songs.find(item => String(item?._driveFileId || '') === String(song?._driveFileId || ''));
  }
  if (!local) {
    showToast('找不到可編輯的原始曲譜');
    return;
  }
  setRoute(`#/editor/${encodeURIComponent(local.id)}`);
}

async function unlistCatalogSong(song) {
  if (!catalogSongCanManage(song) || !song?._driveFileId) return;
  try {
    await cloudApi.setPublic(song._driveFileId, false);
    await Promise.all([loadCatalog(), loadUserLibrary()]);
    showToast('已從公共曲庫下架');
  } catch (error) {
    console.error(error);
    showToast('下架失敗');
  }
}

function librarySongCard(song) {
  const card = document.createElement('article');
  card.className = 'song-card';
  const art = createCoverArt(song);
  const body = document.createElement('div');
  body.className = 'song-card-body';
  const title = document.createElement('h3');
  title.textContent = song.name || '未命名曲譜';
  if (songWasPublished(song) && !songIsPublic(song)) {
    const badge = document.createElement('span');
    badge.className = 'song-hidden-badge';
    badge.textContent = '已下架';
    title.appendChild(badge);
  }
  const artist = document.createElement('p');
  artist.className = 'song-card-artist';
  artist.textContent = song.artist || '我的曲譜';
  if (song.album) artist.title = song.album;
  const meta = document.createElement('div');
  meta.className = 'song-card-meta';
  const difficulty = Number(song.difficulty);
  const difficultyText = Number.isFinite(difficulty) && difficulty >= 1 && difficulty <= 5 ? `難度 ${Math.round(difficulty)}` : '難度 -';
  meta.innerHTML = `<span>${playStyleLabel(song.playStyle)}</span><span>${difficultyText}</span>`;
  const actions = document.createElement('div');
  actions.className = 'song-card-actions';
  const open = document.createElement('button');
  open.className = 'card-primary-button';
  open.type = 'button';
  open.textContent = '編輯';
  open.addEventListener('click', () => setRoute(`#/editor/${encodeURIComponent(song.id)}`));
  actions.appendChild(open);
  body.append(title, artist, meta, actions);
  card.append(art, body);
  return card;
}

function workCardPlayStyles(work) {
  const styles = new Set((work?.arrangements || []).map(item => item?.playStyle).filter(Boolean));
  return ['fingerstyle', 'chord'].filter(style => styles.has(style));
}

function arrangementDifficulty(arrangement) {
  const difficulty = Number(arrangement?.difficulty);
  return Number.isFinite(difficulty) && difficulty >= 1 && difficulty <= 5
    ? `難度 ${Math.round(difficulty)}`
    : '難度 -';
}

function arrangementRow(work, arrangement) {
  const row = document.createElement('div');
  row.className = 'work-card-arrangement';
  row.dataset.arrangementId = arrangement.arrangementId || arrangement.id || '';

  const details = document.createElement('div');
  details.className = 'work-card-arrangement-details';
  const heading = document.createElement('div');
  heading.className = 'work-card-arrangement-heading';
  const style = createPlayStyleBadge(arrangement.playStyle);
  if (style) heading.appendChild(style);
  const difficulty = document.createElement('span');
  difficulty.className = 'work-card-arrangement-difficulty';
  difficulty.textContent = arrangementDifficulty(arrangement);
  heading.appendChild(difficulty);

  const info = document.createElement('p');
  info.className = 'work-card-arrangement-info';
  const infoParts = [];
  if (arrangement.source) infoParts.push(arrangement.source);
  if (arrangement.uploadedBy) infoParts.push(`by ${arrangement.uploadedBy}`);
  if (Number.isFinite(Number(arrangement.capo)) && Number(arrangement.capo) > 0) infoParts.push(`Capo ${arrangement.capo}`);
  if (Number.isFinite(Number(arrangement.tempo))) infoParts.push(`${Math.round(Number(arrangement.tempo))} BPM`);
  info.textContent = infoParts.join(' · ') || `${work.name || '曲譜'}版本`;
  details.append(heading, info);

  const actions = document.createElement('div');
  actions.className = 'work-card-arrangement-actions';
  const preview = document.createElement('button');
  preview.type = 'button';
  preview.className = 'work-card-action is-primary';
  preview.textContent = '預覽';
  preview.addEventListener('click', () => setRoute(`#/preview/${encodeURIComponent(arrangement.arrangementId || arrangement.id)}`));
  actions.appendChild(preview);

  if (catalogSongCanManage(arrangement)) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'work-card-action';
    edit.textContent = '編輯';
    edit.addEventListener('click', () => editCatalogSong(arrangement));
    const unlist = document.createElement('button');
    unlist.type = 'button';
    unlist.className = 'work-card-action is-danger';
    unlist.textContent = '下架';
    unlist.addEventListener('click', () => unlistCatalogSong(arrangement));
    actions.append(edit, unlist);
  } else {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'work-card-action is-add';
    if (catalogSongIsAdded(arrangement)) markCatalogAddButtonAdded(add);
    else {
      add.textContent = '＋ 加入';
      add.addEventListener('click', () => addCatalogSong(arrangement, add));
    }
    actions.appendChild(add);
  }

  row.append(details, actions);
  return row;
}

function setWorkCardExpanded(card, expanded, { animate = false } = {}) {
  if (!card) return;
  const summary = card.querySelector('.work-card-summary');
  const panel = card.querySelector('.work-card-preview');
  const art = card.querySelector('.song-card-art');
  const copy = card.querySelector('.work-card-copy');
  const beforeArt = animate && art ? art.getBoundingClientRect() : null;
  const beforeCopy = animate && copy ? copy.getBoundingClientRect() : null;

  card.classList.toggle('is-expanded', expanded);
  if (panel) panel.hidden = !expanded;
  summary?.setAttribute('aria-expanded', String(expanded));
  const expandLabel = card.querySelector('.work-card-expand-label');
  if (expandLabel) expandLabel.textContent = expanded ? '收合版本' : '查看版本';

  if (!animate || typeof art?.animate !== 'function') return;
  requestAnimationFrame(() => {
    const afterArt = art.getBoundingClientRect();
    if (beforeArt?.width && afterArt.width) {
      const dx = beforeArt.left - afterArt.left;
      const dy = beforeArt.top - afterArt.top;
      const sx = beforeArt.width / afterArt.width;
      const sy = beforeArt.height / afterArt.height;
      art.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, transformOrigin: 'top left' },
        { transform: 'none', transformOrigin: 'top left' }
      ], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    if (copy && beforeCopy) {
      const afterCopy = copy.getBoundingClientRect();
      copy.animate([
        { transform: `translate(${beforeCopy.left - afterCopy.left}px, ${beforeCopy.top - afterCopy.top}px)` },
        { transform: 'none' }
      ], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  });
}

function toggleWorkCard(workId, card) {
  const next = expandedCatalogWorkId === workId ? null : workId;
  document.querySelectorAll('.work-card.is-expanded').forEach(openCard => {
    if (openCard !== card) setWorkCardExpanded(openCard, false, { animate: true });
  });
  expandedCatalogWorkId = next;
  setWorkCardExpanded(card, next === workId, { animate: true });
}

function workCard(work) {
  const card = document.createElement('article');
  card.className = 'song-card work-card';
  card.dataset.workId = work.workId || work.id || '';
  const expanded = expandedCatalogWorkId === card.dataset.workId;
  if (expanded) card.classList.add('is-expanded');

  const summary = document.createElement('button');
  summary.type = 'button';
  summary.className = 'work-card-summary';
  summary.setAttribute('aria-expanded', String(expanded));
  summary.setAttribute('aria-label', `${work.name || '曲譜'}，${expanded ? '收合' : '查看'}版本`);
  const art = createCoverArt(work);
  const copy = document.createElement('div');
  copy.className = 'song-card-body work-card-copy';
  const title = document.createElement('h3');
  title.textContent = work.name || '未命名曲譜';
  const artist = document.createElement('p');
  artist.className = 'song-card-artist';
  artist.textContent = work.artist || 'OpenGuitarTAB 公共曲譜';
  const album = document.createElement('p');
  album.className = 'work-card-album';
  album.textContent = work.album || '';
  album.hidden = !work.album;
  const badges = document.createElement('div');
  badges.className = 'work-card-badges';
  workCardPlayStyles(work).forEach(playStyle => {
    const badge = createPlayStyleBadge(playStyle);
    if (badge) badges.appendChild(badge);
  });
  const footer = document.createElement('div');
  footer.className = 'work-card-summary-footer';
  const count = document.createElement('span');
  count.className = 'work-card-arrangement-count';
  const arrangementCount = Array.isArray(work.arrangements) ? work.arrangements.length : 0;
  count.textContent = `${arrangementCount} 個版本`;
  const expandLabel = document.createElement('span');
  expandLabel.className = 'work-card-expand-label';
  expandLabel.textContent = expanded ? '收合版本' : '查看版本';
  footer.append(count, expandLabel);
  copy.append(title, artist, album, badges, footer);
  summary.append(art, copy);
  summary.addEventListener('click', () => toggleWorkCard(card.dataset.workId, card));

  const preview = document.createElement('div');
  preview.className = 'work-card-preview';
  preview.hidden = !expanded;
  const previewHead = document.createElement('div');
  previewHead.className = 'work-card-preview-head';
  const heading = document.createElement('strong');
  heading.textContent = '版本';
  const hint = document.createElement('span');
  hint.textContent = '每個版本保留自己的難度、玩法與操作';
  previewHead.append(heading, hint);
  const list = document.createElement('div');
  list.className = 'work-card-arrangements';
  (work.arrangements || []).forEach(arrangement => list.appendChild(arrangementRow(work, arrangement)));
  preview.append(previewHead, list);

  card.append(summary, preview);
  return card;
}

function workMatchesQuery(work, query) {
  if (!query) return true;
  const values = [work?.name, work?.artist, work?.album];
  for (const arrangement of work?.arrangements || []) {
    values.push(arrangement?.source, arrangement?.uploadedBy, playStyleLabel(arrangement?.playStyle));
  }
  return values.filter(Boolean).some(value => String(value).toLocaleLowerCase().includes(query));
}

function renderCatalog() {
  const query = catalogSearchInput.value.trim().toLocaleLowerCase();
  const filtered = catalogWorks.filter(work => workMatchesQuery(work, query));
  if (expandedCatalogWorkId && !filtered.some(work => String(work.workId || work.id) === expandedCatalogWorkId)) {
    expandedCatalogWorkId = null;
  }
  catalogGrid.innerHTML = '';
  filtered.forEach(work => catalogGrid.appendChild(workCard(work)));
  catalogCount.textContent = `${filtered.length} 首作品`;
  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = '找不到符合條件的作品。';
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
  songs.forEach(song => libraryGrid.appendChild(librarySongCard(song)));
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
    catalogWorks = Array.isArray(result.works) ? result.works : [];
    renderCatalog();
  } catch (error) {
    console.error(error);
    catalogWorks = [];
    expandedCatalogWorkId = null;
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
      ? '管理員可管理公共曲譜與其他使用者已發布的原始曲譜；所有權不會因管理員編輯而改變。'
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
  if (catalogSongCanManage(meta) || catalogSongIsAdded(meta)) {
    markCatalogAddButtonAdded(button, { animate: true });
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
  const meta = findCatalogArrangement(id);
  if (!meta) { setRoute('#/catalog'); return; }
  try {
    previewSong = await fetchCatalogSong(meta);
    const previewId = meta.arrangementId || meta.id || meta.songId;
    previewSong.id = `preview:${previewId}`;
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
    addPreviewSongButton.hidden = catalogSongCanManage(meta) || catalogSongIsAdded(meta);
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
  downloadSongButton.hidden = false;
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
catalogSearchInput.addEventListener('input', renderCatalog);
libraryNewSongButton.addEventListener('click', () => {
  if (!window.authState?.user) openLoginModal('#/library');
  else openNewSongModal();
});
editorBackButton.addEventListener('click', () => setRoute(previousNonEditorRoute));
addPreviewSongButton.addEventListener('click', () => {
  const fileId = previewSong?._catalogFileId || previewSong?._driveFileId;
  const meta = catalogArrangements().find(song => String(song._driveFileId || '') === String(fileId || ''))
    || catalogArrangements().find(song => `preview:${song.arrangementId || song.id}` === currentSongId);
  if (meta) addCatalogSong(meta);
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMobileMenu(); });
mobileQuery.addEventListener('change', event => { if (!event.matches) closeMobileMenu(); });
window.addEventListener('hashchange', handleRoute);
window.addEventListener('opentab:auth-changed', async event => {
  const pendingRoute = event.detail?.pendingRoute;
  expandedCatalogWorkId = null;
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
