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

  function gridPositionMetrics(grid, input) {
    const rowIndex = Number(input.dataset.row);
    const startPosition = Number(grid.dataset.positionStart) || 0;
    let positionCount = Number(grid.dataset.positionCount);

    if (!Number.isFinite(positionCount) || positionCount <= 0) {
      if (typeof rowPositionCount === 'function' && Number.isInteger(rowIndex)) positionCount = rowPositionCount(rowIndex);
      else positionCount = positionsPerRow();
    }

    return { startPosition, positionCount };
  }

  function syncInputBackground(input) {
    if (!(input instanceof HTMLInputElement) || !input.classList.contains('note-input')) return;

    const grid = input.closest('.tab-grid');
    if (!grid) return;

    const layer = ensureBackgroundLayer(grid);
    const string = Number(input.dataset.string);
    const position = Number(input.dataset.position);
    if (!Number.isInteger(string) || !Number.isInteger(position)) return;

    const value = String(input.value || '');
    const hasValue = input.classList.contains('has-value') && value.length > 0;
    input.dataset.noteLength = hasValue ? String(Math.min(2, value.length)) : '0';

    const key = backgroundKey(input);
    let background = findBackground(layer, key);

    if (!hasValue) {
      background?.remove();
      return;
    }

    const { startPosition, positionCount } = gridPositionMetrics(grid, input);
    const localPosition = position - startPosition;
    if (localPosition < 0 || localPosition >= positionCount) {
      background?.remove();
      return;
    }

    if (!background) {
      background = makeDiv(BACKGROUND_CLASS);
      background.dataset.noteKey = key;
      layer.appendChild(background);
    }

    background.style.setProperty('--note-x', `${((localPosition + 1) / positionCount) * 100}%`);
    background.style.setProperty('--string-index', String(string));
  }

  function syncGridBackgrounds(grid) {
    if (!(grid instanceof HTMLElement) || !grid.classList.contains('tab-grid')) return;

    const layer = ensureBackgroundLayer(grid);
    const liveKeys = new Set();

    grid.querySelectorAll('.note-input').forEach(input => {
      if (input.classList.contains('has-value') && String(input.value || '').length > 0) liveKeys.add(backgroundKey(input));
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

  tabArea.addEventListener('input', event => {
    if (event.target instanceof HTMLInputElement && event.target.classList.contains('note-input')) syncInputBackground(event.target);
  });

  syncAllBackgrounds();
})();
