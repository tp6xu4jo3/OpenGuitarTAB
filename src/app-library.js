    function currentAuthUser() {
      return window.authState?.user || null;
    }

    function isAdminUser() {
      return currentAuthUser()?.role === 'admin';
    }

    function hydrateCloudSong(raw) {
      if (!raw || typeof raw !== 'object') return raw;
      const transient = {
        _driveFileId: raw._driveFileId,
        _driveFileName: raw._driveFileName,
        _driveModifiedTime: raw._driveModifiedTime
      };
      const normalized = normalizeSongRecord(deserializeSong(JSON.stringify(raw)));
      Object.entries(transient).forEach(([key, value]) => { if (value) normalized[key] = value; });
      return normalized;
    }

    function replaceSongRecord(updated) {
      const normalized = hydrateCloudSong(updated);
      const index = songs.findIndex(song =>
        (normalized._driveFileId && song._driveFileId === normalized._driveFileId) || song.id === normalized.id
      );
      if (index >= 0) songs[index] = normalized;
      else songs.unshift(normalized);
      if (!currentSongId || currentSongId === normalized.id || currentSongId === songs[index]?.id) currentSongId = normalized.id;
      return normalized;
    }

    async function persistSongToCloud(song) {
      if (!currentAuthUser()) throw new Error('AUTH_REQUIRED');
      const result = await cloudApi.saveSong(compactSong(song));
      return replaceSongRecord(result.song);
    }

    function calculateSongMenuPosition(buttonRect) {
      const menuWidth = 144;
      const menuHeight = isAdminUser() ? 132 : 96;
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
        if (song?._opentab?.hidden === true && isAdminUser()) {
          const hiddenBadge = document.createElement('span');
          hiddenBadge.className = 'song-hidden-badge';
          hiddenBadge.textContent = '隱藏';
          item.appendChild(hiddenBadge);
        }

        const moreButton = document.createElement('button');
        moreButton.type = 'button';
        moreButton.className = 'song-more-button';
        moreButton.innerHTML = '⋯';
        moreButton.setAttribute('aria-label', `${song.name} 設定選單`);
        if (menuOpenFor === song.id) moreButton.classList.add('open');
        moreButton.addEventListener('click', event => {
          event.stopPropagation();
          if (menuOpenFor === song.id) { closeSongMenu(); return; }
          const rect = moreButton.getBoundingClientRect();
          menuOpenFor = song.id;
          menuPosition = calculateSongMenuPosition(rect);
          renderSongList();
        });

        const menu = makeDiv('song-menu');
        if (menuOpenFor === song.id) {
          menu.classList.add('open');
          if (menuPosition) { menu.style.left = `${menuPosition.left}px`; menu.style.top = `${menuPosition.top}px`; }
        }
        const rename = document.createElement('button');
        rename.type = 'button';
        rename.className = 'song-menu-action';
        rename.textContent = '重新命名';
        rename.addEventListener('click', event => { event.stopPropagation(); renameSong(song.id); });
        menu.appendChild(rename);

        if (isAdminUser()) {
          const hide = document.createElement('button');
          hide.type = 'button';
          hide.className = 'song-menu-action toggle-hidden';
          hide.textContent = song?._opentab?.hidden === true ? '取消隱藏' : '隱藏';
          hide.addEventListener('click', event => { event.stopPropagation(); toggleSongHidden(song); });
          menu.appendChild(hide);
        }

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'song-menu-action danger';
        del.textContent = '刪除';
        del.addEventListener('click', event => { event.stopPropagation(); deleteSong(song.id); });
        menu.appendChild(del);
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
      playIndex = 0;
      renderRows(song.rows);
      renderSongList();
    }

    function renameSong(id) {
      const song = songs.find(item => item.id === id);
      if (!song) return;
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
      if (!song) { closeRenameModal(); return; }
      const cleanName = renameInput.value.trim();
      if (!cleanName) { showToast('名稱不能空白'); renameInput.focus(); return; }
      const previousName = song.name;
      song.name = cleanName;
      song.updatedAt = Date.now();
      try {
        await persistSongToCloud(song);
        renderSongList();
        renderLibraryGrid();
        closeRenameModal();
        if (isAdminUser() && typeof loadCatalog === 'function') await loadCatalog();
        showToast('已重新命名');
      } catch (error) {
        console.error(error);
        song.name = previousName;
        showToast('重新命名失敗');
      }
    }

    function deleteSong(id) {
      const song = songs.find(item => item.id === id);
      if (!song) return;
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
      if (!song) { closeDeleteModal(); return; }
      try {
        if (song._driveFileId) await cloudApi.deleteSong(song._driveFileId);
        songs = songs.filter(item => item.id !== id);
        if (currentSongId === id) currentSongId = songs[0]?.id || null;
        closeDeleteModal();
        menuOpenFor = null;
        menuPosition = null;
        renderSongList();
        renderLibraryGrid();
        if (isAdminUser() && typeof loadCatalog === 'function') await loadCatalog();
        setRoute('#/library');
        showToast('已刪除曲譜');
      } catch (error) {
        console.error(error);
        showToast('刪除失敗');
      }
    }

    async function toggleSongHidden(song) {
      if (!isAdminUser() || !song?._driveFileId) return;
      try {
        const result = await cloudApi.setHidden(song._driveFileId, song?._opentab?.hidden !== true);
        replaceSongRecord(result.song);
        menuOpenFor = null;
        menuPosition = null;
        renderSongList();
        renderLibraryGrid();
        if (typeof loadCatalog === 'function') await loadCatalog();
        showToast(result.song?._opentab?.hidden ? '已從公共曲庫隱藏' : '已重新顯示於公共曲庫');
      } catch (error) {
        console.error(error);
        showToast('更新顯示狀態失敗');
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
        rows: blankRows(INITIAL_ROWS, beats),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      try {
        const saved = await persistSongToCloud(song);
        currentSongId = saved.id;
        activeBeatsPerMeasure = beats;
        menuOpenFor = null;
        menuPosition = null;
        closeNewSongModal();
        tempoInput.value = saved.tempo;
        capoInput.value = saved.capo;
        playIndex = 0;
        renderRows(saved.rows);
        renderSongList();
        meterBadge.textContent = `每小節 ${beats} 拍`;
        renderLibraryGrid();
        if (isAdminUser() && typeof loadCatalog === 'function') await loadCatalog();
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
    document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeSongMenu(); if (renameModal.classList.contains('open')) closeRenameModal(); if (deleteModal.classList.contains('open')) closeDeleteModal(); if (newSongModal.classList.contains('open')) closeNewSongModal(); if (publishModal.classList.contains('open')) closePublishModal(); } });
    addRowButton.addEventListener('click', addTabSystem);
    removeRowButton.addEventListener('click', removeLastTabSystem);
    saveSongButton.addEventListener('click', saveCurrentSong);
    downloadSongButton.addEventListener('click', openPublishModal);
    publishCancel.addEventListener('click', closePublishModal);
    publishConfirm.addEventListener('click', confirmPublishSong);
    publishArtistInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') confirmPublishSong();
      if (event.key === 'Escape') closePublishModal();
    });
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
    playButton.addEventListener('click', () => { if (isPlaying) stopPlayback(); else startPlayback(); });
    rhythmToggleButton.addEventListener('click', () => { const rows = readRowsFromDom(); saveRowsToCurrentSong(rows, false); setScoreViewEnabled(!scoreViewEnabled); renderRows(rows); });
    tempoInput.addEventListener('change', () => { const song = currentSong(); if (song) song.tempo = getTempo(); });
    capoInput.addEventListener('change', () => { const song = currentSong(); if (song) song.capo = getCapo(); });
    playProgress.addEventListener('input', event => setProgressIndex(Number(event.target.value), false, true));
