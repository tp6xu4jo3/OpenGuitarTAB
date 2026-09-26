import { fractionKey, indexDocument } from './model.js';
import { RelationRenderer } from './relation-renderer.js';
import { isScoreViewActive } from './view-state.js';

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

function noteNodes(root, noteId) {
  return [...root.querySelectorAll(`.v3-note[data-note-id="${escapeSelector(noteId)}"]`)];
}

function eventNodes(root, eventId) {
  return [...root.querySelectorAll(`.v3-event[data-event-id="${escapeSelector(eventId)}"]`)];
}

function columnNode(root, measureId, at) {
  if (!measureId || !Array.isArray(at)) return null;
  return root.querySelector(`.v3-column-target[data-measure-id="${escapeSelector(measureId)}"][data-at="${escapeSelector(fractionKey(at))}"]`);
}

function eventNoteNodes(root, event) {
  return (event?.notes || []).flatMap(note => noteNodes(root, note.id));
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

function markerPointIn(element, container) {
  const point = centerIn(element, container);
  if (!element?.classList?.contains('v3-column-target')) return point;
  const rect = element.getBoundingClientRect();
  const base = container.getBoundingClientRect();
  const rawAnchor = Number.parseFloat(element.style.getPropertyValue('--v3-anchor-x'));
  const anchor = Number.isFinite(rawAnchor) ? Math.max(0, Math.min(100, rawAnchor)) / 100 : 0.5;
  return { ...point, x: rect.left - base.left + rect.width * anchor };
}

function visibleMeasureIds(systemElement) {
  const ids = new Set();
  systemElement.querySelectorAll('.v3-grid').forEach(grid => {
    String(grid.dataset.measureIds || '').split(',').filter(Boolean).forEach(id => ids.add(id));
  });
  return [...ids];
}

function appendText(svg, { x, y, text, className, eventId = '', noteId = '' }) {
  const node = svgNode('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'aria-hidden': 'true' });
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
  const shaft = svgNode('path', { d: `M ${x} ${fromY} L ${x} ${toY}`, fill: 'none', 'vector-effect': 'non-scaling-stroke', 'data-event-id': eventId });
  shaft.classList.add('notation-symbol', 'notation-strum', `notation-strum-${direction || 'down'}`);
  svg.appendChild(shaft);
  const arrow = direction === 'up'
    ? `M ${x - 4} ${toY + 5} L ${x} ${toY} L ${x + 4} ${toY + 5}`
    : `M ${x - 4} ${toY - 5} L ${x} ${toY} L ${x + 4} ${toY - 5}`;
  const head = svgNode('path', { d: arrow, fill: 'none', 'vector-effect': 'non-scaling-stroke', 'data-event-id': eventId });
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
    path += ` C ${x + 4 * direction} ${y0 + step * .25}, ${x + 4 * direction} ${y0 + step * .75}, ${x} ${y1}`;
  }
  return path;
}

function appendArpeggio(svg, { x, top, bottom, direction, eventId }) {
  const wave = svgNode('path', { d: wavePath(x, top, bottom), fill: 'none', 'vector-effect': 'non-scaling-stroke', 'data-event-id': eventId });
  wave.classList.add('notation-symbol', 'notation-arpeggio', `notation-arpeggio-${direction || 'down'}`);
  svg.appendChild(wave);
  const tipY = direction === 'up' ? top : bottom;
  const arrow = direction === 'up'
    ? `M ${x - 4} ${tipY + 5} L ${x} ${tipY} L ${x + 4} ${tipY + 5}`
    : `M ${x - 4} ${tipY - 5} L ${x} ${tipY} L ${x + 4} ${tipY - 5}`;
  const head = svgNode('path', { d: arrow, fill: 'none', 'vector-effect': 'non-scaling-stroke', 'data-event-id': eventId });
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

function staffBottomInSystem(node, systemElement) {
  const staff = node?.closest?.('.v3-staff');
  const base = systemElement.getBoundingClientRect();
  if (!staff) return Math.max(18, base.height - 18);
  const rect = staff.getBoundingClientRect();
  return Math.min(base.height - 8, rect.bottom - base.top + 18);
}

function chordLaneY(node, systemElement) {
  const staff = node?.closest?.('.v3-staff');
  const base = systemElement.getBoundingClientRect();
  const firstString = staff?.querySelector?.('.v3-string-line[data-string="0"]');
  if (firstString) {
    const rect = firstString.getBoundingClientRect();
    return Math.max(9, rect.top - base.top - 16);
  }
  if (!staff) return 12;
  const rect = staff.getBoundingClientRect();
  return Math.max(9, rect.top - base.top - 10);
}

function appendTechniqueMarker(layer, markerBuckets, { node = null, nodes = null, systemElement, kind, id, label, title }) {
  const anchors = [...new Set((Array.isArray(nodes) && nodes.length ? nodes : [node]).filter(Boolean))];
  if (!anchors.length || !id) return;
  const points = anchors.map(anchor => markerPointIn(anchor, systemElement));
  const x = (Math.min(...points.map(point => point.x)) + Math.max(...points.map(point => point.x))) / 2;
  const y = staffBottomInSystem(anchors[0], systemElement);
  const key = `${Math.round(x / 4)}:${Math.round(y / 4)}`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'technique-marker';
  button.dataset.techniqueKind = kind;
  button.dataset.techniqueId = String(id);
  button.textContent = label;
  button.title = title;
  button.setAttribute('aria-label', `${title}，點選後可按Delete刪除`);
  button.style.top = `${y}px`;
  layer.appendChild(button);

  const bucket = markerBuckets.get(key) || [];
  bucket.push({ button, x });
  markerBuckets.set(key, bucket);
  const centerX = bucket.reduce((sum, entry) => sum + entry.x, 0) / bucket.length;
  const spacing = 24;
  bucket.forEach((entry, index) => {
    entry.button.style.left = `${centerX + (index - (bucket.length - 1) / 2) * spacing}px`;
  });
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
        document: Boolean(previous.document || changeSet.document)
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
    const full = !changeSet || changeSet.document;
    const dirty = new Set((changeSet?.measures || []).map(String));
    const layoutRows = new Set();
    if (changeSet?.layoutFrom) {
      const layoutMeasures = new Set([String(changeSet.layoutFrom), ...dirty]);
      for (const measureId of layoutMeasures) {
        const measureNode = this.root.querySelector(`.v3-measure[data-measure-id="${escapeSelector(measureId)}"]`);
        const sourceRow = measureNode?.closest?.('.tab-system')?.dataset.sourceRow;
        if (sourceRow != null) layoutRows.add(String(sourceRow));
      }
    }
    const index = indexDocument(this.document);
    [...this.root.querySelectorAll('.tab-system')].forEach(systemElement => {
      const measureIds = visibleMeasureIds(systemElement);
      if (!full && (dirty.size || layoutRows.size)) {
        const sourceRow = String(systemElement.dataset.sourceRow ?? '');
        const layoutAffected = layoutRows.has(sourceRow);
        const measureAffected = measureIds.some(id => dirty.has(String(id)));
        if (!layoutAffected && !measureAffected) return;
      }
      this.renderSystem(systemElement, measureIds, index);
    });
  }

  renderSystem(systemElement, measureIds = visibleMeasureIds(systemElement), index = indexDocument(this.document)) {
    this.relationRenderer.render(this.document, systemElement, measureIds, index);
    const svg = systemElement.querySelector(':scope > svg.notation-overlay');
    if (!svg) return;
    const markerLayer = ensureMarkerLayer(systemElement);
    markerLayer.replaceChildren();
    const markerBuckets = new Map();
    const measureSet = new Set(measureIds.map(String));
    const measures = this.document.measures.filter(measure => measureSet.has(String(measure.id)));

    for (const measure of measures) {
      for (const event of measure.events || []) {
        const nodes = eventNodes(systemElement, event.id);
        const noteTargets = eventNoteNodes(systemElement, event);
        if (!nodes.length && !noteTargets.length) continue;
        const notePoints = noteTargets.map(node => centerIn(node, systemElement));
        const anchorNode = noteTargets[0] || nodes[0];
        const anchor = centerIn(anchorNode, systemElement);
        const top = notePoints.length ? Math.min(...notePoints.map(point => point.y)) - 5 : anchor.y - 5;
        const bottom = notePoints.length ? Math.max(...notePoints.map(point => point.y)) + 5 : anchor.y + 5;

        if (event.chord?.symbol) {
          appendText(svg, {
            x: anchor.x,
            y: chordLaneY(anchorNode, systemElement),
            text: String(event.chord.symbol),
            className: 'notation-chord-symbol',
            eventId: event.id
          });
        }

        for (const mark of event.marks || []) {
          if (mark.type === 'strum') {
            appendStraightSweep(svg, { x: anchor.x - 14, top, bottom, direction: mark.direction === 'up' ? 'up' : 'down', eventId: event.id });
            appendTechniqueMarker(markerLayer, markerBuckets, { node: anchorNode, systemElement, kind: 'mark', id: mark.id, label: mark.direction === 'up' ? '↑' : '↓', title: mark.direction === 'up' ? '上刷' : '下刷' });
          }
          if (mark.type === 'arpeggio') {
            appendArpeggio(svg, { x: anchor.x - 14, top, bottom, direction: mark.direction === 'up' ? 'up' : 'down', eventId: event.id });
            appendTechniqueMarker(markerLayer, markerBuckets, { node: anchorNode, systemElement, kind: 'mark', id: mark.id, label: mark.direction === 'up' ? 'A↑' : 'A↓', title: mark.direction === 'up' ? '向上琶音' : '向下琶音' });
          }
        }

        if (!isScoreViewActive()) {
          for (const note of event.notes || []) {
            const harmonic = (note.techniques || []).find(technique => technique.type === 'harmonic');
            if (!harmonic) continue;
            for (const node of noteNodes(systemElement, note.id)) {
              appendTechniqueMarker(markerLayer, markerBuckets, { node, systemElement, kind: 'technique', id: harmonic.id, label: 'H', title: '泛音' });
            }
          }
        }
      }

      if (!isScoreViewActive()) {
        for (const group of measure.groups || []) {
          const triplet = group?.type === 'tuplet';
          const thirtySecond = group?.type === 'subdivision' && group?.subdivision === 'thirty-second';
          if ((!triplet && !thirtySecond) || !group?.id) continue;
          const slots = Array.isArray(group.slots) ? group.slots : [];
          const startAt = slots[0] || group.startAt;
          const endAt = slots.at(-1) || startAt;
          const nodes = [
            columnNode(systemElement, measure.id, startAt),
            columnNode(systemElement, measure.id, endAt)
          ].filter(Boolean);
          appendTechniqueMarker(markerLayer, markerBuckets, {
            nodes,
            systemElement,
            kind: 'group',
            id: group.id,
            label: triplet ? '3' : '32',
            title: triplet
              ? (group.subdivision === 'sixteenth' ? '十六分三連音' : '三連音')
              : '三十二分音符'
          });
        }
      }
    }

    for (const relation of this.document.relations || []) {
      const sourceLocation = index.noteLocation.get(String(relation.fromNoteId || ''));
      if (!sourceLocation || !measureSet.has(String(sourceLocation.measureId))) continue;
      const sourceNode = systemElement.querySelector(`.v3-note[data-note-id="${escapeSelector(relation.fromNoteId)}"]`);
      if (!sourceNode || isScoreViewActive()) continue;
      const targetNode = relation.toNoteId
        ? systemElement.querySelector(`.v3-note[data-note-id="${escapeSelector(relation.toNoteId)}"]`)
        : null;
      appendTechniqueMarker(markerLayer, markerBuckets, {
        nodes: [sourceNode, targetNode].filter(Boolean),
        systemElement,
        kind: 'relation',
        id: relation.id,
        label: relationMarkerLabel(relation.type),
        title: relation.type === 'slide' ? '滑音' : relation.type === 'tie' ? '延音線' : '圓滑線'
      });
    }
  }
}
