import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(projectRoot, 'dist');

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

await execFileAsync(process.execPath, ['scripts/build-static.mjs'], { cwd: projectRoot });
assert.equal(
  await readFile(path.join(dist, 'src', 'data', 'runtime-target.js'), 'utf8'),
  "export const DATA_SOURCE_TARGET = 'server';\n",
  'production output must always use ServerDataSource'
);
assert.equal(
  await exists(path.join(dist, 'test-data', 'pages', 'catalog.json')),
  false,
  'production output must not ship GitHub test fixtures'
);

assert.equal(
  await readFile(path.join(projectRoot, 'src', 'data', 'runtime-target.js'), 'utf8'),
  "export const DATA_SOURCE_TARGET = 'local-test';\n",
  'GitHub Pages repository source must use LocalTestDataSource'
);
assert.equal(await exists(path.join(projectRoot, 'test-data', 'pages', 'catalog.json')), true);
assert.equal(await exists(path.join(projectRoot, 'test-data', 'pages', 'artists.json')), true);
assert.equal(await exists(path.join(projectRoot, 'test-data', 'pages', 'songs', 'pages-summer.json')), true);

const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
assert.equal('build:test-pages' in packageJson.scripts, false, 'the unused alternate Pages artifact build path must stay removed');

await assert.rejects(
  execFileAsync(process.execPath, ['scripts/build-static.mjs', '--target=test-pages'], { cwd: projectRoot }),
  /Unknown build target: test-pages/,
  'the obsolete second Pages build path must not silently reappear'
);

console.log('Build target tests passed');
