import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

const renderer = await readFile(new URL('../src/editor/renderer.js', import.meta.url), 'utf8');
const songBrowser = await readFile(new URL('../src/catalog/song-browser.js', import.meta.url), 'utf8');
const editorCss = await readFile(new URL('../styles/editor-v3.css', import.meta.url), 'utf8');
const responsiveCss = await readFile(new URL('../styles/responsive.css', import.meta.url), 'utf8');
const sidebarCss = await readFile(new URL('../styles/sidebar.css', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const brandIcon = await readFile(new URL('../assets/OpenGuitarTABicon.ico', import.meta.url));

assert.match(indexHtml, /class="brand-copy"/, 'brand copy needs its own alignment box');
assert.match(sidebarCss, /\.brand-row\s*\{[^}]*justify-content:flex-start[^}]*gap:8px/s, 'brand copy should sit closer to the icon instead of being pushed to the far edge');
assert.match(sidebarCss, /\.brand-mark\s*\{[^}]*width:54px[^}]*height:54px/s, 'sidebar icon should use the repaired square asset without a CSS crop');
assert.match(sidebarCss, /\.brand-mark img\s*\{[^}]*width:54px[^}]*height:54px[^}]*object-position:center/s, 'brand image should render the full repaired square asset');
assert.match(sidebarCss, /\.brand-copy\s*\{[^}]*margin-left:0/s, 'brand text should move left toward the icon');
assert.match(sidebarCss, /\.brand-name\s*\{[^}]*font-size:\s*20px/s, 'brand title should scale with the enlarged icon');

