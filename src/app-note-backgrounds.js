(() => {
  const BACKGROUND_LAYER_CLASS = 'note-background-layer';
  const BACKGROUND_CLASS = 'note-value-background';
  const backgroundMaps = new WeakMap();

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

  function backgroundMap(layer) {
    let map = backgroundMaps.get(layer);
    if (map) return map;

    map = new Map();
    Array.from(layer.children).forEach(child => {
      if (child.dataset.noteKey) map.set(child.dataset.noteKey, child);
    });
    backgroundMaps.set(layer, map);
    return map;
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

  function syncInputBackground(input, knownLayer = null, knownMap = null) {
    if (!(input instanceof HTMLInputElement) || !input.classList.contains('note-input')) return;

    const grid = input.closest('.tab-grid');
    if (!grid) return;

    const layer = knownLayer || ensureBackgroundLayer(grid);
    const map = knownMap || backgroundMap(layer);
    const string = Number(input.dataset.string);
    const position = Number(input.dataset.position);
    if (!Number.isInteger(string) || !Number.isInteger(position)) return;

    const value = String(input.value || '');
    const hasValue = input.classList.contains('has-value') && value.length > 0;
    input.dataset.noteLength = hasValue ? String(Math.min(2, value.length)) : '0';

    const key = backgroundKey(input);
    let background = map.get(key) || null;

    if (!hasValue) {
      if (background) {
        background.remove();
        map.delete(key);
      }
      return;
    }

    const { startPosition, positionCount } = gridPositionMetrics(grid, input);
    const localPosition = position - startPosition;
    if (localPosition < 0 || localPosition >= positionCount) {
      if (background) {
        background.remove();
        map.delete(key);
      }
      return;
    }

    if (!background) {
      background = makeDiv(BACKGROUND_CLASS);
      background.dataset.noteKey = key;
      layer.appendChild(background);
      map.set(key, background);
    }

    background.style.setProperty('--note-x', `${((localPosition + 1) / positionCount) * 100}%`);
    background.style.setProperty('--string-index', String(string));
  }

  function syncGridBackgrounds(grid) {
    if (!(grid instanceof HTMLElement) || !grid.classList.contains('tab-grid')) return;

    const layer = ensureBackgroundLayer(grid);
    const map = backgroundMap(layer);
    const liveKeys = new Set();

    grid.querySelectorAll('.note-input.has-value').forEach(input => {
      if (!String(input.value || '').length) return;
      const key = backgroundKey(input);
      liveKeys.add(key);
      syncInputBackground(input, layer, map);
    });

    for (const [key, background] of Array.from(map.entries())) {
      if (liveKeys.has(key)) continue;
      background.remove();
      map.delete(key);
    }
  }

  function syncAllBackgrounds() {
    tabArea.querySelectorAll('.tab-grid').forEach(syncGridBackgrounds);
  }

  const observer = new MutationObserver(mutations => {
    const dirtyGrids = new Set();

    mutations.forEach(mutation => {
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLInputElement && mutation.target.classList.contains('note-input')) {
        const grid = mutation.target.closest('.tab-grid');
        if (grid) dirtyGrids.add(grid);
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
