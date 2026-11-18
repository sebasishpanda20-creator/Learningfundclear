#!/usr/bin/env node
// Writes the deploy manifest for a built tree. Fails closed: nothing is written
// if an import is unresolved, a directory is missing, or a var drifted.
// Usage: node scripts/regen-manifest.mjs [root]      (default: cwd)
//
// Module ids are basenames, so an import "./x.mjs" resolves to the id "x.mjs".
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? process.cwd());
const stop = (message) => {
  console.error(`STOP: ${message}`);
  process.exit(1);
};

const wranglerPath = path.join(root, 'wrangler.jsonc');
if (!fs.existsSync(wranglerPath)) stop('no wrangler.jsonc');
const wrangler = fs.readFileSync(wranglerPath, 'utf8');
const setting = (key) => (wrangler.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 'i')) ?? [])[1];

const main = setting('main');
const serverDir = path.join(root, 'dist/server');
const clientDir = path.join(root, 'dist/client');
for (const dir of [serverDir, clientDir]) if (!fs.existsSync(dir)) stop(`missing ${dir}`);
if (!main) stop('wrangler.jsonc has no "main"');
if (!fs.existsSync(path.join(root, main))) stop(`entrypoint ${main} is not on disk`);

const files = fs.readdirSync(serverDir).filter((name) => /\.(mjs|js)$/.test(name)).sort();
const present = new Set(files);
const SPECIFIER = /(?:from\s*|import\s*)['"](\.\/[^'"]+)['"]/g;
const importsOf = (id) =>
  [...fs.readFileSync(path.join(serverDir, id), 'utf8').matchAll(SPECIFIER)].map(([, specifier]) => specifier.slice(2));

// Every import in the tree must resolve, including imports in files the
// entrypoint never reaches.
for (const id of files) {
  for (const target of importsOf(id)) {
    if (!present.has(target)) stop(`unresolved import: ${id} -> ${target}`);
  }
}

// Modules are the entrypoint's closure; everything else is not uploaded.
const entryId = path.basename(main);
const ids = new Set();
const walk = (id) => {
  if (ids.has(id)) return;
  ids.add(id);
  for (const target of importsOf(id)) walk(target);
};
walk(entryId);
const unreachable = files.filter((name) => !ids.has(name));

// Real basename conflicts: a module id whose basename also occurs on another
// path inside the upload tree, which would make the id ambiguous.
const uploadTree = path.join(root, 'dist');
const allUploadFiles = [];
const walkDist = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDist(full);
    else allUploadFiles.push(full);
  }
};
walkDist(uploadTree);
const pathsByBasename = new Map();
for (const full of allUploadFiles) {
  const base = path.basename(full);
  if (!pathsByBasename.has(base)) pathsByBasename.set(base, []);
  pathsByBasename.get(base).push(path.relative(root, full).split(path.sep).join('/'));
}
const conflicts = [...ids]
  .filter((id) => (pathsByBasename.get(id) ?? []).length > 1)
  .map((id) => `${id} -> ${pathsByBasename.get(id).join(', ')}`);

if (setting('OPEN_TERMINAL') !== 'false') stop(`OPEN_TERMINAL is ${setting('OPEN_TERMINAL')}, expected false`);
if (setting('QUANT_API_ORIGIN') !== 'https://quant-daemon-a9m2.onrender.com') stop('QUANT_API_ORIGIN changed');

// One rule: a module is named by its basename and lives at moduleRoot/<basename>.
const moduleRoot = `./${path.posix.dirname(main)}`;
const manifest = {
  entrypoint: main,
  compatibilityDate: setting('compatibility_date'),
  modules: [...ids].map((id) => ({ name: id, type: 'esm', path: `${moduleRoot}/${id}` })),
  assetsDirectory: './dist/client',
  spa: false,
  vars: { OPEN_TERMINAL: setting('OPEN_TERMINAL'), QUANT_API_ORIGIN: setting('QUANT_API_ORIGIN') },
};

const outPath = path.join(root, 'deploy-manifest-reviewed.json');
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));

console.log(`${root}: ${manifest.modules.length} modules, entrypoint ${main}, ${unreachable.length} unreachable`);
console.log(`names: ${JSON.stringify(manifest.modules.map((module) => module.name))}`);
console.log(`basename conflicts: ${conflicts.length}${conflicts.length ? ' -> ' + conflicts.join(' | ') : ''}`);
if (unreachable.length) console.log(`WARNING unreachable files on disk: ${unreachable.join(', ')}`);
console.log(`written: ${outPath}`);
