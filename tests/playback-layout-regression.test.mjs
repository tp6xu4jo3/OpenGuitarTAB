import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../styles/playback-controls.css', import.meta.url), 'utf8');
const headerCss = await readFile(new URL('../styles/header.css', import.meta.url), 'utf8');
const viewState = await readFile(new URL('../src/editor/view-state.js', import.meta.url), 'utf8');

assert.match(
  css,
  /\.editor-view #rhythmToggleButton,\.editor-view #scoreDensityControl\{[^}]*min-width:max-content[^}]*flex-wrap:nowrap[^}]*white-space:nowrap/s,
  'playback mode switches must stay single-line and must not shrink into wrapped controls'
);
assert.match(
  css,
  /@media\(min-width:761px\) and \(max-width:980px\)[\s\S]*#rhythmToggleButton\{grid-column:1;grid-row:1\}[\s\S]*#scoreDensityControl\{grid-column:2;grid-row:1\}[\s\S]*\.capo-box\{grid-column:3;grid-row:1\}[\s\S]*\.tempo-box\{grid-column:4;grid-row:1\}[\s\S]*\.progress-box\{grid-column:5;grid-row:1/s,
  'tablet playback layout must keep mode switches and primary playback controls on the first row'
);
assert.match(
  css,
  /@media\(max-width:760px\)[\s\S]*#rhythmToggleButton\{grid-column:1;grid-row:1[^}]*\}[\s\S]*#scoreDensityControl\{grid-column:2;grid-row:1[^}]*\}/s,
  'mobile playback layout must keep both mode switches together on the first row'
);
assert.match(
  viewState,
  /control\.classList\.toggle\('is-active', compact\)/,
  'compact mode must synchronize an explicit visual active state'
);
assert.match(
  viewState,
  /toggle\.classList\.toggle\('is-active', active\)/,
  'score mode must use the same explicit active state as compact mode'
);
assert.match(
  headerCss,
  /\.mode-toggle-button\.is-active \.mode-switch \{ background:#22c55e; \}/,
  'active mode switches must render with the green track'
);
assert.match(
  headerCss,
  /\.mode-toggle-button\.is-active \.mode-switch-thumb \{ transform:translateX\(19px\); \}/,
  'active mode switches must move the thumb to the on position'
);

console.log('playback layout regression tests passed');
