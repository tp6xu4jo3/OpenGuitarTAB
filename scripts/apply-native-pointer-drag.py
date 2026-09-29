from pathlib import Path

# Chord drag: remove HTML5 drag/drop entirely. Pointer movement only activates state;
# browser hover owns the green indicator; pointerup owns the single drop mutation.
chord = Path('src/editor/chord-drag-controller.js')
chord.write_text(r'''import { getChordById, getChordVoicing } from './chord-library.js';
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
  const target = state.active && !cancelled && !isEditingBlocked() ? targetFromNode(event.target) : null;
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
''')

# Ribbon buttons are no longer HTML5 draggable; pointer controller is the sole path.
ribbon = Path('src/editor/ribbon.js')
text = ribbon.read_text()
old = '        chordButton.draggable = true;\n'
if old not in text:
    raise SystemExit('ribbon draggable line missing')
ribbon.write_text(text.replace(old, '', 1))

# Structural drag targets: install static native-hover zones once during decoration.
structure = Path('src/editor/structure-controller.js')
text = structure.read_text()
anchor = '''function addMeasureUi(grid, rowIndex) {\n'''
helpers = '''function makeMeasureDropZone(rowIndex, boundary, edge) {\n  const zone = document.createElement('div');\n  zone.className = `measure-drop-zone measure-drop-zone-${edge}`;\n  zone.dataset.row = String(rowIndex);\n  zone.dataset.dropMeasureBoundary = String(boundary);\n  zone.setAttribute('aria-hidden', 'true');\n  return zone;\n}\n\nfunction makeRowDropZone(boundary, edge) {\n  const zone = document.createElement('div');\n  zone.className = `row-drop-zone row-drop-zone-${edge}`;\n  zone.dataset.dropRowBoundary = String(boundary);\n  zone.setAttribute('aria-hidden', 'true');\n  return zone;\n}\n\n'''
if helpers not in text:
    if anchor not in text:
        raise SystemExit('addMeasureUi anchor missing')
    text = text.replace(anchor, helpers + anchor, 1)

old = "    hitbox.style.width = `${Math.max(0, right - left)}%`;\n    hitbox.addEventListener('pointerdown', event => beginPointerDrag(event, { type: 'measure', rowIndex, measureIndex }, hitbox));\n"
new = "    hitbox.style.width = `${Math.max(0, right - left)}%`;\n    hitbox.append(\n      makeMeasureDropZone(rowIndex, measureIndex, 'before'),\n      makeMeasureDropZone(rowIndex, measureIndex + 1, 'after')\n    );\n    hitbox.addEventListener('pointerdown', event => beginPointerDrag(event, { type: 'measure', rowIndex, measureIndex }, hitbox));\n"
if old not in text:
    raise SystemExit('measure hitbox insertion anchor missing')
text = text.replace(old, new, 1)

old = "  zone.dataset.insertIndex = String(index);\n"
new = "  zone.dataset.insertIndex = String(index);\n  zone.dataset.dropRowBoundary = String(index);\n"
if old not in text:
    raise SystemExit('row insert dataset anchor missing')
text = text.replace(old, new, 1)

old = "  system.querySelector('.row-module-handle,.visual-row-handle')?.remove();\n  system.querySelector('.layout-rail-placeholder')?.remove();\n"
new = "  system.querySelector('.row-module-handle,.visual-row-handle')?.remove();\n  system.querySelectorAll('.row-drop-zone').forEach(node => node.remove());\n  system.querySelector('.layout-rail-placeholder')?.remove();\n"
if old not in text:
    raise SystemExit('decorate cleanup anchor missing')
text = text.replace(old, new, 1)

