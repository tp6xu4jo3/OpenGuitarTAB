(() => {
  const measureCanvas = document.createElement('canvas');
  const measureContext = measureCanvas.getContext('2d');
  const widthCache = new Map();
  let scheduledFrame = 0;

  function positionCountForGrid(grid) {
    return Number(grid.dataset.positionCount) || rowPositionCount(Number(grid.dataset.row) || 0) || positionsPerRow();
  }

  function scoreBaseFontSize(gridRect, positionCount) {
    if (!gridRect.width || !positionCount) return 18;
    const pitch = gridRect.width / positionCount;
    // Keep normal glyph proportions. Dense 8-measure rows settle around 18–22px on desktop.
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

  function fitScoreGrid(grid) {
    const gridRect = grid.getBoundingClientRect();
    const positionCount = positionCountForGrid(grid);
    if (!gridRect.width || !positionCount) return;

    const baseSize = scoreBaseFontSize(gridRect, positionCount);
    grid.style.setProperty('--score-note-font-size', `${baseSize}px`);

    const filled = Array.from(grid.querySelectorAll('.note-input.has-value'));
    if (!filled.length) return;

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
  }

  function clearEditGrid(grid) {
    grid.style.removeProperty('--score-note-font-size');
    grid.querySelectorAll('.note-input').forEach(input => {
      input.style.removeProperty('--two-digit-font-size');
      input.removeAttribute('data-two-digit-scaled');
    });
  }

  function fitAll() {
    scheduledFrame = 0;
    tabArea.querySelectorAll('.tab-grid').forEach(grid => {
      if (scoreViewEnabled) fitScoreGrid(grid);
      else clearEditGrid(grid);
    });
  }

  function scheduleFit() {
    if (scheduledFrame) return;
    scheduledFrame = requestAnimationFrame(fitAll);
  }

  const previousRenderRows = renderRows;
  renderRows = function renderRowsWithDensityFit(rows) {
    const result = previousRenderRows(rows);
    scheduleFit();
    return result;
  };

  const previousSetScoreViewEnabled = setScoreViewEnabled;
  setScoreViewEnabled = function setScoreViewEnabledWithDensityFit(enabled) {
    const result = previousSetScoreViewEnabled(enabled);
    scheduleFit();
    return result;
  };

  const resizeObserver = new ResizeObserver(scheduleFit);
  resizeObserver.observe(document.querySelector('.sheet') || tabArea);
  window.addEventListener('resize', scheduleFit, { passive: true });
  scheduleFit();
})();
