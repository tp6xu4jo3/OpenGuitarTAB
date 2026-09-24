import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app-catalog.js', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../src/app-runtime.js', import.meta.url), 'utf8');
const catalogCss = await readFile(new URL('../styles/catalog.css', import.meta.url), 'utf8');
const managementCss = await readFile(new URL('../styles/catalog-management.css', import.meta.url), 'utf8');

assert.match(runtime, /let catalogWorks = \[\]/, 'runtime should expose Work catalog state');
assert.doesNotMatch(runtime, /catalogSongs/, 'runtime should not retain the old public song catalog state');
assert.match(app, /Array\.isArray\(result\.works\) \? result\.works : \[\]/, 'catalog should consume works[] as its only public card source');
assert.match(app, /function workCard\(work\)/);
assert.match(app, /function arrangementRow\(work, arrangement\)/);
assert.match(app, /work-card-arrangements/);
assert.match(app, /work-card-play-style/);
assert.match(app, /work-card-arrangement-difficulty/);
assert.match(app, /art\.animate\(/, 'cover should animate between collapsed and expanded layouts');
assert.match(app, /copy\.animate\(/, 'work copy should animate between collapsed and expanded layouts');
assert.doesNotMatch(app, /catalog-card-more|catalog-card-menu|catalogMenuOpenFor/, 'outer public card menu should be removed');
assert.doesNotMatch(managementCss, /catalog-card-more|catalog-card-menu/, 'removed outer menu should not survive in CSS');

const workCardSource = app.slice(app.indexOf('function workCard(work)'), app.indexOf('function workMatchesQuery'));
const workSummarySource = workCardSource.slice(0, workCardSource.indexOf("const preview = document.createElement('div')"));
assert.doesNotMatch(workSummarySource, /難度|difficulty/, 'difficulty must not appear on the outer WorkCard summary');
const arrangementSource = app.slice(app.indexOf('function arrangementRow'), app.indexOf('function setWorkCardExpanded'));
assert.match(arrangementSource, /arrangementDifficulty/, 'arrangement rows should own difficulty presentation');
assert.match(arrangementSource, /預覽/);
assert.match(arrangementSource, /編輯/);
assert.match(arrangementSource, /下架/);
assert.match(arrangementSource, /加入/);
assert.match(catalogCss, /\.work-card\.is-expanded\s*\{[^}]*grid-column:1\/-1/s, 'expanded WorkCard should span the song grid');
assert.match(catalogCss, /\.work-card\.is-expanded \.work-card-summary/);

console.log('WorkCard preview tests passed');
