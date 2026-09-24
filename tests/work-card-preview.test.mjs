import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app-catalog.js', import.meta.url), 'utf8');
const browser = await readFile(new URL('../src/catalog/song-browser.js', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../src/app-runtime.js', import.meta.url), 'utf8');
const catalogCss = await readFile(new URL('../styles/catalog.css', import.meta.url), 'utf8');
const mainCss = await readFile(new URL('../styles/main.css', import.meta.url), 'utf8');

assert.match(runtime, /let catalogWorks = \[\]/, 'runtime should expose Work catalog state');
assert.doesNotMatch(runtime, /catalogSongs/, 'runtime should not retain the old public song catalog state');
assert.match(app, /Array\.isArray\(result\.works\) \? result\.works : \[\]/, 'catalog should consume works[] as its only public card source');
assert.match(browser, /createWorkCard\(work\)/);
assert.match(browser, /createArrangementRow\(work, arrangement\)/);
assert.match(browser, /work-card-arrangements/);
assert.match(browser, /work-card-style-badges/);
assert.match(browser, /difficultyLabel\(arrangement\.difficulty\)/, 'arrangement rows should own difficulty presentation');
assert.doesNotMatch(app, /catalog-card-more|catalog-card-menu|catalogMenuOpenFor/, 'outer public card menu should stay removed');
assert.doesNotMatch(mainCss, /catalog-management\.css/, 'removed outer-menu stylesheet should not be imported');
const cardSource = browser.slice(browser.indexOf('createWorkCard(work)'), browser.indexOf('render()'));
assert.doesNotMatch(cardSource, /difficultyLabel|難度/, 'difficulty must not appear on the outer WorkCard summary');
assert.match(app, /'預覽'/);
assert.match(app, /'編輯'/);
assert.match(app, /'下架'/);
assert.match(app, /'＋ 加入'/);
assert.match(catalogCss, /\.work-card\.is-expanded\s*\{[^}]*grid-row:1 \/ span 2;[^}]*grid-column:span 3/s, 'expanded WorkCard should occupy both song rows and expand horizontally');
assert.match(catalogCss, /\.song-card-art\s*\{[^}]*transition:[^}]*width/s, 'cover should animate its size');
assert.match(catalogCss, /\.song-card-body\s*\{[^}]*transition:[^}]*transform/s, 'work copy should animate its position');

console.log('WorkCard preview tests passed');
