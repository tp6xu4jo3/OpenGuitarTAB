import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/app-catalog.js', import.meta.url), 'utf8');

assert.match(source, /let catalogLoadGeneration = 0;[\s\S]*let libraryLoadGeneration = 0;[\s\S]*let previewLoadGeneration = 0;/s);

const libraryLoad = source.slice(source.indexOf('async function loadUserLibrary('), source.indexOf('async function fetchCatalogArrangement('));
assert.match(libraryLoad, /const generation = \+\+libraryLoadGeneration/);
assert.match(libraryLoad, /const username = String\(user\?\.username \|\| ''\)/);
assert.equal((libraryLoad.match(/generation !== libraryLoadGeneration/g) || []).length, 2, 'library success and failure must both reject stale requests');
assert.equal((libraryLoad.match(/window\.authState\?\.user\?\.username/g) || []).length, 2, 'library requests must stay bound to the user that started them');

const previewLoad = source.slice(source.indexOf('async function openCatalogPreview('), source.indexOf('function openLocalEditor('));
assert.match(previewLoad, /const generation = \+\+previewLoadGeneration/);
assert.match(previewLoad, /const routeHash = location\.hash/);
assert.equal((previewLoad.match(/generation !== previewLoadGeneration \|\| location\.hash !== routeHash/g) || []).length, 2, 'preview success and failure must both ignore stale route requests');

const routeHandler = source.slice(source.indexOf('function handleRoute('), source.indexOf('async function initializeApp('));
assert.match(routeHandler, /if \(route !== 'preview'\) previewLoadGeneration \+= 1;/, 'leaving preview must invalidate any in-flight preview request');

const authHandler = source.slice(source.indexOf("window.addEventListener('opentab:auth-changed'"), source.indexOf("window.addEventListener('opentab:test-data-reset'"));
assert.match(authHandler, /libraryLoadGeneration \+= 1;/, 'logout must invalidate in-flight library requests');
assert.match(authHandler, /previewLoadGeneration \+= 1;/, 'logout must invalidate in-flight preview requests');

console.log('catalog async regression tests passed');
