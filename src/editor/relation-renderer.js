import { fractionKey, indexDocument, noteBaseFret, relationNoteIds } from './model.js';

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

function boxIn(element, container) {
  const rect = element.getBoundingClientRect();
  const base = container.getBoundingClientRect();
  const left = rect.left - base.left;
  const top = rect.top - base.top;
  return {
    left,
    right: rect.right - base.left,
    top,
    bottom: rect.bottom - base.top,
    x: left + rect.width / 2,
    y: top + rect.height / 2,
    width: rect.width,
    height: rect.height
  };
}

function edgePoint(grid, container, side, y) {
  const rect = grid.getBoundingClientRect();
  const base = container.getBoundingClientRect();
  const left = rect.left - base.left;
  const right = rect.right - base.left;
  const top = rect.top - base.top;
  const bottom = rect.bottom - base.top;
  return { x: side === 'left' ? left + 6 : right - 6, y: Math.max(top + 4, Math.min(bottom - 4, y)) };
}

function relationGrid(node) {
  return node?.closest?.('.v3-grid') || null;
}

function columnNode(systemElement, position) {
  if (!position?.measureId || !Array.isArray(position?.at)) return null;
  const measureId = escapeSelector(position.measureId);
  const at = escapeSelector(fractionKey(position.at));
  return systemElement.querySelector(`.v3-column-target[data-measure-id="${measureId}"][data-at="${at}"]`);
}

function columnX(node, container) {
  const box = boxIn(node, container);
  const anchor = Number.parseFloat(getComputedStyle(node).getPropertyValue('--v3-anchor-x'));
  const ratio = Number.isFinite(anchor) ? Math.max(0, Math.min(100, anchor)) / 100 : 0.5;
  return box.left + box.width * ratio;
}

function arcPoints(fromNode, toNode, container) {
  const from = boxIn(fromNode, container);
  const to = boxIn(toNode, container);
  return {
    from: { x: from.x, y: from.top - 1 },
    to: { x: to.x, y: to.top - 1 }
  };
}

function positionalArcPoints(relation, systemElement, fromNode) {
  const fromColumn = columnNode(systemElement, relation.fromPosition);
  const toColumn = columnNode(systemElement, relation.toPosition);
  if (!fromColumn || !toColumn || !fromNode) return null;
  const source = boxIn(fromNode, systemElement);
  const direction = relation.direction === 'down' ? 'down' : 'up';
  const y = direction === 'down' ? source.bottom + 1 : source.top - 1;
  return {
    from: { x: columnX(fromColumn, systemElement), y },
    to: { x: columnX(toColumn, systemElement), y }
  };
}

function slidePoints(fromNode, toNode, container, fromFret, toFret) {
  const from = boxIn(fromNode, container);
  const to = boxIn(toNode, container);
  const ascending = Number(toFret) > Number(fromFret);
  const delta = Number(toFret) === Number(fromFret) ? 0 : ascending ? -6 : 6;
  return {
    from: { x: from.right - 1, y: from.y - delta },
    to: { x: to.left + 1, y: to.y + delta }
  };
}

function relationPath(type, from, to, direction = 'up') {
  if (type === 'tie' || type === 'slur' || type === 'arc') {
    const dx = to.x - from.x;
    const lift = Math.max(9, Math.min(30, Math.abs(dx) * 0.15));
    const controlY = direction === 'down'
      ? Math.max(from.y, to.y) + lift
      : Math.min(from.y, to.y) - lift;
    return `M ${from.x} ${from.y} Q ${from.x + dx / 2} ${controlY} ${to.x} ${to.y}`;
  }
  return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
}

