import { buildSystems, percentageForTime } from './layout.js';
import { cloneValue, fractionKey, normalizeDocumentV3 } from './model.js';
import { RelationRenderer } from './relation-renderer.js';

function div(className) {
  const node = document.createElement('div');
  node.className = className;
  return node;
}

function noteLabel(note) {
  const harmonic = (note.techniques || []).some(technique => technique.type === 'harmonic');
  return harmonic ? `<${note.fret}>` : String(note.fret ?? '');
}

export class SparseScoreRenderer {
  constructor(root, { stringCount = 6, relationRenderer = new RelationRenderer(), onCommitNote = null } = {}) {
    this.root = root;
    this.stringCount = stringCount;
    this.relationRenderer = relationRenderer;
    this.onCommitNote = onCommitNote;
    this.document = null;
    this.cursor = null;
  }

  render(documentModel, changeSet = null) {
    this.document = normalizeDocumentV3(documentModel);
    const needsFullRender = !this.root?.querySelector('.v3-system') || changeSet?.document || changeSet?.layoutFrom;
    if (needsFullRender) {
      this.renderAll();
      return;
    }

    for (const measureId of changeSet?.measures || []) this.renderMeasure(measureId);
    if ((changeSet?.relations || []).length || (changeSet?.measures || []).length) this.renderRelations();
  }

  renderAll() {
    if (!this.root) return;
    const fragment = document.createDocumentFragment();
    const systems = buildSystems(this.document);
    systems.forEach((measures, systemIndex) => {
      const system = div('v3-system');
      system.dataset.systemIndex = String(systemIndex);
      system.dataset.measureIds = measures.map(measure => measure.id).join(',');
      measures.forEach(measure => system.appendChild(this.createMeasure(measure)));
      fragment.appendChild(system);
    });
    this.root.replaceChildren(fragment);
    this.renderRelations();
  }

  createMeasure(measure) {
    const node = div('v3-measure');
    node.dataset.measureId = measure.id;
    node.style.position = 'relative';
    node.style.setProperty('--v3-strings', String(this.stringCount));

    const staff = div('v3-staff');
    staff.setAttribute('aria-label', 'TAB measure');
    for (let string = 0; string < this.stringCount; string++) {
      const line = div('v3-string-line');
      line.dataset.string = String(string);
      line.style.top = `${((string + 0.5) / this.stringCount) * 100}%`;
      staff.appendChild(line);
    }

    const beats = Number(measure.timeSignature?.numerator) || 4;
    for (let beat = 1; beat < beats; beat++) {
      const guide = div('v3-beat-guide');
      guide.style.left = `${beat / beats * 100}%`;
      staff.appendChild(guide);
    }

    for (const event of measure.events || []) {
      const eventNode = div('v3-event');
      eventNode.dataset.eventId = event.id;
      eventNode.dataset.at = fractionKey(event.at);
      eventNode.style.left = `${percentageForTime(event.at, measure)}%`;

      for (const mark of event.marks || []) {
        if (mark.type !== 'strum') continue;
        const marker = document.createElement('span');
        marker.className = `v3-event-mark v3-strum-${mark.direction || 'down'}`;
        marker.textContent = mark.direction === 'up' ? '↑' : '↓';
        marker.setAttribute('aria-label', `${mark.direction === 'up' ? '上' : '下'}刷弦`);
        eventNode.appendChild(marker);
      }

      for (const note of event.notes || []) {
        const noteNode = document.createElement('button');
        noteNode.type = 'button';
        noteNode.className = 'v3-note';
        noteNode.dataset.noteId = note.id;
        noteNode.dataset.eventId = event.id;
        noteNode.dataset.measureId = measure.id;
        noteNode.dataset.string = String(note.string);
        noteNode.style.top = `${((Number(note.string) + 0.5) / this.stringCount) * 100}%`;
        noteNode.textContent = noteLabel(note);
        noteNode.setAttribute('aria-label', `第 ${Number(note.string) + 1} 弦 ${note.fret} 品`);
        eventNode.appendChild(noteNode);
      }
      staff.appendChild(eventNode);
    }

    node.appendChild(staff);
    return node;
  }

  renderMeasure(measureId) {
    const measure = this.document.measures.find(item => item.id === measureId);
    const existing = this.root?.querySelector(`.v3-measure[data-measure-id="${CSS.escape(String(measureId))}"]`);
    if (!measure || !existing) {
      this.renderAll();
      return;
    }
    existing.replaceWith(this.createMeasure(measure));
  }

  renderRelations() {
    const systems = buildSystems(this.document);
    this.root?.querySelectorAll('.v3-system').forEach((systemNode, systemIndex) => {
      const measureIds = systems[systemIndex]?.map(measure => measure.id) || [];
      this.relationRenderer.render(this.document, systemNode, measureIds);
    });
  }

  hideCursor() {
    this.cursor?.remove();
    this.cursor = null;
  }

  showCursor({ measureId, string = 0, at = [0, 1], initialValue = '' } = {}) {
    const measure = this.document?.measures?.find(item => item.id === measureId);
    const measureNode = this.root?.querySelector(`.v3-measure[data-measure-id="${CSS.escape(String(measureId))}"]`);
    if (!measure || !measureNode) return null;
    this.hideCursor();

    const input = document.createElement('input');
    input.className = 'v3-note-editor';
    input.type = 'text';
    input.inputMode = 'numeric';
    input.maxLength = 2;
    input.value = initialValue;
    input.dataset.measureId = measureId;
    input.dataset.string = String(string);
    input.dataset.at = fractionKey(at);
    Object.assign(input.style, {
      position: 'absolute',
      left: `${percentageForTime(at, measure)}%`,
      top: `${((Number(string) + 0.5) / this.stringCount) * 100}%`,
      transform: 'translate(-50%, -50%)'
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.hideCursor();
        return;
      }
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this.onCommitNote?.({
        measureId,
        string: Number(string),
        at: cloneValue(at),
        fret: input.value.trim()
      });
      this.hideCursor();
    });
    measureNode.appendChild(input);
    this.cursor = input;
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    return input;
  }
}
