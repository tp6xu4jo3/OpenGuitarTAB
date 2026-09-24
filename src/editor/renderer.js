import {
  buildAdaptiveLayout,
  buildCompactScoreLayout,
  buildSystems,
  DEFAULT_LAYOUT_WIDTH,
  measureDurationInBeats,
  percentageForTime,
  timeFromPointerX
} from './layout.js';
import {
  addFractions,
  cloneValue,
  compareFractions,
  fractionKey,
  fractionToNumber,
  isDocumentV3,
  normalizeDocumentV3,
  normalizeFraction,
  noteDisplayValue,
  STRING_COUNT
} from './model.js';
import { fractionalGridTimes } from './rhythm-grid.js';
import { isPreviewActive, isScoreViewActive, scoreDensityMode } from './view-state.js';

const EDITOR_RAIL_WIDTH = 102;
const BASE_GRID_STEP = Object.freeze([1, 4]);

function div(className) {
  const node = document.createElement('div');
  node.className = className;
  return node;
}

function escapeSelector(value) {
  const text = String(value ?? '');
  return globalThis.CSS?.escape ? CSS.escape(text) : text.replace(/["\\]/g, '\\$&');
}

function parseFraction(value) {
  const match = String(value || '').match(/^(-?\d+)\/(\d+)$/);
  return match ? normalizeFraction([Number(match[1]), Number(match[2])]) : null;
}

function normalizeFret(value) {
  const text = String(value ?? '').trim();
  if (/^x$/i.test(text)) return 'x';
  return text.replace(/\D/g, '').slice(0, 2);
}

export function editableTimesForMeasure(measure) {
  const duration = measureDurationInBeats(measure);
  const map = new Map();
  const add = (at, durationValue = BASE_GRID_STEP) => {
    const normalized = normalizeFraction(at);
    const numeric = fractionToNumber(normalized);
    if (numeric < 0 || numeric >= duration) return;
    const key = fractionKey(normalized);
    if (!map.has(key)) map.set(key, { at: normalized, duration: normalizeFraction(durationValue, BASE_GRID_STEP) });
  };
  for (let value = 0; value < duration - 1e-9; value += 0.25) add([Math.round(value * 4), 4]);
  for (const time of fractionalGridTimes(measure)) add(time.at, time.duration || BASE_GRID_STEP);
  for (const event of measure?.events || []) add(event.at, event.duration || BASE_GRID_STEP);
  return [...map.values()].sort((left, right) => compareFractions(left.at, right.at));
}

function visualPercentageForTime(at, duration, measure) {
  return percentageForTime(addFractions(at, duration || BASE_GRID_STEP), measure);
}

function visualPercentageForAt(measure, at) {
  const key = fractionKey(at);
  const time = editableTimesForMeasure(measure).find(item => fractionKey(item.at) === key);
  return visualPercentageForTime(at, time?.duration || BASE_GRID_STEP, measure);
}

function layoutAvailableWidth(root) {
  const measured = Number(root?.clientWidth) || Number(root?.getBoundingClientRect?.().width) || 0;
  const rail = isScoreViewActive() ? 0 : EDITOR_RAIL_WIDTH;
  return Math.max(260, (measured || DEFAULT_LAYOUT_WIDTH + rail) - rail);
}

function eventAt(measure, at) {
  const key = fractionKey(at);
  return (measure?.events || []).find(event => fractionKey(event.at) === key) || null;
}

function stringFromPointer(clientY, staff, stringCount = STRING_COUNT) {
  const rect = staff.getBoundingClientRect();
  const relative = Math.max(0, Math.min(rect.height - 0.001, clientY - rect.top));
  return Math.max(0, Math.min(stringCount - 1, Math.floor(relative / Math.max(1, rect.height) * stringCount)));
}

function segmentSignature(segment) {
  return (segment?.measureIds || segment?.measures?.map(measure => measure.id) || []).map(String).join(',');
}

export class SparseScoreRenderer {
  constructor(root, { stringCount = STRING_COUNT, onCommitNote = null, onRendered = null, snap = BASE_GRID_STEP } = {}) {
    this.root = root;
    this.stringCount = stringCount;
    this.onCommitNote = onCommitNote;
    this.onRendered = onRendered;
    this.snap = cloneValue(snap);
    this.document = null;
    this.layoutPlan = null;
    this.layoutFrame = 0;
    this.cursor = null;
    this.observedWidth = -1;
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handleLayoutRequest = this.handleLayoutRequest.bind(this);
    this.root?.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('opentab:score-layout-change', this.handleLayoutRequest);
    const sheet = this.root?.closest?.('.sheet') || this.root;
    if (sheet && typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(entries => {
        const width = entries[0]?.contentRect?.width;
        if (!Number.isFinite(width) || width <= 0 || Math.abs(width - this.observedWidth) < 2) return;
        this.observedWidth = width;
        this.scheduleLayoutRender();
      });
      this.resizeObserver.observe(sheet);
    } else {
      this.resizeHandler = () => this.scheduleLayoutRender();
      window.addEventListener('resize', this.resizeHandler, { passive: true });
    }
  }

  destroy() {
    this.root?.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('opentab:score-layout-change', this.handleLayoutRequest);
    if (this.resizeHandler) window.removeEventListener('resize', this.resizeHandler);
    this.resizeObserver?.disconnect?.();
    this.hideCursor();
  }

  setSnap(snap) {
    this.snap = cloneValue(snap);
  }

  handleLayoutRequest() {
    this.scheduleLayoutRender();
  }

  scheduleLayoutRender() {
    if (this.layoutFrame || !this.document) return;
    this.layoutFrame = requestAnimationFrame(() => {
      this.layoutFrame = 0;
      const editorView = document.getElementById('editorView');
      if (editorView?.hidden) return;
      this.renderAll();
    });
  }

  render(documentModel, changeSet = null) {
    this.document = isDocumentV3(documentModel) ? documentModel : normalizeDocumentV3(documentModel);
    if (!this.root) return;
    const full = !this.root.querySelector('.v3-grid') || !changeSet || changeSet.document;
    if (full || changeSet?.layoutKind === 'structure') {
      this.renderAll();
      return;
    }
    if (changeSet.layoutFrom) {
      if (!this.applyLayoutChange(changeSet)) this.renderAll();
      return;
    }
    for (const measureId of changeSet.measures || []) this.renderMeasure(measureId);
    if ((changeSet.measures || []).length || (changeSet.playback || []).length) this.publishRendered({ partial: true });
  }

  currentLayout() {
    const availableWidth = layoutAvailableWidth(this.root);
    if (isScoreViewActive() && scoreDensityMode() === 'compact') {
      return { mode: 'compact', plan: buildCompactScoreLayout(this.document, { availableWidth }) };
    }
    return { mode: 'adaptive', plan: buildAdaptiveLayout(this.document, { availableWidth }) };
  }

  renderAll() {
    if (!this.root || !this.document) return;
    this.hideCursor();
    const { mode, plan } = this.currentLayout();
    this.layoutPlan = plan;
    const fragment = document.createDocumentFragment();
    if (mode === 'compact') {
      plan.rows.forEach((visualRow, visualIndex) => {
        const line = div('score-density-line');
        line.dataset.scoreLine = String(visualIndex);
        line.dataset.visualRow = String(visualIndex);
        line.dataset.measureCount = String(visualRow.measureCount);
        visualRow.segments.forEach(segment => {
          const system = this.createSystem(segment, visualIndex);
          system.classList.add('score-density-segment');
          system.style.setProperty('--score-density-weight', String(Math.max(1, segment.widthWeight || segment.minimumWidth || 1)));
          line.appendChild(system);
        });
        fragment.appendChild(line);
      });
    } else {
      plan.systems.forEach((segment, visualIndex) => fragment.appendChild(this.createSystem(segment, visualIndex)));
    }
    this.root.replaceChildren(fragment);
    this.publishRendered({ layout: plan, full: true });
  }

  createSystem(segment, visualIndex) {
    const rowIndex = Number(segment.sourceSystemIndex) || 0;
    const logical = buildSystems(this.document)[rowIndex] || [];
    const system = div('tab-system adaptive-tab-system v3-system');
    system.dataset.row = String(rowIndex);
    system.dataset.sourceRow = String(rowIndex);
    system.dataset.visualRow = String(visualIndex);
    system.dataset.sourceStart = String(Number(segment.startMeasure || 0) === 0);
    system.dataset.sourceEnd = String((Number(segment.startMeasure || 0) + segment.measures.length) >= logical.length);
    system.dataset.centerKey = `row-${rowIndex}`;
    const placeholder = div('system-label layout-rail-placeholder');
    placeholder.setAttribute('aria-hidden', 'true');
    system.appendChild(placeholder);
    const stack = div('adaptive-layout-stack');
    stack.appendChild(this.createGrid(segment));
    system.appendChild(stack);
    return system;
  }

  createGrid(segment) {
    const rowIndex = Number(segment.sourceSystemIndex) || 0;
    const measures = segment.measures || [];
    const widths = segment.measureWidths?.length === measures.length
      ? segment.measureWidths
      : Array.from({ length: Math.max(1, measures.length) }, () => 100 / Math.max(1, measures.length));
    const grid = div('tab-grid adaptive-tab-grid v3-grid');
    grid.dataset.row = String(rowIndex);
    grid.dataset.measureStart = String(Number(segment.startMeasure) || 0);
    grid.dataset.measureCount = String(Math.max(1, measures.length));
    grid.dataset.measureIds = measures.map(measure => measure.id).join(',');
    grid.dataset.measureWidths = widths.map(value => Number(value).toFixed(6)).join(',');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = widths.map(width => `${Number(width).toFixed(6)}%`).join(' ');
    grid.style.position = 'relative';
    grid.style.width = '100%';
    measures.forEach((measure, index) => grid.appendChild(this.createMeasure(measure, index)));
    return grid;
  }

  createMeasure(measure, localMeasureIndex = 0) {
    const node = div('v3-measure');
    node.dataset.measureId = String(measure.id);
    node.dataset.measureIndex = String(localMeasureIndex);
    node.style.position = 'relative';
    node.style.setProperty('--v3-strings', String(this.stringCount));
    const staff = div('v3-staff');
    staff.dataset.measureId = String(measure.id);
    staff.setAttribute('aria-label', 'TAB measure');
    for (let string = 0; string < this.stringCount; string++) {
      const line = div('v3-string-line');
      line.dataset.string = String(string);
      line.style.top = `${((string + 0.5) / this.stringCount) * 100}%`;
      staff.appendChild(line);
    }
    const beats = measureDurationInBeats(measure);
    for (let beat = 1; beat < Math.ceil(beats); beat++) {
      const guide = div('v3-beat-guide');
      guide.style.left = `${beat / beats * 100}%`;
      staff.appendChild(guide);
    }
    const times = editableTimesForMeasure(measure);
    const visualTimeByKey = new Map(times.map(time => [fractionKey(time.at), time]));
    times.forEach((time, index) => {
      const current = visualPercentageForTime(time.at, time.duration, measure);
      const previous = index > 0 ? visualPercentageForTime(times[index - 1].at, times[index - 1].duration, measure) : 0;
      const next = index + 1 < times.length ? visualPercentageForTime(times[index + 1].at, times[index + 1].duration, measure) : 100;
      const left = index === 0 ? 0 : (previous + current) / 2;
      const right = index === times.length - 1 ? 100 : (current + next) / 2;
      const width = Math.max(0.2, right - left);
      const anchor = Math.max(0, Math.min(100, (current - left) / width * 100));
      const event = eventAt(measure, time.at);
      const target = div('v3-column-target');
      target.dataset.measureId = String(measure.id);
      target.dataset.at = fractionKey(time.at);
      target.dataset.duration = fractionKey(time.duration || BASE_GRID_STEP);
      if (event?.id) target.dataset.eventId = String(event.id);
      target.style.left = `${left}%`;
      target.style.width = `${width}%`;
      target.style.setProperty('--v3-anchor-x', `${anchor}%`);
      target.setAttribute('aria-label', `時間位置 ${target.dataset.at}`);
      staff.appendChild(target);
    });

    for (const event of measure.events || []) {
      const eventNode = div('v3-event');
      eventNode.dataset.eventId = String(event.id);
      eventNode.dataset.measureId = String(measure.id);
      eventNode.dataset.at = fractionKey(event.at);
      const visualTime = visualTimeByKey.get(fractionKey(event.at));
      eventNode.style.left = `${visualPercentageForTime(event.at, visualTime?.duration || BASE_GRID_STEP, measure)}%`;
      for (const note of event.notes || []) {
        const top = `${((Number(note.string) + 0.5) / this.stringCount) * 100}%`;
        const backdrop = div('v3-note-backdrop');
        backdrop.style.top = top;
        const noteNode = document.createElement('button');
        noteNode.type = 'button';
        noteNode.className = 'v3-note';
        noteNode.dataset.noteId = String(note.id);
        noteNode.dataset.eventId = String(event.id);
        noteNode.dataset.measureId = String(measure.id);
        noteNode.dataset.at = fractionKey(event.at);
        noteNode.dataset.duration = fractionKey(event.duration || BASE_GRID_STEP);
        noteNode.dataset.string = String(note.string);
        noteNode.style.top = top;
        noteNode.textContent = noteDisplayValue(note);
        noteNode.setAttribute('aria-label', `第 ${Number(note.string) + 1} 弦 ${noteDisplayValue(note)} 品`);
        eventNode.append(backdrop, noteNode);
      }
      staff.appendChild(eventNode);
    }
    node.appendChild(staff);
    return node;
  }

  renderMeasure(measureId) {
    const measure = this.document.measures.find(item => String(item.id) === String(measureId));
    const existing = this.root?.querySelector(`.v3-measure[data-measure-id="${escapeSelector(measureId)}"]`);
    if (!measure || !existing) return false;
    const index = Number(existing.dataset.measureIndex) || 0;
    existing.replaceWith(this.createMeasure(measure, index));
    return true;
  }

  applyLayoutChange(changeSet) {
    if (isScoreViewActive()) return false;
    const systems = buildSystems(this.document);
    const sourceSystemIndex = systems.findIndex(system => system.some(measure => String(measure.id) === String(changeSet.layoutFrom)));
    if (sourceSystemIndex < 0) return false;
    const nextPlan = buildAdaptiveLayout(this.document, { availableWidth: layoutAvailableWidth(this.root) });
    const nextSegments = nextPlan.systems.filter(segment => segment.sourceSystemIndex === sourceSystemIndex);
    const existing = [...this.root.querySelectorAll(`:scope > .tab-system[data-source-row="${sourceSystemIndex}"]`)];
    if (!existing.length || !nextSegments.length) return false;
    const metricsOnly = changeSet.layoutKind === 'metrics';
    const sameShape = existing.length === nextSegments.length && existing.every((system, index) => {
      const grid = system.querySelector(':scope .v3-grid');
      return String(grid?.dataset.measureIds || '') === segmentSignature(nextSegments[index]);
    });
    if (metricsOnly && sameShape) {
      for (const measureId of changeSet.measures || []) this.renderMeasure(measureId);
      existing.forEach((system, index) => this.updateGridWidths(system.querySelector(':scope .v3-grid'), nextSegments[index]));
    } else {
      const first = existing[0];
      const fragment = document.createDocumentFragment();
      nextSegments.forEach((segment, index) => fragment.appendChild(this.createSystem(segment, index)));
      first.before(fragment);
      existing.forEach(node => node.remove());
      [...this.root.querySelectorAll(':scope > .tab-system')].forEach((system, visualIndex) => { system.dataset.visualRow = String(visualIndex); });
    }
    this.layoutPlan = nextPlan;
    this.publishRendered({ layout: nextPlan, partial: true, sourceSystemIndex });
    return true;
  }

  updateGridWidths(grid, segment) {
    if (!grid) return false;
    const widths = segment.measureWidths || [];
    if (!widths.length) return false;
    grid.dataset.measureWidths = widths.map(value => Number(value).toFixed(6)).join(',');
    grid.style.gridTemplateColumns = widths.map(width => `${Number(width).toFixed(6)}%`).join(' ');
    return true;
  }

  publishRendered(detail = {}) {
    window.editorLayoutPlan = detail.layout || this.layoutPlan;
    window.editorPlayback?.invalidate?.();
    window.updateProgressRange?.();
    this.onRendered?.(detail);
    window.dispatchEvent(new CustomEvent('opentab:editor-rendered', { detail }));
  }

  handlePointerDown(event) {
    if (isPreviewActive() || isScoreViewActive() || window.editorV3?.toolSession?.active || window.editorV3?.chordPlacement?.active) return;
    if (event.target.closest?.('.technique-marker,.editor-module-menu,.measure-module-hitbox')) return;
    const note = event.target.closest?.('.v3-note');
    if (note) {
      event.preventDefault();
      this.showCursor({ measureId: note.dataset.measureId, string: Number(note.dataset.string), at: parseFraction(note.dataset.at), duration: parseFraction(note.dataset.duration) || BASE_GRID_STEP, initialValue: note.textContent || '' });
      return;
    }
    const target = event.target.closest?.('.v3-column-target');
    const staff = event.target.closest?.('.v3-staff');
    const measureNode = staff?.closest?.('.v3-measure');
    const measureId = String(target?.dataset.measureId || measureNode?.dataset.measureId || '');
    const measure = this.document?.measures?.find(item => String(item.id) === measureId);
    if (!staff || !measure) return;
    const at = parseFraction(target?.dataset.at) || timeFromPointerX(event.clientX, staff.getBoundingClientRect(), measure, this.snap);
    const duration = parseFraction(target?.dataset.duration) || BASE_GRID_STEP;
    event.preventDefault();
    this.showCursor({ measureId, string: stringFromPointer(event.clientY, staff, this.stringCount), at, duration });
  }

  hideCursor() {
    this.cursor?.remove();
    this.cursor = null;
  }

  navigateCursor({ measureId, string, at, direction }) {
    const columns = [...this.root.querySelectorAll('.v3-column-target[data-measure-id][data-at]')];
    const measureOrder = new Map(this.document.measures.map((measure, index) => [String(measure.id), index]));
    columns.sort((left, right) => {
      const measureDelta = (measureOrder.get(left.dataset.measureId) ?? 0) - (measureOrder.get(right.dataset.measureId) ?? 0);
      if (measureDelta) return measureDelta;
      return fractionToNumber(parseFraction(left.dataset.at) || [0, 1]) - fractionToNumber(parseFraction(right.dataset.at) || [0, 1]);
    });
    const key = fractionKey(at);
    const index = columns.findIndex(node => node.dataset.measureId === String(measureId) && node.dataset.at === key);
    if (index < 0) return null;
    if (direction === 'left' || direction === 'right') {
      const next = columns[Math.max(0, Math.min(columns.length - 1, index + (direction === 'left' ? -1 : 1)))];
      return next ? { measureId: next.dataset.measureId, at: parseFraction(next.dataset.at), duration: parseFraction(next.dataset.duration), string } : null;
    }
    const nextString = string + (direction === 'up' ? -1 : 1);
    if (nextString < 0 || nextString >= this.stringCount) return null;
    return { measureId, at, duration: BASE_GRID_STEP, string: nextString };
  }

  showCursor({ measureId, string = 0, at = [0, 1], duration = BASE_GRID_STEP, initialValue = '' } = {}) {
    const measure = this.document?.measures?.find(item => String(item.id) === String(measureId));
    const measureNode = this.root?.querySelector(`.v3-measure[data-measure-id="${escapeSelector(measureId)}"]`);
    const staff = measureNode?.querySelector('.v3-staff');
    if (!measure || !measureNode || !staff || !Array.isArray(at)) return null;
    this.hideCursor();
    const input = document.createElement('input');
    input.className = 'v3-note-editor';
    input.type = 'text';
    input.inputMode = 'numeric';
    input.maxLength = 2;
    input.value = normalizeFret(initialValue);
    input.dataset.measureId = String(measureId);
    input.dataset.string = String(string);
    input.dataset.at = fractionKey(at);
    input.dataset.duration = fractionKey(duration || BASE_GRID_STEP);
    Object.assign(input.style, { position: 'absolute', left: `${visualPercentageForAt(measure, at)}%`, top: `${((Number(string) + 0.5) / this.stringCount) * 100}%`, transform: 'translate(-50%, -50%)' });
    let cancelled = false;
    let committed = false;
    const commit = () => {
      if (committed || cancelled) return;
      committed = true;
      this.onCommitNote?.({ measureId: String(measureId), string: Number(string), at: cloneValue(at), duration: cloneValue(duration || BASE_GRID_STEP), fret: normalizeFret(input.value) });
    };
    input.addEventListener('input', () => {
      const normalized = normalizeFret(input.value);
      if (input.value !== normalized) input.value = normalized;
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); cancelled = true; this.hideCursor(); return; }
      if (event.key === 'Enter') { event.preventDefault(); commit(); this.hideCursor(); return; }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key.replace('Arrow', '').toLowerCase();
      const next = this.navigateCursor({ measureId, string, at, direction });
      commit();
      this.hideCursor();
      if (next) requestAnimationFrame(() => this.showCursor(next));
    });
    input.addEventListener('blur', () => {
      commit();
      if (this.cursor === input) this.cursor = null;
      input.remove();
    }, { once: true });
    staff.appendChild(input);
    this.cursor = input;
    requestAnimationFrame(() => { input.focus(); input.select(); });
    return input;
  }
}
