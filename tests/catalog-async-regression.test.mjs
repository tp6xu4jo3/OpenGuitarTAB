import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/app-catalog.js', import.meta.url), 'utf8');

assert.match(source, /let catalogLoadGeneration = 0;[\s\S]*let libraryLoadGeneration = 0;[\s\S]*let previewLoadGeneration = 0;/s);

const libraryLoad = source.slice(source.indexOf('async function loadUserLibrary('), source.indexOf('function ensureUserLibraryLoaded('));
assert.match(libraryLoad, /const generation = \+\+libraryLoadGeneration/);
assert.match(libraryLoad, /const username = String\(user\?\.username \|\| ''\)/);
assert.equal((libraryLoad.match(/generation !== libraryLoadGeneration/g) || []).length, 2, 'library success and failure must both reject stale requests');
assert.equal((libraryLoad.match(/window\.authState\?\.user\?\.username/g) || []).length, 2, 'library requests must stay bound to the user that started them');

const lazyLibrary = source.slice(source.indexOf('function ensureUserLibraryLoaded('), source.indexOf('async function fetchCatalogArrangement('));
assert.match(lazyLibrary, /libraryLoadedUsername === username/,'a loaded library must be reused for the current user');
assert.match(lazyLibrary, /libraryLoadRequest && libraryLoadRequestUsername === username/,'concurrent lazy library requests must share one in-flight request');
assert.match(lazyLibrary, /const request = loadUserLibrary\(\)\.finally/,'lazy loading must delegate to the canonical library loader');

const previewLoad = source.slice(source.indexOf('async function openCatalogPreview('), source.indexOf('function openLocalEditor('));
assert.match(previewLoad, /const generation = \+\+previewLoadGeneration/);
assert.match(previewLoad, /const routeHash = location\.hash/);
assert.equal((previewLoad.match(/generation !== previewLoadGeneration \|\| location\.hash !== routeHash/g) || []).length, 2, 'preview success and failure must both ignore stale route requests');

const routeHandler = source.slice(source.indexOf('function handleRoute('), source.indexOf('async function initializeApp('));
assert.match(routeHandler, /if \(route !== 'preview'\) previewLoadGeneration \+= 1;/, 'leaving preview must invalidate any in-flight preview request');
assert.match(routeHandler, /if \(route === 'library'\)[\s\S]*void ensureUserLibraryLoaded\(\)/s,'the full library should load only when the library route is entered');
assert.match(routeHandler, /if \(route === 'editor' && id\)[\s\S]*ensureUserLibraryLoaded\(\)\.then/s,'direct editor routes must lazy-load the library before resolving a local song');

const initializeApp = source.slice(source.indexOf('async function initializeApp('), source.indexOf("mobileMenuButton?.addEventListener"));
assert.match(initializeApp, /await initializeAuth\(\);[\s\S]*await loadCatalog\(\);/s,'startup must establish auth and load catalog metadata');
assert.doesNotMatch(initializeApp, /loadUserLibrary\(/,'catalog startup must not download the full user library');

const addArrangement = source.slice(source.indexOf('async function addCatalogArrangement('), source.indexOf('function renderCatalogArrangementActions('));
assert.match(addArrangement, /await ensureUserLibraryLoaded\(\);[\s\S]*catalogArrangementIsAdded\(arrangement\)/s,'adding a public arrangement must verify the lazy library before cloning to prevent duplicates');

const authHandler = source.slice(source.indexOf("window.addEventListener('opentab:auth-changed'"), source.indexOf("window.addEventListener('opentab:test-data-reset'"));
assert.match(authHandler, /libraryLoadedUsername = '';/,'auth changes must invalidate the lazy-library identity cache');
assert.match(authHandler, /libraryLoadGeneration \+= 1;/, 'logout must invalidate in-flight library requests');
assert.match(authHandler, /previewLoadGeneration \+= 1;/, 'logout must invalidate in-flight preview requests');

console.log('catalog async regression tests passed');