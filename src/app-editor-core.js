    function rhythmPositionPercent(position) {
      return ((position + 1) / positionsPerRow()) * 100;
    }

    function appendRhythmMark(layer, className, leftPercent, widthPercent = null) {
      const mark = makeDiv(className);
      mark.style.left = `${leftPercent}%`;
      if (widthPercent !== null) mark.style.width = `${Math.max(0.3, widthPercent)}%`;
      layer.appendChild(mark);
      return mark;
    }

    function renderRhythmNotation(rowIndex) {
      const layer = document.querySelector(`.rhythm-layer[data-row="${rowIndex}"]`);
      if (!layer) return;
      layer.innerHTML = '';
      const gridStyles = getComputedStyle(layer.closest('.tab-grid'));
      const rowHeight = parseFloat(gridStyles.getPropertyValue('--row-height')) || 32;
      const valueHeight = parseFloat(gridStyles.getPropertyValue('--value-height')) || 34;
      const stemEnd = parseFloat(gridStyles.getPropertyValue('--stem-end')) || 35;
      const staffHeight = rowHeight * STRINGS;
      const onsets = [];
      const positions = positionsPerRow();
      const measureSlots = slotsPerMeasure();
      const explicitRhythm = currentSong()?.rhythmRows?.[rowIndex];
      if (explicitRhythm && Object.keys(explicitRhythm).length > 0) {
        for (const [rawPosition, rawDuration] of Object.entries(explicitRhythm)) {
          const position = Number(rawPosition);
          if (position < 0 || position >= positions) continue;
          const notes = getFilledInputsAt(rowIndex, position);
          const lowestString = notes.length > 0 ? Math.max(...notes.map(input => Number(input.dataset.string))) : STRINGS - 1;
          onsets.push({ position, duration: Number(rawDuration), lowestString });
        }
        onsets.sort((a, b) => a.position - b.position);
      } else {
        for (let position = 0; position < positions; position++) {
          const notes = getFilledInputsAt(rowIndex, position);
          if (notes.length > 0) onsets.push({ position, duration: 1, lowestString: Math.max(...notes.map(input => Number(input.dataset.string))) });
        }
        onsets.forEach((onset, index) => {
          const measureEnd = (Math.floor(onset.position / measureSlots) + 1) * measureSlots;
          const next = onsets[index + 1];
          onset.duration = Math.max(1, Math.min(next && next.position < measureEnd ? next.position - onset.position : measureEnd - onset.position, measureSlots));
        });
      }
      onsets.forEach(onset => {
        const left = rhythmPositionPercent(onset.position);
        if (onset.duration < measureSlots || activeBeatsPerMeasure === 3) {
          const stem = appendRhythmMark(layer, 'rhythm-stem', left);
          const stemTop = onset.lowestString * rowHeight + rowHeight / 2 + valueHeight / 2 + 2 - staffHeight;
          stem.style.top = `${stemTop}px`;
          stem.style.height = `${stemEnd - stemTop}px`;
        }
        if ([3, 6, 12].includes(onset.duration)) appendRhythmMark(layer, 'rhythm-dot', left);
      });
      const groupSlots = rhythmGroupSlots();
      for (let measure = 0; measure < MEASURES; measure++) {
        for (let groupStart = 0; groupStart < measureSlots; groupStart += groupSlots) {
          const beatStart = measure * measureSlots + groupStart;
          const beatEnd = beatStart + groupSlots;
          const beatOnsets = onsets.filter(onset => onset.position >= beatStart && onset.position < beatEnd);
          const primary = beatOnsets.filter(onset => onset.duration <= 3);
          if (primary.length >= 2) {
            const first = rhythmPositionPercent(primary[0].position);
            const last = rhythmPositionPercent(primary[primary.length - 1].position);
            appendRhythmMark(layer, 'rhythm-beam primary', first, last - first);
          } else if (primary.length === 1) appendRhythmMark(layer, 'rhythm-flag primary', rhythmPositionPercent(primary[0].position));
          const sixteenths = primary.filter(onset => onset.duration === 1);
          let run = [];
          const flushSecondaryRun = () => {
            if (run.length >= 2) {
              const first = rhythmPositionPercent(run[0].position);
              const last = rhythmPositionPercent(run[run.length - 1].position);
              appendRhythmMark(layer, 'rhythm-beam secondary', first, last - first);
            } else if (run.length === 1) {
              const onset = run[0];
              const onsetIndex = primary.indexOf(onset);
              if (primary.length === 1) appendRhythmMark(layer, 'rhythm-flag secondary', rhythmPositionPercent(onset.position));
              else {
                const previous = primary[onsetIndex - 1];
                const next = primary[onsetIndex + 1];
                let direction = 'right';
                if (!next) direction = 'left';
                else if (previous) direction = onset.position - previous.position < next.position - onset.position ? 'left' : 'right';
                const partialWidth = (0.65 / positions) * 100;
                const onsetLeft = rhythmPositionPercent(onset.position);
                appendRhythmMark(layer, 'rhythm-beam secondary partial', direction === 'left' ? onsetLeft - partialWidth : onsetLeft, partialWidth);
              }
            }
            run = [];
          };
          sixteenths.forEach(onset => { if (run.length && onset.position !== run[run.length - 1].position + 1) flushSecondaryRun(); run.push(onset); });
          flushSecondaryRun();
        }
      }
    }

    function setScoreViewEnabled(enabled) {
      scoreViewEnabled = Boolean(enabled);
      const content = rhythmToggleButton.closest('.content');
      content.classList.toggle('edit-view', !scoreViewEnabled);
      content.classList.toggle('score-view', scoreViewEnabled);
      rhythmToggleButton.setAttribute('aria-pressed', String(scoreViewEnabled));
      const label = rhythmToggleButton.querySelector('.mode-toggle-label');
      if (label) label.textContent = '看譜模式';
      rhythmToggleButton.setAttribute('aria-label', scoreViewEnabled ? '看譜模式已開啟，關閉看譜模式' : '看譜模式已關閉，開啟看譜模式');
    }

    function renderRows(rows) {
      stopPlayback();
      const normalized = normalizeRows(rows, activeBeatsPerMeasure);
      tabArea.innerHTML = '';
      if (scoreViewEnabled) {
        for (let rowIndex = 0; rowIndex < normalized.length; rowIndex += 2) {
          const scoreSystem = makeDiv('tab-system score-system');
          scoreSystem.dataset.centerKey = `pair-${Math.floor(rowIndex / 2)}`;
          const pair = makeDiv('score-grid-pair');
          [rowIndex, rowIndex + 1].forEach(logicalRow => {
            if (logicalRow >= normalized.length) return;
            const logicalSystem = createTabSystem(logicalRow, normalized.length);
            pair.appendChild(logicalSystem.querySelector('.tab-grid'));
          });
          scoreSystem.appendChild(pair);
          tabArea.appendChild(scoreSystem);
        }
      } else {
        normalized.forEach((_, rowIndex) => { const system = createTabSystem(rowIndex, normalized.length); system.dataset.centerKey = `row-${rowIndex}`; tabArea.appendChild(system); });
      }
      normalized.forEach((row, rowIndex) => {
        row.forEach((stringValues, string) => {
          stringValues.forEach((value, position) => {
            const input = getInput(rowIndex, string, position);
            if (!input) return;
            input.value = value;
            input.classList.toggle('has-value', value.length > 0);
          });
        });
        renderRhythmNotation(rowIndex);
      });
      updateRemoveRowButton();
      updateProgressRange();
      setProgressIndex(Math.min(playIndex, totalSlots() - 1), true, true);
    }

    function handleInput(event) {
      const input = event.target;
      input.value = normalizeTabValue(input.value);
      input.classList.toggle('has-value', input.value.length > 0);
      jumpToInput(input, false);
      renderRhythmNotation(Number(input.dataset.row));
      if (input.value.length === 2) focusRelative(input, 0, 1);
    }

    function handleKeydown(event) {
      const input = event.target;
      const allowedControlKeys = ['Backspace', 'Delete', 'Tab', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
      if (event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); focusRelative(input, 0, 1); return; }
      if (event.key === 'ArrowLeft') { event.preventDefault(); focusRelative(input, 0, -1); return; }
      if (event.key === 'ArrowDown') { event.preventDefault(); focusRelative(input, 1, 0); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); focusRelative(input, -1, 0); return; }
      if (event.key === 'Enter') { event.preventDefault(); focusRelative(input, 1, 0); return; }
      if (!allowedControlKeys.includes(event.key) && !/^[\dxX]$/.test(event.key)) event.preventDefault();
    }

    function focusRelative(current, stringDelta, positionDelta) {
      let row = Number(current.dataset.row);
      let string = Number(current.dataset.string) + stringDelta;
      let position = Number(current.dataset.position) + positionDelta;
      const positions = positionsPerRow();
      if (position >= positions) { position = 0; string += 1; }
      else if (position < 0) { position = positions - 1; string -= 1; }
      if (string >= STRINGS) { string = 0; row += 1; }
      else if (string < 0) { string = STRINGS - 1; row -= 1; }
      const next = getInput(row, string, position);
      if (next) { next.focus(); next.select(); }
    }

    function getInput(row, string, position) {
      return document.querySelector(`.note-input[data-row="${row}"][data-string="${string}"][data-position="${position}"]`);
    }

    function addTabSystem() {
      const rows = readRowsFromDom(); rows.push(blankRow()); renderRows(rows); saveRowsToCurrentSong(rows, false); showToast('已新增一列');
    }

    function removeLastTabSystem() {
      const rows = readRowsFromDom(); if (rows.length <= 1) return; rows.pop(); renderRows(rows); saveRowsToCurrentSong(rows, false); showToast('已刪除最下面一列');
    }

    function updateRemoveRowButton() { removeRowButton.disabled = document.querySelectorAll('.tab-grid[data-row]').length <= 1; }

    function readRowsFromDom() {
      const rowIndices = Array.from(document.querySelectorAll('.tab-grid[data-row]'), grid => Number(grid.dataset.row));
      const rowCount = rowIndices.length ? Math.max(...rowIndices) + 1 : 1;
      const rows = Array.from({ length: rowCount }, () => blankRow());
      document.querySelectorAll('.note-input').forEach(input => {
        const row = Number(input.dataset.row), string = Number(input.dataset.string), position = Number(input.dataset.position);
        if (!rows[row] || !rows[row][string]) return;
        rows[row][string][position] = normalizeTabValue(input.value);
      });
      return rows;
    }

    function saveRowsToCurrentSong(rows, persist = false) {
      const song = currentSong(); if (!song) return;
      song.rows = normalizeRows(rows, song.beatsPerMeasure);
      song.tempo = getTempo();
      song.capo = getCapo();
      song.updatedAt = Date.now();
      renderSongList();
      renderLibraryGrid();
    }

    async function saveCurrentSong() {
      const song = currentSong();
      if (!song || !window.authState?.user) { openLoginModal('#/library'); return; }
      saveRowsToCurrentSong(readRowsFromDom(), false);
      try {
        const saved = await persistSongToCloud(song);
        currentSongId = saved.id;
        editorTitle.textContent = saved.name || '吉他 TAB 譜製作器';
        renderSongList();
        renderLibraryGrid();
        if (isAdminUser() && typeof loadCatalog === 'function') await loadCatalog();
        showToast('已儲存到Google Drive');
      } catch (error) {
        console.error(error);
        showToast('儲存失敗');
      }
    }

    function sanitizeFileName(value) {
      const cleaned = String(value || '未命名曲譜').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
      return cleaned || '未命名曲譜';
    }

    async function downloadCurrentSong() {
      const song = currentSong();
      if (!song || !window.authState?.user) { openLoginModal('#/library'); return; }
      saveRowsToCurrentSong(readRowsFromDom(), false);
      try {
        const result = await cloudApi.publishSong(compactSong(song));
        const updated = isAdminUser() ? result.song : result.privateSong;
        if (updated) {
          const saved = replaceSongRecord(updated);
          currentSongId = saved.id;
        }
        if (typeof loadCatalog === 'function') await loadCatalog();
        renderSongList();
        renderLibraryGrid();
        showToast(isAdminUser() ? '已更新公共曲庫' : '已上傳到公共曲庫');
      } catch (error) {
        console.error(error);
        showToast(error?.message === 'SAVE_BEFORE_PUBLISH' ? '請先儲存曲譜' : '上傳公共曲庫失敗');
      }
    }

    async function importSongFile(file) {
      if (!file) return;
      if (!window.authState?.user) { openLoginModal('#/library'); uploadJsonInput.value = ''; return; }
      try {
        const imported = normalizeSongRecord(deserializeSong(await file.text()));
        delete imported._driveFileId;
        delete imported._driveFileName;
        delete imported._driveModifiedTime;
        imported._opentab = {};
        if (!imported.id || songs.some(song => song.id === imported.id)) imported.id = uid();
        if (!imported.name) imported.name = file.name.replace(/\.json$/i, '') || '匯入曲譜';
        imported.createdAt = Number(imported.createdAt) || Date.now();
        imported.updatedAt = Date.now();
        const saved = await persistSongToCloud(imported);
        currentSongId = saved.id;
        closeNewSongModal();
        renderSongList();
        renderLibraryGrid();
        if (isAdminUser() && typeof loadCatalog === 'function') await loadCatalog();
        setRoute(`#/editor/${encodeURIComponent(saved.id)}`);
        showToast(`已匯入 ${saved.name}`);
      } catch (error) {
        console.error(error);
        showToast(error?.message || 'JSON 匯入失敗');
      } finally {
        uploadJsonInput.value = '';
      }
    }

    function copyRow(rowIndex) { const rows = readRowsFromDom(); rowClipboard = deepClone(rows[rowIndex]); showToast(`已複製第 ${rowIndex + 1} 列`); }

    function pasteRow(rowIndex) {
      if (!rowClipboard) { showToast('目前沒有可貼上的列'); return; }
      const rows = readRowsFromDom(); rows[rowIndex] = deepClone(rowClipboard); renderRows(rows); saveRowsToCurrentSong(rows, false); showToast(`已貼到第 ${rowIndex + 1} 列`);
    }

    function swapRow(fromIndex, toIndex) {
      const rows = readRowsFromDom(); if (!rows[fromIndex] || !rows[toIndex]) return;
      [rows[fromIndex], rows[toIndex]] = [rows[toIndex], rows[fromIndex]]; renderRows(rows); saveRowsToCurrentSong(rows, false); showToast(`已交換第 ${fromIndex + 1} 列與第 ${toIndex + 1} 列`);
    }
