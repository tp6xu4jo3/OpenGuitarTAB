import { getChordById, getChordVoicing } from './chord-library.js';
import { normalizeFraction } from './model.js';
import { isEditingBlocked } from './view-state.js';

export const CHORD_DRAG_MIME = 'application/x-openguitartab-chord';

let installed = false;
let activeDropTarget = null;
let activeDragPayload = null;
let activeDropLookup = null;
let dragFrame = 0;
let pendingDragNode = null;

function clearDropTarget() {
  activeDropTarget?.classList?.remove('is-chord-drop-target');
  activeDropTarget = null;
}

function fractionFromDataset(value) {
  const [numerator, denominator] = String(value || '').split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return normalizeFraction([numerator, denominator]);
}

function targetFromNode(node) {
  const source = node?.closest?.('.v3-column-target[data-measure-id][data-at],.v3-note[data-measure-id][data-at],.v3-note-editor[data-measure-id][data-at]');
  const measureId = String(source?.dataset?.measureId || '');
  const at = fractionFromDataset(source?.dataset?.at);
  if (!source || !measureId || !at) return null;
  const duration = fractionFromDataset(source.dataset.duration) || [1, 4];
  return { measureId, at, duration };
}

function columnKey(measureId, at) {
  return `${String(measureId || '')}:${at?.[0]}/${at?.[1]}`;
}

function captureDropLookup() {
  return new Map([...document.querySelectorAll('.v3-column-target[data-measure-id][data-at]')].map(node => [
    `${node.dataset.measureId}:${node.dataset.at}`,
    node
  ]));
}

function columnNodeForTarget(target) {
  return target ? activeDropLookup?.get(columnKey(target.measureId, target.at)) || null : null;
}

function payloadFromTransfer(dataTransfer) {
  const raw = dataTransfer?.getData?.(CHORD_DRAG_MIME) || '';
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw);
    const chord = getChordById(payload?.chordId);
    const voicing = chord ? getChordVoicing(chord.id, payload?.voicingId) : null;
    if (!chord || !voicing) return null;
    return { chordId: chord.id, voicingId: voicing.id };
  } catch {
    return null;
  }
}

function payloadFromChordButton(chordButton) {
  const chord = getChordById(chordButton?.dataset?.chordId);
  const voicing = chord ? getChordVoicing(chord.id, chordButton?.dataset?.voicingId) : null;
  return chord && voicing ? { chordId: chord.id, voicingId: voicing.id } : null;
}

function handleDragStart(event) {
  const chordButton = event.target?.closest?.('#editorRibbon [data-chord-id][data-voicing-id]');
  if (!chordButton || isEditingBlocked()) return;
  const payload = payloadFromChordButton(chordButton);
  if (!payload || !event.dataTransfer) return;
  activeDragPayload = payload;
  activeDropLookup = captureDropLookup();
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData(CHORD_DRAG_MIME, JSON.stringify(payload));
  chordButton.classList.add('is-dragging');
}

function updateChordDropTarget(node) {
  const target = targetFromNode(node);
  const column = columnNodeForTarget(target);
  if (column === activeDropTarget) return;
  clearDropTarget();
  activeDropTarget = column;
  activeDropTarget?.classList.add('is-chord-drop-target');
}

function scheduleChordDropTarget(node) {
  pendingDragNode = node;
  if (dragFrame) return;
  dragFrame = requestAnimationFrame(() => {
    dragFrame = 0;
    const targetNode = pendingDragNode;
    pendingDragNode = null;
    updateChordDropTarget(targetNode);
  });
}

function clearDragSchedule() {
  if (dragFrame) cancelAnimationFrame(dragFrame);
  dragFrame = 0;
  pendingDragNode = null;
}

function handleDragOver(event) {
  if (isEditingBlocked() || !activeDragPayload) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  scheduleChordDropTarget(event.target);
}

function handleDrop(event) {
  const payload = activeDragPayload || payloadFromTransfer(event.dataTransfer);
  const target = targetFromNode(event.target);
  clearDragSchedule();
  clearDropTarget();
  activeDragPayload = null;
  activeDropLookup = null;
  if (!payload || !target || isEditingBlocked()) return;
  event.preventDefault();
  const result = window.editorV3?.dispatch?.({
    type: 'chord/apply',
    measureId: target.measureId,
    at: target.at,
    duration: target.duration,
    chordId: payload.chordId,
    voicingId: payload.voicingId
  });
  const chord = getChordById(payload.chordId);
  if (result?.changeSet?.measures?.length && chord) window.showToast?.(`已加入 ${chord.symbol}`);
}

function handleDragEnd(event) {
  event.target?.closest?.('[data-chord-id]')?.classList.remove('is-dragging');
  clearDragSchedule();
  activeDragPayload = null;
  activeDropLookup = null;
  clearDropTarget();
}

export function installChordDragController() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (installed) return window.editorChordDrag || null;
  installed = true;
  document.addEventListener('dragstart', handleDragStart);
  document.addEventListener('dragover', handleDragOver);
  document.addEventListener('drop', handleDrop);
  document.addEventListener('dragend', handleDragEnd);
  const api = { mime: CHORD_DRAG_MIME, clearDropTarget };
  window.editorChordDrag = api;
  return api;
}
