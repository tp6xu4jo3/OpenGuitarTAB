(() => {
  const measureCanvas = document.createElement('canvas');
  const measureContext = measureCanvas.getContext('2d');
  let scheduledFrame = 0;

  function isTwoDigit(input) {
    return input?.dataset?.noteLength === '2' || /^\d{2}$/.test(String(input?.value || ''));
  }

  function baseFontSize() {
    return scoreViewEnabled ? 30 : 24;
  }

  function preferredFloor() {
    return scoreViewEnabled ? 16 : 15;
  }

  function hardFloor() {
    return scoreViewEnabled ? 12 : 12;
  }

  function inputCenterX(input) {
    const rect = input.getBoundingClientRect();
    return rect.left + rect.width / 2;
  }

  function glyphWidth(input) {
    if (!measureContext) return input.getBoundingClientRect().width;
    const style = getComputedStyle(input);
    const fontSize = parseFloat(style.fontSize) || baseFontSize();
    const fontStyle = style.fontStyle || 'normal';
    const fontWeight = style.fontWeight || '700';
    const fontFamily = style.fontFamily || 'sans-serif';
    measureContext.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
    return measureContext.measureText(String(input.value || '')).width;
  }

  function groupedInputs(container) {
    const groups = new Map();
    container.querySelectorAll('.note-input.has-value').forEach(input => {
      const string = Number(input.dataset.string);
      if (!groups.has(string)) groups.set(string, []);
      groups.get(string).push(input);
    });
    groups.forEach(inputs => inputs.sort((a, b) => inputCenterX(a) - inputCenterX(b)));
    return groups;
  }

  function collidingTwoDigitInputs(container, gap = 0.35) {
    const targets = new Set();
    for (const inputs of groupedInputs(container).values()) {
      for (let index = 1; index < inputs.length; index++) {
        const previous = inputs[index - 1];
        const current = inputs[index];
        const previousCenter = inputCenterX(previous);
        const currentCenter = inputCenterX(current);
        const previousWidth = glyphWidth(previous);
        const currentWidth = glyphWidth(current);
        const previousRight = previousCenter + previousWidth / 2;
        const currentLeft = currentCenter - currentWidth / 2;
        if (previousRight + gap <= currentLeft) continue;
        if (isTwoDigit(previous)) targets.add(previous);
        if (isTwoDigit(current)) targets.add(current);
      }
    }
    return targets;
  }

  function setTwoDigitSize(input, size) {
    input.style.setProperty('--two-digit-font-size', `${size}px`);
    input.dataset.twoDigitScaled = size < baseFontSize() ? 'true' : 'false';
  }

  function resetContainer(container) {
    container.querySelectorAll('.note-input').forEach(input => {
      input.style.removeProperty('--two-digit-font-size');
      input.removeAttribute('data-two-digit-scaled');
    });
    container.querySelectorAll('.note-input.has-value').forEach(input => {
      if (isTwoDigit(input)) setTwoDigitSize(input, baseFontSize());
    });
  }

  function shrinkTargets(container, floor) {
    let guard = 0;
    while (guard++ < 40) {
      const targets = collidingTwoDigitInputs(container);
      if (!targets.size) return true;

      let changed = false;
      targets.forEach(input => {
        const current = parseFloat(getComputedStyle(input).fontSize) || baseFontSize();
        if (current <= floor) return;
        setTwoDigitSize(input, Math.max(floor, current - 1));
        changed = true;
      });

      if (!changed) return false;
    }
    return collidingTwoDigitInputs(container).size === 0;
  }

  function fitContainer(container) {
    if (!(container instanceof HTMLElement)) return;
    resetContainer(container);

    if (!container.querySelector('.note-input.has-value[data-note-length="2"]')) return;

    if (shrinkTargets(container, preferredFloor())) return;
    shrinkTargets(container, hardFloor());
  }

  function fitAll() {
    scheduledFrame = 0;
    if (scoreViewEnabled) {
      const pairs = Array.from(tabArea.querySelectorAll('.score-grid-pair'));
      if (pairs.length) {
        pairs.forEach(fitContainer);
        return;
      }
    }
    tabArea.querySelectorAll('.tab-grid').forEach(fitContainer);
  }

  function scheduleFit() {
    if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
    scheduledFrame = requestAnimationFrame(fitAll);
  }

  const previousRenderRows = renderRows;
  renderRows = function renderRowsWithTwoDigitFit(rows) {
    const result = previousRenderRows(rows);
    scheduleFit();
    return result;
  };

  const previousSetScoreViewEnabled = setScoreViewEnabled;
  setScoreViewEnabled = function setScoreViewEnabledWithTwoDigitFit(enabled) {
    const result = previousSetScoreViewEnabled(enabled);
    scheduleFit();
    return result;
  };

  tabArea.addEventListener('input', event => {
    if (!(event.target instanceof HTMLInputElement) || !event.target.classList.contains('note-input')) return;
    scheduleFit();
  });

  const resizeObserver = new ResizeObserver(scheduleFit);
  resizeObserver.observe(document.querySelector('.sheet') || tabArea);
  window.addEventListener('resize', scheduleFit);

  scheduleFit();
})();
