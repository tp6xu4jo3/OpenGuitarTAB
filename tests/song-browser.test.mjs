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
assert.match(browserSource,/this\.songsExpanded = false/,'song browser must track vertical all-songs mode separately from filtering');
assert.match(browserSource,/this\.artistsExpanded = false/,'song browser must track vertical all-artists mode separately from filtering');
assert.match(browserSource,/this\.showAllButton = createElement\('button', 'song-browser-show-all', '顯示所有曲譜'\)[\s\S]*this\.songsExpanded = true[\s\S]*this\.activeArtist = ''[\s\S]*this\.searchInput\.value = ''/s,'show-all-songs must clear filters and switch the score list into expanded mode');
assert.match(browserSource,/this\.showAllArtistsButton = createElement\('button', 'song-browser-show-all', '顯示所有作者'\)[\s\S]*this\.artistsExpanded = true/s,'作者 heading must expose its own vertical expansion control');
assert.match(browserSource,/createAllArtistsButton\(\)[\s\S]*artist-filter-button artist-filter-all[\s\S]*'全部作者'[\s\S]*this\.activeArtist = ''[\s\S]*this\.songsExpanded = false[\s\S]*this\.artistsExpanded = false/s,'the pinned 全部作者 control must clear artist filtering and return to the compact score browser');
assert.match(browserSource,/this\.artistShell\.append\(this\.allArtistsButton, this\.artistRail\)/,'全部作者 must live outside the scrollable artist rail so it cannot be pushed away');
assert.match(browserSource,/this\.container\.classList\.toggle\('is-expanded', this\.songsExpanded\)/);
assert.match(browserSource,/this\.artistRail\.classList\.toggle\('is-expanded', this\.artistsExpanded\)/);
assert.match(browserSource,/createRailButton\('prev', '向左瀏覽曲譜'/);
assert.match(browserSource,/createRailButton\('next', '向右瀏覽更多曲譜'/);
assert.match(browserSource,/createRailButton\('prev', '向左瀏覽作者'/);
assert.match(browserSource,/createRailButton\('next', '向右瀏覽更多作者'/);
assert.match(browserSource,/`☆\$\{Math\.round\(number\)\}` : '☆-'/,'difficulty label must use the compact star notation');
assert.match(browserSource,/const primary = createElement\('div', 'work-card-arrangement-primary'\)[\s\S]*primary\.append\(title, difficulty\)[\s\S]*來源 \$\{arrangement\.source \|\| '-'\}/s,'card back must keep play style and difficulty on one row, then source below');
assert.match(css,/\.work-card-arrangement-primary\{[^}]*display:flex[^}]*align-items:center/s,'arrangement primary row must be inline');
assert.match(css,/\.work-card-arrangement-difficulty\{[^}]*display:inline-flex[^}]*padding:1px 6px[^}]*border-radius:999px[^}]*background:#3a3a3a[^}]*line-height:1/s,'difficulty badge must stay shorter than the adjacent style text');
assert.match(browserSource,/const firstRect = items\[0\]\.getBoundingClientRect\(\)[\s\S]*const lastRect = items\.at\(-1\)\.getBoundingClientRect\(\)/,'arrow visibility must follow the visual first/last card boundaries');
assert.match(browserSource,/prev\.hidden = firstRect\.left >= railRect\.left - edgeTolerance/,'left arrow must stay hidden while the first card remains fully visible after scroll snapping');
assert.match(browserSource,/next\.hidden = lastRect\.right <= railRect\.right \+ edgeTolerance/,'right arrow must hide when the final card is fully visible');
assert.doesNotMatch(browserSource,/rail\.scrollLeft <= 2/,'arrow visibility must not depend on a fragile raw scrollLeft threshold');
assert.doesNotMatch(browserSource,/installHorizontalWheel|wheel.*preventDefault/s,'vertical page wheel must remain native over rails');
assert.match(css,/\.song-browser-rail\s*\{[^}]*grid-template-rows:repeat\(2,/s);
assert.match(css,/\.song-browser-rail\.is-expanded\{[^}]*grid-template-columns:repeat\(auto-fill,minmax\(200px,220px\)\)[^}]*grid-auto-flow:row[^}]*overflow:visible/s,'expanded scores must wrap downward and use page scrolling instead of horizontal scrolling');
assert.match(css,/\.song-browser-artist-shell\{[^}]*grid-template-columns:168px minmax\(0,1fr\)/s,'the fixed 全部作者 control must reserve the leftmost artist column');
assert.match(css,/\.song-browser-artist-rail\s*\{[^}]*grid-template-rows:1fr/s);
assert.match(css,/\.song-browser-artist-rail\.is-expanded\{[^}]*grid-template-columns:repeat\(auto-fill,168px\)[^}]*grid-auto-flow:row[^}]*overflow:visible/s,'expanded artists must wrap downward instead of scrolling horizontally');
assert.match(css,/\.artist-filter-all\{width:168px/s,'全部作者 must use the same circular-filter footprint as normal artists');
assert.match(css,/\.artist-filter-avatar\s*\{[^}]*border-radius:50%/s);
console.log('SongBrowser tests passed');