old = "  system.prepend(makeRowHandle(target, { sourceStart }));\n  system.querySelectorAll('.v3-grid').forEach(grid => addMeasureUi(grid, rowIndex));\n"
new = "  system.prepend(makeRowHandle(target, { sourceStart }));\n  system.append(makeRowDropZone(rowIndex, 'before'), makeRowDropZone(rowIndex + 1, 'after'));\n  system.querySelectorAll('.v3-grid').forEach(grid => addMeasureUi(grid, rowIndex));\n"
if old not in text:
    raise SystemExit('decorate row zones anchor missing')
text = text.replace(old, new, 1)

start = text.find('function rowDropTargetFromElement(')
end = text.find('function commitDropAt(')
if start < 0 or end < 0 or end <= start:
    raise SystemExit('drop target function anchors missing')
replacement = '''function rowDropTargetFromElement(element) {\n  const zone = element?.closest?.('[data-drop-row-boundary]');\n  const index = Number(zone?.dataset?.dropRowBoundary);\n  return Number.isInteger(index) ? { index } : null;\n}\n\nfunction measureDropTargetFromElement(element) {\n  const zone = element?.closest?.('.measure-drop-zone[data-row][data-drop-measure-boundary]');\n  const rowIndex = Number(zone?.dataset?.row);\n  const boundary = Number(zone?.dataset?.dropMeasureBoundary);\n  return Number.isInteger(rowIndex) && Number.isInteger(boundary) ? { rowIndex, boundary } : null;\n}\n\n'''
text = text[:start] + replacement + text[end:]
text = text.replace('    const target = rowDropTargetFromElement(element, y);', '    const target = rowDropTargetFromElement(element);', 1)
text = text.replace('    const target = measureDropTargetFromElement(element, x);', '    const target = measureDropTargetFromElement(element);', 1)
structure.write_text(text)

# Native hover indicators for row/measure drop zones.
Path('styles/editor-row-controls.css').write_text('''.row-insert-zone{height:18px!important;min-height:18px!important;position:relative;z-index:40;overflow:visible;display:flex;align-items:center;justify-content:center;pointer-events:auto}\n.row-insert-zone:hover{height:18px!important;min-height:18px!important}\n.row-insert-zone::before{left:50px;right:8px;background:transparent!important}\n.row-insert-controls{position:absolute;left:50%;top:50%;z-index:41;display:flex;align-items:center;justify-content:center;gap:6px;transform:translate(-50%,-50%) scale(.92);opacity:0;pointer-events:none;transition:opacity .14s ease,transform .14s ease}\n.row-insert-zone:hover .row-insert-controls,.row-insert-zone:focus-within .row-insert-controls{opacity:1;pointer-events:auto;transform:translate(-50%,-50%) scale(1)}\n.row-boundary-button{box-sizing:border-box;width:32px;height:32px;min-width:32px;min-height:32px;display:grid;place-items:center;padding:0;border:0;border-radius:50%;background:#1ed760;color:#000;cursor:pointer;pointer-events:auto;box-shadow:0 6px 14px rgba(30,215,96,.20);transition:background .14s ease,transform .14s ease}\n.row-boundary-button:hover,.row-boundary-button:focus-visible{background:#3be477;transform:scale(1.05);outline:none}\n.row-boundary-button svg{width:18px;height:18px;display:block;overflow:visible;fill:none;stroke:currentColor;stroke-width:2.35;stroke-linecap:round;stroke-linejoin:round}\n.row-drop-zone{position:absolute;left:0;right:0;height:50%;z-index:60;pointer-events:none}\n.row-drop-zone-before{top:0}\n.row-drop-zone-after{bottom:0}\n.structure-drag-row-active .row-drop-zone{pointer-events:auto}\n.row-drop-zone::after{content:'';position:absolute;left:50px;right:8px;height:3px;border-radius:2px;background:#1ed760;opacity:0;pointer-events:none}\n.row-drop-zone-before::after{top:0;transform:translateY(-50%)}\n.row-drop-zone-after::after{bottom:0;transform:translateY(50%)}\n.structure-drag-row-active .row-drop-zone:hover::after{opacity:1}\n.structure-drag-row-active .row-insert-zone:hover::after{content:'';position:absolute;left:50px;right:8px;top:50%;height:3px;border-radius:2px;background:#1ed760;transform:translateY(-50%);pointer-events:none}\n@media(max-width:900px){.row-insert-zone::before,.row-drop-zone::after,.structure-drag-row-active .row-insert-zone:hover::after{left:50px}}\n''')

