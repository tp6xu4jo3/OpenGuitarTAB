(() => {
  const SOURCE_INPUT_ID = 'publishSourceInput';
  const STYLE_CONTROL_ID = 'publishPlayStyleToggle';
  const DIFFICULTY_INPUT_ID = 'publishDifficultyInput';
  const DIFFICULTY_VALUE_ID = 'publishDifficultyValue';

  function clampDifficulty(value) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.min(5, Math.max(1, number)) : 3;
  }
  function validPlayStyle(value) { return value === 'chord' || value === 'fingerstyle' ? value : ''; }

  function ensurePublishControls() {
    const uploader = document.querySelector('#publishModal .publish-uploader');
    if (!uploader) return {};
    let sourceInput = document.getElementById(SOURCE_INPUT_ID);
    if (!sourceInput) {
      const label = document.createElement('label');
      label.className = 'publish-field';
      label.htmlFor = SOURCE_INPUT_ID;
      label.textContent = '來源';
      sourceInput = document.createElement('input');
      sourceInput.className = 'rename-input';
      sourceInput.id = SOURCE_INPUT_ID;
      sourceInput.type = 'text';
      sourceInput.maxLength = 120;
      sourceInput.autocomplete = 'off';
      sourceInput.placeholder = '例如：17jita';
      uploader.before(label, sourceInput);
    }
    let styleToggle = document.getElementById(STYLE_CONTROL_ID);
    if (!styleToggle) {
      const label = document.createElement('div');
      label.className = 'publish-field publish-extra-label';
      label.textContent = '類型';
      styleToggle = document.createElement('div');
      styleToggle.id = STYLE_CONTROL_ID;
      styleToggle.className = 'publish-style-toggle';
      styleToggle.setAttribute('role', 'radiogroup');
      styleToggle.setAttribute('aria-label', '曲譜類型');
      styleToggle.dataset.value = 'fingerstyle';
      [['fingerstyle', '指彈'], ['chord', '和弦']].forEach(([value, text]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'publish-style-option';
        button.dataset.value = value;
        button.textContent = text;
        button.setAttribute('role', 'radio');
        button.addEventListener('click', () => setPlayStyle(value));
        styleToggle.appendChild(button);
      });
      sourceInput.after(label, styleToggle);
    }
    let difficultyInput = document.getElementById(DIFFICULTY_INPUT_ID);
    if (!difficultyInput) {
      const label = document.createElement('div');
      label.className = 'publish-field publish-difficulty-label';
      label.innerHTML = `難度 <span id="${DIFFICULTY_VALUE_ID}" class="publish-difficulty-value">3</span>`;
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
      styleToggle.after(label, difficultyInput);
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

  ensurePublishControls();
  downloadSongButton?.addEventListener('click', fillPublishFields);
  publishConfirm?.addEventListener('click', applyPublishFields, true);
  publishArtistInput?.addEventListener('keydown', event => { if (event.key === 'Enter') applyPublishFields(); }, true);
  document.getElementById(SOURCE_INPUT_ID)?.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    publishConfirm?.click();
  });
})();
