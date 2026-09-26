import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyCommand } from '../src/editor/commands.js';
import { createDocumentV3 } from '../src/editor/model.js';

const renderer = await readFile(new URL('../src/editor/renderer.js', import.meta.url), 'utf8');
const notation = await readFile(new URL('../src/editor/notation-renderer.js', import.meta.url), 'utf8');
const relations = await readFile(new URL('../src/editor/relation-renderer.js', import.meta.url), 'utf8');
const controller = await readFile(new URL('../src/editor/controller.js', import.meta.url), 'utf8');
const commands = await readFile(new URL('../src/editor/commands.js', import.meta.url), 'utf8');
const playback = await readFile(new URL('../src/editor/playback-controller.js', import.meta.url), 'utf8');
const editorReadme = await readFile(new URL('../src/editor/README.md', import.meta.url), 'utf8');
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

assert.match(renderer, /rebuildNavigationIndex\(\)[\s\S]*editableTimesForMeasure\(measure\)[\s\S]*navigationLookup/s, 'navigation should be indexed from document rhythmic times when grid structure changes');
assert.match(renderer, /navigateCursor\([\s\S]*navigationLookup\.get/s, 'arrow navigation should use the cached rhythmic navigation index');
assert.doesNotMatch(renderer, /navigateCursor\([\s\S]*querySelectorAll\('\.v3-column-target/s, 'arrow navigation must not rescan and sort every DOM column per key press');
assert.match(renderer, /const navigation = \{ measureId:[\s\S]*requestAnimationFrame\(\(\) => \{\s*const next = this\.navigateCursor\(navigation\)/s, 'arrow navigation should resolve its destination after commit rerenders');

assert.doesNotMatch(renderer, /editorPlayback\?\.invalidate|updateProgressRange/, 'renderer completion must not own playback invalidation or playback-index rebuilding');
assert.match(controller, /changeSet\?\.document \|\| changeSet\?\.playback\?\.length[\s\S]*editorPlayback\?\.invalidate/s, 'store ChangeSet playback scope should own playback invalidation');
assert.match(playback, /timelineDirty[\s\S]*navigationPlaybackIndex\(\)[\s\S]*state\.playbackIndex && !state\.timelineDirty/s, 'ordinary content edits should be able to reuse the existing playback timeline for navigation until fresh event data is needed');
assert.match(playback, /function invalidatePlaybackIndex\(\{ timeline = false \} = \{\}\)/s, 'playback invalidation should distinguish content dirtiness from timeline-topology dirtiness');

const ordinaryDocument = createDocumentV3({
  measures: [{
    id: 'm-ordinary',
    timeSignature: { numerator: 4, denominator: 4 },
    groups: [],
    events: [
      { id: 'e-a', at: [0, 1], duration: [1, 4], notes: [{ id: 'n-a', string: 0, fret: '3', techniques: [] }], marks: [] },
      { id: 'e-b', at: [1, 4], duration: [1, 4], notes: [{ id: 'n-b', string: 0, fret: '12', techniques: [] }], marks: [] }
    ]
  }]
});
const ordinaryEdit = applyCommand(ordinaryDocument, { type: 'note/set', measureId: 'm-ordinary', at: [0, 1], string: 0, fret: '5', duration: [1, 4] });
assert.equal(ordinaryEdit.changeSet.layoutFrom, null, 'ordinary fret changes that do not alter spacing complexity must stay local');
assert.deepEqual(ordinaryEdit.changeSet.playback, ['m-ordinary'], 'ordinary fret changes still invalidate playback content');
const complexityEdit = applyCommand(ordinaryDocument, { type: 'note/set', measureId: 'm-ordinary', at: [0, 1], string: 0, fret: '12', duration: [1, 4] });
assert.equal(complexityEdit.changeSet.layoutFrom, 'm-ordinary', 'creating a close pair of multi-digit frets should request metrics layout');
assert.equal(complexityEdit.changeSet.layoutKind, 'metrics');
assert.match(commands, /measureMetricsChanged\([\s\S]*layoutFrom: layoutChanged \? measure\.id : null/s, 'note commands should derive layout invalidation from actual measure complexity');

assert.match(notation, /const full = !changeSet \|\| changeSet\.document;/, 'layoutFrom must not promote notation to a full-document redraw');
assert.match(notation, /const layoutRows = new Set\(\)[\s\S]*dataset\.sourceRow[\s\S]*layoutRows\.has\(sourceRow\)/s, 'layout changes should redraw only visual systems belonging to the affected source system');
assert.match(notation, /const index = indexDocument\(this\.document\)[\s\S]*this\.renderSystem\(systemElement, measureIds, index\)/s, 'notation should build one document index per render pass');
assert.match(relations, /render\(documentModel, systemElement, measureIds, documentIndex = null\)[\s\S]*documentIndex \|\| indexDocument\(documentModel\)/s, 'relation rendering should reuse the notation pass index when provided');
assert.match(notation, /const thirtySecond = group\?\.type === 'subdivision' && group\?\.subdivision === 'thirty-second'/, 'edit mode must expose 32nd-note subdivision groups');
assert.match(notation, /label: triplet \? '3' : '32'/, '32nd-note group marker must not disappear when another technique is present');
assert.match(notation, /const targetNode = relation\.toNoteId[\s\S]*nodes: \[sourceNode, targetNode\]\.filter\(Boolean\)/s, 'relation markers should center over the full relation span');
assert.match(notation, /const centerX = bucket\.reduce[\s\S]*index - \(bucket\.length - 1\) \/ 2/s, 'colliding technique markers should remain centered as a group instead of drifting to one side');

assert.doesNotMatch(controller, /window\.renderRows\s*=/, 'removed Dense Grid renderRows global must not return as a compatibility entry point');
assert.match(editorReadme, /renderer\.js` — the production `SparseScoreRenderer`/, 'architecture documentation must name SparseScoreRenderer as production');
assert.doesNotMatch(editorReadme, /`grid-renderer\.js` — current production|`legacy-grid-compat\.js` — the only production|`input-controller\.js` — note input orchestration/, 'architecture documentation must not describe removed Dense Grid modules as live production modules');

console.log('Editor rhythm polish regression tests passed');