import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const exists = path => fs.existsSync(new URL(`../${path}`, import.meta.url));

const bootstrap = read('src/bootstrap.js');
const controller = read('src/editor/controller.js');
const gridRenderer = read('src/editor/grid-renderer.js');
const gridGeometry = read('src/editor/grid-geometry.js');
const gridNavigation = read('src/editor/grid-navigation.js');
const inputController = read('src/editor/input-controller.js');
const legacyGridCompat = read('src/editor/legacy-grid-compat.js');
const layout = read('src/editor/layout.js');
const notationRenderer = read('src/editor/notation-renderer.js');
const playbackController = read('src/editor/playback-controller.js');
const rhythmGrid = read('src/editor/rhythm-grid.js');
const stateSync = read('src/editor/state-sync.js');
const techniqueRules = read('src/editor/technique-rules.js');
const structureController = read('src/editor/structure-controller.js');
const toolSession = read('src/editor/tool-session.js');
const tools = read('src/editor/tools.js');
const viewState = read('src/editor/view-state.js');
const appCatalog = read('src/app-catalog.js');
const editorScroll = read('styles/editor-scroll.css');
const editorTools = read('styles/editor-tools.css');

for (const removed of [
  'legacy-ui-bridge',
  'app-editor-hotpath',
  'app-editor-drop-guard',
  'app-editor-core',
  'grid-layout-adapter',
  'responsive-score-layout'
]) {
  assert.equal(bootstrap.includes(removed), false, `bootstrap must not restore ${removed}`);
}

for (const moduleName of ['input-controller.js', 'state-sync.js', 'tool-session.js', 'view-state.js', 'notation-renderer.js']) {
  assert.equal(controller.includes(`./${moduleName}`), true, `controller must compose ${moduleName}`);
}

for (const moduleName of [
  'src/editor/grid-renderer.js',
  'src/editor/grid-geometry.js',
  'src/editor/grid-navigation.js',
  'src/editor/legacy-grid-compat.js',
  'src/editor/layout.js',
  'src/editor/notation-renderer.js',
  'src/editor/rhythm-grid.js',
  'src/editor/song-actions.js',
  'src/editor/tool-session.js',
  'src/editor/README.md',
  'src/library/song-import.js'
]) {
  assert.equal(exists(moduleName), true, `${moduleName} must remain part of the structured architecture`);
}

for (const removedFile of [
  'src/editor/legacy-ui-bridge.js',
  'src/editor/grid-layout-adapter.js',
  'src/editor/responsive-score-layout.js',
  'src/app-editor-core.js'
]) {
  assert.equal(exists(removedFile), false, `${removedFile} must stay deleted`);
}

for (const forbiddenOverride of [
  'window.readRowsFromDom =',
  'window.saveRowsToCurrentSong =',
  'window.persistSongToCloud ='
]) {
  assert.equal(stateSync.includes(forbiddenOverride), false, `state-sync must not restore ${forbiddenOverride}`);
}

assert.equal(structureController.includes('window.renderRows ='), false, 'structure controller must react to render events instead of overriding renderRows');
assert.equal(gridRenderer.includes('score-grid-pair'), false, 'edit and score modes must not use separate row geometry');
assert.equal(gridRenderer.includes('buildAdaptiveLayout'), true, 'grid renderer must consume the shared adaptive layout engine');
assert.equal(layout.includes('measureComplexity'), true, 'layout must account for notation complexity');
assert.equal(layout.includes('measureWidths'), true, 'layout must allocate per-measure widths');
assert.equal(playbackController.includes('measureWidthsForGrid'), true, 'playback playhead must honor adaptive measure widths');

const previewStart = appCatalog.indexOf('async function openCatalogPreview');
const localStart = appCatalog.indexOf('function openLocalEditor');
const routeStart = appCatalog.indexOf('function handleRoute');
const previewEditor = appCatalog.slice(previewStart, localStart);
const localEditor = appCatalog.slice(localStart, routeStart);
assert.ok(previewEditor.indexOf("showPage('editor')") < previewEditor.indexOf('renderRows(previewSong.rows)'), 'preview must be visible before score layout renders');
assert.ok(localEditor.indexOf("showPage('editor')") < localEditor.indexOf('loadSong(id)'), 'editor must be visible before song layout renders');
assert.ok(editorScroll.includes('*::-webkit-scrollbar-button'), 'all WebKit scrollbars must suppress arrow buttons');

