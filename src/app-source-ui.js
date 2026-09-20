(() => {
  const SOURCE_INPUT_ID = 'publishSourceInput';

  function ensurePublishSourceInput() {
    let input = document.getElementById(SOURCE_INPUT_ID);
    if (input) return input;

    const uploader = document.querySelector('#publishModal .publish-uploader');
    if (!uploader) return null;

    const label = document.createElement('label');
    label.className = 'publish-field';
    label.htmlFor = SOURCE_INPUT_ID;
    label.textContent = '來源';

    input = document.createElement('input');
    input.className = 'rename-input';
    input.id = SOURCE_INPUT_ID;
    input.type = 'text';
    input.maxLength = 120;
    input.autocomplete = 'off';
    input.placeholder = '例如：17jita';

    uploader.before(label, input);
    return input;
  }

  function fillPublishSource() {
    const input = ensurePublishSourceInput();
    const song = typeof currentSong === 'function' ? currentSong() : null;
    if (input) input.value = String(song?.source || '');
  }

  function applyPublishSource() {
    const input = ensurePublishSourceInput();
    const song = typeof currentSong === 'function' ? currentSong() : null;
    if (!input || !song) return;
    song.source = input.value.trim();
  }

  function catalogSongForCard(card) {
    const fileId = card?.dataset?.catalogFileId;
    if (!fileId || !Array.isArray(catalogSongs)) return null;
    return catalogSongs.find(song => String(song?._driveFileId || '') === fileId) || null;
  }

  function decorateCatalogSources() {
    catalogGrid?.querySelectorAll('.song-card[data-catalog-file-id]').forEach(card => {
      const song = catalogSongForCard(card);
      const uploaderLine = card.querySelector('.song-card-source:not(.song-card-origin)');
      if (!song || !uploaderLine) return;

      let originLine = card.querySelector('.song-card-origin');
      if (!originLine) {
        originLine = document.createElement('p');
        originLine.className = 'song-card-source song-card-origin';
        uploaderLine.after(originLine);
      }
      originLine.textContent = `來源 ${String(song.source || '').trim() || '未提供'}`;
    });
  }

  function syncCatalogMenus() {
    catalogGrid?.querySelectorAll('.song-card[data-catalog-file-id]').forEach(card => {
      const fileId = card.dataset.catalogFileId || '';
      const isOpen = Boolean(catalogMenuOpenFor && catalogMenuOpenFor === fileId);
      const menu = card.querySelector('.catalog-card-menu');
      const button = card.querySelector('.catalog-card-more');
      if (menu) menu.hidden = !isOpen;
      if (button) button.setAttribute('aria-expanded', String(isOpen));
    });
  }

  ensurePublishSourceInput();

  downloadSongButton?.addEventListener('click', fillPublishSource);
  publishConfirm?.addEventListener('click', applyPublishSource, true);
  publishArtistInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') applyPublishSource();
  }, true);

  ensurePublishSourceInput()?.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    publishConfirm?.click();
  });

  document.addEventListener('click', event => {
    const moreButton = event.target.closest('.catalog-card-more');
    if (moreButton) {
      const card = moreButton.closest('.song-card[data-catalog-file-id]');
      if (!card) return;
      event.stopPropagation();
      const fileId = card.dataset.catalogFileId || '';
      catalogMenuOpenFor = catalogMenuOpenFor === fileId ? null : fileId;
      syncCatalogMenus();
      return;
    }

    if (catalogMenuOpenFor && !event.target.closest('.catalog-card-menu')) {
      catalogMenuOpenFor = null;
      syncCatalogMenus();
    }
  }, true);

  const observer = new MutationObserver(() => {
    decorateCatalogSources();
    syncCatalogMenus();
  });
  if (catalogGrid) observer.observe(catalogGrid, { childList: true, subtree: true });

  decorateCatalogSources();
  syncCatalogMenus();
})();
