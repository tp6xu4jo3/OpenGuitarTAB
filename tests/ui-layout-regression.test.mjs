import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { artistProfileFor } from '../src/catalog/artist-profiles.js';

const browser = await readFile(new URL('../src/catalog/song-browser.js', import.meta.url), 'utf8');
const catalogCss = await readFile(new URL('../styles/catalog.css', import.meta.url), 'utf8');
const editorCss = await readFile(new URL('../styles/editor-v3.css', import.meta.url), 'utf8');
const moduleCss = await readFile(new URL('../styles/editor-modules.css', import.meta.url), 'utf8');
const adaptiveCss = await readFile(new URL('../styles/adaptive-measures.css', import.meta.url), 'utf8');
const toolsCss = await readFile(new URL('../styles/editor-tools.css', import.meta.url), 'utf8');

assert.equal(artistProfileFor('周杰倫')?.image, 'https://r2.theaudiodb.com/images/media/artist/thumb/1xuf2r1779253287.jpg');
assert.match(browser, /installHorizontalWheel/);
assert.match(browser, /event\.preventDefault\(\);\s*rail\.scrollLeft \+= event\.deltaY/s);
assert.match(browser, /work-card-inner/);
assert.match(browser, /work-card-front/);
assert.match(browser, /work-card-back/);
assert.match(browser, /點擊展開/);
assert.match(browser, /顯示所有內容/);
const toggleSource = browser.slice(browser.indexOf('toggleWork(workId)'), browser.indexOf('createArtistAvatar'));
assert.match(toggleSource, /setCardExpanded/);
assert.doesNotMatch(toggleSource, /this\.render\(/, 'card flip must keep the same DOM node so the 3D transition can animate');
assert.match(catalogCss, /\.work-card\.is-expanded \.work-card-inner\s*\{[^}]*rotateY\(180deg\)/s);
assert.match(catalogCss, /scrollbar-color:#6e6e6e #202020/);
assert.match(catalogCss, /\.song-browser-rail\s*\{[^}]*grid-template-rows:repeat\(2,300px\)/s);
assert.match(catalogCss, /\.song-browser-artist-rail\s*\{[^}]*grid-template-rows:1fr/s);
assert.match(editorCss, /\.v3-column-target\{[^}]*z-index:4/s, 'blank sparse targets must sit above measure hitboxes');
assert.match(editorCss, /\.v3-column-target::before\{[^}]*radial-gradient/s, 'blank sparse targets must expose visible input circles without dense inputs');
assert.match(moduleCss, /\.content\.edit-view \.editor-row-module:hover,\.content\.edit-view \.editor-row-module\.is-selected\{border-color:#1ed760/s);
assert.match(moduleCss, /\.row-module-label\{[^}]*writing-mode:vertical-rl/s);
assert.match(adaptiveCss, /\.content\.score-view \.adaptive-layout-stack\{grid-column:2\}/, 'score-view stack must occupy the actual content column');
assert.match(toolsCss, /\.notation-overlay\s*\{\s*z-index: 10;/s);
assert.match(toolsCss, /\.technique-marker-layer\s*\{[^}]*z-index: 11;/s);

console.log('UI layout regression tests passed');
