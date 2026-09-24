function currentAuthUser() {
  return window.authState?.user || null;
}

function isAdminUser() {
  return currentAuthUser()?.role === 'admin';
}

function hydrateSong(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const transient = {
    workId: raw.workId,
    arrangementId: raw.arrangementId,
    _driveFileId: raw._driveFileId,
    _driveFileName: raw._driveFileName,
    _driveModifiedTime: raw._driveModifiedTime,
    _opentab: raw._opentab
  };
  const normalized = normalizeSongRecord(deserializeSong(JSON.stringify(raw)));
  Object.entries(transient).forEach(([key, value]) => { if (value !== undefined && value !== null) normalized[key] = value; });
  return normalized;
}

function replaceSongRecord(updated) {
  const normalized = hydrateSong(updated);
  const index = songs.findIndex(song =>
    (normalized._driveFileId && song._driveFileId === normalized._driveFileId)
    || (normalized.arrangementId && song.arrangementId === normalized.arrangementId)
    || song.id === normalized.id
  );
  if (index >= 0) songs[index] = normalized;
  else songs.unshift(normalized);
  if (!currentSongId || currentSongId === normalized.id) currentSongId = normalized.id;
  return normalized;
}

async function persistSong(song) {
  if (!currentAuthUser()) throw new Error('AUTH_REQUIRED');
  ensureSongDocumentV3(song);
  const result = await dataSource.saveSong(compactSong(song));
  return replaceSongRecord(result.song);
}

function libraryActionsFor(song) {
  const user = currentAuthUser();
  return {
    edit: canEditSong(user, song),
    visibility: Boolean(dataSource.capabilities?.visibility && canUnlistSong(user, song) && songWasPublished(song)),
    delete: canDeleteSong(user, song)
  };
}

function calculateSongMenuPosition(buttonRect) {
  const menuWidth = 148;
  const menuHeight = 140;
  const gap = 6;
  const margin = 8;
  let left = buttonRect.right - menuWidth;
  let top = buttonRect.bottom + gap;
  left = clamp(left, margin, window.innerWidth - menuWidth - margin);
  if (top + menuHeight > window.innerHeight - margin) top = buttonRect.top - menuHeight - gap;
  top = clamp(top, margin, window.innerHeight - menuHeight - margin);
  return { left, top };
}

function closeSongMenu() {
  if (!menuOpenFor && !menuPosition) return;
  menuOpenFor = null;
  menuPosition = null;
  renderSongList();
}

function renderSongList() {
  songList.innerHTML = '';
  const user = currentAuthUser();
  newSongButton.hidden = !user;
  if (!user) {
    const login = document.createElement('button');
    login.type = 'button';
    login.className = 'sidebar-login-button';
    login.textContent = '登入';
    login.addEventListener('click', () => openLoginModal('#/library'));
    songList.appendChild(login);
    return;
  }

  songs.forEach(song => {
    const item = makeDiv('song-item');
    if (song.id === currentSongId) item.classList.add('active');
    const loadButton = document.createElement('button');
    loadButton.type = 'button';
    loadButton.className = 'song-load-button';
    loadButton.textContent = song.name || '未命名曲譜';
    loadButton.title = song.name || '未命名曲譜';
    loadButton.addEventListener('click', () => setRoute(`#/editor/${encodeURIComponent(song.id)}`));

    if (songWasPublished(song) && !songIsPublic(song)) {
      const badge = document.createElement('span');
      badge.className = 'song-hidden-badge';
      badge.textContent = '已下架';
      item.appendChild(badge);
    }

    const permissions = libraryActionsFor(song);
    const hasMenu = permissions.edit || permissions.visibility || permissions.delete;
    const moreButton = document.createElement('button');
    moreButton.type = 'button';
    moreButton.className = 'song-more-button';
    moreButton.textContent = '⋯';
    moreButton.hidden = !hasMenu;
    moreButton.setAttribute('aria-label', `${song.name || '曲譜'} 設定選單`);
    moreButton.classList.toggle('open', menuOpenFor === song.id);
    moreButton.addEventListener('click', event => {
      event.stopPropagation();
      if (menuOpenFor === song.id) { closeSongMenu(); return; }
      menuOpenFor = song.id;
      menuPosition = calculateSongMenuPosition(moreButton.getBoundingClientRect());
      renderSongList();
    });

    const menu = makeDiv('song-menu');
    if (menuOpenFor === song.id) {
      menu.classList.add('open');
      if (menuPosition) { menu.style.left = `${menuPosition.left}px`; menu.style.top = `${menuPosition.top}px`; }
    }
    if (permissions.edit) {
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'song-menu-action';
      rename.textContent = '重新命名';
      rename.addEventListener('click', event => { event.stopPropagation(); renameSong(song.id); });
      menu.appendChild(rename);
    }
    if (permissions.visibility) {
      const visibility = document.createElement('button');
      visibility.type = 'button';
      visibility.className = 'song-menu-action toggle-hidden';
      visibility.textContent = songIsPublic(song) ? '下架' : '重新上架';
      visibility.addEventListener('click', event => { event.stopPropagation(); toggleSongPublic(song); });
      menu.appendChild(visibility);
    }
    if (permissions.delete) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'song-menu-action danger';
      del.textContent = '刪除';
      del.addEventListener('click', event => { event.stopPropagation(); requestDeleteSong(song.id); });
      menu.appendChild(del);
    }
    item.append(loadButton, moreButton, menu);
    songList.appendChild(item);
  });

  if (!songs.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = '目前沒有曲譜。';
    songList.appendChild(empty);
  }
}

