let publishInProgress = false;
let saveInProgress = false;
let installed = false;

function currentSongSafe() { return typeof window.currentSong === 'function' ? window.currentSong() : null; }
function currentUser() { return window.authState?.user || null; }
function refreshLibraryViews() { window.renderSongList?.(); window.renderLibraryGrid?.(); }
async function refreshCatalogIfNeeded() {
  if (typeof window.isAdminUser === 'function' && window.isAdminUser() && typeof window.loadCatalog === 'function') await window.loadCatalog();
}

function prepareCurrentSong() {
  const song = currentSongSafe();
  if (!song) return null;
  const store = window.editorV3?.getStore?.({ reconcile: false });
  if (store) return window.editorV3.sync.prepareForPersistence(store) || song;
  if (typeof window.getTempo === 'function') song.tempo = window.getTempo();
  if (typeof window.getCapo === 'function') song.capo = window.getCapo();
  song.updatedAt = Date.now();
  return song;
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent || '';
    button.disabled = true;
    button.classList.add('is-busy');
    button.replaceChildren();
    const spinner = document.createElement('span');
    spinner.className = 'button-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = label;
    button.append(spinner, text);
    button.setAttribute('aria-busy', 'true');
    return;
  }
  button.disabled = false;
  button.classList.remove('is-busy');
  button.removeAttribute('aria-busy');
  button.textContent = button.dataset.idleLabel || '';
  delete button.dataset.idleLabel;
}

export async function saveCurrentSong() {
  if (saveInProgress) return;
  const song = prepareCurrentSong();
  if (!song || !currentUser()) { window.openLoginModal?.('#/library'); return; }
  const saveButton = document.getElementById('saveSongButton');
  saveInProgress = true;
  setBusy(saveButton, true, '儲存中');
  try {
    const saved = await window.persistSong(song);
    const title = document.getElementById('editorTitle');
    if (title) title.textContent = saved?.name || '吉他 TAB 譜製作器';
    refreshLibraryViews();
    await refreshCatalogIfNeeded();
    window.showToast?.(window.dataSource?.isLocalTest ? '已儲存到瀏覽器測試資料' : '已儲存到Google Drive');
  } catch (error) {
    console.error(error);
    window.showToast?.('儲存失敗');
  } finally {
    saveInProgress = false;
    setBusy(saveButton, false, '');
  }
}

export function closePublishModal() {
  if (publishInProgress) return;
  const modal = document.getElementById('publishModal');
  const error = document.getElementById('publishError');
  modal?.classList.remove('open');
  modal?.setAttribute('aria-hidden', 'true');
  if (error) error.textContent = '';
}

export function openPublishModal() {
  if (window.dataSource?.isLocalTest && !window.dataSource?.capabilities?.publish) {
    window.showToast?.('GitHub Test不提供發布；編輯內容會保存在此瀏覽器');
    return;
  }
  const song = prepareCurrentSong();
  if (!song || !currentUser()) { window.openLoginModal?.('#/library'); return; }
  const modal = document.getElementById('publishModal');
  const artist = document.getElementById('publishArtistInput');
  const uploader = document.getElementById('publishUploader');
  const error = document.getElementById('publishError');
  if (artist) artist.value = String(song.artist || '');
  if (uploader) uploader.textContent = currentUser()?.username || '';
  if (error) error.textContent = '';
  modal?.classList.add('open');
  modal?.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => { artist?.focus(); artist?.select(); });
}

export async function confirmPublishSong() {
  if (publishInProgress) return;
  const song = currentSongSafe();
  const artistInput = document.getElementById('publishArtistInput');
  const error = document.getElementById('publishError');
  const confirm = document.getElementById('publishConfirm');
  const cancel = document.getElementById('publishCancel');
  const artist = artistInput?.value.trim() || '';
  if (!song || !currentUser()) { closePublishModal(); window.openLoginModal?.('#/library'); return; }
  if (!window.dataSource?.capabilities?.publish) { closePublishModal(); window.showToast?.('GitHub Test不提供發布'); return; }
  if (!artist) { if (error) error.textContent = '請輸入作者（歌手）。'; artistInput?.focus(); return; }
  prepareCurrentSong();
  song.artist = artist;
  song._opentab = { ...(song._opentab || {}), uploadedBy: currentUser().username };
  publishInProgress = true;
  setBusy(confirm, true, '上傳中');
  if (cancel) cancel.disabled = true;
  try {
    const payload = typeof window.compactSong === 'function' ? window.compactSong(song) : song;
    const result = await window.dataSource.publishSong(payload);
    const admin = typeof window.isAdminUser === 'function' && window.isAdminUser();
    const updated = admin ? result.song : result.privateSong;
    if (updated) window.replaceSongRecord?.(updated);
    if (typeof window.loadCatalog === 'function') await window.loadCatalog();
    refreshLibraryViews();
    const modal = document.getElementById('publishModal');
    modal?.classList.remove('open');
    modal?.setAttribute('aria-hidden', 'true');
    window.showToast?.(admin ? '已更新公共曲庫' : '已上傳到公共曲庫');
  } catch (errorValue) {
    console.error(errorValue);
    if (error) error.textContent = errorValue?.message === 'SAVE_BEFORE_PUBLISH' ? '請先儲存曲譜。' : '上傳公共曲庫失敗，請稍後再試。';
  } finally {
    publishInProgress = false;
    setBusy(confirm, false, '');
    if (cancel) cancel.disabled = false;
  }
}

export function installEditorSongActions() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  Object.assign(window, { saveCurrentSong, openPublishModal, closePublishModal, confirmPublishSong });
}
