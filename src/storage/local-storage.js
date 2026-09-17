export function readLocalLibrary(storageKey, currentIdKey) {
  let songs = [];
  let currentSongId = null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) songs = parsed;
    }
    currentSongId = localStorage.getItem(currentIdKey);
  } catch (error) {
    console.warn('讀取本機曲譜失敗', error);
  }
  return { songs, currentSongId };
}

export function writeLocalLibrary(storageKey, currentIdKey, songs, currentSongId) {
  localStorage.setItem(storageKey, JSON.stringify(songs));
  if (currentSongId) localStorage.setItem(currentIdKey, currentSongId);
  else localStorage.removeItem(currentIdKey);
}
