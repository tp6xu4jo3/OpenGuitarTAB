(() => {
  const measureCanvas = document.createElement('canvas');
  const measureContext = measureCanvas.getContext('2d');
  const widthCache = new Map();
  const fitState = new WeakMap();
  let scheduledFrame = 0;
  let forceNextFit = false;
  let observedSheetWidth = -1;

  function positionCountForGrid(grid) {
    return Number(grid.dataset.positionCount) || rowPositionCount(Number(grid.dataset.row) || 0) || positionsPerRow();
  }

  function scoreBaseFontSize(gridRect, positionCount) {
    if (!gridRect.width || !positionCount) return 18;
    const pitch = gridRect.width / positionCount;
    return Math.max(11, Math.min(30, Math.floor((pitch - 0.35) / 0.56)));
  }

  function fontDescriptor(sample, size) {
    const style = getComputedStyle(sample);
    return {
      key: `${style.fontStyle}|${style.fontWeight}|${style.fontFamily}|${size}`,
      font: `${style.fontStyle || 'normal'} ${style.fontWeight || '700'} ${size}px ${style.fontFamily || 'sans-serif'}`
    };
  }

  function makeTextMeasurer(sample, size) {
    const descriptor = fontDescriptor(sample, size);
    return text => {
      const value = String(text || '');
      if (!measureContext) return size * value.length * 0.58;
      const cacheKey = `${descriptor.key}|${value}`;
      if (widthCache.has(cacheKey)) return widthCache.get(cacheKey);
      measureContext.font = descriptor.font;
      const width = measureContext.measureText(value).width;
      widthCache.set(cacheKey, width);
      return width;
    };
  }

  function noteCenterX(gridRect, positionCount, startPosition, input) {
    const local = Number(input.dataset.position) - startPosition;
    return gridRect.left + ((local + 1) / positionCount) * gridRect.width;
  }

  function noteSignature(filled) {
    return filled.map(input => `${input.dataset.string}:${input.dataset.position}:${input.value}`).join('|');
  }

  function fitScoreGrid(grid, force = false) {
    const gridRect = grid.getBoundingClientRect();
    const positionCount = positionCountForGrid(grid);
    if (!gridRect.width || !positionCount) return;

    const filled = Array.from(grid.querySelectorAll('.note-input.has-value'));
    const signature = noteSignature(filled);
    const cached = fitState.get(grid);
    if (!force && cached && Math.abs(cached.width - gridRect.width) < 0.5 && cached.positionCount === positionCount && cached.signature === signature) return;

    const baseSize = scoreBaseFontSize(gridRect, positionCount);
    if (grid.style.getPropertyValue('--score-note-font-size') !== `${baseSize}px`) {
      grid.style.setProperty('--score-note-font-size', `${baseSize}px`);
    }

    if (!filled.length) {
      fitState.set(grid, { width: gridRect.width, positionCount, signature });
      return;
    }

    const measureText = makeTextMeasurer(filled[0], baseSize);
    const startPosition = Number(grid.dataset.positionStart) || 0;
    const byString = new Map();

    filled.forEach(input => {
      input.style.removeProperty('--two-digit-font-size');
      input.removeAttribute('data-two-digit-scaled');
      const string = Number(input.dataset.string);
      if (!byString.has(string)) byString.set(string, []);
      byString.get(string).push(input);
    });

    byString.forEach(inputs => {
      const notes = inputs.map(input => ({
        input,
        value: String(input.value || ''),
        center: noteCenterX(gridRect, positionCount, startPosition, input)
      })).sort((a, b) => a.center - b.center);

      notes.forEach((note, index) => {
        if (!/^\d{2}$/.test(note.value)) return;

        const naturalWidth = measureText(note.value);
        let maxWidth = naturalWidth;
        const gap = 0.2;

        const constrainAgainst = neighbor => {
          if (!neighbor) return;
          const distance = Math.abs(note.center - neighbor.center);
          const neighborIsTwoDigit = /^\d{2}$/.test(neighbor.value);
          const allowed = neighborIsTwoDigit
            ? distance - gap
            : (2 * (distance - gap)) - measureText(neighbor.value);
          maxWidth = Math.min(maxWidth, Math.max(1, allowed));
        };

        constrainAgainst(notes[index - 1]);
        constrainAgainst(notes[index + 1]);

        if (maxWidth >= naturalWidth - 0.1) return;
        const fitted = Math.max(9, Math.min(baseSize, Math.floor(baseSize * (maxWidth / naturalWidth))));
        note.input.style.setProperty('--two-digit-font-size', `${fitted}px`);
        note.input.dataset.twoDigitScaled = 'true';
      });
    });

    fitState.set(grid, { width: gridRect.width, positionCount, signature });
  }

  function clearEditGrid(grid) {
    fitState.delete(grid);
    grid.style.removeProperty('--score-note-font-size');
    grid.querySelectorAll('.note-input[data-two-digit-scaled="true"]').forEach(input => {
      input.style.removeProperty('--two-digit-font-size');
      input.removeAttribute('data-two-digit-scaled');
    });
  }

  function clearAll() {
    tabArea.querySelectorAll('.tab-grid').forEach(clearEditGrid);
  }

  function fitAll(force = false) {
    scheduledFrame = 0;
    const shouldForce = force || forceNextFit;
    forceNextFit = false;
    if (!scoreViewEnabled) return;
    tabArea.querySelectorAll('.tab-grid').forEach(grid => fitScoreGrid(grid, shouldForce));
  }

  function scheduleFit(force = false) {
    if (force) forceNextFit = true;
    if (scheduledFrame) return;
    scheduledFrame = requestAnimationFrame(() => fitAll(forceNextFit));
  }

  const previousRenderRows = renderRows;
  renderRows = function renderRowsWithDensityFit(rows) {
    const result = previousRenderRows(rows);
    scheduleFit(true);
    return result;
  };

  const previousSetScoreViewEnabled = setScoreViewEnabled;
  setScoreViewEnabled = function setScoreViewEnabledWithDensityFit(enabled) {
    const result = previousSetScoreViewEnabled(enabled);
    if (enabled) scheduleFit(true);
    else clearAll();
    return result;
  };

  const observedTarget = document.querySelector('.sheet') || tabArea;
  if (typeof ResizeObserver === 'function') {
    const resizeObserver = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect?.width;
      if (!Number.isFinite(width) || Math.abs(width - observedSheetWidth) < 0.5) return;
      observedSheetWidth = width;
      scheduleFit(false);
    });
    resizeObserver.observe(observedTarget);
  } else {
    window.addEventListener('resize', () => scheduleFit(false), { passive: true });
  }

  scheduleFit(true);
})();
