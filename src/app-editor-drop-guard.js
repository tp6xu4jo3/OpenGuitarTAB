(() => {
  let measureDragActive = false;

  window.addEventListener('dragstart', event => {
    measureDragActive = Boolean(
      event.target.closest?.('.measure-drag-grip,.measure-module-hitbox')
    );
  }, true);

  window.addEventListener('drop', event => {
    if (!measureDragActive) return;

    const pointed = document.elementFromPoint(event.clientX, event.clientY);
    const grid = pointed?.closest?.('.tab-grid[data-row]');
    if (grid) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    measureDragActive = false;
  }, true);

  window.addEventListener('dragend', () => {
    measureDragActive = false;
  }, true);
})();