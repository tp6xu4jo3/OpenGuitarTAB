(() => {
  const FIELD_IDS = {
    name: 'publishNameInput',
    arrangementName: 'publishArrangementNameInput',
    artist: 'publishArtistInput',
    album: 'publishAlbumInput',
    source: 'publishSourceInput'
  };
  const STYLE_CONTROL_ID = 'publishPlayStyleToggle';
  const DIFFICULTY_INPUT_ID = 'publishDifficultyInput';
  const DIFFICULTY_VALUE_ID = 'publishDifficultyValue';

  function field(name) {
    return document.getElementById(FIELD_IDS[name]);
  }

  function clampDifficulty(value) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.min(5, Math.max(1, number)) : 3;
  }

  function validPlayStyle(value) {
    return value === 'chord' || value === 'fingerstyle' ? value : '';
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

  function fill(song) {
    const source = song && typeof song === 'object' ? song : {};
    const name = String(source.name || '').trim();
    if (field('name')) field('name').value = name;
    if (field('arrangementName')) field('arrangementName').value = String(source.arrangementName || name).trim();
    if (field('artist')) field('artist').value = String(source.artist || '').trim();
    if (field('album')) field('album').value = String(source.album || '').trim();
    if (field('source')) field('source').value = String(source.source || '').trim();
    setPlayStyle(validPlayStyle(source.playStyle) || 'fingerstyle');
    const difficulty = document.getElementById(DIFFICULTY_INPUT_ID);
    if (difficulty) difficulty.value = String(clampDifficulty(source.difficulty));
    updateDifficultyValue();
  }

  function read() {
    const toggle = document.getElementById(STYLE_CONTROL_ID);
    return {
      name: field('name')?.value.trim() || '',
      arrangementName: field('arrangementName')?.value.trim() || '',
      artist: field('artist')?.value.trim() || '',
      album: field('album')?.value.trim() || '',
      source: field('source')?.value.trim() || '',
      playStyle: validPlayStyle(toggle?.dataset.value) || 'fingerstyle',
      difficulty: clampDifficulty(document.getElementById(DIFFICULTY_INPUT_ID)?.value)
    };
  }

  function focus(name) {
    field(name)?.focus();
  }

  document.querySelectorAll('#publishPlayStyleToggle .publish-style-option').forEach(button => {
    button.addEventListener('click', () => setPlayStyle(button.dataset.value));
  });
  document.getElementById(DIFFICULTY_INPUT_ID)?.addEventListener('input', updateDifficultyValue);
  setPlayStyle(document.getElementById(STYLE_CONTROL_ID)?.dataset.value || 'fingerstyle');
  updateDifficultyValue();

  window.publishMetadataUi = { fill, read, focus, setPlayStyle };
})();
