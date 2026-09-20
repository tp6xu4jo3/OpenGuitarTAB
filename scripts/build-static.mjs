import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(projectRoot, 'dist');
const stylesDir = path.join(projectRoot, 'styles');
const outputStylesDir = path.join(outputDir, 'styles');
const cssImportPattern = /^@import\s+['"](.+?)['"]\s*;\s*$/gm;

async function bundleLocalCss(filePath, stack = new Set()) {
  const normalizedPath = path.resolve(filePath);
  if (stack.has(normalizedPath)) {
    throw new Error(`Circular CSS import detected: ${normalizedPath}`);
  }

  const nextStack = new Set(stack);
  nextStack.add(normalizedPath);

  const source = await readFile(normalizedPath, 'utf8');
  const matches = [...source.matchAll(cssImportPattern)];
  if (!matches.length) return source;

  let bundled = '';
  let cursor = 0;

  for (const match of matches) {
    bundled += source.slice(cursor, match.index);
    const importPath = path.resolve(path.dirname(normalizedPath), match[1]);
    const imported = await bundleLocalCss(importPath, nextStack);
    bundled += `/* ${path.relative(stylesDir, importPath)} */\n${imported.trim()}\n`;
    cursor = match.index + match[0].length;
  }

  bundled += source.slice(cursor);
  return bundled;
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await Promise.all([
  cp(path.join(projectRoot, 'index.html'), path.join(outputDir, 'index.html')),
  cp(path.join(projectRoot, 'src'), path.join(outputDir, 'src'), { recursive: true })
]);

await mkdir(outputStylesDir, { recursive: true });
const bundledCss = await bundleLocalCss(path.join(stylesDir, 'main.css'));
await writeFile(path.join(outputStylesDir, 'main.css'), bundledCss, 'utf8');

console.log(`Static site built at ${outputDir}`);
