import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoots = ['api', 'src', 'scripts', 'tests'];

async function collectJavaScriptFiles(relativeDir) {
  const absoluteDir = path.join(projectRoot, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectJavaScriptFiles(relativePath));
      continue;
    }
    if (/\.(?:js|mjs)$/.test(entry.name)) files.push(relativePath);
  }

  return files;
}

const files = (await Promise.all(sourceRoots.map(collectJavaScriptFiles)))
  .flat()
  .sort();

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: projectRoot,
    stdio: 'inherit'
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Syntax checked ${files.length} JavaScript files.`);
