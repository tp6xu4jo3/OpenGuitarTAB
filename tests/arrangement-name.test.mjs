import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, runtime, library, importer, catalog, songActions, sourceUi, api, workModel, sidebarCss, modalsCss] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/app-runtime.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app-library.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/library/song-import.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app-catalog.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/editor/song-actions.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app-source-ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../api/index.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/catalog/work-model.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles/sidebar.css', import.meta.url), 'utf8'),
  readFile(new URL('../styles/modals.css', import.meta.url), 'utf8')
]);

assert.match(html, /id="blankSongIdentity"[^>]*hidden/,'blank-song identity fields must stay hidden until blank creation is selected');
assert.match(modalsCss, /\.new-song-identity\[hidden\]\{display:none\}/,'blank-song identity styling must not override its hidden state');
assert.match(html, /id="newSongNameInput"[^>]*placeholder="例如：晴る"[^>]*required/,'blank creation must collect the immutable song title');
assert.match(html, /id="newSongArrangementNameInput"[^>]*placeholder="例如：晴る 指彈版"[^>]*required/,'blank creation must collect the editable score name');
assert.match(html, /側邊欄「重新命名」只修改譜名；曲名可在編輯器的「上傳」視窗修改。/);
assert.equal((html.match(/搜尋曲名、譜名或作者/g) || []).length, 2, 'catalog and library search hints must include score names');
assert.match(html, /id="renameModalTitle">重新命名譜名</,'sidebar rename UI must make its arrangement-only meaning explicit');
assert.match(html, /for="publishNameInput">曲名<[\s\S]*id="publishNameInput"[^>]*required/,'publishing from the editor must allow the song title to be edited');
assert.match(html, /for="publishArrangementNameInput">譜名<[\s\S]*id="publishArrangementNameInput"[^>]*required/,'publishing from the editor must collect the score name');
assert.match(html, /for="publishArtistInput">作者（歌手）<[\s\S]*for="publishAlbumInput">專輯<[\s\S]*for="publishSourceInput">來源<[\s\S]*id="publishPlayStyleToggle"[\s\S]*id="publishDifficultyInput"/s,'publish modal must expose all public score metadata fields');

assert.match(runtime, /name: String\(song\?\.name \|\| song\?\.title \|\| '未命名曲目'\)/);
assert.match(runtime, /arrangementName: String\(song\?\.arrangementName \|\| song\?\.name \|\| song\?\.title \|\| '未命名曲譜'\)/,'legacy scores must display their old title as arrangementName without a bulk migration');

