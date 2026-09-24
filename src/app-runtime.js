    const STORAGE_KEY = 'guitar-tab-maker:songs:v3';
    const CURRENT_ID_KEY = 'guitar-tab-maker:current-song-id:v3';

    const addRowButton = document.getElementById('addRow');
    const removeRowButton = document.getElementById('removeRow');
    const rhythmToggleButton = document.getElementById('rhythmToggleButton');
    const meterBadge = document.getElementById('meterBadge');
    const capoInput = document.getElementById('capoInput');
    const tempoInput = document.getElementById('tempoInput');
    const saveSongButton = document.getElementById('saveSongButton');
    const downloadSongButton = document.getElementById('downloadSongButton');
    const newSongButton = document.getElementById('newSongButton');
    const songList = document.getElementById('songList');
    const playProgress = document.getElementById('playProgress');
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
    var activeBeatsPerMeasure = 4;
    let toastTimer = null;
    let menuOpenFor = null;
    let menuPosition = null;
    let renameTargetId = null;
    let deleteTargetId = null;
    let catalogSongs = [];
    let previewSong = null;
    let previousNonEditorRoute = '#/catalog';

    function normalizeBeatsPerMeasure(value) {
      return Number(value) === 3 ? 3 : 4;
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

    function seedSongs() {
      return [{
        id: 'seed-blank-song-v3',
        name: '空白曲譜',
        tempo: 120,
        capo: 0,
        beatsPerMeasure: 4,
        document: createBlankDocumentV3({ beats: 4, systems: 4, measuresPerSystem: 4 }),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }];
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
      const beatsPerMeasure = normalizeBeatsPerMeasure(song?.beatsPerMeasure);
      const normalized = {
        ...song,
        tempo: clamp(Number(song?.tempo) || 120, 30, 300),
        capo: clamp(Math.round(Number(song?.capo) || 0), 0, 12),
        beatsPerMeasure
      };
      ensureSongDocumentV3(normalized);
      return normalized;
    }

    function currentSong() {
      if (previewSong && previewSong.id === currentSongId) return previewSong;
      return songs.find(song => song.id === currentSongId) || songs[0];
    }

    function getSongRecords() {
      return songs;
    }

    function setCurrentSongId(id) {
      currentSongId = id == null ? null : String(id);
      return currentSongId;
    }