function loadSong(id) {
  const song = songs.find(item => item.id === id);
  if (!song) return;
  currentSongId = id;
  activeBeatsPerMeasure = normalizeBeatsPerMeasure(song.beatsPerMeasure);
  meterBadge.textContent = `每小節 ${activeBeatsPerMeasure} 拍`;
  menuOpenFor = null;
  menuPosition = null;
  tempoInput.value = clamp(Number(song.tempo) || 120, 30, 300);
  capoInput.value = clamp(Math.round(Number(song.capo) || 0), 0, 12);
  window.editorV3?.renderCurrentSong?.();
  window.editorPlayback?.setIndex?.(0, { highlight: false });
  renderSongList();
}

function renameSong(id) {
  const song = songs.find(item => item.id === id);
  if (!song || !canEditSong(currentAuthUser(), song)) return;
  renameTargetId = id;
  menuOpenFor = null;
  menuPosition = null;
  renderSongList();
  renameInput.value = song.name || '未命名曲譜';
  renameModal.classList.add('open');
  renameModal.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => { renameInput.focus(); renameInput.select(); });
}

function closeRenameModal() {
  renameModal.classList.remove('open');
  renameModal.setAttribute('aria-hidden', 'true');
  renameTargetId = null;
}

async function confirmRenameSong() {
  const song = songs.find(item => item.id === renameTargetId);
  if (!song || !canEditSong(currentAuthUser(), song)) { closeRenameModal(); return; }
  const cleanName = renameInput.value.trim();
  if (!cleanName) { showToast('名稱不能空白'); renameInput.focus(); return; }
  const previousName = song.name;
  song.name = cleanName;
  song.updatedAt = Date.now();
  try {
    await persistSong(song);
    renderSongList();
    renderLibraryGrid();
    closeRenameModal();
    if (typeof loadCatalog === 'function') await loadCatalog();
    showToast('已重新命名');
  } catch (error) {
    console.error(error);
    song.name = previousName;
    showToast('重新命名失敗');
  }
}

function requestDeleteSong(id) {
  const song = songs.find(item => item.id === id);
  if (!song || !canDeleteSong(currentAuthUser(), song)) return;
  deleteTargetId = id;
  menuOpenFor = null;
  menuPosition = null;
  renderSongList();
  deleteSongName.textContent = `「${song.name || '未命名曲譜'}」`;
  deleteModal.classList.add('open');
  deleteModal.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => deleteConfirm.focus());
}

function closeDeleteModal() {
  deleteModal.classList.remove('open');
  deleteModal.setAttribute('aria-hidden', 'true');
  deleteTargetId = null;
}

async function confirmDeleteSong() {
  const id = deleteTargetId;
  const song = songs.find(item => item.id === id);
  if (!song || !canDeleteSong(currentAuthUser(), song)) { closeDeleteModal(); return; }
  try {
    if (song._driveFileId) await dataSource.deleteSong(song._driveFileId);
    songs = songs.filter(item => item.id !== id);
    if (currentSongId === id) currentSongId = songs[0]?.id || null;
    closeDeleteModal();
    menuOpenFor = null;
    menuPosition = null;
    renderSongList();
    renderLibraryGrid();
    if (typeof loadCatalog === 'function') await loadCatalog();
    setRoute('#/library');
    showToast('已刪除曲譜');
  } catch (error) {
    console.error(error);
    showToast(error?.message === 'DELETE_FORBIDDEN' ? '只有曲譜擁有者可以刪除' : '刪除失敗');
  }
}

async function toggleSongPublic(song) {
  if (!dataSource.capabilities?.visibility || !song?._driveFileId || !canUnlistSong(currentAuthUser(), song) || !songWasPublished(song)) return;
  const makePublic = !songIsPublic(song);
  try {
    const result = await dataSource.setPublic(song._driveFileId, makePublic);
    replaceSongRecord(result.song);
    menuOpenFor = null;
    menuPosition = null;
    renderSongList();
    renderLibraryGrid();
    if (typeof loadCatalog === 'function') await loadCatalog();
    showToast(makePublic ? '已重新上架至公共曲庫' : '已從公共曲庫下架');
  } catch (error) {
    console.error(error);
    showToast('更新公共狀態失敗');
  }
}

function openNewSongModal() {
  if (!currentAuthUser()) { openLoginModal('#/library'); return; }
  const blankOptions = document.getElementById('blankSongOptions');
  if (blankOptions) blankOptions.hidden = true;
  newSongModal.classList.add('open');
  newSongModal.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => document.getElementById('blankSongChoice')?.focus());
}

