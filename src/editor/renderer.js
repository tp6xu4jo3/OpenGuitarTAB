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
  fractionKey,
  fractionToNumber,
  harmonicTechnique,
  isDocumentV3,
  normalizeDocumentV3,
  normalizeFraction,
  noteDisplayValue,
  STRING_COUNT
} from './model.js';
import { editableTimesForMeasure } from './rhythm-grid.js';
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

function halfFraction(value) {
  const [numerator, denominator] = normalizeFraction(value || BASE_GRID_STEP);
  return normalizeFraction([numerator, denominator * 2]);
}

function visualPercentageForTime(at, duration, measure) {
  return percentageForTime(addFractions(at, halfFraction(duration || BASE_GRID_STEP)), measure);
}

function visualPercentageForAt(measure, at) {
  const key = fractionKey(at);
  const time = editableTimesForMeasure(measure).find(item => fractionKey(item.at) === key);
  return visualPercentageForTime(at, time?.duration || BASE_GRID_STEP, measure);
}

function layoutAvailableWidth(root) {
  const rootWidth = Number(root?.clientWidth) || Number(root?.getBoundingClientRect?.().width) || 0;
  const sheet = root?.closest?.('.sheet');
  const sheetWidth = Number(sheet?.clientWidth) || Number(sheet?.getBoundingClientRect?.().width) || 0;
  const viewportWidth = Number(document.documentElement?.clientWidth) || Number(window.innerWidth) || 0;
  const candidates = [rootWidth, sheetWidth, viewportWidth].filter(value => Number.isFinite(value) && value > 0);
  const measured = candidates.length ? Math.min(...candidates) : 0;
  const rail = isScoreViewActive() ? 0 : EDITOR_RAIL_WIDTH;
  return Math.max(260, (measured || DEFAULT_LAYOUT_WIDTH + rail) - rail);
}

function rhythmBeamCountForValue(value) {
  if (!Number.isFinite(value) || value >= 1) return 0;
  if (value >= 0.5) return 1;
  if (value >= 0.25) return 2;
  return 3;
}

function rhythmBeamCount(duration) {
  return rhythmBeamCountForValue(fractionToNumber(duration || BASE_GRID_STEP));
}

