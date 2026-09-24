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

async function build(target) {
  await execFileAsync(process.execPath, ['scripts/build-static.mjs', `--target=${target}`], { cwd: projectRoot });
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

await build('production');
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

await build('test-pages');
assert.equal(
  await readFile(path.join(dist, 'src', 'data', 'runtime-target.js'), 'utf8'),
  "export const DATA_SOURCE_TARGET = 'local-test';\n",
  'GitHub Pages output must always use LocalTestDataSource'
);
assert.equal(await exists(path.join(dist, 'test-data', 'pages', 'catalog.json')), true);
assert.equal(await exists(path.join(dist, 'test-data', 'pages', 'songs', 'pages-summer.json')), true);

await build('production');
console.log('Build target tests passed');
