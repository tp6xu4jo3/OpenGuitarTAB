    const STRINGS = 6;
    const MEASURES = 4;
    const STEPS_PER_BEAT = 2;
    const SLOTS_PER_BEAT = 4;
    const INITIAL_ROWS = 4;
    const STORAGE_KEY = 'guitar-tab-maker:songs:v2';
    const CURRENT_ID_KEY = 'guitar-tab-maker:current-song-id:v2';

    const STRING_TUNING = [
      { name: 'E4', frequency: 329.6275569128699 },
      { name: 'B3', frequency: 246.94165062806206 },
      { name: 'G3', frequency: 195.99771799008746 },
      { name: 'D3', frequency: 146.8323839587038 },
      { name: 'A2', frequency: 110.0 },
      { name: 'E2', frequency: 82.4068892282175 }
    ];

    const tabArea = document.getElementById('tabArea');
    const addRowButton = document.getElementById('addRow');
    const removeRowButton = document.getElementById('removeRow');
    const playButton = document.getElementById('playButton');
    const rhythmToggleButton = document.getElementById('rhythmToggleButton');
    const meterBadge = document.getElementById('meterBadge');
    const capoInput = document.getElementById('capoInput');
    const tempoInput = document.getElementById('tempoInput');
    const saveSongButton = document.getElementById('saveSongButton');
    const downloadSongButton = document.getElementById('downloadSongButton');
    const newSongButton = document.getElementById('newSongButton');
    const songList = document.getElementById('songList');
    const playProgress = document.getElementById('playProgress');
    const progressLabel = document.getElementById('progressLabel');
    const toast = document.getElementById('toast');
    const renameModal = document.getElementById('renameModal');
    const renameInput = document.getElementById('renameInput');
    const renameCancel = document.getElementById('renameCancel');
    const renameConfirm = document.getElementById('renameConfirm');
    const deleteModal = document.getElementById('deleteModal');
    const deleteSongName = document.getElementById('deleteSongName');
    const deleteCancel = document.getElementById('deleteCancel');
    const deleteConfirm = document.getElementById('deleteConfirm');
    const newSongModal = document.getElementById('newSongModal');
    const newSongThreeBeats = document.getElementById('newSongThreeBeats');
    const newSongFourBeats = document.getElementById('newSongFourBeats');
    const newSongCancel = document.getElementById('newSongCancel');
    const uploadJsonButton = document.getElementById('uploadJsonButton');
    const uploadJsonInput = document.getElementById('uploadJsonInput');
    const catalogView = document.getElementById('catalogView');
    const libraryView = document.getElementById('libraryView');
    const editorView = document.getElementById('editorView');
    const catalogNavButton = document.getElementById('catalogNavButton');
    const libraryNavButton = document.getElementById('libraryNavButton');
    const catalogSearchInput = document.getElementById('catalogSearchInput');
    const catalogGrid = document.getElementById('catalogGrid');
    const catalogCount = document.getElementById('catalogCount');
    const libraryGrid = document.getElementById('libraryGrid');
    const libraryNewSongButton = document.getElementById('libraryNewSongButton');
    const editorBackButton = document.getElementById('editorBackButton');
    const editorTitle = document.getElementById('editorTitle');
    const addPreviewSongButton = document.getElementById('addPreviewSongButton');
    const publishModal = document.getElementById('publishModal');
    const publishArtistInput = document.getElementById('publishArtistInput');
    const publishUploader = document.getElementById('publishUploader');
    const publishError = document.getElementById('publishError');
    const publishCancel = document.getElementById('publishCancel');
    const publishConfirm = document.getElementById('publishConfirm');

    let songs = [];
    let currentSongId = null;
    let rowClipboard = null;
    let scoreViewEnabled = true;
    let audioContext = null;
    let masterGain = null;
    let compressor = null;
    const activeStringVoices = Array(STRINGS).fill(null);
    let playbackTimer = null;
    let isPlaying = false;
    let currentPlayhead = null;
    let lastCenteredPlaybackRow = -1;
    let playIndex = 0;
    let toastTimer = null;
    let menuOpenFor = null;
    let menuPosition = null;
    let renameTargetId = null;
    let deleteTargetId = null;
    let activeBeatsPerMeasure = 4;
    let catalogSongs = [];
    let previewSong = null;
    let previousNonEditorRoute = '#/catalog';
    let publishInProgress = false;

    function normalizeBeatsPerMeasure(value) {
      return Number(value) === 3 ? 3 : 4;
    }

    function stepsPerMeasure(beats = activeBeatsPerMeasure) {
      return normalizeBeatsPerMeasure(beats) * STEPS_PER_BEAT;
    }

    function slotsPerMeasure(beats = activeBeatsPerMeasure) {
      return normalizeBeatsPerMeasure(beats) * SLOTS_PER_BEAT;
    }

    function stepsPerRow(beats = activeBeatsPerMeasure) {
      return MEASURES * stepsPerMeasure(beats);
    }

    function positionsPerRow(beats = activeBeatsPerMeasure) {
      return MEASURES * slotsPerMeasure(beats);
    }

    function rhythmGroupSlots(beats = activeBeatsPerMeasure) {
      return normalizeBeatsPerMeasure(beats) === 3 ? 6 : SLOTS_PER_BEAT;
    }

    function makeDiv(className) {
      const div = document.createElement('div');
      div.className = className;
      return div;
    }

    function uid(prefix = 'song') {
      return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function deepClone(value) {
      return JSON.parse(JSON.stringify(value));
    }

    function blankRow(beats = activeBeatsPerMeasure) {
      return Array.from({ length: STRINGS }, () => Array(positionsPerRow(beats)).fill(''));
    }

    function blankRows(count = INITIAL_ROWS, beats = activeBeatsPerMeasure) {
      return Array.from({ length: count }, () => blankRow(beats));
    }

    function normalizeTabValue(value) {
      const text = String(value ?? '').trim();
      if (/^x$/i.test(text)) return 'x';
      return text.replace(/\D/g, '').slice(0, 2);
    }

    function normalizeRows(rows, beats = activeBeatsPerMeasure) {
      const positions = positionsPerRow(beats);
      if (!Array.isArray(rows) || rows.length === 0) return blankRows(INITIAL_ROWS, beats);
      return rows.map(row => {
        const normalizedRow = [];
        for (let string = 0; string < STRINGS; string++) {
          const source = Array.isArray(row?.[string]) ? row[string] : [];
          const values = Array(positions).fill('');
          for (let position = 0; position < Math.min(positions, source.length); position++) {
            const value = normalizeTabValue(source[position]);
            values[position] = value;
          }
          normalizedRow.push(values);
        }
        return normalizedRow;
      });
    }

    function normalizeRhythmRows(rhythmRows, beats = activeBeatsPerMeasure) {
      if (!Array.isArray(rhythmRows)) return undefined;
      const positions = positionsPerRow(beats);
      const measureSlots = slotsPerMeasure(beats);
      return rhythmRows.map(row => {
        const normalized = {};
        for (const [rawPosition, rawDuration] of Object.entries(row || {})) {
          const position = Number(rawPosition);
          const duration = Number(rawDuration);
          if (!Number.isInteger(position) || position < 0 || position >= positions) continue;
          if (!Number.isInteger(duration) || duration < 1 || duration > measureSlots) continue;
          normalized[position] = duration;
        }
        return normalized;
      });
    }

    function seedSongs() {
      return [{ id: 'seed-blank-song-v1', name: '空白曲譜', tempo: 120, capo: 0, beatsPerMeasure: 4, rows: blankRows(INITIAL_ROWS, 4), createdAt: Date.now(), updatedAt: Date.now() }];
    }

    function loadStorage() {
      const local = readLocalLibrary(STORAGE_KEY, CURRENT_ID_KEY);
      songs = Array.isArray(local.songs) ? local.songs.map(normalizeSongRecord) : [];
      if (songs.length === 0) {
        songs = seedSongs();
        currentSongId = songs[0].id;
        writeStorage();
        return;
      }
      currentSongId = local.currentSongId || songs[0].id;
      if (!songs.some(song => song.id === currentSongId)) currentSongId = songs[0].id;
    }

    function writeStorage() {
      writeLocalLibrary(STORAGE_KEY, CURRENT_ID_KEY, songs, currentSongId);
    }

    function normalizeSongRecord(song) {
      const beatsPerMeasure = normalizeBeatsPerMeasure(song.beatsPerMeasure);
      const normalized = {
        ...song,
        tempo: clamp(Number(song.tempo) || 120, 30, 300),
        capo: clamp(Math.round(Number(song.capo) || 0), 0, 12),
        beatsPerMeasure,
        rows: normalizeRows(song.rows, beatsPerMeasure)
      };
      const rhythmRows = normalizeRhythmRows(song.rhythmRows, beatsPerMeasure);
      if (rhythmRows) normalized.rhythmRows = rhythmRows;
      return normalized;
    }

    function currentSong() {
      if (previewSong && previewSong.id === currentSongId) return previewSong;
      return songs.find(song => song.id === currentSongId) || songs[0];
    }

    function positionForOriginalStep(step) {
      const measureSteps = stepsPerMeasure();
      const measure = Math.floor(step / measureSteps);
      const localStep = step % measureSteps;
      return measure * slotsPerMeasure() + localStep * 2;
    }

    function createInput({ rowIndex, string, position, originalStep = null, isSmall = false }) {
      const input = document.createElement('input');
      input.className = 'note-input';
      if (!isSmall) {
        const localStep = originalStep % stepsPerMeasure();
        const shadeInterval = activeBeatsPerMeasure === 3 ? 3 : 2;
        if (localStep % shadeInterval === 0) input.classList.add('odd-step');
      }
      if (isSmall) input.classList.add('small-step');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.pattern = '[0-9xX]*';
      input.maxLength = 2;
      input.autocomplete = 'off';
      input.ariaLabel = isSmall ? `第 ${rowIndex + 1} 列，第 ${string + 1} 弦，中間小輸入點 ${position + 1}` : `第 ${rowIndex + 1} 列，第 ${string + 1} 弦，第 ${originalStep + 1} 個原本輸入點`;
      input.dataset.row = rowIndex;
      input.dataset.string = string;
      input.dataset.position = position;
      if (originalStep !== null) input.dataset.step = originalStep;
      input.dataset.size = isSmall ? 'small' : 'normal';
      input.readOnly = scoreViewEnabled;
      if (scoreViewEnabled) {
        input.tabIndex = -1;
        input.setAttribute('aria-readonly', 'true');
      } else {
        input.addEventListener('input', handleInput);
        input.addEventListener('keydown', handleKeydown);
        input.addEventListener('focus', event => { event.target.select(); jumpToInput(event.target, false); });
        input.addEventListener('click', event => jumpToInput(event.target, true));
      }
      return input;
    }

    function createTabSystem(rowIndex, rowCount) {
      const system = makeDiv('tab-system');
      system.dataset.row = rowIndex;
      const label = makeDiv('system-label');
      const labelText = document.createElement('div');
      labelText.textContent = `第 ${rowIndex + 1} 列`;
      label.appendChild(labelText);
      const tools = makeDiv('row-tool-group');
      const copyButton = document.createElement('button');
      copyButton.type = 'button'; copyButton.className = 'row-tool'; copyButton.textContent = '複製'; copyButton.addEventListener('click', () => copyRow(rowIndex));
      const pasteButton = document.createElement('button');
      pasteButton.type = 'button'; pasteButton.className = 'row-tool'; pasteButton.textContent = '貼上'; pasteButton.addEventListener('click', () => pasteRow(rowIndex));
      const moveUpButton = document.createElement('button');
      moveUpButton.type = 'button'; moveUpButton.className = 'row-tool'; moveUpButton.textContent = '↑'; moveUpButton.title = '與上一列交換'; moveUpButton.setAttribute('aria-label', `第 ${rowIndex + 1} 列與上一列交換`); moveUpButton.disabled = rowIndex === 0; moveUpButton.addEventListener('click', () => swapRow(rowIndex, rowIndex - 1));
      const moveDownButton = document.createElement('button');
      moveDownButton.type = 'button'; moveDownButton.className = 'row-tool'; moveDownButton.textContent = '↓'; moveDownButton.title = '與下一列交換'; moveDownButton.setAttribute('aria-label', `第 ${rowIndex + 1} 列與下一列交換`); moveDownButton.disabled = rowIndex === rowCount - 1; moveDownButton.addEventListener('click', () => swapRow(rowIndex, rowIndex + 1));
      tools.append(copyButton, pasteButton, moveUpButton, moveDownButton); label.appendChild(tools); system.appendChild(label);
      const grid = makeDiv('tab-grid'); grid.dataset.row = rowIndex;
      const steps = stepsPerRow(); const measureSteps = stepsPerMeasure(); const measureSlots = slotsPerMeasure(); grid.style.setProperty('--steps', steps);
      for (let string = 0; string < STRINGS; string++) { const line = makeDiv('string-line'); line.style.setProperty('--string-index', string); grid.appendChild(line); }
      for (let measure = 0; measure <= MEASURES; measure++) { const line = makeDiv('measure-line'); line.style.setProperty('--measure-index', measure); if (measure === 0) line.classList.add('first'); if (measure === MEASURES) line.classList.add('last'); grid.appendChild(line); }
      for (let guide = 1; guide < MEASURES * activeBeatsPerMeasure; guide++) { if (guide % activeBeatsPerMeasure === 0) continue; const line = makeDiv('beat-guide'); line.style.setProperty('--guide-percent', `${(guide / (MEASURES * activeBeatsPerMeasure)) * 100}%`); grid.appendChild(line); }
      for (let string = 0; string < STRINGS; string++) {
        for (let step = 0; step < steps; step++) {
          const cell = makeDiv('cell'); cell.style.gridColumn = step + 1; cell.style.gridRow = string + 1;
          cell.appendChild(createInput({ rowIndex, string, position: positionForOriginalStep(step), originalStep: step, isSmall: false })); grid.appendChild(cell);
        }
      }
      for (let string = 0; string < STRINGS; string++) {
        for (let measure = 0; measure < MEASURES; measure++) {
          for (let localStep = 0; localStep < measureSteps; localStep++) {
            const absoluteOriginalStep = measure * measureSteps + localStep;
            const cell = makeDiv('small-cell'); cell.style.left = `${((absoluteOriginalStep + 1) / steps) * 100}%`; cell.style.top = `calc(${string} * var(--row-height) + (var(--row-height) / 2))`;
            cell.appendChild(createInput({ rowIndex, string, position: measure * measureSlots + localStep * 2 + 1, isSmall: true })); grid.appendChild(cell);
          }
        }
      }
      const rhythmLayer = makeDiv('rhythm-layer'); rhythmLayer.dataset.row = rowIndex; rhythmLayer.setAttribute('aria-hidden', 'true'); grid.appendChild(rhythmLayer);
      system.appendChild(grid);
      return system;
    }
