(() => {
  function installMeasureDragGrips() {
    document.querySelectorAll('.tab-grid[data-row]').forEach(grid => {
      const rowIndex = Number(grid.dataset.row);
      const count = Number(grid.dataset.measureCount) || rowMeasureCount(rowIndex);
      grid.querySelectorAll('.measure-drag-grip').forEach(node => node.remove());

      for (let measureIndex = 0; measureIndex < count; measureIndex++) {
        const grip = document.createElement('span');
        grip.className = 'measure-drag-grip';
        grip.draggable = true;
        grip.dataset.row = rowIndex;
        grip.dataset.measure = measureIndex;
        grip.style.left = `${((measureIndex + 0.5) / count) * 100}%`;
        grip.setAttribute('aria-label', `拖曳第 ${rowIndex + 1} 列第 ${measureIndex + 1} 小節`);
        grip.title = '拖曳小節';
        grip.addEventListener('dragstart', event => {
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', `measure:${rowIndex}:${measureIndex}`);
          }
        });
        grid.appendChild(grip);
      }
    });
  }

  const previousRenderRows = renderRows;
  renderRows = function renderRowsWithMeasureDragGrips(rows) {
    previousRenderRows(rows);
    if (!scoreViewEnabled) installMeasureDragGrips();
  };

  if (!scoreViewEnabled) installMeasureDragGrips();
})();