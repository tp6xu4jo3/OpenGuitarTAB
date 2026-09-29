import { getChordById, getChordVoicing } from './chord-library.js';
import { normalizeFraction } from './model.js';
import { isEditingBlocked } from './view-state.js';

let installed = false;
let pointerDrag = null;

function fractionFromDataset(value) {
  const [numerator, denominator] = String(value || '').split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return normalizeFraction([numerator, denominator]);
}

function targetFromNode(node) {
  const source = node?.closest?.('.v3-column-target[data-measure-id][data-at]');
  const measureId = String(source?.dataset?.measureId || '');
  const at = fractionFromDataset(source?.dataset?.at);
  if (!source || !measureId || !at) return null;
  const duration = fractionFromDataset(source.dataset.duration) || [1, 4];
  return { measureId, at, duration };
}

function payloadFromChordButton(chordButton) {
  const chord = getChordById(chordButton?.dataset?.chordId);
  const voicing = chord ? getChordVoicing(chord.id, chordButton?.dataset?.voicingId) : null;
  return chord && voicing ? { chordId: chord.id, voicingId: voicing.id } : null;
}

function resetChordDrag() {
  pointerDrag?.button?.classList?.remove('is-dragging');
  document.documentElement.classList.remove('chord-drag-active');
  pointerDrag = null;
}

function handlePointerDown(event) {
  if (event.button !== 0 || pointerDrag || isEditingBlocked()) return;
  const chordButton = event.target?.closest?.('#editorRibbon [data-chord-id][data-voicing-id]');
  if (!chordButton) return;
  const payload = payloadFromChordButton(chordButton);
  if (!payload) return;
  pointerDrag = {
    pointerId: event.pointerId,
    button: chordButton,
    payload,
    startX: event.clientX,
    startY: event.clientY,
    active: false
  };
}

function handlePointerMove(event) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  if (isEditingBlocked()) {
    resetChordDrag();
    return;
  }
  if (!pointerDrag.active) {
    const distance = Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY);
    if (distance < 5) return;
    pointerDrag.active = true;
    pointerDrag.button.classList.add('is-dragging');
    document.documentElement.classList.add('chord-drag-active');
  }
  event.preventDefault();
}

function applyChordDrop(payload, target) {
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

function finishPointerDrag(event, cancelled = false) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  const state = pointerDrag;
  const dropElement = state.active && !cancelled && !isEditingBlocked()
    ? document.elementFromPoint(event.clientX, event.clientY) || event.target
    : null;
  const target = dropElement ? targetFromNode(dropElement) : null;
  if (state.active) event.preventDefault();
  resetChordDrag();
  if (target) applyChordDrop(state.payload, target);
}

export function installChordDragController() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (installed) return window.editorChordDrag || null;
  installed = true;
  document.addEventListener('pointerdown', handlePointerDown, true);
  document.addEventListener('pointermove', handlePointerMove, { capture: true, passive: false });
  document.addEventListener('pointerup', event => finishPointerDrag(event), true);
  document.addEventListener('pointercancel', event => finishPointerDrag(event, true), true);
  window.addEventListener('blur', resetChordDrag);
  const api = { cancel: resetChordDrag };
  window.editorChordDrag = api;
  return api;
}
