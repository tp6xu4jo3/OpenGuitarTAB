const HIDE_GRACE_MS = 120;

export function installDriveLoadingScreen(dataSource) {
  const screen = document.getElementById('driveLoadingScreen');
  const label = document.getElementById('driveLoadingLabel');
  if (!screen || !label || typeof dataSource?.setDriveActivityListener !== 'function') return;

  let hideTimer = null;

  const hide = () => {
    hideTimer = null;
    screen.hidden = true;
    screen.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('drive-loading-active');
  };

  dataSource.setDriveActivityListener(state => {
    if (state?.active) {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      label.textContent = state.label || '正在同步Google Drive…';
      screen.hidden = false;
      screen.setAttribute('aria-hidden', 'false');
      document.body.classList.add('drive-loading-active');
      return;
    }

    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, HIDE_GRACE_MS);
  });
}
