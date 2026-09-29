function cleanText(value) {
  return String(value ?? '').trim();
}

function cleanUrl(value) {
  return cleanText(value);
}

export function normalizeArtistMedia(raw) {
  const artists = raw?.artists && typeof raw.artists === 'object' && !Array.isArray(raw.artists)
    ? raw.artists
    : {};
  const normalized = { version: 2, artists: {} };

  for (const [artistName, rawProfile] of Object.entries(artists)) {
    const artist = cleanText(artistName);
    if (!artist || !rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) continue;
    const profile = { image: cleanUrl(rawProfile.image), albums: {}, songs: {} };
    const rawAlbums = rawProfile.albums && typeof rawProfile.albums === 'object' && !Array.isArray(rawProfile.albums)
      ? rawProfile.albums
      : {};
    for (const [albumName, rawAlbum] of Object.entries(rawAlbums)) {
      const album = cleanText(albumName);
      if (!album) continue;
      const cover = typeof rawAlbum === 'string' ? cleanUrl(rawAlbum) : cleanUrl(rawAlbum?.cover);
      if (cover) profile.albums[album] = { cover };
    }
    const rawSongs = rawProfile.songs && typeof rawProfile.songs === 'object' && !Array.isArray(rawProfile.songs)
      ? rawProfile.songs
      : {};
    for (const [songId, rawSong] of Object.entries(rawSongs)) {
      const id = cleanText(songId);
      if (!id) continue;
      const cover = typeof rawSong === 'string' ? cleanUrl(rawSong) : cleanUrl(rawSong?.cover);
      if (cover) profile.songs[id] = { cover };
    }
    normalized.artists[artist] = profile;
  }

  return normalized;
}

export function mediaForArtist(raw, artistName) {
  const media = normalizeArtistMedia(raw);
  return media.artists[cleanText(artistName)] || null;
}

export function mediaForSong(raw, song) {
  const profile = mediaForArtist(raw, song?.artist);
  if (!profile) return { artistImage: '', cover: '' };
  const album = cleanText(song?.album);
  const songId = cleanText(song?.id || song?.songId);
  return {
    artistImage: cleanUrl(profile.image),
    cover: cleanUrl(profile.albums?.[album]?.cover) || cleanUrl(profile.songs?.[songId]?.cover)
  };
}

export function enrichSongMedia(song, raw) {
  if (!song || typeof song !== 'object' || Array.isArray(song)) return song;
  const media = mediaForSong(raw, song);
  return {
    ...song,
    artistImage: media.artistImage,
    cover: media.cover
  };
}
