    function calculateSongMenuPosition(buttonRect) {
      const menuWidth = 132;
      const menuHeight = 96;
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
      songs.forEach(song => {
        const item = makeDiv('song-item');
        if (song.id === currentSongId) item.classList.add('active');
        const loadButton = document.createElement('button');
        loadButton.type = 'button'; loadButton.className = 'song-load-button'; loadButton.textContent = song.name || '未命名曲譜'; loadButton.title = song.name || '未命名曲譜';
        loadButton.addEventListener('click', () => setRoute(`#/editor/${encodeURIComponent(song.id)}`));
        const moreButton = document.createElement('button');
        moreButton.type = 'button'; moreButton.className = 'song-more-button'; moreButton.innerHTML = '⋯'; moreButton.setAttribute('aria-label', `${song.name} 設定選單`);
        if (menuOpenFor === song.id) moreButton.classList.add('open');
        moreButton.addEventListener('click', event => {
          event.stopPropagation();
          if (menuOpenFor === song.id) { closeSongMenu(); return; }
          const rect = moreButton.getBoundingClientRect();
          menuOpenFor = song.id; menuPosition = calculateSongMenuPosition(rect); renderSongList();
        });
        const menu = makeDiv('song-menu');
        if (menuOpenFor === song.id) {
          menu.classList.add('open');
          if (menuPosition) { menu.style.left = `${menuPosition.left}px`; menu.style.top = `${menuPosition.top}px`; }
        }
        const rename = document.createElement('button'); rename.type = 'button'; rename.className = 'song-menu-action'; rename.textContent = '重新命名'; rename.addEventListener('click', event => { event.stopPropagation(); renameSong(song.id); });
        const del = document.createElement('button'); del.type = 'button'; del.className = 'song-menu-action danger'; del.textContent = '刪除'; del.addEventListener('click', event => { event.stopPropagation(); deleteSong(song.id); });
        menu.append(rename, del); item.append(loadButton, moreButton, menu); songList.appendChild(item);
      });
    }

    function loadSong(id) {
      const song = songs.find(item => item.id === id);
      if (!song) return;
      currentSongId = id;
      activeBeatsPerMeasure = normalizeBeatsPerMeasure(song.beatsPerMeasure);
      meterBadge.textContent = `每小節 ${activeBeatsPerMeasure} 拍`;
      menuOpenFor = null; menuPosition = null;
      tempoInput.value = clamp(Number(song.tempo) || 120, 30, 300);
      capoInput.value = clamp(Math.round(Number(song.capo) || 0), 0, 12);
      playIndex = 0;
      renderRows(song.rows); renderSongList(); writeStorage();
    }

    function renameSong(id) {
      const song = songs.find(item => item.id === id); if (!song) return;
      renameTargetId = id; menuOpenFor = null; menuPosition = null; renderSongList();
      renameInput.value = song.name || '未命名曲譜'; renameModal.classList.add('open'); renameModal.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => { renameInput.focus(); renameInput.select(); });
    }

    function closeRenameModal() { renameModal.classList.remove('open'); renameModal.setAttribute('aria-hidden', 'true'); renameTargetId = null; }

    function confirmRenameSong() {
      const song = songs.find(item => item.id === renameTargetId);
      if (!song) { closeRenameModal(); return; }
      const cleanName = renameInput.value.trim();
      if (!cleanName) { showToast('名稱不能空白'); renameInput.focus(); return; }
      song.name = cleanName; song.updatedAt = Date.now(); writeStorage(); renderSongList(); renderLibraryGrid(); closeRenameModal(); showToast('已重新命名');
    }

    function deleteSong(id) {
      const song = songs.find(item => item.id === id); if (!song) return;
      deleteTargetId = id; menuOpenFor = null; menuPosition = null; renderSongList();
      deleteSongName.textContent = `「${song.name || '未命名曲譜'}」`; deleteModal.classList.add('open'); deleteModal.setAttribute('aria-hidden', 'false'); requestAnimationFrame(() => deleteConfirm.focus());
    }

    function closeDeleteModal() { deleteModal.classList.remove('open'); deleteModal.setAttribute('aria-hidden', 'true'); deleteTargetId = null; }

    function confirmDeleteSong() {
      const id = deleteTargetId;
      const song = songs.find(item => item.id === id);
      if (!song) { closeDeleteModal(); return; }
      songs = songs.filter(item => item.id !== id);
      if (songs.length === 0) songs.push({ id: uid(), name: '空白曲譜', tempo: 120, capo: 0, beatsPerMeasure: 4, rows: blankRows(INITIAL_ROWS, 4), createdAt: Date.now(), updatedAt: Date.now() });
      if (currentSongId === id) currentSongId = songs[0].id;
      closeDeleteModal(); menuOpenFor = null; menuPosition = null; writeStorage(); renderSongList(); renderLibraryGrid(); setRoute('#/library'); showToast('已刪除曲譜');
    }

    function openNewSongModal() { newSongModal.classList.add('open'); newSongModal.setAttribute('aria-hidden', 'false'); requestAnimationFrame(() => newSongFourBeats.focus()); }
    function closeNewSongModal() { newSongModal.classList.remove('open'); newSongModal.setAttribute('aria-hidden', 'true'); }

    function createNewSong(beatsPerMeasure) {
      const beats = normalizeBeatsPerMeasure(beatsPerMeasure);
      const baseName = '未命名曲譜'; let index = 1; let name = `${baseName} ${index}`;
      const existingNames = new Set(songs.map(song => song.name));
      while (existingNames.has(name)) { index += 1; name = `${baseName} ${index}`; }
      const song = { id: uid(), name, tempo: 120, capo: 0, beatsPerMeasure: beats, rows: blankRows(INITIAL_ROWS, beats), createdAt: Date.now(), updatedAt: Date.now() };
      songs.unshift(song); currentSongId = song.id; activeBeatsPerMeasure = beats; menuOpenFor = null; menuPosition = null; closeNewSongModal(); writeStorage();
      tempoInput.value = song.tempo; capoInput.value = song.capo; playIndex = 0; renderRows(song.rows); renderSongList(); meterBadge.textContent = `每小節 ${beats} 拍`; renderLibraryGrid(); setRoute(`#/editor/${encodeURIComponent(song.id)}`); showToast(`已新增 ${beats} 拍空白曲譜`);
    }

    function showToast(message) {
      toast.textContent = message; toast.classList.add('show');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
    }

    document.addEventListener('click', event => { if (!event.target.closest('.song-item') && !event.target.closest('.song-menu')) closeSongMenu(); });
    songList.addEventListener('scroll', closeSongMenu); window.addEventListener('resize', closeSongMenu);
    renameCancel.addEventListener('click', closeRenameModal); renameConfirm.addEventListener('click', confirmRenameSong);
    renameInput.addEventListener('keydown', event => { if (event.key === 'Enter') confirmRenameSong(); if (event.key === 'Escape') closeRenameModal(); });
    renameModal.addEventListener('click', event => { if (event.target === renameModal) closeRenameModal(); });
    deleteCancel.addEventListener('click', closeDeleteModal); deleteConfirm.addEventListener('click', confirmDeleteSong); deleteModal.addEventListener('click', event => { if (event.target === deleteModal) closeDeleteModal(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeSongMenu(); if (renameModal.classList.contains('open')) closeRenameModal(); if (deleteModal.classList.contains('open')) closeDeleteModal(); if (newSongModal.classList.contains('open')) closeNewSongModal(); } });
    addRowButton.addEventListener('click', addTabSystem); removeRowButton.addEventListener('click', removeLastTabSystem); saveSongButton.addEventListener('click', saveCurrentSong); downloadSongButton.addEventListener('click', downloadCurrentSong); newSongButton.addEventListener('click', openNewSongModal);
    uploadJsonButton.addEventListener('click', () => uploadJsonInput.click()); uploadJsonInput.addEventListener('change', () => importSongFile(uploadJsonInput.files?.[0]));
    newSongCancel.addEventListener('click', closeNewSongModal); newSongThreeBeats.addEventListener('click', () => createNewSong(3)); newSongFourBeats.addEventListener('click', () => createNewSong(4)); newSongModal.addEventListener('click', event => { if (event.target === newSongModal) closeNewSongModal(); });
    playButton.addEventListener('click', () => { if (isPlaying) stopPlayback(); else startPlayback(); });
    rhythmToggleButton.addEventListener('click', () => { const rows = readRowsFromDom(); saveRowsToCurrentSong(rows, false); setScoreViewEnabled(!scoreViewEnabled); renderRows(rows); });
    tempoInput.addEventListener('change', () => { const song = currentSong(); if (song) song.tempo = getTempo(); });
    capoInput.addEventListener('change', () => { const song = currentSong(); if (song) song.capo = getCapo(); });
    playProgress.addEventListener('input', event => setProgressIndex(Number(event.target.value), false, true));
