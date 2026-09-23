import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const bootstrap = read('src/bootstrap.js');
const controller = read('src/editor/controller.js');

assert.equal(bootstrap.includes('legacy-ui-bridge'), false, 'bootstrap must not load the removed legacy UI bridge');
assert.equal(bootstrap.includes('app-editor-hotpath'), false, 'bootstrap must not restore editor hotpath patches');
assert.equal(bootstrap.includes('app-editor-drop-guard'), false, 'bootstrap must not restore editor drop guard patches');

for (const moduleName of ['input-controller.js', 'state-sync.js', 'view-state.js']) {
  assert.equal(controller.includes(`./${moduleName}`), true, `controller must compose ${moduleName}`);
}

assert.equal(fs.existsSync(new URL('../src/editor/legacy-ui-bridge.js', import.meta.url)), false, 'legacy UI bridge must stay deleted');

console.log('editor architecture tests passed');
