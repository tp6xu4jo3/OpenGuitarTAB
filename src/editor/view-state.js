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
  const scoreToggle = document.getElementById('rhythmToggleButton');
  if (!scoreToggle) return null;

  let control = document.getElementById('scoreDensityControl');
  if (control) return control;

  control = document.createElement('button');
  control.id = 'scoreDensityControl';
  control.type = 'button';
  control.className = 'mode-toggle-button score-density-toggle';
  control.setAttribute('aria-label', '緊湊看譜已關閉，開啟緊湊看譜');
  control.setAttribute('aria-pressed', 'false');

  const label = document.createElement('span');
  label.className = 'mode-toggle-label';
  label.textContent = '緊湊';
  control.appendChild(label);

  const switchTrack = document.createElement('span');
  switchTrack.className = 'mode-switch';
  switchTrack.setAttribute('aria-hidden', 'true');
  const switchThumb = document.createElement('span');
  switchThumb.className = 'mode-switch-thumb';
  switchTrack.appendChild(switchThumb);
  control.appendChild(switchTrack);

  control.addEventListener('click', event => {
    event.preventDefault();
    setScoreDensityMode(scoreDensity === 'compact' ? 'normal' : 'compact');
  });

  scoreToggle.insertAdjacentElement('afterend', control);
  return control;
}

function syncControlVisibility() {
  const preview = isPreviewActive();
  const scoreToggle = document.getElementById('rhythmToggleButton');
  const densityControl = document.getElementById('scoreDensityControl');
  if (scoreToggle) scoreToggle.hidden = preview;
  if (densityControl) densityControl.hidden = !isScoreViewActive();
}

function syncDensityUi() {
  const editorView = document.getElementById('editorView');
  const control = ensureScoreDensityControl();
  if (!editorView || !control) return;

  const compact = scoreDensity === 'compact';
  editorView.classList.toggle('score-density-compact', compact);
  control.classList.toggle('is-active', compact);
  control.setAttribute('aria-pressed', String(compact));
  control.setAttribute(
    'aria-label',
    compact ? '緊湊看譜已開啟，關閉緊湊看譜' : '緊湊看譜已關閉，開啟緊湊看譜'
  );
  syncControlVisibility();
}

function syncModeUi(active) {
  const editorView = document.getElementById('editorView');
  const toggle = document.getElementById('rhythmToggleButton');
  if (!editorView || !toggle) return;

  window.scoreViewEnabled = Boolean(active);
  editorView.classList.toggle('edit-view', !active);
  editorView.classList.toggle('score-view', active);
  toggle.classList.toggle('is-active', active);
  toggle.setAttribute('aria-pressed', String(active));

  const label = toggle.querySelector('.mode-toggle-label');
  if (label) label.textContent = '看譜模式';
  toggle.setAttribute(
    'aria-label',
    active ? '看譜模式已開啟，關閉看譜模式' : '看譜模式已關閉，開啟看譜模式'
  );
  syncDensityUi();
}

export function setPreviewActive(active) {
  const badge = document.getElementById('previewBadge');
  if (badge) badge.hidden = !Boolean(active);
  syncControlVisibility();
  return isPreviewActive();
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
  Object.assign(window, { setPreviewActive, setScoreViewEnabled });
  ensureScoreDensityControl();
  syncModeUi(typeof window.scoreViewEnabled === 'boolean' ? window.scoreViewEnabled : isScoreViewActive());
  installModeToggle();
}
