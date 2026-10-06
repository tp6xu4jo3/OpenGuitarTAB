import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, runtime, library, importer, catalog, api, workModel, sidebarCss] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/app-runtime.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app-library.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/library/song-import.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app-catalog.js', import.meta.url), 'utf8'),
  readFile(new URL('../api/index.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/catalog/work-model.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles/sidebar.css', import.meta.url), 'utf8')
]);

assert.match(html, /id="newSongNameInput"[^>]*placeholder="例如：晴る"[^>]*required/,'new blank/import flow must collect the immutable song title');
assert.match(html, /id="newSongArrangementNameInput"[^>]*placeholder="例如：晴る 指彈版"[^>]*required/,'new blank/import flow must collect the editable score name');
assert.match(html, /曲名建立後固定；之後「重新命名」只會修改譜名。/);
assert.match(html, /id="renameModalTitle">重新命名譜名</,'sidebar rename UI must make its arrangement-only meaning explicit');

assert.match(runtime, /name: String\(song\?\.name \|\| song\?\.title \|\| '未命名曲目'\)/);
assert.match(runtime, /arrangementName: String\(song\?\.arrangementName \|\| song\?\.name \|\| song\?\.title \|\| '未命名曲譜'\)/,'legacy scores must display their old title as arrangementName without a bulk migration');

assert.match(library, /function arrangementDisplayName\(song\)[\s\S]*song\?\.arrangementName \|\| song\?\.name/);
assert.match(library, /function readNewSongIdentity[\s\S]*請填寫曲名[\s\S]*請填寫譜名/s,'both identities must be mandatory before blank creation or JSON import');
assert.match(library, /const scoreName = arrangementDisplayName\(song\)[\s\S]*loadButton\.textContent = scoreName/s,'sidebar text must be the arrangement name');
assert.match(library, /item\.addEventListener\('click',[\s\S]*event\.target\.closest\('\.song-more-button,\.song-menu'\)[\s\S]*#\/editor\/\$\{encodeURIComponent\(song\.arrangementId\)\}/s,'the full sidebar row must open the score while menu interactions stay isolated');
assert.doesNotMatch(library, /loadButton\.addEventListener\('click'/,'opening a sidebar score must no longer depend on clicking only its text button');
assert.match(library, /renameInput\.value = arrangementDisplayName\(song\)/);
assert.match(library, /song\.arrangementName = cleanName/,'rename must mutate arrangementName');
const renameBlock = library.slice(library.indexOf('async function confirmRenameSong()'), library.indexOf('function requestDeleteSong('));
assert.doesNotMatch(renameBlock, /song\.name\s*=/,'rename must never mutate the immutable song title');
assert.match(library, /const identity = readNewSongIdentity\(\)[\s\S]*name: identity\.name,[\s\S]*arrangementName: identity\.arrangementName/s,'blank creation must persist both names');
assert.match(library, /uploadJsonButton\.addEventListener[\s\S]*if \(!readNewSongIdentity\(\)\) return;[\s\S]*uploadJsonInput\.click\(\)/s,'JSON upload must require both names before opening the picker');

assert.match(importer, /const identity = window\.readNewSongIdentity\?\.\(\)/);
assert.match(importer, /delete imported\.workId;[\s\S]*delete imported\.arrangementId;[\s\S]*imported\.name = identity\.name;[\s\S]*imported\.arrangementName = identity\.arrangementName;/s,'import must derive a fresh Work from the entered song title and use the entered score name');

assert.match(workModel, /function deriveLegacyWorkId\(song\)[\s\S]*song\?\.name/,'Work identity must remain song-title-derived');
assert.match(workModel, /arrangementName: String\(source\.arrangementName \|\| source\.name \|\| '未命名曲譜'\)/,'Arrangement metadata must own the editable score name');
assert.match(api, /'arrangementName'[\s\S]*'name'/,'persisted song JSON must keep arrangementName separate from name');
assert.match(api, /async function updateSongFile\(fileId, song, permission, previousSong = null\)[\s\S]*immutableWorkName[\s\S]*name: immutableWorkName/s,'server updates must enforce the existing Work title even if a client sends a different name');
assert.match(api, /arrangementName: song\.arrangementName/,'index v3 Arrangement records must cache the score name');
assert.match(catalog, /editorTitle\.textContent = loaded\.arrangementName \|\| loaded\.name/,'local editor header must display the score name');
assert.match(catalog, /editorTitle\.textContent = previewSong\.arrangementName \|\| previewSong\.name/,'preview header must display the score name');
assert.match(sidebarCss, /\.song-item \{[^}]*cursor:pointer/s,'sidebar row must advertise its full click target');

console.log('Arrangement naming regression tests passed');
