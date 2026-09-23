import { indexDocument, relationNoteIds } from './model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgNode(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function centerIn(element, container) {
  const rect = element.getBoundingClientRect();
  const base = container.getBoundingClientRect();
  return {
    x: rect.left - base.left + rect.width / 2,
    y: rect.top - base.top + rect.height / 2
  };
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

  render(documentModel, systemElement, measureIds) {
    if (!systemElement) return;
    const svg = this.ensureOverlay(systemElement);
    svg.replaceChildren();
    const index = indexDocument(documentModel);
    const measureSet = new Set((measureIds || []).map(String));

    for (const relation of documentModel.relations || []) {
      const noteIds = relationNoteIds(relation);
      if (noteIds.length < 2) continue;
      const locations = noteIds.map(id => index.noteLocation.get(id));
      if (locations.some(location => !location || !measureSet.has(location.measureId))) continue;
      const fromId = relation.fromNoteId || noteIds[0];
      const toId = relation.toNoteId || noteIds[noteIds.length - 1];
      const fromNode = systemElement.querySelector(`[data-note-id="${CSS.escape(String(fromId))}"]`);
      const toNode = systemElement.querySelector(`[data-note-id="${CSS.escape(String(toId))}"]`);
      if (!fromNode || !toNode) continue;

      const from = centerIn(fromNode, systemElement);
      const to = centerIn(toNode, systemElement);
      const path = svgNode('path', {
        d: relationPath(relation.type, from, to),
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': relation.type === 'slide' ? 1.5 : 1.2,
        'stroke-linecap': 'round',
        'vector-effect': 'non-scaling-stroke',
        'data-relation-id': relation.id || ''
      });
      path.classList.add('notation-relation', `notation-relation-${relation.type || 'generic'}`);
      svg.appendChild(path);
    }
  }
}
