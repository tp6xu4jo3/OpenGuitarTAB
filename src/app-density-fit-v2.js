(() => {
  const measureCanvas = document.createElement('canvas');
  const measureContext = measureCanvas.getContext('2d');
  const widthCache = new Map();
  let scheduledFrame = 0;

  function scoreBaseFontSize(grid) {
    const rect = grid.getBoundingClientRect();
    const positions = Number(grid.dataset.positionCount) || rowPositionCount(Number(grid.dataset.row) || 0) || positionsPerRow();
    if (!rect.width || !positions) return 18;

    const pitch = rect.width / positions;
    // A bold digit is roughly 0.56em wide. Keep a tiny visual gap without distorting the glyph.
    return Math.max(12, Math.min(30, Math.floor((pitch - 0.5) / 0.56)));
  }

  function fontSignature(input, size) {
    const style = getComputedStyle(input);
    return {
      key: `${style.fontStyle}|${style.fontWeight}|${style.fontFamily}|${size}`,
      font: `${style.fontStyle || 'normal'} ${style.fontWeight || '700'} ${size}px ${style.fontFamily || 'sans-serif'}`
    };
  }

  function textWidth(input, text, size) {
    if (!measureContext) return size * String(text).length * 0.58;
    const signature = fontSignature(input, size);
    const cacheKey = `${signature.key}|${text}`;
    if (widthCache.has(cacheKey)) return widthCache.get(cacheKey);
    measureContext.font = signature.font;
    const width = measureContext.measureText(String(text)).width;
    widthCache.set(cacheKey, width);
    return width;
  }

  function noteCenterX(grid, input, gridRect) {
    const startPosition = Number(grid.dataset.positionStart) || 0;
    const positionCount = Number(grid.dataset.positionCount) || rowPositionCount(Number(grid.dataset.row) || 0) || positionsPerRow();
    const position = Number(input.dataset.position);
    const local = position - startPosition;
    return gridRect.left + ((local + 1) / positionCount) * gridRect.width;
  }

  function fitScoreGrid(grid) {
    const gridRect = grid.getBoundingClientRect();
    if (!gridRect.width) return;

    const baseSize = scoreBaseFontSize(grid);
    grid.style.setProperty('--score-note-font-size', `${baseSize}px`);

    const filled = Array.from(grid.querySelectorAll('.note-input.has-value'));
    if (!filled.length) return;

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
        center: noteCenterX(grid, input, gridRect)
      })).sort((a, b) => a.center - b.center);

      notes.forEach((note, index) => {
        if (!/^\d{2}$/.test(note.value)) return;

        const naturalWidth = textWidth(note.input, note.value, baseSize);
        let maxWidth = naturalWidth;
        const gap = 0.25;

        const previous = notes[index - 1];
        if (previous) {
          const previousWidth = textWidth(previous.input, previous.value, baseSize);
          const distance = note.center - previous.center;
          maxWidth = Math.min(maxWidth, Math.max(1, 2 * (distance - previousWidth / 2 - gap)));
        }

        const next = notes[index + 1];
        if (next) {
          const nextWidth = textWidth(next.input, next.value, baseSize);
          const distance = next.center - note.center;
          maxWidth = Math.min(maxWidth, Math.max(1, 2 * (distance - nextWidth / 2 - gap)));
        }

        if (maxWidth >= naturalWidth) return;
        const fitted = Math.max(10, Math.min(baseSize, Math.floor(baseSize * (maxWidth / naturalWidth))));
        note.input.style.setProperty('--two-digit-font-size', `${fitted}px`);
        note.input.dataset.twoDigitScaled = 'true';
      });
    });
  }

  function fitEditGrid(grid) {
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
      else fitEditGrid(grid);
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
