import { fractionToNumber } from './model.js';
import { RelationRenderer } from './relation-renderer.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const LEGACY_SLOTS_PER_BEAT = 4;
const MAX_MEASURES_PER_SYSTEM = 4;

function svgNode(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function escapeSelector(value) {
  const text = String(value ?? '');
  return globalThis.CSS?.escape ? CSS.escape(text) : text.replace(/["\\]/g, '\\$&');
}

function documentSystems(documentModel) {
  const breaks = new Set(documentModel?.layout?.systemBreakAfter || []);
  const systems = [];
  let current = [];
  for (const measure of documentModel?.measures || []) {
    current.push(measure);
    if (breaks.has(measure.id) || current.length >= MAX_MEASURES_PER_SYSTEM) {
      systems.push(current);
      current = [];
    }
  }
  if (current.length) systems.push(current);
  return systems.length ? systems : [[]];
}

function measureSlots(measure) {
  const signature = measure?.timeSignature || { numerator: 4, denominator: 4 };
  return Number(signature.numerator || 4) * (4 / Number(signature.denominator || 4)) * LEGACY_SLOTS_PER_BEAT;
}

function legacySlot(value) {
  const slot = fractionToNumber(value) * LEGACY_SLOTS_PER_BEAT;
  return Number.isInteger(slot) ? slot : null;
}

function systemsWithOffsets(systems) {
  return systems.map((system, rowIndex) => {
    let offset = 0;
    const measures = system.map((measure, measureIndex) => {
      const entry = { measure, rowIndex, measureIndex, offset };
      offset += measureSlots(measure);
      return entry;
    });
    return { rowIndex, measures };
  });
}

function noteNodes(root, noteId) {
  return [...root.querySelectorAll(`[data-note-id="${escapeSelector(noteId)}"]`)];
}

function eventNodes(root, eventId) {
  return [...root.querySelectorAll(`[data-event-id="${escapeSelector(eventId)}"]`)];
}

function centerIn(element, container) {
  const rect = element.getBoundingClientRect();
  const base = container.getBoundingClientRect();
  return {
    x: rect.left - base.left + rect.width / 2,
    y: rect.top - base.top + rect.height / 2,
    top: rect.top - base.top,
    bottom: rect.bottom - base.top
  };
}

function visibleMeasureIds(systemElement, systems) {
  const ids = new Set();
  systemElement.querySelectorAll('.tab-grid[data-row]').forEach(grid => {
    const rowIndex = Number(grid.dataset.row);
    const system = systems[rowIndex];
    if (!system) return;
    const start = Math.max(0, Number(grid.dataset.measureStart) || 0);
    const count = Math.max(1, Number(grid.dataset.measureCount) || system.length);
    system.slice(start, start + count).forEach(measure => ids.add(measure.id));
  });
  return [...ids];
}

function systemContainsMeasure(systemElement, measureId, systems) {
  return visibleMeasureIds(systemElement, systems).includes(String(measureId));
}

function representativeEventNode(systemElement, eventId) {
  return systemElement.querySelector(`[data-event-id="${escapeSelector(eventId)}"]`);
}

function appendText(svg, { x, y, text, className, eventId = '', noteId = '' }) {
  const node = svgNode('text', {
    x,
    y,
    'text-anchor': 'middle',
    'dominant-baseline': 'middle',
    'aria-hidden': 'true'
  });
  node.textContent = text;
  node.classList.add('notation-symbol', className);
  if (eventId) node.dataset.eventId = eventId;
  if (noteId) node.dataset.noteId = noteId;
  svg.appendChild(node);
  return node;
}

export class NotationRenderer {
  constructor(root, { relationRenderer = new RelationRenderer() } = {}) {
    this.root = root;
    this.relationRenderer = relationRenderer;
    this.document = null;
    this.pendingFrame = 0;
    this.pendingChangeSet = null;
    this.fullRenderPending = false;
  }

  schedule(documentModel, changeSet = null) {
    this.document = documentModel || this.document;
    if (!this.document || !this.root) return;
    if (!changeSet || changeSet.document || changeSet.layoutFrom) this.fullRenderPending = true;
    if (changeSet) {
      const previous = this.pendingChangeSet || {};
      this.pendingChangeSet = {
        ...previous,
        ...changeSet,
        measures: [...new Set([...(previous.measures || []), ...(changeSet.measures || [])])],
        relations: [...new Set([...(previous.relations || []), ...(changeSet.relations || [])])],
        document: Boolean(previous.document || changeSet.document),
        layoutFrom: previous.layoutFrom || changeSet.layoutFrom || null
      };
    }
    if (this.pendingFrame) return;
    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = 0;
      const pending = this.fullRenderPending ? null : this.pendingChangeSet;
      this.pendingChangeSet = null;
      this.fullRenderPending = false;
      this.render(this.document, pending);
    });
  }

  render(documentModel, changeSet = null) {
    this.document = documentModel || this.document;
    if (!this.document || !this.root) return;
    const systems = documentSystems(this.document);
    const locations = systemsWithOffsets(systems);
    const full = !changeSet || changeSet.document || changeSet.layoutFrom;
    const dirtyMeasureIds = new Set((changeSet?.measures || []).map(String));

    if (full) this.annotateAll(locations);
    else dirtyMeasureIds.forEach(measureId => this.annotateMeasure(measureId, locations));

    const systemNodes = [...this.root.querySelectorAll('.tab-system')];
    systemNodes.forEach(systemElement => {
      if (!full && dirtyMeasureIds.size && ![...dirtyMeasureIds].some(id => systemContainsMeasure(systemElement, id, systems))) return;
      this.renderSystem(systemElement, systems);
    });
  }

  annotateAll(locations) {
    this.root.querySelectorAll('.note-input[data-note-id],.note-input[data-event-id],.note-input[data-measure-id]').forEach(input => {
      delete input.dataset.noteId;
      delete input.dataset.eventId;
      delete input.dataset.measureId;
      input.classList.remove('notation-harmonic-target');
    });
    locations.forEach(system => system.measures.forEach(entry => this.annotateMeasureEntry(entry)));
  }

  annotateMeasure(measureId, locations) {
    const entry = locations.flatMap(system => system.measures).find(item => String(item.measure.id) === String(measureId));
    if (!entry) return;
    const start = entry.offset;
    const end = start + measureSlots(entry.measure);
    this.root.querySelectorAll(`.note-input[data-row="${entry.rowIndex}"]`).forEach(input => {
      const position = Number(input.dataset.position);
      if (position < start || position >= end) return;
      delete input.dataset.noteId;
      delete input.dataset.eventId;
      delete input.dataset.measureId;
      input.classList.remove('notation-harmonic-target');
    });
    this.annotateMeasureEntry(entry);
  }

  annotateMeasureEntry({ measure, rowIndex, offset }) {
    for (const event of measure.events || []) {
      const local = legacySlot(event.at);
      if (local == null) continue;
      const absolutePosition = offset + local;
      for (const note of event.notes || []) {
        const selector = `.note-input[data-row="${rowIndex}"][data-string="${Number(note.string)}"][data-position="${absolutePosition}"]`;
        this.root.querySelectorAll(selector).forEach(input => {
          input.dataset.noteId = note.id;
          input.dataset.eventId = event.id;
          input.dataset.measureId = measure.id;
          input.classList.toggle('notation-harmonic-target', (note.techniques || []).some(technique => technique.type === 'harmonic'));
        });
      }
    }
  }

  renderSystem(systemElement, systems) {
    const measureIds = visibleMeasureIds(systemElement, systems);
    this.relationRenderer.render(this.document, systemElement, measureIds);
    const svg = systemElement.querySelector(':scope > svg.notation-overlay');
    if (!svg) return;
    const measureSet = new Set(measureIds.map(String));
    const measures = this.document.measures.filter(measure => measureSet.has(String(measure.id)));

    for (const measure of measures) {
      for (const event of measure.events || []) {
        const nodes = eventNodes(systemElement, event.id);
        if (!nodes.length) continue;
        const points = nodes.map(node => centerIn(node, systemElement));
        const anchor = points[0];
        const top = Math.min(...points.map(point => point.top));
        const bottom = Math.max(...points.map(point => point.bottom));

        for (const mark of event.marks || []) {
          if (mark.type !== 'strum') continue;
          appendText(svg, {
            x: anchor.x - 13,
            y: top + (bottom - top) / 2,
            text: mark.direction === 'up' ? '↑' : '↓',
            className: `notation-strum notation-strum-${mark.direction || 'down'}`,
            eventId: event.id
          });
        }

        if (fractionToNumber(event.duration) === 1 / 8) {
          appendText(svg, {
            x: anchor.x + 13,
            y: bottom + 13,
            text: '32',
            className: 'notation-duration-32',
            eventId: event.id
          });
        }

        for (const note of event.notes || []) {
          if (!(note.techniques || []).some(technique => technique.type === 'harmonic')) continue;
          for (const node of noteNodes(systemElement, note.id)) {
            const point = centerIn(node, systemElement);
            const diamond = svgNode('path', {
              d: `M ${point.x} ${point.y - 13} L ${point.x + 13} ${point.y} L ${point.x} ${point.y + 13} L ${point.x - 13} ${point.y} Z`,
              fill: 'none',
              'vector-effect': 'non-scaling-stroke',
              'data-note-id': note.id
            });
            diamond.classList.add('notation-symbol', 'notation-harmonic');
            svg.appendChild(diamond);
          }
        }
      }

      for (const group of measure.groups || []) {
        if (group.type !== 'tuplet' || !Array.isArray(group.eventIds) || group.eventIds.length < 2) continue;
        const firstNode = representativeEventNode(systemElement, group.eventIds[0]);
        const lastNode = representativeEventNode(systemElement, group.eventIds[group.eventIds.length - 1]);
        if (!firstNode || !lastNode) continue;
        const first = centerIn(firstNode, systemElement);
        const last = centerIn(lastNode, systemElement);
        const base = systemElement.getBoundingClientRect();
        const y = Math.min(base.height - 8, Math.max(first.bottom, last.bottom) + 28);
        const path = svgNode('path', {
          d: `M ${first.x} ${y + 5} L ${first.x} ${y} L ${last.x} ${y} L ${last.x} ${y + 5}`,
          fill: 'none',
          'vector-effect': 'non-scaling-stroke',
          'data-group-id': group.id || ''
        });
        path.classList.add('notation-symbol', 'notation-tuplet-bracket');
        svg.appendChild(path);
        appendText(svg, {
          x: (first.x + last.x) / 2,
          y: y - 6,
          text: String(group.ratio?.[0] || 3),
          className: 'notation-tuplet-number'
        });
      }
    }
  }
}
