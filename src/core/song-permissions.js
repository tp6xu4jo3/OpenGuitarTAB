export function songOwner(song, fallbackOwner = '') {
  return String(song?._opentab?.owner || song?.owner || fallbackOwner || '').trim();
}

export function songWasPublished(song) {
  return Boolean(
    song?._opentab?.publishedAt ||
    song?._opentab?.public === true ||
    song?._opentab?.uploadedBy
  );
}

export function songIsPublic(song) {
  return song?._opentab?.public === true;
}

export function canEditSong(user, song, fallbackOwner = '') {
  if (!user) return false;
  const owner = songOwner(song, fallbackOwner);
  if (!owner) return false;
  if (owner === user.username) return true;
  return user.role === 'admin' && songWasPublished(song);
}

export function canUnlistSong(user, song, fallbackOwner = '') {
  return canEditSong(user, song, fallbackOwner);
}

export function canDeleteSong(user, song, fallbackOwner = '') {
  if (!user) return false;
  const owner = songOwner(song, fallbackOwner);
  return Boolean(owner && owner === user.username);
}
