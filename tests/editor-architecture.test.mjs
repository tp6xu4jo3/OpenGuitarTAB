import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const exists = path => fs.existsSync(new URL(`../${path}`, import.meta.url));

const bootstrap = read('src/bootstrap.js');
const controller = read('src/editor/controller.js');
const stateSync = read('src/editor/state-sync.js');

for (const removed of [
  'legacy-ui-bridge',
  'app-editor-hotpath',
  'app-editor-drop-guard',
  'app-editor-core',
  'grid-layout-adapter'
]) {
  assert.equal(bootstrap.includes(removed), false, `bootstrap must not restore ${removed}`);
}

for (const moduleName of ['input-controller.js', 'state-sync.js', 'view-state.js']) {
  assert.equal(controller.includes(`./${moduleName}`), true, `controller must compose ${moduleName}`);
}

for (const moduleName of [
  'src/editor/grid-renderer.js',
  'src/editor/song-actions.js',
  'src/editor/README.md',
  'src/library/song-import.js'
]) {
  assert.equal(exists(moduleName), true, `${moduleName} must remain part of the structured architecture`);
}

for (const removedFile of [
  'src/editor/legacy-ui-bridge.js',
  'src/editor/grid-layout-adapter.js',
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

assert.equal(bootstrap.includes('installGridRenderer'), true, 'bootstrap must install the consolidated grid renderer');
assert.equal(bootstrap.includes('installEditorSongActions'), true, 'bootstrap must install editor song actions');
assert.equal(bootstrap.includes('installSongImport'), true, 'bootstrap must install song import outside editor core');
assert.equal(bootstrap.includes("'./src/app-editor"), false, 'bootstrap must not load classic editor scripts');

console.log('editor architecture tests passed');
