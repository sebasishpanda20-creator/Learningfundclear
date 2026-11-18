#!/usr/bin/env node
// The readiness gate for this release. One command, one verdict.
//
//   node scripts/deploy-gate.mjs
//
// The upload source is THIS directory (the repository root). Everything the
// deploy reads must live under it, because the hosting API rejects any file
// outside the workspace.
//
//   built tree : ./dist/server  (worker modules)  +  ./dist/client (assets)
//   entrypoint : the file named by wrangler.jsonc "main" — currently
//                dist/server/index.js. The manifest must agree with it.
//   manifest   : ./deploy-manifest-reviewed.json, regenerated from the graph,
//                never hand-edited.
//
// Exit 0 = GO. Any other exit code = NO-GO, with every blocking reason listed.
// Nothing here deploys, uploads or publishes.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const blocks = [];
const lines = [];
const ok = (label, detail = '') => lines.push(`  PASS  ${label}${detail ? '  -> ' + detail : ''}`);
const block = (label, detail) => {
  blocks.push(`${label}: ${detail}`);
  lines.push(`  BLOCK ${label}  -> ${detail}`);
};

// 1. The built tree must exist, complete.
const serverDir = path.join(root, 'dist/server');
const clientDir = path.join(root, 'dist/client');
const entrypointRel = (() => {
  const wc = path.join(root, 'wrangler.jsonc');
  if (!fs.existsSync(wc)) return null;
  return (fs.readFileSync(wc, 'utf8').match(/"main"\s*:\s*"([^"]+)"/) ?? [])[1] ?? null;
})();
if (!entrypointRel) block('wrangler main', 'wrangler.jsonc is missing or has no "main"');
if (!fs.existsSync(serverDir)) block('built tree', 'dist/server is missing — build before gating');
if (!fs.existsSync(clientDir)) block('built tree', 'dist/client is missing — build before gating');
if (entrypointRel && !fs.existsSync(path.join(root, entrypointRel))) block('entrypoint', `${entrypointRel} is not on disk`);
if (blocks.length === 0) ok('built tree', `dist/server + dist/client present`);

const modules = fs.existsSync(serverDir)
  ? fs.readdirSync(serverDir).filter((f) => /\.(mjs|js)$/.test(f)).sort()
  : [];

// 2. Exactly one entrypoint file: no duplicate copy of the worker.
const entryBase = entrypointRel ? path.basename(entrypointRel) : null;
if (entryBase && fs.existsSync(path.join(serverDir, entryBase))) {
  const duplicate = modules.find((f) => f !== entryBase && fs.readFileSync(path.join(serverDir, f)).equals(fs.readFileSync(path.join(serverDir, entryBase))));
  if (duplicate) block('duplicate entrypoint', `${duplicate} is a byte-identical copy of ${entryBase} — remove it from dist`);
  else ok('single entrypoint', entrypointRel);
}

