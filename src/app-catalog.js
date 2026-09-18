    const driveCatalogConfig = window.DRIVE_CATALOG_CONFIG || {};

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
    }

    function songCard(song, { publicSong = false } = {}) {
      const card = document.createElement('article');
      card.className = 'song-card';
      const art = document.createElement('div');
      art.className = 'song-card-art';
      const fallbackArt = document.createElement('span');
      fallbackArt.className = 'song-card-art-fallback';
      fallbackArt.textContent = (song.name || 'TAB').trim().slice(0, 2).toUpperCase();
      art.appendChild(fallbackArt);
      if (song.cover) {
        const image = document.createElement('img');
        image.className = 'song-card-art-image';
        image.src = song.cover;
        image.alt = song.album ? `${song.album} 封面` : `${song.name || '曲譜'} 封面`;
        image.loading = 'lazy';
        image.decoding = 'async';
        image.addEventListener('load', () => art.classList.add('has-image'));
        image.addEventListener('error', () => image.remove());
        art.appendChild(image);
      }
      const body = document.createElement('div');
      body.className = 'song-card-body';
      const title = document.createElement('h3');
      title.textContent = song.name || '未命名曲譜';
      const artist = document.createElement('p');
      artist.textContent = song.artist || (publicSong ? 'OpenGuitarTAB 公共曲譜' : '我的曲譜');
      if (song.album) artist.title = song.album;
      const meta = document.createElement('div');
      meta.className = 'song-card-meta';
      meta.innerHTML = `<span>${Number(song.tempo) || 120} BPM</span><span>Capo ${Number(song.capo) || 0}</span>`;
      const actions = document.createElement('div');
      actions.className = 'song-card-actions';
      const open = document.createElement('button');
      open.className = 'card-primary-button'; open.type = 'button'; open.textContent = publicSong ? '預覽' : '編輯';
      open.addEventListener('click', () => publicSong ? setRoute(`#/preview/${encodeURIComponent(song.id)}`) : setRoute(`#/editor/${encodeURIComponent(song.id)}`));
      actions.appendChild(open);
      if (publicSong) {
        const add = document.createElement('button');
        add.className = 'card-secondary-button'; add.type = 'button'; add.textContent = '＋ 加入'; add.addEventListener('click', () => addCatalogSong(song)); actions.appendChild(add);
      }
      body.append(title, artist, meta, actions); card.append(art, body); return card;
    }

    function renderCatalog() {
      const query = catalogSearchInput.value.trim().toLocaleLowerCase();
      const filtered = catalogSongs.filter(song => !query || [song.name, song.artist, song.album].filter(Boolean).some(value => String(value).toLocaleLowerCase().includes(query)));
      catalogGrid.innerHTML = '';
      filtered.forEach(song => catalogGrid.appendChild(songCard(song, { publicSong: true })));
      catalogCount.textContent = `${filtered.length} 首`;
      if (!filtered.length) {
        const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = '找不到符合條件的曲譜。'; catalogGrid.appendChild(empty);
      }
    }

    function renderLibraryGrid() {
      libraryGrid.innerHTML = '';
      songs.forEach(song => libraryGrid.appendChild(songCard(song)));
      if (!songs.length) {
        const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = '目前沒有曲譜，新增一首開始編輯。'; libraryGrid.appendChild(empty);
      }
    }

    function driveApiKey() {
      const key = String(driveCatalogConfig.apiKey || '').trim();
      if (!key) throw new Error('DRIVE_API_KEY_MISSING');
      return key;
    }

    function driveFolderId() {
      const folderId = String(driveCatalogConfig.folderId || '').trim();
      if (!folderId) throw new Error('DRIVE_FOLDER_ID_MISSING');
      return folderId;
    }

    function driveApiUrl(path, params = {}) {
      const base = String(driveCatalogConfig.apiBaseUrl || 'https://www.googleapis.com/drive/v3').replace(/\/$/, '');
      const url = new URL(`${base}/${path.replace(/^\//, '')}`);
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
      });
      url.searchParams.set('key', driveApiKey());
      return url;
    }

    async function driveFetch(url, label) {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        let detail = '';
        try {
          const body = await response.json();
          detail = body?.error?.message ? `: ${body.error.message}` : '';
        } catch (_) {}
        throw new Error(`${label} failed: ${response.status}${detail}`);
      }
      return response;
    }

    async function listDriveCatalogFiles() {
      const files = [];
      let pageToken = '';
      const folderId = driveFolderId();
      do {
        const url = driveApiUrl('files', {
          q: `'${folderId}' in parents and trashed = false`,
          fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size)',
          pageSize: 1000,
          pageToken
        });
        const response = await driveFetch(url, 'Drive file list');
        const payload = await response.json();
        if (Array.isArray(payload.files)) files.push(...payload.files);
        pageToken = payload.nextPageToken || '';
      } while (pageToken);
      return files;
    }

    async function fetchDriveFileText(fileId) {
      const response = await driveFetch(
        driveApiUrl(`files/${encodeURIComponent(fileId)}`, { alt: 'media' }),
        'Drive file load'
      );
      return response.text();
    }

    function catalogFileName(file) {
      return String(file || '').split('/').filter(Boolean).pop() || '';
    }

    async function loadCatalog() {
      try {
        const files = await listDriveCatalogFiles();
        const fileByName = new Map(files.map(file => [file.name, file]));
        const indexFile = fileByName.get('index.json');
        if (!indexFile) throw new Error('Drive catalog index.json not found');

        const indexText = await fetchDriveFileText(indexFile.id);
        const value = JSON.parse(indexText.replace(/^\uFEFF/, ''));
        if (!Array.isArray(value)) throw new Error('Drive catalog index.json must be an array');

        const missingFiles = [];
        catalogSongs = value.map(meta => {
          const fileName = catalogFileName(meta.file);
          const driveFile = fileByName.get(fileName);
          if (!driveFile) missingFiles.push(fileName || meta.id || 'unknown');
          return {
            ...meta,
            driveFileId: driveFile?.id || null,
            driveFileName: fileName
          };
        }).filter(meta => meta.driveFileId);

        if (missingFiles.length) console.warn('Drive catalog missing song files:', missingFiles);
        renderCatalog();
      } catch (error) {
        console.error(error);
        catalogSongs = [];
        const missingKey = error?.message === 'DRIVE_API_KEY_MISSING';
        catalogGrid.innerHTML = `<p class="empty-state">${missingKey ? '公共曲庫尚未設定Google Drive API key。' : '公共曲庫目前無法載入。'}</p>`;
        catalogCount.textContent = '';
      }
    }

    async function fetchCatalogSong(meta) {
      if (!meta.driveFileId) throw new Error(`Drive song file not found: ${meta.driveFileName || meta.id}`);
      const source = normalizeSongRecord(deserializeSong(await fetchDriveFileText(meta.driveFileId)));
      return normalizeSongRecord({
        ...source,
        name: meta.name || source.name,
        artist: source.artist || meta.artist,
        album: source.album || meta.album,
        cover: source.cover || meta.cover
      });
    }

    async function addCatalogSong(meta) {
      try {
        const source = await fetchCatalogSong(meta);
        const copy = deepClone(source);
        copy.id = uid(); copy.createdAt = Date.now(); copy.updatedAt = Date.now();
        songs.unshift(copy); currentSongId = copy.id; previewSong = null; writeStorage(); renderSongList(); renderLibraryGrid(); showToast(`已將 ${copy.name || '曲譜'} 加入個人曲譜櫃`);
      } catch (error) { console.error(error); showToast('加入曲譜櫃失敗'); }
    }

    async function openCatalogPreview(id) {
      const meta = catalogSongs.find(song => song.id === id);
      if (!meta) { setRoute('#/catalog'); return; }
      try {
        previewSong = await fetchCatalogSong(meta);
        previewSong.id = `preview:${meta.id}`;
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
        addPreviewSongButton.hidden = false;
        setScoreViewEnabled(true);
        if (rhythmToggleButton.isConnected) rhythmToggleButton.remove();
        renderRows(previewSong.rows);
        showPage('editor');
      } catch (error) { console.error(error); showToast('曲譜預覽載入失敗'); setRoute('#/catalog'); }
    }

    function openLocalEditor(id) {
      previewSong = null;
      saveSongButton.hidden = false;
      downloadSongButton.hidden = false;
      addPreviewSongButton.hidden = true;
      if (!rhythmToggleButton.isConnected) meterBadge.before(rhythmToggleButton);
      const previewBadge = document.getElementById('previewBadge');
      if (previewBadge) previewBadge.hidden = true;
      setScoreViewEnabled(false);
      loadSong(id);
      const song = currentSong();
      editorTitle.textContent = song?.name || '吉他 TAB 譜製作器';
      showPage('editor');
    }

    function handleRoute() {
      const hash = location.hash || '#/catalog';
      const parts = hash.slice(2).split('/');
      const route = parts[0] || 'catalog';
      const id = parts[1] ? decodeURIComponent(parts.slice(1).join('/')) : null;
      if (route === 'catalog') { previewSong = null; previousNonEditorRoute = '#/catalog'; showPage('catalog'); renderCatalog(); return; }
      if (route === 'library') { previewSong = null; previousNonEditorRoute = '#/library'; renderLibraryGrid(); showPage('library'); return; }
      if (route === 'editor' && id && songs.some(song => song.id === id)) { openLocalEditor(id); return; }
      if (route === 'preview' && id) { openCatalogPreview(id); return; }
      setRoute('#/catalog');
    }

    async function initializeApp() {
      loadStorage(); renderSongList(); renderLibraryGrid(); await loadCatalog();
      if (!location.hash) location.hash = '#/catalog';
      handleRoute();
    }

    catalogNavButton.addEventListener('click', () => setRoute('#/catalog'));
    libraryNavButton.addEventListener('click', () => setRoute('#/library'));
    catalogSearchInput.addEventListener('input', renderCatalog);
    libraryNewSongButton.addEventListener('click', openNewSongModal);
    editorBackButton.addEventListener('click', () => setRoute(previousNonEditorRoute));
    addPreviewSongButton.addEventListener('click', () => {
      const id = currentSongId.replace(/^preview:/, '');
      const meta = catalogSongs.find(song => song.id === id);
      if (meta) addCatalogSong(meta);
    });
    window.addEventListener('hashchange', handleRoute);
    initializeApp();
