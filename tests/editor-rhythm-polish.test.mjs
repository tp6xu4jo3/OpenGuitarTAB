import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const renderer = await readFile(new URL('../src/editor/renderer.js', import.meta.url), 'utf8');
const notation = await readFile(new URL('../src/editor/notation-renderer.js', import.meta.url), 'utf8');
const songBrowser = await readFile(new URL('../src/catalog/song-browser.js', import.meta.url), 'utf8');
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

assert.match(renderer, /const groupBeamCount = Number\(group\?\.beamCount\)[\s\S]*Number\.isFinite\(groupBeamCount\)[\s\S]*inferredOrdinaryBeamCount/s, 'explicit triplet/subdivision beam counts must override ordinary duration inference');
assert.match(renderer, /function inferredOrdinaryBeamCount\(event, orderedEvents\)[\s\S]*denominator === 1 \? 1 : denominator === 2 \? 0\.5 : 0\.25/s, 'ordinary base-grid notes should infer quarter/eighth/sixteenth notation from their rhythmic position');
assert.match(renderer, /const next = orderedEvents\.find[\s\S]*Math\.min\(impliedDuration,[\s\S]*fractionToNumber\(next\.at\) - atValue/s, 'ordinary inferred note values must shorten when the next onset arrives sooner');
assert.match(renderer, /Math\.abs\(storedDuration - fractionToNumber\(BASE_GRID_STEP\)\) > 1e-9[\s\S]*return rhythmBeamCountForValue\(storedDuration\)/s, 'non-default explicit durations must stay authoritative');
assert.match(renderer, /const fullyBeamed = [\s\S]*groupPoints\.length === slots\.length[\s\S]*v3-rhythm-tuplet-number v3-rhythm-tuplet-number-only/s, 'fully beamed tuplets should show only the centered numeral');
assert.match(editorCss, /\.v3-rhythm-tuplet-number-only\{[^}]*top:32px/s, 'beamed tuplet numerals should sit outside the downward stems and beam');
assert.match(editorCss, /\.v3-rhythm-tuplet-bracket\{[^}]*top:32px/s, 'unbeamed or incomplete tuplets should place their split bracket outside the downward stems and beam');

assert.match(songBrowser, /const firstRect = items\[0\]\.getBoundingClientRect\(\)[\s\S]*const lastRect = items\.at\(-1\)\.getBoundingClientRect\(\)/s, 'rail boundaries should be derived from the visible first and last cards');
assert.match(songBrowser, /prev\.hidden = firstRect\.left >= railRect\.left - edgeTolerance/, 'left arrow should stay hidden while the first card remains fully visible after scroll snapping');
assert.match(songBrowser, /next\.hidden = lastRect\.right <= railRect\.right \+ edgeTolerance/, 'right arrow should hide when the last card is fully visible');
assert.doesNotMatch(songBrowser, /rail\.scrollLeft <= 2/, 'rail arrows must not depend on a fragile raw scrollLeft threshold');

assert.match(renderer, /const navigation = \{ measureId:[\s\S]*requestAnimationFrame\(\(\) => \{\s*const next = this\.navigateCursor\(navigation\)/s, 'arrow navigation should resolve its destination from the live DOM after commit rerenders');

assert.match(notation, /const thirtySecond = group\?\.type === 'subdivision' && group\?\.subdivision === 'thirty-second'/, 'edit mode must expose 32nd-note subdivision groups');
assert.match(notation, /label: triplet \? '3' : '32'/, '32nd-note group marker must not disappear when another technique is present');
assert.match(notation, /const targetNode = relation\.toNoteId[\s\S]*nodes: \[sourceNode, targetNode\]\.filter\(Boolean\)/s, 'relation markers should center over the full relation span');
assert.match(notation, /const centerX = bucket\.reduce[\s\S]*index - \(bucket\.length - 1\) \/ 2/s, 'colliding technique markers should remain centered as a group instead of drifting to one side');

console.log('Editor rhythm polish regression tests passed');