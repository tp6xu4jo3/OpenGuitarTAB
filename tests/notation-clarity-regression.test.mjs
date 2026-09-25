import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const renderer = await readFile(new URL('../src/editor/renderer.js', import.meta.url), 'utf8');
const notation = await readFile(new URL('../src/editor/notation-renderer.js', import.meta.url), 'utf8');
const playback = await readFile(new URL('../src/editor/playback-index.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles/editor-v3.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

assert.doesNotMatch(renderer, /v3-note-backdrop/, 'note rendering must not recreate white backdrops');
assert.match(renderer, /isScoreViewActive\(\) \? `<\$\{value\}>` : value/, 'harmonics use entered fret and angle brackets only in score mode');
assert.match(playback, /editableTimesForMeasure\(measure\)/, 'playback timeline follows every editable column');
assert.match(notation, /kind: 'group',[\s\S]*label: '3'/, 'editing triplets expose the circled 3 group marker');
assert.match(notation, /function chordLaneY\(/, 'chord notation uses a lane above string one');
assert.match(css, /\.v3-string-line\{[^}]*background:#c6c6c6/s, 'TAB strings are light gray');
assert.match(css, /\.v3-rhythm-stem\{[^}]*width:2px/s, 'stems use the normalized rhythm stroke');
assert.match(css, /\.v3-rhythm-beam,\.v3-rhythm-flag\{[^}]*height:2px/s, 'beams and flags use the normalized rhythm stroke');
assert.match(html, /assets\/OpenGuitarTABicon\.ico/, 'uploaded app icon is wired into the UI');

console.log('notation clarity regressions passed');
