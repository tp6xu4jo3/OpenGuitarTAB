import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectArtists, filterWorks, worksFromSongs } from '../src/catalog/song-browser.js';

const works=[
  {workId:'w1',name:'Alpha Song',artist:'Artist A',album:'One',arrangements:[{source:'source-a',playStyle:'fingerstyle'}]},
  {workId:'w2',name:'Beta Song',artist:'Artist B',album:'Two',arrangements:[{source:'source-b',playStyle:'chord'}]},
  {workId:'w3',name:'Another Alpha',artist:'Artist A',album:'Three',arrangements:[{source:'special-source',playStyle:'chord'}]}
];
assert.deepEqual(collectArtists(works),['Artist A','Artist B']);
assert.deepEqual(filterWorks(works,{artist:'Artist A'}).map(work=>work.workId),['w1','w3']);
assert.deepEqual(filterWorks(works,{query:'beta'}).map(work=>work.workId),['w2']);
assert.deepEqual(filterWorks(works,{query:'special-source',artist:'Artist A'}).map(work=>work.workId),['w3']);
const grouped=worksFromSongs([
  {id:'s1',workId:'same-work',arrangementId:'a1',name:'Same',artist:'Artist',playStyle:'fingerstyle',difficulty:2,_driveFileId:'f1',_opentab:{owner:'admin',public:false}},
  {id:'s2',workId:'same-work',arrangementId:'a2',name:'Same',artist:'Artist',playStyle:'chord',difficulty:4,_driveFileId:'f2',_opentab:{owner:'admin',public:false}}
]);
assert.equal(grouped.length,1);
assert.equal(grouped[0].arrangements.length,2);

const browserSource=await readFile(new URL('../src/catalog/song-browser.js',import.meta.url),'utf8');
const appSource=await readFile(new URL('../src/app-catalog.js',import.meta.url),'utf8');
const css=await readFile(new URL('../styles/catalog.css',import.meta.url),'utf8');
assert.match(appSource,/catalogBrowser = new SongBrowser/);
assert.match(appSource,/libraryBrowser = new SongBrowser/);
assert.match(appSource,/libraryBrowser\.setWorks\(worksFromSongs\(songs\)\)/);
assert.match(browserSource,/setError\(message\)/);
assert.match(browserSource,/filterWorks\(this\.works/);
assert.match(browserSource,/song-browser-artist-rail/);
assert.match(browserSource,/createNextButton\('向右瀏覽更多曲譜'/);
assert.match(browserSource,/createNextButton\('向右瀏覽更多作者'/);
assert.doesNotMatch(browserSource,/installHorizontalWheel|wheel.*preventDefault/s,'vertical page wheel must remain native over rails');
assert.match(css,/\.song-browser-rail\s*\{[^}]*grid-template-rows:repeat\(2,/s);
assert.match(css,/\.song-browser-artist-rail\s*\{[^}]*grid-template-rows:1fr/s);
assert.match(css,/\.artist-filter-avatar\s*\{[^}]*border-radius:50%/s);
console.log('SongBrowser tests passed');