assert.equal(controller.includes('stopImmediatePropagation'), false, 'controller must not intercept older editor handlers');
assert.equal(viewState.includes('stopImmediatePropagation'), false, 'view-state must not intercept older editor handlers');
assert.equal(playbackController.includes('stopImmediatePropagation'), false, 'playback controller must not intercept unrelated handlers');
assert.equal(controller.includes("addEventListener('dragstart'"), false, 'tool controller must not restore dragstart');
assert.equal(controller.includes("addEventListener('dragover'"), false, 'tool controller must not restore dragover');
assert.equal(controller.includes("addEventListener('drop'"), false, 'tool controller must not restore tool drop');
assert.equal(controller.includes('draggable = true'), false, 'tool buttons must be click-only');
assert.equal(tools.includes('EDITOR_TOOL_MIME'), false, 'tool registry must not keep drag payload MIME state');
assert.equal(tools.includes('writeToolDragData'), false, 'tool registry must not keep drag writers');
assert.equal(tools.includes('readToolDragData'), false, 'tool registry must not keep drag readers');
for (const targetKind of ['NoteTarget', 'ColumnTarget', 'NotePairTarget', 'RangeTarget']) {
  assert.equal(toolSession.includes(targetKind), true, `ToolSession must support ${targetKind}`);
}
assert.equal(controller.includes("event.key !== 'Escape'"), true, 'Escape must cancel the active tool');
assert.equal(controller.includes('ArrowLeft'), false, 'tool controller must leave arrow navigation to input-controller');
assert.equal(controller.includes('ArrowRight'), false, 'tool controller must leave arrow navigation to input-controller');
assert.equal(editorTools.includes('position: sticky'), true, 'tool palette must stay visible while the score scrolls');
assert.equal(editorTools.includes('.editor-toolbox.is-collapsed'), true, 'tool palette must support collapse mode');
assert.equal(editorTools.includes('cursor: grab'), false, 'tool palette must not advertise drag interaction');
assert.equal(controller.includes("resolveTechniqueTarget"), true, 'controller must validate music rules before dispatching a technique command');
assert.equal(controller.includes("data-delete-technique"), true, 'controller must expose marker deletion through the context menu');
assert.equal(controller.includes("event.key === 'Delete'"), true, 'selected technique markers must support Delete');
assert.equal(controller.includes("event.key === 'Backspace'"), true, 'selected technique markers must support Backspace');
assert.equal(notationRenderer.includes('technique-marker-layer'), true, 'notation renderer must place stable deletion markers below the staff');
assert.equal(notationRenderer.includes('notation-harmonic-label'), true, 'artificial harmonic notation must render its fret label');
assert.equal(notationRenderer.includes('notation-arpeggio'), true, 'arpeggio must use a dedicated notation symbol');
assert.equal(editorTools.includes('.notation-relation-preview'), true, 'pair preview must stay in the noninteractive notation layer');
assert.equal(editorTools.includes('pointer-events: none'), true, 'notation relations must not block score inputs');
assert.equal(techniqueRules.includes("same string"), false, 'music-rule messages stay localized rather than leaking implementation comments');
assert.equal(notationRenderer.includes('delete input.dataset.measureId'), false, 'notation sync must preserve measure/time metadata for empty column and range targets');
assert.equal(tools.includes("'rhythm/triplet/apply'"), true, 'triplet tool must dispatch a regional rhythm transform');
assert.equal(tools.includes("'rhythm/32nd/apply'"), true, '32nd tool must dispatch a regional rhythm transform');
assert.equal(gridRenderer.includes('fractionalGridTimes'), true, 'grid renderer must render fractional rhythm positions from V3 data');
assert.equal(gridRenderer.includes('data-v3-only'), false, 'grid renderer should set V3-only state through dataset APIs, not HTML patches');
assert.equal(rhythmGrid.includes('ratio: [3, 2]'), true, 'triplet transform must retain explicit 3:2 semantics');
assert.equal(rhythmGrid.includes('rhythmAnchor: true'), true, 'empty 32nd positions must persist as rhythm anchors');
assert.equal(gridRenderer.includes('function handleKeydown'), false, 'grid renderer must not own keyboard navigation');
assert.equal(inputController.includes('window.handleKeydown'), false, 'input controller must call navigation module directly');
assert.equal(inputController.includes('window.rhythmRowFromRow'), false, 'input controller must call compatibility helpers directly');
assert.equal(gridNavigation.includes("event.key === 'Enter'"), true, 'Enter behavior must be explicit');
assert.equal(gridNavigation.includes('stringDelta: 1'), true, 'Down arrow must remain string navigation');
assert.equal(gridNavigation.includes("event.key === 'Enter'") && gridNavigation.includes("stringDelta: 1, timeDelta"), false, 'Enter must not be implemented as arrow navigation');
assert.equal(gridGeometry.includes('measureWidthsForGrid'), true, 'grid geometry must have one shared width parser');
assert.equal(playbackController.includes('function measureWidthsForGrid'), false, 'playback must reuse shared grid geometry');
assert.equal(structureController.includes('function measureWidths('), false, 'structure UI must reuse shared grid geometry');
assert.equal(legacyGridCompat.includes('projectDocumentToLegacySong'), true, 'legacy projection must live behind an explicit compatibility boundary');
assert.equal(stateSync.includes('documentToLegacyProjection'), false, 'state sync must not duplicate legacy projection logic');

assert.equal(bootstrap.includes('installGridRenderer'), true, 'bootstrap must install the consolidated grid renderer');
assert.equal(bootstrap.includes('installEditorSongActions'), true, 'bootstrap must install editor song actions');
assert.equal(bootstrap.includes('installSongImport'), true, 'bootstrap must install song import outside editor core');
assert.equal(bootstrap.includes("'./src/app-editor"), false, 'bootstrap must not load classic editor scripts');

console.log('editor architecture tests passed');
