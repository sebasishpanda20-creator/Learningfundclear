#!/usr/bin/env node
// Validates a deploy manifest against the tree it will be uploaded from.
// Usage: node scripts/validate-manifest.mjs <manifest path>
import fs from 'node:fs';
import path from 'node:path';

const manifestPath = path.resolve(process.argv[2] ?? 'deploy-manifest-reviewed.json');
const root = path.dirname(manifestPath);
const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
};

const abs = (rel) => path.resolve(root, rel);
const relOf = (rel) => path.relative(root, abs(rel)).split(path.sep).join('/');

// entrypoint: a basename; its location is moduleRoot/<entrypoint>
const entryPath = m.entrypoint;
check('entrypoint is set', typeof m.entrypoint === 'string' && m.entrypoint.length > 0, m.entrypoint);
check('entrypoint is a relative path', typeof entryPath === 'string' && !path.isAbsolute(entryPath), entryPath);
check('entrypoint path exists', fs.existsSync(abs(entryPath)), relOf(entryPath));

// The manifest entrypoint must be the same file wrangler builds to.
let wranglerMain = null;
try {
  const wc = fs.readFileSync(abs('wrangler.jsonc'), 'utf8');
  wranglerMain = (wc.match(/"main"\s*:\s*"([^"]+)"/) ?? [])[1] ?? null;
} catch {}
const normalizedEntry = path.posix.normalize(entryPath);
check('entrypoint matches wrangler main', wranglerMain !== null && path.posix.normalize(wranglerMain) === normalizedEntry, `manifest ${normalizedEntry} vs wrangler ${wranglerMain}`);

// ESM check: the entrypoint must parse as a module and use module syntax
let esm = false;
try {
  const source = fs.readFileSync(abs(entryPath), 'utf8');
  new Function('return import("data:text/javascript,")'); // smoke: dynamic import available
  esm = /(^|\n)\s*(import\s|export\s)/.test(source) && !/require\s*\(/.test(source);
} catch (e) {
  esm = false;
}
check('entrypoint is ESM', esm, 'has import/export syntax, no require()');

// modules: every path exists, ids match path basenames, no duplicates
const paths = m.modules.map((mod) => mod.path);
const missing = m.modules.filter((mod) => !fs.existsSync(abs(mod.path))).map((mod) => mod.path);
check('every module path exists', missing.length === 0, missing.join(', ') || 'all present');

const mismatched = m.modules
  .filter((mod) => path.posix.basename(mod.path) !== mod.name)
  .map((mod) => `${mod.name} != ${path.posix.basename(mod.path)}`);
check('module names match path basenames', mismatched.length === 0, mismatched.join(', ') || 'all match');

const badType = m.modules.filter((mod) => mod.type !== 'esm');
check('every module is esm', badType.length === 0, badType.map((m2) => m2.name).join(', ') || 'all esm');

const dupes = m.modules.map((mod) => mod.name).filter((nm, i, all) => all.indexOf(nm) !== i);
check('no duplicate module names', dupes.length === 0, dupes.join(', ') || 'none');

// entrypoint is one of the declared modules
const entryRel = './' + relOf(entryPath).replace(/^\.\//, '');
check('entrypoint is declared as a module', paths.includes(entryRel), entryRel);

// all paths relative to the same root
const outside = m.modules.map((mod) => mod.path).filter((p) => !p.startsWith('./'));
check('all module paths are relative to the root', outside.length === 0, outside.join(', ') || 'all ./-relative');

// every import edge resolves inside the declared set
const SPECIFIER = /(?:from\s*|import\s*)['"](\.\/[^'"]+)['"]/g;
const declared = new Set(m.modules.map((mod) => mod.name));
const unresolved = [];
for (const mod of m.modules) {
  const src = fs.readFileSync(abs(mod.path), 'utf8');
  for (const [, spec] of src.matchAll(SPECIFIER)) {
    if (!declared.has(spec.slice(2))) unresolved.push(`${mod.name} -> ${spec}`);
  }
}
check('every import edge resolves', unresolved.length === 0, unresolved.join(' | ') || 'all edges declared');

// assets
check('assets directory exists', fs.existsSync(abs(m.assetsDirectory)), relOf(m.assetsDirectory));
const assetFiles = fs.existsSync(abs(m.assetsDirectory))
  ? fs.readdirSync(abs(m.assetsDirectory)).length
  : 0;
check('assets directory is non-empty', assetFiles > 0, `${assetFiles} entries`);
check('spa flag is explicit', typeof m.spa === 'boolean', String(m.spa));

// unused modules: files reachable in the tree but not declared
const serverDir = path.dirname(path.dirname(abs(entryPath)));
const onDisk = fs.readdirSync(serverDir).filter((f) => /\.(mjs|js)$/.test(f));
const declaredFiles = new Set(m.modules.map((mod) => path.posix.basename(mod.path)));
const unused = onDisk.filter((f) => !declaredFiles.has(f));
check('no unexpected unused modules', unused.every((f) => f === 'worker.mjs'), unused.join(', ') || 'none');

// no source-tree or stale paths
const bad = m.modules
  .map((mod) => mod.path)
  .filter((p) => /(^|\/)server\//.test(p) && !/dist\/server\//.test(p));
check('no source-tree or stale paths', bad.length === 0, bad.join(', ') || 'none');

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  -> ' + r.detail : ''}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed === 0 ? 'RESULT: PASS' : 'RESULT: FAIL'} (${results.length - failed}/${results.length})`);
process.exitCode = failed === 0 ? 0 : 1;
