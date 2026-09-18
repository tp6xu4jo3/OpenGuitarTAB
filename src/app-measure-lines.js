(() => {
  const previousCreateTabSystem = createTabSystem;

  function rebuildMeasureLines(grid, rowIndex) {
    if (!grid) return;
    const count = Math.max(1, Math.min(MEASURES, Number(grid.dataset.measureCount) || rowMeasureCount(rowIndex)));
    grid.querySelectorAll('.measure-line').forEach(line => line.remove());

    for (let index = 0; index <= count; index++) {
      const line = makeDiv('measure-line');
      line.dataset.measureIndex = String(index);
      line.style.setProperty('--measure-index', String(index));
      line.style.left = `${(index / count) * 100}%`;
      if (index === 0) line.classList.add('first');
      if (index === count) line.classList.add('last');
      grid.appendChild(line);
    }
  }

  createTabSystem = function createTabSystemWithMeasureLines(rowIndex, rowCount) {
    const system = previousCreateTabSystem(rowIndex, rowCount);
    rebuildMeasureLines(system.querySelector('.tab-grid'), rowIndex);
    return system;
  };
})();
