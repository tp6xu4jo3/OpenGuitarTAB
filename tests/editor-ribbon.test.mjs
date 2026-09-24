import assert from 'node:assert/strict';
import { CHORD_CATEGORY_SHELLS, nextRibbonSection, RIBBON_SECTIONS } from '../src/editor/ribbon.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

assert.equal(nextRibbonSection(null, RIBBON_SECTIONS.TECHNIQUE), RIBBON_SECTIONS.TECHNIQUE);
assert.equal(nextRibbonSection(RIBBON_SECTIONS.TECHNIQUE, RIBBON_SECTIONS.TECHNIQUE), null, 'clicking the active ribbon section must collapse it');
assert.equal(nextRibbonSection(RIBBON_SECTIONS.TECHNIQUE, RIBBON_SECTIONS.CHORD), RIBBON_SECTIONS.CHORD, 'clicking another section must switch directly');
assert.equal(nextRibbonSection(RIBBON_SECTIONS.CHORD, RIBBON_SECTIONS.TECHNIQUE), RIBBON_SECTIONS.TECHNIQUE);
assert.equal(nextRibbonSection(null, 'unknown'), null);
assert.deepEqual(CHORD_CATEGORY_SHELLS.map(item => item.id), ['major', 'minor', 'dominant', 'suspended', 'other']);

const root = new URL('..', import.meta.url).pathname;
const controller = readFileSync(join(root, 'src/editor/controller.js'), 'utf8');
const styles = readFileSync(join(root, 'styles/editor-tools.css'), 'utf8');

assert.match(controller, /new EditorRibbon/);
assert.match(controller, /RIBBON_SECTIONS\.TECHNIQUE/);
assert.doesNotMatch(controller, /editor-toolbox|toolboxCollapsed|setToolboxCollapsed|ensureToolPalette|syncToolPalette/);
assert.match(styles, /\.editor-ribbon-tab/);
assert.match(styles, /\.editor-ribbon-panel/);
assert.doesNotMatch(styles, /\.editor-toolbox|\.note-input/);

console.log('editor ribbon tests passed');
