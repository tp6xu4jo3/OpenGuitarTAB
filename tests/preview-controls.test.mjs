import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const viewState = await readFile(new URL('../src/editor/view-state.js', import.meta.url), 'utf8');
const catalog = await readFile(new URL('../src/app-catalog.js', import.meta.url), 'utf8');

assert.match(catalog, /setPreviewActive\(true\)[\s\S]*setScoreViewEnabled\(true\)/s, 'catalog preview must enter score view');
assert.match(viewState, /if \(scoreToggle\) scoreToggle\.hidden = preview;/, 'preview should hide the redundant score-mode toggle');
assert.match(viewState, /if \(densityControl\) densityControl\.hidden = !isScoreViewActive\(\);/, 'compact density control must stay visible in preview score view');
assert.doesNotMatch(viewState, /densityControl\.hidden = preview \|\| !isScoreViewActive\(\)/, 'preview must not hide the compact control');

console.log('preview controls tests passed');