function appendRelationPath(svg, { type, direction = 'up', from, to, relationId = '', preview = false }) {
  const path = svgNode('path', {
    d: relationPath(type, from, to, direction),
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': type === 'slide' ? 1.8 : 1.35,
    'stroke-linecap': 'round',
    'vector-effect': 'non-scaling-stroke'
  });
  if (relationId) path.dataset.relationId = relationId;
  path.classList.add('notation-relation', `notation-relation-${type || 'generic'}`, ...(preview ? ['notation-relation-preview'] : []));
  if (type === 'arc') path.classList.add(`notation-relation-arc-${direction === 'down' ? 'down' : 'up'}`);
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
      svg = svgNode('svg', { class: 'notation-overlay', 'aria-hidden': 'true', preserveAspectRatio: 'none' });
      Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' });
      if (getComputedStyle(systemElement).position === 'static') systemElement.style.position = 'relative';
      systemElement.appendChild(svg);
    }
    this.overlays.set(systemElement, svg);
    return svg;
  }

  clearPreview(root) {
    root?.querySelectorAll?.('.notation-relation-preview').forEach(node => node.remove());
  }

  preview(root, { fromNoteId, type = 'slur', clientX, clientY } = {}) {
    this.clearPreview(root);
    if (!root || !fromNoteId || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    const fromNode = root.querySelector(`.v3-note[data-note-id="${escapeSelector(fromNoteId)}"]`);
    const systemElement = fromNode?.closest?.('.tab-system');
    if (!fromNode || !systemElement) return;
    const base = systemElement.getBoundingClientRect();
    const box = boxIn(fromNode, systemElement);
    appendRelationPath(this.ensureOverlay(systemElement), {
      type,
      from: type === 'slide' ? { x: box.right, y: box.y } : { x: box.x, y: box.top - 1 },
      to: { x: clientX - base.left, y: clientY - base.top },
      preview: true
    });
  }

  render(documentModel, systemElement, measureIds, documentIndex = null) {
    if (!systemElement) return;
    const svg = this.ensureOverlay(systemElement);
    svg.replaceChildren();
    const index = documentIndex || indexDocument(documentModel);
    const measureSet = new Set((measureIds || []).map(String));

    for (const relation of documentModel.relations || []) {
      if (relation.type === 'arc' && relation.fromPosition && relation.toPosition) {
        const measureId = String(relation.fromPosition.measureId || '');
        if (!measureId || measureId !== String(relation.toPosition.measureId || '') || !measureSet.has(measureId)) continue;
        const fromNode = systemElement.querySelector(`.v3-note[data-note-id="${escapeSelector(relation.fromNoteId)}"]`);
        const points = positionalArcPoints(relation, systemElement, fromNode);
        if (!points) continue;
        appendRelationPath(svg, {
          type: 'arc',
          direction: relation.direction,
          ...points,
          relationId: relation.id
        });
        continue;
      }

      const noteIds = relationNoteIds(relation);
      if (noteIds.length < 2) continue;
      const fromId = String(relation.fromNoteId || noteIds[0]);
      const toId = String(relation.toNoteId || noteIds.at(-1));
      const fromLocation = index.noteLocation.get(fromId);
      const toLocation = index.noteLocation.get(toId);
      if (!fromLocation || !toLocation) continue;
      const fromInSystem = measureSet.has(String(fromLocation.measureId));
      const toInSystem = measureSet.has(String(toLocation.measureId));
      if (!fromInSystem && !toInSystem) continue;
      const fromNode = fromInSystem ? systemElement.querySelector(`.v3-note[data-note-id="${escapeSelector(fromId)}"]`) : null;
      const toNode = toInSystem ? systemElement.querySelector(`.v3-note[data-note-id="${escapeSelector(toId)}"]`) : null;
      const fromGrid = relationGrid(fromNode);
      const toGrid = relationGrid(toNode);

      if (fromNode && toNode && fromGrid === toGrid) {
        const points = relation.type === 'slide'
          ? slidePoints(fromNode, toNode, systemElement, noteBaseFret(index.noteById.get(fromId)), noteBaseFret(index.noteById.get(toId)))
          : arcPoints(fromNode, toNode, systemElement);
        appendRelationPath(svg, { type: relation.type, ...points, relationId: relation.id });
        continue;
      }

      if (fromNode && fromGrid) {
        const box = boxIn(fromNode, systemElement);
        const from = relation.type === 'slide' ? { x: box.right, y: box.y } : { x: box.x, y: box.top - 1 };
        appendRelationPath(svg, { type: relation.type, from, to: edgePoint(fromGrid, systemElement, 'right', from.y), relationId: relation.id });
      }
      if (toNode && toGrid) {
        const box = boxIn(toNode, systemElement);
        const to = relation.type === 'slide' ? { x: box.left, y: box.y } : { x: box.x, y: box.top - 1 };
        appendRelationPath(svg, { type: relation.type, from: edgePoint(toGrid, systemElement, 'left', to.y), to, relationId: relation.id });
      }
    }
  }
}
