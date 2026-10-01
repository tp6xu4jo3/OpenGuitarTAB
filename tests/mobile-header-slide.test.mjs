import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const responsiveCss = await readFile(new URL('../styles/responsive.css', import.meta.url), 'utf8');
const audioSource = await readFile(new URL('../src/editor/audio-engine.js', import.meta.url), 'utf8');

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
  audioSource,
  /for \(const step of slideSteps\)[\s\S]*source\.playbackRate\.setValueAtTime\(nextRate, stepTime\)/s,
  'slide playback must visit each fret as a discrete semitone step'
);
assert.doesNotMatch(
  audioSource,
  /source\.playbackRate\.linearRampToValueAtTime/,
  'slide pitch must not use a continuous straight-line ramp between frets'
);
assert.match(audioSource, /SLIDE_ENDPOINT_BOOST = 1\.12/);
assert.match(
  audioSource,
  /gain\.gain\.setValueAtTime\(endpointLevel, now\)[\s\S]*gain\.gain\.setValueAtTime\(endpointLevel, now \+ slideEnd\)[\s\S]*linearRampToValueAtTime\(level, now \+ slideEnd \+ 0\.045\)/s,
  'slide source and destination notes must be accented above the quieter motion'
);

console.log('mobile header and fret-stepped slide tests passed');
