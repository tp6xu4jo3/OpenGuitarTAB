import {
  buildAdaptiveLayout,
  buildAdaptiveSystemLayout,
  buildCompactScoreLayout,
  columnGeometryForMeasure,
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
  indexDocument,
  isDocumentV3,
  updateDocumentIndex,
  normalizeDocumentV3,
  normalizeFraction,
  noteDisplayValue,
  STRING_COUNT
} from './model.js';
import { editableTimesForMeasure } from './rhythm-grid.js';
import {
  resolvedOrdinaryDurationValue,
  rhythmBeamCountForValue,
  rhythmDotCountForValue,
  rhythmPointsCanBeam
} from './rhythm-notation.js';
import { isPreviewActive, isScoreViewActive, scoreDensityMode } from './view-state.js';

const EDITOR_RAIL_WIDTH = 102;
const BASE_GRID_STEP = Object.freeze([1, 4]);
const SCORE_STAFF_TOP = 32;
const SCORE_STAFF_HEIGHT = 112;
const SCORE_RHYTHM_LAYER_TOP = 154;
const SCORE_NOTE_HALF_HEIGHT = 13;
const SCORE_STEM_END = 30;

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

function rhythmStemTopForEvent(event, stringCount = STRING_COUNT) {
  const strings = (event?.notes || [])
    .map(note => Math.max(0, Math.min(stringCount - 1, Number(note.string) || 0)));
  const lowestString = strings.length ? Math.max(...strings) : stringCount - 1;
  const noteCenter = SCORE_STAFF_TOP + ((lowestString + 0.5) / stringCount) * SCORE_STAFF_HEIGHT;
  return Math.min(-4, noteCenter + SCORE_NOTE_HALF_HEIGHT + 2 - SCORE_RHYTHM_LAYER_TOP);
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
    this.documentIndex = null;
    this.layoutPlan = null;
    this.layoutFrame = 0;
    this.cursor = null;
    this.observedWidth = -1;
    this.navigationEntries = [];
    this.navigationLookup = new Map();
    this.measureIndexById = new Map();
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
    const structureChanged = !changeSet
      || changeSet.document
      || changeSet.layoutKind === 'structure'
      || !this.measureIndexById.size;
    if (structureChanged) this.rebuildMeasureIndex();
    this.documentIndex = updateDocumentIndex(this.documentIndex, this.document, {
      measures: changeSet?.measures || [],
      relations: changeSet?.relations || [],
      structure: structureChanged
    });
    const navigationChanged = structureChanged
      || changeSet?.layoutKind === 'grid'
      || !this.navigationEntries.length;
    if (navigationChanged) this.rebuildNavigationIndex();
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
      return { mode: 'compact', plan: buildCompactScoreLayout(this.document, { availableWidth, documentIndex: this.documentIndex }) };
    }
    return { mode: 'adaptive', plan: buildAdaptiveLayout(this.document, { availableWidth, documentIndex: this.documentIndex }) };
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
        line.style.setProperty('--score-density-line-width', `${Math.max(1, Number(visualRow.widthPx) || plan.availableWidth)}px`);
        visualRow.segments.forEach(segment => {
          const system = this.createSystem(segment, visualIndex);
          system.classList.add('score-density-segment');
          system.style.setProperty('--score-density-weight', String(Math.max(1, segment.widthWeight || segment.minimumWidth || 1)));
          system.style.setProperty('--score-density-width', `${Math.max(1, Number(segment.widthPx) || segment.minimumWidth || 1)}px`);
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
    const sourceMeasureCount = Math.max(segment.measures?.length || 0, Number(segment.sourceMeasureCount) || 0);
    const system = div('tab-system adaptive-tab-system v3-system');
    system.dataset.row = String(rowIndex);
    system.dataset.sourceRow = String(rowIndex);
    system.dataset.visualRow = String(visualIndex);
    system.dataset.sourceStart = String(Number(segment.startMeasure || 0) === 0);
    system.dataset.sourceEnd = String((Number(segment.startMeasure || 0) + segment.measures.length) >= sourceMeasureCount);
    system.dataset.centerKey = `row-${rowIndex}`;
    if (Number(segment.widthPx) > 0) system.style.setProperty('--score-density-width', `${Number(segment.widthPx)}px`);
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
    const pixelWidths = segment.measureWidthsPx?.length === measures.length
      ? segment.measureWidthsPx.map(value => Math.max(1, Number(value) || 1))
      : null;
    const gridWidth = Math.max(1, Number(segment.widthPx) || pixelWidths?.reduce((sum, value) => sum + value, 0) || 0);
    const grid = div('tab-grid adaptive-tab-grid v3-grid');
    grid.dataset.row = String(rowIndex);
    grid.dataset.measureStart = String(Number(segment.startMeasure) || 0);
    grid.dataset.measureCount = String(Math.max(1, measures.length));
    grid.dataset.measureIds = measures.map(measure => measure.id).join(',');
    grid.dataset.measureWidths = widths.map(value => Number(value).toFixed(6)).join(',');
    if (pixelWidths) grid.dataset.measureWidthsPx = pixelWidths.map(value => Number(value).toFixed(3)).join(',');
    grid.dataset.widthPx = Number(gridWidth).toFixed(3);
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = pixelWidths
      ? pixelWidths.map(width => `${Number(width).toFixed(3)}px`).join(' ')
      : widths.map(width => `${Number(width).toFixed(6)}%`).join(' ');
    grid.style.position = 'relative';
    grid.style.setProperty('--score-grid-width', `${gridWidth}px`);
    measures.forEach((measure, index) => grid.appendChild(this.createMeasure(measure, index, pixelWidths?.[index] || null)));
    return grid;
  }

  createMeasure(measure, localMeasureIndex = 0, measureWidthPx = null) {
    const node = div('v3-measure');
    node.dataset.measureId = String(measure.id);
    node.dataset.measureIndex = String(localMeasureIndex);
    node.style.position = 'relative';
    node.style.setProperty('--v3-strings', String(this.stringCount));
    const geometry = columnGeometryForMeasure(this.document, measure, measureWidthPx, this.documentIndex);
    const pointForTime = time => geometry.percentForKey(fractionKey(time.at))
      ?? visualPercentageForTime(time.at, time.duration || BASE_GRID_STEP, measure);
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
      guide.style.left = `${geometry.percentForFraction([beat, 1])}%`;
      staff.appendChild(guide);
    }
    const times = editableTimesForMeasure(measure);
    const visualTimeByKey = new Map(times.map(time => [fractionKey(time.at), time]));
    times.forEach((time, index) => {
      const current = pointForTime(time);
      const previous = index > 0 ? pointForTime(times[index - 1]) : 0;
      const next = index + 1 < times.length ? pointForTime(times[index + 1]) : 100;
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
      const eventX = geometry.percentForKey(fractionKey(event.at))
        ?? visualPercentageForTime(event.at, visualTime?.duration || BASE_GRID_STEP, measure);
      eventNode.style.left = `${eventX}%`;
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
    if (isScoreViewActive()) node.appendChild(this.createRhythmLayer(measure, visualTimeByKey, geometry));
    return node;
  }

  createRhythmLayer(measure, visualTimeByKey, geometry) {
    const layer = div('v3-rhythm-layer');
    const orderedEvents = (measure.events || [])
      .filter(event => (event.notes || []).length)
      .sort((left, right) => fractionToNumber(left.at) - fractionToNumber(right.at));
    const points = orderedEvents.map(event => {
      const visualTime = visualTimeByKey.get(fractionKey(event.at));
      const group = explicitRhythmGroup(measure, event);
      const groupBeamCount = Number(group?.beamCount);
      const durationValue = resolvedOrdinaryDurationValue(event, orderedEvents, measure);
      return {
        event,
        x: geometry.percentForKey(fractionKey(event.at))
          ?? visualPercentageForTime(event.at, visualTime?.duration || event.duration || BASE_GRID_STEP, measure),
        at: fractionToNumber(event.at),
        beams: Number.isFinite(groupBeamCount)
          ? Math.max(0, Math.trunc(groupBeamCount))
          : rhythmBeamCountForValue(durationValue),
        dots: group?.type === 'tuplet' ? 0 : rhythmDotCountForValue(durationValue),
        durationValue,
        group,
        stemTop: rhythmStemTopForEvent(event, this.stringCount)
      };
    });

    points.forEach(point => {
      const stem = div('v3-rhythm-stem');
      stem.style.left = `${point.x}%`;
      stem.style.top = `${point.stemTop}px`;
      stem.style.height = `${Math.max(4, SCORE_STEM_END - point.stemTop)}px`;
      layer.appendChild(stem);
      if (point.dots > 0) {
        const dot = div('v3-rhythm-dot');
        dot.style.left = `${point.x}%`;
        layer.appendChild(dot);
      }
    });

    for (let index = 0; index + 1 < points.length; index += 1) {
      const point = points[index];
      const next = points[index + 1];
      const maxLevel = Math.min(point.beams, next.beams);
      for (let level = 1; level <= maxLevel; level += 1) {
        if (!rhythmPointsCanBeam(point, next, measure, level)) continue;
        const beam = div(`v3-rhythm-beam v3-rhythm-beam-${level}`);
        beam.style.left = `${point.x}%`;
        beam.style.width = `${Math.max(0.5, next.x - point.x)}%`;
        layer.appendChild(beam);
      }
    }

    points.forEach((point, index) => {
      if (point.beams <= 0) return;
      const previous = points[index - 1];
      const next = points[index + 1];
      const primaryPrevious = rhythmPointsCanBeam(previous, point, measure, 1);
      const primaryNext = rhythmPointsCanBeam(point, next, measure, 1);
      if (!primaryPrevious && !primaryNext) {
        for (let level = 1; level <= point.beams; level += 1) {
          const flag = div(`v3-rhythm-flag v3-rhythm-beam-${level}`);
          flag.style.left = `${point.x}%`;
          layer.appendChild(flag);
        }
        return;
      }
      for (let level = 2; level <= point.beams; level += 1) {
        const secondaryPrevious = rhythmPointsCanBeam(previous, point, measure, level);
        const secondaryNext = rhythmPointsCanBeam(point, next, measure, level);
        if (secondaryPrevious || secondaryNext) continue;
        const direction = primaryNext ? 'forward' : 'backward';
        const hook = div(`v3-rhythm-hook v3-rhythm-hook-${direction} v3-rhythm-beam-${level}`);
        hook.style.left = `${point.x}%`;
        layer.appendChild(hook);
      }
    });

    for (const group of measure.groups || []) {
      if (group?.type !== 'tuplet') continue;
      const slots = Array.isArray(group.slots) ? group.slots : [];
      if (slots.length < 2) continue;
      const slotX = slot => {
        const key = fractionKey(slot);
        const visualTime = visualTimeByKey.get(key);
        return geometry.percentForKey(key)
          ?? geometry.percentForFraction(slot)
          ?? visualPercentageForTime(slot, visualTime?.duration || group.duration || BASE_GRID_STEP, measure);
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

  rebuildMeasureIndex() {
    this.measureIndexById.clear();
    (this.document?.measures || []).forEach((measure, index) => this.measureIndexById.set(String(measure.id), index));
  }

  measureForId(measureId) {
    const index = this.measureIndexById.get(String(measureId));
    return Number.isInteger(index) ? this.document?.measures?.[index] || null : null;
  }

  renderMeasure(measureId, measureWidthPx = null) {
    const measure = this.measureForId(measureId);
    const existing = this.root?.querySelector(`.v3-measure[data-measure-id="${escapeSelector(measureId)}"]`);
    if (!measure || !existing) return false;
    const index = Number(existing.dataset.measureIndex) || 0;
    const measuredWidth = Number(measureWidthPx) || Number(existing.getBoundingClientRect?.().width) || null;
    existing.replaceWith(this.createMeasure(measure, index, measuredWidth));
    return true;
  }

  replaceAdaptiveSourcePlan(sourceSystemIndex, sourceMeasures, nextSegments, availableWidth) {
    const previousSystems = this.layoutPlan?.systems;
    if (!Array.isArray(previousSystems)) return null;
    const systems = [];
    let inserted = false;
    for (const segment of previousSystems) {
      if (Number(segment.sourceSystemIndex) === sourceSystemIndex) {
        if (!inserted) {
          systems.push(...nextSegments);
          inserted = true;
        }
        continue;
      }
      systems.push(segment);
    }
    if (!inserted) return null;
    const logicalSystems = Array.isArray(this.layoutPlan?.logicalSystems)
      ? this.layoutPlan.logicalSystems.slice()
      : [];
    logicalSystems[sourceSystemIndex] = sourceMeasures;
    return { ...this.layoutPlan, availableWidth, systems, logicalSystems };
  }

  applyLayoutChange(changeSet) {
    if (isScoreViewActive()) return false;
    const anchor = this.root?.querySelector(`.v3-measure[data-measure-id="${escapeSelector(changeSet.layoutFrom)}"]`);
    const sourceSystemIndex = Number(anchor?.closest?.('.tab-system')?.dataset?.sourceRow);
    if (!Number.isInteger(sourceSystemIndex) || sourceSystemIndex < 0) return false;
    const existing = [...this.root.querySelectorAll(`:scope > .tab-system[data-source-row="${sourceSystemIndex}"]`)]
      .sort((left, right) => {
        const leftStart = Number(left.querySelector(':scope .v3-grid')?.dataset.measureStart) || 0;
        const rightStart = Number(right.querySelector(':scope .v3-grid')?.dataset.measureStart) || 0;
        return leftStart - rightStart;
      });
    if (!existing.length) return false;

    const sourceMeasureIds = [];
    const seen = new Set();
    for (const system of existing) {
      const ids = String(system.querySelector(':scope .v3-grid')?.dataset.measureIds || '').split(',').filter(Boolean);
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        sourceMeasureIds.push(id);
      }
    }
    const sourceMeasures = sourceMeasureIds.map(id => this.measureForId(id)).filter(Boolean);
    if (!sourceMeasures.length || sourceMeasures.length !== sourceMeasureIds.length) return false;

    const availableWidth = layoutAvailableWidth(this.root);
    const nextSegments = buildAdaptiveSystemLayout(sourceMeasures, {
      sourceSystemIndex,
      availableWidth,
      documentModel: this.document,
      documentIndex: this.documentIndex
    });
    if (!nextSegments.length) return false;
    const nextPlan = this.replaceAdaptiveSourcePlan(sourceSystemIndex, sourceMeasures, nextSegments, availableWidth);
    if (!nextPlan) return false;

    const metricsOnly = changeSet.layoutKind === 'metrics';
    const sameShape = existing.length === nextSegments.length && existing.every((system, index) => {
      const grid = system.querySelector(':scope .v3-grid');
      return String(grid?.dataset.measureIds || '') === segmentSignature(nextSegments[index]);
    });
    const visualRowStart = nextPlan.systems.findIndex(segment => Number(segment.sourceSystemIndex) === sourceSystemIndex);
    const visualRowCount = nextSegments.length;
    const segmentationChanged = !sameShape;
    if (metricsOnly && sameShape) {
      existing.forEach((system, index) => this.updateGridWidths(system.querySelector(':scope .v3-grid'), nextSegments[index]));
      for (const measureId of changeSet.measures || []) {
        const segment = nextSegments.find(item => item.measureIds?.includes(String(measureId)));
        const measureIndex = segment?.measureIds?.indexOf(String(measureId)) ?? -1;
        this.renderMeasure(measureId, measureIndex >= 0 ? segment.measureWidthsPx?.[measureIndex] : null);
      }
    } else {
      const first = existing[0];
      const fragment = document.createDocumentFragment();
      nextSegments.forEach((segment, index) => fragment.appendChild(this.createSystem(segment, visualRowStart + index)));
      first.before(fragment);
      existing.forEach(node => node.remove());
    }
    this.layoutPlan = nextPlan;
    this.publishRendered({
      layout: nextPlan,
      partial: true,
      sourceSystemIndex,
      segmentationChanged,
      visualRowStart,
      visualRowCount
    });
    return true;
  }

  updateGridWidths(grid, segment) {
    if (!grid) return false;
    const widths = segment.measureWidths || [];
    if (!widths.length) return false;
    const pixelWidths = segment.measureWidthsPx?.length === widths.length
      ? segment.measureWidthsPx.map(value => Math.max(1, Number(value) || 1))
      : null;
    const gridWidth = Math.max(1, Number(segment.widthPx) || pixelWidths?.reduce((sum, value) => sum + value, 0) || 0);
    grid.dataset.measureWidths = widths.map(value => Number(value).toFixed(6)).join(',');
    if (pixelWidths) grid.dataset.measureWidthsPx = pixelWidths.map(value => Number(value).toFixed(3)).join(',');
    grid.dataset.widthPx = Number(gridWidth).toFixed(3);
    grid.style.gridTemplateColumns = pixelWidths
      ? pixelWidths.map(width => `${Number(width).toFixed(3)}px`).join(' ')
      : widths.map(width => `${Number(width).toFixed(6)}%`).join(' ');
    grid.style.setProperty('--score-grid-width', `${gridWidth}px`);
    grid.closest?.('.v3-system')?.style.setProperty('--score-density-width', `${gridWidth}px`);
    return true;
  }

  publishRendered(detail = {}) {
    window.editorLayoutPlan = detail.layout || this.layoutPlan;
    this.onRendered?.(detail);
    window.dispatchEvent(new CustomEvent('opentab:editor-rendered', { detail }));
  }

  rebuildNavigationIndex() {
    const entries = [];
    const lookup = new Map();
    for (const measure of this.document?.measures || []) {
      for (const time of editableTimesForMeasure(measure)) {
        const entry = {
          measureId: String(measure.id),
          at: cloneValue(time.at),
          duration: cloneValue(time.duration || BASE_GRID_STEP)
        };
        lookup.set(`${entry.measureId}:${fractionKey(entry.at)}`, entries.length);
        entries.push(entry);
      }
    }
    this.navigationEntries = entries;
    this.navigationLookup = lookup;
  }

  noteAt(measureId, at, string) {
    const measure = this.measureForId(measureId);
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
    const measure = this.measureForId(measureId);
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
    const index = this.navigationLookup.get(`${String(measureId)}:${fractionKey(at)}`);
    if (!Number.isInteger(index)) return null;
    const current = this.navigationEntries[index];
    if (!current) return null;
    if (direction === 'left' || direction === 'right') {
      const nextIndex = Math.max(0, Math.min(this.navigationEntries.length - 1, index + (direction === 'left' ? -1 : 1)));
      const next = this.navigationEntries[nextIndex];
      if (!next) return null;
      return {
        measureId: next.measureId,
        at: cloneValue(next.at),
        duration: cloneValue(next.duration || BASE_GRID_STEP),
        string,
        initialValue: this.cursorValueAt(next.measureId, next.at, string)
      };
    }
    const nextString = string + (direction === 'up' ? -1 : 1);
    if (nextString < 0 || nextString >= this.stringCount) return null;
    return {
      measureId: current.measureId,
      at: cloneValue(current.at),
      duration: cloneValue(current.duration || BASE_GRID_STEP),
      string: nextString,
      initialValue: this.cursorValueAt(current.measureId, current.at, nextString)
    };
  }

  showCursor({ measureId, string = 0, at = [0, 1], duration = BASE_GRID_STEP, initialValue = '' } = {}) {
    if (this.cursor?.isConnected) this.cursor.blur();
    const measure = this.measureForId(measureId);
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
    const measureWidth = Number(measureNode.getBoundingClientRect?.().width) || null;
    const geometry = columnGeometryForMeasure(this.document, measure, measureWidth, this.documentIndex);
    const cursorLeft = geometry.percentForKey(fractionKey(at)) ?? visualPercentageForAt(measure, at);
    Object.assign(input.style, { position: 'absolute', left: `${cursorLeft}%`, top: `${((Number(string) + 0.5) / this.stringCount) * 100}%`, transform: 'translate(-50%, -50%)' });

    const noteNode = staff.querySelector(`.v3-note[data-at="${escapeSelector(fractionKey(at))}"][data-string="${Number(string)}"]`);
    noteNode?.classList.add('is-editing');
    let cancelled = false;
    let committed = false;
    let finished = false;
    const logicalTarget = {
      measureId: String(measureId),
      string: Number(string),
      at: cloneValue(at),
      duration: cloneValue(duration || BASE_GRID_STEP)
    };
    const close = () => {
      if (finished) return;
      finished = true;
      noteNode?.classList.remove('is-editing');
      if (this.cursor === input) this.cursor = null;
      input.remove();
    };
    const commit = () => {
      if (committed || cancelled) return false;
      committed = true;
      const nextValue = normalizeFret(input.value);
      if (nextValue === originalValue) return false;
      this.onCommitNote?.({ ...logicalTarget, fret: nextValue });
      return true;
    };
    const moveCursor = target => {
      commit();
      close();
      const next = target || logicalTarget;
      const nextTarget = this.root?.querySelector(`.v3-column-target[data-measure-id="${escapeSelector(next.measureId)}"][data-at="${escapeSelector(fractionKey(next.at))}"]`);
      if (nextTarget) window.jumpToInput?.(nextTarget, false);
      return this.showCursor({
        ...next,
        initialValue: this.cursorValueAt(next.measureId, next.at, next.string)
      });
    };

    input.addEventListener('input', () => {
      const normalized = normalizeFret(input.value);
      if (input.value !== normalized) input.value = normalized;
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelled = true;
        close();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
        close();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        input.value = '';
        moveCursor(logicalTarget);
        return;
      }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key.replace('Arrow', '').toLowerCase();
      const next = this.navigateCursor({
        measureId: logicalTarget.measureId,
        string: logicalTarget.string,
        at: logicalTarget.at,
        direction
      });
      moveCursor(next || logicalTarget);
    });
    input.addEventListener('blur', () => {
      if (finished) return;
      commit();
      close();
    }, { once: true });
    staff.appendChild(input);
    this.cursor = input;
    input.focus({ preventScroll: true });
    input.select();
    return input;
  }

}