// 3. Every import resolves, exact-case, in the built tree.
const SPECIFIER = /(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g;
const present = new Set(modules);
let edges = 0;
for (const mod of modules) {
  const source = fs.readFileSync(path.join(serverDir, mod), 'utf8');
  for (const [, spec] of source.matchAll(SPECIFIER)) {
    edges += 1;
    const target = spec.replace(/^\.\//, '');
    if (!present.has(target)) block('unresolved import', `${mod} -> ${spec}`);
  }
}
if (modules.length === 0) block('import resolution', 'no worker modules in dist/server');
else if (!blocks.some((b) => b.startsWith('unresolved import'))) ok('import resolution', `${modules.length} modules, ${edges} specifiers, 0 unresolved`);

// 4. Only worker modules in the upload directory — no tests, stubs or source copies.
const stray = modules.filter((f) => /\.(test|spec)\.|\.map$/.test(f));
if (stray.length) block('stray files', `dist/server contains ${stray.join(', ')}`);
else ok('no stray files', `${modules.length} modules, all worker code`);

// 5. The manifest must exist and must be exactly what the generator produces.
const manifestPath = path.join(root, 'deploy-manifest-reviewed.json');
const regen = spawnSync(process.execPath, ['scripts/regen-manifest.mjs', '.'], { cwd: root, encoding: 'utf8' });
if (regen.status !== 0) block('manifest regeneration', (regen.stderr || regen.stdout || '').trim().split('\n').slice(-1)[0]);
if (!fs.existsSync(manifestPath)) block('manifest', 'deploy-manifest-reviewed.json is missing');
let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {
  block('manifest', 'is not valid JSON');
}
if (manifest && entrypointRel) {
  const manifestPathRel = String(manifest.entrypoint).replace(/^\.\//, '');
  if (manifestPathRel !== entrypointRel.replace(/\\/g, '/')) block('entrypoint disagreement', `manifest ${manifestPathRel} vs wrangler ${entrypointRel}`);
  else ok('entrypoint agreement', manifestPathRel);
  const ids = manifest.modules.map((m) => m.name);
  const dupIds = ids.length - new Set(ids).size;
  if (dupIds) block('duplicate module names', `${dupIds} duplicated`);
  const entryName = path.basename(entrypointRel);
  const unused = ids.filter((id) => id !== entryName && !modules.some((f) => fs.readFileSync(path.join(serverDir, f), 'utf8').includes(`'./${id}'`) || fs.readFileSync(path.join(serverDir, f), 'utf8').includes(`"./${id}"`)));
  if (unused.length) block('unused declared modules', unused.join(', '));
  const undeclared = modules.filter((f) => !ids.includes(f));
  if (undeclared.length) block('undeclared modules on disk', undeclared.join(', '));
  const missing = manifest.modules.filter((m) => !fs.existsSync(path.join(root, m.path)));
  if (missing.length) block('manifest paths missing', missing.map((m) => m.path).join(', '));
  if (!dupIds && !unused.length && !undeclared.length && !missing.length) ok('manifest vs tree', `${ids.length} declared = ${modules.length} on disk, 0 duplicate, 0 unused`);
  if (manifest.assetsDirectory !== './dist/client') block('assets', `manifest assetsDirectory ${manifest.assetsDirectory} is not ./dist/client`);
  else ok('assets', './dist/client');
}

// 6. Syntax for every module in the graph.
let syntaxBad = 0;
for (const mod of modules) {
  const r = spawnSync(process.execPath, ['--check', path.join(serverDir, mod)], { encoding: 'utf8' });
  if (r.status !== 0) {
    syntaxBad += 1;
    block('syntax', mod);
  }
}
if (syntaxBad === 0 && modules.length) ok('node --check', `${modules.length}/${modules.length} modules parse`);

// 7. The repo's own checks: manifest validator, import check, full guard, terminal test.
const steps = [
  ['manifest validator', [process.execPath, ['scripts/validate-manifest.mjs', 'deploy-manifest-reviewed.json']]],
  ['import check', [process.execPath, ['scripts/check-imports.mjs', 'dist/server']]],
  ['production guard', ['bash', ['.ci/guard.sh']]],
  ['terminal-open test', [process.execPath, ['--test', 'qa/terminal-open.test.mjs']]],
];
for (const [label, [cmd, args]] of steps) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8' });
  if (r.status === 0) ok(label, 'exit 0');
  else {
    const tail = ((r.stdout || '') + (r.stderr || '')).trim().split('\n').filter((l) => /FAIL|Error|not ok|EADDRINUSE/.test(l)).slice(0, 3).join(' | ');
    block(label, `exit ${r.status}${tail ? ' — ' + tail : ''}`);
  }
}

console.log(`\nDeploy readiness gate — ${root}\n`);
console.log(lines.join('\n'));
if (blocks.length) {
  console.log(`\nVERDICT: NO-GO (${blocks.length} blocking)\n`);
  for (const b of blocks) console.log(`  - ${b}`);
  console.log('');
  process.exit(1);
}
console.log('\nVERDICT: GO — build tree, entrypoint, manifest and checks agree.\n');
