let installed = false;

function currentUser() { return window.authState?.user || null; }

export async function importSongFile(file) {
  const input = document.getElementById('uploadJsonInput');
  if (!file) return;
  if (!currentUser()) {
    window.openLoginModal?.('#/library');
    if (input) input.value = '';
    return;
  }
  try {
    const raw = typeof window.deserializeSong === 'function' ? window.deserializeSong(await file.text()) : JSON.parse(await file.text());
    const imported = typeof window.normalizeSongRecord === 'function' ? window.normalizeSongRecord(raw) : raw;
    delete imported._driveFileId;
    delete imported._driveFileName;
    delete imported._driveModifiedTime;
    delete imported.arrangementId;
    imported._opentab = {};
    const records = typeof window.getSongRecords === 'function' ? window.getSongRecords() : [];
    if (!imported.id || records.some(song => song.id === imported.id)) imported.id = typeof window.uid === 'function' ? window.uid() : `song-${Date.now().toString(36)}`;
    if (!imported.name) imported.name = file.name.replace(/\.json$/i, '') || '匯入曲譜';
    imported.createdAt = Number(imported.createdAt) || Date.now();
    imported.updatedAt = Date.now();
    const saved = await window.persistSong(imported);
    window.setCurrentSongId?.(saved.id);
    window.closeNewSongModal?.();
    window.renderSongList?.();
    window.renderLibraryGrid?.();
    if (typeof window.loadCatalog === 'function') await window.loadCatalog();
    window.setRoute?.(`#/editor/${encodeURIComponent(saved.id)}`);
    window.showToast?.(`已匯入 ${saved.name}`);
  } catch (error) {
    console.error(error);
    window.showToast?.(error?.message || 'JSON 匯入失敗');
  } finally {
    if (input) input.value = '';
  }
}

export function installSongImport() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.importSongFile = importSongFile;
}
