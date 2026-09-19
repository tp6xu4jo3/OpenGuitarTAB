import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(projectRoot, 'dist');

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await cp(path.join(projectRoot, 'index.html'), path.join(outputDir, 'index.html'));

for (const directory of ['src', 'styles']) {
  await cp(path.join(projectRoot, directory), path.join(outputDir, directory), {
    recursive: true
  });
}

// Vercel serves the configured output directory as the site root, so merge
// public/ into dist/ instead of publishing it under /public.
await cp(path.join(projectRoot, 'public'), outputDir, { recursive: true });

console.log(`Static site built at ${outputDir}`);
