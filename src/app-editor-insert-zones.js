(() => {
  let measureDragActive = false;
  const previousRenderRows = renderRows;

  function clearBoundaryFeedback() {
    document.querySelectorAll('.measure-insert-boundary.is-active').forEach(zone => zone.classList.remove('is-active'));
    document.querySelectorAll('.measure-module-hitbox.measure-insert-shift').forEach(hitbox => hitbox.classList.remove('measure-insert-shift'));
    document.querySelectorAll('.measure-module-hitbox.drop-before,.measure-module-hitbox.drop-after').forEach(hitbox => hitbox.classList.remove('drop-before', 'drop-after'));
  }

  function activateBoundary(grid, boundaryIndex) {
    clearBoundaryFeedback();
    grid.querySelector(`.measure-insert-boundary[data-boundary="${boundaryIndex}"]`)?.classList.add('is-active');
    grid.querySelectorAll('.measure-module-hitbox').forEach(hitbox => {
      if (Number(hitbox.dataset.measure) >= boundaryIndex) hitbox.classList.add('measure-insert-shift');
    });
  }

  function dispatchLegacyDrop(grid, boundaryIndex, event) {
    const targetMeasure = boundaryIndex >= MEASURES ? MEASURES - 1 : boundaryIndex;
    const target = grid.querySelector(`.measure-module-hitbox[data-measure="${targetMeasure}"]`);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const clientX = boundaryIndex >= MEASURES ? rect.right - 1 : rect.left + 1;
    target.dispatchEvent(new MouseEvent('drop', {
      bubbles: false,
      cancelable: true,
      clientX,
      clientY: event.clientY
    }));
  }

  function installBoundaryZones() {
    document.querySelectorAll('.measure-module-badge').forEach(badge => badge.remove());
    if (scoreViewEnabled) return;

    document.querySelectorAll('.tab-grid[data-row]').forEach(grid => {
      grid.querySelectorAll('.measure-insert-boundary').forEach(zone => zone.remove());
      const beatPercent = 25 / activeBeatsPerMeasure;

      for (let boundaryIndex = 0; boundaryIndex <= MEASURES; boundaryIndex++) {
        const zone = makeDiv('measure-insert-boundary');
        zone.dataset.boundary = boundaryIndex;
        zone.dataset.row = grid.dataset.row;

        if (boundaryIndex === 0) {
          zone.style.left = '0%';
          zone.style.width = `${beatPercent}%`;
          zone.style.setProperty('--boundary-line-x', '0%');
        } else if (boundaryIndex === MEASURES) {
          zone.style.left = `${100 - beatPercent}%`;
          zone.style.width = `${beatPercent}%`;
          zone.style.setProperty('--boundary-line-x', '100%');
        } else {
          zone.style.left = `${boundaryIndex * 25 - beatPercent}%`;
          zone.style.width = `${beatPercent * 2}%`;
          zone.style.setProperty('--boundary-line-x', '50%');
        }

        zone.addEventListener('dragenter', event => {
          if (!measureDragActive) return;
          event.preventDefault();
          activateBoundary(grid, boundaryIndex);
        });
        zone.addEventListener('dragover', event => {
          if (!measureDragActive) return;
          event.preventDefault();
          event.stopPropagation();
          activateBoundary(grid, boundaryIndex);
        });
        zone.addEventListener('dragleave', event => {
          if (!measureDragActive || zone.contains(event.relatedTarget)) return;
          zone.classList.remove('is-active');
        });
        zone.addEventListener('drop', event => {
          if (!measureDragActive) return;
          event.preventDefault();
          event.stopPropagation();
          dispatchLegacyDrop(grid, boundaryIndex, event);
          measureDragActive = false;
          document.body.classList.remove('measure-drag-active');
          clearBoundaryFeedback();
        });
        grid.appendChild(zone);
      }
    });
  }

  renderRows = function renderRowsWithBoundaryZones(rows) {
    previousRenderRows(rows);
    installBoundaryZones();
  };

  document.addEventListener('dragstart', event => {
    const hitbox = event.target.closest?.('.measure-module-hitbox');
    if (!hitbox || scoreViewEnabled) return;
    measureDragActive = true;
    document.body.classList.add('measure-drag-active');
    clearBoundaryFeedback();
  }, true);

  document.addEventListener('dragend', event => {
    if (!measureDragActive && !event.target.closest?.('.measure-module-hitbox')) return;
    measureDragActive = false;
    document.body.classList.remove('measure-drag-active');
    clearBoundaryFeedback();
  }, true);

  installBoundaryZones();
})();