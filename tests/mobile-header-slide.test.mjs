import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const responsiveCss = await readFile(new URL('../styles/responsive.css', import.meta.url), 'utf8');
const audioSource = await readFile(new URL('../src/editor/audio-engine.js', import.meta.url), 'utf8');
const playbackSource = await readFile(new URL('../src/editor/playback-controller.js', import.meta.url), 'utf8');
const structureSource = await readFile(new URL('../src/editor/structure-controller.js', import.meta.url), 'utf8');

assert.match(
  responsiveCss,
  /@media \(max-width:760px\)[\s\S]*\.header-left\{[^}]*grid-column:1\/5[^}]*flex-wrap:nowrap[^}]*gap:3px[^}]*\}[\s\S]*\.save-button,\.download-button\{[^}]*width:36px[^}]*min-width:36px[^}]*padding:0/s,
  'mobile header actions must stay on the first row instead of wrapping into playback controls'
);
assert.match(
  responsiveCss,
  /@media \(max-width:340px\)[\s\S]*\.header-left\{grid-column:1\/6\}[\s\S]*\.save-button,\.download-button\{[^}]*width:32px[^}]*min-width:32px/s,
  'very narrow phones need an extra header column and compact action buttons'
);
assert.match(
  responsiveCss,
  /@media \(max-width:760px\)[\s\S]*\.editor-ribbon-panel\{[^}]*overflow-x:auto[^}]*touch-action:pan-x[^}]*\}[\s\S]*\.editor-ribbon-section\{[^}]*width:100%[^}]*max-width:none[^}]*min-width:max-content/s,
  'expanded mobile ribbon must use the viewport-width panel as the horizontal swipe surface while content keeps its intrinsic width'
);
assert.match(
  structureSource,
  /function syncHandleMetadata\(handle, target\)[\s\S]*const displayRow = target\.visualRowIndex \+ 1;[\s\S]*label\.textContent = `第 \$\{displayRow\} 列`/s,
  'responsive visual rows must display their visual row number instead of repeating the logical source-row number'
);
assert.match(
  audioSource,
  /for \(const step of slideSteps\)[\s\S]*setValueAtTime\(previousRate, rampStart\)[\s\S]*linearRampToValueAtTime\(nextRate, stepEnd\)/s,
  'slide playback must glide separately to every intermediate fret rather than jump or draw one straight ramp to the destination'
);
assert.match(audioSource, /SLIDE_MOTION_SECONDS = 0\.12/);
assert.match(audioSource, /SLIDE_TARGET_HOLD_SECONDS = 0\.045/);
assert.match(audioSource, /SLIDE_TRANSITION_LEVEL = 0\.9/);
assert.doesNotMatch(audioSource, /SLIDE_ENDPOINT_BOOST/,'slide endpoints must stay at normal single-note loudness');
assert.match(
  audioSource,
  /targetHoldSeconds = Math\.min\(SLIDE_TARGET_HOLD_SECONDS, duration \* 0\.25\)[\s\S]*sourceHoldSeconds = Math\.max\(0, duration - targetHoldSeconds - motionDuration\)/s,
  'slide motion must occupy a fixed late window and shrink naturally for shorter rhythmic relations'
);
assert.match(
  audioSource,
  /gain\.gain\.setValueAtTime\(level, now\)[\s\S]*level \* SLIDE_TRANSITION_LEVEL[\s\S]*linearRampToValueAtTime\(level, now \+ slideEnd\)/s,
  'slide motion should dip only about ten percent while source and target stay at normal note level'
);
assert.match(playbackSource, /slideSeconds: slide \? Math\.max\(0\.015,/,'short relations must be allowed to shrink below the old 60 ms floor');

console.log('mobile header, ribbon, visual row and slide tests passed');
