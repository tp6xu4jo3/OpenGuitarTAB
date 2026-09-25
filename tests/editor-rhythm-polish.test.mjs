import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const renderer = await readFile(new URL('../src/editor/renderer.js', import.meta.url), 'utf8');
const notation = await readFile(new URL('../src/editor/notation-renderer.js', import.meta.url), 'utf8');
const editorCss = await readFile(new URL('../styles/editor-v3.css', import.meta.url), 'utf8');
const responsiveCss = await readFile(new URL('../styles/responsive.css', import.meta.url), 'utf8');
const sidebarCss = await readFile(new URL('../styles/sidebar.css', import.meta.url), 'utf8');

assert.match(sidebarCss, /\.brand-row\s*\{[^}]*justify-content:center/s, 'brand block should be horizontally centered in the sidebar');
assert.match(sidebarCss, /\.brand-mark\s*\{[^}]*width:46px[^}]*height:42px[^}]*overflow:hidden/s, 'sidebar icon should be enlarged while cropping the damaged bottom edge');
assert.match(sidebarCss, /\.brand-mark img\s*\{[^}]*width:46px[^}]*height:46px/s, 'brand image should render larger than its cropped viewport');

assert.match(responsiveCss, /@media \(min-width:761px\) and \(max-width:980px\)[\s\S]*\.play-panel\{display:grid;grid-template-columns:auto auto auto minmax\(180px,1fr\) auto/s, 'tablet playback controls should stay on one ordered row');
assert.match(responsiveCss, /\.play-panel \.mode-toggle-button\{position:static;grid-column:auto/s, 'score mode toggle must remain directly before capo instead of being absolutely wrapped away');

assert.match(renderer, /function halfFraction\(value\)[\s\S]*denominator \* 2/s, 'editable anchors should be centered within their rhythmic slot');
assert.match(renderer, /const occupiedStrings = new Set\([\s\S]*v3-slot-dot/s, 'renderer should create individual empty-slot dots and omit occupied strings');
assert.match(editorCss, /\.v3-slot-dot\{[^}]*left:var\(--v3-anchor-x,50%\)[^}]*border-radius:50%/s, 'empty cells should use real centered dot elements');
assert.doesNotMatch(editorCss, /radial-gradient/, 'slot dots should not be painted as an all-or-nothing background gradient');
assert.match(editorCss, /\.content\.score-view \.v3-slot-dot\{display:none\}/, 'edit affordance dots must remain hidden in score view');

assert.match(renderer, /const groupBeamCount = Number\(group\?\.beamCount\)[\s\S]*Number\.isFinite\(groupBeamCount\)[\s\S]*rhythmBeamCount/s, 'explicit triplet/subdivision beam counts must override duration inference');
assert.match(renderer, /const fullyBeamed = [\s\S]*groupPoints\.length === slots\.length[\s\S]*v3-rhythm-tuplet-number v3-rhythm-tuplet-number-only/s, 'fully beamed tuplets should show only the centered numeral');
assert.match(editorCss, /\.v3-rhythm-tuplet-number-only\{[^}]*top:-18px/s, 'tuplet numeral must sit above stems instead of overlapping the center stem');
assert.match(editorCss, /\.v3-rhythm-tuplet-bracket\{[^}]*top:-18px/s, 'unbeamed/incomplete tuplets should keep a raised split bracket');

assert.match(renderer, /const navigation = \{ measureId:[\s\S]*requestAnimationFrame\(\(\) => \{\s*const next = this\.navigateCursor\(navigation\)/s, 'arrow navigation should resolve its destination from the live DOM after commit rerenders');

assert.match(notation, /const thirtySecond = group\?\.type === 'subdivision' && group\?\.subdivision === 'thirty-second'/, 'edit mode must expose 32nd-note subdivision groups');
assert.match(notation, /label: triplet \? '3' : '32'/, '32nd-note group marker must not disappear when another technique is present');
assert.match(notation, /const targetNode = relation\.toNoteId[\s\S]*nodes: \[sourceNode, targetNode\]\.filter\(Boolean\)/s, 'relation markers should center over the full relation span');
assert.match(notation, /const centerX = bucket\.reduce[\s\S]*index - \(bucket\.length - 1\) \/ 2/s, 'colliding technique markers should remain centered as a group instead of drifting to one side');

console.log('Editor rhythm polish regression tests passed');
