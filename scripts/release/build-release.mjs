#!/usr/bin/env node
// Clean-room build for a release: fail fast if the source entrypoint is gone,
// then delegate to the project build so there is only one build implementation.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  'server/worker.mjs',
  'server/delta-account.mjs',
  'server/crypto-engine.js',
  'server/terminal-gate.mjs',
  'wrangler.jsonc',
];

const missing = required.filter((f) => !existsSync(path.join(root, f)));
if (missing.length) {
  console.error(`STOP: missing source file(s): ${missing.join(', ')}`);
  process.exit(1);
}

execFileSync(process.execPath, ['scripts/build.mjs', '--cloudflare'], { stdio: 'inherit', cwd: root });
console.log('build-only: dist/server + dist/client written');
