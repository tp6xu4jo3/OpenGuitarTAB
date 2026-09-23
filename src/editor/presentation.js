import { fractionalPercentForGrid, legacyPositionPercentForGrid } from './grid-geometry.js';
import { legacyBeatsPerMeasure, LEGACY_SLOTS_PER_BEAT } from './legacy-grid-compat.js';

const SCORE_MAX_FONT_SIZE = 20;
const EDIT_FONT_SIZE = 24;
const MIN_TWO_DIGIT_SCALE = 0.58;
const BACKGROUND_LAYER_CLASS = 'note-background-layer';
const BACKGROUND_CLASS = 'note-value-background';

const backgroundMaps = new WeakMap();
const fitState = new WeakMap();
const dirtyGrids = new Set();
const forceGrids = new WeakSet();
const widthCache = new Map();
const measureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const measureContext = measureCanvas?.getContext?.('2d') || null;
let scheduledFrame = 0;
let fitAllRequested = false;
let forceAllNextFit = false;
let observedSheetWidth = -1;
let installed = false;

function scoreViewActive() {
  return Boolean(document.getElementById('editorView')?.classList.contains('score-view'));
}

function makeDiv(className) {
  const node = document.createElement('div');
  node.className = className;
  return node;
}

function ensureBackgroundLayer(grid) {
  let layer = grid.querySelector(`:scope > .${BACKGROUND_LAYER_CLASS}`);
  if (layer) return layer;
  layer = makeDiv(BACKGROUND_LAYER_CLASS);
  layer.dataset.row = grid.dataset.row || '';
  layer.setAttribute('aria-hidden', 'true');
  grid.prepend(layer);
  return layer;
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

function backgroundKey(input) {
  return [
    input.dataset.string,
    input.dataset.measureId || '',
    input.dataset.at || '',
    input.dataset.position || ''
  ].join(':');
}

function positionCountForGrid(grid) {
  const direct = Number(grid.dataset.positionCount);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const rowIndex = Number(grid.dataset.row);
  if (typeof window.rowPositionCount === 'function' && Number.isInteger(rowIndex)) {
    const value = Number(window.rowPositionCount(rowIndex));
    if (Number.isFinite(value) && value > 0) return value;
  }
  if (typeof window.positionsPerRow === 'function') return Number(window.positionsPerRow()) || 1;
  return 1;
}

function parseFraction(value, fallback = [0, 1]) {
  const match = String(value || '').match(/^(-?\d+)\/(\d+)$/);
  return match ? [Number(match[1]), Number(match[2])] : fallback;
}

function currentSongSafe() {
  return typeof window.currentSong === 'function' ? window.currentSong() : null;
}

function currentDocumentSafe() {
  return window.editorV3?.getStore?.({ reconcile: false })?.getDocument?.()
    || currentSongSafe()?.document
    || null;
}

function positionPercent(grid, input) {
  if (input?.dataset?.v3Only === 'true') {
    const documentModel = currentDocumentSafe();
    const measureId = String(input.dataset.measureId || '');
    const measure = documentModel?.measures?.find(item => String(item.id) === measureId);
    const measureIds = String(grid.dataset.measureIds || '').split(',').filter(Boolean);
    const localMeasure = measureIds.indexOf(measureId);
    if (measure && localMeasure >= 0) {
      const absoluteMeasure = (Number(grid.dataset.measureStart) || 0) + localMeasure;
      return fractionalPercentForGrid(
        grid,
        absoluteMeasure,
        parseFraction(input.dataset.at),
        parseFraction(input.dataset.duration, [1, 4]),
        measure
      );
    }
  }

  return legacyPositionPercentForGrid(grid, Number(input?.dataset?.position), {
    beatsPerMeasure: legacyBeatsPerMeasure(currentSongSafe()),
    slotsPerBeat: LEGACY_SLOTS_PER_BEAT
  });
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
    background?.remove();
    map.delete(key);
    return;
  }

  if (input.dataset.v3Only !== 'true') {
    const startPosition = Number(grid.dataset.positionStart) || 0;
    const positionCount = positionCountForGrid(grid);
    const localPosition = position - startPosition;
    if (localPosition < 0 || localPosition >= positionCount) {
      background?.remove();
      map.delete(key);
      return;
    }
  }

  if (!background) {
    background = makeDiv(BACKGROUND_CLASS);
    background.dataset.noteKey = key;
    layer.appendChild(background);
    map.set(key, background);
  }

  background.style.setProperty('--note-x', `${positionPercent(grid, input)}%`);
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

function scoreBaseFontSize(gridRect, positionCount) {
  if (!gridRect.width || !positionCount) return 18;
  const pitch = gridRect.width / positionCount;
  return Math.max(11, Math.min(SCORE_MAX_FONT_SIZE, Math.floor((pitch - 0.35) / 0.56)));
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

function resetTwoDigitFit(input) {
  input.style.removeProperty('--two-digit-scale-x');
  input.removeAttribute('data-two-digit-scaled');
}

function noteSignature(filled) {
  return filled.map(input => `${backgroundKey(input)}:${input.value}`).join('|');
}

function fitGrid(grid, force = false) {
  if (!(grid instanceof HTMLElement) || !grid.isConnected) return;
  const rect = grid.getBoundingClientRect();
  const positionCount = positionCountForGrid(grid);
  if (!rect.width || !positionCount) return;

  const filled = Array.from(grid.querySelectorAll('.note-input.has-value'));
  const signature = noteSignature(filled);
  const mode = scoreViewActive() ? 'score' : 'edit';
  const cached = fitState.get(grid);
  if (!force && cached && Math.abs(cached.width - rect.width) < 0.5 && cached.positionCount === positionCount && cached.signature === signature && cached.mode === mode) return;

  const baseSize = mode === 'score' ? scoreBaseFontSize(rect, positionCount) : EDIT_FONT_SIZE;
  if (mode === 'score') grid.style.setProperty('--score-note-font-size', `${baseSize}px`);
  else grid.style.removeProperty('--score-note-font-size');

  if (filled.length) {
    const measureText = makeTextMeasurer(filled[0], baseSize);
    const byString = new Map();
    filled.forEach(input => {
      resetTwoDigitFit(input);
      const string = Number(input.dataset.string);
      if (!byString.has(string)) byString.set(string, []);
      byString.get(string).push(input);
    });

    byString.forEach(inputs => {
      const notes = inputs.map(input => ({
        input,
        value: String(input.value || ''),
        center: rect.left + positionPercent(grid, input) / 100 * rect.width
      })).sort((a, b) => a.center - b.center);

      notes.forEach((note, index) => {
        if (!/^\d{2}$/.test(note.value)) return;
        const naturalWidth = measureText(note.value);
        let maxWidth = naturalWidth;
        const constrain = neighbor => {
          if (!neighbor) return;
          const distance = Math.abs(note.center - neighbor.center);
          const allowed = /^\d{2}$/.test(neighbor.value)
            ? distance - 0.2
            : (2 * (distance - 0.2)) - measureText(neighbor.value);
          maxWidth = Math.min(maxWidth, Math.max(1, allowed));
        };
        constrain(notes[index - 1]);
        constrain(notes[index + 1]);
        if (maxWidth >= naturalWidth - 0.1) return;
        const scale = Math.max(MIN_TWO_DIGIT_SCALE, Math.min(1, maxWidth / naturalWidth));
        if (scale >= 0.995) return;
        note.input.style.setProperty('--two-digit-scale-x', scale.toFixed(3));
        note.input.dataset.twoDigitScaled = 'true';
      });
    });
  }

  fitState.set(grid, { width: rect.width, positionCount, signature, mode });
}

function flushFits() {
  scheduledFrame = 0;
  if (fitAllRequested) {
    const force = forceAllNextFit;
    fitAllRequested = false;
    forceAllNextFit = false;
    dirtyGrids.clear();
    document.getElementById('tabArea')?.querySelectorAll('.tab-grid').forEach(grid => fitGrid(grid, force));
    return;
  }
  const grids = Array.from(dirtyGrids);
  dirtyGrids.clear();
  grids.forEach(grid => fitGrid(grid, forceGrids.has(grid)));
}

function ensureFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(flushFits);
}

function scheduleGridFit(grid, force = false) {
  if (!(grid instanceof HTMLElement)) return;
  dirtyGrids.add(grid);
  if (force) forceGrids.add(grid);
  ensureFrame();
}

function scheduleFitAll(force = false) {
  fitAllRequested = true;
  if (force) forceAllNextFit = true;
  ensureFrame();
}

function syncNewGrids(mutations) {
  const grids = new Set();
  mutations.forEach(mutation => {
    mutation.addedNodes.forEach(node => {
      if (!(node instanceof HTMLElement)) return;
      if (node.classList.contains('tab-grid')) grids.add(node);
      node.querySelectorAll?.('.tab-grid').forEach(grid => grids.add(grid));
    });
  });
  grids.forEach(grid => {
    syncGridBackgrounds(grid);
    scheduleGridFit(grid, true);
  });
}

export function installEditorPresentation() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const tabArea = document.getElementById('tabArea');
  if (!tabArea) return;

  window.syncNoteInputBackground = syncInputBackground;
  window.syncNoteGridBackgrounds = syncGridBackgrounds;
  window.fitDensityGrid = fitGrid;
  window.scheduleDensityFitGrid = scheduleGridFit;
  window.scheduleDensityFitAll = scheduleFitAll;

  const observer = new MutationObserver(syncNewGrids);
  observer.observe(tabArea, { subtree: true, childList: true });

  const sheet = document.querySelector('.sheet') || tabArea;
  if (typeof ResizeObserver === 'function') {
    const resizeObserver = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect?.width;
      if (!Number.isFinite(width) || Math.abs(width - observedSheetWidth) < 0.5) return;
      observedSheetWidth = width;
      scheduleFitAll(false);
    });
    resizeObserver.observe(sheet);
  } else {
    window.addEventListener('resize', () => scheduleFitAll(false), { passive: true });
  }

  tabArea.querySelectorAll('.tab-grid').forEach(grid => {
    syncGridBackgrounds(grid);
    scheduleGridFit(grid, true);
  });
}

export { fitGrid, scheduleFitAll, scheduleGridFit, syncGridBackgrounds, syncInputBackground };
