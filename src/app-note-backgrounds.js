(() => {
  const BACKGROUND_LAYER_CLASS = 'note-background-layer';
  const BACKGROUND_CLASS = 'note-value-background';

  function ensureBackgroundLayer(grid) {
    let layer = grid.querySelector(`:scope > .${BACKGROUND_LAYER_CLASS}`);
    if (layer) return layer;

    layer = makeDiv(BACKGROUND_LAYER_CLASS);
    layer.dataset.row = grid.dataset.row || '';
    layer.setAttribute('aria-hidden', 'true');
    grid.prepend(layer);
    return layer;
  }

  function backgroundKey(input) {
    return `${input.dataset.string}:${input.dataset.position}`;
  }

  function findBackground(layer, key) {
    return Array.from(layer.children).find(child => child.dataset.noteKey === key) || null;
  }

  function syncInputBackground(input) {
    if (!(input instanceof HTMLInputElement) || !input.classList.contains('note-input')) return;

    const grid = input.closest('.tab-grid');
    if (!grid) return;

    const layer = ensureBackgroundLayer(grid);
    const string = Number(input.dataset.string);
    const position = Number(input.dataset.position);
    if (!Number.isInteger(string) || !Number.isInteger(position)) return;

    const key = backgroundKey(input);
    let background = findBackground(layer, key);
    const hasValue = input.classList.contains('has-value') && String(input.value || '').length > 0;

    if (!hasValue) {
      background?.remove();
      return;
    }

    if (!background) {
      background = makeDiv(BACKGROUND_CLASS);
      background.dataset.noteKey = key;
      layer.appendChild(background);
    }

    background.style.setProperty('--note-x', `${((position + 1) / positionsPerRow()) * 100}%`);
    background.style.setProperty('--string-index', String(string));
  }

  function syncGridBackgrounds(grid) {
    if (!(grid instanceof HTMLElement) || !grid.classList.contains('tab-grid')) return;

    const layer = ensureBackgroundLayer(grid);
    const liveKeys = new Set();

    grid.querySelectorAll('.note-input').forEach(input => {
      if (input.classList.contains('has-value') && String(input.value || '').length > 0) {
        liveKeys.add(backgroundKey(input));
      }
      syncInputBackground(input);
    });

    Array.from(layer.children).forEach(background => {
      if (!liveKeys.has(background.dataset.noteKey)) background.remove();
    });
  }

  function syncAllBackgrounds() {
    tabArea.querySelectorAll('.tab-grid').forEach(syncGridBackgrounds);
  }

  const observer = new MutationObserver(mutations => {
    const dirtyGrids = new Set();

    mutations.forEach(mutation => {
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLInputElement && mutation.target.classList.contains('note-input')) {
        syncInputBackground(mutation.target);
        return;
      }

      if (mutation.type !== 'childList') return;

      mutation.addedNodes.forEach(node => {
        if (!(node instanceof HTMLElement)) return;
        if (node.classList.contains('tab-grid')) dirtyGrids.add(node);
        node.querySelectorAll?.('.tab-grid').forEach(grid => dirtyGrids.add(grid));
      });
    });

    dirtyGrids.forEach(syncGridBackgrounds);
  });

  observer.observe(tabArea, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class']
  });

  syncAllBackgrounds();
})();