function closeNewSongModal() {
  newSongModal.classList.remove('open');
  newSongModal.setAttribute('aria-hidden', 'true');
}

async function createNewSong(beatsPerMeasure) {
  if (!currentAuthUser()) { openLoginModal('#/library'); return; }
  const beats = normalizeBeatsPerMeasure(beatsPerMeasure);
  const baseName = '未命名曲譜';
  let index = 1;
  let name = `${baseName} ${index}`;
  const existingNames = new Set(songs.map(song => song.name));
  while (existingNames.has(name)) { index += 1; name = `${baseName} ${index}`; }
  const song = {
    id: uid(),
    name,
    tempo: 120,
    capo: 0,
    beatsPerMeasure: beats,
    document: createBlankDocumentV3({ beats, systems: 4, measuresPerSystem: 4 }),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  try {
    const saved = await persistSong(song);
    currentSongId = saved.id;
    activeBeatsPerMeasure = beats;
    menuOpenFor = null;
    menuPosition = null;
    closeNewSongModal();
    tempoInput.value = saved.tempo;
    capoInput.value = saved.capo;
    window.editorV3?.renderCurrentSong?.();
    window.editorPlayback?.setIndex?.(0, { highlight: false });
    renderSongList();
    meterBadge.textContent = `每小節 ${beats} 拍`;
    renderLibraryGrid();
    if (typeof loadCatalog === 'function') await loadCatalog();
    setRoute(`#/editor/${encodeURIComponent(saved.id)}`);
    showToast(`已新增 ${beats} 拍空白曲譜`);
  } catch (error) {
    console.error(error);
    showToast('新增曲譜失敗');
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
}

document.addEventListener('click', event => { if (!event.target.closest('.song-item') && !event.target.closest('.song-menu')) closeSongMenu(); });
songList.addEventListener('scroll', closeSongMenu);
window.addEventListener('resize', closeSongMenu);
renameCancel.addEventListener('click', closeRenameModal);
renameConfirm.addEventListener('click', confirmRenameSong);
renameInput.addEventListener('keydown', event => { if (event.key === 'Enter') confirmRenameSong(); if (event.key === 'Escape') closeRenameModal(); });
renameModal.addEventListener('click', event => { if (event.target === renameModal) closeRenameModal(); });
deleteCancel.addEventListener('click', closeDeleteModal);
deleteConfirm.addEventListener('click', confirmDeleteSong);
deleteModal.addEventListener('click', event => { if (event.target === deleteModal) closeDeleteModal(); });
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  closeSongMenu();
  if (renameModal.classList.contains('open')) closeRenameModal();
  if (deleteModal.classList.contains('open')) closeDeleteModal();
  if (newSongModal.classList.contains('open')) closeNewSongModal();
  if (publishModal.classList.contains('open')) closePublishModal();
});
addRowButton.addEventListener('click', addTabSystem);
removeRowButton.addEventListener('click', removeLastTabSystem);
saveSongButton.addEventListener('click', saveCurrentSong);
downloadSongButton.addEventListener('click', openPublishModal);
publishCancel.addEventListener('click', closePublishModal);
publishConfirm.addEventListener('click', confirmPublishSong);
publishArtistInput.addEventListener('keydown', event => { if (event.key === 'Enter') confirmPublishSong(); if (event.key === 'Escape') closePublishModal(); });
publishModal.addEventListener('click', event => { if (event.target === publishModal) closePublishModal(); });
newSongButton.addEventListener('click', openNewSongModal);
document.getElementById('blankSongChoice')?.addEventListener('click', () => {
  const blankOptions = document.getElementById('blankSongOptions');
  if (blankOptions) blankOptions.hidden = false;
  newSongFourBeats.focus();
});
uploadJsonButton.addEventListener('click', () => uploadJsonInput.click());
uploadJsonInput.addEventListener('change', () => importSongFile(uploadJsonInput.files?.[0]));
newSongCancel.addEventListener('click', closeNewSongModal);
newSongThreeBeats.addEventListener('click', () => createNewSong(3));
newSongFourBeats.addEventListener('click', () => createNewSong(4));
newSongModal.addEventListener('click', event => { if (event.target === newSongModal) closeNewSongModal(); });
tempoInput.addEventListener('change', () => { const song = currentSong(); if (song) song.tempo = getTempo(); });
capoInput.addEventListener('change', () => { const song = currentSong(); if (song) song.capo = getCapo(); });
playProgress.addEventListener('input', event => { window.editorPlayback?.setIndex?.(Number(event.target.value), { updateSlider: false, highlight: true }); });

Object.assign(window, {
  currentAuthUser,
  isAdminUser,
  hydrateSong,
  replaceSongRecord,
  persistSong,
  libraryActionsFor,
  renderSongList,
  loadSong,
  requestDeleteSong,
  toggleSongPublic,
  openNewSongModal,
  closeNewSongModal,
  showToast
});
