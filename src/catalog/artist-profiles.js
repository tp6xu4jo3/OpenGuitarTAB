const ARTIST_PROFILES = Object.freeze({
  '周杰倫': Object.freeze({
    image: 'https://r2.theaudiodb.com/images/media/artist/thumb/1xuf2r1779253287.jpg'
  })
});

export function artistProfileFor(artist) {
  return ARTIST_PROFILES[String(artist || '').trim()] || null;
}

export function allArtistProfiles() {
  return ARTIST_PROFILES;
}
