import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const exists = path => fs.existsSync(new URL(`../${path}`, import.meta.url));

const bootstrap = read('src/bootstrap.js');
const controller = read('src/editor/controller.js');
const gridRenderer = read('src/editor/grid-renderer.js');
const layout = read('src/editor/layout.js');
const stateSync = read('src/editor/state-sync.js');
const structureController = read('src/editor/structure-controller.js');
const viewState = read('src/editor/view-state.js');
const appCatalog = read('src/app-catalog.js');
const editorScroll = read('styles/editor-scroll.css');

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

for (const moduleName of ['input-controller.js', 'state-sync.js', 'view-state.js', 'notation-renderer.js']) {
  assert.equal(controller.includes(`./${moduleName}`), true, `controller must compose ${moduleName}`);
}

for (const moduleName of [
  'src/editor/grid-renderer.js',
  'src/editor/layout.js',
  'src/editor/notation-renderer.js',
  'src/editor/song-actions.js',
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
assert.equal(bootstrap.includes('installGridRenderer'), true, 'bootstrap must install the consolidated grid renderer');
assert.equal(bootstrap.includes('installEditorSongActions'), true, 'bootstrap must install editor song actions');
assert.equal(bootstrap.includes('installSongImport'), true, 'bootstrap must install song import outside editor core');
assert.equal(bootstrap.includes("'./src/app-editor"), false, 'bootstrap must not load classic editor scripts');

console.log('editor architecture tests passed');