modules = Path('styles/editor-modules.css')
text = modules.read_text()
old = '.structure-drag-measure-active .v3-column-target,.structure-drag-measure-active .v3-note,.structure-drag-measure-active .v3-note-editor,.structure-drag-measure-active .technique-marker{pointer-events:none!important}\n'
new = '''.structure-drag-measure-active .measure-module-hitbox{z-index:20}\n.measure-drop-zone{position:absolute;top:0;bottom:0;width:50%;z-index:1;pointer-events:none}\n.measure-drop-zone-before{left:0}\n.measure-drop-zone-after{right:0}\n.structure-drag-measure-active .measure-drop-zone{pointer-events:auto}\n.measure-drop-zone::after{content:'';position:absolute;top:0;bottom:0;width:3px;border-radius:2px;background:#1ed760;opacity:0;pointer-events:none}\n.measure-drop-zone-before::after{left:0;transform:translateX(-50%)}\n.measure-drop-zone-after::after{right:0;transform:translateX(50%)}\n.structure-drag-measure-active .measure-drop-zone:hover::after{opacity:1}\n'''
if old not in text:
    raise SystemExit('measure drag css anchor missing')
modules.write_text(text.replace(old, new, 1))

# Chord indicator is pure :hover while one root state is active; no per-column JS state.
v3 = Path('styles/editor-v3.css')
text = v3.read_text()
old = '.v3-column-target.is-chord-drop-target::after{width:2px;background:#1ed760}\n'
new = '''.chord-drag-active .v3-column-target{cursor:copy}\n.chord-drag-active .v3-note,.chord-drag-active .v3-note-editor,.chord-drag-active .technique-marker{pointer-events:none!important}\n.chord-drag-active .v3-column-target:hover::after{width:3px;background:#1ed760}\n'''
if old not in text:
    raise SystemExit('old chord indicator css missing')
v3.write_text(text.replace(old, new, 1))

