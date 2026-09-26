import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const editorDir = join(root, 'src/editor');
const read = relative => readFileSync(join(root, relative), 'utf8');

const removedDenseModules = [
  'src/editor/grid-renderer.js',
  'src/editor/grid-geometry.js',
  'src/editor/grid-navigation.js',
  'src/editor/input-controller.js',
  'src/editor/legacy-grid-compat.js',
  'src/editor/presentation.js'
];
removedDenseModules.forEach(path => assert.equal(existsSync(join(root, path)), false, `${path} must be removed after Sparse V3 cutover`));

const renderer = read('src/editor/renderer.js');
assert.match(renderer, /class SparseScoreRenderer/);
assert.match(renderer, /v3-column-target/);
assert.match(renderer, /editableTimesForMeasure/);
assert.match(renderer, /buildAdaptiveLayout/);
assert.match(renderer, /buildAdaptiveSystemLayout/);
assert.match(renderer, /applyLayoutChange/);
assert.doesNotMatch(renderer, /note-input|song\.rows|rhythmRows|rowMeasureCounts/);

const controller = read('src/editor/controller.js');
assert.match(controller, /new SparseScoreRenderer/);
assert.match(controller, /scoreRenderer\?\.render/);
assert.doesNotMatch(controller, /grid-renderer|input-controller|projectStoreToView|note-input/);
assert.doesNotMatch(controller, /window\.renderRows\s*=/, 'removed Dense Grid renderRows global must not return as a compatibility entry point');

const editorReadme = read('src/editor/README.md');
assert.match(editorReadme, /renderer\.js` — the production `SparseScoreRenderer`/, 'architecture documentation must name SparseScoreRenderer as production');
assert.doesNotMatch(editorReadme, /`grid-renderer\.js` — current production|`legacy-grid-compat\.js` — the only production|`input-controller\.js` — note input orchestration/, 'architecture documentation must not describe removed Dense Grid modules as live production modules');

const migration = read('src/editor/migrate-v2.js');
assert.match(migration, /migrateSongToDocumentV3/);
assert.match(migration, /delete song\.rows/);
assert.match(migration, /delete song\.rhythmRows/);
assert.match(migration, /delete song\.rowMeasureCounts/);
assert.doesNotMatch(migration, /documentToLegacyProjection|reconcileLegacy/);

const stateSync = read('src/editor/state-sync.js');
assert.doesNotMatch(stateSync, /grid-renderer|legacy-grid|renderRows|project/);

const playback = read('src/editor/playback-controller.js');
assert.match(playback, /v3-column-target/);
assert.doesNotMatch(playback, /grid-geometry|legacy-grid|LEGACY_SLOTS_PER_BEAT|note-input/);

const structure = read('src/editor/structure-controller.js');
assert.match(structure, /v3-grid/);
assert.doesNotMatch(structure, /grid-geometry|legacy-grid|projectDocumentToLegacySong|renderRows/);

const bootstrap = read('src/bootstrap.js');
assert.match(bootstrap, /createBlankDocumentV3/);
assert.match(bootstrap, /installEditorV3/);
assert.doesNotMatch(bootstrap, /installGridRenderer|installEditorPresentation/);

const runtime = read('src/app-runtime.js');
assert.match(runtime, /createBlankDocumentV3/);
assert.match(runtime, /ensureSongDocumentV3/);
assert.doesNotMatch(runtime, /rowMeasureCounts|rhythmRows|blankRows|normalizeRows/);

const library = read('src/app-library.js');
assert.match(library, /createBlankDocumentV3/);
assert.match(library, /renderCurrentSong/);
assert.doesNotMatch(library, /blankRows|saved\.rows|song\.rows/);

function walk(directory) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const forbiddenNames = /(?:^|[-_.])(fix|patch|hotpath|guard|override)(?:[-_.]|$)/i;
walk(editorDir).forEach(path => assert.equal(forbiddenNames.test(path.split('/').pop()), false, `forbidden patch-style module name: ${path}`));

console.log('editor architecture tests passed');