function inferredOrdinaryBeamCount(event, orderedEvents) {
  const storedDuration = fractionToNumber(event?.duration || BASE_GRID_STEP);
  if (Math.abs(storedDuration - fractionToNumber(BASE_GRID_STEP)) > 1e-9) return rhythmBeamCountForValue(storedDuration);

  const at = normalizeFraction(event?.at || [0, 1]);
  const denominator = Math.abs(Number(at[1])) || 1;
  let impliedDuration = denominator === 1 ? 1 : denominator === 2 ? 0.5 : 0.25;
  const atValue = fractionToNumber(at);
  const next = orderedEvents.find(candidate => fractionToNumber(candidate.at) > atValue + 1e-9);
  if (next) impliedDuration = Math.min(impliedDuration, Math.max(0, fractionToNumber(next.at) - atValue));
  return rhythmBeamCountForValue(impliedDuration);
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

function explicitRhythmGroup(measure, event) {
  const eventId = String(event?.id || '');
  const atKey = fractionKey(event?.at || [0, 1]);
  return (measure?.groups || []).find(group => {
    if (!['tuplet', 'subdivision'].includes(group?.type)) return false;
    if ((group.eventIds || []).map(String).includes(eventId)) return true;
    return (group.slots || []).some(slot => fractionKey(slot) === atKey);
  }) || null;
}

function displayValueForNote(note) {
  const value = noteDisplayValue(note);
  if (!harmonicTechnique(note)) return value;
  return isScoreViewActive() ? `<${value}>` : value;
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
      const occupiedStrings = new Set((event?.notes || []).map(note => Number(note.string)));
      const target = div('v3-column-target');
      target.dataset.measureId = String(measure.id);
      target.dataset.at = fractionKey(time.at);
      target.dataset.duration = fractionKey(time.duration || BASE_GRID_STEP);
      if (event?.id) target.dataset.eventId = String(event.id);
      target.style.left = `${left}%`;
      target.style.width = `${width}%`;
      target.style.setProperty('--v3-anchor-x', `${anchor}%`);
      for (let string = 0; string < this.stringCount; string++) {
        if (occupiedStrings.has(string)) continue;
        const dot = div('v3-slot-dot');
        dot.dataset.string = String(string);
        dot.style.top = `${((string + 0.5) / this.stringCount) * 100}%`;
        target.appendChild(dot);
      }
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
        const displayValue = displayValueForNote(note);
        noteNode.textContent = displayValue;
        noteNode.setAttribute('aria-label', `第 ${Number(note.string) + 1} 弦 ${displayValue} 品`);
        eventNode.appendChild(noteNode);
      }
      staff.appendChild(eventNode);
    }
    node.appendChild(staff);
    if (isScoreViewActive()) node.appendChild(this.createRhythmLayer(measure, visualTimeByKey));
    return node;
  }

  createRhythmLayer(measure, visualTimeByKey) {
    const layer = div('v3-rhythm-layer');
    const orderedEvents = (measure.events || [])
      .filter(event => (event.notes || []).length)
      .sort((left, right) => fractionToNumber(left.at) - fractionToNumber(right.at));
    const points = orderedEvents.map(event => {
      const visualTime = visualTimeByKey.get(fractionKey(event.at));
      const group = explicitRhythmGroup(measure, event);
      const groupBeamCount = Number(group?.beamCount);
      return {
        event,
        x: visualPercentageForTime(event.at, visualTime?.duration || event.duration || BASE_GRID_STEP, measure),
        at: fractionToNumber(event.at),
        beams: Number.isFinite(groupBeamCount)
          ? Math.max(0, Math.trunc(groupBeamCount))
          : inferredOrdinaryBeamCount(event, orderedEvents),
        group
      };
    });

    const groups = new Map();
    points.forEach(point => {
      const key = point.group?.id ? `group:${point.group.id}` : `beat:${Math.floor(point.at + 1e-9)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(point);
      const stem = div('v3-rhythm-stem');
      stem.style.left = `${point.x}%`;
      layer.appendChild(stem);
    });

    groups.forEach(groupPoints => {
      groupPoints.sort((left, right) => left.at - right.at);
      const maxBeams = Math.max(0, ...groupPoints.map(point => point.beams));
      for (let level = 1; level <= maxBeams; level++) {
        groupPoints.forEach((point, index) => {
          if (point.beams < level) return;
          const next = groupPoints[index + 1];
          const canConnect = Boolean(next && next.beams >= level);
          if (canConnect) {
            const beam = div(`v3-rhythm-beam v3-rhythm-beam-${level}`);
            beam.style.left = `${point.x}%`;
            beam.style.width = `${Math.max(0.5, next.x - point.x)}%`;
            layer.appendChild(beam);
            return;
          }
          const previous = groupPoints[index - 1];
          if (previous && previous.beams >= level) return;
          const flag = div(`v3-rhythm-flag v3-rhythm-beam-${level}`);
          flag.style.left = `${point.x}%`;
          layer.appendChild(flag);
        });
      }
    });

    for (const group of measure.groups || []) {
      if (group?.type !== 'tuplet') continue;
      const slots = Array.isArray(group.slots) ? group.slots : [];
      if (slots.length < 2) continue;
      const slotX = slot => {
        const visualTime = visualTimeByKey.get(fractionKey(slot));
        return visualPercentageForTime(slot, visualTime?.duration || group.duration || BASE_GRID_STEP, measure);
      };
      const left = slotX(slots[0]);
      const right = slotX(slots.at(-1));
      const groupPoints = points.filter(point => String(point.group?.id || '') === String(group.id || ''));
      const fullyBeamed = groupPoints.length === slots.length && groupPoints.length > 1 && groupPoints.every(point => point.beams > 0);
      if (fullyBeamed) {
        const label = div('v3-rhythm-tuplet-number v3-rhythm-tuplet-number-only');
        label.textContent = '3';
        label.style.left = `${(left + right) / 2}%`;
        label.setAttribute('aria-label', '三連音');
        layer.appendChild(label);
        continue;
      }
      const bracket = div('v3-rhythm-tuplet-bracket');
      bracket.style.left = `${left}%`;
      bracket.style.width = `${Math.max(1, right - left)}%`;
      bracket.setAttribute('aria-label', '三連音');
      bracket.append(
        div('v3-rhythm-tuplet-segment v3-rhythm-tuplet-segment-left'),
        Object.assign(div('v3-rhythm-tuplet-number'), { textContent: '3' }),
        div('v3-rhythm-tuplet-segment v3-rhythm-tuplet-segment-right')
      );
      layer.appendChild(bracket);
    }
    return layer;
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

  noteAt(measureId, at, string) {
    const measure = this.document?.measures?.find(item => String(item.id) === String(measureId));
    if (!measure) return null;
    const event = (measure.events || []).find(item => fractionKey(item.at) === fractionKey(at));
    return (event?.notes || []).find(note => Number(note.string) === Number(string)) || null;
  }

  cursorValueAt(measureId, at, string) {
    const note = this.noteAt(measureId, at, string);
    return note ? noteDisplayValue(note) : '';
  }

  handlePointerDown(event) {
    if (isPreviewActive() || isScoreViewActive() || window.editorV3?.toolSession?.active || window.editorV3?.chordPlacement?.active) return;
    if (event.target.closest?.('.v3-note-editor')) return;
    if (event.target.closest?.('.technique-marker,.editor-module-menu,.measure-module-hitbox')) return;
    const note = event.target.closest?.('.v3-note');
    if (note) {
      event.preventDefault();
      window.jumpToInput?.(note, false);
      this.showCursor({
        measureId: note.dataset.measureId,
        string: Number(note.dataset.string),
        at: parseFraction(note.dataset.at),
        duration: parseFraction(note.dataset.duration) || BASE_GRID_STEP,
        initialValue: this.cursorValueAt(note.dataset.measureId, parseFraction(note.dataset.at), Number(note.dataset.string))
      });
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
    const string = stringFromPointer(event.clientY, staff, this.stringCount);
    event.preventDefault();
    const playbackTarget = target || staff.querySelector(`.v3-column-target[data-at="${escapeSelector(fractionKey(at))}"]`);
    if (playbackTarget) window.jumpToInput?.(playbackTarget, false);
    this.showCursor({ measureId, string, at, duration, initialValue: this.cursorValueAt(measureId, at, string) });
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
      if (!next) return null;
      const nextAt = parseFraction(next.dataset.at);
      const nextDuration = parseFraction(next.dataset.duration) || BASE_GRID_STEP;
      return {
        measureId: next.dataset.measureId,
        at: nextAt,
        duration: nextDuration,
        string,
        initialValue: this.cursorValueAt(next.dataset.measureId, nextAt, string)
      };
    }
    const nextString = string + (direction === 'up' ? -1 : 1);
    if (nextString < 0 || nextString >= this.stringCount) return null;
    return {
      measureId,
      at,
      duration: parseFraction(this.root.querySelector(`.v3-column-target[data-measure-id="${escapeSelector(String(measureId))}"][data-at="${escapeSelector(key)}"]`)?.dataset.duration) || BASE_GRID_STEP,
      string: nextString,
      initialValue: this.cursorValueAt(measureId, at, nextString)
    };
  }

  showCursor({ measureId, string = 0, at = [0, 1], duration = BASE_GRID_STEP, initialValue = '' } = {}) {
    if (this.cursor?.isConnected) this.cursor.blur();
    const measure = this.document?.measures?.find(item => String(item.id) === String(measureId));
    const measureNode = this.root?.querySelector(`.v3-measure[data-measure-id="${escapeSelector(measureId)}"]`);
    const staff = measureNode?.querySelector('.v3-staff');
    if (!measure || !measureNode || !staff || !Array.isArray(at)) return null;
    const input = document.createElement('input');
    input.className = 'v3-note-editor';
    input.type = 'text';
    input.inputMode = 'numeric';
    input.maxLength = 2;
    const originalValue = normalizeFret(initialValue);
    input.value = originalValue;
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
      const nextValue = normalizeFret(input.value);
      if (nextValue === originalValue) return;
      this.onCommitNote?.({ measureId: String(measureId), string: Number(string), at: cloneValue(at), duration: cloneValue(duration || BASE_GRID_STEP), fret: nextValue });
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
      const navigation = { measureId: String(measureId), string: Number(string), at: cloneValue(at), direction };
      commit();
      this.hideCursor();
      requestAnimationFrame(() => {
        const next = this.navigateCursor(navigation);
        if (!next) return;
        const nextTarget = this.root?.querySelector(`.v3-column-target[data-measure-id="${escapeSelector(next.measureId)}"][data-at="${escapeSelector(fractionKey(next.at))}"]`);
        if (nextTarget) window.jumpToInput?.(nextTarget, false);
        this.showCursor(next);
      });
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