assert.equal(brandIcon.readUInt16LE(0), 0, 'ICO reserved field should be zero');
assert.equal(brandIcon.readUInt16LE(2), 1, 'brand asset should remain an ICO file');
assert.equal(brandIcon.readUInt16LE(4), 1, 'brand ICO should contain one 64px image');
const iconWidth = brandIcon[6] || 256;
const iconHeight = brandIcon[7] || 256;
const iconByteLength = brandIcon.readUInt32LE(14);
const iconOffset = brandIcon.readUInt32LE(18);
assert.equal(iconWidth, 64, 'brand icon width should remain 64px');
assert.equal(iconHeight, 64, 'brand icon height should remain 64px');
const embeddedPng = brandIcon.subarray(iconOffset, iconOffset + iconByteLength);
assert.deepEqual([...embeddedPng.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'ICO image should be an embedded PNG');
const idat = [];
let pngOffset = 8;
while (pngOffset + 12 <= embeddedPng.length) {
  const chunkLength = embeddedPng.readUInt32BE(pngOffset);
  const chunkType = embeddedPng.toString('ascii', pngOffset + 4, pngOffset + 8);
  const dataStart = pngOffset + 8;
  const dataEnd = dataStart + chunkLength;
  assert.ok(dataEnd + 4 <= embeddedPng.length, `PNG chunk ${chunkType} should fit inside the icon payload`);
  if (chunkType === 'IDAT') idat.push(embeddedPng.subarray(dataStart, dataEnd));
  pngOffset = dataEnd + 4;
  if (chunkType === 'IEND') break;
}
const scanlines = inflateSync(Buffer.concat(idat));
assert.equal(scanlines.length, 64 * (1 + 64 * 4), 'brand PNG should decode into 64 complete RGBA scanlines');
for (let row = 0; row < 64; row += 1) {
  assert.ok(scanlines[row * 257] <= 4, `brand PNG row ${row} should start with a valid PNG filter byte`);
}

assert.match(responsiveCss, /@media \(min-width:761px\) and \(max-width:980px\)[\s\S]*\.play-panel\{display:grid;grid-template-columns:auto auto auto minmax\(180px,1fr\) auto/s, 'tablet playback controls should stay on one ordered row');
assert.match(responsiveCss, /\.play-panel \.mode-toggle-button\{position:static;grid-column:auto/s, 'score mode toggle must remain directly before capo instead of being absolutely wrapped away');

assert.match(renderer, /function halfFraction\(value\)[\s\S]*denominator \* 2/s, 'editable anchors should be centered within their rhythmic slot');
assert.match(renderer, /const occupiedStrings = new Set\([\s\S]*v3-slot-dot/s, 'renderer should create individual empty-slot dots and omit occupied strings');
assert.match(editorCss, /\.v3-slot-dot\{[^}]*left:var\(--v3-anchor-x,50%\)[^}]*border-radius:50%/s, 'empty cells should use real centered dot elements');
assert.doesNotMatch(editorCss, /radial-gradient/, 'slot dots should not be painted as an all-or-nothing background gradient');
assert.match(editorCss, /\.content\.score-view \.v3-slot-dot\{display:none\}/, 'edit affordance dots must remain hidden in score view');

assert.match(renderer, /const groupBeamCount = Number\(group\?\.beamCount\)[\s\S]*beams: Number\.isFinite\(groupBeamCount\)[\s\S]*rhythmBeamCountForValue\(durationValue\)/s, 'explicit triplet/subdivision beam counts must override ordinary duration inference');
assert.match(renderer, /function inferredOrdinaryDurationValue\(event, orderedEvents\)[\s\S]*denominator === 1 \? 1 : denominator === 2 \? 0\.5 : 0\.25/s, 'ordinary base-grid notes should infer quarter/eighth/sixteenth notation from their rhythmic position');
assert.match(renderer, /const next = orderedEvents\.find[\s\S]*Math\.min\(impliedDuration,[\s\S]*fractionToNumber\(next\.at\) - atValue/s, 'ordinary inferred note values must shorten when the next onset arrives sooner');
assert.match(renderer, /Math\.abs\(storedDuration - fractionToNumber\(BASE_GRID_STEP\)\) > 1e-9\) return storedDuration/s, 'non-default explicit durations must stay authoritative');
assert.match(renderer, /function rhythmDotCountForValue[\s\S]*base \* 1\.5[\s\S]*v3-rhythm-dot/s, 'dotted binary note values should render an augmentation dot');
assert.match(editorCss, /--v3-rhythm-stroke:2px;--v3-rhythm-beam-thickness:5px/, 'beams should be visually heavier than stems');
assert.match(editorCss, /\.v3-rhythm-flag\{width:10px;transform:none\}/, 'secondary beamlets should remain horizontal rather than looking like detached diagonal tails');
assert.match(renderer, /const fullyBeamed = [\s\S]*groupPoints\.length === slots\.length[\s\S]*v3-rhythm-tuplet-number v3-rhythm-tuplet-number-only/s, 'fully beamed tuplets should show only the centered numeral');
assert.match(editorCss, /\.v3-rhythm-tuplet-number-only\{[^}]*top:32px/s, 'beamed tuplet numerals should sit outside the downward stems and beam');
assert.match(editorCss, /\.v3-rhythm-tuplet-bracket\{[^}]*top:32px/s, 'unbeamed or incomplete tuplets should place their split bracket outside the downward stems and beam');

assert.match(songBrowser, /const firstRect = items\[0\]\.getBoundingClientRect\(\)[\s\S]*const lastRect = items\.at\(-1\)\.getBoundingClientRect\(\)/s, 'rail boundaries should be derived from the visible first and last cards');
assert.match(songBrowser, /prev\.hidden = firstRect\.left >= railRect\.left - edgeTolerance/, 'left arrow should stay hidden while the first card remains fully visible after scroll snapping');
assert.match(songBrowser, /next\.hidden = lastRect\.right <= railRect\.right \+ edgeTolerance/, 'right arrow should hide when the last card is fully visible');
assert.doesNotMatch(songBrowser, /rail\.scrollLeft <= 2/, 'rail arrows must not depend on a fragile raw scrollLeft threshold');

console.log('Editor rhythm polish regression tests passed');
