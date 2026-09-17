(() => {
  setScoreViewEnabled = function safeSetScoreViewEnabled(enabled) {
    scoreViewEnabled = Boolean(enabled);
    editorView.classList.toggle('edit-view', !scoreViewEnabled);
    editorView.classList.toggle('score-view', scoreViewEnabled);
    rhythmToggleButton.setAttribute('aria-pressed', String(scoreViewEnabled));
    const label = rhythmToggleButton.querySelector('.mode-toggle-label');
    if (label) label.textContent = '看譜模式';
    rhythmToggleButton.setAttribute('aria-label', scoreViewEnabled ? '看譜模式已開啟，關閉看譜模式' : '看譜模式已關閉，開啟看譜模式');
  };

  const playPanel = document.querySelector('.play-panel');
  if (playPanel) {
    const observer = new MutationObserver(() => {
      if (rhythmToggleButton.isConnected && rhythmToggleButton.parentElement !== playPanel) playPanel.prepend(rhythmToggleButton);
    });
    observer.observe(editorView, { childList: true, subtree: true });
  }
})();
