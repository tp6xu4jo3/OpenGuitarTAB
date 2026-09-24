import { buildSystems } from './layout.js';
import { fractionToNumber, indexDocument, noteDisplayValue } from './model.js';
import { RelationRenderer } from './relation-renderer.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgNode(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function escapeSelector(value) {
  const text = String(value ?? '');
  return globalThis.CSS?.escape ? CSS.escape(text) : text.replace(/["\\]/g, '\\$&');
}

function systemsWithLocations(documentModel) {
  return buildSystems(documentModel).map((system, rowIndex) => ({
    rowIndex,
    measures: system.map(measure => ({ measure, rowIndex }))
  }));
}

function noteNodes(root, noteId) {
  return [...root.querySelectorAll(`[data-note-id="${escapeSelector(noteId)}"]`)];
}

function eventNodes(root, eventId) {
  return [...root.querySelectorAll(`.note-input[data-event-id="${escapeSelector(eventId)}"]`)];
}

function eventNoteNodes(root, event) {
  const nodes = [];
  const seen = new Set();
  for (const note of event?.notes || []) {
    for (const node of noteNodes(root, note.id)) {
      if (!node.classList?.contains('note-input') || seen.has(node)) continue;
      seen.add(node);
      nodes.push(node);
    }
  }
  return nodes;
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
    const explicitIds = String(grid.dataset.measureIds || '').split(',').filter(Boolean);
    if (explicitIds.length) {
      explicitIds.forEach(id => ids.add(id));
      return;
    }

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
  return systemElement.querySelector(`.note-input[data-event-id="${escapeSelector(eventId)}"]`);
}

function representativeTimeNode(systemElement, measureId, at) {
  const atKey = Array.isArray(at) ? `${at[0]}/${at[1]}` : String(at || '');
  return systemElement.querySelector(
    `.note-input[data-measure-id="${escapeSelector(measureId)}"][data-at="${escapeSelector(atKey)}"]`
  );
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

function appendStraightSweep(svg, { x, top, bottom, direction, eventId }) {
  const fromY = direction === 'up' ? bottom : top;
  const toY = direction === 'up' ? top : bottom;
  const shaft = svgNode('path', {
    d: `M ${x} ${fromY} L ${x} ${toY}`,
    fill: 'none',
    'vector-effect': 'non-scaling-stroke',
    'data-event-id': eventId
  });
  shaft.classList.add('notation-symbol', 'notation-strum', `notation-strum-${direction || 'down'}`);
  svg.appendChild(shaft);

  const arrow = direction === 'up'
    ? `M ${x - 4} ${toY + 5} L ${x} ${toY} L ${x + 4} ${toY + 5}`
    : `M ${x - 4} ${toY - 5} L ${x} ${toY} L ${x + 4} ${toY - 5}`;
  const head = svgNode('path', {
    d: arrow,
    fill: 'none',
    'vector-effect': 'non-scaling-stroke',
    'data-event-id': eventId
  });
  head.classList.add('notation-symbol', 'notation-strum', `notation-strum-${direction || 'down'}`);
  svg.appendChild(head);
}

function wavePath(x, top, bottom) {
  const height = Math.max(10, bottom - top);
  const segments = Math.max(2, Math.ceil(height / 7));
  const step = height / segments;
  let path = `M ${x} ${top}`;
  for (let index = 0; index < segments; index++) {
    const y0 = top + index * step;
    const y1 = y0 + step;
    const direction = index % 2 === 0 ? 1 : -1;
    path += ` C ${x + 4 * direction} ${y0 + step * 0.25}, ${x + 4 * direction} ${y0 + step * 0.75}, ${x} ${y1}`;
  }
  return path;
}

function appendArpeggio(svg, { x, top, bottom, direction, eventId }) {
  const wave = svgNode('path', {
    d: wavePath(x, top, bottom),
    fill: 'none',
    'vector-effect': 'non-scaling-stroke',
    'data-event-id': eventId
  });
  wave.classList.add('notation-symbol', 'notation-arpeggio', `notation-arpeggio-${direction || 'down'}`);
  svg.appendChild(wave);

  const tipY = direction === 'up' ? top : bottom;
  const arrow = direction === 'up'
    ? `M ${x - 4} ${tipY + 5} L ${x} ${tipY} L ${x + 4} ${tipY + 5}`
    : `M ${x - 4} ${tipY - 5} L ${x} ${tipY} L ${x + 4} ${tipY - 5}`;
  const head = svgNode('path', {
    d: arrow,
    fill: 'none',
    'vector-effect': 'non-scaling-stroke',
    'data-event-id': eventId
  });
  head.classList.add('notation-symbol', 'notation-arpeggio', `notation-arpeggio-${direction || 'down'}`);
  svg.appendChild(head);
}

function ensureMarkerLayer(systemElement) {
  let layer = systemElement.querySelector(':scope > .technique-marker-layer');
  if (layer) return layer;
  layer = document.createElement('div');
  layer.className = 'technique-marker-layer';
  layer.setAttribute('aria-label', '技巧標記');
  systemElement.appendChild(layer);
  return layer;
}

function markerYForNode(node, systemElement) {
  const grid = node?.closest?.('.tab-grid');
  if (!grid) return Math.max(0, systemElement.getBoundingClientRect().height - 12);
  const gridRect = grid.getBoundingClientRect();
  const base = systemElement.getBoundingClientRect();
  return gridRect.bottom - base.top - 12;
}

function appendTechniqueMarker(layer, markerOffsets, { node, systemElement, kind, id, label, title }) {
  if (!node || !id) return;
  const point = centerIn(node, systemElement);
  const y = markerYForNode(node, systemElement);
  const key = `${Math.round(point.x / 4)}:${Math.round(y / 4)}`;
  const offset = markerOffsets.get(key) || 0;
  markerOffsets.set(key, offset + 1);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'technique-marker';
  button.dataset.techniqueKind = kind;
  button.dataset.techniqueId = String(id);
  button.textContent = label;
  button.title = title;
  button.setAttribute('aria-label', `${title}，點選後可按Delete刪除`);
  button.style.left = `${point.x + offset * 22}px`;
  button.style.top = `${y}px`;
  layer.appendChild(button);
}

function relationMarkerLabel(type) {
  if (type === 'slide') return '/';
  if (type === 'tie') return 'T';
  if (type === 'slur') return 'L';
  return '↔';
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
    if (!changeSet || changeSet.document) this.fullRenderPending = true;
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

  previewRelation({ fromNoteId, type = 'slur', clientX, clientY } = {}) {
    if (!fromNoteId || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      this.relationRenderer.clearPreview(this.root);
      return;
    }
    this.relationRenderer.preview(this.root, { fromNoteId, type, clientX, clientY });
  }

  clearPreview() {
    this.relationRenderer.clearPreview(this.root);
  }

  render(documentModel, changeSet = null) {
    this.document = documentModel || this.document;
    if (!this.document || !this.root) return;
    const systems = buildSystems(this.document);
    const locations = systemsWithLocations(this.document);
    const full = !changeSet || changeSet.document;
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
    this.root.querySelectorAll('.note-input').forEach(input => {
      delete input.dataset.noteId;
      delete input.dataset.eventId;
      delete input.dataset.notationDisplay;
      input.classList.remove('notation-harmonic-target');
    });
    locations.forEach(system => system.measures.forEach(entry => this.annotateMeasureEntry(entry)));
  }

  annotateMeasure(measureId, locations) {
    const entry = locations.flatMap(system => system.measures).find(item => String(item.measure.id) === String(measureId));
    if (!entry) return;
    this.root.querySelectorAll(`.note-input[data-measure-id="${escapeSelector(measureId)}"]`).forEach(input => {
      delete input.dataset.noteId;
      delete input.dataset.eventId;
      delete input.dataset.notationDisplay;
      input.classList.remove('notation-harmonic-target');
    });
    this.annotateMeasureEntry(entry);
  }

  annotateMeasureEntry({ measure, rowIndex }) {
    for (const event of measure.events || []) {
      const at = `${event.at?.[0] ?? 0}/${event.at?.[1] ?? 1}`;
      const timeSelector = `.note-input[data-row="${rowIndex}"][data-measure-id="${escapeSelector(measure.id)}"][data-at="${escapeSelector(at)}"]`;
      this.root.querySelectorAll(timeSelector).forEach(input => {
        input.dataset.eventId = event.id;
        input.dataset.measureId = measure.id;
      });
      for (const note of event.notes || []) {
        const selector = `${timeSelector}[data-string="${Number(note.string)}"]`;
        this.root.querySelectorAll(selector).forEach(input => {
          const harmonic = (note.techniques || []).some(technique => technique.type === 'harmonic');
          input.dataset.noteId = note.id;
          input.classList.toggle('notation-harmonic-target', harmonic);
          if (harmonic) input.dataset.notationDisplay = noteDisplayValue(note);
          else delete input.dataset.notationDisplay;
        });
      }
    }
  }

  renderSystem(systemElement, systems) {
    const measureIds = visibleMeasureIds(systemElement, systems);
    this.relationRenderer.render(this.document, systemElement, measureIds);
    const svg = systemElement.querySelector(':scope > svg.notation-overlay');
    if (!svg) return;

    const markerLayer = ensureMarkerLayer(systemElement);
    markerLayer.replaceChildren();
    const markerOffsets = new Map();
    const measureSet = new Set(measureIds.map(String));
    const measures = this.document.measures.filter(measure => measureSet.has(String(measure.id)));

    for (const measure of measures) {
      for (const event of measure.events || []) {
        const nodes = eventNodes(systemElement, event.id);
        if (!nodes.length) continue;
        const noteTargets = eventNoteNodes(systemElement, event);
        const notePoints = noteTargets.map(node => centerIn(node, systemElement));
        const anchor = notePoints[0] || centerIn(nodes[0], systemElement);
        const top = notePoints.length ? Math.min(...notePoints.map(point => point.y)) - 5 : anchor.y - 5;
        const bottom = notePoints.length ? Math.max(...notePoints.map(point => point.y)) + 5 : anchor.y + 5;

        for (const mark of event.marks || []) {
          if (mark.type === 'strum') {
            appendStraightSweep(svg, {
              x: anchor.x - 14,
              top,
              bottom,
              direction: mark.direction === 'up' ? 'up' : 'down',
              eventId: event.id
            });
            appendTechniqueMarker(markerLayer, markerOffsets, {
              node: noteTargets[0] || nodes[0],
              systemElement,
              kind: 'mark',
              id: mark.id,
              label: mark.direction === 'up' ? '↑' : '↓',
              title: mark.direction === 'up' ? '上刷' : '下刷'
            });
          }

          if (mark.type === 'arpeggio') {
            appendArpeggio(svg, {
              x: anchor.x - 14,
              top,
              bottom,
              direction: mark.direction === 'up' ? 'up' : 'down',
              eventId: event.id
            });
            appendTechniqueMarker(markerLayer, markerOffsets, {
              node: noteTargets[0] || nodes[0],
              systemElement,
              kind: 'mark',
              id: mark.id,
              label: mark.direction === 'up' ? 'A↑' : 'A↓',
              title: mark.direction === 'up' ? '向上琶音' : '向下琶音'
            });
          }
        }

        if (fractionToNumber(event.duration) === 1 / 8) {
          appendText(svg, {
            x: anchor.x + 13,
            y: bottom + 8,
            text: '32',
            className: 'notation-duration-32',
            eventId: event.id
          });
        }

        for (const note of event.notes || []) {
          const harmonic = (note.techniques || []).find(technique => technique.type === 'harmonic');
          if (!harmonic) continue;
          for (const node of noteNodes(systemElement, note.id).filter(item => item.classList?.contains('note-input'))) {
            const point = centerIn(node, systemElement);
            appendText(svg, {
              x: point.x,
              y: point.y,
              text: noteDisplayValue(note),
              className: 'notation-harmonic-label',
              noteId: note.id
            });
            appendTechniqueMarker(markerLayer, markerOffsets, {
              node,
              systemElement,
              kind: 'technique',
              id: harmonic.id,
              label: 'H',
              title: '人工泛音'
            });
          }
        }
      }

      for (const group of measure.groups || []) {
        if (group.type !== 'tuplet') continue;
        const firstSlot = group.slots?.[0];
        const lastSlot = group.slots?.[group.slots.length - 1];
        const firstNode = firstSlot
          ? representativeTimeNode(systemElement, measure.id, firstSlot)
          : representativeEventNode(systemElement, group.eventIds?.[0]);
        const lastNode = lastSlot
          ? representativeTimeNode(systemElement, measure.id, lastSlot)
          : representativeEventNode(systemElement, group.eventIds?.[group.eventIds.length - 1]);
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
        appendTechniqueMarker(markerLayer, markerOffsets, {
          node: firstNode,
          systemElement,
          kind: 'group',
          id: group.id,
          label: String(group.ratio?.[0] || 3),
          title: '三連音'
        });
      }
    }

    const index = indexDocument(this.document);
    for (const relation of this.document.relations || []) {
      const sourceLocation = index.noteLocation.get(String(relation.fromNoteId || ''));
      if (!sourceLocation || !measureSet.has(String(sourceLocation.measureId))) continue;
      const sourceNode = systemElement.querySelector(`.note-input[data-note-id="${escapeSelector(relation.fromNoteId)}"]`);
      if (!sourceNode) continue;
      appendTechniqueMarker(markerLayer, markerOffsets, {
        node: sourceNode,
        systemElement,
        kind: 'relation',
        id: relation.id,
        label: relationMarkerLabel(relation.type),
        title: relation.type === 'slide' ? '滑音' : relation.type === 'tie' ? '延音線' : '圓滑線'
      });
    }
  }
}
