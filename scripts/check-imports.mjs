#!/usr/bin/env node
// Every relative import in a built server tree must name a real file in that tree.
// Usage: node scripts/check-imports.mjs [dir]      (default: dist/server)
// Matching is exact-case against the directory listing: on Windows the
// filesystem would otherwise resolve the wrong name for us.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] ?? 'dist/server';
const SPECIFIER = /(?:from\s*|import\s*)['"](\.\/[^'"]+)['"]/g;

const modules = fs.readdirSync(dir).filter((name) => /\.(mjs|js)$/.test(name)).sort();
if (modules.length === 0) {
  console.error(`FAIL ${dir}: no modules found`);
  process.exit(1);
}

const present = new Set(modules);

// The scanned directory must be the one wrangler builds its entrypoint into,
// so the import check and the manifest cannot disagree about the entrypoint.
const wranglerPath = path.join(process.cwd(), 'wrangler.jsonc');
let entrypoint = null;
if (fs.existsSync(wranglerPath)) {
  const main = (fs.readFileSync(wranglerPath, 'utf8').match(/"main"\s*:\s*"([^"]+)"/) ?? [])[1];
  if (!main) {
    console.error('FAIL wrangler.jsonc has no "main"');
    process.exit(1);
  }
  entrypoint = main;
  const mainDir = path.posix.dirname(main.split(path.sep).join('/'));
  if (mainDir !== dir.split(path.sep).join('/')) {
    console.error(`FAIL wrangler main ${main} is not in ${dir}`);
    process.exit(1);
  }
  if (!present.has(path.basename(main))) {
    console.error(`FAIL entrypoint ${main} is not on disk in ${dir}`);
    process.exit(1);
  }
}

let checked = 0;

for (const module of modules) {
  const source = fs.readFileSync(path.join(dir, module), 'utf8');
  for (const [, specifier] of source.matchAll(SPECIFIER)) {
    checked += 1;
    if (!present.has(specifier.slice(2))) {
      console.error(`FAIL ${module} -> ${specifier} (no such file in ${dir})`);
      process.exit(1);
    }
  }
}

console.log(`${dir}: ${modules.length} modules, ${checked} relative specifiers, 0 unresolved`);
if (entrypoint) console.log(`entrypoint: ${entrypoint} (wrangler main, present in ${dir})`);
