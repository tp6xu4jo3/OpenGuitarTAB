import { getChordById, getChordVoicing } from './chord-library.js';
import { normalizeFraction } from './model.js';
import { isPreviewActive, isScoreViewActive } from './view-state.js';

export const CHORD_DRAG_MIME = 'application/x-openguitartab-chord';

let installed = false;
let activeDropTarget = null;

function editingBlocked() {
  return isPreviewActive() || isScoreViewActive();
}

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

function columnNodeForTarget(target) {
  if (!target) return null;
  const measureId = globalThis.CSS?.escape ? CSS.escape(target.measureId) : target.measureId;
  const atKey = `${target.at[0]}/${target.at[1]}`;
  const at = globalThis.CSS?.escape ? CSS.escape(atKey) : atKey;
  return document.querySelector(`.v3-column-target[data-measure-id="${measureId}"][data-at="${at}"]`);
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

function handleDragStart(event) {
  const chordButton = event.target?.closest?.('#editorRibbon [data-chord-id][data-voicing-id]');
  if (!chordButton || editingBlocked()) return;
  const chord = getChordById(chordButton.dataset.chordId);
  const voicing = chord ? getChordVoicing(chord.id, chordButton.dataset.voicingId) : null;
  if (!chord || !voicing || !event.dataTransfer) return;
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData(CHORD_DRAG_MIME, JSON.stringify({ chordId: chord.id, voicingId: voicing.id }));
  chordButton.classList.add('is-dragging');
}

function handleDragOver(event) {
  if (editingBlocked() || !payloadFromTransfer(event.dataTransfer)) return;
  const target = targetFromNode(event.target);
  if (!target) {
    clearDropTarget();
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  const column = columnNodeForTarget(target);
  if (column !== activeDropTarget) {
    clearDropTarget();
    activeDropTarget = column;
    activeDropTarget?.classList.add('is-chord-drop-target');
  }
}

function handleDrop(event) {
  const payload = payloadFromTransfer(event.dataTransfer);
  const target = targetFromNode(event.target);
  clearDropTarget();
  if (!payload || !target || editingBlocked()) return;
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
