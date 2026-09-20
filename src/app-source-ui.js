(() => {
  const SOURCE_INPUT_ID = 'publishSourceInput';
  const STYLE_CONTROL_ID = 'publishPlayStyleToggle';
  const DIFFICULTY_INPUT_ID = 'publishDifficultyInput';
  const DIFFICULTY_VALUE_ID = 'publishDifficultyValue';

  function clampDifficulty(value) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.min(5, Math.max(1, number)) : 3;
  }

  function validPlayStyle(value) {
    return value === 'chord' || value === 'fingerstyle' ? value : '';
  }

  function ensurePublishControls() {
    const uploader = document.querySelector('#publishModal .publish-uploader');
    if (!uploader) return {};

    let sourceInput = document.getElementById(SOURCE_INPUT_ID);
    if (!sourceInput) {
      const sourceLabel = document.createElement('label');
      sourceLabel.className = 'publish-field';
      sourceLabel.htmlFor = SOURCE_INPUT_ID;
      sourceLabel.textContent = '來源';

      sourceInput = document.createElement('input');
      sourceInput.className = 'rename-input';
      sourceInput.id = SOURCE_INPUT_ID;
      sourceInput.type = 'text';
      sourceInput.maxLength = 120;
      sourceInput.autocomplete = 'off';
      sourceInput.placeholder = '例如：17jita';
      uploader.before(sourceLabel, sourceInput);
    }

    let styleToggle = document.getElementById(STYLE_CONTROL_ID);
    if (!styleToggle) {
      const styleLabel = document.createElement('div');
      styleLabel.className = 'publish-field publish-extra-label';
      styleLabel.textContent = '類型';

      styleToggle = document.createElement('div');
      styleToggle.id = STYLE_CONTROL_ID;
      styleToggle.className = 'publish-style-toggle';
      styleToggle.setAttribute('role', 'radiogroup');
      styleToggle.setAttribute('aria-label', '曲譜類型');
      styleToggle.dataset.value = 'fingerstyle';

      [['fingerstyle', '指彈'], ['chord', '和弦']].forEach(([value, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'publish-style-option';
        button.dataset.value = value;
        button.textContent = label;
        button.setAttribute('role', 'radio');
        button.addEventListener('click', () => setPlayStyle(value));
        styleToggle.appendChild(button);
      });
      sourceInput.after(styleLabel, styleToggle);
    }

    let difficultyInput = document.getElementById(DIFFICULTY_INPUT_ID);
    if (!difficultyInput) {
      const difficultyLabel = document.createElement('div');
      difficultyLabel.className = 'publish-field publish-difficulty-label';
      difficultyLabel.innerHTML = `難度 <span id="${DIFFICULTY_VALUE_ID}" class="publish-difficulty-value">3</span>`;

      difficultyInput = document.createElement('input');
      difficultyInput.id = DIFFICULTY_INPUT_ID;
      difficultyInput.className = 'publish-difficulty-range';
      difficultyInput.type = 'range';
      difficultyInput.min = '1';
      difficultyInput.max = '5';
      difficultyInput.step = '1';
      difficultyInput.value = '3';
      difficultyInput.setAttribute('aria-label', '難度 1 到 5');
      difficultyInput.addEventListener('input', updateDifficultyValue);
      styleToggle.after(difficultyLabel, difficultyInput);
    }

    setPlayStyle(styleToggle.dataset.value || 'fingerstyle');
    updateDifficultyValue();
    return { sourceInput, styleToggle, difficultyInput };
  }

  function setPlayStyle(value) {
    const toggle = document.getElementById(STYLE_CONTROL_ID);
    if (!toggle) return;
    const normalized = validPlayStyle(value) || 'fingerstyle';
    toggle.dataset.value = normalized;
    toggle.querySelectorAll('.publish-style-option').forEach(button => {
      const active = button.dataset.value === normalized;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    });
  }

  function updateDifficultyValue() {
    const input = document.getElementById(DIFFICULTY_INPUT_ID);
    const value = document.getElementById(DIFFICULTY_VALUE_ID);
    if (!input || !value) return;
    const difficulty = clampDifficulty(input.value);
    input.value = String(difficulty);
    value.textContent = String(difficulty);
  }

  function fillPublishFields() {
    const controls = ensurePublishControls();
    const song = typeof currentSong === 'function' ? currentSong() : null;
    if (!song) return;
    if (controls.sourceInput) controls.sourceInput.value = String(song.source || '');
    setPlayStyle(validPlayStyle(song.playStyle) || 'fingerstyle');
    if (controls.difficultyInput) controls.difficultyInput.value = String(clampDifficulty(song.difficulty));
    updateDifficultyValue();
  }

  function applyPublishFields() {
    const controls = ensurePublishControls();
    const song = typeof currentSong === 'function' ? currentSong() : null;
    if (!song) return;
    song.source = controls.sourceInput?.value.trim() || '';
    song.playStyle = validPlayStyle(controls.styleToggle?.dataset.value) || 'fingerstyle';
    song.difficulty = clampDifficulty(controls.difficultyInput?.value);
  }

  function catalogSongForCard(card) {
    const fileId = card?.dataset?.catalogFileId;
    if (!fileId || !Array.isArray(catalogSongs)) return null;
    return catalogSongs.find(song => String(song?._driveFileId || '') === fileId) || null;
  }

  function playStyleLabel(song) {
    if (song?.playStyle === 'fingerstyle') return '指彈';
    if (song?.playStyle === 'chord') return '和弦';
    return '未設定';
  }

  function difficultyLabel(song) {
    const value = Number(song?.difficulty);
    return Number.isFinite(value) && value >= 1 && value <= 5 ? `難度 ${Math.round(value)}` : '難度 -';
  }

  function catalogUpdatedDate(song) {
    const raw = song?._driveModifiedTime || song?.updatedAt;
    const date = raw ? new Date(raw) : null;
    if (!date || Number.isNaN(date.getTime())) return '--------';
    const year = String(date.getFullYear()).padStart(4, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  function ensureCatalogMenu(card, song) {
    let more = card.querySelector('.catalog-card-more');
    let menu = card.querySelector('.catalog-card-menu');

    if (!more) {
      more = document.createElement('button');
      more.type = 'button';
      more.className = 'catalog-card-more';
      more.textContent = '⋯';
      more.setAttribute('aria-label', `${song?.name || '曲譜'} 資訊選單`);
      card.appendChild(more);
    }

    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'catalog-card-menu';
      menu.hidden = true;
      card.appendChild(menu);
    }

    let info = menu.querySelector('.catalog-card-info');
    if (!info) {
      info = document.createElement('div');
      info.className = 'catalog-card-info';
      menu.appendChild(info);
    }

    const source = String(song?.source || '').trim() || '未提供';
    const uploader = song?.uploadedBy || song?.owner || 'OpenGuitarTAB';
    const lines = [
      ['catalog-card-info-title', '資訊：'],
      ['catalog-card-info-line', `來源 ${source}`],
      ['catalog-card-info-line', `由 ${uploader} 上傳`],
      ['catalog-card-info-line', `更新時間：${catalogUpdatedDate(song)}`]
    ];
    const signature = lines.map(([, text]) => text).join('\n');
    if (info.dataset.signature !== signature) {
      info.replaceChildren(...lines.map(([className, text]) => {
        const line = document.createElement('div');
        line.className = className;
        line.textContent = text;
        return line;
      }));
      info.dataset.signature = signature;
    }
  }

  function decorateCatalogCards() {
    catalogGrid?.querySelectorAll('.song-card[data-catalog-file-id]').forEach(card => {
      const song = catalogSongForCard(card);
      if (!song) return;

      card.querySelectorAll('.song-card-source').forEach(line => line.remove());

      const meta = card.querySelector('.song-card-meta');
      if (meta) {
        const signature = `${playStyleLabel(song)}|${difficultyLabel(song)}`;
        if (meta.dataset.catalogBadges !== signature) {
          const style = document.createElement('span');
          style.textContent = playStyleLabel(song);
          const difficulty = document.createElement('span');
          difficulty.textContent = difficultyLabel(song);
          meta.replaceChildren(style, difficulty);
          meta.dataset.catalogBadges = signature;
        }
      }

      ensureCatalogMenu(card, song);
    });
  }

  function syncCatalogMenus() {
    catalogGrid?.querySelectorAll('.song-card[data-catalog-file-id]').forEach(card => {
      const fileId = card.dataset.catalogFileId || '';
      const isOpen = Boolean(catalogMenuOpenFor && catalogMenuOpenFor === fileId);
      const menu = card.querySelector('.catalog-card-menu');
      const button = card.querySelector('.catalog-card-more');
      if (menu && menu.hidden === isOpen) menu.hidden = !isOpen;
      if (button) button.setAttribute('aria-expanded', String(isOpen));
    });
  }

  ensurePublishControls();

  downloadSongButton?.addEventListener('click', fillPublishFields);
  publishConfirm?.addEventListener('click', applyPublishFields, true);
  publishArtistInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') applyPublishFields();
  }, true);

  document.getElementById(SOURCE_INPUT_ID)?.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    publishConfirm?.click();
  });

  document.addEventListener('click', event => {
    const moreButton = event.target.closest('.catalog-card-more');
    if (moreButton) {
      const card = moreButton.closest('.song-card[data-catalog-file-id]');
      if (!card) return;
      event.preventDefault();
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

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && catalogMenuOpenFor) {
      catalogMenuOpenFor = null;
      syncCatalogMenus();
    }
  });

  const observer = new MutationObserver(() => {
    decorateCatalogCards();
    syncCatalogMenus();
  });
  if (catalogGrid) observer.observe(catalogGrid, { childList: true, subtree: true });

  decorateCatalogCards();
  syncCatalogMenus();
})();
