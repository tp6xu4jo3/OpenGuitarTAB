const SCORE_DENSITY_KEY = 'openguitartab:score-density';
const SCORE_DENSITY_MODES = ['normal', 'compact'];

let installed = false;
let scoreDensity = 'normal';

function emitScoreLayoutChange(reason) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('opentab:score-layout-change', {
    detail: { reason, density: scoreDensity }
  }));
}

function storedDensity() {
  try {
    const value = localStorage.getItem(SCORE_DENSITY_KEY);
    return SCORE_DENSITY_MODES.includes(value) ? value : 'normal';
  } catch {
    return 'normal';
  }
}

export function scoreDensityMode() {
  return scoreDensity;
}

export function isScoreViewActive() {
  return Boolean(document.getElementById('editorView')?.classList.contains('score-view'));
}

export function isPreviewActive() {
  const badge = document.getElementById('previewBadge');
  return Boolean(badge && !badge.hidden);
}

export function isEditingBlocked() {
  const editorView = document.getElementById('editorView');
  return Boolean(editorView?.hidden || isScoreViewActive() || isPreviewActive());
}

function ensureScoreDensityControl() {
  const toggle = document.getElementById('rhythmToggleButton');
  if (!toggle) return null;

  let control = document.getElementById('scoreDensityControl');
  if (control) return control;

  control = document.createElement('div');
  control.id = 'scoreDensityControl';
  control.className = 'score-density-control';
  control.setAttribute('role', 'group');
  control.setAttribute('aria-label', '看譜排版密度');

  const label = document.createElement('span');
  label.className = 'score-density-label';
  label.textContent = '排版';
  control.appendChild(label);

  [
    { value: 'normal', label: '一般', aria: '一般看譜排版' },
    { value: 'compact', label: '緊湊', aria: '緊湊看譜排版，自動在一列放入更多小節' }
  ].forEach(option => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'score-density-option';
    button.dataset.scoreDensity = option.value;
    button.textContent = option.label;
    button.setAttribute('aria-label', option.aria);
    button.addEventListener('click', event => {
      event.preventDefault();
      setScoreDensityMode(option.value);
    });
    control.appendChild(button);
  });

  toggle.insertAdjacentElement('afterend', control);
  return control;
}

function syncDensityUi() {
  const editorView = document.getElementById('editorView');
  const control = ensureScoreDensityControl();
  if (!editorView || !control) return;

  editorView.classList.toggle('score-density-compact', scoreDensity === 'compact');
  control.hidden = !isScoreViewActive();
  control.querySelectorAll('[data-score-density]').forEach(button => {
    const active = button.dataset.scoreDensity === scoreDensity;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function syncModeUi(active) {
  const editorView = document.getElementById('editorView');
  const toggle = document.getElementById('rhythmToggleButton');
  if (!editorView || !toggle) return;

  window.scoreViewEnabled = Boolean(active);
  editorView.classList.toggle('edit-view', !active);
  editorView.classList.toggle('score-view', active);
  toggle.setAttribute('aria-pressed', String(active));

  const label = toggle.querySelector('.mode-toggle-label');
  if (label) label.textContent = '看譜模式';
  toggle.setAttribute(
    'aria-label',
    active ? '看譜模式已開啟，關閉看譜模式' : '看譜模式已關閉，開啟看譜模式'
  );
  syncDensityUi();
}

export function setScoreDensityMode(mode) {
  const next = SCORE_DENSITY_MODES.includes(mode) ? mode : 'normal';
  if (next === scoreDensity) {
    syncDensityUi();
    return scoreDensity;
  }

  scoreDensity = next;
  try {
    localStorage.setItem(SCORE_DENSITY_KEY, scoreDensity);
  } catch {
    // Density is presentation-only; storage failure must not affect the score.
  }
  syncDensityUi();
  emitScoreLayoutChange('density');
  return scoreDensity;
}

export function setScoreViewEnabled(enabled) {
  const active = Boolean(enabled);
  syncModeUi(active);
  return active;
}

function installModeToggle() {
  const toggle = document.getElementById('rhythmToggleButton');
  if (!toggle) return;
  toggle.addEventListener('click', event => {
    event.preventDefault();
    setScoreViewEnabled(!isScoreViewActive());
    emitScoreLayoutChange('mode');
  });
}

export function installViewState() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  scoreDensity = storedDensity();
  window.setScoreViewEnabled = setScoreViewEnabled;
  ensureScoreDensityControl();
  syncModeUi(typeof window.scoreViewEnabled === 'boolean' ? window.scoreViewEnabled : isScoreViewActive());
  installModeToggle();
}
