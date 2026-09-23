let installed = false;

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
}

export function setScoreViewEnabled(enabled) {
  const active = Boolean(enabled);
  syncModeUi(active);
  return active;
}

export function installViewState() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.setScoreViewEnabled = setScoreViewEnabled;
  syncModeUi(typeof window.scoreViewEnabled === 'boolean' ? window.scoreViewEnabled : isScoreViewActive());
}
