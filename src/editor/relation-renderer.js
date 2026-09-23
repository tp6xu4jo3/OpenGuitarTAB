import { indexDocument, relationNoteIds } from './model.js';

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

function centerIn(element, container) {
  const rect = element.getBoundingClientRect();
  const base = container.getBoundingClientRect();
  return {
    x: rect.left - base.left + rect.width / 2,
    y: rect.top - base.top + rect.height / 2
  };
}

function edgePoint(grid, container, side, y) {
  const rect = grid.getBoundingClientRect();
  const base = container.getBoundingClientRect();
  const left = rect.left - base.left;
  const right = rect.right - base.left;
  const top = rect.top - base.top;
  const bottom = rect.bottom - base.top;
  return {
    x: side === 'left' ? left + 6 : right - 6,
    y: Math.max(top + 4, Math.min(bottom - 4, y))
  };
}

function relationGrid(node) {
  return node?.closest?.('.tab-grid') || null;
}

function relationPath(type, from, to) {
  if (type === 'tie' || type === 'slur') {
    const dx = to.x - from.x;
    const lift = Math.max(8, Math.min(28, Math.abs(dx) * 0.12));
    const controlX = from.x + dx / 2;
    const controlY = Math.min(from.y, to.y) - lift;
    return `M ${from.x} ${from.y} Q ${controlX} ${controlY} ${to.x} ${to.y}`;
  }
  return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
}

function appendRelationPath(svg, { type, from, to, relationId = '', preview = false }) {
  const path = svgNode('path', {
    d: relationPath(type, from, to),
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': type === 'slide' ? 1.5 : 1.2,
    'stroke-linecap': 'round',
    'vector-effect': 'non-scaling-stroke'
  });
  if (relationId) path.dataset.relationId = relationId;
  path.classList.add(
    'notation-relation',
    `notation-relation-${type || 'generic'}`,
    ...(preview ? ['notation-relation-preview'] : [])
  );
  svg.appendChild(path);
  return path;
}

export class RelationRenderer {
  constructor() {
    this.overlays = new WeakMap();
  }

  ensureOverlay(systemElement) {
    let svg = this.overlays.get(systemElement);
    if (svg?.isConnected) return svg;
    svg = systemElement.querySelector(':scope > svg.notation-overlay');
    if (!svg) {
      svg = svgNode('svg', {
        class: 'notation-overlay',
        'aria-hidden': 'true',
        preserveAspectRatio: 'none'
      });
      Object.assign(svg.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none'
      });
      if (getComputedStyle(systemElement).position === 'static') systemElement.style.position = 'relative';
      systemElement.appendChild(svg);
    }
    this.overlays.set(systemElement, svg);
    return svg;
  }

  clear(systemElement) {
    const svg = this.ensureOverlay(systemElement);
    svg.replaceChildren();
  }

  clearPreview(root) {
    root?.querySelectorAll?.('.notation-relation-preview').forEach(node => node.remove());
  }

  preview(root, { fromNoteId, type = 'slur', clientX, clientY } = {}) {
    this.clearPreview(root);
    if (!root || !fromNoteId || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    const fromNode = root.querySelector(`.note-input[data-note-id="${escapeSelector(fromNoteId)}"]`);
    const systemElement = fromNode?.closest?.('.tab-system');
    if (!fromNode || !systemElement) return;
    const svg = this.ensureOverlay(systemElement);
    const base = systemElement.getBoundingClientRect();
    appendRelationPath(svg, {
      type,
      from: centerIn(fromNode, systemElement),
      to: { x: clientX - base.left, y: clientY - base.top },
      preview: true
    });
  }

  render(documentModel, systemElement, measureIds) {
    if (!systemElement) return;
    const svg = this.ensureOverlay(systemElement);
    svg.replaceChildren();
    const index = indexDocument(documentModel);
    const measureSet = new Set((measureIds || []).map(String));

    for (const relation of documentModel.relations || []) {
      const noteIds = relationNoteIds(relation);
      if (noteIds.length < 2) continue;

      const fromId = String(relation.fromNoteId || noteIds[0]);
      const toId = String(relation.toNoteId || noteIds[noteIds.length - 1]);
      const fromLocation = index.noteLocation.get(fromId);
      const toLocation = index.noteLocation.get(toId);
      if (!fromLocation || !toLocation) continue;

      const fromInSystem = measureSet.has(String(fromLocation.measureId));
      const toInSystem = measureSet.has(String(toLocation.measureId));
      if (!fromInSystem && !toInSystem) continue;

      const fromNode = fromInSystem
        ? systemElement.querySelector(`.note-input[data-note-id="${escapeSelector(fromId)}"]`)
        : null;
      const toNode = toInSystem
        ? systemElement.querySelector(`.note-input[data-note-id="${escapeSelector(toId)}"]`)
        : null;
      const fromGrid = relationGrid(fromNode);
      const toGrid = relationGrid(toNode);

      if (fromNode && toNode && fromGrid === toGrid) {
        appendRelationPath(svg, {
          type: relation.type,
          from: centerIn(fromNode, systemElement),
          to: centerIn(toNode, systemElement),
          relationId: relation.id
        });
        continue;
      }

      if (fromNode && fromGrid) {
        const from = centerIn(fromNode, systemElement);
        appendRelationPath(svg, {
          type: relation.type,
          from,
          to: edgePoint(fromGrid, systemElement, 'right', from.y),
          relationId: relation.id
        });
      }

      if (toNode && toGrid) {
        const to = centerIn(toNode, systemElement);
        appendRelationPath(svg, {
          type: relation.type,
          from: edgePoint(toGrid, systemElement, 'left', to.y),
          to,
          relationId: relation.id
        });
      }
    }
  }
}
