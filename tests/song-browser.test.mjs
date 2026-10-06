import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectArtists, filterWorks, worksFromSongs } from '../src/catalog/song-browser.js';

const works=[
  {workId:'w1',name:'Alpha Song',artist:'Artist A',album:'One',arrangements:[{arrangementName:'Alpha 簡單版',source:'source-a',playStyle:'fingerstyle'}]},
  {workId:'w2',name:'Beta Song',artist:'Artist B',album:'Two',arrangements:[{arrangementName:'Beta 抒情版',source:'source-b',playStyle:'chord'}]},
  {workId:'w3',name:'Another Alpha',artist:'Artist A',album:'Three',arrangements:[{arrangementName:'Another Alpha 指彈版',source:'special-source',playStyle:'chord'}]}
];
assert.deepEqual(collectArtists(works),['Artist A','Artist B']);
assert.deepEqual(filterWorks(works,{artist:'Artist A'}).map(work=>work.workId),['w1','w3']);
assert.deepEqual(filterWorks(works,{query:'beta'}).map(work=>work.workId),['w2']);
assert.deepEqual(filterWorks(works,{query:'special-source',artist:'Artist A'}).map(work=>work.workId),['w3']);
assert.deepEqual(filterWorks(works,{query:'抒情版'}).map(work=>work.workId),['w2'],'search must include editable arrangement names');
const grouped=worksFromSongs([
  {id:'s1',workId:'same-work',arrangementId:'a1',arrangementName:'Same 簡單版',name:'Same',artist:'Artist',playStyle:'fingerstyle',difficulty:2,_driveFileId:'f1',_opentab:{owner:'admin',public:false}},
  {id:'s2',workId:'same-work',arrangementId:'a2',arrangementName:'Same 指彈版',name:'Same',artist:'Artist',playStyle:'chord',difficulty:4,_driveFileId:'f2',_opentab:{owner:'admin',public:false}}
]);
assert.equal(grouped.length,1);
assert.equal(grouped[0].arrangements.length,2);
assert.deepEqual(new Set(grouped[0].arrangements.map(item=>item.arrangementName)),new Set(['Same 簡單版','Same 指彈版']));

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
assert.match(browserSource,/this\.showAllButton = createElement\('button', 'song-browser-show-all', '顯示所有曲譜'\)[\s\S]*this\.songsExpanded = !this\.songsExpanded[\s\S]*this\.render\(\)/s,'show-all-songs must toggle only the score layout state');
assert.doesNotMatch(browserSource,/this\.showAllButton\.addEventListener[\s\S]{0,300}this\.activeArtist = ''/s,'show-all-songs must preserve the selected artist filter');
assert.match(browserSource,/this\.showAllArtistsButton = createElement\('button', 'song-browser-show-all', '顯示所有作者'\)[\s\S]*this\.artistsExpanded = !this\.artistsExpanded[\s\S]*this\.render\(\)/s,'作者 heading must independently toggle its vertical expansion state');
assert.match(browserSource,/createAllArtistsButton\(\)[\s\S]*artist-filter-button artist-filter-all[\s\S]*'全部作者'[\s\S]*this\.activeArtist = ''[\s\S]*this\.render\(\)/s,'the pinned 全部作者 control must clear only the artist filter');
assert.doesNotMatch(browserSource,/createAllArtistsButton\(\)[\s\S]{0,700}this\.(?:songsExpanded|artistsExpanded) = false/s,'全部作者 must not change either expansion state');
assert.match(browserSource,/this\.artistShell\.append\(this\.allArtistsButton, this\.artistRail\)/,'全部作者 must live outside the scrollable artist rail so it cannot be pushed away');
assert.match(browserSource,/this\.container\.classList\.toggle\('is-expanded', this\.songsExpanded\)/);
assert.match(browserSource,/this\.artistRail\.classList\.toggle\('is-expanded', this\.artistsExpanded\)/);
assert.match(browserSource,/this\.showAllButton\.textContent = this\.songsExpanded \? '顯示部分曲譜' : '顯示所有曲譜'/,'song expansion control must offer the inverse action');
assert.match(browserSource,/this\.showAllArtistsButton\.textContent = this\.artistsExpanded \? '顯示部分作者' : '顯示所有作者'/,'artist expansion control must offer the inverse action');
assert.match(browserSource,/button\.addEventListener\('click', \(\) => \{[\s\S]*this\.activeArtist = this\.activeArtist === artist \? '' : artist;[\s\S]*this\.render\(\);[\s\S]*\}\);/s,'artist selection must preserve current expansion state');
assert.doesNotMatch(browserSource,/this\.activeArtist = this\.activeArtist === artist \? '' : artist;[\s\S]{0,180}this\.(?:songsExpanded|artistsExpanded) = false/s,'selecting an artist must not collapse either expanded section');
assert.match(browserSource,/createRailButton\('prev', '向左瀏覽曲譜'/);
assert.match(browserSource,/createRailButton\('next', '向右瀏覽更多曲譜'/);
assert.match(browserSource,/createRailButton\('prev', '向左瀏覽作者'/);
assert.match(browserSource,/createRailButton\('next', '向右瀏覽更多作者'/);
assert.match(browserSource,/`☆\$\{Math\.round\(number\)\}` : '☆-'/,'difficulty label must use the compact star notation');
assert.match(browserSource,/const primary = createElement\('div', 'work-card-arrangement-primary'\)[\s\S]*arrangement\.arrangementName \|\| work\.name[\s\S]*primary\.append\(title, difficulty\)[\s\S]*playStyleLabel\(arrangement\.playStyle\).*來源 \$\{arrangement\.source \|\| '-'\}/s,'card back must show arrangement name with difficulty, then play style/source metadata below');
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

assert.match(browserSource,/setWorks\(works = \[\]\)[\s\S]*this\.rebuildDataNodes\(\);[\s\S]*this\.render\(\);/s,'new catalog data must build its media DOM once before rendering view state');
assert.match(browserSource,/rebuildDataNodes\(\)[\s\S]*this\.createWorkCard\(work\)[\s\S]*this\.rebuildArtistNodes\(\)/s,'album covers and artist avatars must be created only when the data set changes');
assert.match(browserSource,/rebuildArtistNodes\(\)[\s\S]*this\.createArtistAvatar\(artist\)/s,'artist images must be created in the data rebuild path');
assert.match(browserSource,/const visibleIds = new Set\(this\.selectedWorks\(\)\.map[\s\S]*card\.hidden = !visibleIds\.has\(workId\)/s,'filtering must reuse existing work-card DOM by toggling visibility');
const renderStart=browserSource.lastIndexOf('\n  render() {');
const renderSource=browserSource.slice(renderStart);
assert.ok(renderStart>=0,'SongBrowser must expose one final render method');
assert.doesNotMatch(renderSource,/createWorkCard|createArtistAvatar|innerHTML = ''/,'view-state renders must not recreate media DOM or reassign image sources');

console.log('SongBrowser tests passed');