assert.match(library, /function arrangementDisplayName\(song\)[\s\S]*song\?\.arrangementName \|\| song\?\.name/);
assert.match(library, /function readNewSongIdentity[\s\S]*請填寫曲名[\s\S]*請填寫譜名/s,'both identities must be mandatory before blank creation');
assert.match(workModel, /function formatArrangementDisplayName\(song, fallback = '未命名曲譜'\)[\s\S]*arrangementName === workName[\s\S]*\$\{arrangementName\} - \$\{workName\}/s,'one shared formatter must define score name - song title and suppress duplicates');
assert.match(library, /const scoreName = window\.formatArrangementDisplayName\?\.\(song\) \|\| arrangementDisplayName\(song\)[\s\S]*loadButton\.textContent = scoreName/s,'sidebar text must use the shared score/song display name');
assert.match(library, /item\.addEventListener\('click',[\s\S]*event\.target\.closest\('\.song-more-button,\.song-menu'\)[\s\S]*#\/editor\/\$\{encodeURIComponent\(song\.arrangementId\)\}/s,'the full sidebar row must open the score while menu interactions stay isolated');
assert.doesNotMatch(library, /loadButton\.addEventListener\('click'/,'opening a sidebar score must no longer depend on clicking only its text button');
assert.match(library, /renameInput\.value = arrangementDisplayName\(song\)/);
assert.match(library, /editorTitle\.textContent = window\.formatArrangementDisplayName\?\.\(saved, '吉他 TAB 譜製作器'\)/,'renaming the score must refresh the combined editor title');
assert.match(library, /song\.arrangementName = cleanName/,'rename must mutate arrangementName');
const renameBlock = library.slice(library.indexOf('async function confirmRenameSong()'), library.indexOf('function requestDeleteSong('));
assert.doesNotMatch(renameBlock, /song\.name\s*=/,'rename must never mutate the immutable song title');
assert.match(library, /const identity = readNewSongIdentity\(\)[\s\S]*name: identity\.name,[\s\S]*arrangementName: identity\.arrangementName/s,'blank creation must persist both names');
assert.match(library, /function setBlankSongFormVisible\(visible\)[\s\S]*blankSongIdentity[\s\S]*blankSongOptions/s,'blank identity and meter controls must share one visibility state');
assert.match(library, /blankSongChoice'\)\?\.addEventListener[\s\S]*setBlankSongFormVisible\(true\)[\s\S]*newSongNameInput\?\.focus/s,'blank creation must reveal identity fields before collecting meter');
assert.match(library, /uploadJsonButton\.addEventListener[\s\S]*setBlankSongFormVisible\(false\)[\s\S]*uploadJsonInput\.click\(\)/s,'JSON upload must open directly without showing blank-song identity fields');
assert.doesNotMatch(library, /uploadJsonButton\.addEventListener[\s\S]*readNewSongIdentity/s,'JSON upload must not depend on blank-song identity input');

assert.doesNotMatch(importer, /readNewSongIdentity/,'JSON import must not read blank-song identity fields');
assert.match(importer, /const importedName = String\(imported\?\.name \|\| imported\?\.title \|\| ''\)\.trim\(\)/);
assert.match(importer, /const importedArrangementName = String\(imported\?\.arrangementName \|\| importedName\)\.trim\(\)/,'legacy JSON may fall back to its song title for arrangementName');
assert.match(importer, /delete imported\.workId;[\s\S]*delete imported\.arrangementId;[\s\S]*imported\.name = importedName;[\s\S]*imported\.arrangementName = importedArrangementName;/s,'import must keep JSON-provided names while deriving fresh Work and Arrangement identities');

assert.match(workModel, /function deriveLegacyWorkId\(song\)[\s\S]*song\?\.name/,'Work identity must remain song-title-derived');
assert.match(workModel, /arrangementName: String\(source\.arrangementName \|\| source\.name \|\| '未命名曲譜'\)/,'Arrangement metadata must own the editable score name');
assert.match(api, /'arrangementName'[\s\S]*'name'/,'persisted song JSON must keep arrangementName separate from name');
assert.match(api, /async function updateSongFile\(fileId, song, permission, previousSong = null\)[\s\S]*const persisted = cleanSongForWrite\(song\)/s,'the low-level Drive update must persist the metadata selected by the owning operation');
assert.match(api, /async function saveUserSong\(session, song\)[\s\S]*updateSongFile\(fileId, \{ \.\.\.song, name: entry\.song\.name \}/s,'ordinary save must keep the existing song title');
assert.match(api, /async function publishSong\(session, song\)[\s\S]*const name = String\(song\?\.name[\s\S]*updateSongFile\(fileId, \{ \.\.\.song, name, arrangementName, artist \}/s,'publish must be the explicit path that can change the song title and therefore Work identity');
assert.match(api, /arrangementName: song\.arrangementName/,'index v3 Arrangement records must cache the score name');
assert.match(catalog, /editorTitle\.textContent = window\.formatArrangementDisplayName\?\.\(loaded, '吉他 TAB 譜製作器'\)/,'local editor header must display score name - song title');
assert.match(catalog, /editorTitle\.textContent = window\.formatArrangementDisplayName\?\.\(previewSong, '曲譜'\)/,'preview header must display score name - song title');
assert.match(songActions, /title\.textContent = window\.formatArrangementDisplayName\?\.\(saved, '吉他 TAB 譜製作器'\)/,'saving must preserve the combined editor title');
assert.match(songActions, /title\.textContent = window\.formatArrangementDisplayName\?\.\(updated, '吉他 TAB 譜製作器'\)/,'publishing must refresh the combined editor title');
assert.match(songActions, /openPublishModal\(\)[\s\S]*publishMetadataUi\?\.fill\?\.\(song\)/s,'publish modal must populate the complete current metadata set');
assert.match(songActions, /confirmPublishSong\(\)[\s\S]*const metadata = window\.publishMetadataUi\?\.read\?\.\(\)[\s\S]*請輸入曲名。[\s\S]*請輸入譜名。[\s\S]*請輸入作者（歌手）。[\s\S]*const publishSong = \{[\s\S]*\.\.\.prepared,[\s\S]*\.\.\.metadata/s,'publishing must validate and submit the edited song and score metadata together');
assert.match(library, /publishModal\.querySelectorAll\('input\[type="text"\]'\)[\s\S]*confirmPublishSong/s,'all text metadata fields must support keyboard submission');
assert.match(sourceUi, /function fill\(song\)[\s\S]*field\('name'\)[\s\S]*field\('arrangementName'\)[\s\S]*field\('artist'\)[\s\S]*field\('album'\)[\s\S]*field\('source'\)/s,'publish UI must populate all editable metadata');
assert.match(sourceUi, /function read\(\)[\s\S]*name:[\s\S]*arrangementName:[\s\S]*artist:[\s\S]*album:[\s\S]*source:[\s\S]*playStyle:[\s\S]*difficulty:/s,'publish UI must return the full metadata payload from one source of truth');
assert.match(sidebarCss, /\.song-item \{[^}]*cursor:pointer/s,'sidebar row must advertise its full click target');

console.log('Arrangement naming regression tests passed');
