import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/app-catalog.js', import.meta.url), 'utf8');

assert.match(source, /let catalogLoadGeneration = 0;[\s\S]*let libraryLoadGeneration = 0;[\s\S]*let previewLoadGeneration = 0;/s);

const libraryLoad = source.slice(source.indexOf('async function loadUserLibrary('), source.indexOf('function ensureUserLibraryLoaded('));
assert.match(libraryLoad, /const generation = \+\+libraryLoadGeneration/);
assert.match(libraryLoad, /const username = String\(user\?\.username \|\| ''\)/);
assert.equal((libraryLoad.match(/generation !== libraryLoadGeneration/g) || []).length, 2, 'library success and failure must both reject stale requests');
assert.equal((libraryLoad.match(/window\.authState\?\.user\?\.username/g) || []).length, 2, 'library requests must stay bound to the user that started them');
assert.match(libraryLoad, /songs = \(Array\.isArray\(result\.songs\)[\s\S]*\.map\(song => \(\{ \.\.\.song \}\)\)/s, 'library cards should retain lightweight metadata instead of hydrating every full score');
assert.doesNotMatch(libraryLoad, /map\(hydrateSong\)/, 'personal library listing must not instantiate every score document');

const lazyLibrary = source.slice(source.indexOf('function ensureUserLibraryLoaded('), source.indexOf('async function fetchCatalogArrangement('));
assert.match(lazyLibrary, /libraryLoadedUsername === username/,'a loaded library must be reused for the current user');
assert.match(lazyLibrary, /libraryLoadRequest && libraryLoadRequestUsername === username/,'concurrent lazy library requests must share one in-flight request');
assert.match(lazyLibrary, /const request = loadUserLibrary\(\)\.finally/,'lazy loading must delegate to the canonical library loader');
assert.match(lazyLibrary, /function ensureLibrarySongLoaded\(arrangementId\)[\s\S]*String\(item\?\.arrangementId \|\| ''\) === routeId[\s\S]*if \(song\.document\) return Promise\.resolve\(song\)/s, 'lazy score loading must resolve metadata by arrangement identity and reuse an already-loaded full score');
assert.match(lazyLibrary, /librarySongLoadRequests\.has\(fileId\)[\s\S]*dataSource\.loadSong\(fileId\)[\s\S]*replaceSongRecord\(hydrateSong\(result\.song\)\)/s, 'opening a metadata-only library item must fetch and hydrate only that score with shared in-flight loading');

const previewLoad = source.slice(source.indexOf('async function openCatalogPreview('), source.indexOf('async function openLocalEditor('));
assert.match(previewLoad, /const generation = \+\+previewLoadGeneration/);
assert.match(previewLoad, /const routeHash = location\.hash/);
assert.equal((previewLoad.match(/generation !== previewLoadGeneration \|\| location\.hash !== routeHash/g) || []).length, 2, 'preview success and failure must both ignore stale route requests');

const localEditor = source.slice(source.indexOf('async function openLocalEditor('), source.indexOf('function handleRoute('));
assert.match(localEditor, /async function openLocalEditor\(arrangementId\)[\s\S]*await ensureLibrarySongLoaded\(arrangementId\)[\s\S]*showPage\('editor'\)[\s\S]*loadSong\(loaded\.id\)/s, 'editor navigation must resolve the arrangement route and wait for its full score before rendering');

const routeHandler = source.slice(source.indexOf('function handleRoute('), source.indexOf('async function initializeApp('));
assert.match(routeHandler, /if \(route !== 'preview'\) previewLoadGeneration \+= 1;/, 'leaving preview must invalidate any in-flight preview request');
assert.match(routeHandler, /if \(route === 'library'\)[\s\S]*void ensureUserLibraryLoaded\(\)/s,'the library metadata should load only when the library route is entered');
assert.match(routeHandler, /if \(route === 'editor' && id\)[\s\S]*ensureUserLibraryLoaded\(\)\.then/s,'direct editor routes must lazy-load library metadata before resolving a local song');
assert.match(routeHandler, /songs\.some\(song => song\.arrangementId === id\)[^\n]*void openLocalEditor\(id\)/, 'editor routes must resolve metadata by arrangementId before entering the lazy full-score path');

const initializeApp = source.slice(source.indexOf('async function initializeApp('), source.indexOf("mobileMenuButton?.addEventListener"));
assert.match(initializeApp, /await initializeAuth\(\);[\s\S]*await loadCatalog\(\);/s,'startup must establish auth and load catalog metadata');
assert.doesNotMatch(initializeApp, /loadUserLibrary\(/,'catalog startup must not download the user library');

const addArrangement = source.slice(source.indexOf('async function addCatalogArrangement('), source.indexOf('function renderCatalogArrangementActions('));
assert.match(addArrangement, /await ensureUserLibraryLoaded\(\);[\s\S]*catalogArrangementIsAdded\(arrangement\)/s,'adding a public arrangement must verify the lazy library before cloning to prevent duplicates');

const authHandler = source.slice(source.indexOf("window.addEventListener('opentab:auth-changed'"), source.indexOf("window.addEventListener('opentab:test-data-reset'"));
assert.match(authHandler, /libraryLoadedUsername = '';/,'auth changes must invalidate the lazy-library identity cache');
assert.match(authHandler, /librarySongLoadRequests\.clear\(\)/,'auth changes must discard selected-score requests from the previous user');
assert.match(authHandler, /libraryLoadGeneration \+= 1;/, 'logout must invalidate in-flight library requests');
assert.match(authHandler, /previewLoadGeneration \+= 1;/, 'logout must invalidate in-flight preview requests');

console.log('catalog async regression tests passed');

assert.doesNotMatch(source, /#\/editor\/\$\{encodeURIComponent\((?:song|local)\.id\)\}/, 'editor URLs must not expose mutable/internal song ids');
assert.match(source, /#\/editor\/\$\{encodeURIComponent\(local\.arrangementId\)\}/, 'catalog edit routes must use arrangement identity');
assert.match(source, /#\/editor\/\$\{encodeURIComponent\(song\.arrangementId\)\}/, 'library card edit routes must use arrangement identity');