# Regression tests lock the single pointer architecture and native hover indicators.
cleanup = Path('tests/editor-structure-cleanup.test.mjs')
test = cleanup.read_text()
test = test.replace(
    "const rowControlsCss=await readFile(new URL('../styles/editor-row-controls.css',import.meta.url),'utf8');\n",
    "const rowControlsCss=await readFile(new URL('../styles/editor-row-controls.css',import.meta.url),'utf8');\nconst editorV3Css=await readFile(new URL('../styles/editor-v3.css',import.meta.url),'utf8');\n"
)
old = '''assert.match(rowControlsCss,/structure-drag-row-active \\.row-insert-zone:hover::after/,'row drag feedback should use native CSS hover only');\nassert.match(chordDragSource,/activeDropLookup = captureDropLookup\\(\\)/,'chord dragging should cache column targets once at drag start');\nconst chordDragOver=chordDragSource.slice(chordDragSource.indexOf('function handleDragOver('),chordDragSource.indexOf('function handleDrop('));\nassert.doesNotMatch(chordDragOver,/document\\.querySelector/,'chord dragover must not perform global document lookups');\nassert.match(chordDragOver,/updateChordDropTarget\\(event\\.target\\)/,'chord hover feedback should follow the current native drag target immediately');\nassert.doesNotMatch(chordDragSource,/scheduleChordDropTarget|pendingDragNode|dragFrame/,'chord dragging should not queue hover feedback behind requestAnimationFrame');\nassert.match(chordDragSource,/function handleDrop\\(event\\)[\\s\\S]*payloadFromTransfer\\(event\\.dataTransfer\\)/s,'the chord payload should be read only when the user drops');\n'''
new = '''assert.match(rowControlsCss,/structure-drag-row-active \\.row-drop-zone:hover::after/,'row drag feedback must follow native hover over full-row drop zones');\nassert.match(structureSource,/dataset\\.dropRowBoundary[\\s\\S]*dataset\\.dropMeasureBoundary/s,'structure decoration must install explicit row and measure drop boundaries');\nassert.doesNotMatch(dropResolution,/getBoundingClientRect|querySelector|elementsFromPoint/,'final structure drop resolution must read only the hovered drop-zone dataset');\nconst chordPointerMove=chordDragSource.slice(chordDragSource.indexOf('function handlePointerMove('),chordDragSource.indexOf('function applyChordDrop('));\nassert.doesNotMatch(chordPointerMove,/querySelector|elementFromPoint|elementsFromPoint|getBoundingClientRect|classList\\.remove/,'chord pointermove must only cross the drag threshold and activate native hover');\nassert.match(chordPointerMove,/Math\\.hypot[\\s\\S]*classList\\.add\\('chord-drag-active'\\)/s,'chord dragging must activate one root hover state after the movement threshold');\nassert.match(chordDragSource,/function finishPointerDrag\\(event[\\s\\S]*targetFromNode\\(event\\.target\\)[\\s\\S]*applyChordDrop/s,'chord target resolution and mutation must happen only on pointerup');\nassert.doesNotMatch(chordDragSource,/dragstart|dragover|dragend|dataTransfer|CHORD_DRAG_MIME|activeDropLookup|activeDropTarget|captureDropLookup|is-chord-drop-target/,'legacy HTML5 chord drag state must be deleted');\nassert.match(editorV3Css,/\\.chord-drag-active \\.v3-column-target:hover::after\\{[^}]*width:3px[^}]*background:#1ed760/s,'chord green indicator must be driven directly by native hover');\n'''
if old not in test:
    raise SystemExit('old chord cleanup test block missing')
cleanup.write_text(test.replace(old, new, 1))

ribbon_test = Path('tests/editor-ribbon.test.mjs')
test = ribbon_test.read_text()
old = "assert.match(ribbon,/draggable = true/,'clickable chords must remain draggable too');\n"
new = "assert.doesNotMatch(ribbon,/draggable\\s*=\\s*true/,'chord buttons must not revive the throttled HTML5 drag path');\n"
if old not in test:
    raise SystemExit('ribbon draggable test missing')
ribbon_test.write_text(test.replace(old, new, 1))

grid_test = Path('tests/editor-grid-structure-regression.test.mjs')
test = grid_test.read_text()
old = "assert.match(chordDragSource,/let draggingChord = false/,'chord drag hover should track only whether a chord drag is active');\nassert.doesNotMatch(chordDragSource,/let activeDragPayload = null/,'chord payload data should not be retained for hover targeting');\n"
new = "assert.match(chordDragSource,/let pointerDrag = null/,'chord drag must use one pointer-event state object');\nassert.doesNotMatch(chordDragSource,/draggingChord|activeDragPayload|activeDropLookup/,'legacy chord drag state must not coexist with pointer dragging');\n"
if old not in test:
    raise SystemExit('grid chord drag assertions missing')
grid_test.write_text(test.replace(old, new, 1))

# Architecture scan: the editor must have one drag mechanism for chords and one pointer mechanism for structure.
all_editor = '\n'.join(path.read_text() for path in Path('src/editor').glob('*.js'))
if "addEventListener('dragover'" in all_editor or "addEventListener('dragstart'" in all_editor:
    raise SystemExit('legacy native drag event listener remains in src/editor')
if 'is-chord-drop-target' in all_editor:
    raise SystemExit('legacy chord target class remains in src/editor')
